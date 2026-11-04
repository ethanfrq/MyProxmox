// Les différentes façons de parler à Proxmox :
//  - userCall : avec le ticket de la personne connectée (ses propres droits Proxmox) ;
//  - serviceCall : avec le jeton de service (alertes, écran de monitoring, MCP) ;
//  - en mode démo, tout passe par le faux Proxmox.
import { request, requestRaw, PveError, type Method, type Params, type Target } from "./http";
import { getConfig, DEMO } from "./config";
import { mockRequest } from "../../shared/mock";
import type { Call } from "../../shared/types";

export { PveError };

function target(): Target {
  const c = getConfig();
  if (!c.pve) throw new PveError(503, "Proxmox n'est pas encore configuré");
  return { url: c.pve.url, insecureTls: c.pve.insecureTls };
}

const mockCall: Call = async (method, path, params) => {
  try {
    return mockRequest(method, path, params as Params);
  } catch (e) {
    throw new PveError((e as { status?: number }).status ?? 500, (e as Error).message);
  }
};

export function serviceCall(): Call {
  if (DEMO) return mockCall;
  return (method, path, params) => {
    const c = getConfig();
    if (!c.pve?.tokenId) throw new PveError(503, "Jeton de service manquant : refais la configuration");
    return request(target(), method as Method, path, { Authorization: `PVEAPIToken=${c.pve.tokenId}=${c.pve.tokenSecret}` }, params as Params);
  };
}

export function ticketCall(ticket: string, csrf: string, t?: Target): Call {
  if (DEMO) return mockCall;
  return (method, path, params) =>
    request(t ?? target(), method as Method, path, {
      Cookie: `PVEAuthCookie=${encodeURIComponent(ticket)}`,
      ...(method !== "GET" ? { CSRFPreventionToken: csrf } : {}),
    }, params as Params);
}

/** Connexion Proxmox (avec double authentification TOTP si nécessaire). */
export async function login(t: Target, username: string, password: string, otp?: string) {
  if (DEMO) return { ticket: "demo", csrf: "demo", username };
  const first = await request(t, "POST", "/access/ticket", {}, { username, password });
  if (first?.NeedTFA) {
    if (!otp) return { needOtp: true as const };
    // Deuxième étape : le code TOTP, accompagné du ticket « défi » reçu
    const second = await request(t, "POST", "/access/ticket", {}, {
      username,
      "tfa-challenge": first.ticket,
      password: /^\d{6,8}$/.test(otp) ? `totp:${otp}` : otp.startsWith("recovery:") ? otp : `recovery:${otp}`,
    });
    return { ticket: second.ticket as string, csrf: second.CSRFPreventionToken as string, username: second.username as string };
  }
  return { ticket: first.ticket as string, csrf: first.CSRFPreventionToken as string, username: first.username as string };
}

/** Les tickets Proxmox durent 2 h : on les renouvelle avec le ticket lui-même. */
export async function renew(username: string, ticket: string) {
  if (DEMO) return { ticket, csrf: "demo" };
  const r = await request(target(), "POST", "/access/ticket", {}, { username, password: ticket });
  return { ticket: r.ticket as string, csrf: r.CSRFPreventionToken as string };
}

// ── Création du compte de service pendant l'onboarding ─────────────
export const SERVICE_USER = "myproxmox@pve";
export const SERVICE_TOKEN = "service";
export const SERVICE_ROLE = "MyProxmoxService";
// Lecture de tout + actions sûres (démarrer, éteindre, snapshot, sauvegarde).
// Pas de suppression, pas de modification de configuration, pas de permissions.
export const SERVICE_PRIVS = [
  "Sys.Audit", "VM.Audit", "Datastore.Audit", "Pool.Audit", "SDN.Audit", "Mapping.Audit",
  "Sys.Syslog", "VM.PowerMgmt", "VM.Snapshot", "VM.Backup", "Datastore.AllocateSpace", "VM.Monitor",
];

export async function createServiceToken(call: Call) {
  const privs = SERVICE_PRIVS.join(",");
  try {
    await call("POST", "/access/roles", { roleid: SERVICE_ROLE, privs });
  } catch (e) {
    if (!/exist/i.test((e as Error).message)) {
      // Certains privilèges n'existent pas sur les anciennes versions : on réessaie sans eux
      await call("POST", "/access/roles", { roleid: SERVICE_ROLE, privs: privs.replace(/,?(SDN|Mapping)\.Audit/g, "").replace(/,?VM\.Monitor/, "") }).catch(() => {});
    } else {
      await call("PUT", `/access/roles/${SERVICE_ROLE}`, { privs }).catch(() => {});
    }
  }
  try {
    await call("POST", "/access/users", { userid: SERVICE_USER, comment: "Compte de service MyProxmox (alertes, monitoring, MCP)" });
  } catch (e) {
    if (!/exist/i.test((e as Error).message)) throw e;
  }
  await call("PUT", "/access/acl", { path: "/", roles: SERVICE_ROLE, users: SERVICE_USER, propagate: 1 });
  await call("DELETE", `/access/users/${SERVICE_USER}/token/${SERVICE_TOKEN}`).catch(() => {});
  const token = await call("POST", `/access/users/${SERVICE_USER}/token/${SERVICE_TOKEN}`, { privsep: 0, comment: "MyProxmox" });
  return { tokenId: token["full-tokenid"] as string, tokenSecret: token.value as string };
}

/** Téléchargement brut avec le ticket de la personne connectée (fichiers restaurés...). */
export async function ticketDownload(ticket: string, path: string, params: Params) {
  if (DEMO) return { demo: String(mockRequest("GET", path, params)) };
  return { stream: await requestRaw(target(), path, { Cookie: `PVEAuthCookie=${encodeURIComponent(ticket)}` }, params) };
}

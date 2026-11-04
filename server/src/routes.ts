// Toutes les routes /api de MyProxmox.
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DEMO, PRIVATE_RANGES, ROOT, clearNotifications, getActivity, getConfig, getNotifications, logActivity,
  markRead, newSecret, saveConfig, sameHash, sha256, version,
} from "./config";
import { PveError, createServiceToken, login, serviceCall, ticketCall, ticketDownload, ticketUpload } from "./pve";
import { request } from "./http";
import { clientIp, validCidr } from "./ipfilter";
import { addStream, broadcast, clearCookie, createSession, destroySession, destroyUserSessions, getSession, requireAdmin, requireSession, setCookie } from "./sessions";
import { localGuard, readOnlyPermissions } from "./local-access";
import {
  checkPassword, createUser, deleteUser, getUser, getUsers, isRole, publicUser, recordAttempt, setPassword, tooManyAttempts,
  updateUser, verifyPassword,
} from "./users";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp";
import { activeAlerts, engineStatus, runOnce } from "./engine";
import { send } from "./notify";
import { addNotification } from "./config";
import { backupStatus, inventory, overview, security, serverHealth, storageInsights } from "../../shared/insights";
import { monitoring } from "../../shared/monitoring";
import { deleteLayout, getLayouts, saveLayout } from "./layouts";
import type { Channel, McpLevel, Me, PublicSettings, RegistrationMode } from "../../shared/types";

export const api = Router();

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ data });
  } catch (e) {
    const status = e instanceof PveError ? e.status : (e as { status?: number }).status ?? 500;
    if (!res.headersSent) res.status(status >= 400 && status < 600 ? status : 500).json({ error: (e as Error).message });
  }
};
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

function normalizeUrl(raw = "") {
  let u = String(raw).trim();
  if (!/^https?:\/\//.test(u)) u = `https://${u}`;
  const parsed = new URL(u);
  if (!parsed.port) parsed.port = "8006";
  return `${parsed.protocol}//${parsed.host}`;
}

async function isAdmin(call: ReturnType<typeof ticketCall>, username: string) {
  if (username === "root@pam") return true;
  try {
    const perms = await call("GET", "/access/permissions", { path: "/" });
    return !!perms?.["/"]?.["Sys.Modify"];
  } catch {
    return false;
  }
}

// ── Informations publiques ──────────────────────────────────────────
api.get("/status", wrap(async (req) => {
  const c = getConfig();
  return { setupDone: c.setupDone, demo: DEMO, version: version(), clientIp: clientIp(req), defaultUrl: "https://10.0.1.101:8006", registration: c.registration };
}));

// Domaines d'authentification (pam, pve, ldap...) pour la page de connexion
api.get("/realms", wrap(async () => {
  const c = getConfig();
  if (!c.pve && !DEMO) return [];
  if (DEMO) return [{ realm: "pve", comment: "Proxmox VE", default: 1 }, { realm: "pam", comment: "Linux PAM" }];
  return request({ url: c.pve!.url, insecureTls: c.pve!.insecureTls }, "GET", "/access/domains", {});
}));

// ── Onboarding (bloqué une fois terminé) ────────────────────────────
api.post("/setup/test", wrap(async (req) => {
  if (getConfig().setupDone) throw bad("MyProxmox est déjà configuré.", 403);
  const url = normalizeUrl(req.body.url);
  const realms = await request({ url, insecureTls: !!req.body.insecureTls }, "GET", "/access/domains", {});
  return { url, realms };
}));

api.post("/setup/finish", wrap(async (req, res) => {
  if (getConfig().setupDone) throw bad("MyProxmox est déjà configuré.", 403);
  const { username, password, otp, insecureTls } = req.body;
  const url = normalizeUrl(req.body.url);
  const ranges: string[] = (req.body.allowedRanges ?? PRIVATE_RANGES).map((r: string) => r.trim()).filter(Boolean);
  const invalid = ranges.filter((r) => !validCidr(r));
  if (invalid.length) throw bad(`Plage(s) invalide(s) : ${invalid.join(", ")}`);
  const ip = clientIp(req);
  const target = { url, insecureTls: !!insecureTls };

  const auth = await login(target, username, password, otp);
  if ("needOtp" in auth) return { needOtp: true };
  const call = ticketCall(auth.ticket, auth.csrf, target);
  const admin = await isAdmin(call, auth.username);
  if (!admin) throw bad("Ce compte n'a pas le droit Sys.Modify sur « / ». Connecte-toi avec root@pam ou un administrateur pour la première configuration.", 403);
  let token;
  try {
    token = await createServiceToken(call);
  } catch (e) {
    throw bad(`Impossible de créer le compte de service : ${(e as Error).message}. Il faut le droit de gérer les permissions (root@pam conseillé).`, 403);
  }
  await saveConfig({ setupDone: true, pve: { url, insecureTls: !!insecureTls, ...token }, allowedRanges: ranges });
  await logActivity({ actor: auth.username, action: "configuration initiale", target: url, result: "ok", detail: `accès depuis ${ip}` });
  const s = createSession({ kind: "proxmox", username: auth.username, ticket: auth.ticket, csrf: auth.csrf, admin });
  setCookie(res, s.id);
  setTimeout(runOnce, 1000);
  return { done: true };
}));

// ── Connexion avec les identifiants Proxmox ─────────────────────────
api.post("/auth/login", wrap(async (req, res) => {
  const c = getConfig();
  if (!c.setupDone) throw bad("Termine d'abord la configuration.", 409);
  const { username, realm, password, otp } = req.body as Record<string, string>;
  if (!username || !password) throw bad("Utilisateur et mot de passe requis.");
  const full = username.includes("@") ? username : `${username}@${realm || "pam"}`;
  try {
    const auth = await login({ url: c.pve?.url ?? "", insecureTls: !!c.pve?.insecureTls }, full, password, otp);
    if ("needOtp" in auth) return { needOtp: true };
    const call = ticketCall(auth.ticket, auth.csrf);
    const admin = DEMO ? true : await isAdmin(call, auth.username);
    const s = createSession({ kind: "proxmox", username: auth.username, ticket: auth.ticket, csrf: auth.csrf, admin });
    setCookie(res, s.id);
    await logActivity({ actor: auth.username, action: "connexion", target: clientIp(req), result: "ok" });
    return { username: auth.username, admin };
  } catch (e) {
    await logActivity({ actor: full, action: "connexion", target: clientIp(req), result: "refusé", detail: (e as Error).message });
    await new Promise((r) => setTimeout(r, 700)); // ralentit les essais en rafale
    if ((e as PveError).status === 401) throw bad(otp ? "Code de double authentification incorrect." : "Identifiant ou mot de passe incorrect.", 401);
    throw e;
  }
}));

api.post("/auth/logout", wrap(async (req, res) => {
  const s = await getSession(req);
  destroySession(s?.id);
  clearCookie(res);
  return { done: true };
}));

api.get("/auth/me", requireSession, wrap(async (req): Promise<Me> => {
  const s = req.session!;
  if (s.kind === "local") {
    const u = await getUser(s.userId!);
    return { username: s.username, displayName: s.displayName, admin: false, demo: DEMO, kind: "local", role: s.role, readOnly: true, totp: !!u?.totpEnabled };
  }
  return { username: s.username, admin: s.admin, demo: DEMO, kind: "proxmox", readOnly: false };
}));

// ── Comptes MyProxmox : connexion et inscription ────────────────────
const LOCKED = "Trop d'essais depuis ton adresse. Attends une minute puis réessaie.";

api.post("/auth/local/login", wrap(async (req, res) => {
  const c = getConfig();
  if (!c.setupDone) throw bad("Termine d'abord la configuration.", 409);
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) throw bad(LOCKED, 429);
  const { username = "", password = "", otp } = req.body as Record<string, string>;
  const fail = async (detail: string, msg = "Identifiant ou mot de passe incorrect.") => {
    recordAttempt(ip); // seuls les échecs comptent dans la limite de 5 par minute
    await logActivity({ actor: `local:${String(username).slice(0, 40)}`, action: "connexion (compte MyProxmox)", target: ip, result: "refusé", detail });
    await new Promise((r) => setTimeout(r, 500));
    return bad(msg, 401);
  };
  const u = await verifyPassword(String(username), String(password));
  if (!u) throw await fail("mauvais identifiants");
  if (u.status === "pending") throw await fail("compte en attente", "Ton compte attend la validation d'un administrateur.");
  if (u.status === "disabled") throw await fail("compte désactivé", "Ce compte est désactivé. Contacte un administrateur.");
  if (u.totpEnabled) {
    if (!otp) return { needOtp: true };
    if (!verifyTotp(u.totpSecret!, otp)) throw await fail("code 2FA faux", "Code de double authentification incorrect.");
  }
  await updateUser(u.id, { lastLogin: new Date().toISOString() });
  const s = createSession({ kind: "local", username: u.username, displayName: u.displayName, ticket: "", csrf: "", admin: false, role: u.role, userId: u.id });
  setCookie(res, s.id);
  await logActivity({ actor: `local:${u.username}`, action: "connexion (compte MyProxmox)", target: ip, result: "ok", detail: `rôle ${u.role}` });
  return { username: u.username, role: u.role };
}));

api.post("/auth/local/register", wrap(async (req) => {
  const c = getConfig();
  if (!c.setupDone || c.registration === "off") throw bad("L'inscription est fermée. Demande un compte à un administrateur.", 403);
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) throw bad(LOCKED, 429);
  recordAttempt(ip);
  const { username = "", displayName = "", password = "" } = req.body as Record<string, string>;
  const status = c.registration === "open" ? "active" : "pending";
  const u = await createUser({ username, displayName, password, role: "monitoring", status });
  await logActivity({ actor: `local:${u.username}`, action: "inscription (compte MyProxmox)", target: ip, result: "ok", detail: status === "pending" ? "en attente de validation" : "ouverte" });
  if (status === "pending") {
    const n = {
      id: randomUUID(), at: new Date().toISOString(), level: "info" as const, key: `register:${u.id}`,
      title: "Inscription à valider", message: `${u.displayName} (${u.username}) demande un compte MyProxmox. Valide-le dans Paramètres > Comptes MyProxmox.`,
    };
    await addNotification(n);
    broadcast("notification", n);
  }
  return { status };
}));

// ── Écran de monitoring : clé en lecture seule OU session ───────────
async function monitoringAccess(req: Request) {
  const c = getConfig();
  if (!c.modules.monitoring) throw bad("Module monitoring désactivé.", 404);
  const key = String(req.query.key ?? "");
  if (key) {
    if (!c.monitoringKeyHash || !sameHash(key, c.monitoringKeyHash)) throw bad("Clé de monitoring invalide.", 401);
    return { call: serviceCall(), id: "service", admin: false };
  }
  const s = await getSession(req);
  if (!s) throw bad("Clé de monitoring manquante.", 401);
  // Les comptes MyProxmox et le lien secret partagent le cache du jeton de service
  if (s.kind === "local") return { call: serviceCall(), id: "service", admin: false };
  return { call: ticketCall(s.ticket, s.csrf), id: `pve:${s.username}`, admin: s.admin };
}

api.get("/monitoring", wrap(async (req) => {
  const { call, id } = await monitoringAccess(req);
  const snap = await monitoring(call, id, getActivity().slice(0, 40));
  return { ...snap, alerts: getConfig().modules.alerts ? activeAlerts() : [] };
}));

// Dispositions nommées du mode « mur » (lecture pour tout écran autorisé)
api.get("/monitoring/layouts", wrap(async (req) => {
  const { admin } = await monitoringAccess(req);
  return { layouts: getLayouts(), canEdit: admin };
}));
api.put("/monitoring-layouts/:name", requireSession, requireAdmin, wrap(async (req) => {
  const layout = await saveLayout(String(req.params.name), req.body ?? {});
  await logActivity({ actor: req.session!.username, action: "disposition de monitoring enregistrée", target: layout.name, result: "ok" });
  return { layouts: getLayouts() };
}));
api.delete("/monitoring-layouts/:name", requireSession, requireAdmin, wrap(async (req) => {
  await deleteLayout(String(req.params.name));
  return { layouts: getLayouts() };
}));

// ── Tout ce qui suit demande d'être connecté ────────────────────────
api.use(requireSession);
// Comptes MyProxmox : seulement ce que leur rôle permet
api.use(localGuard);

// Double authentification et mot de passe des comptes MyProxmox (pour soi-même)
const localSelf = async (req: Request) => {
  if (req.session!.kind !== "local") throw bad("Réservé aux comptes MyProxmox. Pour un compte Proxmox, règle la 2FA dans Proxmox.", 400);
  const u = await getUser(req.session!.userId!);
  if (!u) throw bad("Compte introuvable.", 404);
  return u;
};
api.post("/auth/local/totp/setup", wrap(async (req) => {
  const u = await localSelf(req);
  if (u.totpEnabled) throw bad("La double authentification est déjà active.");
  const secret = newTotpSecret();
  await updateUser(u.id, { totpSecret: secret, totpEnabled: false });
  return { secret, uri: otpauthUri(secret, u.username) };
}));
api.post("/auth/local/totp/enable", wrap(async (req) => {
  const u = await localSelf(req);
  if (!u.totpSecret || !verifyTotp(u.totpSecret, String(req.body.code ?? ""))) throw bad("Code incorrect. Vérifie l'heure de ton téléphone et réessaie.");
  await updateUser(u.id, { totpEnabled: true });
  await logActivity({ actor: `local:${u.username}`, action: "2FA activée", target: "-", result: "ok" });
  return { done: true };
}));
api.post("/auth/local/totp/disable", wrap(async (req) => {
  const u = await localSelf(req);
  if (u.totpEnabled && !verifyTotp(u.totpSecret!, String(req.body.code ?? ""))) throw bad("Code incorrect.");
  await updateUser(u.id, { totpEnabled: false, totpSecret: undefined });
  await logActivity({ actor: `local:${u.username}`, action: "2FA désactivée", target: "-", result: "ok" });
  return { done: true };
}));
api.post("/auth/local/password", wrap(async (req) => {
  const u = await localSelf(req);
  if (!(await verifyPassword(u.username, String(req.body.current ?? "")))) throw bad("Mot de passe actuel incorrect.", 401);
  await setPassword(u.id, String(req.body.password ?? ""));
  await logActivity({ actor: `local:${u.username}`, action: "mot de passe changé", target: "-", result: "ok" });
  return { done: true };
}));

// Passerelle vers l'API Proxmox, avec les droits de la personne connectée
api.all(/^\/pve\/(.+)$/, wrap(async (req) => {
  const pvePath = "/" + String(req.params[0]).split("/").map((s) => encodeURIComponent(decodeURIComponent(s))).join("/");
  const method = req.method as "GET" | "POST" | "PUT" | "DELETE";
  if (!["GET", "POST", "PUT", "DELETE"].includes(method)) throw bad("Méthode non gérée", 405);
  const params = method === "GET" || method === "DELETE" ? (req.query as Record<string, unknown>) : req.body ?? {};
  try {
    let data = await req.call!(method, pvePath, params);
    // Un compte MyProxmox lit avec le jeton de service : on ne lui montre que les droits de lecture
    if (req.session!.kind === "local" && pvePath === "/access/permissions") data = readOnlyPermissions(data);
    if (method !== "GET") await logActivity({ actor: req.session!.username, action: `${method} ${pvePath.replace(/^\/nodes\/[^/]+/, "")}`, target: pvePath, result: "ok" });
    return data;
  } catch (e) {
    if (method !== "GET") await logActivity({ actor: req.session!.username, action: `${method} ${pvePath.replace(/^\/nodes\/[^/]+/, "")}`, target: pvePath, result: "erreur", detail: (e as Error).message });
    throw e;
  }
}));

// Téléchargement brut (restauration de fichiers depuis PBS), avec les droits Proxmox de la personne
api.get(/^\/pve-raw\/(.+)$/, async (req, res) => {
  try {
    if (req.session!.kind !== "proxmox") throw bad("Réservé aux comptes Proxmox.", 403);
    const pvePath = "/" + String(req.params[0]).split("/").map((x) => encodeURIComponent(decodeURIComponent(x))).join("/");
    if (!/\/file-restore\/download$/.test(pvePath)) throw bad("Téléchargement non autorisé pour ce chemin.", 400);
    const params = req.query as Record<string, unknown>;
    const r = await ticketDownload(req.session!.ticket, pvePath, params);
    const name = String(Buffer.from(String(params.filepath ?? ""), "base64").toString()).split("/").pop() || "fichier";
    const file = Number(params.tar) ? `${name}.tar.zst` : name;
    res.setHeader("Content-Disposition", `attachment; filename="${file.replace(/[^\w.-]/g, "_")}"`);
    await logActivity({ actor: req.session!.username, action: "fichier restauré depuis une sauvegarde", target: String(params.volume ?? ""), result: "ok", detail: name });
    if ("demo" in r) return void res.type("text/plain").send(r.demo);
    res.setHeader("Content-Type", r.stream.headers["content-type"] ?? "application/octet-stream");
    r.stream.pipe(res);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    res.status(status).json({ error: (e as Error).message });
  }
});

// Téléversement d'ISO, de modèles et de snippets : relayé en flux vers Proxmox
api.post("/upload/:node/:storage", async (req, res) => {
  try {
    if (req.session!.kind !== "proxmox") throw bad("Réservé aux comptes Proxmox.", 403);
    const type = String(req.headers["content-type"] ?? "");
    if (!type.startsWith("multipart/form-data")) throw bad("Envoi attendu au format multipart/form-data.", 400);
    const { node, storage } = req.params as Record<string, string>;
    const upid = await ticketUpload(req.session!.ticket, req.session!.csrf, node, storage, type, req.headers["content-length"] as string | undefined, req);
    await logActivity({ actor: req.session!.username, action: "fichier téléversé", target: `${node}/${storage}`, result: "ok" });
    res.json({ data: upid });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (!res.headersSent) res.status(status).json({ error: (e as Error).message });
  }
});

// Informations calculées (avec les droits de la personne connectée)
api.get("/insights/overview", wrap((req) => overview(req.call!)));
api.get("/insights/inventory", wrap((req) => inventory(req.call!)));
api.get("/insights/backups", wrap((req) => backupStatus(req.call!, getConfig().rules.backupMaxDays)));
api.get("/insights/storage", wrap((req) => storageInsights(req.call!)));
api.get("/insights/security", wrap((req) => security(req.call!)));
api.get("/insights/server/:node", wrap((req) => serverHealth(req.call!, String(req.params.node))));

// Alertes et notifications
api.get("/alerts", wrap(async () => ({ alerts: activeAlerts(), engine: engineStatus() })));
api.get("/notifications", wrap(async () => getNotifications().slice(0, 200)));
api.post("/notifications/read", wrap(async (req) => {
  await markRead(req.body.ids ?? "all");
  return { done: true };
}));
api.delete("/notifications", requireAdmin, wrap(async () => {
  await clearNotifications();
  return { done: true };
}));
api.get("/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(`event: hello\ndata: {}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  res.on("close", () => clearInterval(ping));
  addStream(res);
});

api.get("/activity", wrap(async (req) => {
  const actor = String(req.query.actor ?? "");
  const list = getActivity();
  return (actor === "mcp" ? list.filter((a) => a.actor.startsWith("mcp:")) : actor ? list.filter((a) => a.actor === actor) : list).slice(0, 300);
}));

// ── Réglages (administrateurs) ──────────────────────────────────────
function publicSettings(req: Request): PublicSettings {
  const c = getConfig();
  return {
    pveUrl: c.pve?.url ?? (DEMO ? "https://10.0.1.101:8006" : ""),
    insecureTls: c.pve?.insecureTls ?? true,
    allowedRanges: c.allowedRanges,
    modules: c.modules,
    rules: c.rules,
    channels: c.channels.map((ch) => ({ ...ch, token: ch.token ? "••••••" : "" })),
    mcpKeys: c.mcpKeys.map(({ hash, ...k }) => k),
    hasMonitoringKey: !!c.monitoringKeyHash,
    serviceToken: c.pve?.tokenId ?? "",
    version: version(),
    appUrl: `${req.protocol}://${req.headers.host}`,
    bridgePath: path.join(ROOT, "bridge", "dist", "myproxmox-mcp.cjs"),
    clientIp: clientIp(req),
    registration: c.registration,
  };
}

api.get("/settings", wrap(async (req) => publicSettings(req)));

api.put("/settings", requireAdmin, wrap(async (req) => {
  const c = getConfig();
  const b = req.body ?? {};
  const patch: Partial<typeof c> = {};
  if (b.allowedRanges) {
    const ranges = (b.allowedRanges as string[]).map((r) => r.trim()).filter(Boolean);
    const invalid = ranges.filter((r) => !validCidr(r));
    if (invalid.length) throw bad(`Plage(s) invalide(s) : ${invalid.join(", ")}`);
    if (!ranges.length) throw bad("Garde au moins une plage, sinon plus personne ne pourra ouvrir l'app (à part ce PC).");
    patch.allowedRanges = ranges;
  }
  if (b.modules) patch.modules = { ...c.modules, ...b.modules };
  if (b.registration !== undefined) {
    if (!["off", "approval", "open"].includes(b.registration)) throw bad("Mode d'inscription inconnu.");
    patch.registration = b.registration as RegistrationMode;
  }
  if (b.rules) patch.rules = { ...c.rules, ...b.rules };
  if (b.pve) {
    const url = normalizeUrl(b.pve.url);
    await request({ url, insecureTls: !!b.pve.insecureTls }, "GET", "/access/domains", {});
    patch.pve = { ...c.pve!, url, insecureTls: !!b.pve.insecureTls };
  }
  await saveConfig(patch);
  await logActivity({ actor: req.session!.username, action: "réglages modifiés", target: Object.keys(patch).join(", "), result: "ok" });
  return publicSettings(req);
}));

// Recrée le jeton de service avec le compte connecté (si le jeton a été supprimé dans Proxmox)
api.post("/settings/service-token", requireAdmin, wrap(async (req) => {
  const token = await createServiceToken(req.call!);
  await saveConfig({ pve: { ...getConfig().pve!, ...token } });
  return publicSettings(req);
}));

// Canaux de notification
api.post("/settings/channels", requireAdmin, wrap(async (req) => {
  const b = req.body as Partial<Channel>;
  if (!b.url || !/^https?:\/\//.test(b.url)) throw bad("Adresse du canal invalide (elle doit commencer par https://).");
  if (!["discord", "ntfy", "webhook"].includes(String(b.type))) throw bad("Type de canal inconnu.");
  const c = getConfig();
  const existing = b.id ? c.channels.find((x) => x.id === b.id) : undefined;
  const ch: Channel = {
    id: existing?.id ?? randomUUID(), type: b.type as Channel["type"], name: b.name || b.type!, url: b.url,
    token: b.token === "••••••" ? existing?.token : b.token || undefined, minLevel: b.minLevel ?? "warning", enabled: b.enabled ?? true,
  };
  await saveConfig({ channels: existing ? c.channels.map((x) => (x.id === ch.id ? ch : x)) : [...c.channels, ch] });
  return publicSettings(req);
}));
api.delete("/settings/channels/:id", requireAdmin, wrap(async (req) => {
  await saveConfig({ channels: getConfig().channels.filter((x) => x.id !== req.params.id) });
  return publicSettings(req);
}));
api.post("/settings/channels/:id/test", requireAdmin, wrap(async (req) => {
  const ch = getConfig().channels.find((x) => x.id === req.params.id);
  if (!ch) throw bad("Canal introuvable.", 404);
  await send(ch, { id: randomUUID(), at: new Date().toISOString(), level: "warning", title: "Test de notification", message: `Envoyé depuis MyProxmox par ${req.session!.username}. Si tu lis ce message, ce canal fonctionne.` });
  return { done: true };
}));

// Clé de l'écran de monitoring (affichée une seule fois)
api.post("/settings/monitoring-key", requireAdmin, wrap(async (req) => {
  const key = newSecret(18);
  await saveConfig({ monitoringKeyHash: sha256(key) });
  await logActivity({ actor: req.session!.username, action: "nouvelle clé de monitoring", target: "-", result: "ok" });
  return { key };
}));
api.delete("/settings/monitoring-key", requireAdmin, wrap(async (req) => {
  await saveConfig({ monitoringKeyHash: null });
  return publicSettings(req);
}));

// Clés MCP (la clé complète n'est affichée qu'une fois)
api.post("/settings/mcp-keys", requireAdmin, wrap(async (req) => {
  const name = String(req.body.name ?? "").trim().slice(0, 40) || "Claude";
  const level: McpLevel = req.body.level === "actions" ? "actions" : "read";
  const key = `mpx_${newSecret(24)}`;
  const c = getConfig();
  await saveConfig({ mcpKeys: [...c.mcpKeys, { id: randomUUID(), name, level, hash: sha256(key), prefix: key.slice(0, 10), createdAt: new Date().toISOString() }] });
  await logActivity({ actor: req.session!.username, action: "nouvelle clé MCP", target: `${name} (${level})`, result: "ok" });
  return { key, settings: publicSettings(req) };
}));
api.put("/settings/mcp-keys/:id", requireAdmin, wrap(async (req) => {
  const level: McpLevel = req.body.level === "actions" ? "actions" : "read";
  await saveConfig({ mcpKeys: getConfig().mcpKeys.map((k) => (k.id === req.params.id ? { ...k, level } : k)) });
  return publicSettings(req);
}));
api.delete("/settings/mcp-keys/:id", requireAdmin, wrap(async (req) => {
  const k = getConfig().mcpKeys.find((x) => x.id === req.params.id);
  await saveConfig({ mcpKeys: getConfig().mcpKeys.filter((x) => x.id !== req.params.id) });
  await logActivity({ actor: req.session!.username, action: "clé MCP révoquée", target: k?.name ?? "?", result: "ok" });
  return publicSettings(req);
}));

api.post("/settings/reset", requireAdmin, wrap(async (req) => {
  if (req.body.confirm !== "RESET") throw bad("Confirmation manquante.");
  await saveConfig({ setupDone: false, pve: null, mcpKeys: [], monitoringKeyHash: null });
  return { done: true };
}));

// ── Comptes MyProxmox (administrateurs) ─────────────────────────────
api.get("/local-users", requireAdmin, wrap(async () => (await getUsers()).map(publicUser)));

api.post("/local-users", requireAdmin, wrap(async (req) => {
  const { username = "", displayName = "", password = "", role = "monitoring" } = req.body ?? {};
  if (!isRole(role)) throw bad("Rôle inconnu.");
  const u = await createUser({ username, displayName, password, role, status: "active" });
  await logActivity({ actor: req.session!.username, action: "compte MyProxmox créé", target: u.username, result: "ok", detail: `rôle ${role}` });
  return publicUser(u);
}));

api.put("/local-users/:id", requireAdmin, wrap(async (req) => {
  const b = req.body ?? {};
  const patch: Parameters<typeof updateUser>[1] = {};
  if (b.displayName !== undefined) patch.displayName = String(b.displayName);
  if (b.role !== undefined) {
    if (!isRole(b.role)) throw bad("Rôle inconnu.");
    patch.role = b.role;
  }
  if (b.status !== undefined) {
    if (!["active", "disabled"].includes(b.status)) throw bad("Statut inconnu.");
    patch.status = b.status;
  }
  const u = await updateUser(String(req.params.id), patch);
  if (patch.role || patch.status === "disabled") destroyUserSessions(u.id); // reconnexion avec les nouveaux droits
  await logActivity({ actor: req.session!.username, action: "compte MyProxmox modifié", target: u.username, result: "ok", detail: Object.keys(patch).join(", ") });
  return publicUser(u);
}));

api.post("/local-users/:id/approve", requireAdmin, wrap(async (req) => {
  const u = await updateUser(String(req.params.id), { status: "active" });
  await logActivity({ actor: req.session!.username, action: "inscription validée", target: u.username, result: "ok" });
  return publicUser(u);
}));

api.post("/local-users/:id/password", requireAdmin, wrap(async (req) => {
  const u = await getUser(String(req.params.id));
  if (!u) throw bad("Compte introuvable.", 404);
  const password = String(req.body.password ?? "");
  const pb = checkPassword(password, u.username);
  if (pb) throw bad(pb);
  await setPassword(u.id, password);
  await updateUser(u.id, { totpEnabled: false, totpSecret: undefined }); // la personne refait sa 2FA
  destroyUserSessions(u.id);
  await logActivity({ actor: req.session!.username, action: "mot de passe réinitialisé", target: u.username, result: "ok" });
  return publicUser((await getUser(u.id))!);
}));

api.delete("/local-users/:id", requireAdmin, wrap(async (req) => {
  const u = await getUser(String(req.params.id));
  if (!u) throw bad("Compte introuvable.", 404);
  await deleteUser(u.id);
  destroyUserSessions(u.id);
  await logActivity({ actor: req.session!.username, action: "compte MyProxmox supprimé", target: u.username, result: "ok" });
  return { done: true };
}));

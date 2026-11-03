// Toutes les routes /api de MyProxmox.
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DEMO, PRIVATE_RANGES, ROOT, clearNotifications, getActivity, getConfig, getNotifications, logActivity,
  markRead, newSecret, saveConfig, sameHash, sha256, version,
} from "./config";
import { PveError, createServiceToken, login, serviceCall, ticketCall } from "./pve";
import { request } from "./http";
import { clientIp, validCidr } from "./ipfilter";
import { addStream, clearCookie, createSession, destroySession, getSession, requireAdmin, requireSession, setCookie } from "./sessions";
import { activeAlerts, engineStatus, runOnce } from "./engine";
import { send } from "./notify";
import { backupStatus, inventory, monitoringSnapshot, overview, security, serverHealth, storageInsights } from "../../shared/insights";
import type { Channel, McpLevel, PublicSettings } from "../../shared/types";

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
  return { setupDone: c.setupDone, demo: DEMO, version: version(), clientIp: clientIp(req), defaultUrl: "https://10.0.1.101:8006" };
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
  const s = createSession({ username: auth.username, ticket: auth.ticket, csrf: auth.csrf, admin });
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
    const s = createSession({ username: auth.username, ticket: auth.ticket, csrf: auth.csrf, admin });
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

api.get("/auth/me", requireSession, wrap(async (req) => ({ username: req.session!.username, admin: req.session!.admin, demo: DEMO })));

// ── Écran de monitoring : clé en lecture seule OU session ───────────
api.get("/monitoring", wrap(async (req) => {
  const c = getConfig();
  if (!c.modules.monitoring) throw bad("Module monitoring désactivé.", 404);
  const key = String(req.query.key ?? "");
  let call;
  if (key) {
    if (!c.monitoringKeyHash || !sameHash(key, c.monitoringKeyHash)) throw bad("Clé de monitoring invalide.", 401);
    call = serviceCall();
  } else {
    const s = await getSession(req);
    if (!s) throw bad("Clé de monitoring manquante.", 401);
    call = ticketCall(s.ticket, s.csrf);
  }
  const snap = await monitoringSnapshot(call);
  return { ...snap, alerts: c.modules.alerts ? activeAlerts() : [] };
}));

// ── Tout ce qui suit demande d'être connecté ────────────────────────
api.use(requireSession);

// Passerelle vers l'API Proxmox, avec les droits de la personne connectée
api.all(/^\/pve\/(.+)$/, wrap(async (req) => {
  const pvePath = "/" + String(req.params[0]).split("/").map((s) => encodeURIComponent(decodeURIComponent(s))).join("/");
  const method = req.method as "GET" | "POST" | "PUT" | "DELETE";
  if (!["GET", "POST", "PUT", "DELETE"].includes(method)) throw bad("Méthode non gérée", 405);
  const params = method === "GET" || method === "DELETE" ? (req.query as Record<string, unknown>) : req.body ?? {};
  try {
    const data = await req.call!(method, pvePath, params);
    if (method !== "GET") await logActivity({ actor: req.session!.username, action: `${method} ${pvePath.replace(/^\/nodes\/[^/]+/, "")}`, target: pvePath, result: "ok" });
    return data;
  } catch (e) {
    if (method !== "GET") await logActivity({ actor: req.session!.username, action: `${method} ${pvePath.replace(/^\/nodes\/[^/]+/, "")}`, target: pvePath, result: "erreur", detail: (e as Error).message });
    throw e;
  }
}));

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

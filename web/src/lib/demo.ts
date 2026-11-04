// « Serveur » de démonstration qui tourne dans le navigateur (version Vercel).
// Il répond aux mêmes routes que le vrai serveur, avec le faux Proxmox partagé.
import { mockRequest } from "../../../shared/mock";
import { backupStatus, inventory, monitoringSnapshot, overview, security, serverHealth, storageInsights } from "../../../shared/insights";
import { collect, evaluate } from "../../../shared/alerts";
import { DEFAULT_MODULES, DEFAULT_RULES, type Alert, type Call, type LocalRole, type LocalUserInfo, type Me, type Notification, type PublicSettings } from "../../../shared/types";

const call: Call = async (method, path, params) => {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 120)); // petite latence réaliste
  try {
    return mockRequest(method, path, params as Record<string, unknown>);
  } catch (e) {
    throw Object.assign(new Error((e as Error).message), { status: (e as { status?: number }).status ?? 500 });
  }
};

// Session de démo : "1" = compte Proxmox, "local:<id>" = compte MyProxmox
let loggedIn = (sessionStorageGet("demo-login") ?? "0") !== "0";
let localId: string | null = sessionStorageGet("demo-login")?.startsWith("local:") ? sessionStorageGet("demo-login")!.slice(6) : null;

// Comptes MyProxmox fictifs. Mot de passe de tous : « demo-monitoring »
const DEMO_PASSWORD = "demo-monitoring";
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const localUsers: (LocalUserInfo & { password: string })[] = [
  { id: "u1", username: "tv-salon", displayName: "TV du salon", role: "monitoring", status: "active", createdAt: daysAgo(20), lastLogin: daysAgo(0.1), totp: false, password: DEMO_PASSWORD },
  { id: "u2", username: "lea", displayName: "Léa (lecture)", role: "lecture", status: "active", createdAt: daysAgo(12), lastLogin: daysAgo(2), totp: false, password: DEMO_PASSWORD },
  { id: "u3", username: "stagiaire", displayName: "Stagiaire", role: "monitoring", status: "pending", createdAt: daysAgo(1), totp: false, password: DEMO_PASSWORD },
  { id: "u4", username: "ancien-ecran", displayName: "Ancien écran", role: "monitoring", status: "disabled", createdAt: daysAgo(90), totp: false, password: DEMO_PASSWORD },
];
const pub = ({ password, ...u }: (typeof localUsers)[number]): LocalUserInfo => u;
const findLocal = (id: string) => localUsers.find((u) => u.id === id) ?? fail(404, "Compte introuvable.");
let alerts: (Alert & { since: string })[] = [];
const notifications: Notification[] = [];
const activity: any[] = [];
const settings: PublicSettings = {
  pveUrl: "https://10.0.1.101:8006",
  insecureTls: true,
  allowedRanges: ["127.0.0.1/32", "10.0.1.0/24"],
  modules: { ...DEFAULT_MODULES },
  rules: { ...DEFAULT_RULES },
  channels: [{ id: "c1", type: "discord", name: "Discord #homelab", url: "https://discord.com/api/webhooks/...", minLevel: "warning", enabled: true }],
  mcpKeys: [{ id: "k1", name: "Claude Desktop", level: "read", createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), lastUsed: new Date(Date.now() - 3600000).toISOString(), prefix: "mpx_d3m0xx" }],
  hasMonitoringKey: true,
  serviceToken: "myproxmox@pve!service",
  version: "1.0.0 (démo)",
  appUrl: "http://10.0.1.20:8080",
  bridgePath: "C:\\MyProxmox\\bridge\\dist\\myproxmox-mcp.cjs",
  clientIp: "10.0.1.42",
  registration: "approval",
};

function sessionStorageGet(k: string) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionStorageSet(k: string, v: string) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* navigation privée */
  }
}

async function refreshAlerts() {
  const input = await collect(call, true);
  const next = evaluate(input, settings.rules);
  for (const a of next) {
    if (!alerts.some((x) => x.key === a.key)) {
      notifications.unshift({ id: Math.random().toString(36).slice(2), at: new Date(Date.now() - Math.random() * 7200000).toISOString(), level: a.level, title: a.title, message: a.message, key: a.key });
    }
  }
  alerts = next.map((a) => ({ ...a, since: alerts.find((x) => x.key === a.key)?.since ?? new Date(Date.now() - 3600000).toISOString() }));
}
let alertsReady: Promise<void> | null = null;
const ensureAlerts = () => (alertsReady ??= refreshAlerts());

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

export async function demoApi(method: string, url: string, body: any = {}, query: Record<string, any> = {}): Promise<any> {
  const path = url.replace(/^\/api/, "");
  if (path === "/status") return { setupDone: true, demo: true, version: settings.version, clientIp: settings.clientIp, defaultUrl: settings.pveUrl, registration: settings.registration };
  if (path === "/realms") return [{ realm: "pam", comment: "Linux PAM" }, { realm: "pve", comment: "Proxmox VE", default: 1 }];
  if (path === "/auth/login") {
    loggedIn = true;
    localId = null;
    sessionStorageSet("demo-login", "1");
    return { username: `${body.username || "demo"}@${body.realm || "pam"}`, admin: true };
  }
  if (path === "/auth/logout") {
    loggedIn = false;
    localId = null;
    sessionStorageSet("demo-login", "0");
    return { done: true };
  }
  if (path === "/auth/local/login") {
    const u = localUsers.find((x) => x.username === String(body.username ?? "").toLowerCase().trim());
    if (!u || u.password !== body.password) fail(401, `Identifiant ou mot de passe incorrect. Dans la démo, essaie « tv-salon » et « ${DEMO_PASSWORD} ».`);
    if (u!.status === "pending") fail(401, "Ton compte attend la validation d'un administrateur.");
    if (u!.status === "disabled") fail(401, "Ce compte est désactivé. Contacte un administrateur.");
    if (u!.totp && !body.otp) return { needOtp: true };
    u!.lastLogin = new Date().toISOString();
    loggedIn = true;
    localId = u!.id;
    sessionStorageSet("demo-login", `local:${u!.id}`);
    return { username: u!.username, role: u!.role };
  }
  if (path === "/auth/local/register") {
    if (settings.registration === "off") fail(403, "L'inscription est fermée. Demande un compte à un administrateur.");
    const username = String(body.username ?? "").toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(username)) fail(400, "Identifiant : 2 à 32 caractères, minuscules, chiffres, point, tiret ou soulignement.");
    if (String(body.password ?? "").length < 10) fail(400, "Le mot de passe doit faire au moins 10 caractères.");
    if (localUsers.some((x) => x.username === username)) fail(409, "Cet identifiant est déjà pris. Choisis-en un autre.");
    const status = settings.registration === "open" ? "active" : "pending";
    localUsers.push({ id: Math.random().toString(36).slice(2), username, displayName: body.displayName || username, role: "monitoring", status, createdAt: new Date().toISOString(), totp: false, password: body.password });
    if (status === "pending") notifications.unshift({ id: Math.random().toString(36).slice(2), at: new Date().toISOString(), level: "info", title: "Inscription à valider", message: `${body.displayName || username} (${username}) demande un compte MyProxmox.` });
    return { status };
  }
  if (path === "/monitoring") {
    await ensureAlerts();
    return { ...(await monitoringSnapshot(call)), alerts };
  }
  if (!loggedIn) fail(401, "Connecte-toi (n'importe quel identifiant fonctionne dans la démo).");
  const local = localId ? localUsers.find((u) => u.id === localId) : undefined;
  if (path === "/auth/me") {
    const me: Me = local
      ? { username: local.username, displayName: local.displayName, admin: false, demo: true, kind: "local", role: local.role as LocalRole, readOnly: true, totp: local.totp }
      : { username: "demo@pam", admin: true, demo: true, kind: "proxmox", readOnly: false };
    return me;
  }
  // Mêmes règles que le serveur pour les comptes MyProxmox
  if (local) {
    const self = /^\/auth\/local\/(totp|password)/.test(path);
    if (local.role === "monitoring" && !self) fail(403, "Ce compte ne donne accès qu'à l'écran de monitoring.");
    if (local.role === "lecture" && method !== "GET" && !self && path !== "/notifications/read") fail(403, "Ce compte est en lecture seule : demande à un administrateur de faire cette action.");
    if (path === "/auth/local/totp/setup") return { secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/MyProxmox:demo?secret=JBSWY3DPEHPK3PXP&issuer=MyProxmox" };
    if (path === "/auth/local/totp/enable") { local.totp = true; return { done: true }; }
    if (path === "/auth/local/totp/disable") { local.totp = false; return { done: true }; }
    if (path === "/auth/local/password") return { done: true };
  }
  // Comptes MyProxmox : gestion par l'administrateur
  if (local && path.startsWith("/local-users")) fail(403, "Réservé aux comptes Proxmox qui ont le droit Sys.Modify sur « / ».");
  if (path === "/local-users" && method === "GET") return localUsers.map(pub);
  if (path === "/local-users" && method === "POST") {
    const username = String(body.username ?? "").toLowerCase().trim();
    if (!username) fail(400, "Identifiant obligatoire.");
    if (String(body.password ?? "").length < 10) fail(400, "Le mot de passe doit faire au moins 10 caractères.");
    if (localUsers.some((x) => x.username === username)) fail(409, "Cet identifiant est déjà pris. Choisis-en un autre.");
    const u = { id: Math.random().toString(36).slice(2), username, displayName: body.displayName || username, role: body.role ?? "monitoring", status: "active" as const, createdAt: new Date().toISOString(), totp: false, password: body.password };
    localUsers.push(u);
    return pub(u);
  }
  const lu = path.match(/^\/local-users\/([^/]+)(?:\/(approve|password))?$/);
  if (lu) {
    const u = findLocal(lu[1]);
    if (lu[2] === "approve") u.status = "active";
    else if (lu[2] === "password") { u.password = body.password; u.totp = false; }
    else if (method === "DELETE") { localUsers.splice(localUsers.indexOf(u), 1); return { done: true }; }
    else Object.assign(u, { ...(body.displayName !== undefined && { displayName: body.displayName }), ...(body.role && { role: body.role }), ...(body.status && { status: body.status }) });
    return pub(u);
  }

  if (path.startsWith("/pve/")) {
    const pvePath = path.slice(4);
    const params = method === "GET" || method === "DELETE" ? query : body;
    let data = await call(method as any, pvePath, params);
    if (local && pvePath === "/access/permissions") {
      data = Object.fromEntries(Object.entries(data as Record<string, Record<string, number>>).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([p]) => /\.Audit$|^Sys\.Syslog$/.test(p)))]));
    }
    if (method !== "GET") activity.unshift({ at: new Date().toISOString(), actor: "demo@pam", action: `${method} ${pvePath.replace(/^\/nodes\/[^/]+/, "")}`, target: pvePath, result: "ok" });
    return data;
  }
  if (path === "/insights/overview") return overview(call);
  if (path === "/insights/inventory") return inventory(call);
  if (path === "/insights/backups") return backupStatus(call, settings.rules.backupMaxDays);
  if (path === "/insights/storage") return storageInsights(call);
  if (path === "/insights/security") return security(call);
  if (path.startsWith("/insights/server/")) return serverHealth(call, path.split("/").pop()!);
  if (path === "/alerts") {
    await ensureAlerts();
    return { alerts, engine: { lastRun: new Date().toISOString(), lastError: null, active: alerts.length } };
  }
  if (path === "/notifications" && method === "GET") {
    await ensureAlerts();
    return notifications;
  }
  if (path === "/notifications/read") {
    notifications.forEach((n) => (n.read = true));
    return { done: true };
  }
  if (path === "/notifications" && method === "DELETE") {
    notifications.length = 0;
    return { done: true };
  }
  if (path === "/activity") {
    const fake = [
      { at: new Date(Date.now() - 3600000).toISOString(), actor: "mcp:Claude Desktop", action: "etat_general", target: "-", result: "ok" },
      { at: new Date(Date.now() - 3500000).toISOString(), actor: "mcp:Claude Desktop", action: "alimentation_machine", target: "{\"vmid\":102,\"action\":\"reboot\"}", result: "refusé", detail: "clé en lecture seule" },
    ];
    const list = [...activity, ...fake];
    return query.actor === "mcp" ? list.filter((a) => a.actor.startsWith("mcp:")) : list;
  }
  if (path === "/settings" && method === "GET") return settings;
  if (path === "/settings" && method === "PUT") {
    Object.assign(settings, { ...body, modules: { ...settings.modules, ...body.modules }, rules: { ...settings.rules, ...body.rules } });
    if (body.rules) {
      alertsReady = null;
    }
    return settings;
  }
  if (path === "/settings/mcp-keys" && method === "POST") {
    const key = `mpx_demo${Math.random().toString(36).slice(2, 14)}`;
    settings.mcpKeys.push({ id: Math.random().toString(36).slice(2), name: body.name || "Claude", level: body.level, createdAt: new Date().toISOString(), prefix: key.slice(0, 10) });
    return { key, settings };
  }
  if (path.startsWith("/settings/mcp-keys/")) {
    const id = path.split("/").pop();
    if (method === "DELETE") settings.mcpKeys = settings.mcpKeys.filter((k) => k.id !== id);
    else settings.mcpKeys = settings.mcpKeys.map((k) => (k.id === id ? { ...k, level: body.level } : k));
    return settings;
  }
  if (path === "/settings/monitoring-key" && method === "POST") return { key: "demo" };
  if (path === "/settings/channels" && method === "POST") {
    const ch = { id: body.id ?? Math.random().toString(36).slice(2), ...body };
    settings.channels = body.id ? settings.channels.map((c) => (c.id === body.id ? ch : c)) : [...settings.channels, ch];
    return settings;
  }
  if (/^\/settings\/channels\/[^/]+\/test$/.test(path)) return { done: true };
  if (path.startsWith("/settings/channels/") && method === "DELETE") {
    settings.channels = settings.channels.filter((c) => c.id !== path.split("/").pop());
    return settings;
  }
  if (path.startsWith("/settings/")) fail(400, "Non disponible dans la démo.");
  fail(404, `Route inconnue dans la démo : ${path}`);
}

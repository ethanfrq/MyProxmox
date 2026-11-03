// « Serveur » de démonstration qui tourne dans le navigateur (version Vercel).
// Il répond aux mêmes routes que le vrai serveur, avec le faux Proxmox partagé.
import { mockRequest } from "../../../shared/mock";
import { backupStatus, inventory, monitoringSnapshot, overview, security, serverHealth, storageInsights } from "../../../shared/insights";
import { collect, evaluate } from "../../../shared/alerts";
import { DEFAULT_MODULES, DEFAULT_RULES, type Alert, type Call, type Notification, type PublicSettings } from "../../../shared/types";

const call: Call = async (method, path, params) => {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 120)); // petite latence réaliste
  try {
    return mockRequest(method, path, params as Record<string, unknown>);
  } catch (e) {
    throw Object.assign(new Error((e as Error).message), { status: (e as { status?: number }).status ?? 500 });
  }
};

let loggedIn = sessionStorageGet("demo-login") === "1";
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
  if (path === "/status") return { setupDone: true, demo: true, version: settings.version, clientIp: settings.clientIp, defaultUrl: settings.pveUrl };
  if (path === "/realms") return [{ realm: "pam", comment: "Linux PAM" }, { realm: "pve", comment: "Proxmox VE", default: 1 }];
  if (path === "/auth/login") {
    loggedIn = true;
    sessionStorageSet("demo-login", "1");
    return { username: `${body.username || "demo"}@${body.realm || "pam"}`, admin: true };
  }
  if (path === "/auth/logout") {
    loggedIn = false;
    sessionStorageSet("demo-login", "0");
    return { done: true };
  }
  if (path === "/monitoring") {
    await ensureAlerts();
    return { ...(await monitoringSnapshot(call)), alerts };
  }
  if (!loggedIn) fail(401, "Connecte-toi (n'importe quel identifiant fonctionne dans la démo).");
  if (path === "/auth/me") return { username: "demo@pam", admin: true, demo: true };

  if (path.startsWith("/pve/")) {
    const pvePath = path.slice(4);
    const params = method === "GET" || method === "DELETE" ? query : body;
    const data = await call(method as any, pvePath, params);
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

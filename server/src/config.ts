// Configuration et petites bases de données en fichiers JSON (dossier data/).
// config.json contient des secrets : ne le partage pas et ne le versionne pas.
import { promises as fs, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_MODULES, DEFAULT_RULES, type ActivityEntry, type AlertRules, type Channel, type McpLevel, type Modules, type Notification } from "../../shared/types";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = process.env.MYPROXMOX_DATA ? path.resolve(process.env.MYPROXMOX_DATA) : path.join(ROOT, "data");
export const DEMO = process.env.MYPROXMOX_DEMO === "1";

export const PRIVATE_RANGES = ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

export interface McpKey {
  id: string;
  name: string;
  level: McpLevel;
  hash: string;
  prefix: string;
  createdAt: string;
  lastUsed?: string;
}

export interface Config {
  setupDone: boolean;
  pve: { url: string; insecureTls: boolean; tokenId: string; tokenSecret: string } | null;
  allowedRanges: string[];
  modules: Modules;
  rules: AlertRules;
  channels: Channel[];
  mcpKeys: McpKey[];
  monitoringKeyHash: string | null;
}

const CONFIG = () => path.join(DATA_DIR, "config.json");
const NOTIFS = () => path.join(DATA_DIR, "notifications.json");
const ACTIVITY = () => path.join(DATA_DIR, "activity.json");

function defaults(): Config {
  return {
    setupDone: false,
    pve: null,
    allowedRanges: [...PRIVATE_RANGES],
    modules: { ...DEFAULT_MODULES },
    rules: { ...DEFAULT_RULES },
    channels: [],
    mcpKeys: [],
    monitoringKeyHash: null,
  };
}

let cache: Config | null = null;

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file); // écriture atomique
}

export function getConfig(): Config {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(CONFIG(), "utf8"));
    cache = { ...defaults(), ...raw, modules: { ...DEFAULT_MODULES, ...raw.modules }, rules: { ...DEFAULT_RULES, ...raw.rules } };
  } catch {
    cache = defaults();
  }
  if (DEMO) cache!.setupDone = true;
  return cache!;
}

export async function saveConfig(patch: Partial<Config>) {
  cache = { ...getConfig(), ...patch };
  await writeJson(CONFIG(), cache);
  return cache;
}

// ── Secrets ─────────────────────────────────────────────────────────
export const newSecret = (bytes = 24) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export function sameHash(value: string, hash: string) {
  const a = Buffer.from(sha256(value));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Notifications ───────────────────────────────────────────────────
let notifs: Notification[] | null = null;
export function getNotifications(): Notification[] {
  if (!notifs) {
    try {
      notifs = JSON.parse(readFileSync(NOTIFS(), "utf8"));
    } catch {
      notifs = [];
    }
  }
  return notifs!;
}
export async function addNotification(n: Notification) {
  const list = getNotifications();
  list.unshift(n);
  notifs = list.slice(0, 500);
  await writeJson(NOTIFS(), notifs);
}
export async function markRead(ids: string[] | "all") {
  for (const n of getNotifications()) if (ids === "all" || ids.includes(n.id)) n.read = true;
  await writeJson(NOTIFS(), notifs);
}
export async function clearNotifications() {
  notifs = [];
  await writeJson(NOTIFS(), notifs);
}

// ── Journal d'activité ──────────────────────────────────────────────
let activity: ActivityEntry[] | null = null;
export function getActivity(): ActivityEntry[] {
  if (!activity) {
    try {
      activity = JSON.parse(readFileSync(ACTIVITY(), "utf8"));
    } catch {
      activity = [];
    }
  }
  return activity!;
}
export async function logActivity(e: Omit<ActivityEntry, "at">) {
  const list = getActivity();
  list.unshift({ at: new Date().toISOString(), ...e });
  activity = list.slice(0, 2000);
  await writeJson(ACTIVITY(), activity);
}

// ── Version (package.json + commit git si disponible) ───────────────
export function version() {
  let v = "dev";
  try {
    v = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  } catch {
    /* rien */
  }
  try {
    const head = readFileSync(path.join(ROOT, ".git", "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref:") ? head.slice(5) : null;
    const sha = ref && existsSync(path.join(ROOT, ".git", ref)) ? readFileSync(path.join(ROOT, ".git", ref), "utf8").trim() : head;
    if (/^[0-9a-f]{40}$/.test(sha)) v += ` (${sha.slice(0, 7)})`;
  } catch {
    /* pas de dépôt git */
  }
  return v;
}

export type { AlertRules, Channel };

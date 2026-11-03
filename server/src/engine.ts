// Moteur d'alertes : vérifie Proxmox toutes les minutes (contrôles lourds
// toutes les 15 min), garde la liste des alertes actives et notifie quand
// une alerte apparaît ou disparaît.
import { randomUUID } from "node:crypto";
import { collect, evaluate, type AlertInput } from "../../shared/alerts";
import type { Alert, Notification } from "../../shared/types";
import { addNotification, getConfig } from "./config";
import { serviceCall } from "./pve";
import { dispatch } from "./notify";
import { broadcast } from "./sessions";

interface Active {
  alert: Alert;
  since: string;
  hits: number;
  notified: boolean;
}

const active = new Map<string, Active>();
let lastHeavy = 0;
let heavyCache: Pick<AlertInput, "disks" | "zfs" | "certificates" | "updates" | "backups"> | null = null;
let lastRun: string | null = null;
let lastError: string | null = null;
const startedAt = Math.floor(Date.now() / 1000);
const SUSTAINED = /^(cpu|mem):/; // ces alertes doivent durer avant d'être notifiées
const ONE_SHOT = /^(task|updates):/; // pas de notification « résolu » pour celles-ci

export function activeAlerts() {
  return [...active.values()].filter((a) => a.notified || !SUSTAINED.test(a.alert.key)).map((a) => ({ ...a.alert, since: a.since }));
}

export function engineStatus() {
  return { lastRun, lastError, active: activeAlerts().length };
}

async function notify(n: Omit<Notification, "id" | "at">) {
  const full: Notification = { id: randomUUID(), at: new Date().toISOString(), ...n };
  await addNotification(full);
  broadcast("notification", full);
  await dispatch(getConfig().channels, full);
}

export async function runOnce() {
  const cfg = getConfig();
  if (!cfg.setupDone || !cfg.modules.alerts) return;
  const call = serviceCall();
  const heavy = Date.now() - lastHeavy > 15 * 60 * 1000;
  try {
    const input = await collect(call, heavy);
    if (heavy) {
      lastHeavy = Date.now();
      heavyCache = { disks: input.disks, zfs: input.zfs, certificates: input.certificates, updates: cfg.modules.updates ? input.updates : {}, backups: cfg.modules.backups ? input.backups : null };
    }
    const alerts = evaluate({ ...input, ...(heavyCache ?? {}) }, cfg.rules, { sinceTask: startedAt });
    const keys = new Set(alerts.map((a) => a.key));

    for (const a of alerts) {
      const cur = active.get(a.key);
      const hits = (cur?.hits ?? 0) + 1;
      const entry: Active = { alert: a, since: cur?.since ?? new Date().toISOString(), hits, notified: cur?.notified ?? false };
      const ready = !SUSTAINED.test(a.key) || hits >= cfg.rules.sustainChecks;
      if (ready && !entry.notified) {
        entry.notified = true;
        await notify({ level: a.level, title: a.title, message: a.message, key: a.key });
      }
      active.set(a.key, entry);
    }
    for (const [key, cur] of active) {
      if (keys.has(key)) continue;
      // Les contrôles lourds ne tournent pas à chaque fois : on garde leurs alertes entre deux passages
      active.delete(key);
      if (cur.notified && !ONE_SHOT.test(key) && cur.alert.level !== "info") {
        await notify({ level: "info", title: cur.alert.title, message: "Retour à la normale.", key, resolved: true });
      }
    }
    broadcast("alerts", activeAlerts());
    lastRun = new Date().toISOString();
    lastError = null;
  } catch (e) {
    lastError = (e as Error).message;
    console.error("[alertes]", lastError);
  }
}

export function startEngine() {
  setTimeout(runOnce, 5000);
  setInterval(runOnce, 60 * 1000);
}

export async function testNotification() {
  await notify({ level: "warning", title: "Test de notification", message: "Si tu lis ce message, les notifications de MyProxmox fonctionnent." });
}

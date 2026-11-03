// Formatage en français, partagé entre l'interface, les alertes et le MCP.

export function bytes(n?: number, digits = 1) {
  if (!n || n < 0) return "0 o";
  const u = ["o", "Ko", "Mo", "Go", "To", "Po"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i < 2 ? 0 : digits).replace(".", ",")} ${u[i]}`;
}

export function rate(n?: number) {
  return `${bytes(n)}/s`;
}

export function pct(v?: number, digits = 0) {
  return `${((v ?? 0) * 100).toFixed(digits).replace(".", ",")} %`;
}

export function uptime(s?: number) {
  if (!s) return "-";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

export function ago(ts?: number) {
  if (!ts) return "jamais";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

export function date(ts?: number | string, withYear = false) {
  if (!ts) return "-";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", ...(withYear ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit" });
}

export const STATUS_LABEL: Record<string, string> = {
  running: "En marche",
  stopped: "Arrêtée",
  paused: "En pause",
  suspended: "Suspendue",
  online: "En ligne",
  offline: "Hors ligne",
  unknown: "Inconnu",
};

export const TASK_LABEL: Record<string, string> = {
  qmstart: "Démarrage VM", qmshutdown: "Extinction VM", qmstop: "Arrêt forcé VM", qmreboot: "Redémarrage VM",
  vzstart: "Démarrage conteneur", vzshutdown: "Extinction conteneur", vzstop: "Arrêt forcé conteneur", vzreboot: "Redémarrage conteneur",
  qmcreate: "Création VM", vzcreate: "Création conteneur", qmdestroy: "Suppression VM", vzdestroy: "Suppression conteneur",
  qmsnapshot: "Snapshot VM", vzsnapshot: "Snapshot conteneur", qmdelsnapshot: "Suppression snapshot", vzdelsnapshot: "Suppression snapshot",
  qmrollback: "Retour au snapshot", vzrollback: "Retour au snapshot", qmclone: "Clonage VM", vzclone: "Clonage conteneur",
  vzdump: "Sauvegarde", qmrestore: "Restauration VM", vzrestore: "Restauration conteneur", download: "Téléchargement",
  imgdel: "Suppression de fichier", aptupdate: "Recherche de mises à jour", vncproxy: "Console", vncshell: "Shell", qmigrate: "Migration VM",
  vzmigrate: "Migration conteneur", startall: "Démarrage global", stopall: "Arrêt global", srvreload: "Rechargement service", srvrestart: "Redémarrage service",
};

export const LEVEL_LABEL = { info: "Info", warning: "Attention", critical: "Critique" } as const;

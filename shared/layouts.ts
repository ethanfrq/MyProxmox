// Widgets de l'écran de monitoring et dispositions du mode « mur » (grille de 12 colonnes).

export const WIDGETS = {
  kpis: "Chiffres clés",
  cpu: "Processeur",
  memory: "Mémoire",
  nodes: "Nœuds",
  cluster: "Cluster et HA",
  alerts: "Alertes actives",
  guests: "Machines",
  network: "Réseau par pont",
  "net-history": "Débit réseau (24 h)",
  storage: "Stockage",
  disks: "Disques et ZFS",
  backups: "Sauvegardes",
  security: "Sécurité",
  activity: "Activité en direct",
  "history-24h": "Historique 24 h",
  "history-7d": "Historique 7 jours",
} as const;
export type WidgetId = keyof typeof WIDGETS;
export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

export interface WidgetPlace { id: WidgetId; w: number; h: number }
export interface MonLayout { name: string; widgets: WidgetPlace[]; updatedAt: string }

const err = (msg: string) => Object.assign(new Error(msg), { status: 400 });

export function normalizeLayout(name: string, body: any): MonLayout {
  const n = String(name).toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(n)) throw err("Nom de disposition : minuscules, chiffres et tirets, 32 caractères au plus. Exemple : salon");
  const list = Array.isArray(body?.widgets) ? body.widgets : [];
  const widgets = list
    .filter((w: any) => WIDGET_IDS.includes(w?.id))
    .slice(0, 30)
    .map((w: any) => ({ id: w.id as WidgetId, w: Math.min(12, Math.max(2, Math.round(Number(w.w) || 4))), h: Math.min(4, Math.max(1, Math.round(Number(w.h) || 1))) }));
  if (!widgets.length) throw err("Ajoute au moins un widget à la disposition.");
  return { name: n, widgets, updatedAt: new Date().toISOString() };
}

/** Vues qui tournent automatiquement quand aucune disposition n'est choisie. */
export const VIEWS: { id: string; title: string; widgets: WidgetPlace[] }[] = [
  { id: "general", title: "Vue générale", widgets: [
    { id: "kpis", w: 12, h: 1 }, { id: "cpu", w: 4, h: 2 }, { id: "memory", w: 4, h: 2 }, { id: "alerts", w: 4, h: 2 },
    { id: "nodes", w: 6, h: 1 }, { id: "storage", w: 6, h: 1 },
  ] },
  { id: "machines", title: "Machines", widgets: [{ id: "guests", w: 12, h: 4 }] },
  { id: "reseau", title: "Réseau", widgets: [{ id: "network", w: 5, h: 2 }, { id: "net-history", w: 7, h: 2 }, { id: "cluster", w: 5, h: 2 }, { id: "activity", w: 7, h: 2 }] },
  { id: "stockage", title: "Stockage et disques", widgets: [{ id: "storage", w: 6, h: 3 }, { id: "disks", w: 6, h: 3 }] },
  { id: "securite", title: "Sauvegardes et sécurité", widgets: [{ id: "backups", w: 7, h: 3 }, { id: "security", w: 5, h: 3 }] },
  { id: "historique", title: "Historique 24 h / 7 j", widgets: [{ id: "history-24h", w: 12, h: 2 }, { id: "history-7d", w: 12, h: 2 }] },
];

// Types partagés entre le serveur, l'interface et la démo.

/** Fonction d'appel à l'API Proxmox : méthode, chemin (/nodes/...), paramètres → champ data. */
export type Call = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, params?: Record<string, unknown>) => Promise<any>;

export type GuestType = "qemu" | "lxc";
export type Level = "info" | "warning" | "critical";
export type McpLevel = "read" | "actions";

export interface Alert {
  key: string; // identifiant stable, ex. "storage:local-lvm"
  level: Level;
  title: string;
  message: string;
  target?: string;
}

export interface Notification {
  id: string;
  at: string;
  level: Level;
  title: string;
  message: string;
  key?: string;
  resolved?: boolean; // true = notification de retour à la normale
  read?: boolean;
}

export interface AlertRules {
  cpu: number; // % au-delà duquel on alerte
  memory: number;
  storageWarning: number;
  storageCritical: number;
  sustainChecks: number; // nombre de vérifications consécutives avant d'alerter (CPU/RAM)
  backupMaxDays: number; // machine sans sauvegarde depuis plus de N jours
  certificateDays: number; // certificat qui expire dans moins de N jours
  guestDown: boolean; // machine en démarrage auto mais arrêtée
  failedTasks: boolean;
  disks: boolean; // SMART / ZFS
  updates: boolean;
}

export const DEFAULT_RULES: AlertRules = {
  cpu: 90,
  memory: 90,
  storageWarning: 85,
  storageCritical: 95,
  sustainChecks: 3,
  backupMaxDays: 7,
  certificateDays: 14,
  guestDown: true,
  failedTasks: true,
  disks: true,
  updates: true,
};

export interface Channel {
  id: string;
  type: "discord" | "ntfy" | "webhook";
  name: string;
  url: string; // webhook Discord, URL du sujet ntfy, ou URL du webhook
  token?: string; // ntfy (jeton d'accès) ou webhook (en-tête Authorization)
  minLevel: Level;
  enabled: boolean;
}

export interface Modules {
  monitoring: boolean;
  alerts: boolean;
  mcp: boolean;
  security: boolean;
  backups: boolean;
  updates: boolean;
}

export const DEFAULT_MODULES: Modules = {
  monitoring: true,
  alerts: true,
  mcp: true,
  security: true,
  backups: true,
  updates: true,
};

export interface McpKeyInfo {
  id: string;
  name: string;
  level: McpLevel;
  createdAt: string;
  lastUsed?: string;
  prefix: string; // 6 premiers caractères, pour reconnaître la clé
}

export interface ActivityEntry {
  at: string;
  actor: string; // "root@pam", "mcp:Claude Desktop", "monitoring"...
  action: string;
  target: string;
  result: "ok" | "refusé" | "erreur";
  detail?: string;
}

export interface Me {
  username: string;
  admin: boolean; // Sys.Modify sur "/"
  demo: boolean;
}

export interface PublicSettings {
  pveUrl: string;
  insecureTls: boolean;
  allowedRanges: string[];
  modules: Modules;
  rules: AlertRules;
  channels: Channel[];
  mcpKeys: McpKeyInfo[];
  hasMonitoringKey: boolean;
  serviceToken: string; // identifiant (sans le secret)
  version: string;
  appUrl: string;
  bridgePath: string;
  clientIp: string;
}

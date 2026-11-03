// Règles d'alerte. `collect` lit l'état de Proxmox, `evaluate` en déduit la
// liste des problèmes actuels. Le serveur appelle les deux en boucle et envoie
// une notification quand une alerte apparaît ou disparaît.
import type { Alert, AlertRules, Call } from "./types";
import { backupStatus, safe } from "./insights";
import { bytes, pct } from "./format";

const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);

export interface AlertInput {
  resources: any[];
  nodeStatus: Record<string, any>;
  tasks: any[];
  disks: Record<string, any[]>;
  zfs: Record<string, any[]>;
  certificates: Record<string, any[]>;
  updates: Record<string, any[]>;
  onbootStopped: { vmid: number; name: string; node: string }[];
  backups: { vmid: number; name: string; lastBackup: number; inJob: boolean }[] | null;
}

/** `heavy` = inclut les contrôles lents (disques, sauvegardes, mises à jour). */
export async function collect(call: Call, heavy: boolean): Promise<AlertInput> {
  const resources = await call("GET", "/cluster/resources");
  const onlineNodes = resources.filter((r: any) => r.type === "node" && r.status === "online").map((r: any) => r.node as string);
  const tasks = await safe(call("GET", "/cluster/tasks"), [] as any[]);
  const nodeStatus: Record<string, any> = {};
  const disks: Record<string, any[]> = {};
  const zfs: Record<string, any[]> = {};
  const certificates: Record<string, any[]> = {};
  const updates: Record<string, any[]> = {};
  await Promise.all(onlineNodes.map(async (n: string) => {
    nodeStatus[n] = await safe(call("GET", `/nodes/${n}/status`), null);
    if (heavy) {
      [disks[n], zfs[n], certificates[n], updates[n]] = await Promise.all([
        safe(call("GET", `/nodes/${n}/disks/list`), [] as any[]),
        safe(call("GET", `/nodes/${n}/disks/zfs`), [] as any[]),
        safe(call("GET", `/nodes/${n}/certificates/info`), [] as any[]),
        safe(call("GET", `/nodes/${n}/apt/update`), [] as any[]),
      ]);
    }
  }));
  // Machines arrêtées : on regarde si elles devraient démarrer avec le serveur
  const stopped = resources.filter((r: any) => (r.type === "qemu" || r.type === "lxc") && r.status === "stopped" && !r.template);
  const configs = await Promise.all(stopped.map((g: any) => safe(call("GET", `/nodes/${g.node}/${g.type}/${g.vmid}/config`), {} as any)));
  const onbootStopped = stopped.filter((_: any, i: number) => Number(configs[i].onboot ?? 0) === 1).map((g: any) => ({ vmid: g.vmid, name: g.name, node: g.node }));
  const backups = heavy ? (await safe(backupStatus(call), null as any))?.rows ?? null : null;
  return { resources, nodeStatus, tasks, disks, zfs, certificates, updates, onbootStopped, backups };
}

export function evaluate(d: AlertInput, rules: AlertRules, opts: { sinceTask?: number } = {}): Alert[] {
  const out: Alert[] = [];
  for (const n of d.resources.filter((r) => r.type === "node")) {
    if (n.status !== "online") {
      out.push({ key: `node:${n.node}`, level: "critical", title: `Nœud ${n.node} hors ligne`, message: `Le nœud ${n.node} ne répond plus.`, target: n.node });
      continue;
    }
    if (n.cpu * 100 >= rules.cpu) out.push({ key: `cpu:${n.node}`, level: "warning", title: `Processeur chargé sur ${n.node}`, message: `Utilisation à ${pct(n.cpu)} (seuil ${rules.cpu} %).`, target: n.node });
    if (n.maxmem && (n.mem / n.maxmem) * 100 >= rules.memory) out.push({ key: `mem:${n.node}`, level: "warning", title: `Mémoire presque pleine sur ${n.node}`, message: `${bytes(n.mem)} utilisés sur ${bytes(n.maxmem)} (${pct(n.mem / n.maxmem)}).`, target: n.node });
    const st = d.nodeStatus[n.node];
    if (st?.rootfs?.total && (st.rootfs.used / st.rootfs.total) * 100 >= rules.storageWarning) {
      const ratio = st.rootfs.used / st.rootfs.total;
      out.push({ key: `rootfs:${n.node}`, level: ratio * 100 >= rules.storageCritical ? "critical" : "warning", title: `Disque système presque plein sur ${n.node}`, message: `${pct(ratio)} utilisés (${bytes(st.rootfs.avail)} libres).`, target: n.node });
    }
  }
  const seen = new Set<string>();
  for (const s of d.resources.filter((r) => r.type === "storage" && r.maxdisk)) {
    const key = s.shared ? s.storage : `${s.node}/${s.storage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.status !== "available") {
      out.push({ key: `storage-off:${key}`, level: "critical", title: `Stockage ${s.storage} indisponible`, message: `Le stockage ${s.storage} n'est pas accessible depuis ${s.node}.`, target: s.storage });
      continue;
    }
    const ratio = s.disk / s.maxdisk;
    if (ratio * 100 >= rules.storageWarning) {
      out.push({ key: `storage:${key}`, level: ratio * 100 >= rules.storageCritical ? "critical" : "warning", title: `Stockage ${s.storage} presque plein`, message: `${pct(ratio)} utilisés, ${bytes(s.maxdisk - s.disk)} libres.`, target: s.storage });
    }
  }
  if (rules.guestDown) {
    for (const g of d.onbootStopped) out.push({ key: `down:${g.vmid}`, level: "warning", title: `${g.name} (${g.vmid}) est arrêtée`, message: "Cette machine est réglée pour démarrer avec le serveur, mais elle ne tourne pas.", target: String(g.vmid) });
  }
  if (rules.failedTasks) {
    const since = opts.sinceTask ?? nowS() - DAY;
    for (const t of d.tasks.filter((t) => t.status && t.status !== "OK" && t.endtime >= since)) {
      out.push({ key: `task:${t.upid}`, level: t.type === "vzdump" ? "critical" : "warning", title: t.type === "vzdump" ? "Sauvegarde en échec" : `Tâche en échec : ${t.type}`, message: `${t.id ? `Cible ${t.id}. ` : ""}Résultat : ${t.status}`, target: t.id });
    }
  }
  if (rules.disks) {
    for (const [node, list] of Object.entries(d.disks)) {
      for (const disk of list) {
        const h = String(disk.health ?? "").toUpperCase();
        if (h && !["PASSED", "OK", "UNKNOWN", ""].includes(h)) out.push({ key: `smart:${node}:${disk.devpath}`, level: "critical", title: `Disque ${disk.devpath} en mauvaise santé (${node})`, message: `${disk.model} : SMART ${disk.health}. Prévois son remplacement.`, target: node });
        if (typeof disk.wearout === "number" && disk.wearout <= 10) out.push({ key: `wear:${node}:${disk.devpath}`, level: "warning", title: `SSD ${disk.devpath} usé (${node})`, message: `Il reste ${disk.wearout} % de durée de vie estimée.`, target: node });
      }
    }
    for (const [node, pools] of Object.entries(d.zfs)) {
      for (const p of pools) if (p.health && p.health !== "ONLINE") out.push({ key: `zfs:${node}:${p.name}`, level: "critical", title: `Pool ZFS ${p.name} : ${p.health}`, message: `Le pool ${p.name} sur ${node} n'est pas en bon état. Vérifie les disques avec « zpool status ».`, target: node });
    }
  }
  for (const [node, certs] of Object.entries(d.certificates)) {
    for (const c of certs) {
      const days = Math.floor((c.notafter - nowS()) / DAY);
      if (days < rules.certificateDays && !/root-ca/.test(c.filename)) out.push({ key: `cert:${node}:${c.filename}`, level: days < 3 ? "critical" : "warning", title: `Certificat ${c.filename} bientôt expiré (${node})`, message: days < 0 ? "Il a déjà expiré." : `Il expire dans ${days} jour(s).`, target: node });
    }
  }
  if (rules.updates) {
    for (const [node, list] of Object.entries(d.updates)) {
      if (list.length) out.push({ key: `updates:${node}`, level: "info", title: `${list.length} mise(s) à jour disponible(s) sur ${node}`, message: list.slice(0, 6).map((u) => u.Package).join(", ") + (list.length > 6 ? "..." : ""), target: node });
    }
  }
  if (d.backups && rules.backupMaxDays > 0) {
    const limit = nowS() - rules.backupMaxDays * DAY;
    const stale = d.backups.filter((b) => !b.lastBackup || b.lastBackup < limit);
    for (const b of stale) {
      out.push({ key: `backup:${b.vmid}`, level: "warning", title: `${b.name} (${b.vmid}) sans sauvegarde récente`, message: b.lastBackup ? `Dernière sauvegarde il y a ${Math.floor((nowS() - b.lastBackup) / DAY)} jours.` : `Aucune sauvegarde trouvée${b.inJob ? "" : ", et la machine n'est dans aucune tâche planifiée"}.`, target: String(b.vmid) });
    }
  }
  return out;
}

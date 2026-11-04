// Données de l'écran de monitoring.
// Un seul appel toutes les 5 s pour les données vives (ressources, état des nœuds, quorum,
// HA, débits). Les données lourdes (historique, SMART, sauvegardes, sécurité, IP) sont
// gardées en cache et rafraîchies en arrière-plan toutes les 1 à 15 minutes.
// Tourne côté serveur (vraie API ou démo) et dans le navigateur (démo Vercel).
import type { Call } from "./types";
import { forecastDays, inventory, safe } from "./insights";

const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
const MIN = 60_000;

export const CRITICAL_SERVICES = ["pveproxy", "pvedaemon", "pvestatd", "pve-cluster", "corosync"];

export interface Point { t: number; cpu: number; mem: number; memtotal: number; netin: number; netout: number; iowait: number; load: number }
export interface MonNode {
  node: string;
  status: string;
  uptime: number;
  cpu: number;
  maxcpu: number;
  cpuModel: string;
  loadavg: number[];
  iowait: number;
  psi: { cpu?: number; mem?: number; io?: number } | null;
  mem: { used: number; total: number; free: number; cache: number | null };
  ksm: number;
  swap: { used: number; total: number };
  rootfs: { used: number; total: number };
  version: string;
  kernel: string;
  services: { name: string; state: "running" | "stopped" | "disabled" | "absent" }[];
  /** null : liste illisible avec ce compte (Proxmox demande Sys.Modify pour la lire) */
  updates: number | null;
  securityUpdates: number;
  rrd: { hour: Point[]; day: Point[]; week: Point[] };
  bridges: { name: string; ports: string; comment: string; in: number | null; out: number | null; guests: number }[];
  net: { in: number; out: number };
}
export interface MonGuest {
  vmid: number; name: string; type: "qemu" | "lxc"; node: string; status: string; tags: string[]; ips: string[];
  cpu: number; maxcpu: number; mem: number; maxmem: number; uptime: number;
  netin: number | null; netout: number | null; diskread: number | null; diskwrite: number | null;
  disk: number; maxdisk: number; // occupation du disque (conteneurs seulement ; 0 pour une VM sans agent)
  spark: number[]; // CPU des dernières minutes
}
export interface MonTask { upid: string; type: string; id: string; node: string; user: string; start: number; end: number | null; status: string | null }
export interface MonReplication { id: string; guest: number; name: string; source: string; target: string; schedule: string; lastSync: number | null; nextSync: number | null; duration: number | null; failCount: number; error: string | null; enabled: boolean }
export interface MonCeph { node: string; health: string; checks: string[]; osds: { total: number; up: number; in: number }; mons: number; used: number; total: number; pgs: number; pgsClean: number; read: number; write: number }
export interface MonStorage {
  id: string; storage: string; node: string; type: string; shared: boolean; active: boolean;
  used: number; total: number; daysToFull: number | null; fullDate: number | null;
}
export interface MonDisk { node: string; devpath: string; model: string; type: string; size: number; health: string; wearout: number | null; temperature: number | null }
export interface MonActivity { at: number; source: "tâche" | "myproxmox" | "mcp"; label: string; who: string; status: "ok" | "échec" | "en cours" | "refusé" }
export interface MonBackupJob { id: string; schedule: string; storage: string; enabled: boolean; nextRun: number | null; lastRun: number | null; lastStatus: string | null; targets: string }

export interface MonitoringData {
  at: string;
  cluster: { name: string | null; quorate: boolean | null; nodes: number; nodesOnline: number; ha: { sid: string; state: string; node: string }[] };
  nodes: MonNode[];
  guests: MonGuest[];
  storages: MonStorage[];
  disks: MonDisk[];
  zfs: { node: string; name: string; health: string; size: number; alloc: number; frag: number }[];
  io: { read: number | null; write: number | null };
  backups: { jobs: MonBackupJob[]; uncovered: { vmid: number; name: string }[] };
  security: { failures24h: number; byIp: [string, number][]; certificates: { node: string; filename: string; days: number }[] };
  activity: MonActivity[];
  tasks: { running: MonTask[]; failed: MonTask[] };
  replication: MonReplication[];
  ceph: MonCeph | null;
  /** service : lu avec le compte de service MyProxmox ; personnel : avec les droits de la personne connectée */
  source: "service" | "personnel";
  counts: { guests: number; running: number; vms: number; containers: number };
  failedTasks: number;
  timings: { live: number; heavyAge: number };
}

/** Entrées du journal MyProxmox à mêler aux tâches (fournies par le serveur ou la démo). */
export interface ActivityInput { at: string; actor: string; action: string; target: string; result: string }

// ── Cache par identité (jeton de service, ou compte Proxmox connecté) ──
interface Slot<T> { at: number; value: T | null; running: Promise<void> | null }
interface State {
  counters: Map<string, { v: number; t: number; rate: number | null }>;
  sparks: Map<number, number[]>;
  sparkAt: number;
  slots: Record<string, Slot<any>>;
}
const states = new Map<string, State>();
const stateOf = (id: string) => {
  let s = states.get(id);
  if (!s) {
    s = { counters: new Map(), sparks: new Map(), sparkAt: 0, slots: {} };
    states.set(id, s);
  }
  return s;
};

/**
 * Valeur en cache rafraîchie toutes les `ttl` ms. Le premier appel attend la valeur ;
 * ensuite, une valeur périmée est renvoyée tout de suite et rechargée en arrière-plan.
 */
async function cached<T>(st: State, key: string, ttl: number, load: () => Promise<T>, fallback: T): Promise<T> {
  const slot: Slot<T> = (st.slots[key] ??= { at: 0, value: null, running: null });
  const refresh = () => {
    slot.running ??= load()
      .then((v) => {
        slot.value = v;
        slot.at = Date.now();
      })
      .catch(() => {
        slot.at = Date.now(); // on réessaiera au prochain délai
      })
      .finally(() => {
        slot.running = null;
      });
    return slot.running;
  };
  if (slot.value === null) {
    await refresh();
    return slot.value ?? fallback;
  }
  if (Date.now() - slot.at > ttl) refresh();
  return slot.value;
}

/** Débit en octets/s à partir d'un compteur cumulé (null tant qu'on n'a qu'une mesure). */
function rateOf(st: State, key: string, value: number | undefined) {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  const t = Date.now();
  const prev = st.counters.get(key);
  if (prev && t - prev.t < 1000) return prev.rate ?? null; // deux appels rapprochés : on garde le dernier débit
  const rate = !prev ? null : value < prev.v ? 0 : (value - prev.v) / ((t - prev.t) / 1000);
  st.counters.set(key, { v: value, t, rate });
  return rate;
}

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function points(raw: any[]): Point[] {
  return raw.filter((p) => p.cpu !== undefined).map((p) => ({
    t: p.time, cpu: num(p.cpu), mem: num(p.memused ?? p.mem), memtotal: num(p.memtotal ?? p.maxmem),
    netin: num(p.netin), netout: num(p.netout), iowait: num(p.iowait), load: num(p.loadavg),
  }));
}

function temperature(smart: any): number | null {
  for (const a of smart?.attributes ?? []) {
    if (["194", "190"].includes(String(a.id)) || /temperature/i.test(a.name ?? "")) {
      const t = parseInt(String(a.raw), 10);
      if (t > 0 && t < 120) return t;
    }
  }
  const m = String(smart?.text ?? "").match(/Temperature:\s+(\d+)\s*Celsius/i);
  return m ? Number(m[1]) : null;
}

function parseSyslogTime(line: string) {
  const iso = line.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (iso) return Date.parse(`${iso[1]}T${iso[2]}`) / 1000;
  const bsd = line.match(/^(\w{3})\s+(\d+)\s+(\d{2}:\d{2}:\d{2})/);
  if (bsd) return Date.parse(`${bsd[1]} ${bsd[2]} ${new Date().getFullYear()} ${bsd[3]}`) / 1000;
  return 0;
}

/** Instantané complet. `id` identifie la personne (pour séparer les caches). */
export async function monitoring(call: Call, id = "service", activityLog: ActivityInput[] = []): Promise<MonitoringData> {
  const started = Date.now();
  const st = stateOf(id);

  // ── Données vives ──
  const [resources, clusterStatus, haStatus, tasks] = await Promise.all([
    call("GET", "/cluster/resources"),
    safe(call("GET", "/cluster/status"), [] as any[]),
    safe(call("GET", "/cluster/ha/status/current"), [] as any[]),
    safe(call("GET", "/cluster/tasks"), [] as any[]),
  ]);
  const nodeRes = resources.filter((r: any) => r.type === "node").sort((a: any, b: any) => String(a.node).localeCompare(b.node));
  const online = nodeRes.filter((n: any) => n.status === "online").map((n: any) => n.node as string);
  const guestsRes = resources.filter((r: any) => (r.type === "qemu" || r.type === "lxc") && !r.template).sort((a: any, b: any) => a.vmid - b.vmid);
  const storeRes = resources.filter((r: any) => r.type === "storage");

  const live = await Promise.all(online.map(async (node: string) => {
    const [status, netstat] = await Promise.all([
      safe(call("GET", `/nodes/${node}/status`), null as any),
      safe(call("GET", `/nodes/${node}/netstat`), [] as any[]),
    ]);
    return { node, status, netstat };
  }));

  // ── Données lourdes, en cache ──
  const perNode = await Promise.all(online.map(async (node: string) => {
    const [hour, day, week, services, updates, network, disks, zfs, certs, syslog, storages] = await Promise.all([
      cached(st, `${node}:hour`, MIN, () => call("GET", `/nodes/${node}/rrddata`, { timeframe: "hour" }), [] as any[]),
      cached(st, `${node}:day`, 5 * MIN, () => call("GET", `/nodes/${node}/rrddata`, { timeframe: "day" }), [] as any[]),
      cached(st, `${node}:week`, 15 * MIN, () => call("GET", `/nodes/${node}/rrddata`, { timeframe: "week" }), [] as any[]),
      cached(st, `${node}:services`, MIN, () => call("GET", `/nodes/${node}/services`), [] as any[]),
      cached(st, `${node}:apt`, 15 * MIN, () => call("GET", `/nodes/${node}/apt/update`), null as any[] | null),
      cached(st, `${node}:network`, 5 * MIN, () => call("GET", `/nodes/${node}/network`), [] as any[]),
      cached(st, `${node}:disks`, 15 * MIN, async () => {
        const list = await call("GET", `/nodes/${node}/disks/list`);
        return Promise.all(list.map(async (d: any) => ({ ...d, smart: await safe(call("GET", `/nodes/${node}/disks/smart`, { disk: d.devpath }), null) })));
      }, [] as any[]),
      cached(st, `${node}:zfs`, 15 * MIN, () => call("GET", `/nodes/${node}/disks/zfs`), [] as any[]),
      cached(st, `${node}:certs`, 15 * MIN, () => call("GET", `/nodes/${node}/certificates/info`), [] as any[]),
      cached(st, `${node}:syslog`, 5 * MIN, () => call("GET", `/nodes/${node}/syslog`, { service: "pvedaemon", limit: 2000, since: new Date(Date.now() - DAY * 1000).toISOString().slice(0, 19).replace("T", " ") }), [] as any[]),
      cached(st, `${node}:storage`, 15 * MIN, async () => {
        const list = await call("GET", `/nodes/${node}/storage`);
        return Promise.all(list.map(async (s: any) => {
          const pts = (await safe(call("GET", `/nodes/${node}/storage/${s.storage}/rrddata`, { timeframe: "week" }), [] as any[])).filter((p: any) => p.used !== undefined && p.total);
          return { storage: s.storage, daysToFull: forecastDays(pts) };
        }));
      }, [] as any[]),
    ]);
    return { node, hour, day, week, services, updates, network, disks, zfs, certs, syslog, storages };
  }));
  const inv = await cached(st, "inventory", MIN, () => inventory(call), [] as Awaited<ReturnType<typeof inventory>>);
  const [jobs, uncovered] = await Promise.all([
    cached(st, "backup-jobs", 5 * MIN, () => call("GET", "/cluster/backup"), [] as any[]),
    cached(st, "backup-uncovered", 15 * MIN, () => call("GET", "/cluster/backup-info/not-backed-up"), [] as any[]),
  ]);
  const haResources = await cached(st, "ha-resources", MIN, () => call("GET", "/cluster/ha/resources"), [] as any[]);
  // Réplication : les tâches du cluster, et leur état vu depuis chaque nœud
  const replRaw = await cached(st, "replication", MIN, async () => {
    const jobs = await call("GET", "/cluster/replication");
    if (!jobs.length) return { jobs, states: [] as any[] };
    const states = (await Promise.all(online.map((node: string) => safe(call("GET", `/nodes/${node}/replication`), [] as any[])))).flat();
    return { jobs, states };
  }, { jobs: [] as any[], states: [] as any[] });
  // Ceph : lu depuis le premier nœud en ligne qui l'a installé
  const cephRaw = await cached(st, "ceph", MIN, async () => {
    for (const node of online) {
      const c = await safe(call("GET", `/nodes/${node}/ceph/status`), null as any);
      if (c?.health) return { node, ...c };
    }
    return false;
  }, false as any);
  const heavyAge = Math.max(0, ...Object.values(st.slots).map((s) => (s.at ? Date.now() - s.at : 0)));

  // ── Machines ──
  const invById = new Map(inv.map((r) => [r.vmid, r]));
  const vifRates = new Map<number, { in: number; out: number }>();
  // Un point de mini graphe toutes les 4 s au plus, même si plusieurs écrans interrogent
  const pushSpark = Date.now() - st.sparkAt > 4000;
  if (pushSpark) st.sparkAt = Date.now();
  const guests: MonGuest[] = guestsRes.map((g: any) => {
    const run = g.status === "running";
    const spark = st.sparks.get(g.vmid) ?? [];
    if (pushSpark || !spark.length) spark.push(run ? num(g.cpu) : 0);
    if (spark.length > 36) spark.shift();
    st.sparks.set(g.vmid, spark);
    const netin = run ? rateOf(st, `g${g.vmid}:in`, g.netin) : 0;
    const netout = run ? rateOf(st, `g${g.vmid}:out`, g.netout) : 0;
    const diskread = run ? rateOf(st, `g${g.vmid}:dr`, g.diskread) : 0;
    const diskwrite = run ? rateOf(st, `g${g.vmid}:dw`, g.diskwrite) : 0;
    if (netin !== null && netout !== null) vifRates.set(g.vmid, { in: netin, out: netout });
    const i = invById.get(g.vmid);
    return {
      vmid: g.vmid, name: g.name, type: g.type, node: g.node, status: g.status,
      tags: String(g.tags ?? "").split(/[;,\s]+/).filter(Boolean), ips: i?.ips ?? [],
      cpu: num(g.cpu), maxcpu: num(g.maxcpu), mem: num(g.mem), maxmem: num(g.maxmem), uptime: num(g.uptime),
      netin, netout, diskread, diskwrite, disk: num(g.disk), maxdisk: num(g.maxdisk), spark: [...spark],
    };
  });
  const sumRates = (k: "diskread" | "diskwrite") => (guests.some((g) => g[k] === null && g.status === "running") ? null : guests.reduce((s, g) => s + (g[k] ?? 0), 0));

  // ── Nœuds ──
  const nodes: MonNode[] = nodeRes.map((n: any) => {
    const l = live.find((x) => x.node === n.node);
    const h = perNode.find((x) => x.node === n.node);
    const s = l?.status;
    const hour = points(h?.hour ?? []);
    const lastRaw = (h?.hour ?? []).filter((p: any) => p.cpu !== undefined).at(-1) ?? {};
    const psi = lastRaw.pressurecpusome !== undefined || lastRaw.pressureiosome !== undefined
      ? { cpu: lastRaw.pressurecpusome, mem: lastRaw.pressurememorysome, io: lastRaw.pressureiosome }
      : null;
    const svcs = h?.services ?? [];
    const services = CRITICAL_SERVICES.map((name) => {
      const x = svcs.find((v: any) => (v.name ?? v.service) === name);
      if (!x) return { name, state: "absent" as const };
      if (x["unit-state"] === "disabled" && x.state !== "running") return { name, state: "disabled" as const };
      return { name, state: x.state === "running" ? "running" as const : "stopped" as const };
    });
    // Débit par pont : somme des interfaces des machines branchées dessus
    const bridges = (h?.network ?? []).filter((i: any) => i.type === "bridge" || i.type === "OVSBridge").map((b: any) => {
      const attached = inv.filter((g) => g.node === n.node && g.nics.some((nic) => nic.bridge === b.iface));
      const rates = attached.map((g) => vifRates.get(g.vmid)).filter(Boolean) as { in: number; out: number }[];
      const known = attached.filter((g) => g.status === "running").every((g) => vifRates.has(g.vmid));
      return {
        name: b.iface, ports: b.bridge_ports ?? "", comment: b.comments ?? "", guests: attached.length,
        in: known ? rates.reduce((a, r) => a + r.in, 0) : null, out: known ? rates.reduce((a, r) => a + r.out, 0) : null,
      };
    });
    const memAvail = s?.memory?.available;
    return {
      node: n.node, status: n.status, uptime: num(s?.uptime ?? n.uptime), cpu: num(s?.cpu ?? n.cpu), maxcpu: num(n.maxcpu ?? s?.cpuinfo?.cpus),
      cpuModel: s?.cpuinfo?.model ?? "", loadavg: (s?.loadavg ?? []).map((x: any) => num(x)), iowait: num(s?.wait),
      psi,
      mem: { used: num(s?.memory?.used ?? n.mem), total: num(s?.memory?.total ?? n.maxmem), free: num(s?.memory?.free), cache: memAvail !== undefined ? Math.max(0, num(memAvail) - num(s?.memory?.free)) : null },
      ksm: num(s?.ksm?.shared), swap: { used: num(s?.swap?.used), total: num(s?.swap?.total) },
      rootfs: { used: num(s?.rootfs?.used ?? n.disk), total: num(s?.rootfs?.total ?? n.maxdisk) },
      version: String(s?.pveversion ?? "").split("/")[1] ?? "", kernel: s?.["current-kernel"]?.release ?? String(s?.kversion ?? "").split(" ")[1] ?? "",
      services,
      updates: h?.updates ? h.updates.length : null,
      securityUpdates: (h?.updates ?? []).filter((u: any) => /secur/i.test(`${u.Origin} ${u.Title} ${u.Section}`) || (u.Origin === "Debian" && /deb\d+u\d+/.test(u.Version))).length,
      rrd: { hour, day: points(h?.day ?? []), week: points(h?.week ?? []) },
      bridges,
      net: { in: hour.at(-1)?.netin ?? 0, out: hour.at(-1)?.netout ?? 0 },
    };
  });

  // ── Stockages (une seule entrée par stockage partagé) ──
  const seen = new Set<string>();
  const storages: MonStorage[] = storeRes.filter((s: any) => {
    const k = s.shared ? s.storage : `${s.node}/${s.storage}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((s: any) => {
    const trend = perNode.find((x) => x.node === s.node)?.storages.find((x: any) => x.storage === s.storage);
    const days = trend?.daysToFull ?? null;
    return {
      id: s.id, storage: s.storage, node: s.node, type: s.plugintype ?? "", shared: !!s.shared, active: s.status === "available",
      used: num(s.disk), total: num(s.maxdisk), daysToFull: days, fullDate: days === null ? null : nowS() + days * DAY,
    };
  }).sort((a: MonStorage, b: MonStorage) => a.storage.localeCompare(b.storage));

  // ── Disques ──
  const disks: MonDisk[] = perNode.flatMap((h) => h.disks.map((d: any) => ({
    node: h.node, devpath: d.devpath, model: d.model ?? "", type: d.type ?? "", size: num(d.size), health: String(d.health ?? "?"),
    wearout: Number.isFinite(Number(d.wearout)) ? Number(d.wearout) : null, temperature: temperature(d.smart),
  })));
  const zfs = perNode.flatMap((h) => h.zfs.map((p: any) => ({ node: h.node, name: p.name, health: p.health, size: num(p.size), alloc: num(p.alloc), frag: num(p.frag) })));

  // ── Sauvegardes planifiées ──
  const vzdump = tasks.filter((t: any) => t.type === "vzdump").sort((a: any, b: any) => b.starttime - a.starttime);
  const backupJobs: MonBackupJob[] = jobs.map((j: any) => {
    const ids = j.all ? null : String(j.vmid ?? "").split(",").filter(Boolean);
    const last = vzdump.find((t: any) => !t.id || (ids ? ids.includes(String(t.id)) : true));
    return {
      id: j.id, schedule: j.schedule ?? j.starttime ?? "", storage: j.storage ?? "", enabled: j.enabled === undefined || !!Number(j.enabled),
      nextRun: j["next-run"] ? num(j["next-run"]) : null, lastRun: last?.starttime ?? null,
      lastStatus: last ? (last.status ?? "en cours") : null,
      targets: j.all ? "toutes les machines" : j.pool ? `pool ${j.pool}` : ids?.join(", ") ?? "",
    };
  });

  // ── Sécurité ──
  const since = nowS() - DAY;
  const failures = perNode.flatMap((h) => h.syslog.map((l: any) => String(l.t ?? "")).filter((t: string) => /authentication failure/i.test(t) && parseSyslogTime(t) >= since));
  const byIpMap = new Map<string, number>();
  for (const f of failures) {
    const ip = (f.match(/rhost=(\S+)/)?.[1] ?? "?").replace("::ffff:", "");
    byIpMap.set(ip, (byIpMap.get(ip) ?? 0) + 1);
  }
  const certificates = perNode.flatMap((h) => h.certs.map((c: any) => ({ node: h.node, filename: c.filename, days: Math.floor((num(c.notafter) - nowS()) / DAY) })))
    .filter((c) => c.days < 60).sort((a, b) => a.days - b.days);

  // ── Activité : tâches Proxmox + actions faites via MyProxmox et le MCP ──
  const activity: MonActivity[] = [
    ...tasks.slice(0, 20).map((t: any): MonActivity => ({
      at: num(t.starttime), source: "tâche", label: `${t.type}${t.id ? ` ${t.id}` : ""}`, who: t.user ?? "",
      status: !t.status ? "en cours" : t.status === "OK" ? "ok" : "échec",
    })),
    ...activityLog.filter((a) => !/^connexion/.test(a.action)).slice(0, 20).map((a): MonActivity => ({
      at: Math.floor(Date.parse(a.at) / 1000), source: a.actor.startsWith("mcp:") ? "mcp" : "myproxmox", label: a.action, who: a.actor.replace(/^mcp:/, ""),
      status: a.result === "ok" ? "ok" : a.result === "refusé" ? "refusé" : "échec",
    })),
  ].sort((a, b) => b.at - a.at).slice(0, 20);

  // ── Cluster ──
  const clusterEntry = clusterStatus.find((c: any) => c.type === "cluster");
  const quorumEntry = haStatus.find((h: any) => h.type === "quorum");
  const cluster = {
    name: clusterEntry?.name ?? null,
    quorate: clusterEntry ? !!clusterEntry.quorate : quorumEntry ? !!quorumEntry.quorate : null,
    nodes: nodeRes.length,
    nodesOnline: online.length,
    ha: haResources.map((r: any) => {
      const cur = haStatus.find((h: any) => h.sid === r.sid);
      return { sid: r.sid, state: cur?.state ?? r.state ?? "?", node: cur?.node ?? "" };
    }),
  };

  // ── Tâches : en cours, et échecs des dernières 24 h ──
  const task = (t: any): MonTask => ({ upid: t.upid, type: t.type, id: String(t.id ?? ""), node: t.node, user: t.user ?? "", start: num(t.starttime), end: t.endtime ? num(t.endtime) : null, status: t.status ?? null });
  const taskList = {
    running: tasks.filter((t: any) => !t.status && !t.endtime).slice(0, 8).map(task),
    failed: tasks.filter((t: any) => t.status && t.status !== "OK" && t.starttime > since).slice(0, 8).map(task),
  };

  // ── Réplication ──
  const names = new Map(guests.map((g) => [g.vmid, g.name]));
  const replication: MonReplication[] = replRaw.jobs.map((j: any) => {
    const x = replRaw.states.find((v: any) => v.id === j.id) ?? {};
    return {
      id: j.id, guest: num(j.guest), name: names.get(num(j.guest)) ?? "", source: x.source ?? "", target: j.target, schedule: j.schedule ?? "*/15",
      lastSync: x.last_sync ? num(x.last_sync) : null, nextSync: x.next_sync ? num(x.next_sync) : null, duration: x.duration !== undefined ? num(x.duration) : null,
      failCount: num(x.fail_count), error: x.error ?? null, enabled: !Number(j.disable ?? 0),
    };
  });

  // ── Ceph ──
  const c = cephRaw || null;
  const ceph: MonCeph | null = c ? {
    node: c.node, health: String(c.health?.status ?? "?"),
    checks: Object.entries(c.health?.checks ?? {}).map(([k, v]: [string, any]) => v?.summary?.message ?? k),
    osds: { total: num(c.osdmap?.num_osds ?? c.osdmap?.osdmap?.num_osds), up: num(c.osdmap?.num_up_osds ?? c.osdmap?.osdmap?.num_up_osds), in: num(c.osdmap?.num_in_osds ?? c.osdmap?.osdmap?.num_in_osds) },
    mons: (c.monmap?.mons ?? []).length,
    used: num(c.pgmap?.bytes_used), total: num(c.pgmap?.bytes_total),
    pgs: num(c.pgmap?.num_pgs), pgsClean: (c.pgmap?.pgs_by_state ?? []).filter((x: any) => x.state_name === "active+clean").reduce((a: number, x: any) => a + num(x.count), 0),
    read: num(c.pgmap?.read_bytes_sec), write: num(c.pgmap?.write_bytes_sec),
  } : null;

  return {
    at: new Date().toISOString(),
    cluster,
    tasks: taskList,
    replication,
    ceph,
    source: id === "service" ? "service" : "personnel",
    nodes,
    guests,
    storages,
    disks,
    zfs,
    io: { read: sumRates("diskread"), write: sumRates("diskwrite") },
    backups: { jobs: backupJobs, uncovered: uncovered.map((u: any) => ({ vmid: num(u.vmid), name: u.name ?? "" })) },
    security: { failures24h: failures.length, byIp: [...byIpMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), certificates },
    activity,
    counts: {
      guests: guests.length, running: guests.filter((g) => g.status === "running").length,
      vms: guests.filter((g) => g.type === "qemu").length, containers: guests.filter((g) => g.type === "lxc").length,
    },
    failedTasks: tasks.filter((t: any) => t.status && t.status !== "OK" && t.starttime > since).length,
    timings: { live: Date.now() - started, heavyAge },
  };
}

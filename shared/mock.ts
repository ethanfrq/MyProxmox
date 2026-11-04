// Faux Proxmox en mémoire pour le mode démo.
// Il imite les chemins de l'API Proxmox VE 8 utilisés par MyProxmox, pour tout
// essayer sans serveur. Il tourne côté serveur (MYPROXMOX_DEMO=1) ou directement
// dans le navigateur (démo publiée sur Vercel). Les données repartent de zéro au rechargement.

type Any = any;
type Params = Record<string, unknown>;

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const NODE = "pve";

interface Guest {
  vmid: number;
  name: string;
  type: "qemu" | "lxc";
  status: "running" | "stopped";
  cpu: number;
  cores: number;
  memory: number; // Mo
  disk: number; // Go
  started: number;
  onboot: number;
  tags: string;
  ip: string;
  mac: string;
  bridge: string;
  agent: boolean;
  firewall: boolean;
  description: string;
  snapshots: { name: string; description: string; snaptime: number }[];
  pool?: string;
}

interface Task {
  upid: string;
  node: string;
  type: string;
  id: string;
  user: string;
  starttime: number;
  endtime: number;
  status: string;
  log: string[];
}

interface HaResource { sid: string; state: string; group?: string; comment?: string }

interface State {
  ha: HaResource[];
  guests: Guest[];
  tasks: Task[];
  content: Record<string, Any[]>;
  load: number;
}

const g = globalThis as unknown as { __myproxmoxMock?: State };

/** Tous les privilèges de Proxmox VE 8 (le compte démo les a tous sur « / »). */
export const PVE_PRIVS = [
  "Datastore.Allocate", "Datastore.AllocateSpace", "Datastore.AllocateTemplate", "Datastore.Audit",
  "Group.Allocate", "Mapping.Audit", "Mapping.Modify", "Mapping.Use", "Permissions.Modify",
  "Pool.Allocate", "Pool.Audit", "Realm.Allocate", "Realm.AllocateUser",
  "SDN.Allocate", "SDN.Audit", "SDN.Use", "Sys.AccessNetwork", "Sys.Audit", "Sys.Console", "Sys.Incoming",
  "Sys.Modify", "Sys.PowerMgmt", "Sys.Syslog", "User.Modify",
  "VM.Allocate", "VM.Audit", "VM.Backup", "VM.Clone", "VM.Config.CDROM", "VM.Config.CPU", "VM.Config.Cloudinit",
  "VM.Config.Disk", "VM.Config.HWType", "VM.Config.Memory", "VM.Config.Network", "VM.Config.Options",
  "VM.Console", "VM.Migrate", "VM.Monitor", "VM.PowerMgmt", "VM.Snapshot", "VM.Snapshot.Rollback",
];
const ALL_PRIVS = Object.fromEntries(PVE_PRIVS.map((p) => [p, 1]));

function mac(vmid: number) {
  return `BC:24:11:${(vmid % 256).toString(16).padStart(2, "0").toUpperCase()}:4E:${(vmid * 7 % 256).toString(16).padStart(2, "0").toUpperCase()}`;
}

function guest(vmid: number, name: string, type: "qemu" | "lxc", running: boolean, cores: number, memory: number, disk: number, tags: string, extra: Partial<Guest> = {}): Guest {
  return {
    vmid, name, type, status: running ? "running" : "stopped", cpu: running ? 0.02 + (vmid % 7) / 40 : 0,
    cores, memory, disk, started: running ? now() - 3600 * (5 + (vmid % 40)) : 0, onboot: running ? 1 : 0,
    tags, ip: `10.0.1.${vmid - 50}`, mac: mac(vmid), bridge: "vmbr0", agent: type === "qemu", firewall: vmid % 2 === 0,
    description: "", snapshots: [], ...extra,
  };
}

function init(): State {
  const t = now();
  const guests = [
    guest(100, "pihole", "lxc", true, 1, 512, 8, "dns;infra"),
    guest(101, "home-assistant", "qemu", true, 2, 4096, 32, "domotique"),
    guest(102, "jellyfin", "lxc", true, 4, 4096, 40, "media"),
    guest(103, "lab-kali", "qemu", false, 4, 8192, 64, "lab;securite", { bridge: "vmbr1", ip: "192.168.50.10" }),
    guest(104, "nextcloud", "lxc", true, 2, 2048, 120, "cloud"),
    guest(105, "win11-test", "qemu", false, 4, 8192, 80, "lab", { agent: false, ip: "" }),
    guest(106, "vaultwarden", "lxc", true, 1, 512, 4, "securite;infra"),
    guest(107, "docker-host", "qemu", true, 4, 8192, 100, "docker", { onboot: 1 }),
    guest(108, "uptime-kuma", "lxc", false, 1, 512, 4, "infra", { onboot: 1, started: 0 }),
  ];
  for (const x of guests) x.pool = /infra|dns|securite/.test(x.tags) ? "infra" : /lab/.test(x.tags) ? "lab" : /media|cloud/.test(x.tags) ? "maison" : undefined;
  guests[0].snapshots = [{ name: "avant-maj", description: "Avant mise à jour Pi-hole v6", snaptime: t - 52 * DAY }];
  guests[3].snapshots = [{ name: "propre", description: "Installation fraîche", snaptime: t - 90 * DAY }];
  const backup = (vmid: number, type: string, daysAgo: number, size: number) => {
    const d = new Date((t - daysAgo * DAY) * 1000);
    const stamp = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, "0")}_${String(d.getDate()).padStart(2, "0")}-02_00_01`;
    return { volid: `backup-nas:backup/vzdump-${type}-${vmid}-${stamp}.${type === "qemu" ? "vma.zst" : "tar.zst"}`, content: "backup", format: "zst", size, ctime: t - daysAgo * DAY, vmid, notes: "Sauvegarde nocturne" };
  };
  const tasks: Task[] = [];
  const mk = (type: string, id: string, ago: number, status = "OK", user = "root@pam") => tasks.push({
    upid: `UPID:${NODE}:000${(ago * 13).toString(16).toUpperCase().padStart(5, "0")}:00000000:${(t - ago).toString(16).toUpperCase()}:${type}:${id}:${user}:`,
    node: NODE, type, id, user, starttime: t - ago, endtime: t - ago + 40, status,
    log: status === "OK" ? [`INFO: starting ${type} ${id}`, "TASK OK"] : [`INFO: starting ${type} ${id}`, "ERROR: Backup of VM 104 failed - storage 'backup-nas' is not online", `TASK ERROR: ${status}`],
  });
  mk("vzdump", "", 3600 * 10, "job errors");
  mk("vzdump", "101", 3600 * 10 + 300);
  mk("qmstart", "107", 3600 * 26);
  mk("vzstart", "106", 3600 * 30);
  mk("aptupdate", NODE, 3600 * 31);
  return {
    ha: [{ sid: "vm:101", state: "started", comment: "Domotique toujours disponible" }, { sid: "ct:106", state: "started" }],
    guests,
    tasks,
    load: 0.12,
    content: {
      local: [
        { volid: "local:iso/debian-12.8.0-amd64-netinst.iso", content: "iso", format: "iso", size: 631 * MB, ctime: t - 20 * DAY },
        { volid: "local:iso/ubuntu-24.04.1-live-server-amd64.iso", content: "iso", format: "iso", size: 2.6 * GB, ctime: t - 9 * DAY },
        { volid: "local:iso/virtio-win-0.1.262.iso", content: "iso", format: "iso", size: 708 * MB, ctime: t - 120 * DAY },
        { volid: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst", content: "vztmpl", format: "tzst", size: 120 * MB, ctime: t - 30 * DAY },
      ],
      "local-lvm": [],
      "backup-nas": [
        backup(100, "lxc", 1, 410 * MB), backup(100, "lxc", 8, 402 * MB),
        backup(101, "qemu", 1, 6.1 * GB), backup(102, "lxc", 2, 1.2 * GB),
        backup(104, "lxc", 12, 18 * GB), backup(106, "lxc", 1, 150 * MB),
      ],
    },
  };
}

const S = () => (g.__myproxmoxMock ??= init());

function addTask(type: string, id: string, lines: string[] = [], status = "OK"): string {
  const t = now();
  const rand = Math.floor(Math.random() * 0xfffff).toString(16).toUpperCase().padStart(5, "0");
  const upid = `UPID:${NODE}:000${rand}:00000000:${t.toString(16).toUpperCase()}:${type}:${id}:demo@pve:`;
  S().tasks.unshift({ upid, node: NODE, type, id, user: "demo@pve", starttime: t, endtime: t + 1, status, log: [...lines, status === "OK" ? "TASK OK" : `TASK ERROR: ${status}`] });
  return upid;
}

class MockError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new MockError(status, message);
};

function findGuest(vmid: unknown) {
  const x = S().guests.find((v) => v.vmid === Number(vmid));
  if (!x) fail(500, `Configuration file 'nodes/${NODE}/qemu-server/${vmid}.conf' does not exist`);
  return x!;
}

function wobble(v: number, amp = 0.04) {
  return Math.max(0.005, Math.min(0.97, v + (Math.random() - 0.5) * amp));
}

function resource(x: Guest) {
  const run = x.status === "running";
  if (run) x.cpu = wobble(x.cpu);
  return {
    id: `${x.type}/${x.vmid}`, type: x.type, node: NODE, vmid: x.vmid, name: x.name, status: x.status, tags: x.tags, pool: x.pool,
    cpu: run ? x.cpu : 0, maxcpu: x.cores, mem: run ? Math.round(x.memory * MB * (0.32 + x.cpu)) : 0, maxmem: x.memory * MB,
    disk: x.type === "lxc" ? Math.round(x.disk * GB * (0.25 + (x.vmid % 5) / 10)) : 0, maxdisk: x.disk * GB,
    uptime: run ? now() - x.started : 0, ...counters(x), template: 0,
  };
}

/** Compteurs cumulés (octets) qui avancent avec le temps, avec un peu de bruit. */
function counters(x: Guest) {
  if (x.status !== "running") return { netin: 0, netout: 0, diskread: 0, diskwrite: 0 };
  const t = Date.now() / 1000 - x.started;
  // Intégrale de rate × (1 + 0,6 cos) : un débit qui varie doucement entre 0,4 et 1,6 × rate
  const f = (rate: number) => Math.round(rate * (t + 0.6 * 40 * Math.sin(t / 40 + x.vmid)));
  return { netin: f(((x.vmid % 5) + 1) * 42000), netout: f(((x.vmid % 3) + 1) * 15000), diskread: f(((x.vmid % 4) + 1) * 90000), diskwrite: f(((x.vmid % 6) + 1) * 30000) };
}

function nodeStatus() {
  const s = S();
  s.load = wobble(s.load, 0.02);
  const running = s.guests.filter((x) => x.status === "running").map(resource);
  const mem = running.reduce((a, r) => a + r.mem, 0) + 3.1 * GB;
  return {
    cpu: Math.min(1, running.reduce((a, r) => a + r.cpu * r.maxcpu, 0) / 16 + 0.03),
    maxcpu: 16, mem, maxmem: 64 * GB, disk: 21 * GB, maxdisk: 94 * GB, uptime: 23 * DAY + 4211,
  };
}

function storages() {
  const used = S().guests.reduce((a, x) => a + x.disk * GB * 0.6, 0);
  const backupUsed = (S().content["backup-nas"] ?? []).reduce((a, c) => a + c.size, 0) + 1.2e12;
  return [
    { storage: "local", type: "dir", content: "iso,vztmpl,backup", shared: 0, active: 1, enabled: 1, used: 21 * GB, total: 94 * GB, avail: 73 * GB, used_fraction: 21 / 94 },
    { storage: "local-lvm", type: "lvmthin", content: "images,rootdir", shared: 0, active: 1, enabled: 1, used, total: 832 * GB, avail: 832 * GB - used, used_fraction: used / (832 * GB) },
    { storage: "backup-nas", type: "nfs", content: "backup", shared: 1, active: 1, enabled: 1, used: backupUsed, total: 1.8e12, avail: 1.8e12 - backupUsed, used_fraction: backupUsed / 1.8e12 },
  ];
}

function rrd(kind: "node" | "guest" | "storage", x?: Guest, timeframe = "hour", storage?: string) {
  const step = timeframe === "week" ? 1800 : timeframe === "day" ? 600 : 60;
  const count = 70;
  const pts: Any[] = [];
  const ns = kind === "node" ? nodeStatus() : null;
  const base = ns ? ns.cpu : x && x.status === "running" ? x.cpu : 0;
  const maxmem = kind === "node" ? 64 * GB : (x?.memory ?? 512) * MB;
  const memBase = ns ? ns.mem / maxmem : 0.33;
  for (let i = count; i >= 0; i--) {
    const on = kind !== "guest" || x?.status === "running";
    const time = now() - i * step;
    if (kind === "storage") {
      // Remplissage lent et régulier : sert au calcul « plein dans N jours »
      const st = storages().find((z) => z.storage === storage) ?? storages()[1];
      const growth = storage === "local" ? 0 : storage === "backup-nas" ? 0.0012 : 0.0004;
      pts.push({ time, total: st.total, used: st.used * (1 - i * growth) });
      continue;
    }
    pts.push({
      time,
      cpu: on ? Math.max(0, base + Math.sin(i / 6) * 0.04 + (Math.random() - 0.5) * 0.03) : 0,
      iowait: on ? 0.002 + Math.random() * 0.01 : 0,
      loadavg: on ? 1.2 + Math.sin(i / 9) * 0.4 : 0,
      memused: on ? maxmem * (memBase + Math.sin(i / 11) * 0.02) : 0,
      memtotal: maxmem,
      mem: on ? maxmem * (0.35 + Math.sin(i / 11) * 0.05) : 0,
      maxmem,
      netin: on ? 120000 + Math.random() * 400000 : 0,
      netout: on ? 40000 + Math.random() * 150000 : 0,
      swapused: kind === "node" ? 0.2 * GB : 0,
      swaptotal: kind === "node" ? 8 * GB : 0,
      ...(kind === "node" ? {
        pressurecpusome: on ? 0.8 + Math.abs(Math.sin(i / 7)) * 2 : 0,
        pressureiosome: on ? 0.3 + Math.random() * 0.6 : 0,
        pressurememorysome: 0.05,
      } : {}),
    });
  }
  return pts;
}

const SYSLOG = () => {
  const t = new Date();
  const fmt = (minsAgo: number) => new Date(t.getTime() - minsAgo * 60000).toISOString().slice(0, 19).replace("T", " ");
  return [
    `${fmt(240)} pve pvedaemon[1432]: authentication failure; rhost=::ffff:10.0.1.77 user=root@pam msg=Authentication failure`,
    `${fmt(239)} pve pvedaemon[1432]: authentication failure; rhost=::ffff:10.0.1.77 user=root@pam msg=Authentication failure`,
    `${fmt(180)} pve pvedaemon[1433]: <root@pam> successful auth for user 'root@pam'`,
    `${fmt(95)} pve pvedaemon[1433]: authentication failure; rhost=::ffff:192.168.1.44 user=admin@pve msg=no such user ('admin@pve')`,
    `${fmt(12)} pve pvedaemon[1431]: <root@pam> successful auth for user 'root@pam'`,
  ].map((t2, i) => ({ n: i + 1, t: t2 }));
};

/** Point d'entrée : imite un appel à l'API Proxmox. */
export function mockRequest(method: string, path: string, p: Params = {}): Any {
  const s = S();
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  const route = `${method} /${seg.join("/")}`;

  // ── Accès et utilisateurs ────────────────────────────────────────
  if (route === "GET /version") return { version: "8.4.1", release: "8.4", repoid: "2a5fa54a" };
  if (route === "GET /access/domains") return [{ realm: "pam", type: "pam", comment: "Linux PAM standard authentication" }, { realm: "pve", type: "pve", comment: "Proxmox VE authentication server", default: 1 }];
  if (route === "POST /access/ticket") return { ticket: "PVE:demo@pve:DEMO", CSRFPreventionToken: "demo", username: String(p.username ?? "demo@pve") };
  if (route === "GET /access/permissions") {
    // Le compte démo est administrateur : tous les droits partout
    const paths = ["/", "/vms", "/storage", "/nodes", "/pool", "/access", "/sdn", "/mapping", ...s.guests.map((x) => `/vms/${x.vmid}`), `/nodes/${NODE}`];
    const all = Object.fromEntries(paths.map((x) => [x, ALL_PRIVS]));
    return p.path ? { [String(p.path)]: ALL_PRIVS } : all;
  }
  if (route === "GET /pools") return [...new Set(s.guests.map((x) => x.pool).filter(Boolean))].map((poolid) => ({ poolid, comment: poolid === "infra" ? "Services de base" : "" }));
  if (route === "GET /access/users") {
    return [
      { userid: "root@pam", enable: 1, expire: 0, "realm-type": "pam", tfa_locked_until: undefined, tokens: [] },
      { userid: "ethan@pve", enable: 1, expire: 0, "realm-type": "pve", firstname: "Ethan", tokens: [{ tokenid: "laptop", privsep: 1, expire: 0 }] },
      { userid: "myproxmox@pve", enable: 1, expire: 0, "realm-type": "pve", comment: "Compte de service MyProxmox", tokens: [{ tokenid: "service", privsep: 0, expire: 0 }] },
      { userid: "backup@pve", enable: 0, expire: 0, "realm-type": "pve", tokens: [] },
    ];
  }
  if (route === "GET /access/tfa") return [{ userid: "ethan@pve", entries: [{ type: "totp", id: "totp-1", description: "Téléphone", enable: 1 }] }];
  if (route === "GET /access/acl") return [{ path: "/", ugid: "ethan@pve", type: "user", roleid: "PVEAdmin", propagate: 1 }, { path: "/", ugid: "myproxmox@pve", type: "user", roleid: "MyProxmoxService", propagate: 1 }];

  // ── Cluster ──────────────────────────────────────────────────────
  if (route === "GET /cluster/status") return [{ type: "node", name: NODE, online: 1, local: 1, ip: "10.0.1.101", level: "" }];
  if (route === "GET /cluster/nextid") {
    let id = 100;
    while (s.guests.some((x) => x.vmid === id)) id++;
    return String(id);
  }
  if (route === "GET /cluster/resources") {
    const n = nodeStatus();
    const list: Any[] = [
      { id: `node/${NODE}`, type: "node", node: NODE, status: "online", level: "", ...n },
      ...s.guests.map(resource),
      ...storages().map((st) => ({ id: `storage/${NODE}/${st.storage}`, type: "storage", node: NODE, storage: st.storage, plugintype: st.type, status: "available", disk: st.used, maxdisk: st.total, content: st.content, shared: st.shared })),
      ...[...new Set(s.guests.map((x) => x.pool).filter(Boolean))].map((pool) => ({ id: `/pool/${pool}`, type: "pool", pool })),
    ];
    if (p.type === "vm") return list.filter((r) => r.type === "qemu" || r.type === "lxc");
    if (p.type === "storage") return list.filter((r) => r.type === "storage");
    if (p.type === "node") return list.filter((r) => r.type === "node");
    if (p.type === "pool") return list.filter((r) => r.type === "pool");
    return list;
  }
  if (route === "GET /cluster/tasks") return s.tasks.slice(0, 60).map(({ log, ...t }) => t);
  if (route === "GET /cluster/backup") return [{ id: "backup-nightly", enabled: 1, schedule: "02:00", storage: "backup-nas", vmid: "100,101,102,104,106", mode: "snapshot", compress: "zstd", "next-run": now() + 8 * 3600 }];
  if (route === "GET /cluster/backup-info/not-backed-up") return s.guests.filter((x) => ![100, 101, 102, 104, 106].includes(x.vmid)).map((x) => ({ vmid: x.vmid, name: x.name, type: x.type }));
  if (route === "GET /cluster/firewall/options") return { enable: 0, policy_in: "DROP", policy_out: "ACCEPT" };
  if (route === "GET /cluster/ha/status/current") {
    return [
      { id: "quorum", type: "quorum", status: "OK", quorate: 1, node: NODE },
      ...s.ha.map((h) => ({ id: `service:${h.sid}`, type: "service", sid: h.sid, state: h.state, node: NODE, status: `${h.state} (${NODE})` })),
    ];
  }
  if (route === "GET /cluster/ha/resources") return s.ha.map((h) => ({ sid: h.sid, type: h.sid.split(":")[0], state: h.state, group: h.group, comment: h.comment, max_restart: 1, max_relocate: 1 }));

  if (seg[0] !== "nodes") fail(501, `Chemin non simulé dans la démo : ${route}`);
  if (seg.length === 1 && method === "GET") return [{ node: NODE, status: "online", ...nodeStatus(), level: "", ssl_fingerprint: "AB:CD" }];
  const rest = seg.slice(2);
  const r = `${method} /${rest.join("/")}`;

  // ── Nœud ─────────────────────────────────────────────────────────
  if (r === "GET /status") {
    const n = nodeStatus();
    return {
      cpu: n.cpu, wait: 0.004, uptime: n.uptime, loadavg: [(s.load * 10).toFixed(2), "1.12", "0.98"],
      memory: { used: n.mem, total: n.maxmem, free: Math.round((n.maxmem - n.mem) * 0.45), available: n.maxmem - n.mem },
      swap: { used: 0.2 * GB, total: 8 * GB, free: 7.8 * GB },
      rootfs: { used: n.disk, total: n.maxdisk, avail: n.maxdisk - n.disk },
      ksm: { shared: 1.4 * GB },
      cpuinfo: { model: "AMD Ryzen 7 5700G with Radeon Graphics", cpus: 16, sockets: 1, cores: 8, mhz: "3800.000", flags: "svm" },
      "boot-info": { mode: "efi", secureboot: 0 },
      "current-kernel": { release: "6.8.12-4-pve", sysname: "Linux" },
      kversion: "Linux 6.8.12-4-pve #1 SMP PREEMPT_DYNAMIC PMX 6.8.12-4",
      pveversion: "pve-manager/8.4.1/2a5fa54a8503f96d",
    };
  }
  if (r === "GET /rrddata") return rrd("node", undefined, String(p.timeframe ?? "hour"));
  if (r === "GET /network") {
    return [
      { iface: "lo", type: "loopback", active: 1, autostart: 1, method: "loopback" },
      { iface: "enp3s0", type: "eth", active: 1, autostart: 0, method: "manual", exists: 1 },
      { iface: "enp4s0", type: "eth", active: 0, autostart: 0, method: "manual", exists: 1 },
      { iface: "vmbr0", type: "bridge", active: 1, autostart: 1, method: "static", cidr: "10.0.1.101/24", address: "10.0.1.101", netmask: "24", gateway: "10.0.1.1", bridge_ports: "enp3s0", bridge_vlan_aware: 1, comments: "Réseau principal" },
      { iface: "vmbr1", type: "bridge", active: 1, autostart: 1, method: "static", cidr: "192.168.50.1/24", bridge_ports: "", comments: "Lab isolé" },
    ];
  }
  if (r === "GET /netstat") {
    return s.guests.filter((x) => x.status === "running").map((x) => {
      const c = counters(x);
      return { dev: `${x.type === "qemu" ? "tap" : "veth"}${x.vmid}i0`, vmid: String(x.vmid), in: String(c.netin), out: String(c.netout) };
    });
  }
  if (r === "GET /dns") return { search: "maison.lan", dns1: "10.0.1.53", dns2: "1.1.1.1" };
  if (r === "GET /time") return { timezone: "Europe/Paris", localtime: now() + 3600, time: now() };
  if (r === "GET /services") {
    return ["pveproxy", "pvedaemon", "pvestatd", "pve-cluster", "pve-firewall", "chronyd", "sshd", "postfix", "cron", "spiceproxy", "corosync"].map((name) => ({
      name, service: name, state: name === "corosync" ? "stopped" : "running", "active-state": name === "corosync" ? "inactive" : "active", "unit-state": name === "corosync" ? "disabled" : "enabled",
      desc: { pveproxy: "Interface web et API", pvedaemon: "Démon de l'API", pvestatd: "Collecte des statistiques", "pve-cluster": "Système de fichiers du cluster", "pve-firewall": "Pare-feu Proxmox", chronyd: "Synchronisation de l'heure", sshd: "Serveur SSH", postfix: "Envoi de mails", cron: "Tâches planifiées", spiceproxy: "Proxy SPICE", corosync: "Communication du cluster (inutile sur un seul nœud)" }[name],
    }));
  }
  if (r === "GET /disks/list") {
    return [
      { devpath: "/dev/nvme0n1", model: "Samsung SSD 980 PRO 1TB", serial: "S5GXNF0R123456", size: 1000 * GB, type: "nvme", health: "PASSED", wearout: 91, used: "LVM", gpt: 1 },
      { devpath: "/dev/sda", model: "WDC WD40EFRX-68N32N0", serial: "WD-WCC7K1234567", size: 4000 * GB, type: "hdd", health: "PASSED", wearout: "N/A", rpm: 5400, used: "ZFS", gpt: 1 },
      { devpath: "/dev/sdb", model: "WDC WD40EFRX-68N32N0", serial: "WD-WCC7K7654321", size: 4000 * GB, type: "hdd", health: "FAILED", wearout: "N/A", rpm: 5400, used: "ZFS", gpt: 1 },
    ];
  }
  if (r === "GET /disks/smart") {
    if (String(p.disk).includes("nvme")) {
      return { health: "PASSED", type: "text", text: "SMART/Health Information (NVMe Log 0x02)\nCritical Warning: 0x00\nTemperature: 44 Celsius\nAvailable Spare: 100%\nPercentage Used: 9%\nData Units Read: 41,234,112\nData Units Written: 38,102,554\nPower On Hours: 9,812\nUnsafe Shutdowns: 12\nMedia and Data Integrity Errors: 0" };
    }
    const failed = String(p.disk) === "/dev/sdb";
    return {
      health: failed ? "FAILED" : "PASSED", type: "ata",
      attributes: [
        { id: "5", name: "Reallocated_Sector_Ct", value: failed ? 12 : 100, worst: failed ? 12 : 100, threshold: 140, raw: failed ? "1832" : "0", fail: failed ? "FAILING_NOW" : "-" },
        { id: "9", name: "Power_On_Hours", value: 52, worst: 52, threshold: 0, raw: "35120", fail: "-" },
        { id: "194", name: "Temperature_Celsius", value: 116, worst: 105, threshold: 0, raw: failed ? "41" : "36", fail: "-" },
        { id: "197", name: "Current_Pending_Sector", value: failed ? 1 : 200, worst: 1, threshold: 0, raw: failed ? "64" : "0", fail: "-" },
      ],
    };
  }
  if (r === "GET /disks/zfs") return [{ name: "tank", size: 4000 * GB, alloc: 1.9e12, free: 2.1e12, frag: 12, dedup: 1, health: "DEGRADED" }];
  if (r === "GET /apt/update") {
    return [
      { Package: "pve-manager", OldVersion: "8.4.1", Version: "8.4.5", Priority: "important", Origin: "Proxmox", Section: "admin", Title: "Interface et API de Proxmox VE" },
      { Package: "proxmox-kernel-6.8", OldVersion: "6.8.12-4", Version: "6.8.12-9", Priority: "optional", Origin: "Proxmox", Section: "kernel", Title: "Noyau Linux Proxmox" },
      { Package: "openssl", OldVersion: "3.0.15-1~deb12u1", Version: "3.0.16-1~deb12u1", Priority: "optional", Origin: "Debian", Section: "utils", Title: "Boîte à outils TLS (correctif de sécurité)" },
      { Package: "libc6", OldVersion: "2.36-9+deb12u9", Version: "2.36-9+deb12u10", Priority: "required", Origin: "Debian", Section: "libs", Title: "Bibliothèque C (correctif de sécurité)" },
    ];
  }
  if (r === "GET /certificates/info") {
    return [
      { filename: "pve-root-ca.pem", subject: "/CN=Proxmox Virtual Environment/OU=abc/O=PVE Cluster Manager CA", issuer: "PVE Cluster Manager CA", notafter: now() + 3200 * DAY, notbefore: now() - 400 * DAY, fingerprint: "AA:BB" },
      { filename: "pve-ssl.pem", subject: `/CN=${NODE}.maison.lan`, issuer: "PVE Cluster Manager CA", notafter: now() + 9 * DAY, notbefore: now() - 721 * DAY, san: [`${NODE}.maison.lan`, "10.0.1.101"], fingerprint: "CC:DD" },
    ];
  }
  if (r === "GET /subscription") return { status: "notfound", message: "There is no subscription key" };
  if (r === "GET /syslog" || r === "GET /journal") return SYSLOG();
  if (r === "GET /firewall/options") return { enable: 1 };
  if (r === "GET /hosts") return { data: "127.0.0.1 localhost\n10.0.1.101 pve.maison.lan pve\n" };

  // ── Stockage ─────────────────────────────────────────────────────
  if (r === "GET /storage") {
    const list = storages();
    return p.content ? list.filter((x) => x.content.includes(String(p.content))) : list;
  }
  if (/^GET \/storage\/[^/]+\/rrddata$/.test(r)) return rrd("storage", undefined, String(p.timeframe ?? "week"), rest[1]);
  if (/^GET \/storage\/[^/]+\/content$/.test(r)) {
    const st = rest[1];
    const own = st === "local-lvm"
      ? s.guests.map((x) => ({ volid: `local-lvm:${x.type === "qemu" ? "vm" : "subvol"}-${x.vmid}-disk-0`, content: x.type === "qemu" ? "images" : "rootdir", format: "raw", size: x.disk * GB, vmid: x.vmid }))
      : [];
    return [...(s.content[st] ?? []), ...own]
      .filter((c) => !p.content || c.content === p.content)
      .filter((c) => !p.vmid || Number(c.vmid) === Number(p.vmid));
  }
  if (/^DELETE \/storage\/[^/]+\/content\/.+$/.test(r)) {
    const volid = rest.slice(3).join("/");
    s.content[rest[1]] = (s.content[rest[1]] ?? []).filter((c) => c.volid !== volid);
    return addTask("imgdel", volid);
  }
  if (/^POST \/storage\/[^/]+\/download-url$/.test(r)) {
    const kind = p.content === "vztmpl" ? "vztmpl" : "iso";
    (s.content[rest[1]] ??= []).push({ volid: `${rest[1]}:${kind}/${p.filename}`, content: kind, format: kind, size: 700 * MB, ctime: now() });
    return addTask("download", String(p.filename), [`downloading ${p.url}`, "download of '...' finished"]);
  }
  if (r === "GET /aplinfo") {
    return [
      { template: "debian-12-standard_12.7-1_amd64.tar.zst", section: "system", os: "debian-12", headline: "Debian 12 Bookworm (standard)" },
      { template: "ubuntu-24.04-standard_24.04-2_amd64.tar.zst", section: "system", os: "ubuntu-24.04", headline: "Ubuntu 24.04 Noble (standard)" },
      { template: "alpine-3.20-default_20240908_amd64.tar.xz", section: "system", os: "alpine-3.20", headline: "Alpine Linux 3.20" },
      { template: "rockylinux-9-default_20240912_amd64.tar.xz", section: "system", os: "rockylinux-9", headline: "Rocky Linux 9" },
      { template: "archlinux-base_20240911-1_amd64.tar.zst", section: "system", os: "archlinux", headline: "Arch Linux base" },
    ];
  }
  if (r === "POST /aplinfo") {
    (s.content[String(p.storage)] ??= []).push({ volid: `${p.storage}:vztmpl/${p.template}`, content: "vztmpl", format: "tzst", size: 130 * MB, ctime: now() });
    return addTask("download", String(p.template));
  }

  // ── Tâches ───────────────────────────────────────────────────────
  if (rest[0] === "tasks" && rest[1]) {
    const t = s.tasks.find((x) => x.upid === rest[1]);
    if (rest[2] === "log") return (t?.log ?? ["(journal vide)"]).map((tx, i) => ({ n: i + 1, t: tx }));
    if (rest[2] === "status") return { status: "stopped", exitstatus: t?.status ?? "OK", type: t?.type, id: t?.id };
  }
  if (r === "GET /tasks") return s.tasks.slice(0, 50).map(({ log, ...t }) => t);

  // ── Sauvegardes ──────────────────────────────────────────────────
  if (r === "POST /vzdump") {
    const ids = String(p.vmid).split(",");
    for (const id of ids) {
      const x = findGuest(id);
      const st = String(p.storage ?? "backup-nas");
      const d = new Date();
      const stamp = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, "0")}_${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}_${String(d.getMinutes()).padStart(2, "0")}_00`;
      (s.content[st] ??= []).push({ volid: `${st}:backup/vzdump-${x.type}-${x.vmid}-${stamp}.${x.type === "qemu" ? "vma.zst" : "tar.zst"}`, content: "backup", format: "zst", size: x.disk * GB * 0.18, ctime: now(), vmid: x.vmid });
    }
    return addTask("vzdump", ids.length === 1 ? ids[0] : "", [`INFO: starting new backup job: vzdump ${ids.join(" ")}`, "INFO: Backup job finished successfully"]);
  }

  // ── Création / restauration ──────────────────────────────────────
  if (r === "POST /qemu" || r === "POST /lxc") {
    const type = rest[0] as "qemu" | "lxc";
    const vmid = Number(p.vmid);
    if (p.archive || p.restore) {
      findGuest(vmid).status = "stopped";
      return addTask(type === "qemu" ? "qmrestore" : "vzrestore", String(vmid));
    }
    if (s.guests.some((x) => x.vmid === vmid)) fail(500, `VM ${vmid} already exists`);
    const diskSpec = String(type === "qemu" ? p.scsi0 : p.rootfs ?? "local-lvm:8");
    s.guests.push(guest(vmid, String(p.name ?? p.hostname ?? `vm-${vmid}`), type, !!Number(p.start ?? 0), Number(p.cores ?? 1), Number(p.memory ?? 512), parseInt(diskSpec.split(":")[1], 10) || 8, String(p.tags ?? ""), { onboot: Number(p.onboot ?? 0) }));
    s.guests.sort((a, b) => a.vmid - b.vmid);
    return addTask(type === "qemu" ? "qmcreate" : "vzcreate", String(vmid));
  }

  // ── Routes par machine ───────────────────────────────────────────
  if (rest[0] === "qemu" || rest[0] === "lxc") {
    if (rest.length === 1) return s.guests.filter((x) => x.type === rest[0]).map(resource);
    const x = findGuest(rest[1]);
    const sub = rest.slice(2).join("/");
    const pfx = x.type === "qemu" ? "qm" : "vz";
    if (method === "GET" && sub === "status/current") return { ...resource(x), qmpstatus: x.status, agent: x.agent ? 1 : 0, ha: { managed: 0 } };
    if (method === "GET" && sub === "config") {
      return x.type === "qemu"
        ? { name: x.name, cores: x.cores, sockets: 1, memory: String(x.memory), ostype: "l26", onboot: x.onboot, tags: x.tags, agent: x.agent ? "1" : "0", cpu: "host", scsi0: `local-lvm:vm-${x.vmid}-disk-0,iothread=1,size=${x.disk}G`, net0: `virtio=${x.mac},bridge=${x.bridge}${x.firewall ? ",firewall=1" : ""}`, boot: "order=scsi0;ide2", scsihw: "virtio-scsi-single", description: x.description, bios: "ovmf", machine: "q35" }
        : { hostname: x.name, cores: x.cores, memory: x.memory, swap: 512, ostype: "debian", onboot: x.onboot, tags: x.tags, rootfs: `local-lvm:subvol-${x.vmid}-disk-0,size=${x.disk}G`, net0: `name=eth0,bridge=${x.bridge},hwaddr=${x.mac},ip=dhcp,type=veth${x.firewall ? ",firewall=1" : ""}`, unprivileged: 1, features: "nesting=1", description: x.description };
    }
    if ((method === "PUT" || method === "POST") && sub === "config") {
      if (p.cores) x.cores = Number(p.cores);
      if (p.memory) x.memory = Number(p.memory);
      if (p.name) x.name = String(p.name);
      if (p.hostname) x.name = String(p.hostname);
      if (p.onboot !== undefined) x.onboot = Number(p.onboot);
      if (p.tags !== undefined) x.tags = String(p.tags);
      if (p.description !== undefined) x.description = String(p.description);
      return null;
    }
    if (method === "GET" && sub === "rrddata") return rrd("guest", x, String(p.timeframe ?? "hour"));
    if (method === "GET" && sub === "agent/network-get-interfaces") {
      if (!x.agent || x.status !== "running") fail(500, "QEMU guest agent is not running");
      return { result: [
        { name: "lo", "hardware-address": "00:00:00:00:00:00", "ip-addresses": [{ "ip-address": "127.0.0.1", "ip-address-type": "ipv4", prefix: 8 }] },
        { name: "ens18", "hardware-address": x.mac.toLowerCase(), "ip-addresses": [{ "ip-address": x.ip, "ip-address-type": "ipv4", prefix: 24 }, { "ip-address": `fe80::be24:11ff:fe${x.vmid}:4e01`, "ip-address-type": "ipv6", prefix: 64 }] },
      ] };
    }
    if (method === "GET" && sub === "interfaces") {
      if (x.status !== "running") fail(500, "CT is not running");
      return [
        { name: "lo", hwaddr: "00:00:00:00:00:00", inet: "127.0.0.1/8" },
        { name: "eth0", hwaddr: x.mac.toLowerCase(), inet: `${x.ip}/24`, inet6: `fe80::be24:11ff:fe${x.vmid}:4e01/64` },
      ];
    }
    if (method === "GET" && sub === "firewall/options") return { enable: x.firewall ? 1 : 0, policy_in: "DROP" };
    if (method === "POST" && sub.startsWith("status/")) {
      const action = sub.split("/")[1];
      if (action === "start" && x.status === "running") fail(500, "VM already running");
      if ((action === "shutdown" || action === "stop") && x.status === "stopped") fail(500, "VM not running");
      if (action === "start" || action === "reboot") Object.assign(x, { status: "running", started: now(), cpu: 0.05 });
      if (action === "shutdown" || action === "stop") Object.assign(x, { status: "stopped", cpu: 0 });
      return addTask(`${pfx}${action}`, String(x.vmid));
    }
    if (method === "GET" && sub === "snapshot") return [...x.snapshots, { name: "current", description: "You are here!", running: x.status === "running" ? 1 : 0 }];
    if (method === "POST" && sub === "snapshot") {
      if (!/^[a-zA-Z][\w-]*$/.test(String(p.snapname))) fail(400, "snapname: invalid format");
      if (x.snapshots.some((sn) => sn.name === p.snapname)) fail(500, `snapshot name '${p.snapname}' already used`);
      x.snapshots.push({ name: String(p.snapname), description: String(p.description ?? ""), snaptime: now() });
      return addTask(`${pfx}snapshot`, String(x.vmid));
    }
    if (method === "POST" && /^snapshot\/[^/]+\/rollback$/.test(sub)) return addTask(`${pfx}rollback`, String(x.vmid));
    if (method === "DELETE" && /^snapshot\/[^/]+$/.test(sub)) {
      x.snapshots = x.snapshots.filter((sn) => sn.name !== rest[3]);
      return addTask(`${pfx}delsnapshot`, String(x.vmid));
    }
    if (method === "DELETE" && sub === "") {
      if (x.status === "running") fail(500, "VM is running - destroy failed");
      s.guests = s.guests.filter((v) => v.vmid !== x.vmid);
      return addTask(`${pfx}destroy`, String(x.vmid));
    }
  }
  fail(501, `Chemin non simulé dans la démo : ${route}`);
}

/** Remet la démo à zéro. */
export function resetMock() {
  g.__myproxmoxMock = init();
}

import { newFirewall, type FwStore } from "./mock-firewall";

// État du faux Proxmox (mode démo) et petites aides partagées par les routes simulées.
// Voir shared/mock.ts pour le point d'entrée.
export type Any = any;
export type Params = Record<string, unknown>;

export const GB = 1024 ** 3;
export const MB = 1024 ** 2;
export const now = () => Math.floor(Date.now() / 1000);
export const DAY = 86400;
export const NODE = "pve";
export const NODE2 = "pve2"; // second nœud du cluster de démo (cible de migration)
export const NODES = [NODE, NODE2];

export interface Guest {
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
  snapshots: Snap[];
  pool?: string;
  node: string;
  conf: Record<string, string>; // configuration complète, comme dans /etc/pve
  template: boolean;
  parent?: string; // snapshot dont dérive l'état actuel
  fw: FwStore;
  frozen?: boolean; // systèmes de fichiers gelés par l'agent
}
export interface Snap { name: string; description: string; snaptime: number; parent?: string; vmstate?: number; conf?: Record<string, string> }

export interface Task {
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

export interface HaResource { sid: string; state: string; group?: string; comment?: string }

export interface AclEntry { path: string; type: "user" | "group" | "token"; ugid: string; roleid: string; propagate: number }
export interface ReplJob { id: string; guest: number; target: string; schedule: string; type: string; jobnum: number; comment?: string; rate?: number; disable?: number; last_sync?: number; fail_count?: number }

export interface State {
  acl: AclEntry[];
  replication: ReplJob[];
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
export const ALL_PRIVS = Object.fromEntries(PVE_PRIVS.map((p) => [p, 1]));

export function mac(vmid: number) {
  return `BC:24:11:${(vmid % 256).toString(16).padStart(2, "0").toUpperCase()}:4E:${(vmid * 7 % 256).toString(16).padStart(2, "0").toUpperCase()}`;
}

export function guest(vmid: number, name: string, type: "qemu" | "lxc", running: boolean, cores: number, memory: number, disk: number, tags: string, extra: Partial<Guest> = {}): Guest {
  const x: Guest = {
    node: NODE, conf: {}, template: false, fw: newFirewall({ enable: vmid % 2 === 0 ? 1 : 0 }, vmid === 101 ? [
      { type: "in", action: "ACCEPT", macro: "SSH", source: "10.0.1.0/24", enable: 1, comment: "SSH depuis le LAN" },
      { type: "in", action: "ACCEPT", proto: "tcp", dport: "8123", enable: 1, comment: "Interface Home Assistant" },
      { type: "in", action: "DROP", enable: 0, comment: "Tout le reste (désactivée)" },
    ] : []),
    vmid, name, type, status: running ? "running" : "stopped", cpu: running ? 0.02 + (vmid % 7) / 40 : 0,
    cores, memory, disk, started: running ? now() - 3600 * (5 + (vmid % 40)) : 0, onboot: running ? 1 : 0,
    tags, ip: `10.0.1.${vmid - 50}`, mac: mac(vmid), bridge: "vmbr0", agent: type === "qemu", firewall: vmid % 2 === 0,
    description: "", snapshots: [], ...extra,
  };
  if (!Object.keys(x.conf).length) x.conf = buildConf(x);
  return x;
}

// ── Configuration complète d'une machine ─────────────────────────────
export const QEMU_DISK = /^(scsi|virtio|sata|ide)\d+$/;
export const isCdrom = (v = "") => /media=cdrom/.test(v);
/** Clés de config qui portent un volume (disque, point de montage, disque inutilisé). */
export function isVolumeKey(type: "qemu" | "lxc", k: string, v = "") {
  if (/^unused\d+$/.test(k)) return true;
  if (type === "lxc") return k === "rootfs" || /^mp\d+$/.test(k);
  return (QEMU_DISK.test(k) && !isCdrom(v)) || k === "efidisk0" || k === "tpmstate0";
}
export const sizeOf = (v = "") => {
  const m = v.match(/size=(\d+(?:\.\d+)?)([KMGT])?/);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === "T" ? n * 1024 : m[2] === "M" ? n / 1024 : m[2] === "K" ? n / 1024 / 1024 : n;
};

export function buildConf(x: Guest): Record<string, string> {
  const net = x.type === "qemu"
    ? `virtio=${x.mac},bridge=${x.bridge}${x.firewall ? ",firewall=1" : ""}`
    : `name=eth0,bridge=${x.bridge},hwaddr=${x.mac},ip=${x.ip ? `${x.ip}/24,gw=10.0.1.1` : "dhcp"},type=veth${x.firewall ? ",firewall=1" : ""}`;
  const common = { cores: String(x.cores), memory: String(x.memory), onboot: String(x.onboot), net0: net, ...(x.tags ? { tags: x.tags } : {}), ...(x.description ? { description: x.description } : {}) };
  if (x.type === "lxc") {
    return {
      ...common, hostname: x.name, swap: "512", ostype: x.vmid === 106 ? "alpine" : "debian", arch: "amd64", unprivileged: "1", features: "nesting=1",
      rootfs: `local-lvm:subvol-${x.vmid}-disk-0,size=${x.disk}G`,
      ...(x.vmid === 104 ? { mp0: `local-lvm:subvol-104-disk-1,mp=/mnt/data,backup=1,size=200G` } : {}),
      ...(x.vmid === 100 ? { nameserver: "1.1.1.1", searchdomain: "maison.lan", startup: "order=1,up=10" } : {}),
    };
  }
  const win = x.vmid === 105;
  return {
    ...common, name: x.name, sockets: "1", cpu: win ? "host" : "x86-64-v2-AES", ostype: win ? "win11" : "l26", numa: "0",
    agent: x.agent ? "1" : "0", scsihw: "virtio-scsi-single", machine: win ? "pc-q35-8.1" : "q35", bios: win ? "ovmf" : "seabios",
    scsi0: `local-lvm:vm-${x.vmid}-disk-0,iothread=1,discard=on,ssd=1,size=${x.disk}G`,
    ide2: win ? "local:iso/virtio-win-0.1.262.iso,media=cdrom,size=708M" : "none,media=cdrom",
    boot: "order=scsi0;ide2;net0", balloon: String(Math.round(x.memory / 2)), vga: win ? "virtio" : "std",
    smbios1: `uuid=4b1c${x.vmid}a2-0c0e-4b5f-9e1d-1f2a3b4c5d6e`, vmgenid: `a1b2c3d4-${x.vmid}0-4e5f-8a9b-0c1d2e3f4a5b`,
    ...(win ? { efidisk0: `local-lvm:vm-105-disk-1,efitype=4m,pre-enrolled-keys=1,size=4M`, tpmstate0: `local-lvm:vm-105-disk-2,size=4M,version=v2.0`, usb0: "host=046d:c52b,usb3=1" } : {}),
    ...(x.vmid === 107 ? {
      ide0: "local-lvm:vm-107-cloudinit,media=cdrom", ciuser: "ethan", ipconfig0: "ip=10.0.1.57/24,gw=10.0.1.1",
      sshkeys: encodeURIComponent("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExempleDeCleDemo ethan@portable"), nameserver: "10.0.1.53", searchdomain: "maison.lan",
      startup: "order=2,up=30,down=60", protection: "1",
    } : {}),
    ...(x.vmid === 101 ? { hostpci0: "mapping=zigbee-usb,pcie=1", rng0: "source=/dev/urandom", serial0: "socket" } : {}),
  };
}

/** Recopie dans les champs simples ce que la config contient (nom, cœurs, disque...). */
export function syncFromConf(x: Guest) {
  const c = x.conf;
  x.name = c.name ?? c.hostname ?? x.name;
  x.cores = Number(c.cores ?? 1) * Number(c.sockets ?? 1);
  x.memory = Number(c.memory ?? 512);
  x.onboot = Number(c.onboot ?? 0);
  x.tags = c.tags ?? "";
  x.description = c.description ?? "";
  x.agent = String(c.agent ?? "0").startsWith("1");
  const main = x.type === "lxc" ? c.rootfs : c.scsi0 ?? c.virtio0 ?? c.sata0 ?? c.ide0;
  if (main) x.disk = sizeOf(main) || x.disk;
  const net = c.net0 ?? "";
  x.bridge = net.match(/bridge=([^,]+)/)?.[1] ?? x.bridge;
  x.firewall = /firewall=1/.test(net);
}

export function init(): State {
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
  guests[0].snapshots = [{ name: "avant-maj", description: "Avant mise à jour Pi-hole v6", snaptime: t - 52 * DAY, conf: { ...guests[0].conf } }];
  guests[0].parent = "avant-maj";
  guests[3].snapshots = [
    { name: "propre", description: "Installation fraîche", snaptime: t - 90 * DAY, conf: { ...guests[3].conf } },
    { name: "outils", description: "Avec Burp et Metasploit à jour", snaptime: t - 30 * DAY, parent: "propre", vmstate: 1, conf: { ...guests[3].conf } },
    { name: "test-exploit", description: "Avant un test destructif", snaptime: t - 4 * DAY, parent: "outils", conf: { ...guests[3].conf } },
  ];
  guests[3].parent = "outils";
  guests.push(guest(110, "debian-modele", "qemu", false, 2, 2048, 20, "modele", { template: true, ip: "", node: NODE }));
  guests.push(guest(120, "backup-dns", "lxc", true, 1, 256, 4, "dns", { node: NODE2, ip: "10.0.1.70" }));
  for (const x of guests) {
    if (x.template) {
      x.conf.template = "1";
      x.conf.scsi0 = x.conf.scsi0.replace("vm-110-disk-0", "base-110-disk-0");
    }
  }
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
  const pbsSnap = (vmid: number, type: string, daysAgo: number, size: number) => {
    const d = new Date((t - daysAgo * DAY) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    return { volid: `pbs:backup/${type === "qemu" ? "vm" : "ct"}/${vmid}/${d}`, content: "backup", format: "pbs-" + (type === "qemu" ? "vm" : "ct"), size, ctime: t - daysAgo * DAY, vmid, notes: "Sauvegarde PBS", verification: { state: "ok", upid: "" }, protected: daysAgo > 20 ? 1 : 0 };
  };
  return {
    acl: [
      { path: "/", type: "user", ugid: "ethan@pve", roleid: "PVEAdmin", propagate: 1 },
      { path: "/", type: "user", ugid: "myproxmox@pve", roleid: "MyProxmoxService", propagate: 1 },
      { path: "/vms/101", type: "group", ugid: "famille", roleid: "PVEVMUser", propagate: 1 },
      { path: "/vms/103", type: "user", ugid: "backup@pve", roleid: "PVEAuditor", propagate: 0 },
    ],
    replication: [{ id: "106-0", guest: 106, target: NODE2, schedule: "*/15", type: "local", jobnum: 0, comment: "Vaultwarden en double", last_sync: t - 400, fail_count: 0 }],
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
      pbs: [pbsSnap(101, "qemu", 1, 32 * GB), pbsSnap(101, "qemu", 7, 32 * GB), pbsSnap(107, "qemu", 2, 100 * GB), pbsSnap(102, "lxc", 3, 40 * GB), pbsSnap(101, "qemu", 30, 32 * GB)],
      "backup-nas": [
        backup(100, "lxc", 1, 410 * MB), backup(100, "lxc", 8, 402 * MB),
        backup(101, "qemu", 1, 6.1 * GB), backup(102, "lxc", 2, 1.2 * GB),
        backup(104, "lxc", 12, 18 * GB), backup(106, "lxc", 1, 150 * MB),
      ],
    },
  };
}

export const S = () => (g.__myproxmoxMock ??= init());

export function addTask(type: string, id: string, lines: string[] = [], status = "OK", node = NODE): string {
  const t = now();
  const rand = Math.floor(Math.random() * 0xfffff).toString(16).toUpperCase().padStart(5, "0");
  const upid = `UPID:${node}:000${rand}:00000000:${t.toString(16).toUpperCase()}:${type}:${id}:demo@pve:`;
  S().tasks.unshift({ upid, node, type, id, user: "demo@pve", starttime: t, endtime: t + 1, status, log: [...lines, status === "OK" ? "TASK OK" : `TASK ERROR: ${status}`] });
  return upid;
}

export class MockError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new MockError(status, message);
};

export function findGuest(vmid: unknown) {
  const x = S().guests.find((v) => v.vmid === Number(vmid));
  if (!x) fail(500, `Configuration file 'nodes/${NODE}/qemu-server/${vmid}.conf' does not exist`);
  return x!;
}

/** Variante qui vérifie aussi le type (qemu ou lxc) du chemin. */
export function findTyped(vmid: unknown, type: string) {
  const x = findGuest(vmid);
  if (x.type !== type) fail(500, `Configuration file 'nodes/${x.node}/${type === "qemu" ? "qemu-server" : "lxc"}/${vmid}.conf' does not exist`);
  return x!;
}

export function wobble(v: number, amp = 0.04) {
  return Math.max(0.005, Math.min(0.97, v + (Math.random() - 0.5) * amp));
}

export function resource(x: Guest) {
  const run = x.status === "running";
  if (run) x.cpu = wobble(x.cpu);
  return {
    id: `${x.type}/${x.vmid}`, type: x.type, node: x.node, vmid: x.vmid, name: x.name, status: x.status, tags: x.tags, pool: x.pool,
    cpu: run ? x.cpu : 0, maxcpu: x.cores, mem: run ? Math.round(x.memory * MB * (0.32 + x.cpu)) : 0, maxmem: x.memory * MB,
    disk: x.type === "lxc" ? Math.round(x.disk * GB * (0.25 + (x.vmid % 5) / 10)) : 0, maxdisk: x.disk * GB,
    uptime: run ? now() - x.started : 0, ...counters(x), template: x.template ? 1 : 0, lock: x.conf.lock,
  };
}

/** Compteurs cumulés (octets) qui avancent avec le temps, avec un peu de bruit. */
export function counters(x: Guest) {
  if (x.status !== "running") return { netin: 0, netout: 0, diskread: 0, diskwrite: 0 };
  const t = Date.now() / 1000 - x.started;
  // Intégrale de rate × (1 + 0,6 cos) : un débit qui varie doucement entre 0,4 et 1,6 × rate
  const f = (rate: number) => Math.round(rate * (t + 0.6 * 40 * Math.sin(t / 40 + x.vmid)));
  return { netin: f(((x.vmid % 5) + 1) * 42000), netout: f(((x.vmid % 3) + 1) * 15000), diskread: f(((x.vmid % 4) + 1) * 90000), diskwrite: f(((x.vmid % 6) + 1) * 30000) };
}

export function nodeStatus(node = NODE) {
  const s = S();
  s.load = wobble(s.load, 0.02);
  const running = s.guests.filter((x) => x.status === "running" && x.node === node).map(resource);
  if (node === NODE2) {
    const mem = running.reduce((a, r) => a + r.mem, 0) + 1.6 * GB;
    return { cpu: Math.min(1, running.reduce((a, r) => a + r.cpu * r.maxcpu, 0) / 8 + 0.02), maxcpu: 8, mem, maxmem: 32 * GB, disk: 9 * GB, maxdisk: 58 * GB, uptime: 41 * DAY + 812 };
  }
  const mem = running.reduce((a, r) => a + r.mem, 0) + 3.1 * GB;
  return {
    cpu: Math.min(1, running.reduce((a, r) => a + r.cpu * r.maxcpu, 0) / 16 + 0.03),
    maxcpu: 16, mem, maxmem: 64 * GB, disk: 21 * GB, maxdisk: 94 * GB, uptime: 23 * DAY + 4211,
  };
}

export function storages(node = NODE) {
  const used = S().guests.filter((x) => x.node === node).reduce((a, x) => a + x.disk * GB * 0.6, 0);
  const pbsUsed = (S().content.pbs ?? []).reduce((a, c) => a + c.size, 0) * 0.35 + 410 * GB;
  const backupUsed = (S().content["backup-nas"] ?? []).reduce((a, c) => a + c.size, 0) + 1.2e12;
  return [
    { storage: "local", type: "dir", content: "iso,vztmpl,backup", shared: 0, active: 1, enabled: 1, used: 21 * GB, total: 94 * GB, avail: 73 * GB, used_fraction: 21 / 94 },
    { storage: "local-lvm", type: "lvmthin", content: "images,rootdir", shared: 0, active: 1, enabled: 1, used, total: 832 * GB, avail: 832 * GB - used, used_fraction: used / (832 * GB) },
    { storage: "backup-nas", type: "nfs", content: "backup", shared: 1, active: 1, enabled: 1, used: backupUsed, total: 1.8e12, avail: 1.8e12 - backupUsed, used_fraction: backupUsed / 1.8e12 },
    { storage: "pbs", type: "pbs", content: "backup", shared: 1, active: 1, enabled: 1, used: pbsUsed, total: 4e12, avail: 4e12 - pbsUsed, used_fraction: pbsUsed / 4e12 },
  ];
}

export function rrd(kind: "node" | "guest" | "storage", x?: Guest, timeframe = "hour", storage?: string) {
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

export const SYSLOG = () => {
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

/** Remet la démo à zéro. */
export function resetMock() {
  g.__myproxmoxMock = init();
}

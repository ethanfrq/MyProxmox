// Faux Proxmox en mémoire pour le mode démo.
// Il imite les chemins de l'API Proxmox VE 8 utilisés par MyProxmox, pour tout
// essayer sans serveur. Il tourne côté serveur (MYPROXMOX_DEMO=1) ou directement
// dans le navigateur (démo publiée sur Vercel). Les données repartent de zéro au rechargement.

import {
  GB, MB, now, DAY, NODE, Guest, Task, HaResource, State, PVE_PRIVS, ALL_PRIVS, mac, guest, init, S, addTask, MockError, fail, findGuest, wobble, resource, counters, nodeStatus, storages, rrd, SYSLOG,
} from "./mock-core";
import type { Any, Params } from "./mock-core";
import { NODE2, NODES, isVolumeKey, sizeOf } from "./mock-core";
import { guestRoute } from "./mock-guest";
import { firewallRoute } from "./mock-firewall";
import { acmeRoute, nodeRoute } from "./mock-node";

export { resetMock, PVE_PRIVS } from "./mock-core";

/** Point d'entrée : imite un appel à l'API Proxmox. */
type AclType = "user" | "group" | "token";

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
  if (route === "GET /access/acl") return s.acl.map((a) => ({ ...a }));
  if (route === "PUT /access/acl") {
    const paths = String(p.path ?? "");
    if (!paths.startsWith("/")) fail(400, "path: invalid ACL path");
    const roles = String(p.roles ?? "").split(",").filter(Boolean);
    const who: [AclType, string][] = [
      ...String(p.users ?? "").split(",").filter(Boolean).map((u): [AclType, string] => ["user", u]),
      ...String(p.groups ?? "").split(",").filter(Boolean).map((u): [AclType, string] => ["group", u]),
      ...String(p.tokens ?? "").split(",").filter(Boolean).map((u): [AclType, string] => ["token", u]),
    ];
    if (!roles.length || !who.length) fail(400, "roles et users/groups/tokens sont obligatoires");
    for (const [type, ugid] of who) {
      for (const roleid of roles) {
        s.acl = s.acl.filter((a) => !(a.path === paths && a.ugid === ugid && a.roleid === roleid));
        if (!Number(p.delete)) s.acl.push({ path: paths, type, ugid, roleid, propagate: Number(p.propagate ?? 1) });
      }
    }
    return null;
  }
  if (route === "GET /access/roles") {
    return [
      { roleid: "Administrator", special: 1, privs: PVE_PRIVS.join(",") },
      { roleid: "PVEAdmin", special: 1, privs: PVE_PRIVS.filter((x) => !/^(Permissions|Realm|Sys\.Modify)/.test(x)).join(",") },
      { roleid: "PVEVMAdmin", special: 1, privs: PVE_PRIVS.filter((x) => x.startsWith("VM.")).join(",") },
      { roleid: "PVEVMUser", special: 1, privs: "VM.Audit,VM.Console,VM.PowerMgmt,VM.Backup,VM.Snapshot,VM.Config.CDROM" },
      { roleid: "PVEAuditor", special: 1, privs: PVE_PRIVS.filter((x) => /Audit$/.test(x)).join(",") },
      { roleid: "PVEDatastoreUser", special: 1, privs: "Datastore.AllocateSpace,Datastore.Audit" },
      { roleid: "NoAccess", special: 1, privs: "" },
      { roleid: "MyProxmoxService", special: 0, privs: "Sys.Audit,VM.Audit,Datastore.Audit,VM.PowerMgmt,VM.Snapshot,VM.Backup" },
    ];
  }
  if (route === "GET /access/groups") return [{ groupid: "famille", comment: "La maison", users: "ethan@pve" }, { groupid: "admins", comment: "Administrateurs", users: "ethan@pve" }];

  // ── Cluster ──────────────────────────────────────────────────────
  if (route === "GET /cluster/status") {
    return [
      { type: "cluster", id: "cluster", name: "maison", nodes: 2, quorate: 1, version: 4 },
      { type: "node", id: `node/${NODE}`, name: NODE, nodeid: 1, online: 1, local: 1, ip: "10.0.1.101", level: "" },
      { type: "node", id: `node/${NODE2}`, name: NODE2, nodeid: 2, online: 1, local: 0, ip: "10.0.1.102", level: "" },
    ];
  }
  // Réplication
  if (route === "GET /cluster/replication") return s.replication.map(({ last_sync, fail_count, ...j }) => j);
  if (route === "POST /cluster/replication") {
    const id = String(p.id ?? "");
    const m = id.match(/^(\d+)-(\d+)$/) ?? fail(400, "id: format attendu <vmid>-<numéro>, ex. 101-0");
    if (s.replication.some((j) => j.id === id)) fail(500, `replication job '${id}' already exists`);
    const x = findGuest(m![1]);
    if (String(p.target) === x.node) fail(500, "unable to replicate to local node");
    s.replication.push({ id, guest: x.vmid, target: String(p.target), schedule: String(p.schedule ?? "*/15"), type: "local", jobnum: Number(m![2]), comment: String(p.comment ?? ""), rate: p.rate ? Number(p.rate) : undefined, disable: Number(p.disable ?? 0) });
    return null;
  }
  if (seg[0] === "cluster" && seg[1] === "replication" && seg[2]) {
    const j = s.replication.find((x) => x.id === seg[2]) ?? fail(500, `replication job '${seg[2]}' does not exist`);
    if (method === "GET") return j;
    if (method === "PUT") {
      for (const k of ["schedule", "comment", "rate", "disable"] as const) if (p[k] !== undefined) (j as Any)[k] = k === "rate" || k === "disable" ? Number(p[k]) : String(p[k]);
      for (const k of String(p.delete ?? "").split(",").filter(Boolean)) delete (j as Any)[k];
      return null;
    }
    if (method === "DELETE") {
      s.replication = s.replication.filter((x) => x !== j);
      return null;
    }
  }
  if (route === "GET /cluster/mapping/pci") return [{ id: "zigbee-usb", description: "Contrôleur USB de la clé Zigbee", map: [`node=${NODE},path=0000:05:00.0,id=1022:149c`] }, { id: "gpu-igpu", description: "iGPU Radeon", map: [`node=${NODE},path=0000:0a:00.0,id=1002:1638`] }];
  if (route === "GET /cluster/mapping/usb") return [{ id: "onduleur", description: "Onduleur Eaton", map: [`node=${NODE},id=0463:ffff`] }];
  if (route === "GET /cluster/mapping/dir") return [{ id: "partage-media", description: "Films et séries", map: [`node=${NODE},path=/tank/media`] }];
  if (route === "GET /cluster/nextid") {
    let id = 100;
    while (s.guests.some((x) => x.vmid === id)) id++;
    return String(id);
  }
  if (route === "GET /cluster/resources") {
    const list: Any[] = [
      ...NODES.map((nd) => ({ id: `node/${nd}`, type: "node", node: nd, status: "online", level: "", ...nodeStatus(nd) })),
      ...s.guests.map(resource),
      ...NODES.flatMap((nd) => storages(nd).map((st) => ({ id: `storage/${nd}/${st.storage}`, type: "storage", node: nd, storage: st.storage, plugintype: st.type, status: "available", disk: st.used, maxdisk: st.total, content: st.content, shared: st.shared }))),
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
  if (seg[0] === "cluster" && seg[1] === "acme") {
    const ar = acmeRoute(method, seg.slice(2), p);
    if (ar !== undefined) return ar;
  }
  if (seg[0] === "cluster" && seg[1] === "firewall") {
    const fr = firewallRoute(s.clusterFw, method, seg.slice(2), p, fail);
    if (fr !== undefined) return fr;
  }
  if (route === "GET /cluster/ha/status/current") {
    return [
      { id: "quorum", type: "quorum", status: "OK", quorate: 1, node: NODE },
      ...s.ha.map((h) => ({ id: `service:${h.sid}`, type: "service", sid: h.sid, state: h.state, node: NODE, status: `${h.state} (${NODE})` })),
    ];
  }
  if (route === "GET /cluster/ha/resources") return s.ha.map((h) => ({ sid: h.sid, type: h.sid.split(":")[0], state: h.state, group: h.group, comment: h.comment, max_restart: 1, max_relocate: 1 }));

  if (seg[0] !== "nodes") fail(501, `Chemin non simulé dans la démo : ${route}`);
  if (seg.length === 1 && method === "GET") return NODES.map((nd) => ({ node: nd, status: "online", ...nodeStatus(nd), level: "", ssl_fingerprint: "AB:CD" }));
  const node = seg[1];
  if (!NODES.includes(node)) fail(500, `no such cluster node '${node}'`);
  const rest = seg.slice(2);
  const r = `${method} /${rest.join("/")}`;

  // ── Machines (VM et conteneurs) ──────────────────────────────────
  const gr = guestRoute(method, node, rest, p);
  if (gr !== undefined) return gr;
  // ── Nœud : alimentation, réseau, DNS, certificats, apt, disques, Ceph, services, journaux ──
  const nr = nodeRoute(method, node, rest, p);
  if (nr !== undefined) return nr;

  // ── Nœud ─────────────────────────────────────────────────────────
  if (r === "GET /status") {
    const n = nodeStatus(node);
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
  // Matériel du nœud (passthrough) et capacités QEMU
  if (r === "GET /hardware/pci") {
    return [
      { id: "0000:05:00.0", class: "0x0c0330", vendor_name: "Advanced Micro Devices, Inc. [AMD]", device_name: "Contrôleur USB 3.1", iommugroup: 11, mdev: 0 },
      { id: "0000:0a:00.0", class: "0x030000", vendor_name: "Advanced Micro Devices, Inc. [AMD/ATI]", device_name: "Cezanne [Radeon Vega]", iommugroup: 14, mdev: 0 },
      { id: "0000:03:00.0", class: "0x020000", vendor_name: "Intel Corporation", device_name: "I211 Gigabit Network Connection", iommugroup: 9, mdev: 0 },
    ];
  }
  if (r === "GET /hardware/usb") {
    return [
      { busnum: 1, devnum: 3, vendid: "046d", prodid: "c52b", manufacturer: "Logitech", product: "Unifying Receiver", speed: "12", port: 2 },
      { busnum: 3, devnum: 2, vendid: "0463", prodid: "ffff", manufacturer: "EATON", product: "Ellipse ECO", speed: "1.5", port: 1 },
      { busnum: 3, devnum: 4, vendid: "10c4", prodid: "ea60", manufacturer: "Silicon Labs", product: "Zigbee 3.0 USB Dongle", speed: "12", port: 3 },
    ];
  }
  if (r === "GET /capabilities/qemu/cpu") {
    return ["host", "x86-64-v2-AES", "x86-64-v3", "x86-64-v4", "kvm64", "qemu64", "EPYC-v4", "EPYC-Milan", "Skylake-Client-v4", "max"].map((name) => ({ name, vendor: name.startsWith("EPYC") ? "AuthenticAMD" : name.startsWith("Skylake") ? "GenuineIntel" : "default", custom: 0 }));
  }
  if (r === "GET /capabilities/qemu/machines") return [{ id: "pc-q35-8.1", type: "q35", version: "8.1" }, { id: "pc-q35-9.0", type: "q35", version: "9.0" }, { id: "pc-i440fx-8.1", type: "i440fx", version: "8.1" }];
  // Réplication vue depuis le nœud
  if (r === "GET /replication") {
    return s.replication.filter((j) => !p.guest || j.guest === Number(p.guest)).map((j) => ({
      id: j.id, guest: j.guest, target: j.target, source: node, schedule: j.schedule, jobnum: j.jobnum, type: j.type, comment: j.comment,
      last_sync: j.last_sync ?? 0, next_sync: now() + 600, duration: 4.2, fail_count: j.fail_count ?? 0, state: j.disable ? "disabled" : undefined,
    }));
  }
  if (rest[0] === "replication" && rest[1]) {
    const j = s.replication.find((x) => x.id === rest[1]) ?? fail(500, `replication job '${rest[1]}' does not exist`);
    if (method === "POST" && rest[2] === "schedule_now") {
      j!.last_sync = now();
      return addTask("replicate", j!.id, [`start replication job ${j!.id}`, "end replication job"], "OK", node);
    }
    if (method === "GET" && rest[2] === "log") return [`${new Date().toISOString()} ${j!.id}: start replication job`, `${new Date().toISOString()} ${j!.id}: guest => VM ${j!.guest}, running => 1`, `${new Date().toISOString()} ${j!.id}: end replication job`].map((t, i) => ({ n: i + 1, t }));
    if (method === "GET" && rest[2] === "status") return { id: j!.id, last_sync: j!.last_sync, fail_count: 0 };
  }
  if (r === "GET /netstat") {
    return s.guests.filter((x) => x.status === "running").map((x) => {
      const c = counters(x);
      return { dev: `${x.type === "qemu" ? "tap" : "veth"}${x.vmid}i0`, vmid: String(x.vmid), in: String(c.netin), out: String(c.netout) };
    });
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
  if (r === "GET /apt/update") {
    return [
      { Package: "pve-manager", OldVersion: "8.4.1", Version: "8.4.5", Priority: "important", Origin: "Proxmox", Section: "admin", Title: "Interface et API de Proxmox VE" },
      { Package: "proxmox-kernel-6.8", OldVersion: "6.8.12-4", Version: "6.8.12-9", Priority: "optional", Origin: "Proxmox", Section: "kernel", Title: "Noyau Linux Proxmox" },
      { Package: "openssl", OldVersion: "3.0.15-1~deb12u1", Version: "3.0.16-1~deb12u1", Priority: "optional", Origin: "Debian", Section: "utils", Title: "Boîte à outils TLS (correctif de sécurité)" },
      { Package: "libc6", OldVersion: "2.36-9+deb12u9", Version: "2.36-9+deb12u10", Priority: "required", Origin: "Debian", Section: "libs", Title: "Bibliothèque C (correctif de sécurité)" },
    ];
  }
  if (rest[0] === "firewall") {
    const fr = firewallRoute(s.nodeFw[node], method, rest.slice(1), p, fail);
    if (fr !== undefined) return fr;
  }

  // ── Stockage ─────────────────────────────────────────────────────
  if (r === "GET /storage") {
    const list = storages(node);
    return p.content ? list.filter((x) => x.content.includes(String(p.content))) : list;
  }
  if (/^GET \/storage\/[^/]+\/rrddata$/.test(r)) return rrd("storage", undefined, String(p.timeframe ?? "week"), rest[1]);
  if (/^GET \/storage\/[^/]+\/content$/.test(r)) {
    const st = rest[1];
    // Volumes des machines du nœud, lus dans leur configuration
    const own = s.guests.filter((x) => x.node === node || !["local", "local-lvm"].includes(st)).flatMap((x) => Object.entries(x.conf)
      .filter(([k, v]) => isVolumeKey(x.type, k, v) && v.startsWith(`${st}:`))
      .map(([, v]) => ({ volid: v.split(",")[0], content: x.type === "qemu" ? "images" : "rootdir", format: "raw", size: (sizeOf(v) || 1) * GB, vmid: x.vmid })));
    return [...(s.content[st] ?? []), ...own]
      .filter((c) => !p.content || c.content === p.content)
      .filter((c) => !p.vmid || Number(c.vmid) === Number(p.vmid));
  }
  // Notes et protection d'une sauvegarde
  if (/^PUT \/storage\/[^/]+\/content\/.+$/.test(r)) {
    const volid = rest.slice(3).join("/");
    const c = (s.content[rest[1]] ?? []).find((x) => x.volid === volid) ?? fail(404, `volume '${volid}' does not exist`);
    if (p.notes !== undefined) c.notes = String(p.notes);
    if (p.protected !== undefined) c.protected = Number(p.protected);
    return null;
  }
  // Restauration de fichiers isolés (Proxmox Backup Server)
  if (/^GET \/storage\/[^/]+\/file-restore\/list$/.test(r)) {
    const fp = String(p.filepath ?? "/");
    const b64 = (x: string) => (typeof btoa === "function" ? btoa(unescape(encodeURIComponent(x))) : Buffer.from(x).toString("base64"));
    const dec = (x: string) => (x === "/" ? "/" : typeof atob === "function" ? decodeURIComponent(escape(atob(x))) : Buffer.from(x, "base64").toString());
    const path = dec(fp);
    const entry = (name: string, type: "d" | "f" | "v", size = 0) => ({ filepath: b64(`${path === "/" ? "" : path}/${name}`), text: name, type, leaf: type === "f" ? 1 : 0, size, mtime: now() - 86400 * 3 });
    if (path === "/") return [entry("drive-scsi0.img.fidx", "v", 32 * GB)];
    if (path.endsWith(".fidx")) return [entry("part", "d")];
    if (path.endsWith("/part")) return [entry("1", "d")];
    if (path.endsWith("/1")) return [entry("etc", "d"), entry("home", "d"), entry("var", "d")];
    if (path.endsWith("/etc")) return [entry("hostname", "f", 15), entry("hosts", "f", 220), entry("fstab", "f", 512)];
    if (path.endsWith("/home")) return [entry("ethan", "d")];
    if (path.endsWith("/ethan")) return [entry("notes.txt", "f", 2048), entry(".bashrc", "f", 3526)];
    return [entry("log", "d")];
  }
  if (/^GET \/storage\/[^/]+\/file-restore\/download$/.test(r)) return `Fichier restauré depuis ${p.volume} (démo).\n`;
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
  if (r === "GET /tasks") {
    return s.tasks
      .filter((t) => t.node === node || p.vmid)
      .filter((t) => !p.vmid || t.id === String(p.vmid))
      .filter((t) => !p.errors || t.status !== "OK")
      .slice(Number(p.start ?? 0), Number(p.start ?? 0) + Number(p.limit ?? 50))
      .map(({ log, ...t }) => t);
  }

  // ── Sauvegardes ──────────────────────────────────────────────────
  if (r === "POST /vzdump") {
    const ids = String(p.vmid).split(",");
    for (const id of ids) {
      const x = findGuest(id);
      const st = String(p.storage ?? "backup-nas");
      const d = new Date();
      const stamp = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, "0")}_${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}_${String(d.getMinutes()).padStart(2, "0")}_00`;
      const notes = String(p["notes-template"] ?? "").replace(/\{\{guestname\}\}/g, x.name).replace(/\{\{vmid\}\}/g, String(x.vmid)).replace(/\{\{node\}\}/g, x.node).replace(/\{\{cluster\}\}/g, "maison");
      const volid = st === "pbs"
        ? `pbs:backup/${x.type === "qemu" ? "vm" : "ct"}/${x.vmid}/${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`
        : `${st}:backup/vzdump-${x.type}-${x.vmid}-${stamp}.${x.type === "qemu" ? "vma" : "tar"}${p.compress === "0" ? "" : `.${p.compress === "gzip" ? "gz" : p.compress === "lzo" ? "lzo" : "zst"}`}`;
      (s.content[st] ??= []).push({ volid, content: "backup", format: st === "pbs" ? "pbs-vm" : "zst", size: x.disk * GB * 0.18, ctime: now(), vmid: x.vmid, notes, protected: Number(p.protected ?? 0) });
      // « Supprimer les anciennes » : garde les N dernières de cette machine
      const keep = Number(String(p["prune-backups"] ?? "").match(/keep-last=(\d+)/)?.[1] ?? 0);
      if (Number(p.remove ?? 0) && keep) {
        const mine = (s.content[st] ?? []).filter((c) => Number(c.vmid) === x.vmid && !c.protected).sort((a, b) => b.ctime - a.ctime);
        const drop = new Set(mine.slice(keep).map((c) => c.volid));
        s.content[st] = (s.content[st] ?? []).filter((c) => !drop.has(c.volid));
      }
    }
    return addTask("vzdump", ids.length === 1 ? ids[0] : "", [`INFO: starting new backup job: vzdump ${ids.join(" ")}`, "INFO: Backup job finished successfully"]);
  }

  fail(501, `Chemin non simulé dans la démo : ${route}`);
}


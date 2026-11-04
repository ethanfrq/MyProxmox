// Faux Proxmox : tout ce qui concerne une VM ou un conteneur.
// Chemins traités : /nodes/{node}/qemu|lxc (création, restauration) et /nodes/{node}/qemu|lxc/{vmid}/...
import {
  GB, MB, NODE, NODES, S, addTask, buildConf, fail, findTyped, guest, isCdrom, isVolumeKey, mac, now, resource, rrd, sizeOf, syncFromConf,
  type Any, type Guest, type Params,
} from "./mock-core";
import { firewallRoute } from "./mock-firewall";

const IGNORED = new Set(["delete", "digest", "skiplock", "background_delay", "revert", "force", "node", "vmid"]);

function nextDiskIndex(x: Guest) {
  const used = Object.values(x.conf).map((v) => Number(v.match(/(?:vm|subvol|base)-\d+-disk-(\d+)/)?.[1] ?? -1));
  return Math.max(-1, ...used) + 1;
}
function nextUnused(x: Guest) {
  let i = 0;
  while (x.conf[`unused${i}`] !== undefined) i++;
  return `unused${i}`;
}

/** Transforme « stockage:taille,options » en volume alloué, comme le fait Proxmox. */
function allocate(x: Guest, key: string, value: string) {
  if (/^none/.test(value) || isCdrom(value) && !/cloudinit/.test(value)) return value;
  const m = value.match(/^([\w.-]+):(\d+(?:\.\d+)?)(,.*)?$/);
  if (m) {
    const [, storage, size, opts = ""] = m;
    const n = nextDiskIndex(x);
    const prefix = x.type === "lxc" ? "subvol" : "vm";
    const unit = key === "efidisk0" || key === "tpmstate0" ? "M" : "G";
    const sz = unit === "M" ? (key === "efidisk0" ? "4" : "4") : size;
    return `${storage}:${prefix}-${x.vmid}-disk-${n}${opts},size=${sz}${unit}`;
  }
  const ci = value.match(/^([\w.-]+):cloudinit/);
  if (ci) return `${ci[1]}:vm-${x.vmid}-cloudinit,media=cdrom`;
  return value;
}

function applyConfig(x: Guest, p: Params) {
  for (const [k, raw] of Object.entries(p)) {
    if (IGNORED.has(k) || raw === undefined || raw === null) continue;
    let v = typeof raw === "boolean" ? (raw ? "1" : "0") : String(raw);
    if (k === "name" && !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(v)) fail(400, "name: value does not look like a valid DNS name");
    if (k === "memory" && Number(v) < 16) fail(400, "memory: value must have a minimum value of 16");
    if (isVolumeKey(x.type, k, v) || /cloudinit/.test(v)) v = allocate(x, k, v);
    x.conf[k] = v;
    // Rattacher un volume inutilisé le retire de la liste des inutilisés
    if (!/^unused/.test(k)) for (const [u, uv] of Object.entries(x.conf)) if (/^unused\d+$/.test(u) && uv === v.split(",")[0]) delete x.conf[u];
  }
  for (const k of String(p.delete ?? "").split(/[,;\s]+/).filter(Boolean)) {
    const v = x.conf[k];
    if (v === undefined) continue;
    if (k === "rootfs") fail(400, "rootfs: cannot be deleted");
    if (/^unused\d+$/.test(k)) delete x.conf[k];
    else if (isVolumeKey(x.type, k, v) && !/^none/.test(v)) {
      // Un disque détaché n'est pas effacé : il devient « inutilisé »
      x.conf[nextUnused(x)] = v.split(",")[0];
      delete x.conf[k];
    } else delete x.conf[k];
  }
  syncFromConf(x);
}

function pending(x: Guest) {
  return Object.entries(x.conf).filter(([k]) => k !== "digest").map(([key, value]) => ({ key, value }));
}

const DEMO_FS = [
  { name: "sda1", mountpoint: "/", type: "ext4", "total-bytes": 30 * GB, "used-bytes": 11.4 * GB, disk: [{ dev: "/dev/sda1", "bus-type": "scsi", serial: "drive-scsi0" }] },
  { name: "sda15", mountpoint: "/boot/efi", type: "vfat", "total-bytes": 124 * MB, "used-bytes": 12 * MB, disk: [{ dev: "/dev/sda15", "bus-type": "scsi" }] },
];

function restoreArchive(type: "qemu" | "lxc", node: string, p: Params) {
  const s = S();
  const archive = String(type === "qemu" ? p.archive : p.ostemplate);
  const vmid = Number(p.vmid);
  const srcId = Number(archive.match(/vzdump-(?:qemu|lxc)-(\d+)-/)?.[1] ?? archive.match(/\/(?:vm|ct)\/(\d+)\//)?.[1] ?? 0);
  const src = s.guests.find((g) => g.vmid === srcId);
  let x = s.guests.find((g) => g.vmid === vmid);
  if (x) {
    if (!p.force) fail(500, `unable to restore VM ${vmid} - VM ${vmid} already exists on node '${x.node}'`);
    if (x.status === "running") fail(500, `unable to restore VM ${vmid} - VM is running`);
  } else {
    x = guest(vmid, src?.name ?? `restauree-${vmid}`, type, false, src?.cores ?? 1, src?.memory ?? 512, src?.disk ?? 8, src?.tags ?? "", { node, ip: "" });
    s.guests.push(x);
    s.guests.sort((a, b) => a.vmid - b.vmid);
  }
  if (src) x.conf = { ...src.conf };
  if (p.storage) for (const [k, v] of Object.entries(x.conf)) if (isVolumeKey(type, k, v)) x.conf[k] = v.replace(/^[\w.-]+:/, `${p.storage}:`);
  for (const [k, v] of Object.entries(x.conf)) x.conf[k] = v.replace(new RegExp(`-${srcId}-`, "g"), `-${vmid}-`);
  if (Number(p.unique)) x.conf.net0 = (x.conf.net0 ?? "").replace(/([0-9A-F]{2}:){5}[0-9A-F]{2}/i, mac(vmid + 37));
  syncFromConf(x);
  x.status = Number(p.start) ? "running" : "stopped";
  x.started = now();
  return addTask(type === "qemu" ? "qmrestore" : "vzrestore", String(vmid), [`restore ${archive} to VM ${vmid}`, `extracting archive '${archive}'`, "rescan volumes..."], "OK", node);
}

/** `rest` = segments après /nodes/{node}. Retourne undefined si rien ne correspond. */
export function guestRoute(method: string, node: string, rest: string[], p: Params): Any {
  const s = S();
  const type = rest[0] as "qemu" | "lxc";
  if (type !== "qemu" && type !== "lxc") return undefined;

  // ── Liste, création, restauration ──
  if (rest.length === 1) {
    if (method === "GET") return s.guests.filter((x) => x.type === type && x.node === node).map(resource);
    if (method === "POST") {
      if (p.archive || p.restore) return restoreArchive(type, node, p);
      const vmid = Number(p.vmid);
      if (!vmid || vmid < 100) fail(400, "vmid: value must have a minimum value of 100");
      if (s.guests.some((x) => x.vmid === vmid)) fail(500, `VM ${vmid} already exists`);
      const x = guest(vmid, String(p.name ?? p.hostname ?? `vm-${vmid}`), type, false, Number(p.cores ?? 1), Number(p.memory ?? 512), 8, String(p.tags ?? ""), { node, ip: "", conf: { placeholder: "1" }, agent: false });
      x.conf = {};
      applyConfig(x, Object.fromEntries(Object.entries(p).filter(([k]) => !["start", "ostemplate", "password", "ssh-public-keys", "pool", "storage", "unique"].includes(k))));
      if (type === "lxc" && !x.conf.rootfs) x.conf.rootfs = allocate(x, "rootfs", `${p.storage ?? "local-lvm"}:8`);
      if (type === "lxc" && p.ostemplate) x.conf.ostype = String(p.ostemplate).match(/(debian|ubuntu|alpine|rockylinux|archlinux)/)?.[1]?.replace("rockylinux", "centos") ?? "unmanaged";
      if (p.pool) x.pool = String(p.pool);
      syncFromConf(x);
      if (Number(p.start)) Object.assign(x, { status: "running", started: now(), cpu: 0.05 });
      s.guests.push(x);
      s.guests.sort((a, b) => a.vmid - b.vmid);
      return addTask(type === "qemu" ? "qmcreate" : "vzcreate", String(vmid), [], "OK", node);
    }
    return undefined;
  }

  const x = findTyped(rest[1], type);
  const sub = rest.slice(2);
  const path = sub.join("/");
  const pfx = type === "qemu" ? "qm" : "vz";
  const task = (t: string, lines: string[] = []) => addTask(`${pfx}${t}`, String(x.vmid), lines, "OK", x.node);
  const running = x.status === "running";
  const locked = () => x.conf.lock && fail(500, `VM is locked (${x.conf.lock})`);

  if (method === "GET" && path === "") return [{ subdir: "config" }, { subdir: "status" }, { subdir: "snapshot" }, { subdir: "firewall" }];

  // ── État ──
  if (method === "GET" && path === "status/current") {
    return { ...resource(x), qmpstatus: running ? "running" : "stopped", agent: x.agent ? 1 : 0, ha: { managed: s.ha.some((h) => h.sid.endsWith(`:${x.vmid}`)) ? 1 : 0 }, lock: x.conf.lock, template: x.template ? 1 : 0, "running-machine": running ? "pc-q35-8.1+pve0" : undefined };
  }
  if (method === "POST" && sub[0] === "status") {
    const action = sub[1];
    locked();
    if (x.template) fail(500, "you can't start a vm if it's a template");
    if (action === "start" && running) fail(500, "VM already running");
    if (["shutdown", "stop", "reboot", "suspend"].includes(action) && !running) fail(500, "VM not running");
    if (action === "start" || action === "reboot" || action === "resume") Object.assign(x, { status: "running", started: action === "reboot" ? now() : x.started || now(), cpu: 0.05 });
    if (action === "start") x.started = now();
    if (action === "shutdown" || action === "stop") Object.assign(x, { status: "stopped", cpu: 0 });
    return task(action);
  }

  // ── Configuration ──
  if (method === "GET" && path === "config") {
    if (p.snapshot) return { ...(x.snapshots.find((n) => n.name === p.snapshot)?.conf ?? x.conf), digest: "demo" };
    return { ...x.conf, digest: "demo" };
  }
  if (method === "GET" && path === "pending") return pending(x);
  if ((method === "PUT" || method === "POST") && path === "config") {
    locked();
    if (x.conf.protection === "1" && String(p.delete ?? "").split(",").some((k) => isVolumeKey(x.type, k, x.conf[k]))) fail(500, "can't remove drive - protection mode enabled");
    applyConfig(x, p);
    return method === "POST" ? task("config") : null;
  }
  if (method === "PUT" && path === "resize") {
    const key = String(p.disk);
    const cur = x.conf[key] ?? fail(400, `disk '${key}' does not exist`);
    const want = String(p.size);
    const n = Number(want.replace(/[^\d.]/g, ""));
    const next = want.startsWith("+") ? sizeOf(cur) + n : n;
    if (next < sizeOf(cur)) fail(500, "shrinking disks is not supported");
    x.conf[key] = cur.replace(/size=[^,]+/, `size=${next}G`);
    syncFromConf(x);
    return type === "lxc" ? task("resize") : null;
  }
  if (method === "POST" && (path === "move_disk" || path === "move_volume")) {
    const key = String(p.disk ?? p.volume);
    const cur = x.conf[key] ?? fail(400, `disk '${key}' does not exist`);
    if (p["target-vmid"]) {
      const to = findTyped(p["target-vmid"], x.type);
      const tkey = String(p["target-disk"] ?? p["target-volume"] ?? key);
      to.conf[tkey] = cur.replace(new RegExp(`-${x.vmid}-`), `-${to.vmid}-`);
      delete x.conf[key];
      syncFromConf(x);
      syncFromConf(to);
      return task("move");
    }
    const storage = String(p.storage ?? fail(400, "storage: property is missing"));
    if (!Number(p.delete)) x.conf[nextUnused(x)] = cur.split(",")[0];
    x.conf[key] = cur.replace(/^[\w.-]+:/, `${storage}:`);
    return addTask(type === "qemu" ? "qmmove" : "move_volume", String(x.vmid), [`moving disk ${key} to ${storage}`, "transferred 100%"], "OK", x.node);
  }
  if (method === "PUT" && path === "unlink") {
    for (const k of String(p.idlist ?? "").split(/[,;\s]+/).filter(Boolean)) delete x.conf[k];
    syncFromConf(x);
    return null;
  }
  if (method === "GET" && path === "rrddata") return rrd("guest", x, String(p.timeframe ?? "hour"));

  // ── Cloud-Init ──
  if (type === "qemu" && sub[0] === "cloudinit") {
    if (method === "GET" && sub.length === 1) return ["ciuser", "cipassword", "sshkeys", "ipconfig0", "nameserver", "searchdomain"].map((key) => ({ key, value: x.conf[key] }));
    if (method === "PUT" && sub.length === 1) return null; // image régénérée
    if (method === "GET" && sub[1] === "dump") {
      if (p.type === "network") return `version: 1\nconfig:\n  - type: physical\n    name: eth0\n    subnets:\n      - type: static\n        address: '${(x.conf.ipconfig0 ?? "").match(/ip=([^,]+)/)?.[1] ?? "dhcp"}'\n`;
      if (p.type === "meta") return `instance-id: ${x.vmid}-demo\n`;
      return `#cloud-config\nhostname: ${x.name}\nmanage_etc_hosts: true\nuser: ${x.conf.ciuser ?? "root"}\nssh_authorized_keys:\n  - ${decodeURIComponent(x.conf.sshkeys ?? "")}\nchpasswd:\n  expire: False\npackage_upgrade: true\n`;
    }
  }

  // ── Agent invité ──
  if (type === "qemu" && sub[0] === "agent") {
    if (!x.agent || !running) fail(500, "QEMU guest agent is not running");
    const cmd = sub[1];
    if (method === "GET" && cmd === "network-get-interfaces") {
      return { result: [
        { name: "lo", "hardware-address": "00:00:00:00:00:00", "ip-addresses": [{ "ip-address": "127.0.0.1", "ip-address-type": "ipv4", prefix: 8 }] },
        { name: "ens18", "hardware-address": x.mac.toLowerCase(), "ip-addresses": [{ "ip-address": x.ip, "ip-address-type": "ipv4", prefix: 24 }, { "ip-address": `fe80::be24:11ff:fe${x.vmid}:4e01`, "ip-address-type": "ipv6", prefix: 64 }] },
      ] };
    }
    if (method === "GET" && cmd === "get-osinfo") return { result: { id: "debian", name: "Debian GNU/Linux", "pretty-name": "Debian GNU/Linux 12 (bookworm)", version: "12 (bookworm)", "version-id": "12", "kernel-release": "6.1.0-27-amd64", "kernel-version": "#1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1", machine: "x86_64" } };
    if (method === "GET" && cmd === "get-fsinfo") return { result: DEMO_FS };
    if (method === "GET" && cmd === "get-users") return { result: [{ user: "ethan", "login-time": now() - 5400 }, { user: "root", "login-time": now() - 86400 * 2 }] };
    if (method === "GET" && cmd === "get-host-name") return { result: { "host-name": x.name } };
    if (method === "GET" && cmd === "get-time") return { result: Date.now() * 1e6 };
    if (method === "GET" && cmd === "info") return { result: { version: "7.2.0", supported_commands: [] } };
    if (method === "POST" && cmd === "ping") return { result: {} };
    if (method === "POST" && cmd === "shutdown") {
      Object.assign(x, { status: "stopped", cpu: 0 });
      return { result: {} };
    }
    if (method === "POST" && cmd === "fsfreeze-status") return { result: x.frozen ? "frozen" : "thawed" };
    if (method === "POST" && cmd === "fsfreeze-freeze") {
      x.frozen = true;
      return { result: DEMO_FS.length };
    }
    if (method === "POST" && cmd === "fsfreeze-thaw") {
      x.frozen = false;
      return { result: DEMO_FS.length };
    }
    if (method === "POST" && cmd === "fstrim") return { result: { paths: DEMO_FS.map((f) => ({ path: f.mountpoint, trimmed: 1.2 * GB })) } };
  }
  if (type === "lxc" && method === "GET" && path === "interfaces") {
    if (!running) fail(500, "CT is not running");
    return [
      { name: "lo", hwaddr: "00:00:00:00:00:00", inet: "127.0.0.1/8" },
      { name: "eth0", hwaddr: x.mac.toLowerCase(), inet: `${x.ip}/24`, inet6: `fe80::be24:11ff:fe${x.vmid}:4e01/64` },
    ];
  }

  // ── Snapshots ──
  if (sub[0] === "snapshot") {
    if (sub.length === 1) {
      if (method === "GET") return [...x.snapshots.map(({ conf, ...sn }) => sn), { name: "current", description: "You are here!", parent: x.parent, running: running ? 1 : 0 }];
      if (method === "POST") {
        if (!/^[a-zA-Z][\w-]*$/.test(String(p.snapname))) fail(400, "snapname: invalid format");
        if (x.snapshots.some((sn) => sn.name === p.snapname)) fail(500, `snapshot name '${p.snapname}' already used`);
        locked();
        x.snapshots.push({ name: String(p.snapname), description: String(p.description ?? ""), snaptime: now(), parent: x.parent, vmstate: Number(p.vmstate ?? 0) && running ? 1 : 0, conf: { ...x.conf } });
        x.parent = String(p.snapname);
        return task("snapshot", [`snapshotting '${p.snapname}'`]);
      }
    }
    const sn = x.snapshots.find((n) => n.name === sub[1]) ?? fail(500, `snapshot '${sub[1]}' does not exist`);
    if (sub[2] === "rollback" && method === "POST") {
      locked();
      if (sn.conf) x.conf = { ...sn.conf };
      syncFromConf(x);
      x.parent = sn.name;
      Object.assign(x, sn.vmstate || Number(p.start) ? { status: "running", started: now() } : { status: "stopped", cpu: 0 });
      return task("rollback");
    }
    if (sub[2] === "config") {
      if (method === "GET") return { ...(sn.conf ?? {}), description: sn.description, snaptime: sn.snaptime };
      if (method === "PUT") {
        sn.description = String(p.description ?? "");
        return null;
      }
    }
    if (sub.length === 2 && method === "DELETE") {
      for (const c of x.snapshots) if (c.parent === sn.name) c.parent = sn.parent;
      if (x.parent === sn.name) x.parent = sn.parent;
      x.snapshots = x.snapshots.filter((n) => n !== sn);
      return task("delsnapshot");
    }
    if (sub.length === 2 && method === "GET") return [{ cmd: "rollback" }, { cmd: "config" }];
  }

  // ── Migration, clonage, modèle ──
  if (path === "migrate") {
    const others = NODES.filter((n) => n !== x.node);
    if (method === "GET") {
      const local = Object.entries(x.conf).filter(([k, v]) => isVolumeKey(x.type, k, v) && /^local/.test(v)).map(([k, v]) => ({ volid: v.split(",")[0], drivename: k, size: sizeOf(v) * GB }));
      return { running: running ? 1 : 0, allowed_nodes: others, not_allowed_nodes: {}, local_disks: local, local_resources: x.conf.hostpci0 || x.conf.usb0 ? ["hostpci0", "usb0"].filter((k) => x.conf[k]) : [], "mapped-resources": x.conf.hostpci0 ? ["hostpci0"] : [] };
    }
    if (method === "POST") {
      const target = String(p.target);
      if (!NODES.includes(target)) fail(400, `no such cluster node '${target}'`);
      if (target === x.node) fail(400, "target is local node");
      if (running && type === "qemu" && !Number(p.online)) fail(500, "can't migrate running VM without --online");
      if (running && type === "lxc" && !Number(p.restart)) fail(500, "lxc live migration is currently not implemented - use 'restart' mode");
      locked();
      if (p.targetstorage) for (const [k, v] of Object.entries(x.conf)) if (isVolumeKey(x.type, k, v)) x.conf[k] = v.replace(/^[\w.-]+:/, `${String(p.targetstorage).split(":").pop()}:`);
      const from = x.node;
      x.node = target;
      return addTask(type === "qemu" ? "qmigrate" : "vzmigrate", String(x.vmid), [`starting migration of VM ${x.vmid} to node '${target}'`, running ? "migration status: completed" : "copying local disk images", `migration finished successfully (de ${from} vers ${target})`], "OK", from);
    }
  }
  if (method === "POST" && path === "clone") {
    const newid = Number(p.newid);
    if (s.guests.some((g) => g.vmid === newid)) fail(500, `VM ${newid} already exists`);
    if (!x.template && !Number(p.full ?? 1) && type === "qemu") fail(500, "Linked clone feature is not supported for non-templates");
    const name = String(p.name ?? p.hostname ?? `copie-de-${x.name}`);
    const copy = guest(newid, name, type, false, x.cores, x.memory, x.disk, x.tags, { node: String(p.target ?? x.node), ip: "", agent: x.agent });
    // Clone lié depuis un modèle : base-110-disk-0/vm-200-disk-0 ; clone complet : vm-200-disk-0
    const linked = !Number(p.full ?? 1) && x.template;
    const pre = type === "lxc" ? "subvol" : "vm";
    const source = p.snapname ? x.snapshots.find((n) => n.name === p.snapname)?.conf ?? x.conf : x.conf;
    copy.conf = Object.fromEntries(Object.entries(source)
      .filter(([k]) => k !== "template" && k !== "lock" && k !== "protection")
      .map(([k, v]) => [k, v
        .replace(/(?:base|vm|subvol)-(\d+)-disk-(\d+)/, (_m, old, n) => (linked ? `base-${old}-disk-${n}/${pre}-${newid}-disk-${n}` : `${pre}-${newid}-disk-${n}`))
        .replace(/vm-\d+-cloudinit/, `vm-${newid}-cloudinit`)]));
    copy.conf[type === "qemu" ? "name" : "hostname"] = name;
    copy.conf.net0 = (copy.conf.net0 ?? "").replace(/([0-9A-F]{2}:){5}[0-9A-F]{2}/i, mac(newid));
    if (p.description) copy.conf.description = String(p.description);
    if (p.storage) for (const [k, v] of Object.entries(copy.conf)) if (isVolumeKey(type, k, v)) copy.conf[k] = v.replace(/^[\w.-]+:/, `${p.storage}:`);
    if (p.pool) copy.pool = String(p.pool);
    syncFromConf(copy);
    s.guests.push(copy);
    s.guests.sort((a, b) => a.vmid - b.vmid);
    return addTask(type === "qemu" ? "qmclone" : "vzclone", String(x.vmid), [`create ${Number(p.full ?? 1) ? "full" : "linked"} clone of drive scsi0`, `clone VM ${x.vmid} to ${newid}`], "OK", x.node);
  }
  if (method === "POST" && path === "template") {
    if (running) fail(500, "you can't convert a running VM to a template");
    x.template = true;
    x.conf.template = "1";
    for (const [k, v] of Object.entries(x.conf)) if (isVolumeKey(type, k, v)) x.conf[k] = v.replace(/(vm|subvol)-(\d+)-disk/, "base-$2-disk");
    return type === "qemu" ? task("template") : null;
  }

  // ── Pare-feu ──
  if (sub[0] === "firewall") {
    const r = firewallRoute(x.fw, method, sub.slice(1), p, fail);
    if (r !== undefined) return r;
  }

  // ── Console ──
  if (method === "POST" && (path === "vncproxy" || path === "termproxy")) {
    return { port: path === "vncproxy" ? "5900" : "5901", ticket: `PVEVNC:DEMO${Math.random().toString(36).slice(2, 10)}`, user: "demo@pve", upid: task(path === "vncproxy" ? "vncproxy" : "vncshell"), cert: "" };
  }
  if (method === "POST" && path === "spiceproxy") return { type: "spice", host: "pvespiceproxy:demo", password: "demo", proxy: "http://10.0.1.101:3128", "tls-port": 61000 };

  // ── Suppression ──
  if (method === "DELETE" && path === "") {
    if (running) fail(500, "VM is running - destroy failed");
    if (x.conf.protection === "1") fail(500, "can't remove VM - protection mode enabled");
    s.guests = s.guests.filter((v) => v.vmid !== x.vmid);
    s.acl = s.acl.filter((a) => a.path !== `/vms/${x.vmid}`);
    s.replication = s.replication.filter((j) => j.guest !== x.vmid);
    return task("destroy");
  }
  if (method === "GET" && path === "feature") return { hasFeature: 1, nodes: NODES };
  return undefined;
}

export { buildConf, NODE };

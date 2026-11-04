// Faux Proxmox : tout ce qui concerne un nœud (alimentation, réseau, DNS, heure, certificats,
// ACME, mises à jour et dépôts, disques, Ceph, services, journaux, abonnement).
import { DAY, GB, NODE, NODE2, NODES, S, addTask, fail, now, type Any, type Params } from "./mock-core";
import { storageCfg } from "./mock-dc";

interface Iface { iface: string; type: string; method?: string; method6?: string; cidr?: string; gateway?: string; autostart?: number; active?: number; bridge_ports?: string; bridge_vlan_aware?: number; slaves?: string; bond_mode?: string; "vlan-raw-device"?: string; "vlan-id"?: number; comments?: string; mtu?: number; exists?: number; ovs_type?: string; ovs_bridge?: string; ovs_ports?: string; cidr6?: string; gateway6?: string }
interface Disk { devpath: string; model: string; serial: string; size: number; type: string; health: string; wearout: number | string; rpm?: number; used: string; gpt: number }
interface Svc { name: string; state: string; unit: string; desc: string }
interface NodeState {
  net: Iface[];
  pending: Iface[];
  dns: { search: string; dns1?: string; dns2?: string; dns3?: string };
  hosts: string;
  timezone: string;
  certs: Any[];
  config: Record<string, string>;
  disks: Disk[];
  lvm: { vg: string; size: number; free: number; lvcount: number; pvs: string }[];
  lvmthin: { lv: string; vg: string; lv_size: number; used: number; metadata_size: number; metadata_used: number }[];
  dirs: { path: string; device: string; type: string; options: string; unitfile: string }[];
  zfs: { name: string; size: number; alloc: number; free: number; frag: number; dedup: number; health: string; raidlevel: string; devices: string[] }[];
  services: Svc[];
  subscription: Any;
  repos: { path: string; repositories: Any[] }[];
  journal: string[];
  journalAt: number;
}
interface Ceph { pools: Any[]; osds: Any[]; fs: Any[]; flags: string[] }
interface Acme { accounts: Any[]; plugins: Any[] }

const DEFAULT_SERVICES: [string, string, string][] = [
  ["pveproxy", "running", "Interface web et API"], ["pvedaemon", "running", "Démon de l'API"], ["pvestatd", "running", "Collecte des statistiques"],
  ["pve-cluster", "running", "Système de fichiers du cluster"], ["pve-firewall", "running", "Pare-feu Proxmox"], ["pve-ha-lrm", "running", "Haute disponibilité (local)"],
  ["pve-ha-crm", "running", "Haute disponibilité (cluster)"], ["corosync", "running", "Communication du cluster"], ["chronyd", "running", "Synchronisation de l'heure"],
  ["sshd", "running", "Serveur SSH"], ["postfix", "running", "Envoi de mails"], ["cron", "running", "Tâches planifiées"], ["spiceproxy", "running", "Proxy SPICE"],
  ["ksmtuned", "running", "Partage de pages mémoire (KSM)"], ["systemd-timesyncd", "dead", "Synchronisation de l'heure (systemd)"],
];

function initNode(node: string): NodeState {
  const ip = node === NODE ? "10.0.1.101" : "10.0.1.102";
  const net: Iface[] = [
    { iface: "lo", type: "loopback", method: "loopback", autostart: 1, active: 1 },
    { iface: "enp3s0", type: "eth", method: "manual", active: 1, exists: 1 },
    { iface: "enp4s0", type: "eth", method: "manual", active: node === NODE ? 0 : 1, exists: 1 },
    { iface: "vmbr0", type: "bridge", method: "static", cidr: `${ip}/24`, gateway: "10.0.1.1", autostart: 1, active: 1, bridge_ports: "enp3s0", bridge_vlan_aware: 1, comments: "Réseau principal" },
    ...(node === NODE ? [{ iface: "vmbr1", type: "bridge", method: "static", cidr: "192.168.50.1/24", autostart: 1, active: 1, bridge_ports: "", comments: "Lab isolé" }] : []),
  ];
  const disks: Disk[] = [
    { devpath: "/dev/nvme0n1", model: node === NODE ? "Samsung SSD 980 PRO 1TB" : "WD Blue SN570 500GB", serial: "S5GXNF0R123456", size: (node === NODE ? 1000 : 500) * GB, type: "nvme", health: "PASSED", wearout: 91, used: "LVM", gpt: 1 },
    { devpath: "/dev/sda", model: "WDC WD40EFRX-68N32N0", serial: "WD-WCC7K1234567", size: 4000 * GB, type: "hdd", health: "PASSED", wearout: "N/A", rpm: 5400, used: "ZFS", gpt: 1 },
    { devpath: "/dev/sdb", model: "WDC WD40EFRX-68N32N0", serial: "WD-WCC7K7654321", size: 4000 * GB, type: "hdd", health: "FAILED", wearout: "N/A", rpm: 5400, used: "ZFS", gpt: 1 },
    { devpath: "/dev/sdc", model: "Crucial MX500 1TB", serial: "2140E5A1B2C3", size: 1000 * GB, type: "ssd", health: "PASSED", wearout: 97, used: "", gpt: 0 },
    { devpath: "/dev/sdd", model: "Crucial MX500 1TB", serial: "2140E5A1B2C4", size: 1000 * GB, type: "ssd", health: "PASSED", wearout: 98, used: "", gpt: 0 },
  ];
  return {
    net, pending: net.map((i) => ({ ...i })),
    dns: { search: "maison.lan", dns1: "10.0.1.53", dns2: "1.1.1.1" },
    hosts: `127.0.0.1 localhost.localdomain localhost\n${ip} ${node}.maison.lan ${node}\n\n# IPv6\n::1 ip6-localhost ip6-loopback\n`,
    timezone: "Europe/Paris",
    certs: [
      { filename: "pve-root-ca.pem", subject: "/CN=Proxmox Virtual Environment/OU=abc/O=PVE Cluster Manager CA", issuer: "/CN=Proxmox Virtual Environment/OU=abc/O=PVE Cluster Manager CA", notafter: now() + 3200 * DAY, notbefore: now() - 400 * DAY, fingerprint: "AA:BB:CC:DD:EE:FF:00:11", "public-key-type": "rsaEncryption", "public-key-bits": 4096 },
      { filename: "pve-ssl.pem", subject: `/CN=${node}.maison.lan`, issuer: "/CN=Proxmox Virtual Environment/OU=abc/O=PVE Cluster Manager CA", notafter: now() + 9 * DAY, notbefore: now() - 721 * DAY, san: [`${node}.maison.lan`, ip, "localhost"], fingerprint: "CC:DD:EE:FF:00:11:22:33", "public-key-type": "rsaEncryption", "public-key-bits": 2048 },
    ],
    config: {},
    disks,
    lvm: [{ vg: "pve", size: (node === NODE ? 999 : 499) * GB, free: 16 * GB, lvcount: 3, pvs: "/dev/nvme0n1p3" }],
    lvmthin: [{ lv: "data", vg: "pve", lv_size: (node === NODE ? 832 : 380) * GB, used: 0.33, metadata_size: 8 * GB, metadata_used: 0.02 }],
    dirs: [],
    zfs: [{ name: "tank", size: 4000 * GB, alloc: 1.9e12, free: 2.1e12, frag: 12, dedup: 1, health: "DEGRADED", raidlevel: "mirror", devices: ["/dev/sda", "/dev/sdb"] }],
    services: DEFAULT_SERVICES.map(([name, state, desc]) => ({ name, state, desc, unit: state === "dead" ? "disabled" : "enabled" })),
    subscription: { status: "notfound", message: "There is no subscription key", serverid: "4C1D2E3F4A5B6C7D8E9F0A1B2C3D4E5F" },
    repos: [
      { path: "/etc/apt/sources.list", repositories: [
        { Types: ["deb"], URIs: ["http://deb.debian.org/debian"], Suites: ["bookworm"], Components: ["main", "contrib"], Enabled: 1, FileType: "list", Comment: "" },
        { Types: ["deb"], URIs: ["http://deb.debian.org/debian"], Suites: ["bookworm-updates"], Components: ["main", "contrib"], Enabled: 1, FileType: "list" },
        { Types: ["deb"], URIs: ["http://security.debian.org/debian-security"], Suites: ["bookworm-security"], Components: ["main", "contrib"], Enabled: 1, FileType: "list" },
      ] },
      { path: "/etc/apt/sources.list.d/pve-enterprise.list", repositories: [
        { Types: ["deb"], URIs: ["https://enterprise.proxmox.com/debian/pve"], Suites: ["bookworm"], Components: ["pve-enterprise"], Enabled: 1, FileType: "list" },
      ] },
    ],
    journal: [],
    journalAt: now() - 3600,
  };
}

function st(node: string): NodeState {
  const s = S() as Any;
  s.nodeState ??= {};
  return (s.nodeState[node] ??= initNode(node));
}
function ceph(): Ceph {
  const s = S() as Any;
  return (s.ceph ??= {
    flags: [],
    pools: [{ pool: 1, pool_name: ".mgr", size: 2, min_size: 1, pg_num: 1, crush_rule_name: "replicated_rule", bytes_used: 1.2e6, percent_used: 0.0001, application_metadata: { mgr: {} } },
      { pool: 2, pool_name: "rbd-vm", size: 2, min_size: 1, pg_num: 32, pg_autoscale_mode: "on", crush_rule_name: "replicated_rule", bytes_used: 210 * GB, percent_used: 0.11, application_metadata: { rbd: {} } }],
    osds: [{ id: 0, name: "osd.0", host: NODE2, status: "up", in: 1, device_class: "ssd", crush_weight: 0.9, percent_used: 11.2, total_space: 1000 * GB, apply_latency_ms: 1, commit_latency_ms: 1 },
      { id: 1, name: "osd.1", host: NODE2, status: "up", in: 1, device_class: "ssd", crush_weight: 0.9, percent_used: 10.8, total_space: 1000 * GB, apply_latency_ms: 2, commit_latency_ms: 2 }],
    fs: [],
  });
}
function acme(): Acme {
  const s = S() as Any;
  return (s.acme ??= {
    accounts: [{ name: "default", account: { contact: ["mailto:admin@maison.lan"], status: "valid", createdAt: new Date(Date.now() - 200 * DAY * 1000).toISOString() }, directory: "https://acme-v02.api.letsencrypt.org/directory", location: "https://acme-v02.api.letsencrypt.org/acme/acct/123456", tos: "https://letsencrypt.org/documents/LE-SA-v1.4-April-3-2024.pdf" }],
    plugins: [{ plugin: "standalone", type: "standalone" }, { plugin: "ovh", type: "dns", api: "ovh", data: "OVH_AK=xxxx\nOVH_AS=xxxx\nOVH_CK=xxxx", "validation-delay": 30 }],
  });
}

// ── /etc/network/interfaces ───────────────────────────────────────
function ifaceText(list: Iface[]) {
  const out: string[] = ["auto lo", "iface lo inet loopback", ""];
  for (const i of list.filter((x) => x.type !== "loopback").sort((a, b) => a.iface.localeCompare(b.iface))) {
    if (i.autostart) out.push(`auto ${i.iface}`);
    out.push(`iface ${i.iface} inet ${i.method ?? "manual"}`);
    if (i.cidr) out.push(`\taddress ${i.cidr}`);
    if (i.gateway) out.push(`\tgateway ${i.gateway}`);
    if (i.mtu) out.push(`\tmtu ${i.mtu}`);
    if (i.type === "bridge") {
      out.push(`\tbridge-ports ${i.bridge_ports || "none"}`, "\tbridge-stp off", "\tbridge-fd 0");
      if (i.bridge_vlan_aware) out.push("\tbridge-vlan-aware yes", "\tbridge-vids 2-4094");
    }
    if (i.type === "bond") out.push(`\tbond-slaves ${i.slaves ?? "none"}`, `\tbond-mode ${i.bond_mode ?? "balance-rr"}`, "\tbond-miimon 100");
    if (i.type === "vlan" && i["vlan-raw-device"]) out.push(`\tvlan-raw-device ${i["vlan-raw-device"]}`);
    if (i.type.startsWith("OVS")) out.push(`\tovs_type ${i.type}`, ...(i.ovs_bridge ? [`\tovs_bridge ${i.ovs_bridge}`] : []), ...(i.ovs_ports ? [`\tovs_ports ${i.ovs_ports}`] : []));
    if (i.cidr6) out.push("", `iface ${i.iface} inet6 static`, `\taddress ${i.cidr6}`, ...(i.gateway6 ? [`\tgateway ${i.gateway6}`] : []));
    if (i.comments) out.push(`#${i.comments}`);
    out.push("");
  }
  return out.join("\n");
}
/** Diff unifié minimal (LCS) entre deux textes. */
export function unifiedDiff(a: string, b: string) {
  const x = a.split("\n");
  const y = b.split("\n");
  const L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: string[] = ["--- /etc/network/interfaces", "+++ /etc/network/interfaces.new"];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { out.push(` ${x[i]}`); i++; j++; }
    else if (j < y.length && (i >= x.length || L[i][j + 1] >= L[i + 1][j])) out.push(`+${y[j++]}`);
    else out.push(`-${x[i++]}`);
  }
  return out.join("\n");
}

const IFACE_KEYS = ["type", "cidr", "gateway", "cidr6", "gateway6", "autostart", "bridge_ports", "bridge_vlan_aware", "slaves", "bond_mode", "vlan-raw-device", "vlan-id", "comments", "mtu", "ovs_type", "ovs_bridge", "ovs_ports"];
function applyIface(i: Any, p: Params) {
  for (const k of IFACE_KEYS) if (p[k] !== undefined && p[k] !== "") i[k] = ["autostart", "bridge_vlan_aware", "mtu", "vlan-id"].includes(k) ? Number(p[k]) : String(p[k]);
  for (const k of String(p.delete ?? "").split(",").filter(Boolean)) delete i[k];
  i.method = i.cidr ? "static" : "manual";
  return i;
}

/** Date locale « AAAA-MM-JJ HH:MM:SS », comme dans un vrai syslog. */
const localStamp = (t: number) => {
  const d = new Date(t * 1000);
  const p2 = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};
const parseTime = (v: unknown) => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e9) return n;
  const t = Date.parse(String(v).replace(" ", "T"));
  return Number.isFinite(t) ? t / 1000 : null;
};
const lineTime = (l: string) => Date.parse(l.slice(0, 19).replace(" ", "T")) / 1000;

function journalLines(node: string) {
  const n = st(node);
  // Le journal avance : une ligne toutes les 20 secondes environ depuis la dernière lecture
  const msgs = [
    `pvestatd[1201]: status update time (0.${Math.floor(Math.random() * 900)} seconds)`,
    "pveproxy[1532]: worker 18234 finished",
    "pvedaemon[1432]: <root@pam> successful auth for user 'root@pam'",
    "kernel: vmbr0: port 3(tap101i0) entered forwarding state",
    "systemd[1]: Started session-42.scope - Session 42 of User root.",
    "pvescheduler[5512]: starting server",
    "chronyd[912]: Selected source 162.159.200.123 (2.debian.pool.ntp.org)",
  ];
  while (n.journalAt < now()) {
    n.journalAt += 15 + Math.floor(Math.random() * 15);
    n.journal.push(`${localStamp(n.journalAt)} ${node} ${msgs[Math.floor(Math.random() * msgs.length)]}`);
  }
  if (n.journal.length > 2000) n.journal.splice(0, n.journal.length - 2000);
  return n.journal;
}


/** `rest` = segments après /nodes/{node}. Retourne undefined si rien ne correspond. */
export function nodeRoute(method: string, node: string, rest: string[], p: Params): Any {
  const s = S();
  const n = st(node);
  const r = `${method} /${rest.join("/")}`;
  const ok = (type: string, lines: string[] = [], id = "") => addTask(type, id, lines, "OK", node);

  // ── Alimentation et actions de masse ──
  if (r === "POST /status") {
    if (!["reboot", "shutdown"].includes(String(p.command))) fail(400, "command: value 'x' does not have a value in the enumeration 'reboot, shutdown'");
    ok(p.command === "reboot" ? "noderestart" : "nodeshutdown", [`démo : le nœud ${node} ne s'arrête pas vraiment`]);
    return null;
  }
  if (r === "POST /startall" || r === "POST /stopall") {
    const start = r === "POST /startall";
    const ids = p.vms ? String(p.vms).split(",").map(Number) : null;
    for (const x of s.guests.filter((g) => g.node === node && !g.template && (!ids || ids.includes(g.vmid)) && (start ? g.onboot || p.force : true))) {
      Object.assign(x, start ? { status: "running", started: now(), cpu: 0.05 } : { status: "stopped", cpu: 0 });
    }
    return ok(start ? "startall" : "stopall");
  }
  if (r === "POST /migrateall") {
    const target = String(p.target);
    if (!NODES.includes(target) || target === node) fail(400, "target: cible invalide");
    const ids = p.vms ? String(p.vms).split(",").map(Number) : null;
    for (const x of s.guests.filter((g) => g.node === node && (!ids || ids.includes(g.vmid)))) x.node = target;
    return ok("migrateall", [`migrating all guests to ${target}`]);
  }
  if (r === "POST /termproxy" || r === "POST /vncshell") return { port: "5902", ticket: `PVEVNC:DEMO${Math.random().toString(36).slice(2, 10)}`, user: "demo@pve", upid: ok("vncshell") };

  // ── Réseau ──
  if (r === "GET /network") {
    const list = (p.type ? n.pending.filter((i) => (p.type === "any_bridge" ? i.type === "bridge" || i.type === "OVSBridge" : i.type === p.type)) : n.pending).map((i) => ({ ...i, priority: 0 }));
    if (p._full) {
      const changes = unifiedDiff(ifaceText(n.net), ifaceText(n.pending));
      return { data: list, changes: changes.split("\n").some((l) => /^[+-][^+-]/.test(l)) ? changes : null };
    }
    return list;
  }
  if (r === "POST /network") {
    const name = String(p.iface ?? "");
    if (!/^[a-zA-Z][\w.:-]{0,19}$/.test(name)) fail(400, "iface: invalid format");
    if (n.pending.some((i) => i.iface === name)) fail(500, `interface '${name}' already exists`);
    n.pending.push(applyIface({ iface: name, type: String(p.type), active: 0 }, p));
    return null;
  }
  if (r === "PUT /network") {
    n.net = n.pending.map((i) => ({ ...i, active: 1 }));
    n.pending = n.net.map((i) => ({ ...i }));
    return ok("srvreload", ["ifreload -a", "TASK OK"], "networking");
  }
  if (r === "DELETE /network") {
    n.pending = n.net.map((i) => ({ ...i }));
    return null;
  }
  if (rest[0] === "network" && rest[1]) {
    const i = n.pending.find((x) => x.iface === rest[1]) ?? fail(500, `interface '${rest[1]}' does not exist`);
    if (method === "GET") return { ...i, method: i!.method, families: ["inet"] };
    if (method === "PUT") { applyIface(i, p); return null; }
    if (method === "DELETE") { n.pending = n.pending.filter((x) => x !== i); return null; }
  }

  // ── DNS, hosts, heure ──
  if (r === "GET /dns") return { ...n.dns };
  if (r === "PUT /dns") {
    if (!p.search) fail(400, "search: property is missing and it is not optional");
    n.dns = { search: String(p.search), dns1: (p.dns1 as string) || undefined, dns2: (p.dns2 as string) || undefined, dns3: (p.dns3 as string) || undefined };
    return null;
  }
  if (r === "GET /hosts") return { data: n.hosts, digest: "demo" };
  if (r === "POST /hosts") { n.hosts = String(p.data ?? ""); return null; }
  if (r === "GET /time") return { timezone: n.timezone, localtime: now() + 3600, time: now() };
  if (r === "PUT /time") { n.timezone = String(p.timezone); return null; }

  // ── Certificats et ACME ──
  if (r === "GET /certificates/info") return n.certs;
  if (r === "POST /certificates/custom") {
    if (!String(p.certificates ?? "").includes("BEGIN CERTIFICATE")) fail(400, "certificates: le contenu ne ressemble pas à un certificat PEM");
    n.certs = n.certs.filter((c) => c.filename !== "pveproxy-ssl.pem");
    n.certs.push({ filename: "pveproxy-ssl.pem", subject: `/CN=${node}.exemple.fr`, issuer: "/C=FR/O=Mon autorité", notafter: now() + 365 * DAY, notbefore: now(), san: [`${node}.exemple.fr`], fingerprint: "12:34:56:78:9A:BC:DE:F0" });
    return n.certs.at(-1);
  }
  if (r === "DELETE /certificates/custom") { n.certs = n.certs.filter((c) => c.filename !== "pveproxy-ssl.pem"); return null; }
  if (r === "GET /config") return { ...n.config, digest: "demo" };
  if (r === "PUT /config") {
    for (const [k, v] of Object.entries(p)) if (!["delete", "digest"].includes(k)) n.config[k] = String(v);
    for (const k of String(p.delete ?? "").split(",").filter(Boolean)) delete n.config[k];
    return null;
  }
  if (rest.join("/") === "certificates/acme/certificate") {
    const domains = Object.entries(n.config).filter(([k]) => /^acmedomain\d+$/.test(k)).map(([, v]) => v.split(",")[0].replace(/^domain=/, ""));
    if (method === "DELETE") { n.certs = n.certs.filter((c) => c.filename !== "pveproxy-ssl.pem"); return ok("acmerevoke"); }
    if (!domains.length) fail(500, "no domains configured for node");
    n.certs = n.certs.filter((c) => c.filename !== "pveproxy-ssl.pem");
    n.certs.push({ filename: "pveproxy-ssl.pem", subject: `/CN=${domains[0]}`, issuer: "/C=US/O=Let's Encrypt/CN=R11", notafter: now() + 90 * DAY, notbefore: now(), san: domains, fingerprint: "AB:CD:EF:01:23:45:67:89" });
    return ok(method === "PUT" ? "acmerenew" : "acmenewcert", ["Loading ACME account details", `Placing ACME order for ${domains.join(", ")}`, "Validating challenge...", "Status is 'valid', domain done!", "Downloading certificate", "Setting pveproxy certificate and key", "Restarting pveproxy"]);
  }

  // ── Mises à jour et dépôts ──
  if (r === "POST /apt/update") return ok("aptupdate", ["Hit:1 http://deb.debian.org/debian bookworm InRelease", "Get:2 http://security.debian.org/debian-security bookworm-security InRelease [48.0 kB]", "Reading package lists...", "TASK OK"]);
  if (r === "GET /apt/changelog") {
    return `${p.name} (nouvelle version) bookworm; urgency=medium\n\n  * Correction de plusieurs bogues et améliorations de stabilité.\n  * Mise à jour de sécurité (démo).\n\n -- Proxmox Support Team <support@proxmox.com>  ${new Date().toUTCString()}\n`;
  }
  if (r === "GET /apt/versions") return [["proxmox-ve", "8.4.0"], ["pve-manager", "8.4.1"], ["proxmox-kernel-6.8", "6.8.12-4"], ["qemu-server", "8.3.12"], ["pve-container", "5.2.6"], ["lxc-pve", "6.0.0-1"], ["zfsutils-linux", "2.2.7-pve2"], ["ceph-fuse", "17.2.8-pve2"], ["corosync", "3.1.9-pve1"]].map(([Package, OldVersion]) => ({ Package, OldVersion, CurrentState: "Installed", Title: Package }));
  if (r === "GET /apt/repositories") {
    const has = (c: string) => n.repos.some((f) => f.repositories.some((x) => x.Components.includes(c) && x.Enabled));
    return {
      files: n.repos.map((f) => ({ ...f, "file-type": "list", digest: [0] })), errors: [], digest: "demo",
      infos: has("pve-enterprise") && s && n.subscription.status !== "active" ? [{ path: "/etc/apt/sources.list.d/pve-enterprise.list", index: 0, kind: "warning", message: "Le dépôt entreprise demande un abonnement actif." }] : [],
      "standard-repos": [
        { handle: "enterprise", name: "Enterprise", status: has("pve-enterprise") ? 1 : undefined },
        { handle: "no-subscription", name: "No-Subscription", status: has("pve-no-subscription") ? 1 : undefined },
        { handle: "test", name: "Test", status: has("pvetest") ? 1 : undefined },
        { handle: "ceph-reef-no-subscription", name: "Ceph Reef No-Subscription", status: undefined },
      ],
    };
  }
  if (r === "POST /apt/repositories") {
    const f = n.repos.find((x) => x.path === p.path) ?? fail(400, "path: fichier inconnu");
    const repo = f!.repositories[Number(p.index)] ?? fail(400, "index: dépôt inconnu");
    repo.Enabled = Number(p.enabled ?? 1);
    return null;
  }
  if (r === "PUT /apt/repositories") {
    const map: Record<string, [string, string, string]> = {
      "no-subscription": ["/etc/apt/sources.list", "http://download.proxmox.com/debian/pve", "pve-no-subscription"],
      test: ["/etc/apt/sources.list", "http://download.proxmox.com/debian/pve", "pvetest"],
      enterprise: ["/etc/apt/sources.list.d/pve-enterprise.list", "https://enterprise.proxmox.com/debian/pve", "pve-enterprise"],
      "ceph-reef-no-subscription": ["/etc/apt/sources.list.d/ceph.list", "http://download.proxmox.com/debian/ceph-reef", "no-subscription"],
    };
    const m = map[String(p.handle)] ?? fail(400, "handle: dépôt standard inconnu");
    let f = n.repos.find((x) => x.path === m![0]);
    if (!f) n.repos.push((f = { path: m![0], repositories: [] }));
    if (!f.repositories.some((x) => x.Components.includes(m![2]))) f.repositories.push({ Types: ["deb"], URIs: [m![1]], Suites: ["bookworm"], Components: [m![2]], Enabled: 1, FileType: "list" });
    return null;
  }

  // ── Disques ──
  if (r === "GET /disks/list") return n.disks.filter((d) => !p.type || (p.type === "unused" ? !d.used : true)).map((d) => ({ ...d, by_id_link: `/dev/disk/by-id/ata-${d.serial}`, osdid: d.used === "ceph" ? 0 : -1 }));
  if (r === "POST /disks/initgpt") {
    const d = n.disks.find((x) => x.devpath === p.disk) ?? fail(400, "disk: disque inconnu");
    if (d!.used) fail(500, `disk '${p.disk}' already in use`);
    d!.gpt = 1;
    return ok("diskinit", [`creating GPT on ${p.disk}`]);
  }
  if (r === "PUT /disks/wipedisk") {
    const d = n.disks.find((x) => x.devpath === p.disk) ?? fail(400, "disk: disque inconnu");
    if (/^(LVM|ZFS)/.test(d!.used) && d!.devpath === "/dev/nvme0n1") fail(500, "disk is used by the system (mounted)");
    Object.assign(d!, { used: "", gpt: 0 });
    n.zfs = n.zfs.filter((z) => !z.devices.includes(d!.devpath));
    return ok("wipedisk", [`wiping ${p.disk}`, "200+0 records in", "200+0 records out"]);
  }
  const useDisks = (devs: string[], used: string) => {
    for (const dev of devs) {
      const d = n.disks.find((x) => x.devpath === dev) ?? fail(400, `disk '${dev}' not found`);
      if (d!.used) fail(500, `disk '${dev}' is already in use`);
    }
    for (const dev of devs) Object.assign(n.disks.find((x) => x.devpath === dev)!, { used, gpt: 1 });
    return devs.reduce((a, dev) => a + (n.disks.find((x) => x.devpath === dev)?.size ?? 0), 0);
  };
  const addStorage = (id: string, type: string, extra: Record<string, unknown> = {}) => {
    (s.content[id] ??= []);
    storageCfg().push({ storage: id, type, nodes: node, content: type === "dir" ? "images,rootdir,iso,vztmpl,backup" : "images,rootdir", ...extra });
  };
  if (r === "GET /disks/lvm") return { leaf: 0, children: n.lvm.map((v) => ({ name: v.vg, size: v.size, free: v.free, leaf: 0, children: [{ name: v.pvs, size: v.size, free: v.free, leaf: 1 }] })) };
  if (r === "POST /disks/lvm") {
    const size = useDisks([String(p.device)], "LVM");
    n.lvm.push({ vg: String(p.name), size, free: size, lvcount: 0, pvs: String(p.device) });
    if (Number(p.add_storage)) addStorage(String(p.name), "lvm", { vgname: p.name });
    return ok("lvmcreate", [`creating volume group '${p.name}' on ${p.device}`]);
  }
  if (r === "GET /disks/lvmthin") return n.lvmthin.map((t) => ({ ...t }));
  if (r === "POST /disks/lvmthin") {
    const size = useDisks([String(p.device)], "LVM");
    n.lvm.push({ vg: String(p.name), size, free: 0, lvcount: 1, pvs: String(p.device) });
    n.lvmthin.push({ lv: String(p.name), vg: String(p.name), lv_size: size * 0.98, used: 0, metadata_size: size * 0.01, metadata_used: 0 });
    if (Number(p.add_storage)) addStorage(String(p.name), "lvmthin", { thinpool: p.name, vgname: p.name });
    return ok("lvmthincreate", [`creating thin pool '${p.name}'`]);
  }
  if (r === "GET /disks/directory") return n.dirs.map((d) => ({ ...d }));
  if (r === "POST /disks/directory") {
    useDisks([String(p.device)], "mounted");
    const path = `/mnt/pve/${p.name}`;
    n.dirs.push({ path, device: `${p.device}1`, type: String(p.filesystem ?? "ext4"), options: "defaults", unitfile: `/etc/systemd/system/mnt-pve-${p.name}.mount` });
    if (Number(p.add_storage)) addStorage(String(p.name), "dir", { path });
    return ok("dircreate", [`formatting ${p.device}1 as ${p.filesystem ?? "ext4"}`, `mounting on ${path}`]);
  }
  if (r === "GET /disks/zfs") return n.zfs.map(({ devices, raidlevel, ...z }) => z);
  if (r === "POST /disks/zfs") {
    const devs = String(p.devices ?? "").split(/[,\s]+/).filter(Boolean);
    const min: Record<string, number> = { single: 1, mirror: 2, raid10: 4, raidz: 3, raidz2: 4, raidz3: 5, "draid": 3, "draid2": 4, "draid3": 5 };
    const level = String(p.raidlevel ?? "single");
    if (devs.length < (min[level] ?? 1)) fail(400, `raidlevel '${level}' needs at least ${min[level]} disks`);
    if (!/^[a-zA-Z][\w-]*$/.test(String(p.name))) fail(400, "name: invalid format");
    if (n.zfs.some((z) => z.name === p.name)) fail(500, `pool '${p.name}' already exists`);
    const raw = useDisks(devs, "ZFS");
    const usable = level === "mirror" ? raw / devs.length : level === "raid10" ? raw / 2 : level.startsWith("raidz") ? raw * (devs.length - Number(level.slice(5) || 1)) / devs.length : raw;
    n.zfs.push({ name: String(p.name), size: usable, alloc: 0, free: usable, frag: 0, dedup: 1, health: "ONLINE", raidlevel: level, devices: devs });
    if (Number(p.add_storage)) addStorage(String(p.name), "zfspool", { pool: p.name });
    return ok("zfscreate", [`create ${level} zpool '${p.name}' with ${devs.join(" ")}`, `compression=${p.compression ?? "on"} ashift=${p.ashift ?? 12}`]);
  }
  if (rest[0] === "disks" && rest[2] && method === "GET" && rest[1] === "zfs") {
    const z = n.zfs.find((x) => x.name === rest[2]) ?? fail(404, `pool '${rest[2]}' not found`);
    return {
      name: z!.name, state: z!.health, status: z!.health === "DEGRADED" ? "One or more devices has experienced an unrecoverable error." : "", action: z!.health === "DEGRADED" ? "Replace the faulted device, or use 'zpool clear'." : "", scan: "scrub repaired 0B in 05:12:31 with 0 errors", errors: "No known data errors",
      children: [{ name: z!.name, state: z!.health, read: 0, write: 0, cksum: 0, leaf: 0, children: [{ name: z!.raidlevel === "single" ? z!.devices[0] : `${z!.raidlevel}-0`, state: z!.health, read: 0, write: 0, cksum: 0, leaf: 0, children: z!.devices.map((d) => ({ name: d, state: d === "/dev/sdb" ? "FAULTED" : "ONLINE", read: d === "/dev/sdb" ? 12 : 0, write: 0, cksum: d === "/dev/sdb" ? 3 : 0, leaf: 1 })) }] }],
    };
  }
  if (rest[0] === "disks" && rest[2] && method === "DELETE" && ["lvm", "lvmthin", "directory", "zfs"].includes(rest[1])) {
    const name = decodeURIComponent(rest[2]);
    const free = (devs: string[]) => { for (const dev of devs) { const d = n.disks.find((x) => x.devpath === dev); if (d && Number(p["cleanup-disks"])) Object.assign(d, { used: "", gpt: 0 }); else if (d) d.used = ""; } };
    if (rest[1] === "zfs") { const z = n.zfs.find((x) => x.name === name) ?? fail(404, "pool introuvable"); free(z!.devices); n.zfs = n.zfs.filter((x) => x !== z); }
    if (rest[1] === "lvm") { const v = n.lvm.find((x) => x.vg === name) ?? fail(404, "groupe introuvable"); if (v!.vg === "pve") fail(500, "volume group 'pve' is used by the system"); free([v!.pvs]); n.lvm = n.lvm.filter((x) => x !== v); }
    if (rest[1] === "lvmthin") { if (name === "data") fail(500, "thin pool 'data' is in use"); n.lvmthin = n.lvmthin.filter((x) => x.lv !== name); const v = n.lvm.find((x) => x.vg === p["volume-group"] || x.vg === name); if (v) { free([v.pvs]); n.lvm = n.lvm.filter((x) => x !== v); } }
    if (rest[1] === "directory") { const d = n.dirs.find((x) => x.path.endsWith(`/${name}`)) ?? fail(404, "dossier introuvable"); free([d!.device.replace(/\d+$/, "")]); n.dirs = n.dirs.filter((x) => x !== d); }
    if (Number(p["cleanup-config"])) { const cfg = storageCfg(); const i = cfg.findIndex((x) => x.storage === name); if (i >= 0) cfg.splice(i, 1); }
    return ok(`${rest[1]}remove`, [`removing ${rest[1]} '${name}'`]);
  }

  // ── Ceph ── (installé sur pve2 seulement, pour montrer les deux cas)
  if (rest[0] === "ceph") {
    if (node !== NODE2) fail(500, "binary not installed: /usr/bin/ceph-mon");
    const c = ceph();
    const sub = rest.slice(1).join("/");
    const up = c.osds.filter((o) => o.status === "up" && o.in).length;
    if (method === "GET" && sub === "status") {
      return {
        fsid: "6f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b", health: { status: up === c.osds.length && !c.flags.length ? "HEALTH_OK" : "HEALTH_WARN", checks: up < c.osds.length ? { OSD_DOWN: { severity: "HEALTH_WARN", summary: { message: `${c.osds.length - up} osds down` } } } : c.flags.length ? { OSDMAP_FLAGS: { severity: "HEALTH_WARN", summary: { message: `${c.flags.join(",")} flag(s) set` } } } : {} },
        monmap: { mons: [{ name: NODE2, addr: "10.0.1.102:6789/0" }] }, mgrmap: { active_name: NODE2, standbys: [] },
        osdmap: { num_osds: c.osds.length, num_up_osds: c.osds.filter((o) => o.status === "up").length, num_in_osds: c.osds.filter((o) => o.in).length },
        pgmap: { num_pgs: c.pools.reduce((a, x) => a + x.pg_num, 0), bytes_used: 220 * GB, bytes_total: 2000 * GB, bytes_avail: 1780 * GB, pgs_by_state: [{ state_name: "active+clean", count: c.pools.reduce((a, x) => a + x.pg_num, 0) }], read_bytes_sec: 1.2e6, write_bytes_sec: 3.4e6 },
      };
    }
    if (method === "GET" && sub === "mon") return [{ name: NODE2, host: NODE2, addr: "10.0.1.102:6789/0", quorum: 1, state: "running", ceph_version: "17.2.8", direxists: 1 }];
    if (method === "GET" && sub === "mgr") return [{ name: NODE2, host: NODE2, addr: "10.0.1.102", state: "active", ceph_version: "17.2.8" }];
    if (method === "GET" && sub === "osd") return { root: { leaf: 0, children: [{ name: "default", type: "root", leaf: 0, children: [{ name: NODE2, type: "host", leaf: 0, children: c.osds.map((o) => ({ ...o, type: "osd", leaf: 1 })) }] }] }, flags: c.flags.join(",") };
    if (method === "POST" && /^osd\/\d+\/(in|out)$/.test(sub)) {
      const o = c.osds.find((x) => x.id === Number(rest[2])) ?? fail(404, "osd introuvable");
      o!.in = rest[3] === "in" ? 1 : 0;
      return null;
    }
    if (method === "GET" && sub === "pool") return c.pools;
    if (method === "POST" && sub === "pool") {
      if (c.pools.some((x) => x.pool_name === p.name)) fail(500, `pool '${p.name}' already exists`);
      c.pools.push({ pool: c.pools.length + 1, pool_name: String(p.name), size: Number(p.size ?? 3), min_size: Number(p.min_size ?? 2), pg_num: Number(p.pg_num ?? 32), pg_autoscale_mode: String(p.pg_autoscale_mode ?? "on"), crush_rule_name: "replicated_rule", bytes_used: 0, percent_used: 0, application_metadata: { [String(p.application ?? "rbd")]: {} } });
      return ok("cephcreatepool", [`creating pool ${p.name}`]);
    }
    if (method === "DELETE" && rest[1] === "pool" && rest[2]) {
      c.pools = c.pools.filter((x) => x.pool_name !== rest[2]);
      return ok("cephdestroypool", [`destroying pool ${rest[2]}`]);
    }
    if (method === "GET" && sub === "fs") return c.fs;
    if (method === "GET" && sub === "cfg/raw") return `[global]\n\tauth_client_required = cephx\n\tauth_cluster_required = cephx\n\tauth_service_required = cephx\n\tcluster_network = 10.0.2.0/24\n\tfsid = 6f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b\n\tmon_host = 10.0.1.102\n\tosd_pool_default_min_size = 1\n\tosd_pool_default_size = 2\n\tpublic_network = 10.0.1.0/24\n`;
    if (method === "GET" && sub === "log") return [`${new Date().toISOString()} mon.${NODE2} (mon.0) 128 : cluster [INF] overall HEALTH_OK`, `${new Date().toISOString()} mgr.${NODE2} (mgr.4103) 552 : cluster [DBG] pgmap v552: 33 pgs: 33 active+clean`].map((t, i) => ({ n: i + 1, t }));
  }

  // ── Services ──
  if (r === "GET /services") return n.services.map((x) => ({ name: x.name, service: x.name, desc: x.desc, state: x.state === "dead" ? "stopped" : x.state, "active-state": x.state === "running" ? "active" : "inactive", "unit-state": x.unit }));
  if (rest[0] === "services" && rest[1]) {
    const v = n.services.find((x) => x.name === rest[1]) ?? fail(500, `service '${rest[1]}' does not exist`);
    if (method === "GET" && rest[2] === "state") return { name: v!.name, state: v!.state === "dead" ? "stopped" : v!.state, "unit-state": v!.unit, desc: v!.desc };
    if (method === "POST" && ["start", "stop", "restart", "reload"].includes(rest[2])) {
      if (rest[2] === "stop") v!.state = "dead";
      else v!.state = "running";
      return ok(`srv${rest[2]}`, [`${rest[2]} ${v!.name}`], v!.name);
    }
  }

  // ── Journaux ──
  if (r === "GET /syslog" || r === "GET /journal") {
    const lines = journalLines(node);
    const since = parseTime(p.since);
    const until = parseTime(p.until);
    let list = lines.filter((l) => (!since || lineTime(l) >= since) && (!until || lineTime(l) <= until));
    if (p.service) list = list.filter((l) => l.includes(`${p.service}[`) || l.includes(` ${p.service}:`));
    // Échecs de connexion repérés par l'audit de sécurité
    const fmt = (m: number) => localStamp(now() - m * 60);
    const auth = [
      `${fmt(240)} ${node} pvedaemon[1432]: authentication failure; rhost=::ffff:10.0.1.77 user=root@pam msg=Authentication failure`,
      `${fmt(239)} ${node} pvedaemon[1432]: authentication failure; rhost=::ffff:10.0.1.77 user=root@pam msg=Authentication failure`,
      `${fmt(95)} ${node} pvedaemon[1433]: authentication failure; rhost=::ffff:192.168.1.44 user=admin@pve msg=no such user ('admin@pve')`,
      `${fmt(38)} ${node} pvedaemon[1431]: authentication failure; rhost=::ffff:10.0.1.77 user=root@pam msg=Authentication failure`,
    ].filter((l) => (!since || lineTime(l) >= since) && (!p.service || p.service === "pvedaemon"));
    list = [...auth, ...list].sort((a, b) => lineTime(a) - lineTime(b));
    if (r === "GET /journal") {
      const last = Number(p.lastentries ?? 0);
      return last ? list.slice(-last) : list;
    }
    const start = Number(p.start ?? 0);
    const limit = Number(p.limit ?? 500);
    return list.slice(start, start + limit).map((t2, i) => ({ n: start + i + 1, t: t2 }));
  }

  // ── Abonnement ──
  if (r === "GET /subscription") return { ...n.subscription };
  if (r === "PUT /subscription") {
    const key = String(p.key ?? "");
    if (!/^pve\d[cbsp]-[0-9a-f]{10}$/i.test(key)) fail(400, "key: format attendu pve4c-0123456789 (clé de démo acceptée : pve2c-0123456789)");
    n.subscription = { status: "active", key, level: key[4] === "c" ? "c" : key[4], productname: "Proxmox VE Community Subscription 2 CPUs/year", regdate: new Date().toISOString().slice(0, 10), nextduedate: new Date(Date.now() + 365 * DAY * 1000).toISOString().slice(0, 10), checktime: now(), serverid: n.subscription.serverid, sockets: 1 };
    return null;
  }
  if (r === "POST /subscription") { n.subscription.checktime = now(); return null; }
  if (r === "DELETE /subscription") { n.subscription = { status: "notfound", message: "There is no subscription key", serverid: n.subscription.serverid }; return null; }

  return undefined;
}

/** Comptes et plugins ACME (niveau datacenter). `rest` = segments après /cluster/acme. */
export function acmeRoute(method: string, rest: string[], p: Params): Any {
  const a = acme();
  const [what, id] = rest;
  if (what === "directories" && method === "GET") return [{ name: "Let's Encrypt V2", url: "https://acme-v02.api.letsencrypt.org/directory" }, { name: "Let's Encrypt V2 Staging", url: "https://acme-staging-v02.api.letsencrypt.org/directory" }];
  if (what === "tos" && method === "GET") return "https://letsencrypt.org/documents/LE-SA-v1.4-April-3-2024.pdf";
  if (what === "meta" && method === "GET") return { termsOfService: "https://letsencrypt.org/documents/LE-SA-v1.4-April-3-2024.pdf", website: "https://letsencrypt.org" };
  if (what === "challenge-schema" && method === "GET") {
    return [
      { id: "ovh", name: "OVH", type: "dns", schema: { fields: { OVH_AK: { type: "string", description: "Application key" }, OVH_AS: { type: "string", description: "Application secret" }, OVH_CK: { type: "string", description: "Consumer key" } } } },
      { id: "cf", name: "Cloudflare", type: "dns", schema: { fields: { CF_Token: { type: "string", description: "API token" }, CF_Account_ID: { type: "string" } } } },
      { id: "gandi_livedns", name: "Gandi LiveDNS", type: "dns", schema: { fields: { GANDI_LIVEDNS_TOKEN: { type: "string" } } } },
      { id: "infomaniak", name: "Infomaniak", type: "dns", schema: { fields: { INFOMANIAK_API_TOKEN: { type: "string" } } } },
      { id: "duckdns", name: "DuckDNS", type: "dns", schema: { fields: { DuckDNS_Token: { type: "string" } } } },
    ];
  }
  if (what === "account") {
    if (!id && method === "GET") return a.accounts.map((x) => ({ name: x.name }));
    if (!id && method === "POST") {
      const name = String(p.name ?? "default");
      if (a.accounts.some((x) => x.name === name)) fail(500, `ACME account config file '${name}' already exists`);
      if (!String(p.contact ?? "").includes("@")) fail(400, "contact: adresse mail attendue");
      a.accounts.push({ name, account: { contact: [`mailto:${p.contact}`], status: "valid", createdAt: new Date().toISOString() }, directory: String(p.directory ?? "https://acme-v02.api.letsencrypt.org/directory"), tos: p.tos_url });
      return addTask("acmeregister", name);
    }
    const acc = a.accounts.find((x) => x.name === id) ?? fail(404, `ACME account '${id}' does not exist`);
    if (method === "GET") return acc;
    if (method === "PUT") { if (p.contact) acc!.account.contact = [`mailto:${p.contact}`]; return addTask("acmeupdate", String(id)); }
    if (method === "DELETE") { a.accounts = a.accounts.filter((x) => x !== acc); return addTask("acmedeactivate", String(id)); }
  }
  if (what === "plugins") {
    if (!id && method === "GET") return a.plugins.filter((x) => !p.type || x.type === p.type);
    if (!id && method === "POST") {
      if (a.plugins.some((x) => x.plugin === p.id)) fail(500, `plugin '${p.id}' already exists`);
      a.plugins.push({ plugin: String(p.id), type: String(p.type ?? "dns"), api: p.api, data: p.data, "validation-delay": p["validation-delay"] ?? 30 });
      return null;
    }
    const pl = a.plugins.find((x) => x.plugin === id) ?? fail(404, `plugin '${id}' not defined`);
    if (method === "GET") return pl;
    if (method === "PUT") { Object.assign(pl!, { api: p.api ?? pl!.api, data: p.data ?? pl!.data, "validation-delay": p["validation-delay"] ?? pl!["validation-delay"] }); return null; }
    if (method === "DELETE") { a.plugins = a.plugins.filter((x) => x !== pl); return null; }
  }
  return undefined;
}

export { NODE };

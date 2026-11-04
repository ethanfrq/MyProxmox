// Faux Proxmox : la partie « Datacenter » (cluster, options, définitions de stockage,
// sauvegardes planifiées, accès, pools, HA, SDN, métriques, notifications, mappings).
import { DAY, GB, NODE, NODE2, NODES, PVE_PRIVS, S, addTask, fail, findGuest, now, type Any, type Params } from "./mock-core";

export interface StorageCfg { storage: string; type: string; content?: string; shared?: number; disable?: number; nodes?: string; [k: string]: Any }

interface Dc {
  cluster: { name: string; nodes: { name: string; nodeid: number; votes: number; ip: string }[] } | null;
  options: Record<string, Any>;
  storage: StorageCfg[];
  backups: Any[];
  users: Any[];
  groups: Any[];
  roles: Any[];
  realms: Any[];
  tfa: Record<string, Any[]>;
  pools: { poolid: string; comment?: string; members: string[] }[];
  haGroups: Any[];
  metrics: Any[];
  endpoints: Record<string, Any[]>;
  matchers: Any[];
  mappings: Record<string, Any[]>;
  sdn: { zones: Any[]; vnets: Any[]; subnets: Any[]; controllers: Any[]; ipams: Any[]; dns: Any[]; pending: boolean; applied: string };
}

const CUSTOM_ROLE = "MyProxmoxService";

function initDc(): Dc {
  const builtin: Record<string, string[]> = {
    Administrator: PVE_PRIVS,
    PVEAdmin: PVE_PRIVS.filter((x) => !/^(Permissions|Realm\.Allocate$|Sys\.Modify)/.test(x)),
    PVEVMAdmin: PVE_PRIVS.filter((x) => x.startsWith("VM.")),
    PVEVMUser: ["VM.Audit", "VM.Console", "VM.PowerMgmt", "VM.Backup", "VM.Snapshot", "VM.Config.CDROM", "VM.Config.Cloudinit"],
    PVEAuditor: PVE_PRIVS.filter((x) => /Audit$/.test(x)),
    PVEDatastoreAdmin: ["Datastore.Allocate", "Datastore.AllocateSpace", "Datastore.AllocateTemplate", "Datastore.Audit"],
    PVEDatastoreUser: ["Datastore.AllocateSpace", "Datastore.Audit"],
    PVEPoolAdmin: ["Pool.Allocate", "Pool.Audit"],
    PVEPoolUser: ["Pool.Audit"],
    PVESDNAdmin: ["SDN.Allocate", "SDN.Audit", "SDN.Use"],
    PVEUserAdmin: ["User.Modify", "Group.Allocate", "Realm.AllocateUser"],
    PVETemplateUser: ["VM.Audit", "VM.Clone"],
    PVEMappingAdmin: ["Mapping.Audit", "Mapping.Modify", "Mapping.Use"],
    NoAccess: [],
  };
  return {
    cluster: { name: "maison", nodes: [{ name: NODE, nodeid: 1, votes: 1, ip: "10.0.1.101" }, { name: NODE2, nodeid: 2, votes: 1, ip: "10.0.1.102" }] },
    options: { keyboard: "fr", console: "html5", email_from: "proxmox@maison.lan", language: "fr", "mac_prefix": "BC:24:11", migration: "secure,network=10.0.2.0/24", "bwlimit": "migration=200000", "tag-style": "shape=circle,ordering=config", "next-id": "lower=100,upper=999999" },
    storage: [
      { storage: "local", type: "dir", path: "/var/lib/vz", content: "iso,vztmpl,backup", shared: 0 },
      { storage: "local-lvm", type: "lvmthin", vgname: "pve", thinpool: "data", content: "images,rootdir" },
      { storage: "backup-nas", type: "nfs", server: "10.0.1.10", export: "/volume1/proxmox", path: "/mnt/pve/backup-nas", content: "backup", options: "vers=4.2", "prune-backups": "keep-daily=7,keep-weekly=4,keep-monthly=3" },
      { storage: "pbs", type: "pbs", server: "10.0.1.11", datastore: "homelab", username: "pve@pbs", fingerprint: "AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90", content: "backup", "prune-backups": "keep-last=3,keep-daily=14" },
    ],
    backups: [{ id: "backup-nightly", type: "vzdump", enabled: 1, schedule: "02:00", storage: "backup-nas", vmid: "100,101,102,104,106", mode: "snapshot", compress: "zstd", "notes-template": "{{guestname}}", mailnotification: "failure", "prune-backups": "keep-last=7", comment: "Sauvegarde de chaque nuit" }],
    users: [
      { userid: "root@pam", enable: 1, expire: 0, email: "root@maison.lan", comment: "", groups: [], keys: "" },
      { userid: "ethan@pve", enable: 1, expire: 0, firstname: "Ethan", lastname: "Franqueville", email: "ethan@maison.lan", groups: ["famille", "admins"], tokens: { laptop: { privsep: 1, expire: 0, comment: "Portable" } } },
      { userid: "myproxmox@pve", enable: 1, expire: 0, comment: "Compte de service MyProxmox", groups: [], tokens: { service: { privsep: 0, expire: 0, comment: "MyProxmox" } } },
      { userid: "backup@pve", enable: 0, expire: now() + 30 * DAY, comment: "Compte de sauvegarde (désactivé)", groups: [] },
    ],
    groups: [{ groupid: "famille", comment: "La maison" }, { groupid: "admins", comment: "Administrateurs" }],
    roles: [...Object.entries(builtin).map(([roleid, privs]) => ({ roleid, privs: privs.join(","), special: 1 })), { roleid: CUSTOM_ROLE, privs: "Sys.Audit,VM.Audit,Datastore.Audit,VM.PowerMgmt,VM.Snapshot,VM.Backup", special: 0 }],
    realms: [
      { realm: "pam", type: "pam", comment: "Linux PAM standard authentication", tfa: "" },
      { realm: "pve", type: "pve", comment: "Proxmox VE authentication server", default: 1 },
    ],
    tfa: {
      "ethan@pve": [{ type: "totp", id: "totp-1", description: "Téléphone", enable: 1, created: now() - 60 * DAY }, { type: "recovery", id: "recovery", description: "Codes de récupération", enable: 1, created: now() - 60 * DAY }],
    },
    pools: [
      { poolid: "infra", comment: "Services de base", members: [] },
      { poolid: "lab", comment: "Machines de test", members: [] },
      { poolid: "maison", comment: "", members: [] },
    ],
    haGroups: [{ group: "prefere-pve", nodes: `${NODE}:2,${NODE2}:1`, restricted: 0, nofailback: 0, comment: "Revenir sur pve quand il est là" }],
    metrics: [{ id: "influx", type: "influxdb", server: "10.0.1.20", port: 8089, disable: 0, influxdbproto: "udp" }],
    endpoints: {
      sendmail: [{ name: "mail-to-root", mailto: ["root@maison.lan"], "mailto-user": ["root@pam"], comment: "Envoyé à l'adresse de root@pam", origin: "builtin" }],
      smtp: [], gotify: [{ name: "gotify", server: "https://gotify.maison.lan", comment: "Téléphone" }], webhook: [],
    },
    matchers: [
      { name: "default-matcher", target: ["mail-to-root"], comment: "Tout envoyer à root", origin: "builtin" },
      { name: "erreurs-sauvegarde", "match-severity": ["error"], "match-field": ["exact:type=vzdump"], target: ["gotify"], mode: "all", comment: "Sauvegardes en échec sur le téléphone" },
    ],
    mappings: {
      pci: [{ id: "zigbee-usb", description: "Contrôleur USB de la clé Zigbee", map: [`node=${NODE},path=0000:05:00.0,id=1022:149c`] }, { id: "gpu-igpu", description: "iGPU Radeon", map: [`node=${NODE},path=0000:0a:00.0,id=1002:1638`] }],
      usb: [{ id: "onduleur", description: "Onduleur Eaton", map: [`node=${NODE},id=0463:ffff`] }],
      dir: [{ id: "partage-media", description: "Films et séries", map: [`node=${NODE},path=/tank/media`] }],
    },
    sdn: {
      zones: [{ zone: "maison", type: "simple", ipam: "pve", dhcp: "dnsmasq" }, { zone: "vlans", type: "vlan", bridge: "vmbr0", ipam: "pve" }],
      vnets: [{ vnet: "iot", zone: "vlans", tag: 30, alias: "Objets connectés" }, { vnet: "lab", zone: "maison", alias: "Réseau du lab" }],
      subnets: [{ subnet: "maison-10.10.0.0-24", vnet: "lab", cidr: "10.10.0.0/24", gateway: "10.10.0.1", snat: 1, "dhcp-range": ["start-address=10.10.0.100,end-address=10.10.0.200"], type: "subnet", zone: "maison" }],
      controllers: [], ipams: [{ ipam: "pve", type: "pve" }], dns: [], pending: false, applied: "",
    },
  };
}

const dc = (): Dc => ((S() as Any).dc ??= initDc());
export const storageCfg = (): StorageCfg[] => dc().storage;

/** Liste générique : CRUD sur un tableau d'objets identifiés par `key`. */
function crud(list: Any[], key: string, method: string, id: string | undefined, p: Params, opts: { label: string; validate?: (p: Params) => void; onCreate?: (o: Any) => void; protect?: (o: Any) => string | null; update?: (o: Any, p: Params) => void } ): Any {
  const clean = (o: Params) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !["delete", "digest", "pending"].includes(k) && v !== undefined));
  // Certaines créations passent l'identifiant dans le chemin (POST /cluster/metrics/server/{id})
  if (id && method === "POST" && !list.some((o) => String(o[key]) === id)) return crud(list, key, method, undefined, { ...p, [key]: id }, opts);
  if (!id) {
    if (method === "GET") return list.map((o) => ({ ...o }));
    if (method === "POST") {
      const v = String(p[key] ?? "");
      if (!v) fail(400, `${key}: property is missing and it is not optional`);
      if (list.some((o) => String(o[key]) === v)) fail(500, `${opts.label} '${v}' already exists`);
      opts.validate?.(p);
      const o = clean(p);
      opts.onCreate?.(o);
      list.push(o);
      return null;
    }
    return undefined;
  }
  const o = list.find((x) => String(x[key]) === id) ?? fail(500, `${opts.label} '${id}' does not exist`);
  if (method === "GET") return { ...o };
  if (method === "PUT") {
    if (opts.update) opts.update(o, p);
    else Object.assign(o, clean(p));
    for (const k of String(p.delete ?? "").split(/[,;\s]+/).filter(Boolean)) delete o[k];
    return null;
  }
  if (method === "DELETE") {
    const why = opts.protect?.(o);
    if (why) fail(500, why);
    list.splice(list.indexOf(o), 1);
    return null;
  }
  return undefined;
}

const csv = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,;\s]+/).filter(Boolean));

/** Routes /cluster/*, /storage*, /access/*, /pools* de la partie Datacenter. undefined si non gérée. */
export function dcRoute(method: string, seg: string[], p: Params): Any {
  const d = dc();
  const s = S();
  const [a, b, c, e] = seg;

  // ── Cluster ──
  if (a === "cluster" && b === "config") {
    if (!c && method === "GET") return [{ name: "nodes" }, { name: "totem" }, { name: "join" }, { name: "qdevice" }];
    if (!c && method === "POST") {
      if (d.cluster) fail(500, "cluster config '/etc/pve/corosync.conf' already exists");
      d.cluster = { name: String(p.clustername), nodes: [{ name: NODE, nodeid: 1, votes: 1, ip: String(p.link0 ?? "10.0.1.101").split(",")[0] }] };
      return addTask("clustercreate", String(p.clustername), ["Corosync Cluster Engine Authentication key generator.", "Writing corosync config to /etc/pve/corosync.conf", "Restart corosync and cluster filesystem"]);
    }
    if (c === "nodes" && method === "GET") return (d.cluster?.nodes ?? []).map((n) => ({ node: n.name, nodeid: n.nodeid, quorum_votes: n.votes, ring0_addr: n.ip }));
    if (c === "join" && method === "GET") {
      const cl = d.cluster ?? fail(500, "node is not in a cluster, no join info available!");
      return {
        nodelist: cl.nodes.map((n) => ({ name: n.name, nodeid: n.nodeid, quorum_votes: n.votes, pve_addr: n.ip, ring0_addr: n.ip, pve_fp: "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89" })),
        preferred_node: NODE, config_digest: "6c5e0b8b1e2f", totem: { cluster_name: cl.name, config_version: "4", interface: { 0: { linknumber: "0" } }, ip_version: "ipv4-6", secauth: "on", version: "2" },
      };
    }
    if (c === "join" && method === "POST") return addTask("clusterjoin", "", ["Request addition of this node", "Join request OK, finishing setup locally"]);
    if (c === "totem" && method === "GET") return d.cluster ? { cluster_name: d.cluster.name, config_version: "4", ip_version: "ipv4-6", secauth: "on", version: "2", interface: { 0: { linknumber: "0" } } } : fail(500, "pas de cluster");
    if (c === "qdevice" && method === "GET") return {};
    if (c === "nodes" && e === undefined && seg[3] && method === "DELETE") return null;
  }
  if (a === "cluster" && b === "status" && method === "GET") {
    if (!d.cluster) return [{ type: "node", id: `node/${NODE}`, name: NODE, nodeid: 0, online: 1, local: 1, ip: "10.0.1.101", level: "" }];
    return [
      { type: "cluster", id: "cluster", name: d.cluster.name, nodes: d.cluster.nodes.length, quorate: 1, version: 4 },
      ...d.cluster.nodes.map((n) => ({ type: "node", id: `node/${n.name}`, name: n.name, nodeid: n.nodeid, online: 1, local: n.name === NODE ? 1 : 0, ip: n.ip, level: "" })),
    ];
  }
  if (a === "cluster" && b === "options") {
    if (method === "GET") return { ...d.options };
    if (method === "PUT") {
      for (const [k, v] of Object.entries(p)) if (!["delete", "digest"].includes(k)) d.options[k] = v;
      for (const k of csv(p.delete)) delete d.options[k];
      return null;
    }
  }

  // ── Définitions de stockage ──
  if (a === "storage") {
    if (!b && method === "GET") return d.storage.filter((x) => !p.type || x.type === p.type).map((x) => ({ ...x, digest: "demo" }));
    if (!b && method === "POST") {
      const id = String(p.storage ?? "");
      if (!/^[a-z][a-z0-9_.-]*$/i.test(id)) fail(400, "storage: invalid format - storage ID");
      if (d.storage.some((x) => x.storage === id)) fail(500, `storage ID '${id}' already defined`);
      const need: Record<string, string[]> = { dir: ["path"], nfs: ["server", "export"], cifs: ["server", "share"], lvm: ["vgname"], lvmthin: ["vgname", "thinpool"], zfspool: ["pool"], iscsi: ["portal", "target"], rbd: ["pool"], cephfs: [], pbs: ["server", "datastore", "username"], glusterfs: ["server", "volume"], btrfs: ["path"], esxi: ["server", "username"] };
      for (const k of need[String(p.type)] ?? []) if (!p[k]) fail(400, `${k}: property is missing and it is not optional`);
      const o: StorageCfg = { storage: id, type: String(p.type) };
      for (const [k, v] of Object.entries(p)) if (!["storage", "type", "password", "encryption-key"].includes(k) && v !== "" && v !== undefined) o[k] = v;
      if (["nfs", "cifs", "pbs", "rbd", "cephfs", "iscsi", "glusterfs"].includes(o.type)) o.shared = 1;
      d.storage.push(o);
      (s.content[id] ??= []);
      return { storage: id, type: o.type };
    }
    const st = d.storage.find((x) => x.storage === b) ?? fail(500, `storage '${b}' does not exist`);
    if (method === "GET") return { ...st, digest: "demo" };
    if (method === "PUT") {
      for (const [k, v] of Object.entries(p)) if (!["delete", "digest", "password"].includes(k)) st![k] = v;
      for (const k of csv(p.delete)) delete st![k];
      return { storage: b, type: st!.type };
    }
    if (method === "DELETE") {
      if (s.guests.some((g) => Object.values(g.conf).some((v) => String(v).startsWith(`${b}:`)))) fail(500, `storage '${b}' is used by guests`);
      d.storage = d.storage.filter((x) => x !== st);
      return null;
    }
  }

  // ── Sauvegardes planifiées ──
  if (a === "cluster" && b === "backup") {
    const jobs = d.backups;
    if (c && e === "included_volumes" && method === "GET") {
      const j = jobs.find((x) => x.id === c) ?? fail(404, "job introuvable");
      return { children: s.guests.filter((g) => !g.template && jobMatches(j, g)).map((g) => ({ id: g.vmid, name: g.name, type: g.type, children: Object.entries(g.conf).filter(([k]) => /^(scsi|virtio|sata|ide|rootfs|mp)\d*$/.test(k)).map(([k, v]) => ({ id: `${g.vmid}:${k}`, name: k, included: !/backup=0/.test(String(v)) ? 1 : 0, reason: /backup=0/.test(String(v)) ? "disabled" : "" })) })) };
    }
    const r = crud(jobs, "id", method, c, p, {
      label: "backup job",
      onCreate: (o) => { o.type = "vzdump"; o.enabled ??= 1; },
      update: (o, q) => { for (const [k, v] of Object.entries(q)) if (!["delete", "digest"].includes(k)) o[k] = v; },
    });
    if (r !== undefined) {
      if (method === "GET" && !c) return r.map((j: Any) => ({ ...j, "next-run": j.enabled === 0 || j.enabled === "0" ? undefined : now() + 8 * 3600 }));
      return r;
    }
  }
  if (a === "cluster" && b === "backup-info" && c === "not-backed-up" && method === "GET") {
    return s.guests.filter((g) => !g.template && !d.backups.some((j) => Number(j.enabled ?? 1) && jobMatches(j, g))).map((x) => ({ vmid: x.vmid, name: x.name, type: x.type }));
  }

  // ── Accès ──
  if (a === "access") {
    if (b === "users") {
      if (!c && method === "GET") {
        return d.users.map((u) => ({ ...u, groups: (u.groups ?? []).join(","), "realm-type": String(u.userid).split("@")[1] === "pam" ? "pam" : "pve", tfa_locked_until: undefined, tokens: p.full ? Object.entries(u.tokens ?? {}).map(([tokenid, t]) => ({ tokenid, ...(t as Any) })) : undefined }));
      }
      if (!c && method === "POST") {
        if (!/^[^\s@:]+@[\w.-]+$/.test(String(p.userid))) fail(400, "userid: format attendu nom@domaine");
        if (d.users.some((u) => u.userid === p.userid)) fail(500, `user '${p.userid}' already exists`);
        const realm = String(p.userid).split("@")[1];
        if (!d.realms.some((r) => r.realm === realm)) fail(500, `domain '${realm}' does not exist`);
        d.users.push({ userid: p.userid, enable: Number(p.enable ?? 1), expire: Number(p.expire ?? 0), firstname: p.firstname, lastname: p.lastname, email: p.email, comment: p.comment, groups: csv(p.groups), keys: p.keys });
        return null;
      }
      const u = d.users.find((x) => x.userid === c) ?? fail(500, `user '${c}' does not exist`);
      if (e === "token") {
        const tid = seg[4];
        u.tokens ??= {};
        if (!tid && method === "GET") return Object.entries(u.tokens).map(([tokenid, t]) => ({ tokenid, ...(t as Any) }));
        if (tid && method === "GET") return u.tokens[tid] ?? fail(404, "jeton introuvable");
        if (tid && method === "POST") {
          if (u.tokens[tid]) fail(500, `Token '${tid}' for user '${c}' already exists`);
          u.tokens[tid] = { privsep: Number(p.privsep ?? 1), expire: Number(p.expire ?? 0), comment: p.comment ?? "" };
          return { "full-tokenid": `${c}!${tid}`, value: `${Math.random().toString(16).slice(2, 10)}-demo-${Math.random().toString(16).slice(2, 6)}-4abc-${Math.random().toString(16).slice(2, 14)}`, info: u.tokens[tid] };
        }
        if (tid && method === "PUT") { Object.assign(u.tokens[tid] ?? fail(404, "jeton introuvable"), { privsep: p.privsep !== undefined ? Number(p.privsep) : u.tokens[tid].privsep, expire: p.expire !== undefined ? Number(p.expire) : u.tokens[tid].expire, comment: p.comment ?? u.tokens[tid].comment }); return u.tokens[tid]; }
        if (tid && method === "DELETE") { delete u.tokens[tid]; s.acl = s.acl.filter((x) => x.ugid !== `${c}!${tid}`); return null; }
      }
      if (e === "unlock-tfa" && method === "PUT") return 1;
      if (!e && method === "GET") return { ...u, groups: u.groups ?? [], tokens: u.tokens ?? {} };
      if (!e && method === "PUT") {
        for (const k of ["enable", "expire", "firstname", "lastname", "email", "comment", "keys"]) if (p[k] !== undefined) u[k] = ["enable", "expire"].includes(k) ? Number(p[k]) : p[k];
        if (p.groups !== undefined) u.groups = Number(p.append) ? [...new Set([...(u.groups ?? []), ...csv(p.groups)])] : csv(p.groups);
        for (const k of csv(p.delete)) delete u[k];
        return null;
      }
      if (!e && method === "DELETE") {
        if (u.userid === "root@pam") fail(500, "can't remove root@pam");
        d.users = d.users.filter((x) => x !== u);
        s.acl = s.acl.filter((x) => x.ugid !== c);
        delete d.tfa[c!];
        return null;
      }
    }
    if (b === "password" && method === "PUT") {
      if (!d.users.some((u) => u.userid === p.userid)) fail(500, "user does not exist");
      if (String(p.password ?? "").length < 8) fail(400, "password: value must be at least 8 characters long");
      return null;
    }
    if (b === "groups") {
      if (c && method === "GET") {
        const g = d.groups.find((x) => x.groupid === c) ?? fail(500, `group '${c}' does not exist`);
        return { ...g, members: d.users.filter((u) => (u.groups ?? []).includes(c)).map((u) => u.userid) };
      }
      const r = crud(d.groups, "groupid", method, c, p, { label: "group", protect: () => null });
      if (r !== undefined && !c && method === "GET") return r.map((g: Any) => ({ ...g, users: d.users.filter((u) => (u.groups ?? []).includes(g.groupid)).map((u) => u.userid).join(",") }));
      if (method === "DELETE") { for (const u of d.users) u.groups = (u.groups ?? []).filter((x: string) => x !== c); s.acl = s.acl.filter((x) => !(x.type === "group" && x.ugid === c)); }
      return r;
    }
    if (b === "roles") {
      return crud(d.roles, "roleid", method, c, p, {
        label: "role",
        validate: (q) => { for (const x of csv(q.privs)) if (!PVE_PRIVS.includes(x)) fail(400, `invalid privilege '${x}'`); },
        onCreate: (o) => { o.privs = csv(o.privs).join(","); o.special = 0; },
        update: (o, q) => { if (o.special) fail(500, "cannot modify built-in role"); const add = csv(q.privs); o.privs = (Number(q.append) ? [...new Set([...csv(o.privs), ...add])] : add).join(","); },
        protect: (o) => (o.special ? "cannot delete built-in role" : s.acl.some((x) => x.roleid === o.roleid) ? `role '${o.roleid}' is in use` : null),
      });
    }
    if (b === "domains") {
      if (c && e === "sync" && method === "POST") return addTask("auth-realm-sync", c, [`starting sync for realm ${c}`, "got data from server, updating users and groups", "updated 12 users, 3 groups"]);
      return crud(d.realms, "realm", method, c, p, {
        label: "domain",
        onCreate: (o) => { if (!["ad", "ldap", "openid", "pve", "pam"].includes(String(o.type))) fail(400, "type: valeur inconnue"); },
        protect: (o) => (["pam", "pve"].includes(o.realm) ? "can't delete builtin realm" : null),
      });
    }
    if (b === "tfa") {
      if (!c && method === "GET") return Object.entries(d.tfa).map(([userid, entries]) => ({ userid, entries }));
      const list = (d.tfa[c!] ??= []);
      if (!e && method === "GET") return list;
      if (!e && method === "POST") {
        const type = String(p.type);
        if (type === "recovery") {
          if (list.some((x) => x.type === "recovery")) fail(500, "user already has recovery keys");
          const keys = Array.from({ length: 10 }, () => `${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}`);
          list.push({ type, id: "recovery", description: "Codes de récupération", enable: 1, created: now() });
          return { id: "recovery", recovery: keys };
        }
        if (type === "totp" && !/^\d{6}$/.test(String(p.value ?? ""))) fail(400, "Code TOTP incorrect");
        if (type === "webauthn" && !p.value) return { challenge: JSON.stringify({ publicKey: { challenge: "ZGVtbw", rp: { name: "Proxmox" } } }) };
        const id = `${type}-${list.length + 1}`;
        list.push({ type, id, description: String(p.description ?? ""), enable: 1, created: now() });
        return { id };
      }
      const entry = list.find((x) => x.id === e) ?? fail(404, "entrée introuvable");
      if (method === "PUT") { Object.assign(entry!, { description: p.description ?? entry!.description, enable: p.enable !== undefined ? Number(p.enable) : entry!.enable }); return null; }
      if (method === "DELETE") { d.tfa[c!] = list.filter((x) => x !== entry); return null; }
    }
  }

  // ── Pools ──
  if (a === "pools") {
    const members = (pool: string) => [
      ...s.guests.filter((g) => g.pool === pool).map((g) => ({ id: `${g.type}/${g.vmid}`, type: g.type, vmid: g.vmid, name: g.name, node: g.node, status: g.status })),
      ...(d.pools.find((x) => x.poolid === pool)?.members ?? []).map((st) => ({ id: `storage/${NODE}/${st}`, type: "storage", storage: st, node: NODE })),
    ];
    for (const pl of new Set(s.guests.map((g) => g.pool).filter(Boolean) as string[])) if (!d.pools.some((x) => x.poolid === pl)) d.pools.push({ poolid: pl, members: [] });
    const id = b ?? (p.poolid as string | undefined);
    if (!b && method === "GET" && !p.poolid) return d.pools.map((x) => ({ poolid: x.poolid, comment: x.comment }));
    if (!b && method === "POST") {
      if (!/^[A-Za-z0-9.\-_]+$/.test(String(p.poolid))) fail(400, "poolid: invalid format");
      if (d.pools.some((x) => x.poolid === p.poolid)) fail(500, `pool '${p.poolid}' already exists`);
      d.pools.push({ poolid: String(p.poolid), comment: String(p.comment ?? ""), members: [] });
      return null;
    }
    const pool = d.pools.find((x) => x.poolid === id) ?? fail(500, `pool '${id}' does not exist`);
    if (method === "GET") return b ? { comment: pool!.comment, members: members(pool!.poolid) } : [{ poolid: pool!.poolid, comment: pool!.comment, members: members(pool!.poolid) }];
    if (method === "PUT") {
      if (p.comment !== undefined) pool!.comment = String(p.comment);
      const remove = Number(p.delete) === 1;
      for (const v of csv(p.vms)) { const g = findGuest(v); if (remove) { if (g.pool === pool!.poolid) g.pool = undefined; } else { if (g.pool && g.pool !== pool!.poolid && !Number(p["allow-move"])) fail(500, `VM ${v} is already a pool member`); g.pool = pool!.poolid; } }
      for (const st of csv(p.storage)) pool!.members = remove ? pool!.members.filter((x) => x !== st) : [...new Set([...pool!.members, st])];
      return null;
    }
    if (method === "DELETE") {
      if (members(pool!.poolid).length) fail(500, "pool is not empty");
      d.pools = d.pools.filter((x) => x !== pool);
      return null;
    }
  }

  // ── Haute disponibilité ──
  if (a === "cluster" && b === "ha") {
    if (c === "groups") return crud(d.haGroups, "group", method, e, p, { label: "group", onCreate: (o) => { o.type = "group"; }, protect: (o) => (s.ha.some((h) => h.group === o.group) ? `ha group '${o.group}' is used by resources` : null) });
    if (c === "resources") {
      const res = s.ha;
      if (!e && method === "POST") {
        const sid = String(p.sid).includes(":") ? String(p.sid) : `vm:${p.sid}`;
        findGuest(sid.split(":")[1]);
        if (res.some((h) => h.sid === sid)) fail(500, `resource ID '${sid}' already defined`);
        res.push({ sid, state: String(p.state ?? "started"), group: p.group as string, comment: p.comment as string, max_restart: Number(p.max_restart ?? 1), max_relocate: Number(p.max_relocate ?? 1) } as Any);
        return null;
      }
      if (e && method === "PUT") { const h = res.find((x) => x.sid === e) ?? fail(500, "resource does not exist"); Object.assign(h!, Object.fromEntries(Object.entries(p).filter(([k]) => !["delete", "digest"].includes(k)))); for (const k of csv(p.delete)) delete (h as Any)[k]; return null; }
      if (e && method === "DELETE") { s.ha = res.filter((x) => x.sid !== e); return null; }
      if (e && method === "GET") return { ...(res.find((x) => x.sid === e) ?? fail(500, "resource does not exist")) };
      if (e && seg[4] === "migrate" && method === "POST") return { sid: e, requested: p.node };
      if (e && seg[4] === "relocate" && method === "POST") return { sid: e, requested: p.node };
    }
    if (c === "status" && e === "manager_status" && method === "GET") {
      return { manager_status: { master_node: NODE, node_status: Object.fromEntries(NODES.map((n) => [n, "online"])), service_status: Object.fromEntries(s.ha.map((h) => [h.sid, { node: NODE, state: h.state === "started" ? "started" : h.state }])) }, quorum: { node: NODE, quorate: "1" } };
    }
    if (c === "rules") fail(501, "Method 'GET /cluster/ha/rules' not implemented");
  }

  // ── SDN ──
  if (a === "cluster" && b === "sdn") {
    const z = d.sdn;
    const pend = (o: Any) => ({ ...o, ...(z.pending ? { state: "changed" } : {}) });
    if (!c && method === "GET") return [{ id: "vnets" }, { id: "zones" }, { id: "controllers" }, { id: "ipams" }, { id: "dns" }];
    if (!c && method === "PUT") { z.pending = false; z.applied = new Date().toISOString(); return addTask("reloadnetworkall", "", ["applique la configuration SDN sur tous les nœuds", `${NODE}: OK`, `${NODE2}: OK`]); }
    const mark = (r: Any) => { if (method !== "GET") z.pending = true; return r; };
    if (c === "zones") { const r = crud(z.zones, "zone", method, e, p, { label: "zone", protect: (o) => (z.vnets.some((v) => v.zone === o.zone) ? `zone '${o.zone}' is used by vnets` : null) }); return method === "GET" && !e ? (r as Any[]).map(pend) : mark(r); }
    if (c === "controllers") return mark(crud(z.controllers, "controller", method, e, p, { label: "controller" }));
    if (c === "ipams") return mark(crud(z.ipams, "ipam", method, e, p, { label: "ipam", protect: (o) => (o.ipam === "pve" ? "can't delete the builtin pve ipam" : null) }));
    if (c === "dns") return mark(crud(z.dns, "dns", method, e, p, { label: "dns" }));
    if (c === "vnets") {
      if (e && seg[4] === "subnets") {
        const sid = seg[5];
        const list = z.subnets.filter((x) => x.vnet === e);
        if (!sid && method === "GET") return list.map(pend);
        if (!sid && method === "POST") {
          const vnet = z.vnets.find((v) => v.vnet === e) ?? fail(500, "vnet introuvable");
          const id = `${vnet!.zone}-${String(p.subnet).replace("/", "-")}`;
          if (z.subnets.some((x) => x.subnet === id)) fail(500, "subnet already exists");
          z.subnets.push({ subnet: id, cidr: p.subnet, vnet: e, zone: vnet!.zone, gateway: p.gateway, snat: Number(p.snat ?? 0), "dhcp-range": csv(p["dhcp-range"]), type: "subnet" });
          z.pending = true;
          return null;
        }
        const sub = z.subnets.find((x) => x.subnet === sid) ?? fail(500, "subnet does not exist");
        if (method === "PUT") { Object.assign(sub!, { gateway: p.gateway ?? sub!.gateway, snat: p.snat !== undefined ? Number(p.snat) : sub!.snat }); z.pending = true; return null; }
        if (method === "DELETE") { z.subnets = z.subnets.filter((x) => x !== sub); z.pending = true; return null; }
        if (method === "GET") return sub;
      }
      const r = crud(z.vnets, "vnet", method, e, p, { label: "vnet", protect: (o) => (z.subnets.some((x) => x.vnet === o.vnet) ? `vnet '${o.vnet}' has subnets` : null) });
      return method === "GET" && !e ? (r as Any[]).map(pend) : mark(r);
    }
  }

  // ── Serveurs de métriques ──
  if (a === "cluster" && b === "metrics") {
    if (c === "server") return crud(d.metrics, "id", method, e, p, { label: "metric server" });
    if (!c && method === "GET") return [{ name: "server" }];
  }

  // ── Notifications ──
  if (a === "cluster" && b === "notifications") {
    if (c === "endpoints") {
      const kind = e;
      if (!kind) return [{ name: "sendmail" }, { name: "smtp" }, { name: "gotify" }, { name: "webhook" }];
      d.endpoints[kind] ??= [];
      return crud(d.endpoints[kind], "name", method, seg[4], p, { label: "endpoint", protect: (o) => (o.origin === "builtin" ? "cannot delete builtin target" : d.matchers.some((m) => (m.target ?? []).includes(o.name)) ? `target '${o.name}' is used by a matcher` : null), onCreate: (o) => { for (const k of ["mailto", "mailto-user"]) if (o[k] !== undefined) o[k] = csv(o[k]); } });
    }
    if (c === "targets" && method === "GET" && !e) return Object.entries(d.endpoints).flatMap(([type, list]) => list.map((t) => ({ name: t.name, type, comment: t.comment, disable: t.disable, origin: t.origin ?? "user-created" })));
    if (c === "targets" && e && seg[4] === "test" && method === "POST") return null;
    if (c === "matchers") return crud(d.matchers, "name", method, e, p, { label: "matcher", onCreate: (o) => { for (const k of ["target", "match-severity", "match-field", "match-calendar"]) if (o[k] !== undefined) o[k] = csv(o[k]); }, update: (o, q) => { for (const [k, v] of Object.entries(q)) if (!["delete", "digest"].includes(k)) o[k] = ["target", "match-severity", "match-field", "match-calendar"].includes(k) ? csv(v) : v; }, protect: (o) => (o.origin === "builtin" ? "cannot delete builtin matcher" : null) });
    if (c === "matcher-fields" && method === "GET") return [{ name: "type" }, { name: "hostname" }, { name: "job-id" }];
    if (c === "matcher-field-values" && method === "GET") return [...["vzdump", "fencing", "replication", "package-updates", "system-mail"].map((value) => ({ field: "type", value })), ...NODES.map((value) => ({ field: "hostname", value })), ...d.backups.map((j) => ({ field: "job-id", value: j.id }))];
  }

  // ── Mappings ──
  if (a === "cluster" && b === "mapping" && ["pci", "usb", "dir"].includes(String(c))) {
    return crud(d.mappings[c!] ??= [], "id", method, e, p, { label: "mapping", onCreate: (o) => { o.map = csv(o.map); }, update: (o, q) => { if (q.map !== undefined) o.map = csv(q.map); if (q.description !== undefined) o.description = q.description; } });
  }
  return undefined;
}

function jobMatches(j: Any, g: Any) {
  if (Number(j.all ?? 0)) return !csv(j.exclude).map(Number).includes(g.vmid);
  if (j.pool) return g.pool === j.pool;
  return csv(j.vmid).map(Number).includes(g.vmid);
}

export { GB, now };

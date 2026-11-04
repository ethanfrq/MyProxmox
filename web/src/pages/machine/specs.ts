// Formulaires du matériel et des options : un « spec » par élément.
// Chaque spec décrit les champs (Form.tsx) et la façon d'écrire la config Proxmox.
import { pve } from "../../lib/api";
import type { FieldDef, Values } from "../../components/Form";
import {
  BUS_MAX, DISK_KEY, OSTYPES_LXC, OSTYPES_QEMU, bridgesOf, freeIndex, isosOf, joinProps, joinQemuNet, parseProps, parseQemuNet, storagesFor, volumeOf,
  type GuestCtx,
} from "./common";

export interface Spec {
  title: string;
  /** Privilège Proxmox nécessaire (sur /vms/{vmid}). */
  priv: string;
  fields: FieldDef[];
  initial?: Values;
  help?: string;
  /** Corps de PUT /config (clés à écrire, et `delete` pour celles à retirer). */
  params: (v: Values) => Record<string, unknown>;
  /** Appel différent de PUT /config (redimensionnement, déplacement...). */
  run?: (v: Values) => Promise<unknown>;
}

const yes = (v: unknown) => v === true || v === 1 || v === "1";
const flag = (v: unknown) => (yes(v) ? 1 : undefined);
/** Pour les clés de premier niveau : vide → à supprimer. */
function topLevel(keys: string[], v: Values, conf: Record<string, string>) {
  const out: Record<string, unknown> = {};
  const del: string[] = [];
  for (const k of keys) {
    const val = v[k];
    if (val === undefined || val === "" || val === null) {
      if (conf[k] !== undefined) del.push(k);
    } else out[k] = typeof val === "boolean" ? (val ? 1 : 0) : val;
  }
  if (del.length) out.delete = del.join(",");
  return out;
}

const CACHE = [{ value: "", label: "Par défaut (aucun cache)" }, { value: "directsync", label: "Direct sync" }, { value: "writethrough", label: "Write through" }, { value: "writeback", label: "Write back (rapide, risque en cas de coupure)" }, { value: "unsafe", label: "Write back non sûr (tests uniquement)" }];

// ── Disques QEMU ──────────────────────────────────────────────────
export function qemuDisk(ctx: GuestCtx, key?: string, reattach?: string): Spec {
  const cur = key ? parseProps(ctx.conf[key]) : {};
  const adding = !key;
  const fields: FieldDef[] = [
    ...(adding ? [
      { name: "bus", label: "Bus", type: "select" as const, options: [{ value: "scsi", label: "SCSI (recommandé)" }, { value: "virtio", label: "VirtIO Block" }, { value: "sata", label: "SATA" }, { value: "ide", label: "IDE" }], default: "scsi" },
      { name: "index", label: "Numéro", type: "number" as const, min: 0, max: 30, help: "Proposé automatiquement : le premier libre." },
      ...(reattach ? [] : [
        { name: "storage", label: "Stockage", type: "api-select" as const, load: storagesFor(ctx.node, "images"), required: true },
        { name: "size", label: "Taille", type: "disk" as const, min: 1, max: 65536, default: 32, required: true },
      ]),
    ] : []),
    { name: "cache", label: "Cache", type: "select", options: CACHE },
    { name: "discard", label: "Libérer l'espace supprimé (discard)", type: "checkbox", help: "Utile sur un stockage thin (LVM-thin, ZFS, Ceph) : rend l'espace effacé dans la VM." },
    { name: "ssd", label: "Présenter comme un SSD", type: "checkbox" },
    { name: "iothread", label: "Thread d'E/S dédié", type: "checkbox", help: "Avec le contrôleur VirtIO SCSI single ou VirtIO Block." },
    { name: "backup", label: "Inclure dans les sauvegardes", type: "checkbox" },
    { name: "replicate", label: "Inclure dans la réplication", type: "checkbox", advanced: true },
    { name: "ro", label: "Lecture seule", type: "checkbox", advanced: true },
    { name: "aio", label: "Mode d'E/S asynchrone", type: "select", advanced: true, options: [{ value: "", label: "Par défaut (io_uring)" }, { value: "native", label: "native" }, { value: "threads", label: "threads" }] },
    { name: "mbps_rd", label: "Lecture max", type: "number", unit: "Mo/s", advanced: true },
    { name: "mbps_wr", label: "Écriture max", type: "number", unit: "Mo/s", advanced: true },
    { name: "iops_rd", label: "Lectures max", type: "number", unit: "IOPS", advanced: true },
    { name: "iops_wr", label: "Écritures max", type: "number", unit: "IOPS", advanced: true },
    { name: "serial", label: "Numéro de série", advanced: true },
  ];
  const initial: Values = {
    bus: "scsi", index: freeIndex(ctx.conf, "scsi", BUS_MAX.scsi),
    cache: cur.cache ?? "", discard: cur.discard === "on", ssd: yes(cur.ssd), iothread: yes(cur.iothread), backup: cur.backup !== "0", replicate: cur.replicate !== "0",
    ro: yes(cur.ro), aio: cur.aio ?? "", mbps_rd: cur.mbps_rd ?? "", mbps_wr: cur.mbps_wr ?? "", iops_rd: cur.iops_rd ?? "", iops_wr: cur.iops_wr ?? "", serial: cur.serial ?? "",
  };
  const opts = (v: Values) => ({
    cache: v.cache || undefined, discard: v.discard ? "on" : undefined, ssd: flag(v.ssd), iothread: flag(v.iothread),
    backup: v.backup ? undefined : 0, replicate: v.replicate ? undefined : 0, ro: flag(v.ro), aio: v.aio || undefined,
    mbps_rd: v.mbps_rd || undefined, mbps_wr: v.mbps_wr || undefined, iops_rd: v.iops_rd || undefined, iops_wr: v.iops_wr || undefined, serial: v.serial || undefined,
  });
  return {
    title: reattach ? `Rattacher ${volumeOf(reattach)}` : adding ? "Ajouter un disque" : `Disque ${key}`,
    priv: "VM.Config.Disk",
    fields,
    initial,
    params: (v) => {
      if (adding) {
        const idx = v.index === "" || v.index === undefined ? freeIndex(ctx.conf, String(v.bus), BUS_MAX[String(v.bus)]) : v.index;
        const k = `${v.bus}${idx}`;
        if (ctx.conf[k] !== undefined) throw new Error(`${k} est déjà utilisé. Choisis un autre numéro.`);
        const file = reattach ? volumeOf(reattach) : `${v.storage}:${v.size}`;
        return { [k]: joinProps({ file, ...opts(v) }) };
      }
      const { file, size } = cur;
      return { [key!]: joinProps({ file, ...opts(v), size }) };
    },
  };
}

export function resizeDisk(ctx: GuestCtx, key: string): Spec {
  return {
    title: `Agrandir ${key}`,
    priv: "VM.Config.Disk",
    help: "On ne peut qu'agrandir un disque. Il faudra ensuite étendre la partition dans le système invité.",
    fields: [{ name: "add", label: "Espace à ajouter", type: "disk", min: 1, max: 65536, required: true, default: 8 }],
    params: () => ({}),
    run: (v) => pve.put(`${ctx.base}/resize`, { disk: key, size: `+${v.add}G` }),
  };
}

export function moveDisk(ctx: GuestCtx, key: string): Spec {
  const cur = volumeOf(ctx.conf[key]).split(":")[0];
  return {
    title: `Déplacer ${key} vers un autre stockage`,
    priv: "VM.Config.Disk",
    help: `Actuellement sur ${cur}. La machine peut rester allumée.`,
    fields: [
      { name: "storage", label: "Stockage cible", type: "api-select", load: async () => (await storagesFor(ctx.node, ctx.type === "qemu" ? "images" : "rootdir")()).filter((o) => o.value !== cur), required: true },
      { name: "delete", label: "Supprimer l'original après la copie", type: "checkbox", default: true, help: "Sinon, il reste comme disque inutilisé." },
    ],
    params: () => ({}),
    run: (v) => (ctx.type === "qemu"
      ? pve.post(`${ctx.base}/move_disk`, { disk: key, storage: v.storage, delete: v.delete ? 1 : 0 })
      : pve.post(`${ctx.base}/move_volume`, { volume: key, storage: v.storage, delete: v.delete ? 1 : 0 })),
  };
}

// ── Lecteur CD/DVD ────────────────────────────────────────────────
export function cdrom(ctx: GuestCtx, key?: string): Spec {
  const cur = key ? volumeOf(ctx.conf[key]) : "none";
  const mode = cur === "none" ? "none" : cur === "cdrom" ? "physique" : "iso";
  return {
    title: key ? `Lecteur ${key}` : "Ajouter un lecteur CD/DVD",
    priv: "VM.Config.CDROM",
    fields: [
      ...(key ? [] : [{ name: "bus", label: "Bus", type: "select" as const, options: [{ value: "ide", label: "IDE" }, { value: "sata", label: "SATA" }, { value: "scsi", label: "SCSI" }], default: "ide" }]),
      { name: "mode", label: "Contenu", type: "select", options: [{ value: "iso", label: "Image ISO" }, { value: "physique", label: "Lecteur physique du serveur" }, { value: "none", label: "Vide" }] },
      { name: "iso", label: "Image ISO", type: "api-select", load: isosOf(ctx.node), show: (v) => v.mode === "iso", required: true },
    ],
    initial: { mode, iso: mode === "iso" ? cur : "" },
    params: (v) => {
      const k = key ?? `${v.bus}${freeIndex(ctx.conf, String(v.bus), BUS_MAX[String(v.bus)])}`;
      const file = v.mode === "iso" ? v.iso : v.mode === "physique" ? "cdrom" : "none";
      return { [k]: `${file},media=cdrom` };
    },
  };
}

// ── Réseau ────────────────────────────────────────────────────────
export function qemuNet(ctx: GuestCtx, key?: string): Spec {
  const cur = key ? parseQemuNet(ctx.conf[key]) : ({} as Record<string, string>);
  return {
    title: key ? `Carte réseau ${key}` : "Ajouter une carte réseau",
    priv: "VM.Config.Network",
    fields: [
      { name: "bridge", label: "Pont", type: "api-select", load: bridgesOf(ctx.node), required: true },
      { name: "model", label: "Modèle", type: "select", options: [{ value: "virtio", label: "VirtIO (le plus rapide)" }, { value: "e1000", label: "Intel E1000" }, { value: "e1000e", label: "Intel E1000E" }, { value: "rtl8139", label: "Realtek RTL8139" }, { value: "vmxnet3", label: "VMware vmxnet3" }] },
      { name: "tag", label: "VLAN", type: "number", min: 1, max: 4094, help: "Vide : pas de VLAN." },
      { name: "rate", label: "Limite de débit", type: "number", unit: "Mo/s", help: "Vide : pas de limite." },
      { name: "firewall", label: "Pare-feu Proxmox sur cette carte", type: "checkbox" },
      { name: "macaddr", label: "Adresse MAC", type: "mac", advanced: true, help: "Vide : générée automatiquement." },
      { name: "mtu", label: "MTU", type: "number", min: 1, max: 65520, advanced: true, help: "1 = celle du pont." },
      { name: "queues", label: "Files multiples", type: "number", min: 0, max: 64, advanced: true },
      { name: "link_down", label: "Câble débranché", type: "checkbox", advanced: true },
    ],
    initial: { bridge: cur.bridge ?? "", model: cur.model ?? "virtio", tag: cur.tag ?? "", rate: cur.rate ?? "", firewall: key ? yes(cur.firewall) : true, macaddr: cur.macaddr ?? "", mtu: cur.mtu ?? "", queues: cur.queues ?? "", link_down: yes(cur.link_down) },
    params: (v) => ({ [key ?? `net${freeIndex(ctx.conf, "net", 31)}`]: joinQemuNet({ model: v.model, macaddr: v.macaddr, bridge: v.bridge, tag: v.tag, rate: v.rate, firewall: flag(v.firewall), mtu: v.mtu, queues: v.queues, link_down: flag(v.link_down) }) }),
  };
}

export function lxcNet(ctx: GuestCtx, key?: string): Spec {
  const cur = key ? parseProps(ctx.conf[key], "_") : ({} as Record<string, string>);
  const ip = cur.ip ?? "dhcp";
  const ip6 = cur.ip6 ?? "";
  return {
    title: key ? `Carte réseau ${key}` : "Ajouter une carte réseau",
    priv: "VM.Config.Network",
    fields: [
      { name: "name", label: "Nom dans le conteneur", required: true, placeholder: "eth0" },
      { name: "bridge", label: "Pont", type: "api-select", load: bridgesOf(ctx.node), required: true },
      { name: "ipmode", label: "IPv4", type: "select", options: [{ value: "dhcp", label: "DHCP" }, { value: "static", label: "Fixe" }, { value: "manual", label: "Aucune (configurée à la main)" }] },
      { name: "ip", label: "Adresse IPv4", type: "cidr", show: (v) => v.ipmode === "static", required: true },
      { name: "gw", label: "Passerelle IPv4", placeholder: "10.0.1.1", show: (v) => v.ipmode === "static" },
      { name: "ip6mode", label: "IPv6", type: "select", options: [{ value: "", label: "Aucune" }, { value: "dhcp", label: "DHCPv6" }, { value: "auto", label: "SLAAC" }, { value: "static", label: "Fixe" }] },
      { name: "ip6", label: "Adresse IPv6", type: "cidr", show: (v) => v.ip6mode === "static", required: true },
      { name: "gw6", label: "Passerelle IPv6", show: (v) => v.ip6mode === "static" },
      { name: "tag", label: "VLAN", type: "number", min: 1, max: 4094 },
      { name: "rate", label: "Limite de débit", type: "number", unit: "Mo/s" },
      { name: "firewall", label: "Pare-feu Proxmox sur cette carte", type: "checkbox" },
      { name: "hwaddr", label: "Adresse MAC", type: "mac", advanced: true },
      { name: "mtu", label: "MTU", type: "number", advanced: true },
    ],
    initial: {
      name: cur.name ?? `eth${freeIndex(ctx.conf, "net", 31)}`, bridge: cur.bridge ?? "", ipmode: ["dhcp", "manual"].includes(ip) ? ip : "static", ip: ["dhcp", "manual"].includes(ip) ? "" : ip, gw: cur.gw ?? "",
      ip6mode: ["dhcp", "auto", "manual"].includes(ip6) ? ip6 : ip6 ? "static" : "", ip6: ["dhcp", "auto", "manual", ""].includes(ip6) ? "" : ip6, gw6: cur.gw6 ?? "",
      tag: cur.tag ?? "", rate: cur.rate ?? "", firewall: key ? yes(cur.firewall) : true, hwaddr: cur.hwaddr ?? "", mtu: cur.mtu ?? "",
    },
    params: (v) => ({
      [key ?? `net${freeIndex(ctx.conf, "net", 31)}`]: joinProps({
        name: v.name, bridge: v.bridge, hwaddr: v.hwaddr, ip: v.ipmode === "static" ? v.ip : v.ipmode, gw: v.ipmode === "static" ? v.gw : undefined,
        ip6: v.ip6mode === "static" ? v.ip6 : v.ip6mode || undefined, gw6: v.ip6mode === "static" ? v.gw6 : undefined,
        tag: v.tag, rate: v.rate, firewall: flag(v.firewall), mtu: v.mtu, type: "veth",
      }, "_none"),
    }),
  };
}

// ── Processeur et mémoire ─────────────────────────────────────────
export function qemuCpu(ctx: GuestCtx): Spec {
  const c = ctx.conf;
  const cpu = parseProps(c.cpu ?? "x86-64-v2-AES", "cputype");
  return {
    title: "Processeur",
    priv: "VM.Config.CPU",
    fields: [
      { name: "sockets", label: "Sockets", type: "number", min: 1, max: 4, required: true },
      { name: "cores", label: "Cœurs par socket", type: "number", min: 1, max: 128, required: true },
      { name: "cputype", label: "Type de processeur", type: "api-select", full: true, load: async () => (await pve.get<any[]>(`/nodes/${ctx.node}/capabilities/qemu/cpu`)).map((x) => ({ value: x.name, label: x.name === "host" ? "host (toutes les instructions du serveur, pas de migration vers un autre modèle de CPU)" : x.name })), help: "x86-64-v2-AES convient presque toujours ; « host » pour les meilleures performances sur un seul nœud." },
      { name: "flags", label: "Options CPU", advanced: true, placeholder: "+aes;+pcid", help: "Séparées par des points-virgules. Exemple : +aes;-pcid" },
      { name: "vcpus", label: "vCPU actifs au démarrage", type: "number", min: 1, advanced: true },
      { name: "cpulimit", label: "Limite CPU", type: "number", min: 0, max: 128, step: 0.1, advanced: true, help: "En nombre de cœurs. 0 ou vide : pas de limite." },
      { name: "cpuunits", label: "Poids CPU", type: "number", min: 1, max: 262144, advanced: true, help: "Priorité face aux autres machines (100 par défaut)." },
      { name: "affinity", label: "Affinité", placeholder: "0-3,8", advanced: true, help: "Cœurs du serveur autorisés. Exemple : 0-3,8" },
      { name: "numa", label: "NUMA", type: "checkbox", advanced: true },
    ],
    initial: { sockets: c.sockets ?? "1", cores: c.cores ?? "1", cputype: cpu.cputype, flags: cpu.flags ?? "", vcpus: c.vcpus ?? "", cpulimit: c.cpulimit ?? "", cpuunits: c.cpuunits ?? "", affinity: c.affinity ?? "", numa: yes(c.numa) },
    params: (v) => ({ ...topLevel(["sockets", "cores", "vcpus", "cpulimit", "cpuunits", "affinity", "numa"], v, c), cpu: joinProps({ cputype: v.cputype, flags: v.flags }, "cputype") }),
  };
}

export function qemuMemory(ctx: GuestCtx): Spec {
  const c = ctx.conf;
  return {
    title: "Mémoire",
    priv: "VM.Config.Memory",
    fields: [
      { name: "memory", label: "Mémoire", type: "number", unit: "Mo", min: 16, step: 256, required: true },
      { name: "balloon_on", label: "Ballooning (la VM rend la mémoire inutilisée)", type: "checkbox", help: "Demande l'agent ou le pilote balloon dans la VM." },
      { name: "balloon", label: "Minimum garanti", type: "number", unit: "Mo", min: 1, show: (v) => !!v.balloon_on, help: "Vide : égal à la mémoire, sans réduction." },
      { name: "shares", label: "Priorité de récupération", type: "number", min: 0, max: 50000, advanced: true, show: (v) => !!v.balloon_on },
    ],
    initial: { memory: c.memory ?? "512", balloon_on: c.balloon !== "0", balloon: c.balloon && c.balloon !== "0" ? c.balloon : "", shares: c.shares ?? "" },
    params: (v) => ({ memory: v.memory, ...(v.balloon_on ? topLevel(["balloon", "shares"], v, c) : { balloon: 0 }) }),
  };
}

export function lxcResources(ctx: GuestCtx, what: "cpu" | "memory"): Spec {
  const c = ctx.conf;
  if (what === "memory") {
    return {
      title: "Mémoire",
      priv: "VM.Config.Memory",
      fields: [
        { name: "memory", label: "Mémoire", type: "number", unit: "Mo", min: 16, step: 256, required: true },
        { name: "swap", label: "Swap", type: "number", unit: "Mo", min: 0, step: 256 },
      ],
      initial: { memory: c.memory ?? "512", swap: c.swap ?? "512" },
      params: (v) => topLevel(["memory", "swap"], v, c),
    };
  }
  return {
    title: "Processeur",
    priv: "VM.Config.CPU",
    fields: [
      { name: "cores", label: "Cœurs", type: "number", min: 1, max: 128, help: "Vide : tous les cœurs du serveur." },
      { name: "cpulimit", label: "Limite CPU", type: "number", min: 0, max: 128, step: 0.1, help: "En nombre de cœurs. Vide : pas de limite." },
      { name: "cpuunits", label: "Poids CPU", type: "number", min: 0, max: 500000, advanced: true },
    ],
    initial: { cores: c.cores ?? "", cpulimit: c.cpulimit ?? "", cpuunits: c.cpuunits ?? "" },
    params: (v) => topLevel(["cores", "cpulimit", "cpuunits"], v, c),
  };
}

// ── Points de montage (conteneur) ─────────────────────────────────
export function lxcMount(ctx: GuestCtx, key?: string, reattach?: string): Spec {
  const cur = key ? parseProps(ctx.conf[key]) : ({} as Record<string, string>);
  const root = key === "rootfs";
  const bind = !!cur.file?.startsWith("/");
  return {
    title: root ? "Disque racine" : reattach ? `Rattacher ${volumeOf(reattach)}` : key ? `Point de montage ${key}` : "Ajouter un point de montage",
    priv: "VM.Config.Disk",
    fields: [
      ...(!key && !reattach ? [
        { name: "kind", label: "Type", type: "select" as const, options: [{ value: "volume", label: "Nouveau volume sur un stockage" }, { value: "bind", label: "Dossier du serveur (montage lié)" }], default: "volume" },
        { name: "storage", label: "Stockage", type: "api-select" as const, load: storagesFor(ctx.node, "rootdir"), show: (v: Values) => v.kind !== "bind", required: true },
        { name: "size", label: "Taille", type: "disk" as const, min: 1, default: 8, show: (v: Values) => v.kind !== "bind", required: true },
        { name: "hostpath", label: "Dossier du serveur", placeholder: "/tank/media", show: (v: Values) => v.kind === "bind", required: true, help: "Réservé à root@pam dans Proxmox." },
      ] : []),
      ...(root ? [] : [{ name: "mp", label: "Chemin dans le conteneur", placeholder: "/mnt/data", required: true, validate: (x: unknown) => (String(x).startsWith("/") ? null : "Le chemin commence par /.") }]),
      ...(bind ? [] : [{ name: "backup", label: "Inclure dans les sauvegardes", type: "checkbox" as const }]),
      { name: "ro", label: "Lecture seule", type: "checkbox", advanced: true },
      { name: "acl", label: "ACL", type: "select", advanced: true, options: [{ value: "", label: "Par défaut" }, { value: "1", label: "Activées" }, { value: "0", label: "Désactivées" }] },
      { name: "quota", label: "Quotas utilisateur", type: "checkbox", advanced: true },
      { name: "replicate", label: "Inclure dans la réplication", type: "checkbox", advanced: true },
    ],
    initial: { kind: "volume", mp: cur.mp ?? "", backup: root || cur.backup === "1" || !key, ro: yes(cur.ro), acl: cur.acl ?? "", quota: yes(cur.quota), replicate: cur.replicate !== "0" },
    params: (v) => {
      const opts = { mp: root ? undefined : v.mp, backup: !root && !bind && v.backup ? 1 : undefined, ro: flag(v.ro), acl: v.acl || undefined, quota: flag(v.quota), replicate: v.replicate ? undefined : 0 };
      if (key) return { [key]: joinProps({ file: cur.file, ...opts, size: cur.size }) };
      const k = `mp${freeIndex(ctx.conf, "mp", 255)}`;
      const file = reattach ? volumeOf(reattach) : v.kind === "bind" ? v.hostpath : `${v.storage}:${v.size}`;
      return { [k]: joinProps({ file, ...opts }) };
    },
  };
}

export function lxcFeatures(ctx: GuestCtx): Spec {
  const f = parseProps(ctx.conf.features ?? "", "_");
  const mounts = String(f.mount ?? "").split(";");
  return {
    title: "Fonctionnalités",
    priv: "VM.Config.Options",
    help: "Certaines ne sont permises qu'à root@pam ou aux conteneurs privilégiés.",
    fields: [
      { name: "nesting", label: "Imbrication (nesting) : Docker, systemd récent", type: "checkbox" },
      { name: "keyctl", label: "keyctl : nécessaire à Docker dans un conteneur non privilégié", type: "checkbox" },
      { name: "fuse", label: "FUSE : montages en espace utilisateur (sshfs, rclone)", type: "checkbox" },
      { name: "nfs", label: "Montage NFS depuis le conteneur", type: "checkbox" },
      { name: "cifs", label: "Montage CIFS/SMB depuis le conteneur", type: "checkbox" },
      { name: "mknod", label: "Création de fichiers spéciaux (mknod)", type: "checkbox", advanced: true },
      { name: "force_rw_sys", label: "/sys en écriture", type: "checkbox", advanced: true },
    ],
    initial: { nesting: yes(f.nesting), keyctl: yes(f.keyctl), fuse: yes(f.fuse), nfs: mounts.includes("nfs"), cifs: mounts.includes("cifs"), mknod: yes(f.mknod), force_rw_sys: yes(f.force_rw_sys) },
    params: (v) => {
      const mount = [v.nfs && "nfs", v.cifs && "cifs"].filter(Boolean).join(";");
      const value = joinProps({ nesting: flag(v.nesting), keyctl: flag(v.keyctl), fuse: flag(v.fuse), mount, mknod: flag(v.mknod), force_rw_sys: flag(v.force_rw_sys) }, "_none");
      return value ? { features: value } : { delete: "features" };
    },
  };
}

export function lxcDns(ctx: GuestCtx): Spec {
  return {
    title: "DNS",
    priv: "VM.Config.Network",
    help: "Vide : le conteneur reprend la configuration DNS du serveur.",
    fields: [
      { name: "searchdomain", label: "Domaine de recherche", placeholder: "maison.lan" },
      { name: "nameserver", label: "Serveurs DNS", placeholder: "1.1.1.1 9.9.9.9", help: "Séparés par des espaces." },
    ],
    initial: { searchdomain: ctx.conf.searchdomain ?? "", nameserver: ctx.conf.nameserver ?? "" },
    params: (v) => topLevel(["searchdomain", "nameserver"], v, ctx.conf),
  };
}

// ── Système (QEMU) ────────────────────────────────────────────────
export function simple(ctx: GuestCtx, key: string): Spec | null {
  const c = ctx.conf;
  const cur = c[key] ?? "";
  switch (key) {
    case "bios":
      return {
        title: "Micrologiciel", priv: "VM.Config.Options",
        help: "UEFI (OVMF) demande un disque EFI pour garder ses réglages. Windows 11 a besoin d'UEFI et d'un TPM.",
        fields: [{ name: "bios", label: "Type", type: "select", options: [{ value: "seabios", label: "BIOS (SeaBIOS)" }, { value: "ovmf", label: "UEFI (OVMF)" }] }],
        initial: { bios: cur || "seabios" }, params: (v) => ({ bios: v.bios }),
      };
    case "machine":
      return {
        title: "Type de machine", priv: "VM.Config.HWType",
        fields: [{ name: "machine", label: "Machine", type: "api-select", allowEmpty: "Par défaut (i440fx)", load: async () => [{ value: "q35", label: "q35 (dernière version)" }, ...(await pve.get<any[]>(`/nodes/${ctx.node}/capabilities/qemu/machines`)).map((m) => ({ value: m.id, label: `${m.id} (${m.type} ${m.version})` }))] }],
        initial: { machine: cur }, params: (v) => topLevel(["machine"], v, c),
      };
    case "scsihw":
      return {
        title: "Contrôleur SCSI", priv: "VM.Config.Options",
        fields: [{ name: "scsihw", label: "Contrôleur", type: "select", options: [
          { value: "virtio-scsi-single", label: "VirtIO SCSI single (recommandé, un thread par disque)" }, { value: "virtio-scsi-pci", label: "VirtIO SCSI" },
          { value: "lsi", label: "LSI 53C895A" }, { value: "lsi53c810", label: "LSI 53C810" }, { value: "megasas", label: "MegaRAID SAS 8708EM2" }, { value: "pvscsi", label: "VMware PVSCSI" },
        ] }],
        initial: { scsihw: cur || "lsi" }, params: (v) => ({ scsihw: v.scsihw }),
      };
    case "vga": {
      const p = parseProps(cur, "type");
      return {
        title: "Affichage", priv: "VM.Config.HWType",
        fields: [
          { name: "type", label: "Carte graphique", type: "select", options: [
            { value: "", label: "Par défaut" }, { value: "std", label: "Standard VGA" }, { value: "virtio", label: "VirtIO-GPU" }, { value: "qxl", label: "SPICE (qxl)" },
            { value: "vmware", label: "VMware compatible" }, { value: "serial0", label: "Terminal série 0" }, { value: "none", label: "Aucune" },
          ] },
          { name: "memory", label: "Mémoire vidéo", type: "number", unit: "Mo", min: 4, max: 512, advanced: true },
        ],
        initial: { type: p.type ?? "", memory: p.memory ?? "" },
        params: (v) => (v.type ? { vga: joinProps({ type: v.type, memory: v.memory }, "type") } : { delete: "vga" }),
      };
    }
    case "efidisk0":
      return {
        title: "Ajouter un disque EFI", priv: "VM.Config.Disk",
        fields: [
          { name: "storage", label: "Stockage", type: "api-select", load: storagesFor(ctx.node, "images"), required: true },
          { name: "keys", label: "Clés Secure Boot Microsoft préinstallées", type: "checkbox", default: true },
        ],
        params: (v) => ({ efidisk0: `${v.storage}:1,efitype=4m${v.keys ? ",pre-enrolled-keys=1" : ""}` }),
      };
    case "tpmstate0":
      return {
        title: "Ajouter un TPM", priv: "VM.Config.Disk",
        fields: [
          { name: "storage", label: "Stockage", type: "api-select", load: storagesFor(ctx.node, "images"), required: true },
          { name: "version", label: "Version", type: "select", options: [{ value: "v2.0", label: "2.0 (Windows 11)" }, { value: "v1.2", label: "1.2" }], default: "v2.0" },
        ],
        params: (v) => ({ tpmstate0: `${v.storage}:1,version=${v.version}` }),
      };
    case "audio0": {
      const p = parseProps(cur, "_");
      return {
        title: "Carte son", priv: "VM.Config.HWType",
        fields: [
          { name: "device", label: "Périphérique", type: "select", options: [{ value: "ich9-intel-hda", label: "ich9-intel-hda" }, { value: "intel-hda", label: "intel-hda" }, { value: "AC97", label: "AC97" }] },
          { name: "driver", label: "Sortie", type: "select", options: [{ value: "spice", label: "SPICE" }, { value: "none", label: "Aucune" }] },
        ],
        initial: { device: p.device ?? "ich9-intel-hda", driver: p.driver ?? "spice" },
        params: (v) => ({ audio0: `device=${v.device},driver=${v.driver}` }),
      };
    }
    case "rng0": {
      const p = parseProps(cur, "_");
      return {
        title: "Générateur aléatoire (VirtIO RNG)", priv: "VM.Config.HWType",
        fields: [
          { name: "source", label: "Source", type: "select", options: [{ value: "/dev/urandom", label: "/dev/urandom (recommandé)" }, { value: "/dev/random", label: "/dev/random" }, { value: "/dev/hwrng", label: "/dev/hwrng (matériel)" }] },
          { name: "max_bytes", label: "Débit max", type: "number", unit: "octets", advanced: true },
          { name: "period", label: "Période", type: "number", unit: "ms", advanced: true },
        ],
        initial: { source: p.source ?? "/dev/urandom", max_bytes: p.max_bytes ?? "", period: p.period ?? "" },
        params: (v) => ({ rng0: joinProps({ source: v.source, max_bytes: v.max_bytes, period: v.period }, "_none") }),
      };
    }
  }
  if (/^serial\d$/.test(key)) {
    return {
      title: `Port série ${key.slice(6)}`, priv: "VM.Config.HWType",
      fields: [{ name: "value", label: "Connexion", placeholder: "socket", help: "« socket » pour la console série de Proxmox, ou un port du serveur comme /dev/ttyS0." }],
      initial: { value: cur || "socket" }, params: (v) => ({ [key]: v.value }),
    };
  }
  return null;
}

// ── Périphériques passés à la VM ──────────────────────────────────
export function usb(ctx: GuestCtx, key?: string): Spec {
  const p = parseProps(key ? ctx.conf[key] : "", "_");
  const mode = p.mapping ? "mapping" : p.host && /:/.test(p.host) ? "device" : p.host ? "port" : p.spice || p._ === "spice" ? "spice" : "mapping";
  return {
    title: key ? `Périphérique USB ${key}` : "Ajouter un périphérique USB",
    priv: "VM.Config.HWType",
    fields: [
      { name: "mode", label: "Source", type: "select", options: [{ value: "mapping", label: "Mappage du datacenter (conseillé)" }, { value: "device", label: "Périphérique du serveur (fabricant:produit)" }, { value: "port", label: "Port USB du serveur" }, { value: "spice", label: "Redirection SPICE" }] },
      { name: "mapping", label: "Mappage", type: "api-select", show: (v) => v.mode === "mapping", required: true, load: async () => (await pve.get<any[]>("/cluster/mapping/usb")).map((m) => ({ value: m.id, label: `${m.id}${m.description ? ` · ${m.description}` : ""}` })) },
      { name: "device", label: "Périphérique", type: "api-select", show: (v) => v.mode === "device", required: true, load: async () => (await pve.get<any[]>(`/nodes/${ctx.node}/hardware/usb`)).map((d) => ({ value: `${d.vendid}:${d.prodid}`, label: `${d.vendid}:${d.prodid} · ${d.manufacturer ?? ""} ${d.product ?? ""}` })) },
      { name: "port", label: "Port", placeholder: "1-2", show: (v) => v.mode === "port", required: true },
      { name: "usb3", label: "USB 3", type: "checkbox" },
    ],
    initial: { mode, mapping: p.mapping ?? "", device: mode === "device" ? p.host : "", port: mode === "port" ? p.host : "", usb3: yes(p.usb3) },
    params: (v) => {
      const k = key ?? `usb${freeIndex(ctx.conf, "usb", 14)}`;
      const src = v.mode === "mapping" ? `mapping=${v.mapping}` : v.mode === "device" ? `host=${v.device}` : v.mode === "port" ? `host=${v.port}` : "spice";
      return { [k]: `${src}${v.usb3 ? ",usb3=1" : ""}` };
    },
  };
}

export function pci(ctx: GuestCtx, key?: string): Spec {
  const p = parseProps(key ? ctx.conf[key] : "", "host");
  return {
    title: key ? `Périphérique PCI ${key}` : "Ajouter un périphérique PCI",
    priv: "VM.Config.HWType",
    help: "Le passthrough demande l'IOMMU actif sur le serveur. La VM ne pourra plus migrer à chaud.",
    fields: [
      { name: "mode", label: "Source", type: "select", options: [{ value: "mapping", label: "Mappage du datacenter (conseillé)" }, { value: "raw", label: "Périphérique brut du serveur" }] },
      { name: "mapping", label: "Mappage", type: "api-select", show: (v) => v.mode === "mapping", required: true, load: async () => (await pve.get<any[]>("/cluster/mapping/pci")).map((m) => ({ value: m.id, label: `${m.id}${m.description ? ` · ${m.description}` : ""}` })) },
      { name: "raw", label: "Périphérique", type: "api-select", show: (v) => v.mode === "raw", required: true, load: async () => (await pve.get<any[]>(`/nodes/${ctx.node}/hardware/pci`)).map((d) => ({ value: d.id, label: `${d.id} · ${d.vendor_name ?? ""} ${d.device_name ?? ""} (groupe IOMMU ${d.iommugroup})` })) },
      { name: "pcie", label: "PCI Express (machine q35 nécessaire)", type: "checkbox" },
      { name: "xvga", label: "Carte graphique principale", type: "checkbox" },
      { name: "rombar", label: "ROM visible", type: "checkbox", advanced: true },
      { name: "allfn", label: "Toutes les fonctions", type: "checkbox", advanced: true },
    ],
    initial: { mode: p.mapping ? "mapping" : key ? "raw" : "mapping", mapping: p.mapping ?? "", raw: p.host ?? "", pcie: yes(p.pcie), xvga: yes(p["x-vga"]), rombar: p.rombar !== "0", allfn: false },
    params: (v) => {
      const k = key ?? `hostpci${freeIndex(ctx.conf, "hostpci", 15)}`;
      // « Toutes les fonctions » : on retire le numéro de fonction (0000:05:00.0 → 0000:05:00)
      const src = v.mode === "mapping" ? `mapping=${v.mapping}` : v.allfn ? String(v.raw).replace(/\.\d$/, "") : String(v.raw);
      return { [k]: joinProps({ src, pcie: flag(v.pcie), "x-vga": flag(v.xvga), rombar: v.rombar ? undefined : 0 }, "src") };
    },
  };
}

export function virtiofs(ctx: GuestCtx, key?: string): Spec {
  const p = parseProps(key ? ctx.conf[key] : "", "dirid");
  return {
    title: key ? `Partage VirtIO-FS ${key}` : "Ajouter un partage VirtIO-FS",
    priv: "VM.Config.Options",
    help: "Partage un dossier du serveur avec la VM (Proxmox VE 8.4 ou plus récent).",
    fields: [
      { name: "dirid", label: "Dossier (mappage)", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/cluster/mapping/dir")).map((m) => ({ value: m.id, label: `${m.id}${m.description ? ` · ${m.description}` : ""}` })) },
      { name: "cache", label: "Cache", type: "select", options: [{ value: "", label: "Par défaut" }, { value: "auto", label: "auto" }, { value: "always", label: "always" }, { value: "metadata", label: "metadata" }, { value: "never", label: "never" }] },
      { name: "expose-acl", label: "Exposer les ACL", type: "checkbox", advanced: true },
    ],
    initial: { dirid: p.dirid ?? "", cache: p.cache ?? "", "expose-acl": yes(p["expose-acl"]) },
    params: (v) => ({ [key ?? `virtiofs${freeIndex(ctx.conf, "virtiofs", 9)}`]: joinProps({ dirid: v.dirid, cache: v.cache, "expose-acl": flag(v["expose-acl"]) }, "dirid") }),
  };
}

export function cloudinitDrive(ctx: GuestCtx): Spec {
  return {
    title: "Ajouter un lecteur Cloud-Init",
    priv: "VM.Config.Disk",
    fields: [
      { name: "bus", label: "Bus", type: "select", options: [{ value: "ide", label: "IDE" }, { value: "scsi", label: "SCSI" }, { value: "sata", label: "SATA" }], default: "ide" },
      { name: "storage", label: "Stockage", type: "api-select", load: storagesFor(ctx.node, "images"), required: true },
    ],
    params: (v) => ({ [`${v.bus}${freeIndex(ctx.conf, String(v.bus), BUS_MAX[String(v.bus)])}`]: `${v.storage}:cloudinit` }),
  };
}

// ── Options ───────────────────────────────────────────────────────
export function option(ctx: GuestCtx, key: string): Spec | null {
  const c = ctx.conf;
  const q = ctx.type === "qemu";
  const checkbox = (title: string, help?: string, def = false): Spec => ({
    title, priv: "VM.Config.Options", help,
    fields: [{ name: key, label: title, type: "checkbox" }],
    initial: { [key]: c[key] === undefined ? def : yes(c[key]) },
    params: (v) => ({ [key]: v[key] ? 1 : 0 }),
  });
  switch (key) {
    case "name":
    case "hostname":
      return { title: q ? "Nom" : "Nom d'hôte", priv: "VM.Config.Options", fields: [{ name: key, label: q ? "Nom" : "Nom d'hôte", required: true, validate: (x) => (/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(String(x)) ? null : "Lettres, chiffres, point et tiret.") }], initial: { [key]: c[key] ?? "" }, params: (v) => ({ [key]: v[key] }) };
    case "onboot": return checkbox("Démarrer avec le serveur");
    case "startup": {
      const p = parseProps(c.startup ?? "", "_");
      return {
        title: "Ordre de démarrage", priv: "VM.Config.Options",
        help: "Les machines démarrent par ordre croissant et s'arrêtent dans l'ordre inverse.",
        fields: [
          { name: "order", label: "Ordre", type: "number", min: 0, help: "Vide : après celles qui ont un ordre." },
          { name: "up", label: "Attente après le démarrage", type: "number", unit: "s", min: 0 },
          { name: "down", label: "Délai d'arrêt avant arrêt forcé", type: "number", unit: "s", min: 0 },
        ],
        initial: { order: p.order ?? "", up: p.up ?? "", down: p.down ?? "" },
        params: (v) => {
          const s = joinProps({ order: v.order, up: v.up, down: v.down }, "_none");
          return s ? { startup: s } : { delete: "startup" };
        },
      };
    }
    case "ostype":
      return { title: "Système invité", priv: "VM.Config.Options", fields: [{ name: "ostype", label: "Système", type: "select", options: q ? OSTYPES_QEMU : OSTYPES_LXC }], initial: { ostype: c.ostype ?? (q ? "l26" : "debian") }, params: (v) => ({ ostype: v.ostype }) };
    case "agent": {
      const p = parseProps(c.agent ?? "0", "enabled");
      return {
        title: "Agent invité QEMU", priv: "VM.Config.Options",
        help: "Installe qemu-guest-agent dans la VM. Il donne l'adresse IP, l'arrêt propre et le gel des fichiers pendant les sauvegardes.",
        fields: [
          { name: "enabled", label: "Utiliser l'agent invité", type: "checkbox" },
          { name: "fstrim", label: "Lancer un TRIM après un clonage ou un déplacement de disque", type: "checkbox", show: (v) => !!v.enabled },
          { name: "freeze", label: "Geler les fichiers pendant les sauvegardes", type: "checkbox", show: (v) => !!v.enabled },
          { name: "type", label: "Type", type: "select", advanced: true, options: [{ value: "virtio", label: "VirtIO" }, { value: "isa", label: "ISA" }] },
        ],
        initial: { enabled: yes(p.enabled), fstrim: yes(p.fstrim_cloned_disks), freeze: p["freeze-fs-on-backup"] !== "0", type: p.type ?? "virtio" },
        params: (v) => ({ agent: joinProps({ enabled: v.enabled ? 1 : 0, fstrim_cloned_disks: flag(v.fstrim), "freeze-fs-on-backup": v.enabled && !v.freeze ? 0 : undefined, type: v.type === "isa" ? "isa" : undefined }, "enabled") }),
      };
    }
    case "protection": return checkbox("Protection", "Empêche la suppression de la machine et de ses disques.");
    case "hotplug": {
      const cur = (c.hotplug ?? "network,disk,usb").split(",");
      const all = [["disk", "Disques"], ["network", "Réseau"], ["usb", "USB"], ["memory", "Mémoire (NUMA requis)"], ["cpu", "Processeur (NUMA requis)"], ["cloudinit", "Cloud-Init"]];
      return {
        title: "Ajout à chaud", priv: "VM.Config.HWType",
        help: "Ce qui peut être ajouté ou retiré sans redémarrer la VM.",
        fields: all.map(([k, l]) => ({ name: `h_${k}`, label: l, type: "checkbox" as const })),
        initial: Object.fromEntries(all.map(([k]) => [`h_${k}`, cur.includes(k) || cur.includes("1")])),
        params: (v) => ({ hotplug: all.filter(([k]) => v[`h_${k}`]).map(([k]) => k).join(",") || "0" }),
      };
    }
    case "kvm": return checkbox("Virtualisation matérielle (KVM)", "À désactiver seulement pour émuler un processeur sans accélération.", true);
    case "acpi": return checkbox("ACPI", "Nécessaire à l'arrêt propre depuis Proxmox.", true);
    case "tablet": return checkbox("Pointeur USB de type tablette", "Évite le décalage de la souris dans la console.", true);
    case "localtime": return checkbox("Horloge à l'heure locale", "Conseillé pour Windows.");
    case "freeze": return checkbox("Mettre en pause au démarrage", "La VM démarre figée : utile pour le débogage.");
    case "hookscript":
      return { title: "Script d'accroche", priv: "Sys.Modify", help: "Un snippet exécuté à chaque étape de la vie de la machine. Réservé à root@pam.", fields: [{ name: "hookscript", label: "Snippet", placeholder: "local:snippets/hook.sh" }], initial: { hookscript: c.hookscript ?? "" }, params: (v) => topLevel(["hookscript"], v, c) };
    case "tags":
      return { title: "Tags", priv: "VM.Config.Options", fields: [{ name: "tags", label: "Tags", type: "tags", full: true }], initial: { tags: c.tags ?? "" }, params: (v) => ({ tags: (Array.isArray(v.tags) ? v.tags : String(v.tags ?? "").split(/[;,\s]+/)).filter(Boolean).join(";") }) };
    case "console":
      return checkbox("Console", "Attache une console au conteneur.", true);
    case "cmode":
      return { title: "Mode de console", priv: "VM.Config.Options", fields: [{ name: "cmode", label: "Mode", type: "select", options: [{ value: "tty", label: "tty (par défaut)" }, { value: "shell", label: "shell" }, { value: "console", label: "/dev/console" }] }], initial: { cmode: c.cmode ?? "tty" }, params: (v) => ({ cmode: v.cmode }) };
    case "tty":
      return { title: "Consoles tty", priv: "VM.Config.Options", fields: [{ name: "tty", label: "Nombre", type: "number", min: 0, max: 6 }], initial: { tty: c.tty ?? "2" }, params: (v) => ({ tty: v.tty }) };
  }
  return null;
}

export { DISK_KEY };

// Assistants complets de création, aussi riches que ceux de Proxmox.
// Le mode « simple » (formulaires d'une page) reste dans Create.tsx.
import { useNavigate } from "react-router-dom";
import { Notice, useToast } from "../../components/ui";
import { Wizard, type WizardStep } from "../../components/Wizard";
import type { Option, Values } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { bytes } from "../../../../shared/format";
import { OSTYPES_QEMU, joinProps, joinQemuNet } from "../machine/common";

const nodeOf = (v: Values) => String(v.node || "");
const storages = (content: string) => async (v: Values): Promise<Option[]> => {
  if (!nodeOf(v)) return [];
  const list = await pve.get<any[]>(`/nodes/${nodeOf(v)}/storage`, { content });
  return list.filter((s) => s.active && String(s.content).includes(content)).map((s) => ({ value: s.storage, label: `${s.storage} (${s.type}, ${bytes(s.avail)} libres)` }));
};
const files = (content: string, storageField: string) => async (v: Values): Promise<Option[]> => {
  if (!nodeOf(v) || !v[storageField]) return [];
  const list = await pve.get<any[]>(`/nodes/${nodeOf(v)}/storage/${v[storageField]}/content`, { content });
  return list.map((f) => ({ value: f.volid, label: f.volid.split("/").pop() }));
};
const bridges = async (v: Values): Promise<Option[]> => {
  if (!nodeOf(v)) return [];
  return (await pve.get<any[]>(`/nodes/${nodeOf(v)}/network`)).filter((n) => n.type === "bridge" || n.type === "OVSBridge").map((n) => ({ value: n.iface, label: `${n.iface}${n.comments ? ` · ${n.comments}` : ""}` }));
};
const nodes = async (): Promise<Option[]> => (await pve.get<any[]>("/nodes")).filter((n) => n.status === "online").map((n) => ({ value: n.node, label: n.node }));
const pools = async (): Promise<Option[]> => (await pve.get<any[]>("/pools")).map((p) => ({ value: p.poolid, label: p.poolid }));
const cpuTypes = async (v: Values): Promise<Option[]> => (nodeOf(v) ? (await pve.get<any[]>(`/nodes/${nodeOf(v)}/capabilities/qemu/cpu`)).map((c) => ({ value: c.name, label: c.name })) : []);
const NAME = (x: unknown) => (/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(String(x)) ? null : "Lettres, chiffres, point et tiret.");

function useNextId() {
  const r = usePoll(() => pve.get<string>("/cluster/nextid"), 0);
  return r.data ? Number(r.data) : null;
}

function useSubmit(kind: "qemu" | "lxc") {
  const navigate = useNavigate();
  const { watch, toast } = useToast();
  return async (node: string, vmid: number, params: Record<string, unknown>) => {
    const upid = await pve.post<string>(`/nodes/${node}/${kind}`, params);
    watch(node, upid, kind === "lxc" ? "Création du conteneur" : "Création de la VM", () => navigate(`/machines/${node}/${kind}/${vmid}`));
    toast("Création lancée : tu seras redirigé à la fin.");
  };
}

export function VmWizard({ defaultNode }: { defaultNode: string }) {
  const nextid = useNextId();
  const submit = useSubmit("qemu");
  if (!nextid) return <div className="empty">Chargement…</div>;
  const steps: WizardStep[] = [
    { id: "general", title: "Général", lead: "Où créer la VM et comment l'appeler.", fields: [
      { name: "node", label: "Nœud", type: "api-select", load: nodes, required: true },
      { name: "vmid", label: "ID", type: "number", min: 100, max: 999999999, required: true, help: "Numéro unique, proposé automatiquement." },
      { name: "name", label: "Nom", required: true, validate: NAME, placeholder: "web-01" },
      { name: "pool", label: "Pool", type: "api-select", allowEmpty: "Aucun", load: pools },
      { name: "tags", label: "Tags", type: "tags", full: true },
      { name: "onboot", label: "Démarrer avec le serveur", type: "checkbox" },
      { name: "startup", label: "Ordre de démarrage", type: "number", min: 0, advanced: true },
    ] },
    { id: "os", title: "Système", lead: "Le disque d'installation et le type de système.", fields: [
      { name: "media", label: "Installation depuis", type: "select", options: [{ value: "iso", label: "Une image ISO" }, { value: "cdrom", label: "Le lecteur physique du serveur" }, { value: "none", label: "Rien (installer plus tard ou par le réseau)" }], default: "iso" },
      { name: "isostorage", label: "Stockage des ISO", type: "api-select", load: storages("iso"), loadDeps: ["node"], show: (v) => v.media === "iso" },
      { name: "iso", label: "Image ISO", type: "api-select", load: files("iso", "isostorage"), loadDeps: ["node", "isostorage"], show: (v) => v.media === "iso", required: true },
      { name: "ostype", label: "Type de système", type: "select", options: OSTYPES_QEMU, default: "l26", full: true },
    ] },
    { id: "systeme", title: "Matériel de base", lead: "Les valeurs proposées conviennent à la plupart des systèmes récents.", fields: [
      { name: "machine", label: "Machine", type: "select", default: "q35", options: [{ value: "q35", label: "q35 (moderne, PCIe)" }, { value: "", label: "i440fx (ancien, par défaut de Proxmox)" }] },
      { name: "bios", label: "Micrologiciel", type: "select", options: [{ value: "seabios", label: "BIOS (SeaBIOS)" }, { value: "ovmf", label: "UEFI (OVMF)" }], default: "seabios", help: "UEFI pour Windows 11 et Secure Boot." },
      { name: "efistorage", label: "Stockage du disque EFI", type: "api-select", load: storages("images"), loadDeps: ["node"], show: (v) => v.bios === "ovmf" },
      { name: "efikeys", label: "Clés Secure Boot préinstallées", type: "checkbox", default: true, show: (v) => v.bios === "ovmf" },
      { name: "tpm", label: "Ajouter un TPM 2.0", type: "checkbox", help: "Nécessaire pour Windows 11." },
      { name: "tpmstorage", label: "Stockage du TPM", type: "api-select", load: storages("images"), loadDeps: ["node"], show: (v) => !!v.tpm },
      { name: "scsihw", label: "Contrôleur SCSI", type: "select", default: "virtio-scsi-single", options: [{ value: "virtio-scsi-single", label: "VirtIO SCSI single" }, { value: "virtio-scsi-pci", label: "VirtIO SCSI" }, { value: "lsi", label: "LSI 53C895A" }, { value: "megasas", label: "MegaRAID SAS" }, { value: "pvscsi", label: "VMware PVSCSI" }] },
      { name: "agent", label: "Agent invité QEMU", type: "checkbox", default: true, help: "Donne l'adresse IP et l'arrêt propre. À installer dans la VM (qemu-guest-agent)." },
      { name: "vga", label: "Carte graphique", type: "select", advanced: true, options: [{ value: "", label: "Par défaut" }, { value: "std", label: "Standard VGA" }, { value: "virtio", label: "VirtIO-GPU" }, { value: "qxl", label: "SPICE" }, { value: "serial0", label: "Terminal série" }] },
    ] },
    { id: "disque", title: "Disque", fields: [
      { name: "bus", label: "Bus", type: "select", default: "scsi", options: [{ value: "scsi", label: "SCSI (recommandé)" }, { value: "virtio", label: "VirtIO Block" }, { value: "sata", label: "SATA (Windows sans pilotes)" }, { value: "ide", label: "IDE" }] },
      { name: "storage", label: "Stockage", type: "api-select", load: storages("images"), loadDeps: ["node"], required: true },
      { name: "size", label: "Taille", type: "disk", min: 1, default: 32, required: true },
      { name: "discard", label: "Libérer l'espace supprimé (discard)", type: "checkbox", default: true },
      { name: "ssd", label: "Présenter comme un SSD", type: "checkbox", default: true },
      { name: "iothread", label: "Thread d'E/S dédié", type: "checkbox", default: true, show: (v) => v.bus === "scsi" || v.bus === "virtio" },
      { name: "cache", label: "Cache", type: "select", advanced: true, options: [{ value: "", label: "Aucun (par défaut)" }, { value: "writeback", label: "Write back" }, { value: "writethrough", label: "Write through" }, { value: "directsync", label: "Direct sync" }] },
    ] },
    { id: "cpu", title: "Processeur", fields: [
      { name: "sockets", label: "Sockets", type: "number", min: 1, max: 4, default: 1 },
      { name: "cores", label: "Cœurs par socket", type: "number", min: 1, max: 128, default: 2 },
      { name: "cpu", label: "Type de processeur", type: "api-select", load: cpuTypes, loadDeps: ["node"], full: true, help: "x86-64-v2-AES convient presque toujours ; host pour les meilleures performances sur un seul nœud." },
    ] },
    { id: "memoire", title: "Mémoire", fields: [
      { name: "memory", label: "Mémoire", type: "number", unit: "Mo", min: 16, step: 512, default: 2048, required: true },
      { name: "balloon_on", label: "Ballooning (rend la mémoire inutilisée)", type: "checkbox", default: true },
      { name: "balloon", label: "Minimum garanti", type: "number", unit: "Mo", min: 1, show: (v) => !!v.balloon_on, help: "Vide : égal à la mémoire." },
    ] },
    { id: "reseau", title: "Réseau", fields: [
      { name: "nonet", label: "Pas de carte réseau", type: "checkbox" },
      { name: "bridge", label: "Pont", type: "api-select", load: bridges, loadDeps: ["node"], show: (v) => !v.nonet },
      { name: "model", label: "Modèle", type: "select", default: "virtio", show: (v) => !v.nonet, options: [{ value: "virtio", label: "VirtIO (le plus rapide)" }, { value: "e1000e", label: "Intel E1000E (Windows sans pilotes)" }, { value: "rtl8139", label: "Realtek RTL8139" }, { value: "vmxnet3", label: "VMware vmxnet3" }] },
      { name: "tag", label: "VLAN", type: "number", min: 1, max: 4094, show: (v) => !v.nonet },
      { name: "firewall", label: "Pare-feu Proxmox", type: "checkbox", default: true, show: (v) => !v.nonet },
      { name: "macaddr", label: "Adresse MAC", type: "mac", advanced: true, show: (v) => !v.nonet },
    ] },
  ];
  return (
    <Wizard
      title="Nouvelle machine virtuelle"
      steps={steps}
      initial={{ node: defaultNode, vmid: nextid, start: false }}
      finishLabel="Créer la VM"
      aside="Chaque réglage reste modifiable après la création, dans l'onglet Matériel de la machine."
      summaryExtra={(v, set) => (
        <>
          {v.bios === "ovmf" && v.ostype === "win11" && !v.tpm && <Notice kind="warn">Windows 11 refusera de s&apos;installer sans TPM : retourne à « Matériel de base » pour l&apos;ajouter.</Notice>}
          <label className="check"><input type="checkbox" checked={!!v.start} onChange={(e) => set("start", e.target.checked)} /> Démarrer la VM après la création</label>
        </>
      )}
      onFinish={async (_c, v) => {
        const tags = (Array.isArray(v.tags) ? v.tags : String(v.tags ?? "").split(/[;,\s]+/)).filter(Boolean).join(";");
        const disk = joinProps({ file: `${v.storage}:${v.size}`, discard: v.discard ? "on" : undefined, ssd: v.ssd ? 1 : undefined, iothread: v.iothread && (v.bus === "scsi" || v.bus === "virtio") ? 1 : undefined, cache: v.cache || undefined });
        const ide2 = v.media === "iso" ? `${v.iso},media=cdrom` : v.media === "cdrom" ? "cdrom,media=cdrom" : "none,media=cdrom";
        const params: Record<string, unknown> = {
          vmid: v.vmid, name: v.name, pool: v.pool || undefined, tags: tags || undefined, onboot: v.onboot ? 1 : 0, startup: v.startup ? `order=${v.startup}` : undefined,
          ostype: v.ostype, machine: v.machine || undefined, bios: v.bios, scsihw: v.scsihw, agent: v.agent ? 1 : 0, vga: v.vga || undefined,
          sockets: v.sockets, cores: v.cores, cpu: v.cpu || undefined, memory: v.memory, balloon: v.balloon_on ? v.balloon || undefined : 0,
          [`${v.bus}0`]: disk, ide2, boot: `order=${v.bus}0;ide2${v.nonet ? "" : ";net0"}`,
          net0: v.nonet ? undefined : joinQemuNet({ model: v.model, macaddr: v.macaddr, bridge: v.bridge, tag: v.tag, firewall: v.firewall ? 1 : undefined }),
          efidisk0: v.bios === "ovmf" && v.efistorage ? `${v.efistorage}:1,efitype=4m${v.efikeys ? ",pre-enrolled-keys=1" : ""}` : undefined,
          tpmstate0: v.tpm && v.tpmstorage ? `${v.tpmstorage}:1,version=v2.0` : undefined,
          start: v.start ? 1 : 0,
        };
        await submit(String(v.node), Number(v.vmid), Object.fromEntries(Object.entries(params).filter(([, x]) => x !== undefined && x !== "")));
      }}
    />
  );
}

export function CtWizard({ defaultNode }: { defaultNode: string }) {
  const nextid = useNextId();
  const submit = useSubmit("lxc");
  if (!nextid) return <div className="empty">Chargement…</div>;
  const steps: WizardStep[] = [
    { id: "general", title: "Général", lead: "Nom, accès root et type de conteneur.", fields: [
      { name: "node", label: "Nœud", type: "api-select", load: nodes, required: true },
      { name: "vmid", label: "ID", type: "number", min: 100, required: true },
      { name: "hostname", label: "Nom d'hôte", required: true, validate: NAME, placeholder: "pihole" },
      { name: "pool", label: "Pool", type: "api-select", allowEmpty: "Aucun", load: pools },
      { name: "password", label: "Mot de passe root", type: "password", help: "5 caractères au moins. Vide si tu utilises une clé SSH.", validate: (x, v) => (!x && !v.sshkeys ? "Mot de passe ou clé SSH obligatoire." : x && String(x).length < 5 ? "5 caractères au moins." : null) },
      { name: "password2", label: "Confirme le mot de passe", type: "password", validate: (x, v) => (x !== v.password ? "Les deux mots de passe ne sont pas identiques." : null) },
      { name: "sshkeys", label: "Clés SSH publiques", type: "code", rows: 3, full: true },
      { name: "unprivileged", label: "Conteneur non privilégié (recommandé, plus sûr)", type: "checkbox", default: true },
      { name: "nesting", label: "Imbrication (Docker, systemd récent)", type: "checkbox", default: true },
      { name: "tags", label: "Tags", type: "tags", full: true },
      { name: "onboot", label: "Démarrer avec le serveur", type: "checkbox" },
    ] },
    { id: "modele", title: "Modèle", lead: "Le système de base. Tu peux en télécharger d'autres dans Stockage.", fields: [
      { name: "tplstorage", label: "Stockage des modèles", type: "api-select", load: storages("vztmpl"), loadDeps: ["node"] },
      { name: "ostemplate", label: "Modèle", type: "api-select", load: files("vztmpl", "tplstorage"), loadDeps: ["node", "tplstorage"], required: true, full: true },
    ] },
    { id: "disque", title: "Disque", fields: [
      { name: "storage", label: "Stockage", type: "api-select", load: storages("rootdir"), loadDeps: ["node"], required: true },
      { name: "size", label: "Taille", type: "disk", min: 1, default: 8, required: true },
    ] },
    { id: "cpu", title: "Processeur", fields: [
      { name: "cores", label: "Cœurs", type: "number", min: 1, max: 128, default: 1 },
      { name: "cpulimit", label: "Limite CPU", type: "number", min: 0, step: 0.1, advanced: true },
    ] },
    { id: "memoire", title: "Mémoire", fields: [
      { name: "memory", label: "Mémoire", type: "number", unit: "Mo", min: 16, step: 256, default: 1024, required: true },
      { name: "swap", label: "Swap", type: "number", unit: "Mo", min: 0, step: 256, default: 512 },
    ] },
    { id: "reseau", title: "Réseau", fields: [
      { name: "netname", label: "Nom de l'interface", default: "eth0" },
      { name: "bridge", label: "Pont", type: "api-select", load: bridges, loadDeps: ["node"] },
      { name: "ipmode", label: "IPv4", type: "select", default: "dhcp", options: [{ value: "dhcp", label: "DHCP" }, { value: "static", label: "Fixe" }, { value: "manual", label: "Aucune" }] },
      { name: "ip", label: "Adresse IPv4", type: "cidr", show: (v) => v.ipmode === "static", required: true },
      { name: "gw", label: "Passerelle", placeholder: "10.0.1.1", show: (v) => v.ipmode === "static" },
      { name: "ip6mode", label: "IPv6", type: "select", options: [{ value: "", label: "Aucune" }, { value: "dhcp", label: "DHCPv6" }, { value: "auto", label: "SLAAC" }, { value: "static", label: "Fixe" }] },
      { name: "ip6", label: "Adresse IPv6", type: "cidr", show: (v) => v.ip6mode === "static", required: true },
      { name: "tag", label: "VLAN", type: "number", min: 1, max: 4094 },
      { name: "firewall", label: "Pare-feu Proxmox", type: "checkbox", default: true },
    ] },
    { id: "dns", title: "DNS", lead: "Laisse vide pour reprendre la configuration du serveur.", fields: [
      { name: "searchdomain", label: "Domaine de recherche", placeholder: "maison.lan" },
      { name: "nameserver", label: "Serveurs DNS", placeholder: "1.1.1.1" },
    ] },
  ];
  return (
    <Wizard
      title="Nouveau conteneur"
      steps={steps}
      initial={{ node: defaultNode, vmid: nextid, start: true }}
      finishLabel="Créer le conteneur"
      aside="Un conteneur partage le noyau du serveur : léger et rapide, idéal pour un service."
      summaryExtra={(v, set) => <label className="check"><input type="checkbox" checked={!!v.start} onChange={(e) => set("start", e.target.checked)} /> Démarrer le conteneur après la création</label>}
      onFinish={async (_c, v) => {
        const tags = (Array.isArray(v.tags) ? v.tags : String(v.tags ?? "").split(/[;,\s]+/)).filter(Boolean).join(";");
        const params: Record<string, unknown> = {
          vmid: v.vmid, hostname: v.hostname, pool: v.pool || undefined, password: v.password || undefined, "ssh-public-keys": v.sshkeys || undefined,
          unprivileged: v.unprivileged ? 1 : 0, features: v.nesting ? "nesting=1" : undefined, tags: tags || undefined, onboot: v.onboot ? 1 : 0,
          ostemplate: v.ostemplate, rootfs: `${v.storage}:${v.size}`, cores: v.cores, cpulimit: v.cpulimit || undefined, memory: v.memory, swap: v.swap,
          net0: joinProps({ name: v.netname || "eth0", bridge: v.bridge, ip: v.ipmode === "static" ? v.ip : v.ipmode, gw: v.ipmode === "static" ? v.gw : undefined, ip6: v.ip6mode === "static" ? v.ip6 : v.ip6mode || undefined, tag: v.tag, firewall: v.firewall ? 1 : undefined, type: "veth" }, "_none"),
          searchdomain: v.searchdomain || undefined, nameserver: v.nameserver || undefined, start: v.start ? 1 : 0,
        };
        await submit(String(v.node), Number(v.vmid), Object.fromEntries(Object.entries(params).filter(([, x]) => x !== undefined && x !== "")));
      }}
    />
  );
}


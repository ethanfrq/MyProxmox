// Aides communes à la fiche machine : lecture et écriture des chaînes de propriétés
// Proxmox (« local-lvm:vm-101-disk-0,iothread=1,size=32G »), listes chargées depuis l'API.
import { pve } from "../../lib/api";
import { bytes } from "../../../../shared/format";
import type { Option } from "../../components/Form";

export type GuestType = "qemu" | "lxc";
export interface GuestCtx {
  node: string;
  type: GuestType;
  vmid: number;
  base: string; // /nodes/{node}/{type}/{vmid}
  name: string;
  running: boolean;
  conf: Record<string, string>;
  refresh: () => void;
}

/** « a,b=1,c=2 » → { file: "a", b: "1", c: "2" }. Le premier élément sans « = » va dans `first`. */
export function parseProps(value = "", first = "file"): Record<string, string> {
  const out: Record<string, string> = {};
  String(value).split(",").forEach((part, i) => {
    if (!part) return;
    const eq = part.indexOf("=");
    if (eq < 0) {
      out[i === 0 ? first : part] = i === 0 ? part : "1";
    } else out[part.slice(0, eq)] = part.slice(eq + 1);
  });
  return out;
}

/** Inverse de parseProps : la clé `first` (si présente) sort en tête, sans « clé= ». Les vides sont ignorés. */
export function joinProps(obj: Record<string, unknown>, first = "file") {
  const parts: string[] = [];
  if (obj[first] !== undefined && obj[first] !== "") parts.push(String(obj[first]));
  for (const [k, v] of Object.entries(obj)) {
    if (k === first || v === undefined || v === null || v === "" || v === false) continue;
    parts.push(`${k}=${v === true ? 1 : v}`);
  }
  return parts.join(",");
}

/** Carte réseau QEMU : « virtio=BC:24:..,bridge=vmbr0 » → { model, macaddr, bridge, ... } */
export function parseQemuNet(value = ""): Record<string, string> {
  const p = parseProps(value, "_");
  const model = Object.keys(p).find((k) => /^(virtio|e1000e?|rtl8139|vmxnet3|ne2k_pci|pcnet|i82551|i82557b|i82559er)$/.test(k)) ?? (p.model ?? "virtio");
  const { [model]: mac, _: _first, ...rest } = p;
  return { model, macaddr: mac && mac !== "1" ? mac : p.macaddr ?? "", ...rest };
}
export function joinQemuNet(v: Record<string, unknown>) {
  const { model, macaddr, ...rest } = v;
  return joinProps({ _m: `${model}${macaddr ? `=${macaddr}` : ""}`, ...rest }, "_m");
}

export const isCdrom = (v = "") => /media=cdrom/.test(v);
export const DISK_KEY = /^(scsi|virtio|sata|ide)(\d+)$/;
export const volumeOf = (v = "") => String(v).split(",")[0];
export const sizeText = (v = "") => {
  const m = String(v).match(/size=(\d+(?:\.\d+)?)([KMGT])?/);
  return m ? `${m[1].replace(".", ",")} ${({ K: "Ko", M: "Mo", G: "Go", T: "To" } as Record<string, string>)[m[2] ?? "G"] ?? "Go"}` : "";
};

/** Premier index libre pour un type de périphérique (scsi, net, usb...). */
export function freeIndex(conf: Record<string, string>, prefix: string, max = 30) {
  for (let i = 0; i <= max; i++) if (conf[`${prefix}${i}`] === undefined) return i;
  return max;
}
export const BUS_MAX: Record<string, number> = { scsi: 30, virtio: 15, sata: 5, ide: 3 };

// ── Listes pour les formulaires ───────────────────────────────────
export const storagesFor = (node: string, content: string) => async (): Promise<Option[]> => {
  const list = await pve.get<any[]>(`/nodes/${node}/storage`, { content, enabled: 1 });
  return list.filter((s) => s.active && String(s.content).includes(content)).map((s) => ({ value: s.storage, label: `${s.storage} (${s.type}, ${bytes(s.avail)} libres)` }));
};
export const bridgesOf = (node: string) => async (): Promise<Option[]> => {
  const list = await pve.get<any[]>(`/nodes/${node}/network`);
  return list.filter((n) => n.type === "bridge" || n.type === "OVSBridge").map((n) => ({ value: n.iface, label: `${n.iface}${n.comments ? ` · ${n.comments}` : ""}` }));
};
export const isosOf = (node: string) => async (): Promise<Option[]> => {
  const st = await pve.get<any[]>(`/nodes/${node}/storage`, { content: "iso" });
  const lists = await Promise.all(st.filter((s) => s.active).map((s) => pve.get<any[]>(`/nodes/${node}/storage/${s.storage}/content`, { content: "iso" })));
  return lists.flat().map((f) => ({ value: f.volid, label: `${f.volid.split(":")[0]} : ${f.volid.split("/").pop()}` }));
};
export const nodesList = (exclude?: string) => async (): Promise<Option[]> => {
  const list = await pve.get<any[]>("/nodes");
  return list.filter((n) => n.node !== exclude).map((n) => ({ value: n.node, label: `${n.node}${n.status !== "online" ? " (hors ligne)" : ""}` }));
};

export const OSTYPES_QEMU: Option[] = [
  { value: "l26", label: "Linux 6.x / 5.x / 4.x / 3.x / 2.6" }, { value: "l24", label: "Linux 2.4" },
  { value: "win11", label: "Windows 11 / 2022 / 2025" }, { value: "win10", label: "Windows 10 / 2016 / 2019" },
  { value: "win8", label: "Windows 8.x / 2012" }, { value: "win7", label: "Windows 7 / 2008 R2" },
  { value: "solaris", label: "Solaris" }, { value: "other", label: "Autre" },
];
export const OSTYPES_LXC: Option[] = ["debian", "ubuntu", "alpine", "centos", "fedora", "opensuse", "archlinux", "gentoo", "nixos", "unmanaged"].map((v) => ({ value: v, label: v }));

// Onglet « Matériel » : tout le matériel d'une VM ou d'un conteneur, avec ajout,
// modification, redimensionnement, déplacement, détachement et rattachement.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Confirm, Panel, useToast } from "../../components/ui";
import { I } from "../../components/icons";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { DISK_KEY, isCdrom, parseProps, parseQemuNet, sizeText, volumeOf, type GuestCtx } from "./common";
import {
  cdrom, cloudinitDrive, lxcDns, lxcFeatures, lxcMount, lxcNet, lxcResources, moveDisk, pci, qemuCpu, qemuDisk, qemuMemory, qemuNet, resizeDisk, simple, usb, virtiofs,
  type Spec,
} from "./specs";
import { SpecDialog } from "./SpecDialog";

interface Row {
  key: string;
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  edit?: () => Spec | null;
  resize?: boolean;
  move?: boolean;
  /** Détacher (le volume devient inutilisé) */
  detach?: boolean;
  /** Retirer la clé de la config (périphérique, lecteur...) */
  remove?: boolean;
  /** Disque inutilisé : rattacher ou effacer */
  unused?: boolean;
  priv: string;
}

const MB = (v?: string) => (v ? `${(Number(v) / 1024).toFixed(Number(v) % 1024 ? 1 : 0).replace(".", ",")} Go` : "-");

function qemuRows(ctx: GuestCtx): Row[] {
  const c = ctx.conf;
  const rows: Row[] = [];
  const cpu = parseProps(c.cpu ?? "kvm64", "type");
  const sockets = Number(c.sockets ?? 1);
  const cores = Number(c.cores ?? 1);
  rows.push({ key: "memory", label: "Mémoire", priv: "VM.Config.Memory", edit: () => qemuMemory(ctx), value: <>{MB(c.memory)}{c.balloon === "0" ? " · sans ballooning" : c.balloon ? ` · minimum ${MB(c.balloon)}` : ""}</> });
  rows.push({ key: "cpu", label: "Processeur", priv: "VM.Config.CPU", edit: () => qemuCpu(ctx), value: <>{sockets * cores} cœur{sockets * cores > 1 ? "s" : ""} ({sockets} socket × {cores}) · {cpu.type}{cpu.flags ? ` · ${cpu.flags}` : ""}{c.cpulimit ? ` · limite ${c.cpulimit}` : ""}{c.affinity ? ` · affinité ${c.affinity}` : ""}</> });
  rows.push({ key: "bios", label: "Micrologiciel", priv: "VM.Config.Options", edit: () => simple(ctx, "bios"), value: c.bios === "ovmf" ? "UEFI (OVMF)" : "BIOS (SeaBIOS)" });
  rows.push({ key: "vga", label: "Affichage", priv: "VM.Config.HWType", edit: () => simple(ctx, "vga"), value: c.vga ?? "Par défaut" });
  rows.push({ key: "machine", label: "Machine", priv: "VM.Config.HWType", edit: () => simple(ctx, "machine"), value: c.machine ?? "Par défaut (i440fx)" });
  rows.push({ key: "scsihw", label: "Contrôleur SCSI", priv: "VM.Config.Options", edit: () => simple(ctx, "scsihw"), value: c.scsihw ?? "LSI 53C895A" });
  const keys = Object.keys(c).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  for (const k of keys.filter((x) => DISK_KEY.test(x))) {
    const v = c[k];
    if (/cloudinit/.test(v)) rows.push({ key: k, label: `Cloud-Init (${k})`, priv: "VM.Config.Disk", remove: true, value: <span className="mono small">{volumeOf(v)}</span> });
    else if (isCdrom(v)) rows.push({ key: k, label: `Lecteur CD/DVD (${k})`, priv: "VM.Config.CDROM", edit: () => cdrom(ctx, k), remove: true, value: <span className="mono small">{volumeOf(v) === "none" ? "vide" : volumeOf(v) === "cdrom" ? "lecteur physique" : volumeOf(v).split("/").pop()}</span> });
    else rows.push({ key: k, label: `Disque (${k})`, priv: "VM.Config.Disk", edit: () => qemuDisk(ctx, k), resize: true, move: true, detach: true, value: <DiskValue v={v} /> });
  }
  if (c.efidisk0) rows.push({ key: "efidisk0", label: "Disque EFI", priv: "VM.Config.Disk", move: true, detach: true, value: <DiskValue v={c.efidisk0} /> });
  if (c.tpmstate0) rows.push({ key: "tpmstate0", label: "TPM", priv: "VM.Config.Disk", move: true, detach: true, value: <DiskValue v={c.tpmstate0} /> });
  for (const k of keys.filter((x) => /^net\d+$/.test(x))) {
    const n = parseQemuNet(c[k]);
    rows.push({ key: k, label: `Carte réseau (${k})`, priv: "VM.Config.Network", edit: () => qemuNet(ctx, k), remove: true, value: <span className="small">{n.model} · <span className="mono">{n.macaddr}</span> · {n.bridge}{n.tag ? ` · VLAN ${n.tag}` : ""}{n.rate ? ` · ${n.rate} Mo/s` : ""}{n.firewall === "1" ? " · pare-feu" : ""}{n.link_down === "1" ? " · débranchée" : ""}</span> });
  }
  for (const k of keys.filter((x) => /^usb\d+$/.test(x))) rows.push({ key: k, label: `USB (${k})`, priv: "VM.Config.HWType", edit: () => usb(ctx, k), remove: true, value: <span className="mono small">{c[k]}</span> });
  for (const k of keys.filter((x) => /^hostpci\d+$/.test(x))) rows.push({ key: k, label: `PCI (${k})`, priv: "VM.Config.HWType", edit: () => pci(ctx, k), remove: true, value: <span className="mono small">{c[k]}</span> });
  for (const k of keys.filter((x) => /^serial\d$/.test(x))) rows.push({ key: k, label: `Port série (${k})`, priv: "VM.Config.HWType", edit: () => simple(ctx, k), remove: true, value: <span className="mono small">{c[k]}</span> });
  if (c.audio0) rows.push({ key: "audio0", label: "Carte son", priv: "VM.Config.HWType", edit: () => simple(ctx, "audio0"), remove: true, value: <span className="mono small">{c.audio0}</span> });
  if (c.rng0) rows.push({ key: "rng0", label: "Générateur aléatoire", priv: "VM.Config.HWType", edit: () => simple(ctx, "rng0"), remove: true, value: <span className="mono small">{c.rng0}</span> });
  for (const k of keys.filter((x) => /^virtiofs\d$/.test(x))) rows.push({ key: k, label: `VirtIO-FS (${k})`, priv: "VM.Config.Options", edit: () => virtiofs(ctx, k), remove: true, value: <span className="mono small">{c[k]}</span> });
  for (const k of keys.filter((x) => /^unused\d+$/.test(x))) rows.push({ key: k, label: `Disque inutilisé (${k})`, priv: "VM.Config.Disk", unused: true, value: <span className="mono small muted">{c[k]}</span> });
  return rows;
}

function lxcRows(ctx: GuestCtx): Row[] {
  const c = ctx.conf;
  const rows: Row[] = [];
  rows.push({ key: "memory", label: "Mémoire", priv: "VM.Config.Memory", edit: () => lxcResources(ctx, "memory"), value: <>{MB(c.memory)} · swap {MB(c.swap ?? "512")}</> });
  rows.push({ key: "cores", label: "Processeur", priv: "VM.Config.CPU", edit: () => lxcResources(ctx, "cpu"), value: <>{c.cores ? `${c.cores} cœur${Number(c.cores) > 1 ? "s" : ""}` : "tous les cœurs"}{c.cpulimit ? ` · limite ${c.cpulimit}` : ""}{c.cpuunits ? ` · poids ${c.cpuunits}` : ""}</> });
  rows.push({ key: "rootfs", label: "Disque racine", priv: "VM.Config.Disk", edit: () => lxcMount(ctx, "rootfs"), resize: true, move: true, value: <DiskValue v={c.rootfs} /> });
  const keys = Object.keys(c).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  for (const k of keys.filter((x) => /^mp\d+$/.test(x))) {
    const p = parseProps(c[k]);
    const bind = p.file?.startsWith("/");
    rows.push({ key: k, label: `Point de montage (${k})`, priv: "VM.Config.Disk", edit: () => lxcMount(ctx, k), resize: !bind, move: !bind, detach: true, value: <span className="small"><span className="mono">{p.mp}</span> ← <span className="mono">{p.file}</span>{p.size ? ` · ${sizeText(c[k])}` : ""}{p.backup === "1" ? " · sauvegardé" : ""}{p.ro === "1" ? " · lecture seule" : ""}</span> });
  }
  for (const k of keys.filter((x) => /^net\d+$/.test(x))) {
    const n = parseProps(c[k], "_");
    rows.push({ key: k, label: `Carte réseau (${k})`, priv: "VM.Config.Network", edit: () => lxcNet(ctx, k), remove: true, value: <span className="small">{n.name} · <span className="mono">{n.hwaddr}</span> · {n.bridge} · {n.ip === "dhcp" ? "DHCP" : <span className="mono">{n.ip}</span>}{n.tag ? ` · VLAN ${n.tag}` : ""}{n.firewall === "1" ? " · pare-feu" : ""}</span> });
  }
  rows.push({ key: "features", label: "Fonctionnalités", priv: "VM.Config.Options", edit: () => lxcFeatures(ctx), value: c.features ? <span className="mono small">{c.features}</span> : <span className="muted">aucune</span> });
  rows.push({ key: "dns", label: "DNS", priv: "VM.Config.Network", edit: () => lxcDns(ctx), value: c.nameserver || c.searchdomain ? <span className="small">{c.searchdomain ?? ""} {c.nameserver ? <span className="mono">{c.nameserver}</span> : ""}</span> : <span className="muted">celui du serveur</span> });
  for (const k of keys.filter((x) => /^unused\d+$/.test(x))) rows.push({ key: k, label: `Volume inutilisé (${k})`, priv: "VM.Config.Disk", unused: true, value: <span className="mono small muted">{c[k]}</span> });
  return rows;
}

function DiskValue({ v }: { v: string }) {
  const p = parseProps(v);
  const opts = Object.entries(p).filter(([k]) => !["file", "size"].includes(k)).map(([k, x]) => (x === "1" || x === "on" ? k : `${k}=${x}`));
  return <span className="small"><span className="mono">{p.file}</span>{p.size ? <strong> · {sizeText(v)}</strong> : ""}{opts.length ? <span className="muted"> · {opts.join(", ")}</span> : ""}</span>;
}

function AddMenu({ ctx, onPick }: { ctx: GuestCtx; onPick: (s: Spec) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { allowed } = usePermission(`/vms/${ctx.vmid}`, ["VM.Config.Disk", "VM.Config.HWType", "VM.Config.Network", "VM.Config.CDROM"]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const c = ctx.conf;
  const items: [string, () => Spec][] = ctx.type === "qemu"
    ? [
      ["Disque dur", () => qemuDisk(ctx)], ["Lecteur CD/DVD", () => cdrom(ctx)], ["Carte réseau", () => qemuNet(ctx)],
      ...(!c.efidisk0 ? [["Disque EFI", () => simple(ctx, "efidisk0")!] as [string, () => Spec]] : []),
      ...(!c.tpmstate0 ? [["TPM", () => simple(ctx, "tpmstate0")!] as [string, () => Spec]] : []),
      ...(!Object.values(c).some((v) => /cloudinit/.test(v)) ? [["Lecteur Cloud-Init", () => cloudinitDrive(ctx)] as [string, () => Spec]] : []),
      ["Périphérique USB", () => usb(ctx)], ["Périphérique PCI", () => pci(ctx)],
      ["Port série", () => simple(ctx, `serial${[0, 1, 2, 3].find((i) => !c[`serial${i}`]) ?? 3}`)!],
      ...(!c.audio0 ? [["Carte son", () => simple(ctx, "audio0")!] as [string, () => Spec]] : []),
      ...(!c.rng0 ? [["Générateur aléatoire (RNG)", () => simple(ctx, "rng0")!] as [string, () => Spec]] : []),
      ["Partage VirtIO-FS", () => virtiofs(ctx)],
    ]
    : [["Point de montage", () => lxcMount(ctx)], ["Carte réseau", () => lxcNet(ctx)]];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button size="sm" variant="primary" icon={<I.plus />} disabled={!allowed} title={allowed ? undefined : "Il te manque un droit VM.Config.* sur cette machine"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>Ajouter</Button>
      {open && (
        <div className="ctx-menu" role="menu" style={{ position: "absolute", right: 0, top: 32 }}>
          {items.map(([label, fn]) => <button key={label} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(fn()); }}>{label}</button>)}
        </div>
      )}
    </div>
  );
}

export function Hardware({ ctx }: { ctx: GuestCtx }) {
  const { toast } = useToast();
  const { allowed: canDisk } = usePermission(`/vms/${ctx.vmid}`, "VM.Config.Disk");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [confirm, setConfirm] = useState<{ row: Row; kind: "detach" | "remove" | "erase" } | null>(null);
  const pending = usePoll(() => (ctx.running ? pve.get<any[]>(`${ctx.base}/pending`) : Promise.resolve([])), 0, [ctx.conf, ctx.running]);
  const pendingKeys = new Set((pending.data ?? []).filter((p) => p.pending !== undefined || p.delete).map((p) => p.key));
  const rows = ctx.type === "qemu" ? qemuRows(ctx) : lxcRows(ctx);

  const put = async (body: Record<string, unknown>, ok: string) => {
    try {
      await pve.put(`${ctx.base}/config`, body);
      toast(ok, "ok");
      ctx.refresh();
    } catch (e) {
      toast(`${(e as Error).message}. Vérifie que la machine n'est pas verrouillée, puis réessaie.`, "error");
    }
  };

  return (
    <Panel pad={false} title="Matériel" right={<AddMenu ctx={ctx} onPick={setSpec} />}>
      <div className="table-wrap">
        <table className="table hw-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="nowrap" style={{ width: 200 }}><strong>{r.label}</strong>{pendingKeys.has(r.key) && <div><span className="tag" title="S'appliquera au prochain redémarrage">au redémarrage</span></div>}</td>
                <td>{r.value}</td>
                <td className="actions">
                  <HwActions r={r} ctx={ctx} canDisk={canDisk} onSpec={setSpec} onConfirm={(kind) => setConfirm({ row: r, kind })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spec && <SpecDialog ctx={ctx} spec={spec} onClose={() => setSpec(null)} onDone={pending.refresh} />}
      {confirm && (
        <Confirm
          title={confirm.kind === "detach" ? `Détacher ${confirm.row.key} ?` : confirm.kind === "erase" ? `Effacer ${confirm.row.key} ?` : `Retirer ${confirm.row.label} ?`}
          danger={confirm.kind !== "detach"}
          requireText={confirm.kind === "erase" ? confirm.row.key : undefined}
          confirmLabel={confirm.kind === "detach" ? "Détacher" : confirm.kind === "erase" ? "Effacer le volume" : "Retirer"}
          onConfirm={async () => {
            const k = confirm.row.key;
            if (confirm.kind === "erase") {
              try {
                await pve.put(`${ctx.base}/unlink`, { idlist: k, force: 1 });
                toast(`${k} effacé`, "ok");
                ctx.refresh();
              } catch (e) { toast((e as Error).message, "error"); }
            } else if (confirm.kind === "detach") {
              await put({ delete: k }, `${k} détaché : il reste dans les disques inutilisés`);
            } else await put({ delete: k }, `${confirm.row.label} retiré`);
          }}
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.kind === "detach"
              ? "Le disque est retiré de la machine mais rien n'est effacé : il apparaît ensuite comme « disque inutilisé », que tu peux rattacher."
              : confirm.kind === "erase"
                ? "Le volume et toutes ses données sont effacés du stockage. Ça ne se défait pas."
                : "Le périphérique est retiré de la configuration de la machine."}
          </p>
          {ctx.running && confirm.kind !== "erase" && <p className="small muted">La machine est allumée : si le retrait à chaud n&apos;est pas possible, il se fera au prochain redémarrage.</p>}
        </Confirm>
      )}
    </Panel>
  );
}

function HwActions({ r, ctx, canDisk, onSpec, onConfirm }: { r: Row; ctx: GuestCtx; canDisk: boolean; onSpec: (s: Spec) => void; onConfirm: (k: "detach" | "remove" | "erase") => void }) {
  const { allowed } = usePermission(`/vms/${ctx.vmid}`, r.priv);
  const deny = allowed ? undefined : `Il te manque le droit ${r.priv}`;
  const reattach = () => onSpec(ctx.type === "qemu" ? qemuDisk(ctx, undefined, ctx.conf[r.key]) : lxcMount(ctx, undefined, ctx.conf[r.key]));
  return (
    <span className="btn-group">
      {r.edit && <Button size="sm" disabled={!allowed} title={deny} onClick={() => { const s = r.edit!(); if (s) onSpec(s); }}>Modifier</Button>}
      {r.resize && <Button size="sm" disabled={!canDisk} onClick={() => onSpec(resizeDisk(ctx, r.key))}>Agrandir</Button>}
      {r.move && <Button size="sm" disabled={!canDisk} onClick={() => onSpec(moveDisk(ctx, r.key))}>Déplacer</Button>}
      {r.detach && <Button size="sm" disabled={!canDisk} onClick={() => onConfirm("detach")}>Détacher</Button>}
      {r.remove && <Button size="sm" variant="danger" disabled={!allowed} title={deny} onClick={() => onConfirm("remove")}>Retirer</Button>}
      {r.unused && (
        <>
          <Button size="sm" disabled={!canDisk} onClick={reattach}>Rattacher</Button>
          <Button size="sm" variant="danger" disabled={!canDisk} onClick={() => onConfirm("erase")}>Effacer</Button>
        </>
      )}
    </span>
  );
}

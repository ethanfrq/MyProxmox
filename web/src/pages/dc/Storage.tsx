// Stockages du datacenter : ajouter, modifier, retirer tous les types, avec recherche des
// partages, cibles et datastores (qui sert de test de connexion quand l'API le permet).
import { useEffect, useRef, useState } from "react";
import { Button, Confirm, Modal, Notice, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form, type FieldDef, type Option, type Values } from "../../components/Form";
import { I } from "../../components/icons";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { joinProps, parseProps } from "../machine/common";

const CONTENT: Record<string, string> = { images: "Disques de VM", rootdir: "Disques de conteneurs", iso: "Images ISO", vztmpl: "Modèles de conteneurs", backup: "Sauvegardes", snippets: "Snippets", import: "Import" };
const TYPES: { id: string; label: string; content: string[]; shared?: boolean }[] = [
  { id: "dir", label: "Répertoire", content: ["images", "rootdir", "iso", "vztmpl", "backup", "snippets", "import"] },
  { id: "lvm", label: "LVM", content: ["images", "rootdir"] },
  { id: "lvmthin", label: "LVM-thin", content: ["images", "rootdir"] },
  { id: "zfspool", label: "ZFS", content: ["images", "rootdir"] },
  { id: "btrfs", label: "BTRFS", content: ["images", "rootdir", "iso", "vztmpl", "backup", "snippets"] },
  { id: "nfs", label: "NFS", content: ["images", "rootdir", "iso", "vztmpl", "backup", "snippets", "import"], shared: true },
  { id: "cifs", label: "CIFS / SMB", content: ["images", "rootdir", "iso", "vztmpl", "backup", "snippets", "import"], shared: true },
  { id: "iscsi", label: "iSCSI", content: ["images"], shared: true },
  { id: "rbd", label: "Ceph RBD", content: ["images", "rootdir"], shared: true },
  { id: "cephfs", label: "CephFS", content: ["iso", "vztmpl", "backup", "snippets"], shared: true },
  { id: "pbs", label: "Proxmox Backup Server", content: ["backup"], shared: true },
  { id: "glusterfs", label: "GlusterFS", content: ["images", "iso", "vztmpl", "backup", "snippets"], shared: true },
];
const typeLabel = (t: string) => TYPES.find((x) => x.id === t)?.label ?? t;

const firstNode = async () => (await pve.get<any[]>("/nodes")).find((n) => n.status === "online")?.node ?? "";
const scan = (kind: string, params: (v: Values) => Record<string, unknown> | null, map: (x: any) => Option) => async (v: Values): Promise<Option[]> => {
  const q = params(v);
  if (!q) return [];
  const node = await firstNode();
  return (await pve.get<any[]>(`/nodes/${node}/scan/${kind}`, q as Record<string, string>)).map(map);
};

function typeFields(type: string, editing: boolean): FieldDef[] {
  const t = TYPES.find((x) => x.id === type)!;
  const nodes = async () => (await pve.get<any[]>("/nodes")).map((n) => ({ value: n.node, label: n.node }));
  const prune: FieldDef[] = ["last", "hourly", "daily", "weekly", "monthly", "yearly"].map((k) => ({ name: `keep_${k}`, label: { last: "Garder les dernières", hourly: "Une par heure", daily: "Une par jour", weekly: "Une par semaine", monthly: "Une par mois", yearly: "Une par an" }[k]!, type: "number" as const, min: 0, advanced: true, show: (v: Values) => (Array.isArray(v.content) ? v.content : String(v.content ?? "").split(",")).includes("backup") }));
  const specific: Record<string, FieldDef[]> = {
    dir: [{ name: "path", label: "Dossier", required: true, readOnly: editing, placeholder: "/mnt/data" }, { name: "shared", label: "Partagé (le même dossier existe sur tous les nœuds, ex. montage réseau)", type: "checkbox" }],
    btrfs: [{ name: "path", label: "Dossier", required: true, readOnly: editing }],
    lvm: [{ name: "vgname", label: "Groupe de volumes", type: "api-select", required: true, readOnly: editing, load: scan("lvm", () => ({}), (x) => ({ value: x.vg, label: x.vg })) }, { name: "shared", label: "Partagé (LVM sur un disque iSCSI ou FC commun)", type: "checkbox" }],
    lvmthin: [
      { name: "vgname", label: "Groupe de volumes", type: "api-select", required: true, readOnly: editing, load: scan("lvm", () => ({}), (x) => ({ value: x.vg, label: x.vg })) },
      { name: "thinpool", label: "Pool thin", type: "api-select", required: true, readOnly: editing, loadDeps: ["vgname"], load: scan("lvmthin", (v) => (v.vgname ? { vg: v.vgname } : null), (x) => ({ value: x.lv, label: x.lv })) },
    ],
    zfspool: [{ name: "pool", label: "Pool ZFS", type: "api-select", required: true, readOnly: editing, load: scan("zfs", () => ({}), (x) => ({ value: x.pool, label: x.pool })) }, { name: "sparse", label: "Allocation à la demande (thin)", type: "checkbox" }, { name: "blocksize", label: "Taille de bloc", placeholder: "16k", advanced: true }],
    nfs: [
      { name: "server", label: "Serveur", required: true, readOnly: editing, placeholder: "10.0.1.10" },
      { name: "export", label: "Partage NFS", type: "api-select", required: true, readOnly: editing, loadDeps: ["server"], load: scan("nfs", (v) => (v.server ? { server: v.server } : null), (x) => ({ value: x.path, label: `${x.path} (${x.options})` })), help: "La liste se charge en interrogeant le serveur : si elle apparaît, la connexion fonctionne." },
      { name: "options", label: "Options de montage", placeholder: "vers=4.2", advanced: true },
    ],
    cifs: [
      { name: "server", label: "Serveur", required: true, readOnly: editing },
      { name: "username", label: "Utilisateur" },
      { name: "password", label: "Mot de passe", type: "password", help: editing ? "Vide : inchangé." : undefined },
      { name: "domain", label: "Domaine", advanced: true },
      { name: "share", label: "Partage", type: "api-select", required: true, readOnly: editing, loadDeps: ["server", "username", "password"], load: scan("cifs", (v) => (v.server ? { server: v.server, username: v.username || undefined, password: v.password || undefined, domain: v.domain || undefined } : null), (x) => ({ value: x.share, label: `${x.share}${x.description ? ` · ${x.description}` : ""}` })), help: "Se charge avec les identifiants ci-dessus : c'est le test de connexion." },
      { name: "subdir", label: "Sous-dossier", advanced: true },
      { name: "smbversion", label: "Version SMB", type: "select", advanced: true, options: [{ value: "", label: "Automatique" }, { value: "3", label: "3" }, { value: "3.11", label: "3.11" }, { value: "2.1", label: "2.1" }, { value: "2.0", label: "2.0" }] },
    ],
    iscsi: [
      { name: "portal", label: "Portail", required: true, readOnly: editing, placeholder: "10.0.1.10" },
      { name: "target", label: "Cible", type: "api-select", required: true, readOnly: editing, loadDeps: ["portal"], load: scan("iscsi", (v) => (v.portal ? { portal: v.portal } : null), (x) => ({ value: x.target, label: x.target })) },
      { name: "uselun", label: "Utiliser les LUN directement comme disques de VM", type: "checkbox", default: true },
    ],
    rbd: [
      { name: "pool", label: "Pool Ceph", required: true, readOnly: editing, placeholder: "rbd-vm" },
      { name: "monhost", label: "Moniteurs (Ceph externe)", placeholder: "10.0.2.1 10.0.2.2", help: "Vide : le Ceph de ce cluster." },
      { name: "username", label: "Utilisateur Ceph", placeholder: "admin", advanced: true },
      { name: "krbd", label: "Pilote noyau (KRBD)", type: "checkbox", advanced: true },
    ],
    cephfs: [
      { name: "fs-name", label: "Nom du CephFS", placeholder: "cephfs" },
      { name: "monhost", label: "Moniteurs (Ceph externe)", help: "Vide : le Ceph de ce cluster." },
      { name: "username", label: "Utilisateur Ceph", advanced: true },
    ],
    pbs: [
      { name: "server", label: "Serveur", required: true, placeholder: "10.0.1.11" },
      { name: "username", label: "Utilisateur", required: true, placeholder: "pve@pbs ou pve@pbs!jeton" },
      { name: "password", label: "Mot de passe ou secret du jeton", type: "password", required: !editing, help: editing ? "Vide : inchangé." : undefined },
      { name: "fingerprint", label: "Empreinte du certificat", placeholder: "AB:CD:...", help: "Dans le tableau de bord de PBS. Vide si le certificat est signé par une autorité reconnue." },
      { name: "datastore", label: "Datastore", type: "api-select", required: true, loadDeps: ["server", "username", "password", "fingerprint"], load: scan("pbs", (v) => (v.server && v.username && (v.password || editing) ? { server: v.server, username: v.username, password: v.password || undefined, fingerprint: v.fingerprint || undefined } : null), (x) => ({ value: x.store, label: `${x.store}${x.comment ? ` · ${x.comment}` : ""}` })), help: "Se charge en se connectant à PBS : c'est le test de connexion." },
      { name: "namespace", label: "Espace de noms", advanced: true },
      { name: "encryption-key", label: "Clé de chiffrement", type: "code", rows: 3, advanced: true, help: "« autogen » pour en générer une. Garde-la précieusement : sans elle, pas de restauration." },
    ],
    glusterfs: [
      { name: "server", label: "Serveur", required: true, readOnly: editing },
      { name: "server2", label: "Serveur de secours", advanced: true },
      { name: "volume", label: "Volume", type: "api-select", required: true, readOnly: editing, loadDeps: ["server"], load: scan("glusterfs", (v) => (v.server ? { server: v.server } : null), (x) => ({ value: x.volname, label: x.volname })) },
    ],
  };
  return [
    { name: "storage", label: "Identifiant", required: true, readOnly: editing, placeholder: "nas", validate: (x) => (/^[a-z][a-z0-9_.-]*$/i.test(String(x)) ? null : "Lettres, chiffres, point, tiret et soulignement, en commençant par une lettre.") },
    ...specific[type],
    { name: "content", label: "Contenu accepté", type: "multi", options: t.content.map((c) => ({ value: c, label: CONTENT[c] })), required: type !== "iscsi" && type !== "pbs", full: true },
    { name: "nodes", label: "Nœuds", type: "multi", load: nodes, help: "Rien de coché : tous les nœuds." },
    { name: "disable", label: "Désactivé", type: "checkbox" },
    ...prune,
  ];
}

function toBody(type: string, v: Values, editing: boolean, before?: Record<string, any>) {
  const skip = new Set(["storage", "keep_last", "keep_hourly", "keep_daily", "keep_weekly", "keep_monthly", "keep_yearly"]);
  const out: Record<string, unknown> = editing ? {} : { storage: v.storage, type };
  const del: string[] = [];
  const readOnlyKeys = new Set(typeFields(type, true).filter((f) => f.readOnly).map((f) => f.name));
  for (const [k, x] of Object.entries(v)) {
    if (skip.has(k) || (editing && readOnlyKeys.has(k))) continue;
    if (k === "password" && !x && editing) continue;
    const empty = x === undefined || x === "" || (Array.isArray(x) && !x.length);
    if (empty) { if (editing && before?.[k] !== undefined) del.push(k); continue; }
    out[k] = typeof x === "boolean" ? (x ? 1 : 0) : Array.isArray(x) ? x.join(",") : x;
  }
  const prune = joinProps({ "keep-last": v.keep_last, "keep-hourly": v.keep_hourly, "keep-daily": v.keep_daily, "keep-weekly": v.keep_weekly, "keep-monthly": v.keep_monthly, "keep-yearly": v.keep_yearly }, "_none");
  if (prune) out["prune-backups"] = prune;
  else if (editing && before?.["prune-backups"]) del.push("prune-backups");
  if (del.length) out.delete = del.join(",");
  return out;
}

function toValues(s: Record<string, any>): Values {
  const pr = parseProps(s["prune-backups"] ?? "", "_");
  const { "prune-backups": _p, digest: _d, ...rest } = s;
  return {
    ...rest, content: String(s.content ?? "").split(",").filter(Boolean), nodes: String(s.nodes ?? "").split(",").filter(Boolean),
    disable: !!Number(s.disable ?? 0), shared: !!Number(s.shared ?? 0), sparse: !!Number(s.sparse ?? 0), krbd: !!Number(s.krbd ?? 0), uselun: s.content === "images",
    keep_last: pr["keep-last"] ?? "", keep_hourly: pr["keep-hourly"] ?? "", keep_daily: pr["keep-daily"] ?? "", keep_weekly: pr["keep-weekly"] ?? "", keep_monthly: pr["keep-monthly"] ?? "", keep_yearly: pr["keep-yearly"] ?? "",
  };
}

export function DcStorage() {
  const { toast } = useToast();
  const { allowed } = usePermission("/storage", "Datastore.Allocate");
  const list = usePoll(() => pve.get<any[]>("/storage"), 0);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<{ type: string; row?: any } | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <Panel pad={false} title="Stockages" right={
      <div ref={ref} style={{ position: "relative" }}>
        <Button size="sm" variant="primary" icon={<I.plus />} disabled={!allowed} title={allowed ? undefined : "Il te manque le droit Datastore.Allocate"} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Ajouter</Button>
        {menu && <div className="ctx-menu" role="menu" style={{ position: "absolute", right: 0, top: 32 }}>{TYPES.map((t) => <button key={t.id} type="button" role="menuitem" onClick={() => { setMenu(false); setEdit({ type: t.id }); }}>{t.label}</button>)}</div>}
      </div>
    }>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(s) => s.storage}
        initialSort={{ id: "id", dir: "asc" }}
        columns={[
          { id: "id", header: "Identifiant", sort: (s) => s.storage, cell: (s) => <strong>{s.storage}</strong> },
          { id: "type", header: "Type", sort: (s) => s.type, cell: (s) => typeLabel(s.type) },
          { id: "where", header: "Emplacement", text: (s) => `${s.path ?? ""} ${s.server ?? ""} ${s.export ?? ""} ${s.pool ?? ""} ${s.vgname ?? ""}`, cell: (s) => <span className="mono small">{s.path ?? (s.server ? `${s.server}:${s.export ?? s.share ?? s.datastore ?? s.volume ?? ""}` : s.pool ?? (s.vgname ? `${s.vgname}${s.thinpool ? `/${s.thinpool}` : ""}` : s.portal ?? ""))}</span> },
          { id: "content", header: "Contenu", cell: (s) => <span className="small">{String(s.content ?? "").split(",").filter(Boolean).map((c) => CONTENT[c] ?? c).join(", ")}</span> },
          { id: "nodes", header: "Nœuds", cell: (s) => s.nodes || <span className="muted">tous</span> },
          { id: "shared", header: "Partagé", cell: (s) => (Number(s.shared) ? "Oui" : "Non") },
          { id: "on", header: "État", cell: (s) => (Number(s.disable) ? <span className="badge off">désactivé</span> : <span className="badge on">actif</span>) },
        ]}
        actions={(s) => (
          <span className="btn-group">
            <Button size="sm" disabled={!allowed} onClick={() => setEdit({ type: s.type, row: s })}>Modifier</Button>
            <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(s)}>Retirer</Button>
          </span>
        )}
      />
      {edit && (
        <Modal title={edit.row ? `Stockage ${edit.row.storage} (${typeLabel(edit.type)})` : `Ajouter : ${typeLabel(edit.type)}`} wide onClose={() => setEdit(null)}>
          <div className="stack">
            {["lvm", "lvmthin", "zfspool", "dir", "btrfs"].includes(edit.type) && !edit.row && <Notice>Pour préparer un nouveau disque (LVM, ZFS, répertoire), passe plutôt par Nœuds &gt; Disques : la création y ajoute le stockage directement.</Notice>}
            <Form
              fields={typeFields(edit.type, !!edit.row)}
              initial={edit.row ? toValues(edit.row) : { content: TYPES.find((t) => t.id === edit.type)!.content.slice(0, edit.type === "pbs" ? 1 : 2) }}
              onCancel={() => setEdit(null)}
              onSubmit={async (_c, v) => {
                const body = toBody(edit.type, v, !!edit.row, edit.row);
                if (edit.type === "iscsi") body.content = v.uselun ? "images" : "none";
                delete body.uselun;
                if (edit.row) await pve.put(`/storage/${edit.row.storage}`, body);
                else await pve.post("/storage", body);
                toast("Stockage enregistré", "ok");
                setEdit(null);
                list.refresh();
              }}
            />
          </div>
        </Modal>
      )}
      {del && (
        <Confirm title={`Retirer le stockage ${del.storage} ?`} danger requireText={del.storage} confirmLabel="Retirer" onConfirm={async () => {
          try { await pve.del(`/storage/${del.storage}`); toast("Stockage retiré", "ok"); list.refresh(); } catch (e) { toast(`${(e as Error).message}. Déplace d'abord les disques des machines qui l'utilisent.`, "error"); }
        }} onClose={() => setDel(null)}>
          <p>Proxmox oublie ce stockage. <strong>Les données ne sont pas effacées</strong> du disque ou du serveur distant, mais les machines qui l&apos;utilisent ne démarreront plus.</p>
        </Confirm>
      )}
    </Panel>
  );
}

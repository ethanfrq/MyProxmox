// Onglet « Sauvegardes » : sauvegarde immédiate (toutes les options), restauration avec
// options, notes et protection, restauration de fichiers isolés depuis Proxmox Backup Server.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Confirm, Modal, Notice, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form, type FieldDef } from "../../components/Form";
import { I } from "../../components/icons";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { DEMO } from "../../lib/env";
import { bytes, date } from "../../../../shared/format";
import { storagesFor, type GuestCtx } from "./common";

interface Backup { volid: string; storage: string; storageType: string; ctime: number; size: number; notes?: string; protected?: number; verification?: { state: string }; format?: string }

export function Backups({ ctx }: { ctx: GuestCtx }) {
  const { watch, toast } = useToast();
  const navigate = useNavigate();
  const canBackup = usePermission(`/vms/${ctx.vmid}`, "VM.Backup").allowed;
  const stores = usePoll(() => pve.get<any[]>(`/nodes/${ctx.node}/storage`, { content: "backup" }), 0, [ctx.node]);
  const backupStores = (stores.data ?? []).filter((s) => String(s.content).includes("backup") && s.active);
  const list = usePoll(async () => {
    const all = await Promise.all(backupStores.map((s) =>
      pve.get<any[]>(`/nodes/${ctx.node}/storage/${s.storage}/content`, { content: "backup", vmid: ctx.vmid }).then((l) => l.map((x): Backup => ({ ...x, storage: s.storage, storageType: s.type }))),
    ));
    return all.flat();
  }, 0, [backupStores.map((s) => s.storage).join(",")]);
  const [now, setNow] = useState(false);
  const [restore, setRestore] = useState<Backup | null>(null);
  const [notes, setNotes] = useState<Backup | null>(null);
  const [files, setFiles] = useState<Backup | null>(null);
  const [del, setDel] = useState<Backup | null>(null);

  const content = (b: Backup) => `/nodes/${ctx.node}/storage/${b.storage}/content/${encodeURIComponent(b.volid)}`;
  const protect = async (b: Backup) => {
    try {
      await pve.put(content(b), { protected: b.protected ? 0 : 1 });
      toast(b.protected ? "Protection retirée" : "Sauvegarde protégée : elle ne sera plus supprimée par la rétention", "ok");
      list.refresh();
    } catch (e) { toast((e as Error).message, "error"); }
  };

  return (
    <div className="stack">
      <Panel pad={false} title="Sauvegardes de cette machine" right={
        <span className="row">
          <Button size="sm" icon={<I.refresh />} onClick={list.refresh}>Actualiser</Button>
          <Button size="sm" variant="primary" icon={<I.download />} disabled={!canBackup || !backupStores.length} title={canBackup ? undefined : "Il te manque le droit VM.Backup"} onClick={() => setNow(true)}>Sauvegarder maintenant</Button>
        </span>
      }>
        {!stores.loading && !backupStores.length && <div style={{ padding: 16 }}><Notice kind="warn">Aucun stockage n&apos;accepte les sauvegardes. Active le contenu « VZDump backup » sur un stockage.</Notice></div>}
        <DataTable
          rows={list.data}
          loading={list.loading}
          rowKey={(b) => b.volid}
          initialSort={{ id: "date", dir: "desc" }}
          filter={false}
          empty="Aucune sauvegarde de cette machine."
          columns={[
            { id: "date", header: "Date", sort: (b) => b.ctime, cell: (b) => <>{date(b.ctime, true)}{b.protected ? <span className="tag" style={{ marginLeft: 6 }} title="Protégée contre la suppression">protégée</span> : null}</>, className: "nowrap" },
            { id: "storage", header: "Stockage", sort: (b) => b.storage, cell: (b) => <span className="muted">{b.storage}{b.storageType === "pbs" ? " (PBS)" : ""}</span> },
            { id: "size", header: "Taille", sort: (b) => b.size, cell: (b) => bytes(b.size), className: "num" },
            { id: "notes", header: "Notes", cell: (b) => <span className="small">{b.notes}</span> },
            { id: "verif", header: "Vérification", cell: (b) => (b.verification ? <span className={`badge ${b.verification.state === "ok" ? "on" : "err"}`}>{b.verification.state === "ok" ? "OK" : "échec"}</span> : <span className="muted small">-</span>) },
          ]}
          actions={(b) => (
            <span className="btn-group">
              <Button size="sm" onClick={() => setRestore(b)}>Restaurer</Button>
              {b.storageType === "pbs" && <Button size="sm" onClick={() => setFiles(b)}>Fichiers</Button>}
              <Button size="sm" onClick={() => setNotes(b)}>Notes</Button>
              <Button size="sm" onClick={() => protect(b)}>{b.protected ? "Déprotéger" : "Protéger"}</Button>
              <Button size="sm" variant="danger" icon={<I.trash />} aria-label="Supprimer" disabled={!!b.protected} title={b.protected ? "Retire d'abord la protection" : undefined} onClick={() => setDel(b)} />
            </span>
          )}
        />
      </Panel>

      {now && <BackupNow ctx={ctx} onClose={() => setNow(false)} onDone={list.refresh} />}
      {restore && <RestoreDialog ctx={ctx} b={restore} onClose={() => setRestore(null)} onRestored={(vmid) => { if (vmid !== ctx.vmid) navigate(`/machines/${ctx.node}/${ctx.type}/${vmid}`); else ctx.refresh(); }} />}
      {files && <FileRestore node={ctx.node} b={files} onClose={() => setFiles(null)} />}
      {notes && (
        <Modal title="Notes de la sauvegarde" onClose={() => setNotes(null)}>
          <Form
            fields={[{ name: "notes", label: "Notes", type: "textarea", rows: 4, full: true }]}
            initial={{ notes: notes.notes ?? "" }}
            onCancel={() => setNotes(null)}
            onSubmit={async (_c, raw) => {
              await pve.put(content(notes), { notes: raw.notes ?? "" });
              toast("Notes enregistrées", "ok");
              setNotes(null);
              list.refresh();
            }}
          />
        </Modal>
      )}
      {del && (
        <Confirm title="Supprimer cette sauvegarde ?" danger confirmLabel="Supprimer" onConfirm={async () => {
          try {
            const upid = await pve.del(content(del));
            if (typeof upid === "string" && upid.startsWith("UPID")) watch(ctx.node, upid, "Suppression", list.refresh); else list.refresh();
          } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setDel(null)}>
          <p className="mono small">{del.volid}</p>
          <p>Elle est effacée du stockage. Ça ne se défait pas.</p>
        </Confirm>
      )}
    </div>
  );
}

function BackupNow({ ctx, onClose, onDone }: { ctx: GuestCtx; onClose: () => void; onDone: () => void }) {
  const { watch } = useToast();
  const fields: FieldDef[] = [
    { name: "storage", label: "Stockage de destination", type: "api-select", required: true, load: storagesFor(ctx.node, "backup") },
    { name: "mode", label: "Mode", type: "select", default: "snapshot", options: [
      { value: "snapshot", label: "Snapshot : la machine reste allumée" }, { value: "suspend", label: "Suspension : courte pause" }, { value: "stop", label: "Arrêt : le plus fiable, coupe le service" },
    ] },
    { name: "compress", label: "Compression", type: "select", default: "zstd", options: [{ value: "zstd", label: "ZSTD (rapide et efficace)" }, { value: "gzip", label: "GZIP" }, { value: "lzo", label: "LZO (le plus rapide)" }, { value: "0", label: "Aucune" }], help: "Ignorée sur Proxmox Backup Server, qui compresse lui-même." },
    { name: "notes-template", label: "Notes", default: "{{guestname}}", help: "Variables : {{guestname}}, {{vmid}}, {{node}}, {{cluster}}." },
    { name: "protected", label: "Protéger cette sauvegarde (jamais supprimée par la rétention)", type: "checkbox" },
    { name: "remove", label: "Supprimer les anciennes sauvegardes de cette machine", type: "checkbox" },
    { name: "keep", label: "En garder", type: "number", unit: "dernières", min: 1, default: 3, show: (v) => !!v.remove },
    { name: "bwlimit", label: "Limite de débit", type: "number", unit: "Kio/s", advanced: true },
  ];
  return (
    <Modal title={`Sauvegarder ${ctx.name} maintenant`} onClose={onClose}>
      <Form
        fields={fields}
        submitLabel="Lancer la sauvegarde"
        onCancel={onClose}
        onSubmit={async (_c, v) => {
          const upid = await pve.post<string>(`/nodes/${ctx.node}/vzdump`, {
            vmid: ctx.vmid, storage: v.storage, mode: v.mode, compress: v.compress, "notes-template": v["notes-template"] || undefined,
            protected: v.protected ? 1 : undefined, remove: v.remove ? 1 : 0, "prune-backups": v.remove ? `keep-last=${v.keep}` : undefined, bwlimit: v.bwlimit || undefined,
          });
          watch(ctx.node, upid, `Sauvegarde de ${ctx.name}`, onDone);
          onClose();
        }}
      />
    </Modal>
  );
}

function RestoreDialog({ ctx, b, onClose, onRestored }: { ctx: GuestCtx; b: Backup; onClose: () => void; onRestored: (vmid: number) => void }) {
  const { watch } = useToast();
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const fields: FieldDef[] = [
    { name: "target", label: "Restaurer vers", type: "select", default: "new", options: [{ value: "new", label: "Une nouvelle machine (la machine actuelle ne change pas)" }, { value: "same", label: `Cette machine (${ctx.vmid}), qui sera remplacée` }] },
    { name: "vmid", label: "Nouvel ID", type: "api-select", show: (v) => v.target === "new", load: async () => { const id = await pve.get<string>("/cluster/nextid"); return [{ value: String(id), label: `${id} (premier libre)` }]; } },
    { name: "storage", label: "Stockage des disques", type: "api-select", allowEmpty: "Celui d'origine", load: storagesFor(ctx.node, ctx.type === "qemu" ? "images" : "rootdir") },
    { name: "start", label: "Démarrer après la restauration", type: "checkbox" },
    { name: "unique", label: "Nouvelle adresse MAC (évite un conflit avec l'original)", type: "checkbox", default: true, show: (v) => v.target === "new" },
    { name: "bwlimit", label: "Limite de débit", type: "number", unit: "Kio/s", advanced: true },
  ];
  const run = async (v: Record<string, unknown>) => {
    const same = v.target === "same";
    const vmid = same ? ctx.vmid : Number(v.vmid);
    const params: Record<string, unknown> = { vmid, storage: v.storage || undefined, start: v.start ? 1 : 0, unique: !same && v.unique ? 1 : undefined, bwlimit: v.bwlimit || undefined, force: same ? 1 : undefined };
    if (ctx.type === "qemu") params.archive = b.volid;
    else Object.assign(params, { ostemplate: b.volid, restore: 1 });
    const upid = await pve.post<string>(`/nodes/${ctx.node}/${ctx.type}`, params);
    watch(ctx.node, upid, `Restauration vers ${vmid}`, () => onRestored(vmid));
  };
  return (
    <>
      <Modal title="Restaurer la sauvegarde" onClose={onClose}>
        <div className="stack">
          <p className="mono small" style={{ margin: 0 }}>{b.volid}</p>
          <Form
            fields={fields}
            submitLabel="Restaurer"
            onCancel={onClose}
            onSubmit={async (_c, v) => {
              if (v.target === "same") {
                if (ctx.running) throw new Error("Éteins d'abord la machine : on ne peut pas la remplacer pendant qu'elle tourne.");
                setValues(v);
                return;
              }
              await run(v);
              onClose();
            }}
          />
        </div>
      </Modal>
      {values && (
        <Confirm title={`Remplacer ${ctx.name} par la sauvegarde ?`} danger requireText={String(ctx.vmid)} confirmLabel="Écraser et restaurer"
          onConfirm={async () => { await run(values); onClose(); }} onClose={() => setValues(null)}>
          <p>La machine actuelle et tous ses disques sont <strong>entièrement remplacés</strong> par la sauvegarde du {date(b.ctime, true)}.</p>
        </Confirm>
      )}
    </>
  );
}

// ── Restauration de fichiers isolés (Proxmox Backup Server) ───────
interface Entry { filepath: string; text: string; type: string; leaf: number; size?: number; mtime?: number }

export function FileRestore({ node, b, onClose }: { node: string; b: { volid: string; storage: string; ctime: number }; onClose: () => void }) {
  const ctx = { node };
  const [path, setPath] = useState<Entry[]>([]);
  const cur = path.at(-1)?.filepath ?? "/";
  const list = usePoll(() => pve.get<Entry[]>(`/nodes/${ctx.node}/storage/${b.storage}/file-restore/list`, { volume: b.volid, filepath: cur }), 0, [cur]);
  const download = async (e: Entry) => {
    const q = new URLSearchParams({ volume: b.volid, filepath: e.filepath, tar: e.leaf ? "0" : "1" });
    // api: GET /nodes/{node}/storage/{storage}/file-restore/download
    const p = `/nodes/${ctx.node}/storage/${b.storage}/file-restore/download`;
    if (DEMO) {
      const text = await pve.get<string>(p, Object.fromEntries(q));
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: e.leaf ? e.text : `${e.text}.tar.zst` });
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    window.location.href = `/api/pve-raw${p}?${q}`;
  };
  return (
    <Modal title="Restaurer des fichiers" wide onClose={onClose} foot={<Button onClick={onClose}>Fermer</Button>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Parcours la sauvegarde du {date(b.ctime, true)} et télécharge un fichier, ou un dossier entier en archive. La machine n&apos;est pas touchée.</p>
        <div className="crumbs">
          <button type="button" className="link-btn" onClick={() => setPath([])}>{b.volid.split("/").slice(-2).join("/")}</button>
          {path.map((e, i) => <span key={e.filepath}> / <button type="button" className="link-btn" onClick={() => setPath(path.slice(0, i + 1))}>{e.text}</button></span>)}
        </div>
        {list.error && <Notice kind="error">{list.error}. Le stockage PBS doit être joignable et la restauration de fichiers activée.</Notice>}
        <table className="table">
          <thead><tr><th>Nom</th><th className="num">Taille</th><th>Modifié</th><th className="actions" /></tr></thead>
          <tbody>
            {(list.data ?? []).map((e) => (
              <tr key={e.filepath}>
                <td>{e.leaf ? <span className="mono">{e.text}</span> : <button type="button" className="link-btn mono" onClick={() => setPath([...path, e])}>{e.text}/</button>}</td>
                <td className="num small">{e.size ? bytes(e.size) : ""}</td>
                <td className="small muted">{e.mtime ? date(e.mtime) : ""}</td>
                <td className="actions"><Button size="sm" icon={<I.download />} onClick={() => download(e)}>{e.leaf ? "Télécharger" : "Archive"}</Button></td>
              </tr>
            ))}
            {list.loading && <tr><td colSpan={4} className="muted">Chargement…</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

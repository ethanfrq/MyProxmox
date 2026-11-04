// Contenu d'un stockage : ISO, modèles, snippets, sauvegardes (notes, protection, restauration,
// fichiers PBS, suppression groupée, rétention simulée), et disques orphelins.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Confirm, Modal, Notice, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form } from "../../components/Form";
import { I } from "../../components/icons";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { bytes, date } from "../../../../shared/format";
import { FileRestore } from "../machine/Backups";

const fileName = (volid: string) => volid.split(/[:/]/).pop();

export function StorageFiles({ node, st, kind }: { node: string; st: any; kind: "iso" | "vztmpl" | "snippets" | "import" }) {
  const { toast, watch } = useToast();
  const { allowed } = usePermission(`/storage/${st.storage}`, "Datastore.Allocate");
  const list = usePoll(() => pve.get<any[]>(`/nodes/${node}/storage/${st.storage}/content`, { content: kind }), 0, [node, st.storage, kind]);
  const [del, setDel] = useState<any[] | null>(null);
  const remove = async (items: any[]) => {
    for (const c of items) {
      try {
        const upid = await pve.del(`/nodes/${node}/storage/${st.storage}/content/${encodeURIComponent(c.volid)}`);
        if (typeof upid === "string" && upid.startsWith("UPID")) watch(node, upid, `Suppression de ${fileName(c.volid)}`, list.refresh);
      } catch (e) { toast(`${fileName(c.volid)} : ${(e as Error).message}`, "error"); }
    }
    list.refresh();
  };
  return (
    <Panel pad={false} title={{ iso: "Images ISO", vztmpl: "Modèles de conteneurs", snippets: "Snippets", import: "Fichiers à importer" }[kind]} right={<Button size="sm" icon={<I.refresh />} onClick={list.refresh}>Actualiser</Button>}>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(c) => c.volid}
        rowLabel={(c) => String(fileName(c.volid))}
        initialSort={{ id: "name", dir: "asc" }}
        empty="Rien ici. Ajoute des fichiers depuis l'onglet « Ajouter »."
        columns={[
          { id: "name", header: "Fichier", sort: (c) => String(fileName(c.volid)), cell: (c) => <span className="mono small">{fileName(c.volid)}</span> },
          { id: "date", header: "Date", sort: (c) => c.ctime ?? 0, cell: (c) => <span className="small muted">{date(c.ctime, true)}</span> },
          { id: "size", header: "Taille", sort: (c) => c.size, cell: (c) => bytes(c.size), className: "num" },
        ]}
        bulk={(sel, clear) => <Button size="sm" variant="danger" disabled={!allowed} onClick={() => { setDel(sel); clear(); }}>Supprimer</Button>}
        actions={(c) => <Button size="sm" variant="danger" icon={<I.trash />} aria-label={`Supprimer ${fileName(c.volid)}`} disabled={!allowed} onClick={() => setDel([c])} />}
      />
      {del && (
        <Confirm title={del.length > 1 ? `Supprimer ${del.length} fichiers ?` : `Supprimer ${fileName(del[0].volid)} ?`} danger confirmLabel="Supprimer" onConfirm={() => remove(del)} onClose={() => setDel(null)}>
          <p className="mono small">{del.map((c) => fileName(c.volid)).join(", ")}</p>
          <p>Les machines qui ont ce fichier dans leur lecteur ne pourront plus démarrer tant qu&apos;il n&apos;est pas retiré.</p>
        </Confirm>
      )}
    </Panel>
  );
}

// ── Sauvegardes ───────────────────────────────────────────────────
export function StorageBackups({ node, st }: { node: string; st: any }) {
  const { toast, watch } = useToast();
  const navigate = useNavigate();
  const { allowed } = usePermission(`/storage/${st.storage}`, "Datastore.Allocate");
  const list = usePoll(() => pve.get<any[]>(`/nodes/${node}/storage/${st.storage}/content`, { content: "backup" }), 0, [node, st.storage]);
  const guests = usePoll(() => pve.get<any[]>("/cluster/resources", { type: "vm" }), 0);
  const [notes, setNotes] = useState<any | null>(null);
  const [del, setDel] = useState<any[] | null>(null);
  const [restore, setRestore] = useState<any | null>(null);
  const [files, setFiles] = useState<any | null>(null);
  const [prune, setPrune] = useState<{ params: Record<string, number | string>; result?: any[] } | null>(null);
  const nameOf = (vmid: number) => (guests.data ?? []).find((g) => g.vmid === Number(vmid))?.name;
  const typeOf = (volid: string) => (/vzdump-qemu|\/vm\//.test(volid) ? "qemu" : "lxc");

  const remove = async (items: any[]) => {
    for (const c of items) {
      try {
        const upid = await pve.del(`/nodes/${node}/storage/${st.storage}/content/${encodeURIComponent(c.volid)}`);
        if (typeof upid === "string" && upid.startsWith("UPID")) watch(node, upid, "Suppression de sauvegarde");
      } catch (e) { toast(`${(e as Error).message}`, "error"); }
    }
    setTimeout(list.refresh, 600);
  };

  return (
    <Panel pad={false} title="Sauvegardes" right={
      <span className="row">
        <Button size="sm" disabled={!allowed} onClick={() => setPrune({ params: { "keep-last": 3, "keep-daily": 7, "keep-weekly": 4, "keep-monthly": 3 } })}>Appliquer une rétention</Button>
        <Button size="sm" icon={<I.refresh />} onClick={list.refresh}>Actualiser</Button>
      </span>
    }>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(c) => c.volid}
        rowLabel={(c) => `${c.vmid} du ${date(c.ctime)}`}
        initialSort={{ id: "date", dir: "desc" }}
        filter="ID, nom ou notes"
        empty="Aucune sauvegarde sur ce stockage."
        columns={[
          { id: "vmid", header: "Machine", sort: (c) => Number(c.vmid), text: (c) => `${c.vmid} ${nameOf(c.vmid) ?? ""} ${c.notes ?? ""}`, cell: (c) => <><strong>{c.vmid}</strong> <span className="muted">{nameOf(c.vmid) ?? "(supprimée)"}</span></> },
          { id: "date", header: "Date", sort: (c) => c.ctime, cell: (c) => <span className="nowrap">{date(c.ctime, true)}{c.protected ? <span className="tag" style={{ marginLeft: 6 }}>protégée</span> : null}</span> },
          { id: "size", header: "Taille", sort: (c) => c.size, cell: (c) => bytes(c.size), className: "num" },
          { id: "notes", header: "Notes", cell: (c) => <span className="small">{c.notes}</span> },
          { id: "verif", header: "Vérif.", cell: (c) => (c.verification ? <span className={`badge ${c.verification.state === "ok" ? "on" : "err"}`}>{c.verification.state === "ok" ? "OK" : "échec"}</span> : "") },
        ]}
        bulk={(sel, clear) => {
          const prot = sel.filter((c) => c.protected).length;
          return <Button size="sm" variant="danger" disabled={!allowed || prot === sel.length} title={prot ? `${prot} protégée(s) seront ignorées` : undefined} onClick={() => { setDel(sel.filter((c) => !c.protected)); clear(); }}>Supprimer</Button>;
        }}
        actions={(c) => (
          <span className="btn-group">
            <Button size="sm" onClick={() => setRestore(c)}>Restaurer</Button>
            {st.type === "pbs" && <Button size="sm" onClick={() => setFiles(c)}>Fichiers</Button>}
            <Button size="sm" disabled={!allowed} onClick={() => setNotes(c)}>Notes</Button>
            <Button size="sm" disabled={!allowed} onClick={async () => { try { await pve.put(`/nodes/${node}/storage/${st.storage}/content/${encodeURIComponent(c.volid)}`, { protected: c.protected ? 0 : 1 }); list.refresh(); } catch (e) { toast((e as Error).message, "error"); } }}>{c.protected ? "Déprotéger" : "Protéger"}</Button>
            <Button size="sm" variant="danger" icon={<I.trash />} aria-label="Supprimer" disabled={!allowed || !!c.protected} onClick={() => setDel([c])} />
          </span>
        )}
      />
      {notes && (
        <Modal title="Notes de la sauvegarde" onClose={() => setNotes(null)}>
          <Form fields={[{ name: "notes", label: "Notes", type: "textarea", rows: 4, full: true }]} initial={{ notes: notes.notes ?? "" }} onCancel={() => setNotes(null)} onSubmit={async (_c, raw) => { await pve.put(`/nodes/${node}/storage/${st.storage}/content/${encodeURIComponent(notes.volid)}`, { notes: raw.notes ?? "" }); setNotes(null); list.refresh(); }} />
        </Modal>
      )}
      {del && (
        <Confirm title={`Supprimer ${del.length} sauvegarde(s) ?`} danger requireText={del.length > 3 ? String(del.length) : undefined} confirmLabel="Supprimer" onConfirm={() => remove(del)} onClose={() => setDel(null)}>
          <p>Elles sont effacées du stockage. Ça ne se défait pas.</p>
          <p className="small mono">{del.slice(0, 8).map((c) => `${c.vmid} ${date(c.ctime)}`).join(" · ")}{del.length > 8 ? " …" : ""}</p>
        </Confirm>
      )}
      {files && <FileRestore node={node} b={{ ...files, storage: st.storage }} onClose={() => setFiles(null)} />}
      {restore && (
        <Modal title="Restaurer la sauvegarde" onClose={() => setRestore(null)}>
          <div className="stack">
            <p className="mono small" style={{ margin: 0 }}>{restore.volid}</p>
            {nameOf(restore.vmid) && <Notice>La machine {restore.vmid} existe encore : par défaut, la restauration crée une nouvelle machine à côté. Pour l&apos;écraser, passe par sa fiche, onglet Sauvegardes.</Notice>}
            <Form
              fields={[
                { name: "vmid", label: "ID de la machine restaurée", type: "api-select", required: true, load: async () => { const id = await pve.get<string>("/cluster/nextid"); const opts = [{ value: String(id), label: `${id} (premier libre)` }]; if (!nameOf(restore.vmid)) opts.unshift({ value: String(restore.vmid), label: `${restore.vmid} (son ID d'origine)` }); return opts; } },
                { name: "target", label: "Nœud", type: "api-select", default: node, load: async () => (await pve.get<any[]>("/nodes")).map((n) => ({ value: n.node, label: n.node })) },
                { name: "storage", label: "Stockage des disques", type: "api-select", allowEmpty: "Celui d'origine", loadDeps: ["target"], load: async (v) => (await pve.get<any[]>(`/nodes/${v.target || node}/storage`, { content: typeOf(restore.volid) === "qemu" ? "images" : "rootdir" })).map((s) => ({ value: s.storage, label: s.storage })) },
                { name: "unique", label: "Nouvelle adresse MAC", type: "checkbox", default: true },
                { name: "start", label: "Démarrer après la restauration", type: "checkbox" },
              ]}
              submitLabel="Restaurer"
              onCancel={() => setRestore(null)}
              onSubmit={async (_c, v) => {
                const t = typeOf(restore.volid);
                const target = String(v.target || node);
                const params: Record<string, unknown> = { vmid: v.vmid, storage: v.storage || undefined, unique: v.unique ? 1 : 0, start: v.start ? 1 : 0 };
                if (t === "qemu") params.archive = restore.volid; else Object.assign(params, { ostemplate: restore.volid, restore: 1 });
                const upid = t === "qemu" ? await pve.post<string>(`/nodes/${target}/qemu`, params) : await pve.post<string>(`/nodes/${target}/lxc`, params);
                watch(target, upid, `Restauration vers ${v.vmid}`, () => navigate(`/machines/${target}/${t}/${v.vmid}`));
                setRestore(null);
              }}
            />
          </div>
        </Modal>
      )}
      {prune && (
        <Modal title="Rétention : simuler puis appliquer" wide onClose={() => setPrune(null)}>
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>Choisis combien de sauvegardes garder par machine. La simulation montre ce qui serait supprimé ; rien n&apos;est effacé avant ta confirmation. Les sauvegardes protégées sont toujours gardées.</p>
            <Form
              fields={[
                { name: "keep-last", label: "Garder les dernières", type: "number", min: 0 },
                { name: "keep-daily", label: "Une par jour pendant", type: "number", unit: "jours", min: 0 },
                { name: "keep-weekly", label: "Une par semaine pendant", type: "number", unit: "semaines", min: 0 },
                { name: "keep-monthly", label: "Une par mois pendant", type: "number", unit: "mois", min: 0 },
                { name: "keep-yearly", label: "Une par an pendant", type: "number", unit: "ans", min: 0 },
                { name: "vmid", label: "Seulement la machine", type: "number", min: 100, help: "Vide : toutes les machines." },
              ]}
              initial={prune.params}
              submitLabel="Simuler"
              onSubmit={async (clean) => setPrune({ params: clean as Record<string, number>, result: await pve.get<any[]>(`/nodes/${node}/storage/${st.storage}/prunebackups`, clean as Record<string, number>) })}
            />
            {prune.result && (() => {
              const rm = prune.result.filter((r) => r.mark === "remove");
              return (
                <>
                  <div className="row"><strong>{prune.result.filter((r) => r.mark !== "remove").length} gardée(s)</strong><span className={rm.length ? "health-bad" : "muted"}>{rm.length} à supprimer</span></div>
                  <div className="table-wrap" style={{ maxHeight: 300, overflow: "auto" }}>
                    <table className="table">
                      <thead><tr><th>Machine</th><th>Date</th><th>Résultat</th></tr></thead>
                      <tbody>{[...prune.result].sort((a, b) => a.vmid - b.vmid || b.ctime - a.ctime).map((r) => <tr key={r.volid}><td>{r.vmid} <span className="muted">{nameOf(r.vmid)}</span></td><td className="small">{date(r.ctime, true)}</td><td>{r.mark === "remove" ? <span className="badge err">supprimée</span> : r.mark === "protected" ? <span className="badge warn">protégée</span> : <span className="badge on">gardée</span>}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <Button variant="danger" disabled={!rm.length} onClick={async () => {
                      try {
                        const upid = await pve.del<string>(`/nodes/${node}/storage/${st.storage}/prunebackups`, prune.params as Record<string, number>);
                        watch(node, upid, "Rétention appliquée", list.refresh);
                        setPrune(null);
                      } catch (e) { toast((e as Error).message, "error"); }
                    }}>Supprimer ces {rm.length} sauvegarde(s)</Button>
                  </div>
                </>
              );
            })()}
          </div>
        </Modal>
      )}
    </Panel>
  );
}

// ── Disques orphelins ─────────────────────────────────────────────
export function StorageOrphans({ node, st }: { node: string; st: any }) {
  const { toast, watch } = useToast();
  const { allowed } = usePermission(`/storage/${st.storage}`, "Datastore.Allocate");
  const data = usePoll(async () => {
    const [vols, guests] = await Promise.all([
      Promise.all(["images", "rootdir"].filter((c) => String(st.content).includes(c)).map((c) => pve.get<any[]>(`/nodes/${node}/storage/${st.storage}/content`, { content: c }))).then((l) => l.flat()),
      pve.get<any[]>("/cluster/resources", { type: "vm" }),
    ]);
    const configs = new Map<number, string>();
    const out: any[] = [];
    for (const v of vols) {
      const g = guests.find((x) => x.vmid === Number(v.vmid));
      if (!g) { out.push({ ...v, reason: `La machine ${v.vmid} n'existe plus` }); continue; }
      if (!configs.has(g.vmid)) configs.set(g.vmid, JSON.stringify(await pve.get(`/nodes/${g.node}/${g.type}/${g.vmid}/config`).catch(() => ({}))));
      const name = String(v.volid).split(":").pop()!.split("/").pop()!;
      if (!configs.get(g.vmid)!.includes(name)) out.push({ ...v, reason: `Absent de la configuration de ${g.vmid} (${g.name})` });
    }
    return out;
  }, 0, [node, st.storage]);
  const [del, setDel] = useState<any | null>(null);
  return (
    <Panel pad={false} title="Disques orphelins">
      <div style={{ padding: "12px 16px 0" }}>
        <p className="small muted" style={{ margin: 0 }}>Des disques qui occupent de la place mais qu&apos;aucune machine n&apos;utilise : restes d&apos;une machine supprimée, ou disque retiré de la configuration sans être effacé. Vérifie bien avant de supprimer.</p>
      </div>
      <DataTable rows={data.data} loading={data.loading} error={data.error} rowKey={(v) => v.volid} filter={false} empty="Aucun disque orphelin sur ce stockage." columns={[
        { id: "vol", header: "Volume", cell: (v) => <span className="mono small">{v.volid}</span> },
        { id: "size", header: "Taille", sort: (v) => v.size, cell: (v) => bytes(v.size), className: "num" },
        { id: "reason", header: "Pourquoi", cell: (v) => <span className="small">{v.reason}</span> },
      ]} actions={(v) => <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(v)}>Supprimer</Button>} />
      {del && (
        <Confirm title="Supprimer ce disque orphelin ?" danger requireText={String(del.volid).split(":").pop()} confirmLabel="Supprimer le disque" onConfirm={async () => {
          try { const upid = await pve.del(`/nodes/${node}/storage/${st.storage}/content/${encodeURIComponent(del.volid)}`); if (typeof upid === "string" && upid.startsWith("UPID")) watch(node, upid, "Suppression du disque", data.refresh); else data.refresh(); } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setDel(null)}>
          <p className="mono small">{del.volid} · {bytes(del.size)}</p>
          <p>{del.reason}. Ses données sont effacées. <strong>Ça ne se défait pas.</strong></p>
        </Confirm>
      )}
    </Panel>
  );
}

// Onglet « Snapshots » : arbre parent/enfant comme dans Proxmox, avec la RAM,
// le retour en arrière, la suppression et l'édition de la description.
import { useState, type ReactNode } from "react";
import { Button, Confirm, Empty, Modal, Panel, useToast } from "../../components/ui";
import { Form } from "../../components/Form";
import { I } from "../../components/icons";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { date } from "../../../../shared/format";
import type { GuestCtx } from "./common";

interface Snap { name: string; description?: string; snaptime?: number; parent?: string; vmstate?: number; running?: number }

export function Snapshots({ ctx }: { ctx: GuestCtx }) {
  const { watch, toast } = useToast();
  const list = usePoll(() => pve.get<Snap[]>(`${ctx.base}/snapshot`), 0, [ctx.base]);
  const canSnap = usePermission(`/vms/${ctx.vmid}`, "VM.Snapshot").allowed;
  const canRollback = usePermission(`/vms/${ctx.vmid}`, "VM.Snapshot.Rollback").allowed;
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Snap | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "rollback" | "delete"; snap: Snap } | null>(null);
  const [startAfter, setStartAfter] = useState(false);
  const snaps = list.data ?? [];
  const byParent = new Map<string, Snap[]>();
  for (const s of snaps) {
    const k = s.parent ?? "";
    byParent.set(k, [...(byParent.get(k) ?? []), s]);
  }
  for (const l of byParent.values()) l.sort((a, b) => (a.name === "current" ? 1 : b.name === "current" ? -1 : (a.snaptime ?? 0) - (b.snaptime ?? 0)));

  const rows: ReactNode[] = [];
  const walk = (parent: string, depth: number) => {
    for (const s of byParent.get(parent) ?? []) {
      const cur = s.name === "current";
      rows.push(
        <tr key={s.name} className={cur ? "snap-current" : ""}>
          <td>
            <span className="snap-name" style={{ paddingLeft: depth * 22 }}>
              {depth > 0 && <span className="snap-branch" aria-hidden>└</span>}
              {cur ? <strong>Maintenant</strong> : <strong className="mono">{s.name}</strong>}
            </span>
          </td>
          <td className="small muted nowrap">{cur ? (s.running ? "en marche" : "arrêtée") : date(s.snaptime, true)}</td>
          <td className="small">{s.vmstate ? <span className="tag">RAM</span> : ""}</td>
          <td className="small">{cur ? <span className="muted">État actuel de la machine</span> : s.description}</td>
          <td className="actions">
            {!cur && (
              <span className="btn-group">
                <Button size="sm" disabled={!canRollback} title={canRollback ? undefined : "Il te manque le droit VM.Snapshot.Rollback"} onClick={() => { setStartAfter(false); setConfirm({ kind: "rollback", snap: s }); }}>Revenir ici</Button>
                <Button size="sm" disabled={!canSnap} onClick={() => setEdit(s)}>Description</Button>
                <Button size="sm" variant="danger" icon={<I.trash />} aria-label={`Supprimer ${s.name}`} disabled={!canSnap} onClick={() => setConfirm({ kind: "delete", snap: s })} />
              </span>
            )}
          </td>
        </tr>,
      );
      walk(s.name, depth + 1);
    }
  };
  walk("", 0);

  return (
    <Panel pad={false} title="Snapshots" right={<Button variant="primary" size="sm" icon={<I.camera />} disabled={!canSnap} title={canSnap ? undefined : "Il te manque le droit VM.Snapshot"} onClick={() => setCreating(true)}>Prendre un snapshot</Button>}>
      {snaps.length > 1 ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nom</th><th>Date</th><th>RAM</th><th>Description</th><th className="actions" /></tr></thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : <Empty>{list.loading ? "Chargement…" : "Aucun snapshot. Un snapshot est une photo instantanée de la machine : pratique avant une mise à jour risquée."}</Empty>}

      {creating && (
        <Modal title="Nouveau snapshot" onClose={() => setCreating(false)}>
          <Form
            fields={[
              { name: "snapname", label: "Nom", required: true, placeholder: "avant-maj", help: "Lettres, chiffres, - et _ ; commence par une lettre.", validate: (v) => (/^[a-zA-Z][\w-]*$/.test(String(v)) ? null : "Lettres, chiffres, - et _, en commençant par une lettre.") },
              { name: "description", label: "Description", type: "textarea", rows: 3 },
              ...(ctx.type === "qemu" && ctx.running ? [{ name: "vmstate", label: "Inclure la mémoire vive (plus lent, reprend l'état exact)", type: "checkbox" as const }] : []),
            ]}
            submitLabel="Prendre le snapshot"
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              const upid = await pve.post<string>(`${ctx.base}/snapshot`, v);
              watch(ctx.node, upid, `Snapshot ${v.snapname}`, list.refresh);
              setCreating(false);
              setTimeout(list.refresh, 800);
            }}
          />
        </Modal>
      )}
      {edit && (
        <Modal title={`Description de ${edit.name}`} onClose={() => setEdit(null)}>
          <Form
            fields={[{ name: "description", label: "Description", type: "textarea", rows: 4, full: true }]}
            initial={{ description: edit.description ?? "" }}
            onCancel={() => setEdit(null)}
            onSubmit={async (_c, raw) => {
              await pve.put(`${ctx.base}/snapshot/${encodeURIComponent(edit.name)}/config`, { description: raw.description ?? "" });
              toast("Description enregistrée", "ok");
              setEdit(null);
              list.refresh();
            }}
          />
        </Modal>
      )}
      {confirm && (
        <Confirm
          title={confirm.kind === "rollback" ? `Revenir au snapshot « ${confirm.snap.name} » ?` : `Supprimer le snapshot « ${confirm.snap.name} » ?`}
          danger
          confirmLabel={confirm.kind === "rollback" ? "Revenir à ce snapshot" : "Supprimer"}
          onConfirm={async () => {
            try {
              const name = encodeURIComponent(confirm.snap.name);
              const upid = confirm.kind === "rollback"
                ? await pve.post<string>(`${ctx.base}/snapshot/${name}/rollback`, ctx.type === "qemu" && startAfter ? { start: 1 } : {})
                : await pve.del<string>(`${ctx.base}/snapshot/${name}`);
              watch(ctx.node, upid, undefined, () => { list.refresh(); ctx.refresh(); });
            } catch (e) { toast(`${(e as Error).message}. Vérifie que la machine n'est pas verrouillée.`, "error"); }
          }}
          onClose={() => setConfirm(null)}
        >
          {confirm.kind === "rollback" ? (
            <>
              <p>Tout ce qui a changé depuis ce snapshot sera perdu : fichiers, configuration{confirm.snap.vmstate ? "" : ", et la machine sera arrêtée"}.</p>
              {ctx.type === "qemu" && !confirm.snap.vmstate && <label className="check"><input type="checkbox" checked={startAfter} onChange={(e) => setStartAfter(e.target.checked)} /> Redémarrer la machine ensuite</label>}
            </>
          ) : <p>Le snapshot est effacé. Ses snapshots enfants sont rattachés à son parent.</p>}
        </Confirm>
      )}
    </Panel>
  );
}

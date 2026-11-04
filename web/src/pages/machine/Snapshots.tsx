// Onglet « Snapshots ».
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Confirm, Empty, Field, Notice, Panel, useToast } from "../../components/ui";
import { I } from "../../components/icons";
import { api, pve, usePoll } from "../../lib/api";
import { bytes, date } from "../../../../shared/format";

export function Snapshots({ base, node, type }: { base: string; node: string; type: string }) {
  const { watch, toast } = useToast();
  const list = usePoll(() => pve.get<any[]>(`${base}/snapshot`), 0, [base]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [ram, setRam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "rollback" | "delete"; name: string } | null>(null);
  const snaps = (list.data ?? []).filter((s) => s.name !== "current").sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0));

  async function create() {
    setBusy(true);
    try {
      const upid = await pve.post(`${base}/snapshot`, { snapname: name, description: desc, ...(type === "qemu" && ram ? { vmstate: 1 } : {}) });
      watch(node, upid, `Snapshot ${name}`, list.refresh);
      setName("");
      setDesc("");
      setTimeout(list.refresh, 1000);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid g2">
      <Panel title="Snapshots" pad={false}>
        {snaps.length ? (
          <table className="table">
            <thead><tr><th>Nom</th><th>Date</th><th>Description</th><th className="actions" /></tr></thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.name}>
                  <td><strong className="mono">{s.name}</strong></td>
                  <td className="small muted">{date(s.snaptime)}</td>
                  <td className="small">{s.description}</td>
                  <td className="actions">
                    <span className="btn-group">
                      <Button size="sm" onClick={() => setConfirm({ kind: "rollback", name: s.name })}>Restaurer</Button>
                      <Button size="sm" variant="danger" icon={<I.trash />} onClick={() => setConfirm({ kind: "delete", name: s.name })} aria-label="Supprimer" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{list.loading ? "Chargement…" : "Aucun snapshot."}</Empty>}
      </Panel>
      <Panel title="Nouveau snapshot">
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>Une photo instantanée de la machine. Pratique avant une mise à jour risquée : tu reviens en arrière en un clic.</p>
          <Field label="Nom" help="Lettres, chiffres, - et _ ; commence par une lettre. Ex. avant-maj">
            <input className="input mono" value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, "-"))} />
          </Field>
          <Field label="Description"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          {type === "qemu" && <label className="check"><input type="checkbox" checked={ram} onChange={(e) => setRam(e.target.checked)} /> Inclure la mémoire vive (plus lent, reprend l&apos;état exact)</label>}
          <div><Button variant="primary" icon={<I.camera />} busy={busy} disabled={!/^[a-zA-Z][\w-]*$/.test(name)} onClick={create}>Prendre le snapshot</Button></div>
        </div>
      </Panel>
      {confirm && (
        <Confirm
          title={confirm.kind === "rollback" ? `Revenir au snapshot « ${confirm.name} » ?` : `Supprimer le snapshot « ${confirm.name} » ?`}
          danger
          confirmLabel={confirm.kind === "rollback" ? "Restaurer" : "Supprimer"}
          onConfirm={async () => {
            try {
              const upid = confirm.kind === "rollback"
                ? await pve.post(`${base}/snapshot/${confirm.name}/rollback`)
                : await pve.del(`${base}/snapshot/${confirm.name}`);
              watch(node, upid, undefined, list.refresh);
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setConfirm(null)}
        >
          <p>{confirm.kind === "rollback" ? "Tout ce qui a changé depuis ce snapshot sera perdu." : "Le snapshot sera définitivement effacé."}</p>
        </Confirm>
      )}
    </div>
  );
}


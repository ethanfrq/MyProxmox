// Onglet « Sauvegardes ».
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Confirm, Empty, Field, Notice, Panel, useToast } from "../../components/ui";
import { I } from "../../components/icons";
import { api, pve, usePoll } from "../../lib/api";
import { bytes, date } from "../../../../shared/format";

export function Backups({ node, type, vmid, running }: { node: string; type: string; vmid: number; running: boolean }) {
  const { watch, toast } = useToast();
  const storages = usePoll(() => pve.get<any[]>(`/nodes/${node}/storage`, { content: "backup" }), 0, [node]);
  const backupStores = (storages.data ?? []).filter((s) => String(s.content).includes("backup") && s.active);
  const [store, setStore] = useState("");
  const [mode, setMode] = useState("snapshot");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "restore" | "delete"; volid: string; storage: string } | null>(null);

  useEffect(() => { if (!store && backupStores[0]) setStore(backupStores[0].storage); }, [backupStores, store]);

  const list = usePoll(async () => {
    const all = await Promise.all(backupStores.map((s) =>
      pve.get<any[]>(`/nodes/${node}/storage/${s.storage}/content`, { content: "backup", vmid }).then((l) => l.map((x) => ({ ...x, storage: s.storage }))),
    ));
    return all.flat().sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0));
  }, 0, [backupStores.map((s) => s.storage).join(",")]);

  async function backup() {
    setBusy(true);
    try {
      const upid = await pve.post(`/nodes/${node}/vzdump`, { vmid, storage: store, mode, compress: "zstd" });
      watch(node, upid, "Sauvegarde", list.refresh);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid g2">
      <Panel title="Sauvegardes de cette machine" pad={false} right={<Button size="sm" icon={<I.refresh />} onClick={list.refresh}>Actualiser</Button>}>
        {(list.data ?? []).length ? (
          <table className="table">
            <thead><tr><th>Date</th><th>Stockage</th><th className="num">Taille</th><th className="actions" /></tr></thead>
            <tbody>
              {(list.data ?? []).map((b) => (
                <tr key={b.volid}>
                  <td>{date(b.ctime)}</td>
                  <td className="muted">{b.storage}</td>
                  <td className="num">{bytes(b.size)}</td>
                  <td className="actions">
                    <span className="btn-group">
                      <Button size="sm" onClick={() => setConfirm({ kind: "restore", volid: b.volid, storage: b.storage })}>Restaurer</Button>
                      <Button size="sm" variant="danger" icon={<I.trash />} aria-label="Supprimer" onClick={() => setConfirm({ kind: "delete", volid: b.volid, storage: b.storage })} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{list.loading ? "Chargement…" : "Aucune sauvegarde."}</Empty>}
      </Panel>
      <Panel title="Sauvegarder maintenant">
        {backupStores.length ? (
          <div className="stack">
            <Field label="Stockage de destination">
              <select className="select input" value={store} onChange={(e) => setStore(e.target.value)}>
                {backupStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({bytes(s.avail)} libres)</option>)}
              </select>
            </Field>
            <Field label="Mode" help="Snapshot : la machine reste allumée. Arrêt : la plus fiable, mais coupe le service.">
              <select className="select input" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="snapshot">Snapshot (sans interruption)</option>
                <option value="suspend">Suspension</option>
                <option value="stop">Arrêt</option>
              </select>
            </Field>
            <div><Button variant="primary" icon={<I.download />} busy={busy} onClick={backup}>Lancer la sauvegarde</Button></div>
          </div>
        ) : <Notice kind="warn">Aucun stockage n&apos;accepte les sauvegardes. Active le contenu « VZDump backup » sur un stockage dans Proxmox.</Notice>}
      </Panel>
      {confirm && (
        <Confirm
          title={confirm.kind === "restore" ? "Restaurer cette sauvegarde ?" : "Supprimer cette sauvegarde ?"}
          danger
          requireText={confirm.kind === "restore" ? String(vmid) : undefined}
          confirmLabel={confirm.kind === "restore" ? "Écraser et restaurer" : "Supprimer"}
          onConfirm={async () => {
            try {
              if (confirm.kind === "delete") {
                const upid = await pve.del(`/nodes/${node}/storage/${confirm.storage}/content/${encodeURIComponent(confirm.volid)}`);
                if (typeof upid === "string" && upid.startsWith("UPID")) watch(node, upid, "Suppression", list.refresh); else list.refresh();
              } else {
                if (running) throw new Error("Éteins la machine avant de la restaurer.");
                const upid = type === "qemu"
                  ? await pve.post(`/nodes/${node}/qemu`, { vmid, archive: confirm.volid, force: 1 })
                  : await pve.post(`/nodes/${node}/lxc`, { vmid, ostemplate: confirm.volid, restore: 1, force: 1 });
                watch(node, upid, "Restauration");
              }
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setConfirm(null)}
        >
          <p className="mono small">{confirm.volid}</p>
          {confirm.kind === "restore" && <p>La machine actuelle sera <strong>entièrement remplacée</strong> par cette sauvegarde. Elle doit être éteinte.</p>}
        </Confirm>
      )}
    </div>
  );
}


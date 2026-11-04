import { useState } from "react";
import { Button, Empty, PageHead, Panel, clickable } from "../components/ui";
import { I } from "../components/icons";
import { pve, usePoll } from "../lib/api";
import { date, TASK_LABEL } from "../../../shared/format";

export function Tasks() {
  const tasks = usePoll(() => pve.get<any[]>("/cluster/tasks"), 5000);
  const [sel, setSel] = useState<any | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const list = (tasks.data ?? []).filter((t) => !failedOnly || (t.status && t.status !== "OK"));

  return (
    <>
      <PageHead title="Tâches" sub="Tout ce que Proxmox a exécuté récemment, depuis n'importe quelle interface" />
      <div className="grid" style={{ gridTemplateColumns: sel ? "minmax(0,1.3fr) minmax(0,1fr)" : "1fr" }}>
        <Panel pad={false} title={<span className="btn-group"><Button size="sm" variant={!failedOnly ? "dark" : "default"} onClick={() => setFailedOnly(false)}>Toutes</Button><Button size="sm" variant={failedOnly ? "dark" : "default"} onClick={() => setFailedOnly(true)}>En échec</Button></span>}>
          {list.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Début</th><th>Tâche</th><th>Cible</th><th>Par</th><th>Résultat</th></tr></thead>
                <tbody>
                  {list.map((t) => (
                    <tr key={t.upid} className="clickable" {...clickable(() => setSel(t))} style={sel?.upid === t.upid ? { background: "var(--orange-soft)" } : undefined}>
                      <td className="small muted">{date(t.starttime)}</td>
                      <td>{TASK_LABEL[t.type] ?? t.type}</td>
                      <td className="mono small">{t.id || "-"}</td>
                      <td className="small muted">{t.user}</td>
                      <td>{t.status ? <span className={`badge ${t.status === "OK" ? "on" : "err"}`}>{t.status === "OK" ? "OK" : t.status}</span> : <span className="badge warn">En cours</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>{tasks.loading ? "Chargement…" : "Aucune tâche."}</Empty>}
        </Panel>
        {sel && <TaskLog task={sel} onClose={() => setSel(null)} />}
      </div>
    </>
  );
}

function TaskLog({ task, onClose }: { task: any; onClose: () => void }) {
  const log = usePoll(() => pve.get<any[]>(`/nodes/${task.node}/tasks/${encodeURIComponent(task.upid)}/log`, { limit: 500 }), task.status ? 0 : 2000, [task.upid]);
  return (
    <Panel title={TASK_LABEL[task.type] ?? task.type} right={<Button size="sm" variant="ghost" onClick={onClose}>Fermer</Button>} pad={false}>
      <div className="log">{(log.data ?? []).map((l) => l.t).join("\n") || "…"}</div>
      <div style={{ padding: 12 }} className="small muted mono">{task.upid}</div>
    </Panel>
  );
}

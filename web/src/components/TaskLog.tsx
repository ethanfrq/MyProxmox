// Journal d'une tâche Proxmox (UPID), affiché en direct pendant qu'elle tourne.
// N'importe pas ui.tsx pour éviter un import circulaire (ui.tsx s'en sert pour le toast).
import { useEffect, useRef, useState } from "react";
import { pve } from "../lib/api";
import { TASK_LABEL, date } from "../../../shared/format";

export interface TaskStatus {
  status: "running" | "stopped";
  exitstatus?: string;
  type?: string;
  id?: string;
  starttime?: number;
}

/** Infos lisibles d'un UPID : UPID:nœud:pid:pstart:début:type:id:utilisateur: */
export function parseUpid(upid: string) {
  const p = upid.split(":");
  return { node: p[1] ?? "", type: p[5] ?? "", id: p[6] ?? "", user: p[7] ?? "", start: parseInt(p[4] ?? "0", 16) || 0 };
}

export function taskLabel(upid: string) {
  const u = parseUpid(upid);
  const name = TASK_LABEL[u.type] ?? u.type;
  return u.id ? `${name} ${u.id}` : name;
}

/** Journal en direct. `onDone` est appelé une fois quand la tâche se termine. */
export function TaskLog({ node, upid, onDone, height = 360 }: { node?: string; upid: string; onDone?: (st: TaskStatus) => void; height?: number }) {
  const n = node || parseUpid(upid).node;
  const [lines, setLines] = useState<string[]>([]);
  const [st, setSt] = useState<TaskStatus | null>(null);
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState<"ask" | "busy" | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const id = encodeURIComponent(upid);
        const [log, status] = await Promise.all([
          pve.get<{ n: number; t: string }[]>(`/nodes/${n}/tasks/${id}/log`, { start: 0, limit: 5000 }),
          pve.get<TaskStatus>(`/nodes/${n}/tasks/${id}/status`),
        ]);
        if (stop) return;
        setLines(log.map((l) => l.t));
        setSt(status);
        setError("");
        if (status.status === "stopped") {
          done.current?.(status);
          return;
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) timer = setTimeout(tick, 1200);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [n, upid]);

  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const u = parseUpid(upid);
  const ok = st?.status === "stopped" && st.exitstatus === "OK";
  const failed = st?.status === "stopped" && st.exitstatus !== "OK";
  return (
    <div className="tasklog">
      <div className="tasklog-head">
        <span className={`badge ${!st ? "off" : st.status === "running" ? "warn" : ok ? "on" : "err"}`}>
          {!st ? "Chargement" : st.status === "running" ? "En cours" : ok ? "Terminée" : "Échec"}
        </span>
        <span className="small muted">{u.user} · démarrée le {date(u.start)} · nœud {n}</span>
        {st?.status === "running" && (
          // api: DELETE /nodes/{node}/tasks/{upid}
          <span style={{ marginLeft: "auto" }} className="row">
            {stopping === "ask" && <span className="small">Arrêter la tâche en cours ?</span>}
            <button className={`btn btn-sm${stopping === "ask" ? " btn-danger" : ""}`} disabled={stopping === "busy"} onClick={async () => {
              if (stopping !== "ask") return setStopping("ask");
              setStopping("busy");
              try { await pve.del(`/nodes/${n}/tasks/${encodeURIComponent(upid)}`); } catch (e) { setError((e as Error).message); }
              setStopping(null);
            }}>{stopping === "ask" ? "Oui, arrêter" : "Arrêter la tâche"}</button>
            {stopping === "ask" && <button className="btn btn-sm" onClick={() => setStopping(null)}>Non</button>}
          </span>
        )}
      </div>
      {failed && <div className="notice error">La tâche a échoué : {st?.exitstatus}. Lis la fin du journal pour voir pourquoi.</div>}
      {error && <div className="notice error">Journal illisible : {error}. Vérifie que tu as le droit Sys.Audit sur le nœud.</div>}
      <pre className="log" ref={box} style={{ maxHeight: height, margin: 0 }}>{lines.length ? lines.join("\n") : "…"}</pre>
    </div>
  );
}

/** Fenêtre qui affiche le journal d'une tâche. */
export function TaskLogModal({ upid, node, onClose }: { upid: string; node?: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={`Journal : ${taskLabel(upid)}`}>
        <div className="modal-head"><h2>Journal : {taskLabel(upid)}</h2></div>
        <div className="modal-body"><TaskLog upid={upid} node={node} /></div>
        <div className="modal-foot"><button className="btn" onClick={onClose} autoFocus>Fermer</button></div>
      </div>
    </div>
  );
}

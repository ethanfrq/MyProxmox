// Journal système (syslog et journalctl) avec filtres et suivi en direct, et tâches du nœud.
import { useEffect, useRef, useState } from "react";
import { Panel, Tabs, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { pve, usePoll } from "../../lib/api";
import { TASK_LABEL, date } from "../../../../shared/format";

const SERVICES = ["", "pvedaemon", "pveproxy", "pvestatd", "pve-cluster", "corosync", "pve-firewall", "pvescheduler", "kernel", "sshd", "cron", "postfix"];
const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function NodeJournal({ node }: { node: string }) {
  const [source, setSource] = useState<"journal" | "syslog">("journal");
  const [since, setSince] = useState(toLocal(new Date(Date.now() - 3600 * 1000)));
  const [until, setUntil] = useState("");
  const [service, setService] = useState("");
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLPreElement>(null);
  const fmt = (v: string) => v.replace("T", " ") + ":00";
  const data = usePoll(async () => {
    if (source === "journal") {
      const lines = await pve.get<string[]>(`/nodes/${node}/journal`, { since: Math.floor(Date.parse(since) / 1000), until: until ? Math.floor(Date.parse(until) / 1000) : undefined });
      return lines.filter((l) => !service || l.includes(`${service}[`) || l.includes(` ${service}:`));
    }
    return (await pve.get<{ n: number; t: string }[]>(`/nodes/${node}/syslog`, { since: fmt(since), until: until ? fmt(until) : undefined, service: service || undefined, limit: 5000 })).map((l) => l.t);
  }, follow ? 2000 : 0, [node, source, since, until, service, follow]);
  const lines = (data.data ?? []).filter((l) => !q || l.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, follow]);
  return (
    <Panel title="Journal système" right={
      <label className="check small"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Suivre en direct</label>
    }>
      <div className="stack">
        <div className="filters">
          <label>Source<select className="input select" value={source} onChange={(e) => setSource(e.target.value as typeof source)}><option value="journal">journalctl</option><option value="syslog">syslog</option></select></label>
          <label>Depuis<input className="input" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} /></label>
          <label>Jusqu&apos;à<input className="input" type="datetime-local" value={until} onChange={(e) => { setUntil(e.target.value); if (e.target.value) setFollow(false); }} /></label>
          <label>Service<select className="input select" value={service} onChange={(e) => setService(e.target.value)}>{SERVICES.map((s) => <option key={s} value={s}>{s || "Tous"}</option>)}</select></label>
          <label>Contient<input className="input" value={q} placeholder="error, failed..." onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        {data.error && <div className="notice error">{data.error}. Il faut le droit Sys.Syslog sur le nœud.</div>}
        <pre ref={box} className="log" style={{ maxHeight: 520, margin: 0 }} aria-live="off">{lines.length ? lines.join("\n") : data.loading ? "Chargement…" : "Aucune ligne pour ces filtres."}</pre>
        <span className="small muted">{lines.length} ligne(s)</span>
      </div>
    </Panel>
  );
}

export function NodeTasks({ node }: { node: string }) {
  const { showLog } = useToast();
  const [errors, setErrors] = useState(false);
  const [vmid, setVmid] = useState("");
  const tasks = usePoll(() => pve.get<any[]>(`/nodes/${node}/tasks`, { limit: 500, errors: errors ? 1 : undefined, vmid: vmid || undefined }), 10000, [node, errors, vmid]);
  return (
    <Panel pad={false} title="Tâches du nœud">
      <DataTable
        rows={tasks.data}
        loading={tasks.loading}
        error={tasks.error}
        rowKey={(t) => t.upid}
        initialSort={{ id: "start", dir: "desc" }}
        onRowClick={(t) => showLog(t.upid, node)}
        filter="Type, utilisateur ou ID"
        toolbar={
          <span className="row">
            <label className="check small"><input type="checkbox" checked={errors} onChange={(e) => setErrors(e.target.checked)} /> Seulement les échecs</label>
            <input className="input" style={{ width: 120, height: 30 }} placeholder="ID machine" aria-label="ID machine" value={vmid} onChange={(e) => setVmid(e.target.value.replace(/\D/g, ""))} />
          </span>
        }
        columns={[
          { id: "start", header: "Début", sort: (t) => t.starttime, cell: (t) => date(t.starttime, true), className: "small nowrap" },
          { id: "end", header: "Fin", sort: (t) => t.endtime ?? 0, cell: (t) => (t.endtime ? date(t.endtime) : "en cours"), className: "small nowrap muted" },
          { id: "type", header: "Action", sort: (t) => TASK_LABEL[t.type] ?? t.type, text: (t) => `${TASK_LABEL[t.type] ?? t.type} ${t.type} ${t.id} ${t.user}`, cell: (t) => <>{TASK_LABEL[t.type] ?? t.type} <span className="muted mono small">{t.id}</span></> },
          { id: "user", header: "Par", sort: (t) => t.user, cell: (t) => t.user, className: "small" },
          { id: "status", header: "Résultat", sort: (t) => t.status ?? "", cell: (t) => (!t.status ? <span className="badge warn">en cours</span> : t.status === "OK" ? <span className="badge on">OK</span> : <span className="badge err">{t.status}</span>) },
        ]}
      />
    </Panel>
  );
}

export function NodeLogs({ node }: { node: string }) {
  const [sub, setSub] = useState<"journal" | "taches">("journal");
  return (
    <>
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "journal", label: "Journal système" }, { id: "taches", label: "Tâches" }]} />
      {sub === "journal" ? <NodeJournal node={node} /> : <NodeTasks node={node} />}
    </>
  );
}


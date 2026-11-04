// Réplications dont ce nœud est la source.
import { Button, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { pve, usePoll } from "../../lib/api";
import { ago, date } from "../../../../shared/format";
import { Link } from "react-router-dom";

export function NodeReplication({ node }: { node: string }) {
  const { watch, toast } = useToast();
  const jobs = usePoll(() => pve.get<any[]>(`/nodes/${node}/replication`), 15000, [node]);
  return (
    <Panel pad={false} title="Réplication">
      <DataTable
        rows={jobs.data}
        loading={jobs.loading}
        error={jobs.error}
        rowKey={(j) => j.id}
        filter={false}
        empty="Aucune réplication depuis ce nœud. Elles se créent dans l'onglet Réplication d'une machine."
        columns={[
          { id: "id", header: "Tâche", cell: (j) => <span className="mono">{j.id}</span> },
          { id: "guest", header: "Machine", cell: (j) => <Link className="link-btn" to={`/machines/${node}/qemu/${j.guest}`}>{j.guest}</Link> },
          { id: "target", header: "Vers", cell: (j) => j.target },
          { id: "schedule", header: "Fréquence", cell: (j) => <span className="mono">{j.schedule}</span> },
          { id: "last", header: "Dernière copie", cell: (j) => (j.last_sync ? ago(j.last_sync) : "jamais") },
          { id: "next", header: "Prochaine", cell: (j) => (j.next_sync ? date(j.next_sync) : "-") },
          { id: "duration", header: "Durée", cell: (j) => (j.duration ? `${j.duration.toFixed(1)} s` : "-") },
          { id: "state", header: "État", cell: (j) => (j.fail_count ? <span className="badge err">{j.fail_count} échec(s)</span> : j.state === "disabled" ? <span className="badge off">désactivée</span> : <span className="badge on">OK</span>) },
        ]}
        actions={(j) => <Button size="sm" onClick={async () => {
          try { const upid = await pve.post<string>(`/nodes/${node}/replication/${j.id}/schedule_now`); if (typeof upid === "string") watch(node, upid, `Réplication ${j.id}`, jobs.refresh); } catch (e) { toast((e as Error).message, "error"); }
        }}>Lancer</Button>}
      />
    </Panel>
  );
}

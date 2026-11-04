// Onglet « Historique » : tâches Proxmox de la machine, avec leur journal.
import { Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { pve, usePoll } from "../../lib/api";
import { TASK_LABEL, date } from "../../../../shared/format";
import type { GuestCtx } from "./common";

export function History({ ctx }: { ctx: GuestCtx }) {
  const { showLog } = useToast();
  const tasks = usePoll(() => pve.get<any[]>(`/nodes/${ctx.node}/tasks`, { vmid: ctx.vmid, limit: 200, source: "all" }), 10000, [ctx.node, ctx.vmid]);
  return (
    <Panel pad={false} title="Tâches de cette machine">
      <DataTable
        rows={tasks.data}
        loading={tasks.loading}
        error={tasks.error}
        rowKey={(t) => t.upid}
        initialSort={{ id: "start", dir: "desc" }}
        onRowClick={(t) => showLog(t.upid, t.node)}
        empty="Aucune tâche récente pour cette machine."
        columns={[
          { id: "start", header: "Début", sort: (t) => t.starttime, cell: (t) => date(t.starttime, true), className: "small nowrap" },
          { id: "end", header: "Fin", sort: (t) => t.endtime ?? 0, cell: (t) => (t.endtime ? date(t.endtime) : "en cours"), className: "small nowrap muted" },
          { id: "type", header: "Action", sort: (t) => TASK_LABEL[t.type] ?? t.type, cell: (t) => TASK_LABEL[t.type] ?? t.type },
          { id: "user", header: "Par", sort: (t) => t.user, cell: (t) => t.user, className: "small" },
          { id: "status", header: "Résultat", sort: (t) => t.status ?? "", cell: (t) => (!t.status ? <span className="badge warn">en cours</span> : t.status === "OK" ? <span className="badge on">OK</span> : <span className="badge err">{t.status}</span>) },
        ]}
      />
    </Panel>
  );
}

// Services système du nœud : démarrer, arrêter, redémarrer, recharger (avec confirmation).
import { useState } from "react";
import { Button, Confirm, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";

type Action = "start" | "stop" | "restart" | "reload";
const LABEL: Record<Action, string> = { start: "Démarrer", stop: "Arrêter", restart: "Redémarrer", reload: "Recharger" };
const RISKY = new Set(["pveproxy", "pvedaemon", "pve-cluster", "corosync", "sshd"]);

export function NodeServices({ node }: { node: string }) {
  const { watch, toast } = useToast();
  const list = usePoll(() => pve.get<any[]>(`/nodes/${node}/services`), 10000, [node]);
  const { allowed } = usePermission(`/nodes/${node}`, "Sys.Modify");
  const [act, setAct] = useState<{ svc: any; action: Action } | null>(null);
  return (
    <Panel pad={false} title="Services système">
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(s) => s.name}
        initialSort={{ id: "name", dir: "asc" }}
        columns={[
          { id: "name", header: "Service", sort: (s) => s.name, cell: (s) => <span className="mono">{s.name}</span> },
          { id: "desc", header: "Rôle", text: (s) => s.desc ?? "", cell: (s) => <span className="small">{s.desc}</span> },
          { id: "state", header: "État", sort: (s) => s.state, cell: (s) => (s.state === "running" ? <span className="badge on">Actif</span> : <span className={`badge ${s["unit-state"] === "disabled" ? "off" : "err"}`}>{s.state === "stopped" ? "Arrêté" : s.state}</span>) },
          { id: "unit", header: "Au démarrage", sort: (s) => s["unit-state"], cell: (s) => <span className="small muted">{s["unit-state"] === "enabled" ? "activé" : s["unit-state"] === "disabled" ? "désactivé" : s["unit-state"]}</span> },
        ]}
        actions={(s) => (
          <span className="btn-group">
            {s.state === "running"
              ? (["restart", "reload", "stop"] as Action[]).map((a) => <Button key={a} size="sm" variant={a === "stop" ? "danger" : "default"} disabled={!allowed} onClick={() => setAct({ svc: s, action: a })}>{LABEL[a]}</Button>)
              : <Button size="sm" disabled={!allowed} onClick={() => setAct({ svc: s, action: "start" })}>Démarrer</Button>}
          </span>
        )}
      />
      {act && (
        <Confirm
          title={`${LABEL[act.action]} ${act.svc.name} ?`}
          danger={act.action === "stop" || RISKY.has(act.svc.name)}
          confirmLabel={LABEL[act.action]}
          onConfirm={async () => {
            try {
              const upid = await pve.post<string>(`/nodes/${node}/services/${act.svc.name}/${act.action}`);
              watch(node, upid, `${LABEL[act.action]} ${act.svc.name}`, list.refresh);
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setAct(null)}
        >
          <p>{act.svc.desc}</p>
          {RISKY.has(act.svc.name) && <p><strong>Attention :</strong> ce service fait tourner l&apos;interface, l&apos;API ou le cluster. L&apos;arrêter peut couper l&apos;accès à Proxmox, et à MyProxmox.</p>}
        </Confirm>
      )}
    </Panel>
  );
}

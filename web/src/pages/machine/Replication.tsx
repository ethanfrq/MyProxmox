// Onglet « Réplication » : copies planifiées des disques vers un autre nœud (stockage ZFS).
import { useState } from "react";
import { Button, Confirm, Modal, Notice, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form, type FieldDef } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { ago, date } from "../../../../shared/format";
import { nodesList, type GuestCtx } from "./common";

const SCHEDULES = [
  { value: "*/15", label: "Toutes les 15 minutes" }, { value: "*/30", label: "Toutes les 30 minutes" }, { value: "hourly", label: "Toutes les heures" },
  { value: "*/2:00", label: "Toutes les 2 heures" }, { value: "22:30", label: "Chaque soir à 22 h 30" }, { value: "sat 3:00", label: "Le samedi à 3 h" },
];

export function Replication({ ctx }: { ctx: GuestCtx }) {
  const { toast, watch } = useToast();
  const { allowed } = usePermission("/storage", "Datastore.Allocate");
  const jobs = usePoll(() => pve.get<any[]>(`/nodes/${ctx.node}/replication`, { guest: ctx.vmid }), 15000, [ctx.node, ctx.vmid]);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [log, setLog] = useState<{ id: string; lines: string[] } | null>(null);

  const fields = (job?: any): FieldDef[] => [
    ...(job ? [] : [{ name: "target", label: "Nœud cible", type: "api-select" as const, load: nodesList(ctx.node), required: true }]),
    { name: "schedule", label: "Fréquence", type: "select", options: SCHEDULES, help: "Format calendrier de Proxmox : « */15 » = toutes les 15 minutes." },
    { name: "rate", label: "Limite de débit", type: "number", unit: "Mo/s", help: "Vide : pas de limite." },
    { name: "comment", label: "Commentaire" },
    { name: "disable", label: "Tâche désactivée", type: "checkbox", advanced: true },
  ];

  return (
    <Panel pad={false} title="Réplication" right={<Button size="sm" variant="primary" disabled={!allowed} title={allowed ? undefined : "Il te manque le droit Datastore.Allocate"} onClick={() => setEdit("new")}>Ajouter</Button>}>
      <div style={{ padding: "12px 16px 0" }}>
        <Notice>La réplication copie régulièrement les disques vers un autre nœud. Elle demande un stockage ZFS local du même nom des deux côtés, et permet une bascule rapide avec la haute disponibilité.</Notice>
      </div>
      <DataTable
        rows={jobs.data}
        loading={jobs.loading}
        error={jobs.error}
        rowKey={(j) => j.id}
        filter={false}
        empty="Aucune réplication pour cette machine."
        columns={[
          { id: "id", header: "Tâche", cell: (j) => <span className="mono">{j.id}</span> },
          { id: "target", header: "Vers", cell: (j) => j.target },
          { id: "schedule", header: "Fréquence", cell: (j) => SCHEDULES.find((s) => s.value === j.schedule)?.label ?? j.schedule },
          { id: "last", header: "Dernière copie", cell: (j) => (j.last_sync ? ago(j.last_sync) : "jamais") },
          { id: "next", header: "Prochaine", cell: (j) => (j.state === "disabled" ? <span className="muted">désactivée</span> : j.next_sync ? date(j.next_sync) : "-") },
          { id: "state", header: "État", cell: (j) => (j.fail_count ? <span className="badge err">{j.fail_count} échec(s)</span> : <span className="badge on">OK</span>) },
        ]}
        actions={(j) => (
          <span className="btn-group">
            <Button size="sm" disabled={!allowed} onClick={async () => {
              try {
                const upid = await pve.post<string>(`/nodes/${ctx.node}/replication/${j.id}/schedule_now`);
                if (typeof upid === "string" && upid.startsWith("UPID")) watch(ctx.node, upid, `Réplication ${j.id}`, jobs.refresh);
                else toast("Réplication lancée", "ok");
              } catch (e) { toast((e as Error).message, "error"); }
            }}>Lancer</Button>
            <Button size="sm" onClick={async () => setLog({ id: j.id, lines: (await pve.get<any[]>(`/nodes/${ctx.node}/replication/${j.id}/log`)).map((l) => l.t) })}>Journal</Button>
            <Button size="sm" disabled={!allowed} onClick={() => setEdit(j)}>Modifier</Button>
            <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(j)}>Supprimer</Button>
          </span>
        )}
      />
      {edit && (
        <Modal title={edit === "new" ? "Nouvelle réplication" : `Réplication ${edit.id}`} onClose={() => setEdit(null)}>
          <Form
            fields={fields(edit === "new" ? undefined : edit)}
            initial={edit === "new" ? { schedule: "*/15" } : { schedule: edit.schedule, rate: edit.rate ?? "", comment: edit.comment ?? "", disable: edit.state === "disabled" }}
            onCancel={() => setEdit(null)}
            onSubmit={async (_c, v) => {
              if (edit === "new") {
                const used = (jobs.data ?? []).map((j) => Number(String(j.id).split("-")[1]));
                const n = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((i) => !used.includes(i)) ?? 0;
                await pve.post("/cluster/replication", { id: `${ctx.vmid}-${n}`, target: v.target, type: "local", schedule: v.schedule, rate: v.rate || undefined, comment: v.comment || undefined, disable: v.disable ? 1 : undefined });
              } else {
                const del: string[] = [];
                if (!v.rate) del.push("rate");
                if (!v.comment) del.push("comment");
                await pve.put(`/cluster/replication/${edit.id}`, { schedule: v.schedule, rate: v.rate || undefined, comment: v.comment || undefined, disable: v.disable ? 1 : 0, delete: del.join(",") || undefined });
              }
              toast("Réplication enregistrée", "ok");
              setEdit(null);
              jobs.refresh();
            }}
          />
        </Modal>
      )}
      {del && (
        <Confirm title={`Supprimer la réplication ${del.id} ?`} danger confirmLabel="Supprimer" onConfirm={async () => {
          try { await pve.del(`/cluster/replication/${del.id}`); jobs.refresh(); toast("Réplication supprimée", "ok"); } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setDel(null)}>
          <p>Les copies déjà faites sur {del.target} sont nettoyées par Proxmox.</p>
        </Confirm>
      )}
      {log && <Modal title={`Journal de ${log.id}`} wide onClose={() => setLog(null)} foot={<Button onClick={() => setLog(null)}>Fermer</Button>}><pre className="log">{log.lines.join("\n")}</pre></Modal>}
    </Panel>
  );
}

// Toutes les réplications du cluster.
import { Button, useToast } from "../../components/ui";
import { Crud, putBody } from "../../components/Crud";
import { pve } from "../../lib/api";
import type { FieldDef } from "../../components/Form";

const SCHEDULES = [{ value: "*/15", label: "Toutes les 15 minutes" }, { value: "*/30", label: "Toutes les 30 minutes" }, { value: "hourly", label: "Toutes les heures" }, { value: "*/2:00", label: "Toutes les 2 heures" }, { value: "22:30", label: "Chaque soir" }];

const fields = (editing: boolean): FieldDef[] => [
  ...(editing ? [] : [
    { name: "guest", label: "Machine", type: "api-select" as const, required: true, load: async () => (await pve.get<any[]>("/cluster/resources", { type: "vm" })).filter((g) => !g.template).map((g) => ({ value: `${g.vmid}|${g.node}`, label: `${g.vmid} ${g.name} (sur ${g.node})` })) },
    { name: "target", label: "Nœud cible", type: "api-select" as const, required: true, loadDeps: ["guest"], load: async (v: Record<string, unknown>) => (await pve.get<any[]>("/nodes")).filter((n) => n.node !== String(v.guest ?? "").split("|")[1]).map((n) => ({ value: n.node, label: n.node })) },
  ]),
  { name: "schedule", label: "Fréquence", type: "select", options: SCHEDULES, default: "*/15" },
  { name: "rate", label: "Limite de débit", type: "number", unit: "Mo/s" },
  { name: "comment", label: "Commentaire", full: true },
  { name: "disable", label: "Désactivée", type: "checkbox" },
];

export function DcReplication() {
  const { toast, watch } = useToast();
  return (
    <Crud<any>
      title="Réplication"
      help="Copie régulière des disques d'une machine vers un autre nœud (stockage ZFS du même nom des deux côtés). En cas de panne, la machine redémarre ailleurs avec des données récentes."
      list="/cluster/replication"
      rowKey={(j) => j.id}
      perm={["/storage", "Datastore.Allocate"]}
      createLabel="Ajouter une réplication"
      columns={[
        { id: "id", header: "Tâche", sort: (j) => j.id, cell: (j) => <span className="mono">{j.id}</span> },
        { id: "guest", header: "Machine", cell: (j) => j.guest },
        { id: "target", header: "Vers", cell: (j) => j.target },
        { id: "schedule", header: "Fréquence", cell: (j) => SCHEDULES.find((s) => s.value === j.schedule)?.label ?? j.schedule },
        { id: "rate", header: "Débit max", cell: (j) => (j.rate ? `${j.rate} Mo/s` : "illimité") },
        { id: "state", header: "État", cell: (j) => (Number(j.disable) ? <span className="badge off">désactivée</span> : <span className="badge on">active</span>) },
      ]}
      fields={fields}
      initial={(j) => ({ ...j, disable: !!Number(j.disable) })}
      create={async (v) => {
        const [vmid] = String(v.guest).split("|");
        const existing = await pve.get<any[]>("/cluster/replication");
        const used = existing.filter((j) => String(j.guest) === vmid).map((j) => Number(j.jobnum));
        const n = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((i) => !used.includes(i)) ?? 0;
        return pve.post("/cluster/replication", { id: `${vmid}-${n}`, target: v.target, type: "local", schedule: v.schedule, rate: v.rate || undefined, comment: v.comment || undefined, disable: v.disable ? 1 : undefined });
      }}
      update={(j, v) => pve.put(`/cluster/replication/${j.id}`, putBody(v, j, ["schedule", "rate", "comment", "disable"]))}
      remove={(j) => pve.del(`/cluster/replication/${j.id}`)}
      extraActions={(j, refresh) => <Button size="sm" onClick={async () => {
        try {
          const node = (await pve.get<any[]>("/cluster/resources", { type: "vm" })).find((g) => g.vmid === Number(j.guest))?.node ?? "pve";
          const upid = await pve.post<string>(`/nodes/${node}/replication/${j.id}/schedule_now`);
          if (typeof upid === "string") watch(node, upid, `Réplication ${j.id}`, refresh);
        } catch (e) { toast((e as Error).message, "error"); }
      }}>Lancer</Button>}
    />
  );
}

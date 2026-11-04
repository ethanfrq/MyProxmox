// Sauvegardes planifiées : création et édition complètes (sélection par machines, pool,
// tags, exclusions), rétention, notes, « exécuter maintenant », machines non couvertes.
import { useState } from "react";
import { Button, Confirm, Modal, Notice, Panel, Toggle, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form, type FieldDef, type Values } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { date } from "../../../../shared/format";
import { joinProps, parseProps } from "../machine/common";
import { tagList } from "../../components/Tree";

const SCHEDULES = [
  { value: "02:00", label: "Chaque nuit à 2 h" }, { value: "21:00", label: "Chaque soir à 21 h" }, { value: "sat 02:00", label: "Le samedi à 2 h" },
  { value: "mon..fri 23:00", label: "Du lundi au vendredi à 23 h" }, { value: "*-*-01 03:00", label: "Le 1er du mois à 3 h" }, { value: "hourly", label: "Toutes les heures" },
  { value: "custom", label: "Autre (syntaxe calendrier de Proxmox)" },
];

const guestsOpts = async () => (await pve.get<any[]>("/cluster/resources", { type: "vm" })).filter((g) => !g.template).sort((a, b) => a.vmid - b.vmid).map((g) => ({ value: String(g.vmid), label: `${g.vmid} ${g.name}` }));

function fields(): FieldDef[] {
  return [
    { name: "node", label: "Nœud", type: "api-select", allowEmpty: "Tous les nœuds", load: async () => (await pve.get<any[]>("/nodes")).map((n) => ({ value: n.node, label: n.node })) },
    { name: "storage", label: "Stockage", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/storage")).filter((s) => String(s.content).includes("backup") && !Number(s.disable)).map((s) => ({ value: s.storage, label: `${s.storage} (${s.type})` })) },
    { name: "sched", label: "Quand", type: "select", options: SCHEDULES, default: "02:00" },
    { name: "schedule", label: "Calendrier", placeholder: "mon,wed,fri 01:30", show: (v) => v.sched === "custom", required: true, help: "Ex. « sat 02:00 », « *-*-01 03:00 », « mon..fri 22:30 »." },
    { name: "selection", label: "Machines à sauvegarder", type: "select", default: "include", full: true, options: [{ value: "include", label: "Celles que je coche" }, { value: "all", label: "Toutes, sauf celles que je coche" }, { value: "pool", label: "Celles d'un pool" }, { value: "tag", label: "Celles qui ont un tag" }] },
    { name: "vmid", label: "Machines", type: "multi", load: guestsOpts, show: (v) => v.selection === "include", full: true },
    { name: "exclude", label: "Machines exclues", type: "multi", load: guestsOpts, show: (v) => v.selection === "all", full: true },
    { name: "pool", label: "Pool", type: "api-select", required: true, show: (v) => v.selection === "pool", load: async () => (await pve.get<any[]>("/pools")).map((p) => ({ value: p.poolid, label: p.poolid })) },
    { name: "tag", label: "Tag", type: "api-select", required: true, show: (v) => v.selection === "tag", load: async () => [...new Set((await pve.get<any[]>("/cluster/resources", { type: "vm" })).flatMap((g) => tagList(g.tags)))].sort().map((t) => ({ value: t, label: t })), help: "Les machines qui ont ce tag au moment de l'enregistrement sont ajoutées à la liste." },
    { name: "mode", label: "Mode", type: "select", default: "snapshot", options: [{ value: "snapshot", label: "Snapshot (sans interruption)" }, { value: "suspend", label: "Suspension" }, { value: "stop", label: "Arrêt (le plus fiable)" }] },
    { name: "compress", label: "Compression", type: "select", default: "zstd", options: [{ value: "zstd", label: "ZSTD" }, { value: "gzip", label: "GZIP" }, { value: "lzo", label: "LZO" }, { value: "0", label: "Aucune" }] },
    { name: "notes-template", label: "Notes", default: "{{guestname}}", help: "Variables : {{guestname}}, {{vmid}}, {{node}}, {{cluster}}." },
    { name: "mailnotification", label: "Mail", type: "select", default: "failure", options: [{ value: "failure", label: "En cas d'échec" }, { value: "always", label: "Toujours" }] },
    { name: "mailto", label: "Adresse", placeholder: "moi@exemple.fr" },
    { name: "keep_last", label: "Garder les dernières", type: "number", min: 0 },
    { name: "keep_daily", label: "Une par jour pendant", type: "number", unit: "jours", min: 0 },
    { name: "keep_weekly", label: "Une par semaine pendant", type: "number", unit: "semaines", min: 0 },
    { name: "keep_monthly", label: "Une par mois pendant", type: "number", unit: "mois", min: 0 },
    { name: "keep_yearly", label: "Une par an pendant", type: "number", unit: "ans", min: 0, advanced: true },
    { name: "protected", label: "Protéger les nouvelles sauvegardes", type: "checkbox", advanced: true },
    { name: "comment", label: "Commentaire", full: true },
    { name: "enabled", label: "Active", type: "checkbox", default: true },
    { name: "bwlimit", label: "Limite de débit", type: "number", unit: "Kio/s", advanced: true },
    { name: "ionice", label: "Priorité des E/S (0 à 8)", type: "number", min: 0, max: 8, advanced: true },
  ];
}

function toValues(j: any): Values {
  const pr = parseProps(j["prune-backups"] ?? "", "_");
  const known = SCHEDULES.some((s) => s.value === j.schedule);
  return {
    ...j, sched: known ? j.schedule : "custom", schedule: j.schedule, enabled: j.enabled === undefined || !!Number(j.enabled), protected: !!Number(j.protected ?? 0),
    selection: Number(j.all) ? "all" : j.pool ? "pool" : "include",
    vmid: String(j.vmid ?? "").split(",").filter(Boolean), exclude: String(j.exclude ?? "").split(",").filter(Boolean),
    keep_last: pr["keep-last"] ?? "", keep_daily: pr["keep-daily"] ?? "", keep_weekly: pr["keep-weekly"] ?? "", keep_monthly: pr["keep-monthly"] ?? "", keep_yearly: pr["keep-yearly"] ?? "",
  };
}

async function toBody(v: Values, before?: any) {
  let vmid = v.selection === "include" ? (v.vmid as string[]) : [];
  if (v.selection === "tag") vmid = (await pve.get<any[]>("/cluster/resources", { type: "vm" })).filter((g) => !g.template && tagList(g.tags).includes(String(v.tag))).map((g) => String(g.vmid));
  const prune = joinProps({ "keep-last": v.keep_last, "keep-daily": v.keep_daily, "keep-weekly": v.keep_weekly, "keep-monthly": v.keep_monthly, "keep-yearly": v.keep_yearly }, "_none");
  const body: Record<string, unknown> = {
    node: v.node || undefined, storage: v.storage, schedule: v.sched === "custom" ? v.schedule : v.sched, mode: v.mode, compress: v.compress,
    all: v.selection === "all" ? 1 : 0, vmid: vmid.length ? vmid.join(",") : undefined, pool: v.selection === "pool" ? v.pool : undefined,
    exclude: v.selection === "all" && (v.exclude as string[] ?? []).length ? (v.exclude as string[]).join(",") : undefined,
    "notes-template": v["notes-template"] || undefined, mailnotification: v.mailnotification, mailto: v.mailto || undefined, "prune-backups": prune || undefined,
    protected: v.protected ? 1 : 0, comment: v.comment || undefined, enabled: v.enabled ? 1 : 0, bwlimit: v.bwlimit || undefined, ionice: v.ionice || undefined,
  };
  if (v.selection === "tag" && !vmid.length) throw new Error(`Aucune machine n'a le tag « ${v.tag} ».`);
  if (before) {
    const del = ["node", "vmid", "pool", "exclude", "notes-template", "mailto", "prune-backups", "comment", "bwlimit", "ionice"].filter((k) => body[k] === undefined && before[k] !== undefined);
    if (del.length) body.delete = del.join(",");
  }
  return Object.fromEntries(Object.entries(body).filter(([, x]) => x !== undefined));
}

export function DcBackups() {
  const { toast, watch } = useToast();
  const { allowed } = usePermission("/", "Sys.Modify");
  const jobs = usePoll(() => pve.get<any[]>("/cluster/backup"), 30000);
  const uncovered = usePoll(() => pve.get<any[]>("/cluster/backup-info/not-backed-up"), 30000);
  const [edit, setEdit] = useState<{ row?: any } | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [run, setRun] = useState<any | null>(null);
  const [incl, setIncl] = useState<{ id: string; data: any } | null>(null);

  const runNow = async (j: any) => {
    // Comme le bouton « Exécuter maintenant » de Proxmox : une tâche vzdump par nœud concerné
    const included = (await pve.get<any>(`/cluster/backup/${j.id}/included_volumes`)).children ?? [];
    const res = await pve.get<any[]>("/cluster/resources", { type: "vm" });
    const byNode = new Map<string, number[]>();
    for (const g of included) {
      const r = res.find((x) => x.vmid === g.id);
      if (!r || (j.node && r.node !== j.node)) continue;
      byNode.set(r.node, [...(byNode.get(r.node) ?? []), g.id]);
    }
    if (!byNode.size) throw new Error("Cette tâche ne couvre aucune machine pour l'instant.");
    for (const [node, ids] of byNode) {
      const upid = await pve.post<string>(`/nodes/${node}/vzdump`, { vmid: ids.join(","), storage: j.storage, mode: j.mode, compress: j.compress, "notes-template": j["notes-template"], "prune-backups": j["prune-backups"], protected: j.protected, mailnotification: j.mailnotification, mailto: j.mailto });
      watch(node, upid, `Sauvegarde ${j.id} sur ${node}`, uncovered.refresh);
    }
  };

  return (
    <div className="stack">
      <Panel pad={false} title="Sauvegardes planifiées" right={<Button size="sm" variant="primary" disabled={!allowed} onClick={() => setEdit({})}>Créer une tâche</Button>}>
        <DataTable
          rows={jobs.data}
          loading={jobs.loading}
          error={jobs.error}
          rowKey={(j) => j.id}
          filter={false}
          empty="Aucune sauvegarde planifiée : tes machines ne sont sauvegardées que si tu le fais à la main."
          columns={[
            { id: "on", header: "Active", cell: (j) => <Toggle on={j.enabled === undefined || !!Number(j.enabled)} label={`Activer ${j.id}`} onChange={async (on) => { if (!allowed) return; try { await pve.put(`/cluster/backup/${j.id}`, { enabled: on ? 1 : 0 }); jobs.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} /> },
            { id: "id", header: "Tâche", cell: (j) => <><strong>{j.id}</strong>{j.comment && <div className="small muted">{j.comment}</div>}</> },
            { id: "sched", header: "Quand", cell: (j) => SCHEDULES.find((s) => s.value === j.schedule)?.label ?? <span className="mono">{j.schedule}</span> },
            { id: "storage", header: "Stockage", cell: (j) => j.storage },
            { id: "sel", header: "Machines", cell: (j) => <span className="small">{Number(j.all) ? `toutes${j.exclude ? `, sauf ${j.exclude}` : ""}` : j.pool ? `pool ${j.pool}` : j.vmid}</span> },
            { id: "node", header: "Nœud", cell: (j) => j.node ?? "tous" },
            { id: "next", header: "Prochaine", cell: (j) => (j["next-run"] ? date(j["next-run"]) : "-") },
          ]}
          actions={(j) => (
            <span className="btn-group">
              <Button size="sm" disabled={!allowed} onClick={() => setRun(j)}>Exécuter maintenant</Button>
              <Button size="sm" onClick={async () => setIncl({ id: j.id, data: await pve.get(`/cluster/backup/${j.id}/included_volumes`) })}>Inclus</Button>
              <Button size="sm" disabled={!allowed} onClick={() => setEdit({ row: j })}>Modifier</Button>
              <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(j)}>Supprimer</Button>
            </span>
          )}
        />
      </Panel>
      <Panel pad={false} title={`Machines non couvertes${uncovered.data ? ` (${uncovered.data.length})` : ""}`}>
        <DataTable rows={uncovered.data} loading={uncovered.loading} rowKey={(g) => g.vmid} filter={false} empty="Toutes les machines sont dans au moins une sauvegarde planifiée active." columns={[
          { id: "id", header: "ID", cell: (g) => <span className="mono">{g.vmid}</span> },
          { id: "name", header: "Nom", cell: (g) => g.name },
          { id: "type", header: "Type", cell: (g) => (g.type === "qemu" ? "VM" : "Conteneur") },
        ]} />
      </Panel>

      {edit && (
        <Modal title={edit.row ? `Tâche ${edit.row.id}` : "Nouvelle sauvegarde planifiée"} wide onClose={() => setEdit(null)}>
          <Form
            fields={fields()}
            initial={edit.row ? toValues(edit.row) : undefined}
            onCancel={() => setEdit(null)}
            onSubmit={async (_c, v) => {
              const body = await toBody(v, edit.row);
              if (edit.row) await pve.put(`/cluster/backup/${edit.row.id}`, body);
              else await pve.post("/cluster/backup", { id: `backup-${Math.random().toString(16).slice(2, 10)}`, ...body });
              toast("Sauvegarde planifiée enregistrée", "ok");
              setEdit(null);
              jobs.refresh();
              uncovered.refresh();
            }}
          />
        </Modal>
      )}
      {run && <Confirm title={`Exécuter ${run.id} maintenant ?`} confirmLabel="Lancer" onConfirm={async () => { try { await runNow(run); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setRun(null)}><p>La sauvegarde démarre tout de suite, avec les réglages de la tâche. Les machines en mode « arrêt » seront coupées pendant la copie.</p></Confirm>}
      {del && <Confirm title={`Supprimer la tâche ${del.id} ?`} danger confirmLabel="Supprimer" onConfirm={async () => { try { await pve.del(`/cluster/backup/${del.id}`); jobs.refresh(); uncovered.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDel(null)}><p>Les sauvegardes déjà faites sont gardées. Les machines ne seront plus sauvegardées automatiquement par cette tâche.</p></Confirm>}
      {incl && (
        <Modal title={`Ce que sauvegarde ${incl.id}`} wide onClose={() => setIncl(null)} foot={<Button onClick={() => setIncl(null)}>Fermer</Button>}>
          {(incl.data.children ?? []).length ? (
            <table className="table">
              <thead><tr><th>Machine</th><th>Disques</th></tr></thead>
              <tbody>{incl.data.children.map((g: any) => <tr key={g.id}><td><strong>{g.id}</strong> {g.name}</td><td className="small">{(g.children ?? []).map((d: any) => <span key={d.id} className={d.included ? "" : "muted"} style={{ marginRight: 10 }}>{d.name}{d.included ? "" : " (exclu)"}</span>)}</td></tr>)}</tbody>
            </table>
          ) : <Notice kind="warn">Aucune machine n&apos;est couverte par cette tâche.</Notice>}
        </Modal>
      )}
    </div>
  );
}

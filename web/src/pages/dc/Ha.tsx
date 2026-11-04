// Haute disponibilité : état, ressources, groupes, et règles (Proxmox VE 9) si l'API les propose.
import { useState } from "react";
import { Button, Modal, Notice, Panel, Tabs, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Crud, postBody, putBody } from "../../components/Crud";
import { Form } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";

type Tab = "etat" | "ressources" | "groupes" | "regles";
const STATE: Record<string, string> = { started: "démarrée", stopped: "arrêtée", disabled: "désactivée", ignored: "ignorée", error: "en erreur", fence: "en cours d'isolement", freeze: "gelée", migrate: "en migration", relocate: "en déplacement", recovery: "en reprise" };

export function DcHa() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("etat");
  const status = usePoll(() => pve.get<any[]>("/cluster/ha/status/current"), 10000);
  const manager = usePoll(() => pve.get<any>("/cluster/ha/status/manager_status"), 10000);
  // Les règles HA n'existent qu'à partir de Proxmox VE 9 : on ne les demande pas avant
  const rules = usePoll(async () => {
    const v = await pve.get<any>("/version");
    return Number(String(v.version).split(".")[0]) >= 9 ? pve.get<any[]>("/cluster/ha/rules") : null;
  }, 0);
  const [move, setMove] = useState<{ sid: string; kind: "migrate" | "relocate" } | null>(null);
  const quorum = (status.data ?? []).find((x) => x.type === "quorum");
  const services = (status.data ?? []).filter((x) => x.type === "service");
  const nodes = async () => (await pve.get<any[]>("/nodes")).map((n) => ({ value: n.node, label: n.node }));
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "etat", label: "État" }, { id: "ressources", label: "Ressources" }, { id: "groupes", label: "Groupes" }, ...(rules.data ? [{ id: "regles" as Tab, label: "Règles" }] : [])]} />
      {tab === "etat" && (
        <div className="stack">
          <Panel title="Gestionnaire HA">
            <div className="kv">
              <div>Quorum</div><div>{quorum ? (quorum.quorate ? <span className="badge on">Atteint</span> : <span className="badge err">Perdu</span>) : "-"}</div>
              <div>Maître</div><div>{manager.data?.manager_status?.master_node ?? "-"}</div>
              <div>Nœuds</div><div>{Object.entries(manager.data?.manager_status?.node_status ?? {}).map(([n, s]) => `${n} (${s === "online" ? "en ligne" : s})`).join(", ") || "-"}</div>
            </div>
          </Panel>
          <Panel pad={false} title="Ressources gérées">
            <DataTable rows={status.data ? services : null} loading={status.loading} rowKey={(s) => s.sid} filter={false} empty="Aucune ressource HA. Ajoute une machine dans l'onglet Ressources pour qu'elle redémarre ailleurs si son nœud tombe." columns={[
              { id: "sid", header: "Ressource", cell: (s) => <span className="mono">{s.sid}</span> },
              { id: "node", header: "Nœud", cell: (s) => s.node },
              { id: "state", header: "État", cell: (s) => <span className={`badge ${s.state === "started" ? "on" : s.state === "error" || s.state === "fence" ? "err" : "off"}`}>{STATE[s.state] ?? s.state}</span> },
            ]} />
          </Panel>
        </div>
      )}
      {tab === "ressources" && (
        <>
          <Crud<any>
            title="Ressources HA"
            help="Une machine en HA est redémarrée automatiquement sur un autre nœud si le sien tombe. Il faut un stockage partagé (ou la réplication) et au moins trois nœuds pour un quorum fiable."
            list="/cluster/ha/resources"
            rowKey={(r) => r.sid}
            perm={["/", "Sys.Console"]}
            createLabel="Ajouter une machine"
            columns={[
              { id: "sid", header: "Ressource", cell: (r) => <span className="mono">{r.sid}</span> },
              { id: "state", header: "État voulu", cell: (r) => STATE[r.state] ?? r.state },
              { id: "group", header: "Groupe", cell: (r) => r.group ?? "-" },
              { id: "max", header: "Essais", cell: (r) => `${r.max_restart ?? 1} redémarrage(s), ${r.max_relocate ?? 1} déplacement(s)` },
              { id: "comment", header: "Commentaire", cell: (r) => <span className="small">{r.comment}</span> },
            ]}
            fields={(editing) => [
              ...(editing ? [] : [{ name: "sid", label: "Machine", type: "api-select" as const, required: true, load: async () => (await pve.get<any[]>("/cluster/resources", { type: "vm" })).filter((g) => !g.template).map((g) => ({ value: `${g.type === "qemu" ? "vm" : "ct"}:${g.vmid}`, label: `${g.vmid} ${g.name}` })) }]),
              { name: "state", label: "État voulu", type: "select", default: "started", options: ["started", "stopped", "disabled", "ignored"].map((v) => ({ value: v, label: STATE[v] })) },
              { name: "group", label: "Groupe", type: "api-select", allowEmpty: "Aucun", load: async () => (await pve.get<any[]>("/cluster/ha/groups")).map((g) => ({ value: g.group, label: g.group })) },
              { name: "max_restart", label: "Redémarrages max sur le même nœud", type: "number", min: 0, max: 10, default: 1 },
              { name: "max_relocate", label: "Déplacements max", type: "number", min: 0, max: 10, default: 1 },
              { name: "comment", label: "Commentaire", full: true },
            ]}
            create={(v) => pve.post("/cluster/ha/resources", postBody(v, ["sid", "state", "group", "max_restart", "max_relocate", "comment"]))}
            update={(r, v) => pve.put(`/cluster/ha/resources/${r.sid}`, putBody(v, r, ["state", "group", "max_restart", "max_relocate", "comment"]))}
            remove={(r) => pve.del(`/cluster/ha/resources/${r.sid}`)}
            removeText={() => <p>La machine n&apos;est plus surveillée par la HA. Elle continue de tourner.</p>}
            extraActions={(r) => (
              <>
                <Button size="sm" onClick={() => setMove({ sid: r.sid, kind: "migrate" })}>Migrer</Button>
                <Button size="sm" onClick={() => setMove({ sid: r.sid, kind: "relocate" })}>Déplacer</Button>
              </>
            )}
          />
          {move && (
            <Modal title={move.kind === "migrate" ? `Migrer ${move.sid}` : `Déplacer ${move.sid}`} onClose={() => setMove(null)}>
              <div className="stack">
                <Notice>{move.kind === "migrate" ? "Migration à chaud par le gestionnaire HA." : "Arrêt puis redémarrage sur le nœud choisi."}</Notice>
                <Form fields={[{ name: "node", label: "Nœud cible", type: "api-select", required: true, load: nodes }]} submitLabel="Envoyer la demande" onCancel={() => setMove(null)} onSubmit={async (v) => {
                  if (move.kind === "migrate") await pve.post(`/cluster/ha/resources/${move.sid}/migrate`, v);
                  else await pve.post(`/cluster/ha/resources/${move.sid}/relocate`, v);
                  toast("Demande envoyée au gestionnaire HA", "ok");
                  setMove(null);
                }} />
              </div>
            </Modal>
          )}
        </>
      )}
      {tab === "groupes" && (
        <Crud<any>
          title="Groupes HA"
          help="Un groupe dit sur quels nœuds une machine peut tourner, avec une priorité (plus grand = préféré)."
          list="/cluster/ha/groups"
          rowKey={(g) => g.group}
          perm={["/", "Sys.Console"]}
          createLabel="Créer un groupe"
          columns={[
            { id: "group", header: "Groupe", cell: (g) => <strong>{g.group}</strong> },
            { id: "nodes", header: "Nœuds (priorité)", cell: (g) => <span className="mono small">{g.nodes}</span> },
            { id: "r", header: "Restreint", cell: (g) => (Number(g.restricted) ? "Oui" : "Non") },
            { id: "nf", header: "Sans retour", cell: (g) => (Number(g.nofailback) ? "Oui" : "Non") },
            { id: "comment", header: "Commentaire", cell: (g) => <span className="small">{g.comment}</span> },
          ]}
          fields={(editing) => [
            { name: "group", label: "Nom", required: true, readOnly: editing },
            { name: "nodes", label: "Nœuds et priorités", required: true, placeholder: "pve:2,pve2:1", help: "nœud:priorité, séparés par des virgules." },
            { name: "restricted", label: "Restreint : ne jamais tourner hors de ces nœuds", type: "checkbox" },
            { name: "nofailback", label: "Ne pas revenir automatiquement sur le nœud préféré", type: "checkbox" },
            { name: "comment", label: "Commentaire", full: true },
          ]}
          initial={(g) => ({ ...g, restricted: !!Number(g.restricted), nofailback: !!Number(g.nofailback) })}
          create={(v) => pve.post("/cluster/ha/groups", postBody(v, ["group", "nodes", "restricted", "nofailback", "comment"]))}
          update={(g, v) => pve.put(`/cluster/ha/groups/${g.group}`, putBody(v, g, ["nodes", "restricted", "nofailback", "comment"]))}
          remove={(g) => pve.del(`/cluster/ha/groups/${g.group}`)}
        />
      )}
      {tab === "regles" && rules.data && (
        <Crud<any>
          title="Règles HA"
          help="Proxmox VE 9 : règles d'affinité de nœud ou entre ressources, à la place des groupes."
          list="/cluster/ha/rules"
          rowKey={(r) => r.rule}
          perm={["/", "Sys.Console"]}
          columns={[{ id: "rule", header: "Règle", cell: (r) => <strong>{r.rule}</strong> }, { id: "type", header: "Type", cell: (r) => r.type }, { id: "res", header: "Ressources", cell: (r) => <span className="mono small">{r.resources}</span> }, { id: "nodes", header: "Nœuds", cell: (r) => r.nodes ?? "" }]}
          fields={(editing) => [
            { name: "rule", label: "Nom", required: true, readOnly: editing },
            { name: "type", label: "Type", type: "select", readOnly: editing, options: [{ value: "node-affinity", label: "Affinité de nœud" }, { value: "resource-affinity", label: "Affinité entre ressources" }] },
            { name: "resources", label: "Ressources", required: true, placeholder: "vm:101,ct:106" },
            { name: "nodes", label: "Nœuds", placeholder: "pve:2,pve2:1", show: (v) => v.type === "node-affinity" },
            { name: "affinity", label: "Affinité", type: "select", show: (v) => v.type === "resource-affinity", options: [{ value: "positive", label: "Ensemble" }, { value: "negative", label: "Séparées" }] },
            { name: "comment", label: "Commentaire", full: true },
          ]}
          create={(v) => pve.post("/cluster/ha/rules", postBody(v, ["rule", "type", "resources", "nodes", "affinity", "comment"]))}
          update={(r, v) => pve.put(`/cluster/ha/rules/${r.rule}`, putBody(v, r, ["resources", "nodes", "affinity", "comment"]))}
          remove={(r) => pve.del(`/cluster/ha/rules/${r.rule}`)}
        />
      )}
    </>
  );
}

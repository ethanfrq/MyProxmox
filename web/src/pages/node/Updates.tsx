// Mises à jour du nœud : liste, rafraîchissement, journal des changements, mise à niveau
// dans le shell intégré, versions installées et dépôts APT.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Modal, Notice, Panel, Tabs, Toggle, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";

export function NodeUpdates({ node }: { node: string }) {
  const { watch, toast } = useToast();
  const [, setParams] = useSearchParams();
  const [sub, setSub] = useState<"paquets" | "depots" | "versions">("paquets");
  const { allowed } = usePermission(`/nodes/${node}`, "Sys.Modify");
  const { allowed: canConsole } = usePermission(`/nodes/${node}`, "Sys.Console");
  const updates = usePoll(() => pve.get<any[]>(`/nodes/${node}/apt/update`), 0, [node]);
  const repos = usePoll(() => (sub === "depots" ? pve.get<any>(`/nodes/${node}/apt/repositories`) : Promise.resolve(null)), 0, [node, sub]);
  const versions = usePoll(() => (sub === "versions" ? pve.get<any[]>(`/nodes/${node}/apt/versions`) : Promise.resolve([])), 0, [node, sub]);
  const [log, setLog] = useState<{ name: string; text: string } | null>(null);

  const upgrade = () => setParams((p) => { const n = new URLSearchParams(p); n.set("onglet", "shell"); n.set("cmd", "upgrade"); return n; });

  return (
    <>
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "paquets", label: `Paquets${updates.data?.length ? ` (${updates.data.length})` : ""}` }, { id: "depots", label: "Dépôts" }, { id: "versions", label: "Versions installées" }]} />
      {sub === "paquets" && (
        <Panel pad={false} title="Paquets à mettre à jour" right={
          <span className="row">
            <Button size="sm" disabled={!allowed} onClick={async () => {
              try { const upid = await pve.post<string>(`/nodes/${node}/apt/update`); watch(node, upid, "Recherche de mises à jour", updates.refresh); } catch (e) { toast((e as Error).message, "error"); }
            }}>Rafraîchir la liste</Button>
            <Button size="sm" variant="primary" disabled={!canConsole || !updates.data?.length} title={canConsole ? undefined : "Il te manque le droit Sys.Console"} onClick={upgrade}>Mettre à niveau dans le shell</Button>
          </span>
        }>
          <DataTable
            rows={updates.data}
            loading={updates.loading}
            error={updates.error}
            rowKey={(u) => u.Package}
            initialSort={{ id: "pkg", dir: "asc" }}
            empty="Aucune mise à jour en attente selon la dernière vérification."
            columns={[
              { id: "pkg", header: "Paquet", sort: (u) => u.Package, cell: (u) => <strong className="mono">{u.Package}</strong> },
              { id: "old", header: "Installé", cell: (u) => <span className="mono small muted">{u.OldVersion}</span> },
              { id: "new", header: "Disponible", cell: (u) => <span className="mono small">{u.Version}</span> },
              { id: "origin", header: "Origine", sort: (u) => u.Origin, cell: (u) => u.Origin },
              { id: "title", header: "Description", text: (u) => u.Title, cell: (u) => <span className="small">{u.Title}</span> },
            ]}
            actions={(u) => <Button size="sm" onClick={async () => setLog({ name: u.Package, text: String(await pve.get(`/nodes/${node}/apt/changelog`, { name: u.Package, version: u.Version })) })}>Changements</Button>}
          />
          {(updates.data?.length ?? 0) > 0 && <div style={{ padding: 16 }}><Notice>« Mettre à niveau » ouvre le shell du nœud et lance <code>apt dist-upgrade</code> : tu vois tout ce qui se passe et tu réponds aux questions éventuelles. Un redémarrage est souvent conseillé après une mise à jour du noyau.</Notice></div>}
        </Panel>
      )}
      {sub === "depots" && (
        <div className="stack">
          {repos.data?.infos?.map((i: any, k: number) => <Notice key={k} kind={i.kind === "warning" ? "warn" : "info"}>{i.message}</Notice>)}
          <Panel title="Dépôts standards de Proxmox">
            <div className="row">
              {(repos.data?.["standard-repos"] ?? []).map((r: any) => (
                <Button key={r.handle} size="sm" disabled={!allowed || r.status === 1} onClick={async () => {
                  try { await pve.put(`/nodes/${node}/apt/repositories`, { handle: r.handle, digest: repos.data.digest }); toast(`Dépôt ${r.name} ajouté`, "ok"); repos.refresh(); } catch (e) { toast((e as Error).message, "error"); }
                }}>{r.status === 1 ? `${r.name} : présent` : `Ajouter ${r.name}`}</Button>
              ))}
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>Sans abonnement, active « No-Subscription » et désactive « Enterprise », sinon apt signale une erreur d&apos;authentification.</p>
          </Panel>
          {(repos.data?.files ?? []).map((f: any) => (
            <Panel key={f.path} pad={false} title={<span className="mono">{f.path}</span>}>
              <table className="table">
                <thead><tr><th>Actif</th><th>Type</th><th>Adresse</th><th>Suite</th><th>Composants</th></tr></thead>
                <tbody>
                  {f.repositories.map((r: any, i: number) => (
                    <tr key={i} className={r.Enabled ? "" : "muted"}>
                      <td><Toggle on={!!r.Enabled} label={`Activer ${r.URIs.join(" ")} ${r.Components.join(" ")}`} onChange={async (on) => {
                        if (!allowed) return;
                        try { await pve.post(`/nodes/${node}/apt/repositories`, { path: f.path, index: i, enabled: on ? 1 : 0, digest: repos.data.digest }); repos.refresh(); } catch (e) { toast((e as Error).message, "error"); }
                      }} /></td>
                      <td className="mono small">{r.Types.join(" ")}</td>
                      <td className="mono small">{r.URIs.join(" ")}</td>
                      <td className="mono small">{r.Suites.join(" ")}</td>
                      <td className="mono small">{r.Components.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}
        </div>
      )}
      {sub === "versions" && (
        <Panel pad={false} title="Versions des paquets Proxmox">
          <DataTable rows={versions.data} loading={versions.loading} rowKey={(v) => v.Package} filter="Paquet" columns={[
            { id: "pkg", header: "Paquet", sort: (v) => v.Package, cell: (v) => <span className="mono">{v.Package}</span> },
            { id: "ver", header: "Version", cell: (v) => <span className="mono">{v.OldVersion ?? v.Version}</span> },
          ]} />
        </Panel>
      )}
      {log && <Modal title={`Changements de ${log.name}`} wide onClose={() => setLog(null)} foot={<Button onClick={() => setLog(null)}>Fermer</Button>}><pre className="code" style={{ maxHeight: 420 }}>{log.text}</pre></Modal>}
    </>
  );
}

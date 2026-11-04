// Anciennes vues en lecture (disques, mises à jour), remplacées au fil de la phase 5.
import { useState } from "react";
import { Button, Empty, Meter, Notice, Panel } from "../../components/ui";
import { api, pve, usePoll } from "../../lib/api";
import { bytes } from "../../../../shared/format";

type Tab = "disques" | "maj";
export function NodeLegacy({ node, tab }: { node: string; tab: Tab }) {
  const h = usePoll(() => api(`/api/insights/server/${node}`), 30000, [node]);
  const d: any = h.data;
  const [smart, setSmart] = useState<{ dev: string; data: any } | null>(null);
  if (!d) return <Empty>Chargement…</Empty>;
  return (
    <>
          {tab === "disques" && (
            <div className="stack">
              <Panel title="Disques physiques" pad={false}>
                {d.disks.length ? (
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Disque</th><th>Modèle</th><th>Type</th><th className="num">Taille</th><th>Utilisé par</th><th>SMART</th><th>Durée de vie</th><th className="actions" /></tr></thead>
                    <tbody>
                      {d.disks.map((x: any) => (
                        <tr key={x.devpath}>
                          <td className="mono">{x.devpath}</td>
                          <td>{x.model}<div className="small muted mono">{x.serial}</div></td>
                          <td>{x.type === "nvme" ? "NVMe" : x.type === "ssd" ? "SSD" : x.type === "hdd" ? `HDD${x.rpm ? ` ${x.rpm} tr/min` : ""}` : x.type}</td>
                          <td className="num">{bytes(x.size)}</td>
                          <td className="small">{x.used || "-"}</td>
                          <td>{x.health ? <span className={["PASSED", "OK"].includes(String(x.health).toUpperCase()) ? "health-ok" : "health-bad"}>{x.health}</span> : "-"}</td>
                          <td>{typeof x.wearout === "number" ? <span className={x.wearout <= 10 ? "health-bad" : ""}>{x.wearout} % restants</span> : <span className="muted">-</span>}</td>
                          <td className="actions"><Button size="sm" onClick={async () => setSmart({ dev: x.devpath, data: await pve.get(`/nodes/${node}/disks/smart`, { disk: x.devpath }) })}>SMART</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                ) : <Empty>Aucun disque listé (droit Sys.Audit nécessaire).</Empty>}
              </Panel>
              {smart && (
                <Panel title={`Attributs SMART : ${smart.dev}`} right={<Button size="sm" variant="ghost" onClick={() => setSmart(null)}>Fermer</Button>} pad={false}>
                  {smart.data?.attributes?.length ? (
                    <table className="table">
                      <thead><tr><th>ID</th><th>Attribut</th><th className="num">Valeur</th><th className="num">Pire</th><th className="num">Seuil</th><th className="num">Brut</th><th>État</th></tr></thead>
                      <tbody>{smart.data.attributes.map((a: any) => (
                        <tr key={a.id}><td className="mono">{a.id}</td><td>{a.name}</td><td className="num">{a.value}</td><td className="num">{a.worst}</td><td className="num">{a.threshold}</td><td className="num mono">{a.raw}</td><td>{a.fail && a.fail !== "-" ? <span className="health-bad">{a.fail}</span> : "-"}</td></tr>
                      ))}</tbody>
                    </table>
                  ) : <div className="log">{smart.data?.text ?? "Pas de données SMART."}</div>}
                </Panel>
              )}
              <Panel title="Pools ZFS" pad={false}>
                {d.zfs.length ? (
                  <table className="table">
                    <thead><tr><th>Pool</th><th>État</th><th>Utilisation</th><th className="num">Fragmentation</th><th className="num">Dédup</th></tr></thead>
                    <tbody>{d.zfs.map((p: any) => (
                      <tr key={p.name}><td className="mono"><strong>{p.name}</strong></td><td><span className={p.health === "ONLINE" ? "health-ok" : "health-bad"}>{p.health}</span></td><td style={{ minWidth: 220 }}><Meter label="" value={p.alloc} max={p.size} text={`${bytes(p.alloc)} / ${bytes(p.size)}`} /></td><td className="num">{p.frag} %</td><td className="num">×{p.dedup}</td></tr>
                    ))}</tbody>
                  </table>
                ) : <Empty>Aucun pool ZFS sur ce nœud.</Empty>}
              </Panel>
            </div>
          )}

          {tab === "maj" && (
            <Panel title="Paquets à mettre à jour" pad={false} right={<span className="small muted">Liste issue de la dernière vérification automatique de Proxmox</span>}>
              {d.updates.length ? (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Paquet</th><th>Installé</th><th>Disponible</th><th>Origine</th><th>Description</th></tr></thead>
                  <tbody>{d.updates.map((u: any) => (
                    <tr key={u.Package}><td className="mono"><strong>{u.Package}</strong></td><td className="mono small muted">{u.OldVersion}</td><td className="mono small">{u.Version}</td><td>{u.Origin}</td><td className="small">{u.Title}</td></tr>
                  ))}</tbody>
                </table></div>
              ) : <Empty>Aucune mise à jour en attente.</Empty>}
              {d.updates.length > 0 && <div style={{ padding: 16 }}><Notice>Pour installer : Proxmox &gt; nœud &gt; Mises à jour &gt; « Mettre à niveau », ou <code>apt update &amp;&amp; apt full-upgrade</code> dans le shell. MyProxmox ne lance pas la mise à niveau, pour éviter de couper le serveur sans que tu le voies.</Notice></div>}
            </Panel>
          )}

    </>
  );
}

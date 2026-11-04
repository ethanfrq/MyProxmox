// Santé du serveur : tout ce que l'interface Proxmox éparpille dans plusieurs menus.
import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Empty, Meter, Notice, PageHead, Panel, Tabs } from "../components/ui";
import { api, pve, usePoll } from "../lib/api";
import { bytes, date, pct, uptime } from "../../../shared/format";

type Tab = "sante" | "disques" | "maj" | "services" | "systeme";

export function Server() {
  const nodes = usePoll(() => pve.get<any[]>("/nodes"), 0);
  const [params] = useSearchParams();
  const [node, setNode] = useState(params.get("node") ?? "");
  useEffect(() => { if (params.get("node")) setNode(params.get("node")!); }, [params]);
  const [tab, setTab] = useState<Tab>("sante");
  useEffect(() => { if (!node && nodes.data?.[0]) setNode(nodes.data[0].node); }, [nodes.data, node]);
  const h = usePoll(() => (node ? api(`/api/insights/server/${node}`) : Promise.resolve(null)), 30000, [node]);
  const d = h.data;
  const [smart, setSmart] = useState<{ dev: string; data: any } | null>(null);

  const stoppedServices = (d?.services ?? []).filter((s: any) => s.state !== "running" && s["unit-state"] !== "disabled");
  const badDisks = (d?.disks ?? []).filter((x: any) => x.health && !["PASSED", "OK"].includes(String(x.health).toUpperCase()));
  const badZfs = (d?.zfs ?? []).filter((p: any) => p.health !== "ONLINE");
  const certSoon = (d?.certificates ?? []).filter((c: any) => (c.notafter - Date.now() / 1000) / 86400 < 30);

  return (
    <>
      <PageHead
        title="Serveur"
        sub="Santé matérielle, services, mises à jour et configuration système"
        actions={(nodes.data?.length ?? 0) > 1 && (
          <select className="select input" style={{ width: 180 }} value={node} onChange={(e) => setNode(e.target.value)}>
            {nodes.data!.map((n) => <option key={n.node}>{n.node}</option>)}
          </select>
        )}
      />
      {h.error && <Notice kind="error">{h.error}</Notice>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "sante", label: "Santé" },
        { id: "disques", label: `Disques${badDisks.length + badZfs.length ? ` (${badDisks.length + badZfs.length} !)` : ""}` },
        { id: "maj", label: `Mises à jour${d?.updates?.length ? ` (${d.updates.length})` : ""}` },
        { id: "services", label: "Services" },
        { id: "systeme", label: "Système" },
      ]} />

      {!d ? <Empty>Chargement…</Empty> : (
        <>
          {tab === "sante" && (
            <div className="grid g2">
              <Panel title="Résumé">
                <div className="stack">
                  {d.status && (
                    <>
                      <Meter label="Processeur" value={d.status.cpu} max={1} text={`${pct(d.status.cpu)} · attente disque ${pct(d.status.wait ?? 0, 1)}`} />
                      <Meter label="Mémoire" value={d.status.memory.used} max={d.status.memory.total} text={`${bytes(d.status.memory.used)} / ${bytes(d.status.memory.total)}`} />
                      <Meter label="Swap" value={d.status.swap.used} max={d.status.swap.total || 1} text={`${bytes(d.status.swap.used)} / ${bytes(d.status.swap.total)}`} />
                      <Meter label="Disque système (/)" value={d.status.rootfs.used} max={d.status.rootfs.total} text={`${bytes(d.status.rootfs.used)} / ${bytes(d.status.rootfs.total)}`} />
                    </>
                  )}
                </div>
              </Panel>
              <Panel title="Points de contrôle" pad={false}>
                {[
                  { ok: !stoppedServices.length, t: "Services Proxmox", d: stoppedServices.length ? `Arrêté(s) : ${stoppedServices.map((s: any) => s.name).join(", ")}` : "Tous les services actifs tournent" },
                  { ok: !badDisks.length, t: "Santé SMART des disques", d: badDisks.length ? badDisks.map((x: any) => `${x.devpath} : ${x.health}`).join(", ") : `${d.disks.length} disque(s) sans défaut signalé` },
                  { ok: !badZfs.length, t: "Pools ZFS", d: d.zfs.length ? (badZfs.length ? badZfs.map((p: any) => `${p.name} : ${p.health}`).join(", ") : `${d.zfs.length} pool(s) ONLINE`) : "Aucun pool ZFS" },
                  { ok: !certSoon.length, t: "Certificats", d: certSoon.length ? certSoon.map((c: any) => `${c.filename} expire le ${date(c.notafter, true)}`).join(", ") : "Aucun certificat n'expire dans les 30 jours" },
                  { ok: !(d.updates?.length), t: "Mises à jour", d: d.updates?.length ? `${d.updates.length} paquet(s) à mettre à jour` : "Le système est à jour (selon la dernière vérification de Proxmox)" },
                  { ok: d.subscription?.status === "active", t: "Abonnement", d: d.subscription?.status === "active" ? `Actif (${d.subscription.level})` : "Pas d'abonnement : utilise le dépôt no-subscription", soft: true },
                ].map((x) => (
                  <div className="finding" key={x.t}>
                    <span className={`lvl ${x.ok ? "ok" : x.soft ? "info" : "warning"}`}>{x.ok ? "OK" : x.soft ? "Info" : "À voir"}</span>
                    <div><div className="t">{x.t}</div><div className="d">{x.d}</div></div>
                  </div>
                ))}
              </Panel>
            </div>
          )}

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

          {tab === "services" && (
            <Panel title="Services système" pad={false}>
              <table className="table">
                <thead><tr><th>Service</th><th>Rôle</th><th>État</th><th>Au démarrage</th></tr></thead>
                <tbody>{d.services.map((s: any) => (
                  <tr key={s.name}><td className="mono">{s.name}</td><td className="small">{s.desc}</td><td>{s.state === "running" ? <span className="badge on">Actif</span> : <span className={`badge ${s["unit-state"] === "disabled" ? "off" : "err"}`}>{s.state}</span>}</td><td className="small muted">{s["unit-state"]}</td></tr>
                ))}</tbody>
              </table>
            </Panel>
          )}

          {tab === "systeme" && d.status && (
            <div className="grid g2">
              <Panel title="Matériel et version">
                <div className="kv">
                  <div>Processeur</div><div>{d.status.cpuinfo?.model}</div>
                  <div>Cœurs / threads</div><div>{d.status.cpuinfo?.cores ?? "?"} / {d.status.cpuinfo?.cpus} ({d.status.cpuinfo?.sockets} socket)</div>
                  <div>Virtualisation</div><div>{/svm|vmx/.test(d.status.cpuinfo?.flags ?? "svm") ? "Disponible (AMD-V / VT-x)" : "Non détectée"}</div>
                  <div>Proxmox</div><div className="mono">{d.status.pveversion}</div>
                  <div>Noyau</div><div className="mono small">{d.status.kversion}</div>
                  <div>Démarrage</div><div>{d.status["boot-info"]?.mode === "efi" ? "UEFI" : "BIOS"}{d.status["boot-info"]?.secureboot ? " + Secure Boot" : ""}</div>
                  <div>Allumé depuis</div><div>{uptime(d.status.uptime)}</div>
                </div>
              </Panel>
              <Panel title="Heure, DNS et certificats">
                <div className="kv">
                  <div>Fuseau horaire</div><div>{d.time?.timezone ?? "-"}</div>
                  <div>Domaine de recherche</div><div className="mono">{d.dns?.search ?? "-"}</div>
                  <div>DNS</div><div className="mono">{[d.dns?.dns1, d.dns?.dns2, d.dns?.dns3].filter(Boolean).join(", ") || "-"}</div>
                  {d.certificates.map((c: any) => (<Fragment key={c.filename}><div>{c.filename}</div><div>Expire le {date(c.notafter, true)}{c.san?.length ? <div className="small muted">{c.san.join(", ")}</div> : null}</div></Fragment>))}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </>
  );
}

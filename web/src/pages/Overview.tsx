import { Link, useNavigate } from "react-router-dom";
import { Empty, Lvl, Meter, MiniMeter, Notice, PageHead, Panel, Status, TypeTag } from "../components/ui";
import { Sparkline } from "../components/Sparkline";
import { api, pve, usePoll } from "../lib/api";
import { useApp } from "../lib/app";
import { bytes, date, pct, rate, uptime, TASK_LABEL } from "../../../shared/format";

export function Overview() {
  const navigate = useNavigate();
  const { alerts, settings } = useApp();
  const ov = usePoll(() => api("/api/insights/overview"), 6000);
  const d = ov.data;
  const node = d?.nodes?.[0];
  const rrd = usePoll(() => (node ? pve.get<any[]>(`/nodes/${node.node}/rrddata`, { timeframe: "hour" }) : Promise.resolve([])), 60000, [node?.node]);
  const mcp = usePoll(() => (settings?.modules.mcp !== false ? api<any[]>("/api/activity", { query: { actor: "mcp" } }) : Promise.resolve([])), 15000, [settings?.modules.mcp]);
  const pts = (rrd.data ?? []).filter((p) => p.cpu !== undefined);
  const st = node?.detail;

  return (
    <>
      <PageHead title="Vue d'ensemble" sub={d ? `${d.counts.nodesOnline}/${d.counts.nodes} nœud${d.counts.nodes > 1 ? "s" : ""} en ligne · ${st?.pveversion?.split("/")[1] ? `Proxmox VE ${st.pveversion.split("/")[1]}` : ""}` : "Chargement…"} />
      {ov.error && <div style={{ marginBottom: 16 }}><Notice kind="error">Impossible de joindre Proxmox : {ov.error}</Notice></div>}

      {alerts.length > 0 && (
        <Panel title={`Alertes en cours (${alerts.length})`} right={<Link className="btn btn-sm" to="/alertes">Détails</Link>} pad={false}>
          {alerts.slice(0, 4).map((a) => (
            <div key={a.key} className="finding"><Lvl level={a.level} /><div><div className="t">{a.title}</div><div className="d">{a.message}</div></div></div>
          ))}
          {alerts.length > 4 && <div className="small muted" style={{ padding: "8px 16px" }}>… et {alerts.length - 4} autre(s)</div>}
        </Panel>
      )}
      {alerts.length > 0 && <div style={{ height: 16 }} />}

      {d && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="panel stat"><div className="label">Machines en marche</div><div className="value">{d.counts.running} <span className="muted" style={{ fontSize: 16 }}>/ {d.counts.guests}</span></div><div className="hint">{d.counts.vms} VM · {d.counts.containers} conteneurs</div></div>
          <div className="panel stat"><div className="label">Processeur</div><div className="value">{pct(node?.cpu)}</div><div className="hint">{d.allocation.vcpuRun} vCPU actifs pour {d.allocation.pcpu} threads</div></div>
          <div className="panel stat"><div className="label">Mémoire</div><div className="value">{pct(node ? node.mem / node.maxmem : 0)}</div><div className="hint">{bytes(node?.mem)} sur {bytes(node?.maxmem)}{st?.ksm?.shared ? ` · KSM ${bytes(st.ksm.shared)}` : ""}</div></div>
          <div className="panel stat"><div className="label">Stockage</div><div className="value">{pct(d.storage.total ? d.storage.used / d.storage.total : 0)}</div><div className="hint">{bytes(d.storage.used)} sur {bytes(d.storage.total)}</div></div>
        </div>
      )}

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Panel title={node ? `Serveur ${node.node}` : "Serveur"} right={node && <><Status status={node.status} /><Link className="btn btn-sm" to="/serveur">Santé</Link></>}>
          {node ? (
            <div className="stack">
              <Meter label="Processeur" value={node.cpu} max={1} text={`${pct(node.cpu)} · attente disque ${pct(st?.wait ?? 0, 1)}`} />
              <Meter label="Mémoire" value={node.mem} max={node.maxmem} text={`${bytes(node.mem)} / ${bytes(node.maxmem)}`} />
              {st?.swap?.total > 0 && <Meter label="Swap" value={st.swap.used} max={st.swap.total} text={`${bytes(st.swap.used)} / ${bytes(st.swap.total)}`} />}
              <Meter label="Disque système" value={node.disk} max={node.maxdisk} text={`${bytes(node.disk)} / ${bytes(node.maxdisk)}`} />
              {st && (
                <div className="kv">
                  <div>Processeur</div><div>{st.cpuinfo?.model} <span className="muted">({st.cpuinfo?.cpus} threads)</span></div>
                  <div>Noyau</div><div className="mono">{st["current-kernel"]?.release ?? st.kversion?.split(" ")[1]}</div>
                  <div>Démarrage</div><div>{st["boot-info"]?.mode === "efi" ? `UEFI${st["boot-info"]?.secureboot ? ", Secure Boot" : ""}` : "BIOS"}</div>
                  <div>Allumé depuis</div><div>{uptime(st.uptime)}</div>
                  <div>Charge (1/5/15 min)</div><div className="mono">{st.loadavg?.join("  ")}</div>
                </div>
              )}
            </div>
          ) : <Empty>{ov.loading ? "Chargement…" : "Aucun nœud."}</Empty>}
        </Panel>
        <Panel title="Dernière heure">
          <div className="stack">
            <Sparkline label="Processeur" values={pts.map((p) => p.cpu)} max={1} current={pct(node?.cpu)} />
            <Sparkline label="Mémoire" values={pts.map((p) => p.memused ?? p.mem ?? 0)} max={pts[0]?.memtotal ?? pts[0]?.maxmem} current={bytes(node?.mem)} />
            <Sparkline label="Réseau entrant" values={pts.map((p) => p.netin ?? 0)} current={rate(pts.at(-1)?.netin)} />
          </div>
        </Panel>
      </div>

      {d && (
        <div className="grid g3" style={{ marginBottom: 16 }}>
          <Panel title="Plus gros consommateurs" pad={false}>
            <table className="table"><tbody>
              {d.top.cpu.length ? d.top.cpu.map((g: any) => (
                <tr key={g.id} className="clickable" onClick={() => navigate(`/machines/${g.node}/${g.type}/${g.vmid}`)}>
                  <td className="name"><TypeTag type={g.type} /> <strong style={{ marginLeft: 6 }}>{g.name}</strong></td>
                  <td className="num small"><MiniMeter ratio={g.cpu} />{pct(g.cpu)}</td>
                  <td className="num small muted">{bytes(g.mem)}</td>
                </tr>
              )) : <tr><td><Empty>Rien ne tourne.</Empty></td></tr>}
            </tbody></table>
          </Panel>
          <Panel title="Allocation des ressources">
            <div className="stack">
              <Meter label="vCPU déclarés / threads physiques" value={d.allocation.vcpu} max={Math.max(d.allocation.vcpu, d.allocation.pcpu)} text={`${d.allocation.vcpu} / ${d.allocation.pcpu} (×${d.allocation.cpuRatio.toFixed(1).replace(".", ",")})`} />
              <Meter label="RAM déclarée / RAM physique" value={d.allocation.vram} max={Math.max(d.allocation.vram, d.allocation.pram)} text={`${bytes(d.allocation.vram)} / ${bytes(d.allocation.pram)}`} />
              <p className="small muted" style={{ margin: 0 }}>
                {d.allocation.ramRatio > 1
                  ? "Tu as alloué plus de RAM qu'il n'y en a. Ça passe tant que tout ne tourne pas en même temps, mais le serveur risque de swapper."
                  : "La RAM allouée tient dans la RAM physique, même si tout démarre en même temps."}
              </p>
            </div>
          </Panel>
          <Panel title="Stockages" right={<Link className="btn btn-sm" to="/stockage">Détails</Link>}>
            <div className="stack">
              {d.storages.map((s: any) => <Meter key={s.id} label={s.storage} value={s.disk} max={s.maxdisk || 1} text={`${bytes(s.disk)} / ${bytes(s.maxdisk)}`} />)}
            </div>
          </Panel>
        </div>
      )}

      <div className="grid g2">
        <Panel title="Dernières tâches" right={<Link className="btn btn-sm" to="/taches">Historique</Link>} pad={false}>
          {d?.tasks?.length ? (
            <table className="table"><tbody>
              {d.tasks.slice(0, 7).map((t: any) => (
                <tr key={t.upid}>
                  <td className="small muted" style={{ width: 110 }}>{date(t.starttime)}</td>
                  <td>{TASK_LABEL[t.type] ?? t.type} <span className="muted mono">{t.id}</span></td>
                  <td className="small muted">{t.user}</td>
                  <td className="num">{t.status ? <span className={`badge ${t.status === "OK" ? "on" : "err"}`}>{t.status === "OK" ? "OK" : "Échec"}</span> : <span className="badge warn">En cours</span>}</td>
                </tr>
              ))}
            </tbody></table>
          ) : <Empty>Aucune tâche récente.</Empty>}
        </Panel>
        {settings?.modules.mcp !== false && (
          <Panel title="Ce que Claude a fait" right={<Link className="btn btn-sm" to="/claude">Gérer</Link>} pad={false}>
            {(mcp.data ?? []).length ? (
              <table className="table"><tbody>
                {(mcp.data ?? []).slice(0, 7).map((a: any, i: number) => (
                  <tr key={i}>
                    <td className="small muted" style={{ width: 110 }}>{date(a.at)}</td>
                    <td>{a.action}</td>
                    <td className="small muted">{a.actor.replace("mcp:", "")}</td>
                    <td className="num"><span className={`badge ${a.result === "ok" ? "on" : a.result === "refusé" ? "warn" : "err"}`}>{a.result}</span></td>
                  </tr>
                ))}
              </tbody></table>
            ) : <Empty>Claude n&apos;a encore rien fait. Branche-le depuis la page Claude &amp; MCP.</Empty>}
          </Panel>
        )}
      </div>
    </>
  );
}

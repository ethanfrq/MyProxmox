// Widgets de l'écran de monitoring. Lecture seule : aucun bouton d'action.
import { Fragment, type ReactNode } from "react";
import { Gauge, LineChart, Spark } from "../../components/Chart";
import { ago, bytes, date, pct, rate, uptime, TASK_LABEL } from "../../../../shared/format";
import type { MonGuest, MonitoringData, MonNode, Point } from "../../../../shared/monitoring";
import type { WidgetId } from "../../../../shared/layouts";

export type Snap = MonitoringData & { alerts: { key: string; level: string; title: string; message: string; since?: string }[] };
export type GuestSort = "vmid" | "name" | "cpu" | "mem" | "net" | "status";
export type GuestGroup = "none" | "tag" | "node";
export interface Ctx { sort: GuestSort; group: GuestGroup }

const C = { cpu: "var(--m-orange)", mem: "var(--m-blue)", in: "var(--m-green)", out: "var(--m-orange)", io: "var(--m-amber)", load: "var(--m-violet)" };
const dur = (iso?: string) => (iso ? ago(Math.floor(Date.parse(iso) / 1000)).replace("il y a ", "depuis ") : "");
const fmtRate = (v: number | null) => (v === null ? "…" : rate(v));

function Big({ value, unit, sub, tone }: { value: ReactNode; unit?: string; sub?: ReactNode; tone?: "ok" | "warn" | "crit" }) {
  return (
    <div className="mon-kpi">
      <div className={`mon-big ${tone ?? ""}`}>{value}{unit && <small>{unit}</small>}</div>
      {sub && <div className="mon-sub">{sub}</div>}
    </div>
  );
}

const tone = (r: number, w = 0.75, c = 0.9) => (r >= c ? "crit" : r >= w ? "warn" : undefined);

function series(pts: Point[], keys: ("cpu" | "iowait" | "mem" | "netin" | "netout" | "load")[]) {
  const label = { cpu: "CPU", iowait: "Attente disque", mem: "RAM", netin: "Entrant", netout: "Sortant", load: "Charge" };
  const color = { cpu: C.cpu, iowait: C.io, mem: C.mem, netin: C.in, netout: C.out, load: C.load };
  return keys.map((k) => ({ label: label[k], color: color[k], values: pts.map((p) => p[k]) }));
}

// ── Chiffres clés ─────────────────────────────────────────────────
function Kpis({ d }: { d: Snap }) {
  const on = d.nodes.filter((n) => n.status === "online");
  const cpu = on.reduce((s, n) => s + n.cpu * n.maxcpu, 0) / Math.max(1, on.reduce((s, n) => s + n.maxcpu, 0));
  const memU = on.reduce((s, n) => s + n.mem.used, 0);
  const memT = on.reduce((s, n) => s + n.mem.total, 0);
  const stoU = d.storages.reduce((s, x) => s + x.used, 0);
  const stoT = d.storages.reduce((s, x) => s + x.total, 0);
  const netIn = on.reduce((s, n) => s + n.net.in, 0);
  const netOut = on.reduce((s, n) => s + n.net.out, 0);
  const crit = d.alerts.filter((a) => a.level === "critical").length;
  return (
    <div className="mon-kpis">
      <Big value={pct(cpu)} sub="Processeur" tone={tone(cpu)} />
      <Big value={pct(memT ? memU / memT : 0)} sub={`Mémoire · ${bytes(memU)}`} tone={tone(memT ? memU / memT : 0, 0.8, 0.92)} />
      <Big value={<>{d.counts.running}<small> / {d.counts.guests}</small></>} sub="Machines en marche" />
      <Big value={d.alerts.length} sub={crit ? `dont ${crit} critique${crit > 1 ? "s" : ""}` : "Alertes"} tone={crit ? "crit" : d.alerts.length ? "warn" : "ok"} />
      <Big value={<span className="mon-net">↓ {rate(netIn)}<br />↑ {rate(netOut)}</span>} sub="Réseau du nœud" />
      <Big value={pct(stoT ? stoU / stoT : 0)} sub={`Stockage · ${bytes(stoU)} / ${bytes(stoT)}`} tone={tone(stoT ? stoU / stoT : 0, 0.85, 0.95)} />
      <Big value={<>{d.cluster.nodesOnline}<small> / {d.cluster.nodes}</small></>} sub={d.cluster.quorate === false ? "Nœuds · quorum PERDU" : "Nœuds en ligne"} tone={d.cluster.nodesOnline < d.cluster.nodes || d.cluster.quorate === false ? "crit" : "ok"} />
      <Big value={d.failedTasks} sub={`Tâches en échec (24 h)${d.tasks.running.length ? ` · ${d.tasks.running.length} en cours` : ""}`} tone={d.failedTasks ? "warn" : "ok"} />
    </div>
  );
}

// ── Processeur ────────────────────────────────────────────────────
function NodeCpu({ n, compact }: { n: MonNode; compact: boolean }) {
  return (
    <div className="stack-s">
      {compact && <div className="mon-node-name">{n.node}</div>}
      <div className="mon-row">
        <Big value={pct(n.cpu)} sub={`${n.maxcpu} threads${n.cpuModel ? ` · ${n.cpuModel}` : ""}`} tone={tone(n.cpu)} />
        {!compact && <dl className="mon-dl">
          <dt>Charge 1 / 5 / 15 min</dt><dd className="mono">{n.loadavg.map((x) => x.toFixed(2)).join("  ") || "-"}</dd>
          <dt>Attente disque</dt><dd>{pct(n.iowait, 1)}</dd>
          {n.psi && <><dt>Pression CPU / E-S / RAM</dt><dd>{[n.psi.cpu, n.psi.io, n.psi.mem].map((v) => (v === undefined ? "-" : `${Number(v).toFixed(1)} %`)).join(" · ")}</dd></>}
        </dl>}
      </div>
      <LineChart title={`Processeur de ${n.node} sur 1 h`} series={series(n.rrd.hour, ["cpu", "iowait"])} max={1} format={(v) => pct(v)} times={n.rrd.hour.map((p) => p.t)} height={compact ? 46 : 110} />
    </div>
  );
}

// ── Mémoire ───────────────────────────────────────────────────────
function NodeMem({ n, compact }: { n: MonNode; compact: boolean }) {
  const t = n.mem.total || 1;
  const cache = n.mem.cache ?? 0;
  return (
    <div className="stack-s">
      {compact && <div className="mon-node-name">{n.node}</div>}
      <Big value={pct(n.mem.used / t)} sub={`${bytes(n.mem.used)} sur ${bytes(n.mem.total)}`} tone={tone(n.mem.used / t, 0.8, 0.92)} />
      <div className="mon-stack" aria-label="Répartition de la mémoire">
        <span className="used" style={{ width: `${(n.mem.used / t) * 100}%` }} />
        <span className="cache" style={{ width: `${(cache / t) * 100}%` }} />
      </div>
      {!compact && <div className="mon-legend">
        <span><i className="used" />Utilisée {bytes(n.mem.used)}</span>
        {n.mem.cache !== null && <span><i className="cache" />Cache {bytes(cache)}</span>}
        <span><i />Libre {bytes(n.mem.free)}</span>
      </div>}
      {!compact && <dl className="mon-dl">
        <dt>KSM (pages partagées)</dt><dd>{bytes(n.ksm)}</dd>
        <dt>Swap</dt><dd>{n.swap.total ? `${bytes(n.swap.used)} / ${bytes(n.swap.total)}` : "aucun"}</dd>
      </dl>}
      <LineChart title={`Mémoire de ${n.node} sur 1 h`} series={series(n.rrd.hour, ["mem"])} max={n.rrd.hour[0]?.memtotal || n.mem.total} format={(v) => bytes(v)} times={n.rrd.hour.map((p) => p.t)} height={compact ? 46 : 90} />
    </div>
  );
}

// ── Nœuds ─────────────────────────────────────────────────────────
const SVC: Record<string, [string, string]> = { running: ["ok", "actif"], stopped: ["crit", "arrêté"], disabled: ["off", "désactivé"], absent: ["off", "absent"] };
function Nodes({ d }: { d: Snap }) {
  return (
    <div className="stack-s">
      {d.nodes.map((n) => (
        <div key={n.node} className="mon-node">
          <div className="mon-node-head">
            <span className={`dot ${n.status === "online" ? "ok" : "crit"}`} />
            <strong>{n.node}</strong>
            <span className="mon-sub">{n.status === "online" ? `en ligne depuis ${uptime(n.uptime)}` : "HORS LIGNE"}</span>
            <span className="mon-sub" style={{ marginLeft: "auto" }}>Proxmox VE {n.version} · noyau {n.kernel}</span>
          </div>
          {n.status === "online" && (
            <div className="mon-node-gauges">
              <div><div className="mon-label">Processeur <span>{pct(n.cpu)} · charge {n.loadavg[0]?.toFixed(2) ?? "-"}</span></div><Gauge ratio={n.cpu} warn={0.75} crit={0.9} /></div>
              <div><div className="mon-label">Mémoire <span>{bytes(n.mem.used)} / {bytes(n.mem.total)}</span></div><Gauge ratio={n.mem.total ? n.mem.used / n.mem.total : 0} warn={0.8} crit={0.92} /></div>
              <div><div className="mon-label">Swap <span>{n.swap.total ? `${bytes(n.swap.used)} / ${bytes(n.swap.total)}` : "aucun"}</span></div><Gauge ratio={n.swap.total ? n.swap.used / n.swap.total : 0} warn={0.5} crit={0.8} /></div>
            </div>
          )}
          <div className="mon-row">
            <div style={{ flex: 1 }}>
              <div className="mon-label">Disque système <span>{bytes(n.rootfs.used)} / {bytes(n.rootfs.total)}</span></div>
              <Gauge ratio={n.rootfs.total ? n.rootfs.used / n.rootfs.total : 0} warn={0.8} crit={0.92} />
            </div>
            {n.updates === null ? (
              <div className="mon-pill" title="Proxmox demande le droit Sys.Modify pour lister les mises à jour. Le compte de service ne l'a pas, volontairement.">Mises à jour : non lisibles</div>
            ) : (
              <div className={`mon-pill ${n.securityUpdates ? "warn" : n.updates ? "" : "ok"}`}>
                {n.updates ? `${n.updates} mise${n.updates > 1 ? "s" : ""} à jour${n.securityUpdates ? `, dont ${n.securityUpdates} de sécurité` : ""}` : "À jour"}
              </div>
            )}
          </div>
          <div className="mon-services">
            {n.services.map((s) => <span key={s.name} className={`svc ${SVC[s.state][0]}`} title={SVC[s.state][1]}><i />{s.name}<small>{SVC[s.state][1]}</small></span>)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Cluster et HA ─────────────────────────────────────────────────
function Cluster({ d }: { d: Snap }) {
  const c = d.cluster;
  return (
    <div className="stack-s">
      <div className="mon-row">
        <Big value={c.quorate === null ? "-" : c.quorate ? "OK" : "PERDU"} sub={c.name ? `Quorum du cluster ${c.name}` : "Quorum (nœud seul)"} tone={c.quorate === false ? "crit" : "ok"} />
        <Big value={<>{c.nodesOnline}<small> / {c.nodes}</small></>} sub="Nœuds en ligne" tone={c.nodesOnline < c.nodes ? "crit" : "ok"} />
      </div>
      <div className="mon-label">Haute disponibilité</div>
      {c.ha.length ? (
        <table className="mon-table">
          <tbody>
            {c.ha.map((h) => (
              <tr key={h.sid}><td className="mono">{h.sid}</td><td className={h.state === "started" ? "ok" : h.state === "error" || h.state === "fence" ? "crit" : "warn"}>{h.state}</td><td className="mon-sub">{h.node}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <div className="mon-sub">Aucune ressource HA.</div>}
    </div>
  );
}

// ── Alertes ───────────────────────────────────────────────────────
function Alerts({ d }: { d: Snap }) {
  if (!d.alerts.length) return <div className="mon-okmsg">Aucune alerte.</div>;
  const order = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
  const list = [...d.alerts].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
  return (
    <div className="mon-list">
      {list.slice(0, 10).map((a) => (
        <div key={a.key} className="mon-alert">
          <span className={`lvl ${a.level}`}>{a.level === "critical" ? "Critique" : a.level === "warning" ? "Attention" : "Info"}</span>
          <span className="t">{a.title}</span>
          <span className="mon-sub nowrap">{dur(a.since)}</span>
        </div>
      ))}
      {list.length > 10 && <div className="mon-sub">… et {list.length - 10} autre(s)</div>}
    </div>
  );
}

// ── Machines ──────────────────────────────────────────────────────
function sortGuests(list: MonGuest[], s: GuestSort) {
  const by: Record<GuestSort, (a: MonGuest, b: MonGuest) => number> = {
    vmid: (a, b) => a.vmid - b.vmid,
    name: (a, b) => a.name.localeCompare(b.name),
    cpu: (a, b) => b.cpu * b.maxcpu - a.cpu * a.maxcpu,
    mem: (a, b) => b.mem - a.mem,
    net: (a, b) => (b.netin ?? 0) + (b.netout ?? 0) - (a.netin ?? 0) - (a.netout ?? 0),
    status: (a, b) => (a.status === b.status ? a.vmid - b.vmid : a.status === "running" ? -1 : 1),
  };
  return [...list].sort(by[s]);
}

function GuestCard({ g }: { g: MonGuest }) {
  const run = g.status === "running";
  return (
    <div className={`mon-guest ${g.status}`}>
      <div className="mon-guest-top">
        <span className="n">{g.name}</span>
        <span className="mon-sub">{g.vmid} · {g.type === "qemu" ? "VM" : "CT"}</span>
      </div>
      {run ? (
        <>
          <div className="mon-guest-cpu"><span>{pct(g.cpu)}</span><Spark values={g.spark} max={Math.max(0.25, ...g.spark)} color={C.cpu} /></div>
          <div className="s">RAM {bytes(g.mem)} / {bytes(g.maxmem)}</div>
          <div className="s">↓ {fmtRate(g.netin)} · ↑ {fmtRate(g.netout)}</div>
          <div className="s">{uptime(g.uptime)}{g.ips[0] ? ` · ${g.ips[0]}` : ""}</div>
        </>
      ) : <div className="s">arrêtée · {g.maxcpu} cœurs · {bytes(g.maxmem)}</div>}
      {g.tags.length > 0 && <div className="mon-tags">{g.tags.map((t) => <span key={t}>{t}</span>)}</div>}
    </div>
  );
}

function Guests({ d, ctx }: { d: Snap; ctx: Ctx }) {
  const list = sortGuests(d.guests, ctx.sort);
  let groups: [string, MonGuest[]][] = [["", list]];
  if (ctx.group === "node") groups = [...new Set(list.map((g) => g.node))].sort().map((n) => [n, list.filter((g) => g.node === n)]);
  if (ctx.group === "tag") {
    const tags = [...new Set(list.flatMap((g) => g.tags))].sort();
    groups = tags.map((t): [string, MonGuest[]] => [t, list.filter((g) => g.tags.includes(t))]);
    const none = list.filter((g) => !g.tags.length);
    if (none.length) groups.push(["sans tag", none]);
  }
  return (
    <div className="stack-s">
      {groups.map(([name, gs]) => (
        <Fragment key={name || "all"}>
          {name && <div className="mon-label">{name} <span>{gs.filter((g) => g.status === "running").length} / {gs.length}</span></div>}
          <div className="mon-guests">{gs.map((g) => <GuestCard key={`${name}-${g.vmid}`} g={g} />)}</div>
        </Fragment>
      ))}
    </div>
  );
}

// ── Machines en tableau ───────────────────────────────────────────
function GuestsTable({ d, ctx }: { d: Snap; ctx: Ctx }) {
  const list = sortGuests(d.guests, ctx.sort);
  const multi = new Set(d.guests.map((g) => g.node)).size > 1;
  return (
    <table className="mon-table mon-guest-table">
      <thead>
        <tr>
          <th>Machine</th>{multi && <th>Nœud</th>}<th className="num">CPU</th><th className="num">RAM</th><th className="num">Disque</th>
          <th className="num">E/S disque</th><th className="num">Réseau</th><th>Allumée depuis</th><th>Adresse IP</th>
        </tr>
      </thead>
      <tbody>
        {list.map((g) => {
          const run = g.status === "running";
          const memR = g.maxmem ? g.mem / g.maxmem : 0;
          const diskR = g.maxdisk && g.type === "lxc" ? g.disk / g.maxdisk : null;
          return (
            <tr key={g.vmid} className={run ? "" : "off"}>
              <td><span className={`dot ${run ? "ok" : g.status === "paused" ? "warn" : "off"}`} /> <strong>{g.name}</strong> <span className="mon-sub">{g.vmid} · {g.type === "qemu" ? "VM" : "CT"}</span></td>
              {multi && <td className="mon-sub">{g.node}</td>}
              <td className={`num ${run ? tone(g.cpu) ?? "" : ""}`}>{run ? <span className="mon-cell-spark">{pct(g.cpu)}<Spark values={g.spark} max={Math.max(0.25, ...g.spark)} color={C.cpu} /></span> : "-"}</td>
              <td className={`num ${run ? tone(memR, 0.85, 0.95) ?? "" : ""}`}>{run ? `${bytes(g.mem)} · ${pct(memR)}` : bytes(g.maxmem)}</td>
              <td className={`num ${diskR !== null ? tone(diskR, 0.85, 0.95) ?? "" : ""}`}>{diskR !== null ? `${pct(diskR)} de ${bytes(g.maxdisk)}` : g.maxdisk ? bytes(g.maxdisk) : "-"}</td>
              <td className="num">{run ? `↓ ${fmtRate(g.diskread)} ↑ ${fmtRate(g.diskwrite)}` : "-"}</td>
              <td className="num">{run ? `↓ ${fmtRate(g.netin)} ↑ ${fmtRate(g.netout)}` : "-"}</td>
              <td className="mon-sub">{run ? uptime(g.uptime) : g.status === "stopped" ? "arrêtée" : g.status}</td>
              <td className="mono mon-sub">{g.ips.slice(0, 2).join(", ") || "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Plus gros consommateurs ───────────────────────────────────────
function Top({ d }: { d: Snap }) {
  const run = d.guests.filter((g) => g.status === "running");
  const blocks: { title: string; value: (g: MonGuest) => number; fmt: (g: MonGuest) => string }[] = [
    { title: "Processeur", value: (g) => g.cpu, fmt: (g) => pct(g.cpu) },
    { title: "Mémoire", value: (g) => g.mem, fmt: (g) => bytes(g.mem) },
    { title: "Disque (lecture + écriture)", value: (g) => (g.diskread ?? 0) + (g.diskwrite ?? 0), fmt: (g) => rate((g.diskread ?? 0) + (g.diskwrite ?? 0)) },
    { title: "Réseau (entrant + sortant)", value: (g) => (g.netin ?? 0) + (g.netout ?? 0), fmt: (g) => rate((g.netin ?? 0) + (g.netout ?? 0)) },
  ];
  if (!run.length) return <div className="mon-sub">Aucune machine en marche.</div>;
  return (
    <div className="stack-s">
      {blocks.map((b) => {
        const list = [...run].sort((x, y) => b.value(y) - b.value(x)).slice(0, 4);
        const max = Math.max(1e-9, b.value(list[0]));
        return (
          <div key={b.title}>
            <div className="mon-label">{b.title}</div>
            {list.map((g) => (
              <div key={g.vmid} className="mon-top">
                <span className="n">{g.name}</span>
                <span className="mon-top-bar"><i style={{ width: `${(b.value(g) / max) * 100}%` }} /></span>
                <span className="num">{b.fmt(g)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Tâches ────────────────────────────────────────────────────────
const taskName = (t: { type: string; id: string }) => `${TASK_LABEL[t.type] ?? t.type}${t.id ? ` ${t.id}` : ""}`;
function Tasks({ d }: { d: Snap }) {
  const { running, failed } = d.tasks;
  return (
    <div className="stack-s">
      <div className="mon-label">En cours <span>{running.length}</span></div>
      {running.length ? (
        <div className="mon-list">
          {running.map((t) => (
            <div key={t.upid} className="mon-alert">
              <span className="dot warn" /><span className="t">{taskName(t)}<span className="mon-sub"> · {t.node} · {t.user}</span></span>
              <span className="mon-sub nowrap">{ago(t.start).replace("il y a ", "depuis ")}</span>
            </div>
          ))}
        </div>
      ) : <div className="mon-sub">Aucune tâche en cours.</div>}
      <div className="mon-label">Échecs sur 24 h <span>{failed.length}</span></div>
      {failed.length ? (
        <div className="mon-list">
          {failed.map((t) => (
            <div key={t.upid} className="mon-alert">
              <span className="dot crit" /><span className="t">{taskName(t)}<span className="mon-sub"> · {t.status}</span></span>
              <span className="mon-sub nowrap">{ago(t.start)}</span>
            </div>
          ))}
        </div>
      ) : <div className="mon-okmsg">Aucun échec.</div>}
    </div>
  );
}

// ── Réplication ───────────────────────────────────────────────────
function Replication({ d }: { d: Snap }) {
  if (!d.replication.length) return <div className="mon-sub">Aucune réplication planifiée.</div>;
  return (
    <table className="mon-table">
      <thead><tr><th>Machine</th><th>Vers</th><th>Dernière synchro</th><th className="num">Durée</th><th>Prochaine</th><th>État</th></tr></thead>
      <tbody>
        {d.replication.map((r) => (
          <tr key={r.id}>
            <td><strong>{r.name || r.guest}</strong> <span className="mon-sub">{r.id}</span></td>
            <td className="mono">{r.target}</td>
            <td>{r.lastSync ? ago(r.lastSync) : "jamais"}</td>
            <td className="num">{r.duration === null ? "-" : `${r.duration.toFixed(1)} s`}</td>
            <td className="mon-sub">{!r.enabled ? "désactivée" : r.nextSync ? new Date(r.nextSync * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
            <td className={r.failCount ? "crit" : !r.enabled ? "" : "ok"}>{r.failCount ? `${r.failCount} échec${r.failCount > 1 ? "s" : ""}${r.error ? ` : ${r.error}` : ""}` : r.enabled ? "OK" : "en pause"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Ceph ──────────────────────────────────────────────────────────
function Ceph({ d }: { d: Snap }) {
  const c = d.ceph;
  if (!c) return <div className="mon-sub">Ceph n&apos;est installé sur aucun nœud en ligne.</div>;
  const ok = c.health === "HEALTH_OK";
  return (
    <div className="stack-s">
      <div className="mon-row">
        <Big value={ok ? "OK" : c.health.replace("HEALTH_", "")} sub={`Santé Ceph (lue sur ${c.node})`} tone={ok ? "ok" : c.health === "HEALTH_ERR" ? "crit" : "warn"} />
        <Big value={<>{c.osds.up}<small> / {c.osds.total}</small></>} sub={`OSD actifs · ${c.osds.in} dans le cluster`} tone={c.osds.up < c.osds.total ? "warn" : "ok"} />
        <Big value={<>{c.pgsClean}<small> / {c.pgs}</small></>} sub="Groupes de placement propres" tone={c.pgsClean < c.pgs ? "warn" : "ok"} />
        <Big value={<span className="mon-net">↓ {rate(c.read)}<br />↑ {rate(c.write)}</span>} sub={`${c.mons} moniteur${c.mons > 1 ? "s" : ""}`} />
      </div>
      <div className="mon-label">Espace <span>{bytes(c.used)} / {bytes(c.total)}</span></div>
      <Gauge ratio={c.total ? c.used / c.total : 0} warn={0.75} crit={0.85} />
      {c.checks.map((x) => <div key={x} className="warn">{x}</div>)}
    </div>
  );
}

// ── Réseau ────────────────────────────────────────────────────────
function Network({ d }: { d: Snap }) {
  return (
    <div className="stack-s">
      {d.nodes.map((n) => (
        <div key={n.node}>
          {d.nodes.length > 1 && <div className="mon-node-name">{n.node}</div>}
          <table className="mon-table">
            <thead><tr><th>Interface</th><th>Rôle</th><th className="num">Entrant</th><th className="num">Sortant</th></tr></thead>
            <tbody>
              <tr><td className="mono">{n.bridges.map((b) => b.ports).filter(Boolean).join(", ") || "physique"}</td><td className="mon-sub">Interfaces physiques (total du nœud)</td><td className="num">{rate(n.net.in)}</td><td className="num">{rate(n.net.out)}</td></tr>
              {n.bridges.map((b) => (
                <tr key={b.name}>
                  <td className="mono">{b.name}</td>
                  <td className="mon-sub">Pont{b.comment ? ` · ${b.comment}` : ""} · {b.guests} machine{b.guests > 1 ? "s" : ""}</td>
                  <td className="num">{fmtRate(b.in)}</td><td className="num">{fmtRate(b.out)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="mon-label">Machines les plus actives</div>
      <table className="mon-table">
        <tbody>
          {sortGuests(d.guests.filter((g) => g.status === "running"), "net").slice(0, 5).map((g) => (
            <tr key={g.vmid}><td>{g.name}</td><td className="num">↓ {fmtRate(g.netin)}</td><td className="num">↑ {fmtRate(g.netout)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NetHistory({ d }: { d: Snap }) {
  const n = d.nodes.find((x) => x.status === "online");
  if (!n) return <div className="mon-sub">Aucun nœud en ligne.</div>;
  return <LineChart title="Débit réseau sur 24 h" series={series(n.rrd.day, ["netin", "netout"])} format={(v) => rate(v)} times={n.rrd.day.map((p) => p.t)} height={160} />;
}

// ── Stockage ──────────────────────────────────────────────────────
function Storage({ d }: { d: Snap }) {
  return (
    <div className="mon-stores">
      {d.storages.map((s) => {
        const r = s.total ? s.used / s.total : 0;
        return (
          <div key={s.id} className={`mon-store ${s.active ? "" : "off"}`}>
            <div className="mon-label">
              <strong>{s.storage}</strong> <span className="mon-sub">{s.type}{s.shared ? " · partagé" : ""}</span>
              <span style={{ marginLeft: "auto" }}>{s.active ? `${bytes(s.used)} / ${bytes(s.total)} · ${pct(r)}` : "HORS LIGNE"}</span>
            </div>
            <Gauge ratio={s.active ? r : 0} warn={0.85} crit={0.95} />
            <div className="mon-sub">
              {!s.active ? "Stockage indisponible : vérifie le partage réseau ou le disque."
                : s.daysToFull === null ? "Occupation stable sur 7 jours"
                : <span className={s.daysToFull < 30 ? "crit" : ""}>Plein vers le {new Date(s.fullDate! * 1000).toLocaleDateString("fr-FR")} (dans {s.daysToFull} j) au rythme actuel</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Disques ───────────────────────────────────────────────────────
function Disks({ d }: { d: Snap }) {
  return (
    <div className="stack-s">
      <div className="mon-row">
        <Big value={fmtRate(d.io.read)} sub="Lectures des machines" />
        <Big value={fmtRate(d.io.write)} sub="Écritures des machines" />
      </div>
      <table className="mon-table">
        <thead><tr><th>Disque</th><th>Santé</th><th className="num">Usure</th><th className="num">Temp.</th></tr></thead>
        <tbody>
          {d.disks.map((x) => {
            const ok = ["PASSED", "OK"].includes(x.health.toUpperCase());
            return (
              <tr key={`${x.node}${x.devpath}`}>
                <td><span className="mono">{x.devpath}</span> <span className="mon-sub">{x.model} · {bytes(x.size)}</span></td>
                <td className={ok ? "ok" : "crit"}>{ok ? "Bonne" : x.health}</td>
                <td className={`num ${x.wearout !== null && x.wearout <= 10 ? "crit" : ""}`}>{x.wearout === null ? "-" : `${100 - x.wearout} %`}</td>
                <td className={`num ${x.temperature !== null && x.temperature >= 55 ? "warn" : ""}`}>{x.temperature === null ? "-" : `${x.temperature} °C`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.zfs.length > 0 && (
        <>
          <div className="mon-label">Pools ZFS</div>
          {d.zfs.map((p) => (
            <div key={p.name} className="mon-row">
              <strong className="mono">{p.name}</strong>
              <span className={p.health === "ONLINE" ? "ok" : "crit"}>{p.health}</span>
              <span className="mon-sub">{bytes(p.alloc)} / {bytes(p.size)} · fragmentation {p.frag} %</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Sauvegardes ───────────────────────────────────────────────────
function Backups({ d }: { d: Snap }) {
  const b = d.backups;
  return (
    <div className="stack-s">
      <table className="mon-table">
        <thead><tr><th>Tâche planifiée</th><th>Dernière exécution</th><th>Prochaine</th></tr></thead>
        <tbody>
          {b.jobs.map((j) => (
            <tr key={j.id}>
              <td><strong>{j.id}</strong><div className="mon-sub">{j.schedule} → {j.storage} · {j.targets}{j.enabled ? "" : " · désactivée"}</div></td>
              <td className={j.lastStatus === "OK" ? "ok" : j.lastStatus === "en cours" ? "warn" : j.lastStatus ? "crit" : ""}>
                {j.lastRun ? <>{date(j.lastRun)}<div className="mon-sub">{j.lastStatus === "OK" ? "réussie" : j.lastStatus === "en cours" ? "en cours" : `échec : ${j.lastStatus}`}</div></> : "jamais"}
              </td>
              <td>{j.nextRun ? date(j.nextRun) : "-"}</td>
            </tr>
          ))}
          {!b.jobs.length && <tr><td colSpan={3} className="crit">Aucune sauvegarde planifiée.</td></tr>}
        </tbody>
      </table>
      <div className="mon-label">Machines non couvertes <span>{b.uncovered.length}</span></div>
      {b.uncovered.length ? <div className="mon-tags big">{b.uncovered.map((u) => <span key={u.vmid} className="warn">{u.vmid} {u.name}</span>)}</div> : <div className="mon-okmsg">Toutes les machines sont dans une sauvegarde planifiée.</div>}
    </div>
  );
}

// ── Sécurité ──────────────────────────────────────────────────────
function Security({ d }: { d: Snap }) {
  const s = d.security;
  return (
    <div className="stack-s">
      <Big value={s.failures24h} sub="Échecs de connexion à Proxmox (24 h)" tone={s.failures24h >= 5 ? "crit" : s.failures24h ? "warn" : "ok"} />
      {s.byIp.length > 0 && (
        <table className="mon-table"><tbody>{s.byIp.map(([ip, n]) => <tr key={ip}><td className="mono">{ip}</td><td className="num">{n} essai{n > 1 ? "s" : ""}</td></tr>)}</tbody></table>
      )}
      <div className="mon-label">Certificats</div>
      {s.certificates.length ? s.certificates.map((c) => (
        <div key={`${c.node}${c.filename}`} className="mon-row">
          <span className="mono">{c.filename}</span><span className="mon-sub">{c.node}</span>
          <span className={c.days < 7 ? "crit" : c.days < 30 ? "warn" : ""} style={{ marginLeft: "auto" }}>{c.days < 0 ? "expiré" : `expire dans ${c.days} j`}</span>
        </div>
      )) : <div className="mon-okmsg">Aucun certificat n'expire dans les 60 jours.</div>}
    </div>
  );
}

// ── Activité ──────────────────────────────────────────────────────
function Activity({ d }: { d: Snap }) {
  return (
    <div className="mon-list">
      {d.activity.map((a, i) => {
        const [type, ...rest] = a.label.split(" ");
        const label = a.source === "tâche" ? `${TASK_LABEL[type] ?? type} ${rest.join(" ")}` : a.label;
        return (
          <div key={`${a.at}-${i}`} className="mon-alert">
            <span className="mono mon-sub">{new Date(a.at * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
            <span className={`src ${a.source}`}>{a.source === "mcp" ? "MCP" : a.source === "myproxmox" ? "MyProxmox" : "Proxmox"}</span>
            <span className="t">{label}<span className="mon-sub"> · {a.who}</span></span>
            <span className={a.status === "ok" ? "ok" : a.status === "en cours" ? "warn" : "crit"}>{a.status}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Historique ────────────────────────────────────────────────────
function History({ d, range }: { d: Snap; range: "day" | "week" }) {
  const n = d.nodes.find((x) => x.status === "online");
  if (!n) return <div className="mon-sub">Aucun nœud en ligne.</div>;
  const pts = n.rrd[range];
  const t = pts.map((p) => p.t);
  return (
    <div className="mon-history">
      <LineChart title="Processeur" series={series(pts, ["cpu", "iowait"])} max={1} format={(v) => pct(v)} times={t} height={150} />
      <LineChart title="Mémoire" series={series(pts, ["mem"])} max={pts[0]?.memtotal || n.mem.total} format={(v) => bytes(v)} times={t} height={150} />
      <LineChart title="Réseau" series={series(pts, ["netin", "netout"])} format={(v) => rate(v)} times={t} height={150} />
      <LineChart title="Charge" series={series(pts, ["load"])} format={(v) => v.toFixed(2)} times={t} height={150} />
    </div>
  );
}

// ── Registre ──────────────────────────────────────────────────────
const perNode = (d: Snap, C: (p: { n: MonNode; compact: boolean }) => ReactNode) => {
  const on = d.nodes.filter((n) => n.status === "online");
  if (!on.length) return <div className="crit">Aucun nœud en ligne.</div>;
  return <div className="stack-s">{on.map((n) => <Fragment key={n.node}>{C({ n, compact: on.length > 1 })}</Fragment>)}</div>;
};

export const RENDER: Record<WidgetId, (d: Snap, ctx: Ctx) => ReactNode> = {
  kpis: (d) => <Kpis d={d} />,
  cpu: (d) => perNode(d, (p) => <NodeCpu {...p} />),
  memory: (d) => perNode(d, (p) => <NodeMem {...p} />),
  nodes: (d) => <Nodes d={d} />,
  cluster: (d) => <Cluster d={d} />,
  alerts: (d) => <Alerts d={d} />,
  guests: (d, ctx) => <Guests d={d} ctx={ctx} />,
  "guests-table": (d, ctx) => <GuestsTable d={d} ctx={ctx} />,
  top: (d) => <Top d={d} />,
  tasks: (d) => <Tasks d={d} />,
  replication: (d) => <Replication d={d} />,
  ceph: (d) => <Ceph d={d} />,
  network: (d) => <Network d={d} />,
  "net-history": (d) => <NetHistory d={d} />,
  storage: (d) => <Storage d={d} />,
  disks: (d) => <Disks d={d} />,
  backups: (d) => <Backups d={d} />,
  security: (d) => <Security d={d} />,
  activity: (d) => <Activity d={d} />,
  "history-24h": (d) => <History d={d} range="day" />,
  "history-7d": (d) => <History d={d} range="week" />,
};

/** Widgets touchés par une alerte (pour les encadrer en rouge). */
export function widgetsForAlert(key: string): WidgetId[] {
  const k = key.split(":")[0];
  const map: Record<string, WidgetId[]> = {
    node: ["nodes", "cluster", "kpis"], cpu: ["cpu", "kpis"], mem: ["memory", "kpis"], rootfs: ["nodes"],
    storage: ["storage", "kpis"], "storage-off": ["storage"], smart: ["disks"], wear: ["disks"], zfs: ["disks"],
    backup: ["backups"], task: ["activity", "backups", "tasks"], cert: ["security"], updates: ["nodes"], down: ["guests", "guests-table"],
    replication: ["replication"], ceph: ["ceph"],
  };
  return map[k] ?? [];
}

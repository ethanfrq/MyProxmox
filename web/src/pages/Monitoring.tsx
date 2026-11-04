// Écran de monitoring : lecture seule, rafraîchi toutes les 5 secondes, pensé
// pour rester affiché en permanence sur une TV ou un second écran.
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Meter } from "../components/ui";
import { Sparkline } from "../components/Sparkline";
import { api, usePoll } from "../lib/api";
import { bytes, date, pct, rate, uptime, TASK_LABEL } from "../../../shared/format";

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mon-clock">
      <div className="time">{now.toLocaleTimeString("fr-FR")}</div>
      <div className="date">{now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div>
    </div>
  );
}

export function Monitoring() {
  const [params] = useSearchParams();
  const key = params.get("key") ?? undefined;
  const navigate = useNavigate();
  const snap = usePoll(() => api("/api/monitoring", { query: { key } }), 5000, [key]);
  const d = snap.data;
  // Sans lien secret, l'écran suit la session : on propose de se déconnecter
  const [viewer, setViewer] = useState<{ username: string; local: boolean } | null>(null);
  useEffect(() => {
    if (key) return;
    api("/api/auth/me").then((m) => setViewer({ username: m.displayName ?? m.username, local: m.kind === "local" })).catch(() => navigate("/login?compte=local&next=/monitoring", { replace: true }));
  }, [key, navigate]);
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    navigate(viewer?.local ? "/login?compte=local" : "/login", { replace: true });
  };

  // Garde l'écran allumé, et recharge la page toutes les 6 h (mise à jour de l'app, mémoire)
  useEffect(() => {
    let lock: any = null;
    const ask = async () => {
      try { lock = await (navigator as any).wakeLock?.request("screen"); } catch { /* non pris en charge */ }
    };
    ask();
    const onVis = () => document.visibilityState === "visible" && ask();
    document.addEventListener("visibilitychange", onVis);
    const reload = setTimeout(() => location.reload(), 6 * 3600 * 1000);
    document.title = "Monitoring · MyProxmox";
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(reload); lock?.release?.(); };
  }, []);

  if (!d) {
    return (
      <div className="mon" style={{ placeItems: "center", gridTemplateRows: "1fr" }}>
        <div style={{ textAlign: "center" }}>
          <div className="brand" style={{ justifyContent: "center", fontSize: 22 }}><span className="brand-mark">P</span>MyProxmox</div>
          <p style={{ color: "#aaa", marginTop: 16 }}>{snap.error ? (snap.error.includes("Clé") ? "Lien de monitoring invalide ou expiré. Crée un nouveau lien dans Paramètres." : `Connexion impossible : ${snap.error}`) : "Chargement…"}</p>
        </div>
      </div>
    );
  }

  const node = d.nodes[0];
  const pts = node?.rrd ?? [];
  const crit = d.alerts.filter((a: any) => a.level === "critical");
  const warn = d.alerts.filter((a: any) => a.level === "warning");
  const level = crit.length ? "critical" : warn.length ? "warning" : "ok";
  const guests = [...d.guests].sort((a: any, b: any) => (a.status === b.status ? a.vmid - b.vmid : a.status === "running" ? -1 : 1));
  const stale = Date.now() - Date.parse(d.at) > 30000 || !!snap.error;

  return (
    <div className="mon">
      <div className="mon-head">
        <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
        <div style={{ color: "#aaa" }}>
          {d.nodes.map((n: any) => <span key={n.node} style={{ marginRight: 16 }}><span style={{ color: n.status === "online" ? "#6fd27a" : "#ff7b7b" }}>■</span> {n.node} · {n.status === "online" ? `en ligne depuis ${uptime(n.uptime)}` : "HORS LIGNE"}</span>)}
        </div>
        <div className="row" style={{ marginLeft: "auto", gap: 18 }}>
          <span className="small" style={{ color: stale ? "#ff9a9a" : "#777" }}>{stale ? "Données non mises à jour" : `Mis à jour ${new Date(d.at).toLocaleTimeString("fr-FR")}`}</span>
          <button className="btn btn-sm btn-dark" style={{ borderColor: "#444" }} onClick={() => document.documentElement.requestFullscreen?.()}>Plein écran</button>
          {viewer && (
            <span className="mon-who">
              {viewer.local ? <Link to="/compte" title="Mon compte">{viewer.username}</Link> : <Link to="/">{viewer.username}</Link>}
              <button type="button" onClick={logout}>Se déconnecter</button>
            </span>
          )}
          <Clock />
        </div>
      </div>

      <div className={`mon-banner ${level}`}>
        {level === "ok" ? "Tout fonctionne normalement" : `${crit.length ? `${crit.length} alerte(s) critique(s)` : ""}${crit.length && warn.length ? " · " : ""}${warn.length ? `${warn.length} point(s) à surveiller` : ""}`}
        {level !== "ok" && <span style={{ fontWeight: 400, opacity: .9 }}>{(crit[0] ?? warn[0]).title}</span>}
      </div>

      <div className="mon-grid">
        <div className="mon-card c3">
          <h3>Processeur</h3>
          <div className="mon-big">{pct(node?.cpu)}</div>
          <div className="mon-sub">{node?.maxcpu} threads · {d.allocation.vcpuRun} vCPU actifs</div>
          <div style={{ marginTop: 10 }}><Sparkline label="" values={pts.map((p: any) => p.cpu)} max={1} current="" height={56} /></div>
        </div>
        <div className="mon-card c3">
          <h3>Mémoire</h3>
          <div className="mon-big">{pct(node ? node.mem / node.maxmem : 0)}</div>
          <div className="mon-sub">{bytes(node?.mem)} sur {bytes(node?.maxmem)}</div>
          <div style={{ marginTop: 10 }}><Sparkline label="" values={pts.map((p: any) => p.memused ?? p.mem ?? 0)} max={pts[0]?.memtotal ?? pts[0]?.maxmem} current="" height={56} /></div>
        </div>
        <div className="mon-card c3">
          <h3>Machines</h3>
          <div className="mon-big">{d.counts.running}<span style={{ fontSize: 24, color: "#888" }}> / {d.counts.guests}</span></div>
          <div className="mon-sub">{d.counts.vms} VM · {d.counts.containers} conteneurs</div>
          <div className="mon-sub" style={{ marginTop: 14 }}>Tâches en échec (24 h) : <strong style={{ color: d.failedTasks ? "#ff9a9a" : "#9be3a4" }}>{d.failedTasks}</strong></div>
        </div>
        <div className="mon-card c3">
          <h3>Réseau</h3>
          <div className="mon-big" style={{ fontSize: 30 }}>↓ {rate(pts.at(-1)?.netin)}</div>
          <div className="mon-big" style={{ fontSize: 30, marginTop: 6 }}>↑ {rate(pts.at(-1)?.netout)}</div>
          <div style={{ marginTop: 10 }}><Sparkline label="" values={pts.map((p: any) => p.netin ?? 0)} current="" height={40} /></div>
        </div>

        <div className="mon-card c8">
          <h3>Machines</h3>
          <div className="mon-guests">
            {guests.map((g: any) => (
              <div key={g.vmid} className={`mon-guest ${g.status}`}>
                <div className="n">{g.name}</div>
                <div className="s">{g.vmid} · {g.type === "qemu" ? "VM" : "CT"} · {g.status === "running" ? `${pct(g.cpu)} CPU · ${bytes(g.mem)}` : "arrêtée"}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mon-card c4">
          <h3>Alertes</h3>
          {d.alerts.length ? d.alerts.slice(0, 9).map((a: any) => (
            <div key={a.key} className="mon-alert">
              <span className={`lvl ${a.level}`}>{a.level === "critical" ? "Critique" : a.level === "warning" ? "Attention" : "Info"}</span>
              <span>{a.title}</span>
            </div>
          )) : <div style={{ color: "#9be3a4" }}>Aucune alerte.</div>}
          {d.alerts.length > 9 && <div className="mon-sub">… et {d.alerts.length - 9} autre(s)</div>}
        </div>

        <div className="mon-card c4">
          <h3>Stockage</h3>
          <div className="stack">{d.storages.map((s: any) => <Meter key={s.id} label={s.storage} value={s.disk} max={s.maxdisk || 1} text={`${bytes(s.disk)} / ${bytes(s.maxdisk)}`} />)}</div>
        </div>
        <div className="mon-card c4">
          <h3>Serveur</h3>
          <div className="stack">
            {node && <Meter label="Disque système" value={node.disk} max={node.maxdisk} text={`${bytes(node.disk)} / ${bytes(node.maxdisk)}`} />}
            {node?.detail?.swap?.total > 0 && <Meter label="Swap" value={node.detail.swap.used} max={node.detail.swap.total} text={`${bytes(node.detail.swap.used)} / ${bytes(node.detail.swap.total)}`} />}
            <Meter label="RAM allouée aux machines" value={d.allocation.vram} max={Math.max(d.allocation.vram, d.allocation.pram)} text={`${bytes(d.allocation.vram)} / ${bytes(d.allocation.pram)}`} />
            <div className="mon-sub">Charge : <span className="mono">{node?.detail?.loadavg?.join("  ") ?? "-"}</span> · attente disque {pct(node?.detail?.wait ?? 0, 1)}</div>
          </div>
        </div>
        <div className="mon-card c4">
          <h3>Dernières tâches</h3>
          {d.tasks.slice(0, 6).map((t: any) => (
            <div key={t.upid} className="mon-alert">
              <span className="mono" style={{ color: "#888", minWidth: 84 }}>{date(t.starttime).split(" ")[1] ?? date(t.starttime)}</span>
              <span style={{ flex: 1 }}>{TASK_LABEL[t.type] ?? t.type} {t.id}</span>
              <span style={{ color: !t.status ? "#ffc27a" : t.status === "OK" ? "#9be3a4" : "#ff9a9a" }}>{!t.status ? "en cours" : t.status === "OK" ? "OK" : "échec"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

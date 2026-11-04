// Résumé d'un stockage : occupation, graphe sur 1 jour à 1 an, tendance, et pour un
// Proxmox Backup Server : espace, déduplication, dernière vérification.
import { useState } from "react";
import { Meter, Notice, Panel } from "../../components/ui";
import { LineChart } from "../../components/Chart";
import { pve, usePoll } from "../../lib/api";
import { bytes, date } from "../../../../shared/format";
import { forecastDays } from "../../../../shared/insights";

type Range = "day" | "week" | "month" | "year";
const RANGE: Record<Range, string> = { day: "1 jour", week: "1 semaine", month: "1 mois", year: "1 an" };

export function StorageSummary({ node, st, def }: { node: string; st: any; def?: any }) {
  const [range, setRange] = useState<Range>("week");
  const status = usePoll(() => pve.get<any>(`/nodes/${node}/storage/${st.storage}/status`), 30000, [node, st.storage]);
  const rrd = usePoll(() => pve.get<any[]>(`/nodes/${node}/storage/${st.storage}/rrddata`, { timeframe: range }), 0, [node, st.storage, range]);
  const pts = (rrd.data ?? []).filter((p) => p.used !== undefined && p.total);
  const s = status.data ?? st;
  const days = forecastDays(pts);
  const isPbs = st.type === "pbs";
  const backups = usePoll(() => (isPbs ? pve.get<any[]>(`/nodes/${node}/storage/${st.storage}/content`, { content: "backup" }) : Promise.resolve([])), 0, [node, st.storage, isPbs]);
  const logical = (backups.data ?? []).reduce((a, b) => a + (b.size ?? 0), 0);
  const verified = (backups.data ?? []).filter((b) => b.verification).sort((a, b) => b.ctime - a.ctime);
  const failed = verified.filter((b) => b.verification?.state !== "ok");
  return (
    <div className="grid g2">
      <Panel title="Occupation" right={
        <select className="input select" aria-label="Période du graphique" style={{ height: 28, width: 140 }} value={range} onChange={(e) => setRange(e.target.value as Range)}>
          {(Object.keys(RANGE) as Range[]).map((r) => <option key={r} value={r}>{RANGE[r]}</option>)}
        </select>
      }>
        <div className="stack">
          <Meter label={s.active === 0 ? "Inactif" : "Utilisé"} value={s.used ?? 0} max={s.total || 1} text={`${bytes(s.used)} / ${bytes(s.total)} · ${bytes(s.avail)} libres`} />
          <LineChart title={`Occupation sur ${RANGE[range]}`} series={[{ label: "Utilisé", color: "var(--orange)", values: pts.map((p) => p.used) }, { label: "Capacité", color: "var(--blue)", area: false, values: pts.map((p) => p.total) }]} format={(v) => bytes(v)} times={pts.map((p) => p.time)} height={150} />
          <p className="small" style={{ margin: 0 }}>
            {days === null ? <span className="muted">Occupation stable ou en baisse sur cette période.</span> : <span className={days < 30 ? "health-bad" : ""}>Au rythme de cette période, plein vers le {new Date(Date.now() + days * 86400000).toLocaleDateString("fr-FR")} (dans {days} jours).</span>}
          </p>
        </div>
      </Panel>
      <div className="stack">
        <Panel title="Détails">
          <div className="kv">
            <div>Type</div><div>{st.type}</div>
            <div>Contenu</div><div>{String(st.content ?? "").split(",").join(", ")}</div>
            <div>Partagé</div><div>{Number(st.shared) ? "Oui, entre les nœuds" : "Non, propre à ce nœud"}</div>
            {def?.path && <><div>Dossier</div><div className="mono">{def.path}</div></>}
            {def?.server && <><div>Serveur</div><div className="mono">{def.server}{def.export ? `:${def.export}` : ""}{def.share ? `/${def.share}` : ""}{def.datastore ? ` (datastore ${def.datastore})` : ""}</div></>}
            {def?.["prune-backups"] && <><div>Rétention</div><div className="mono small">{def["prune-backups"]}</div></>}
          </div>
        </Panel>
        {isPbs && (
          <Panel title="Proxmox Backup Server">
            <div className="stack">
              <div className="kv">
                <div>Espace occupé sur PBS</div><div>{bytes(s.used)} sur {bytes(s.total)}</div>
                <div>Taille des sauvegardes</div><div>{bytes(logical)} ({(backups.data ?? []).length} sauvegardes)</div>
                <div>Déduplication</div><div>{s.used ? <strong>×{(logical / s.used).toFixed(1).replace(".", ",")}</strong> : "-"} <span className="muted small">(taille des sauvegardes / espace réel)</span></div>
                <div>Dernière vérification</div><div>{verified[0] ? <>{date(verified[0].ctime, true)} : <span className={verified[0].verification.state === "ok" ? "health-ok" : "health-bad"}>{verified[0].verification.state === "ok" ? "OK" : "échec"}</span></> : "aucune"}</div>
                <div>Vérifications en échec</div><div>{failed.length ? <span className="health-bad">{failed.length}</span> : "aucune"}</div>
              </div>
              <Notice>Le nettoyage (garbage collection) et l&apos;historique complet des vérifications se consultent dans l&apos;interface de PBS{def?.server ? <> : <a className="link-btn" href={`https://${def.server}:8007`} target="_blank" rel="noreferrer">https://{def.server}:8007</a></> : "."}</Notice>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { Empty, Notice, PageHead, Panel, Status, TypeTag } from "../components/ui";
import { api, usePoll } from "../lib/api";
import { useApp } from "../lib/app";
import { ago, bytes, date } from "../../../shared/format";

export function Backups() {
  const navigate = useNavigate();
  const { settings } = useApp();
  const b = usePoll(() => api("/api/insights/backups"), 120000);
  const d = b.data;
  const maxDays = settings?.rules.backupMaxDays ?? 7;

  return (
    <>
      <PageHead title="Sauvegardes" sub={`Couverture de toutes les machines. Une sauvegarde est considérée ancienne au-delà de ${maxDays} jours (réglable dans Alertes).`} />
      {b.error && <Notice kind="error">{b.error}</Notice>}
      {!d ? <Empty>Chargement… (lecture de tous les stockages de sauvegarde)</Empty> : (
        <>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <div className="panel stat"><div className="label">Sauvegardes</div><div className="value">{d.count}</div><div className="hint">{bytes(d.totalSize)} au total</div></div>
            <div className="panel stat" style={{ borderLeftColor: d.stale ? "var(--red)" : "var(--green)" }}><div className="label">Sans sauvegarde récente</div><div className="value">{d.stale}</div><div className="hint">sur {d.rows.length} machines</div></div>
            <div className="panel stat" style={{ borderLeftColor: d.notInJob ? "var(--orange)" : "var(--green)" }}><div className="label">Hors planification</div><div className="value">{d.notInJob}</div><div className="hint">dans aucune tâche planifiée</div></div>
            <div className="panel stat"><div className="label">Snapshots de plus de 30 j</div><div className="value">{d.oldSnapshots}</div><div className="hint">ils grossissent avec le temps</div></div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)" }}>
            <Panel title="Par machine" pad={false}>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Machine</th><th>Statut</th><th>Dernière sauvegarde</th><th className="num">Nombre</th><th className="num">Taille</th><th>Planifiée</th><th>Snapshots</th></tr></thead>
                <tbody>{[...d.rows].sort((x: any, y: any) => (x.lastBackup || 0) - (y.lastBackup || 0)).map((r: any) => (
                  <tr key={r.vmid} className="clickable" onClick={() => navigate(`/machines/${r.node}/${r.type}/${r.vmid}`)}>
                    <td className="name"><TypeTag type={r.type} /> <strong style={{ marginLeft: 6 }}>{r.name}</strong> <span className="muted mono small">{r.vmid}</span></td>
                    <td><Status status={r.status} /></td>
                    <td className={r.stale ? "health-bad" : ""}>{r.lastBackup ? <>{ago(r.lastBackup)} <span className="muted small">({date(r.lastBackup)})</span></> : "Jamais"}</td>
                    <td className="num">{r.backupCount}</td>
                    <td className="num small">{bytes(r.backupSize)}</td>
                    <td>{r.inJob ? <span className="badge on">Oui</span> : <span className="badge warn">Non</span>}</td>
                    <td className="small">{r.snapshots ? <>{r.snapshots}{r.oldestSnapshot ? <span className="muted"> · plus ancien {ago(r.oldestSnapshot)}</span> : null}</> : <span className="muted">-</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </Panel>
            <Panel title="Tâches planifiées" pad={false}>
              {d.jobs.length ? d.jobs.map((j: any) => (
                <div key={j.id} className="finding" style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <div className="t">{j.id} {j.enabled ? <span className="badge on" style={{ marginLeft: 6 }}>Active</span> : <span className="badge off" style={{ marginLeft: 6 }}>Désactivée</span>}</div>
                    <div className="d">Horaire : <code>{j.schedule}</code> · vers <strong>{j.storage}</strong> · mode {j.mode ?? "snapshot"}</div>
                    <div className="d">Machines : {j.all ? "toutes" : j.vmid ?? j.pool ?? "-"}{j["next-run"] ? ` · prochaine le ${date(j["next-run"])}` : ""}</div>
                  </div>
                </div>
              )) : <Empty>Aucune sauvegarde planifiée. Crée-en une dans Proxmox : Datacenter &gt; Sauvegarde.</Empty>}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

import { Empty, Lvl, Notice, PageHead, Panel } from "../components/ui";
import { api, usePoll } from "../lib/api";
import { date } from "../../../shared/format";

export function Security() {
  const s = usePoll(() => api("/api/insights/security"), 300000);
  const d = s.data;
  return (
    <>
      <PageHead title="Sécurité" sub="Comptes, double authentification, jetons API, pare-feu, certificats et tentatives de connexion" />
      {s.error && <Notice kind="error">{s.error}</Notice>}
      {!d ? <Empty>Analyse en cours…</Empty> : (
        <div className="stack">
          <Panel title="Constats" pad={false}>
            {d.findings.map((f: any, i: number) => (
              <div key={i} className="finding"><Lvl level={f.level} /><div><div className="t">{f.title}</div><div className="d">{f.detail}</div></div></div>
            ))}
          </Panel>

          <div className="grid g2">
            <Panel title="Comptes" pad={false}>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Compte</th><th>Actif</th><th>2FA</th><th>Jetons API</th><th>Rôles</th></tr></thead>
                <tbody>{d.users.map((u: any) => (
                  <tr key={u.userid}>
                    <td className="mono">{u.userid}</td>
                    <td>{u.enabled ? "Oui" : <span className="muted">Non</span>}</td>
                    <td>{u.tfa ? <span className="health-ok">Oui</span> : <span className={u.userid === "root@pam" ? "health-bad" : "muted"}>Non</span>}</td>
                    <td className="small">{u.tokens.length ? u.tokens.map((t: any) => <div key={t.id} className="mono">{t.id.split("!")[1]}{!t.privsep && <span className="tag" style={{ marginLeft: 6 }}>tous droits</span>}{t.expire ? <span className="muted"> · exp. {date(t.expire, true)}</span> : null}</div>) : <span className="muted">-</span>}</td>
                    <td className="small">{u.roles.join(", ") || <span className="muted">-</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </Panel>
            <div className="stack">
              <Panel title="Pare-feu">
                <div className="kv">
                  <div>Datacenter</div><div>{d.firewall.datacenter === null ? "?" : d.firewall.datacenter ? <span className="health-ok">Activé</span> : <span className="health-bad">Désactivé</span>}</div>
                  {d.firewall.nodes.map((n: any) => (<FragmentRow key={n.node} k={`Nœud ${n.node}`} v={n.enabled === null ? "?" : n.enabled ? "Activé" : "Désactivé"} />))}
                </div>
              </Panel>
              <Panel title="Certificats" pad={false}>
                <table className="table"><tbody>{d.certificates.map((c: any) => (
                  <tr key={c.node + c.filename}><td className="mono small">{c.filename}<div className="muted">{c.node}</div></td><td className={c.days < 30 ? "health-bad" : ""}>{c.days < 0 ? "Expiré" : `${c.days} j restants`}</td><td className="small muted">{date(c.notafter, true)}</td></tr>
                ))}</tbody></table>
              </Panel>
            </div>
          </div>

          <Panel title={`Échecs de connexion récents (${d.failures.length})`} pad={false} right={<span className="small muted">Lus dans le journal de pvedaemon</span>}>
            {d.failures.length ? (
              <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)" }}>
                <table className="table">
                  <thead><tr><th>Adresse</th><th className="num">Essais</th></tr></thead>
                  <tbody>{d.failuresByIp.map(([ip, n]: [string, number]) => <tr key={ip}><td className="ip">{ip}</td><td className="num"><strong className={n >= 5 ? "health-bad" : ""}>{n}</strong></td></tr>)}</tbody>
                </table>
                <table className="table">
                  <thead><tr><th>Quand</th><th>Compte visé</th><th>Depuis</th></tr></thead>
                  <tbody>{d.failures.slice(0, 30).map((f: any, i: number) => <tr key={i}><td className="small mono">{f.at}</td><td className="mono small">{f.user}</td><td className="ip">{f.ip}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <Empty>Aucun échec de connexion dans le journal récent.</Empty>}
          </Panel>
        </div>
      )}
    </>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return <><div>{k}</div><div>{v}</div></>;
}

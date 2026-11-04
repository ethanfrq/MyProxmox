// Système du nœud : DNS, fichier hosts, fuseau horaire et heure.
import { useEffect, useState } from "react";
import { Button, Panel, useToast } from "../../components/ui";
import { Form } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";

const ZONES: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return ["Europe/Paris", "UTC"]; }
})();

export function NodeSystem({ node }: { node: string }) {
  const { toast } = useToast();
  const { allowed } = usePermission(`/nodes/${node}`, "Sys.Modify");
  const dns = usePoll(() => pve.get<any>(`/nodes/${node}/dns`), 0, [node]);
  const hosts = usePoll(() => pve.get<any>(`/nodes/${node}/hosts`), 0, [node]);
  const time = usePoll(() => pve.get<any>(`/nodes/${node}/time`), 30000, [node]);
  const [hostsText, setHostsText] = useState("");
  const [tz, setTz] = useState("");
  useEffect(() => { if (hosts.data) setHostsText(hosts.data.data ?? ""); }, [hosts.data]);
  useEffect(() => { if (time.data && !tz) setTz(time.data.timezone); }, [time.data, tz]);
  return (
    <div className="grid g2">
      <Panel title="DNS">
        {dns.data ? (
          <Form
            key={JSON.stringify(dns.data)}
            fields={[
              { name: "search", label: "Domaine de recherche", required: true, placeholder: "maison.lan" },
              { name: "dns1", label: "Serveur DNS 1", placeholder: "10.0.1.53" },
              { name: "dns2", label: "Serveur DNS 2", placeholder: "1.1.1.1" },
              { name: "dns3", label: "Serveur DNS 3" },
            ].map((f) => ({ ...f, readOnly: !allowed }))}
            initial={dns.data}
            onSubmit={async (v) => {
              await pve.put(`/nodes/${node}/dns`, v);
              toast("DNS enregistrés", "ok");
              dns.refresh();
            }}
          />
        ) : <span className="muted">Chargement…</span>}
      </Panel>
      <Panel title="Heure">
        <div className="stack">
          {time.data && (
            <div className="kv">
              <div>Heure du serveur</div><div>{new Date(time.data.time * 1000).toLocaleString("fr-FR", { timeZone: time.data.timezone })}</div>
              <div>Fuseau actuel</div><div>{time.data.timezone}</div>
            </div>
          )}
          <label className="field">
            <span style={{ fontSize: 12, fontWeight: 600 }}>Fuseau horaire</span>
            <select className="input select" value={tz} disabled={!allowed} onChange={(e) => setTz(e.target.value)}>{ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</select>
          </label>
          <div><Button variant="primary" disabled={!allowed || !tz || tz === time.data?.timezone} onClick={async () => {
            try { await pve.put(`/nodes/${node}/time`, { timezone: tz }); toast("Fuseau horaire enregistré", "ok"); time.refresh(); } catch (e) { toast((e as Error).message, "error"); }
          }}>Enregistrer le fuseau</Button></div>
          <p className="small muted" style={{ margin: 0 }}>L&apos;heure elle-même est synchronisée par chrony (service chronyd).</p>
        </div>
      </Panel>
      <Panel title="Fichier hosts" right={<Button size="sm" variant="primary" disabled={!allowed || hostsText === (hosts.data?.data ?? "")} onClick={async () => {
        try { await pve.post(`/nodes/${node}/hosts`, { data: hostsText, digest: hosts.data?.digest }); toast("Fichier hosts enregistré", "ok"); hosts.refresh(); } catch (e) { toast((e as Error).message, "error"); }
      }}>Enregistrer</Button>}>
        <div className="stack">
          <textarea className="input mono" aria-label="Contenu de /etc/hosts" rows={10} value={hostsText} readOnly={!allowed} onChange={(e) => setHostsText(e.target.value)} />
          <p className="small muted" style={{ margin: 0 }}>Garde la ligne qui associe l&apos;adresse du nœud à son nom : le cluster en a besoin.</p>
        </div>
      </Panel>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Empty, Notice, PageHead, Panel, Status, Tabs, TypeTag, clickable } from "../components/ui";
import { Sparkline } from "../components/Sparkline";
import { CopyButton } from "../components/ui";
import { api, pve, usePoll } from "../lib/api";
import { rate } from "../../../shared/format";

const TYPE: Record<string, string> = { bridge: "Pont", eth: "Carte réseau", bond: "Agrégat", vlan: "VLAN", loopback: "Boucle locale", OVSBridge: "Pont OVS", OVSPort: "Port OVS" };

export function Network() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"inventaire" | "interfaces">("inventaire");
  const nodes = usePoll(() => pve.get<any[]>("/nodes"), 0);
  const node = nodes.data?.[0]?.node;
  const net = usePoll(() => (node ? pve.get<any[]>(`/nodes/${node}/network`) : Promise.resolve([])), 0, [node]);
  const dns = usePoll(() => (node ? pve.get(`/nodes/${node}/dns`) : Promise.resolve(null)), 0, [node]);
  const rrd = usePoll(() => (node ? pve.get<any[]>(`/nodes/${node}/rrddata`, { timeframe: "hour" }) : Promise.resolve([])), 60000, [node]);
  const inv = usePoll(() => api<any[]>("/api/insights/inventory"), 30000);
  const [q, setQ] = useState("");
  const order = ["bridge", "eth", "bond", "vlan", "OVSBridge", "loopback"];
  const ifaces = (net.data ?? []).slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.iface.localeCompare(b.iface));
  const rows = (inv.data ?? []).filter((r) => !q || `${r.vmid} ${r.name} ${r.ips.join(" ")} ${r.nics.map((n: any) => `${n.mac} ${n.bridge}`).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const pts = (rrd.data ?? []).filter((p) => p.netin !== undefined);

  // Export CSV de l'inventaire (pratique pour la documentation du réseau)
  const csv = ["vmid;nom;type;statut;ipv4;mac;pont;vlan", ...(inv.data ?? []).map((r) => [r.vmid, r.name, r.type, r.status, r.ips.join(" "), r.nics.map((n: any) => n.mac).join(" "), r.nics.map((n: any) => n.bridge).join(" "), r.nics.map((n: any) => n.vlan).filter(Boolean).join(" ")].join(";"))].join("\n");
  const dupIps = new Set((inv.data ?? []).flatMap((r) => r.ips).filter((ip: string, i: number, a: string[]) => a.indexOf(ip) !== i));

  return (
    <>
      <PageHead title="Réseau" sub={node ? `Nœud ${node}${dns.data ? ` · DNS ${[dns.data.dns1, dns.data.dns2].filter(Boolean).join(", ")} · domaine ${dns.data.search ?? "-"}` : ""}` : ""} />
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Panel title="Trafic entrant (1 h)"><Sparkline label="Toutes interfaces" values={pts.map((p) => p.netin)} current={rate(pts.at(-1)?.netin)} /></Panel>
        <Panel title="Trafic sortant (1 h)"><Sparkline label="Toutes interfaces" values={pts.map((p) => p.netout)} current={rate(pts.at(-1)?.netout)} /></Panel>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "inventaire", label: "Adresses des machines" }, { id: "interfaces", label: "Interfaces du serveur" }]} />

      {tab === "inventaire" && (
        <Panel
          pad={false}
          title={<input className="input" style={{ width: 280, height: 30 }} placeholder="Chercher une IP, une MAC, un nom…" value={q} onChange={(e) => setQ(e.target.value)} />}
          right={<CopyButton text={csv} label="Copier en CSV" />}
        >
          {dupIps.size > 0 && <div style={{ padding: 12 }}><Notice kind="warn">Adresse(s) IP utilisée(s) par plusieurs machines : {[...dupIps].join(", ")}</Notice></div>}
          {rows.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>ID</th><th>Machine</th><th>Statut</th><th>IPv4</th><th>MAC</th><th>Pont</th><th>VLAN</th><th>Pare-feu</th><th>Source</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.vmid} className="clickable" {...clickable(() => navigate(`/machines/${r.node}/${r.type}/${r.vmid}`))}>
                  <td className="mono muted">{r.vmid}</td>
                  <td className="name"><TypeTag type={r.type} /> <strong style={{ marginLeft: 6 }}>{r.name}</strong></td>
                  <td><Status status={r.status} /></td>
                  <td className="ip">{r.ips.length ? r.ips.map((ip: string) => <div key={ip} className={dupIps.has(ip) ? "health-bad" : ""}>{ip}</div>) : <span className="muted small">{r.status !== "running" ? "-" : r.agent === false ? "agent absent" : "inconnue"}</span>}</td>
                  <td className="ip small">{r.nics.map((n: any) => <div key={n.mac}>{n.mac}</div>)}</td>
                  <td className="mono small">{r.nics.map((n: any) => n.bridge).join(", ")}</td>
                  <td className="small">{r.nics.map((n: any) => n.vlan).filter(Boolean).join(", ") || "-"}</td>
                  <td className="small">{r.nics.some((n: any) => n.firewall) ? "Oui" : <span className="muted">Non</span>}</td>
                  <td className="small muted">{{ agent: "agent", lxc: "conteneur", config: "config", aucune: "-" }[r.ipSource as string]}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty>{inv.loading ? "Chargement…" : "Aucune machine."}</Empty>}
          <div style={{ padding: 12 }} className="small muted">Les IP des VM viennent de l&apos;agent invité QEMU (à installer dans la VM : paquet <code>qemu-guest-agent</code>, puis Options &gt; Agent invité). Celles des conteneurs sont lues directement.</div>
        </Panel>
      )}

      {tab === "interfaces" && (
        <>
          <div style={{ marginBottom: 16 }}><Notice>Les <strong>ponts</strong> (vmbr) sont les switchs virtuels où se branchent les machines. Cette page est en lecture seule : une erreur de configuration réseau peut te couper l&apos;accès au serveur, donc les modifications se font dans l&apos;interface Proxmox.</Notice></div>
          {net.error && <Notice kind="error">{net.error}</Notice>}
          <Panel pad={false}>
            {ifaces.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Interface</th><th>Type</th><th>État</th><th>Adresse</th><th>Passerelle</th><th>Ports</th><th>VLAN aware</th><th>Machines branchées</th><th>Commentaire</th></tr></thead>
                <tbody>{ifaces.map((n) => {
                  const attached = n.type === "bridge" ? (inv.data ?? []).filter((r) => r.nics.some((x: any) => x.bridge === n.iface)).length : null;
                  return (
                    <tr key={n.iface}>
                      <td><strong className="mono">{n.iface}</strong></td>
                      <td>{TYPE[n.type] ?? n.type}</td>
                      <td>{n.active ? <span className="badge on">Active</span> : <span className="badge off">Inactive</span>}</td>
                      <td className="mono small">{n.cidr ?? n.address ?? (n.method === "dhcp" ? "DHCP" : "-")}</td>
                      <td className="mono small">{n.gateway ?? "-"}</td>
                      <td className="mono small">{n.bridge_ports || n.slaves || "-"}</td>
                      <td className="small">{n.type === "bridge" ? (n.bridge_vlan_aware ? "Oui" : "Non") : "-"}</td>
                      <td className="small">{attached ?? "-"}</td>
                      <td className="small muted">{n.comments ?? ""}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            ) : <Empty>{net.loading ? "Chargement…" : "Aucune interface."}</Empty>}
          </Panel>
        </>
      )}
    </>
  );
}

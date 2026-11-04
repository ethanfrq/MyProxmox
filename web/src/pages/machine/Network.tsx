// Onglet « Réseau » : adresses IP et cartes réseau.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Confirm, Empty, Field, Notice, Panel, useToast } from "../../components/ui";
import { I } from "../../components/icons";
import { api, pve, usePoll } from "../../lib/api";
import { bytes, date } from "../../../../shared/format";

export function GuestNetwork({ vmid, c }: { vmid: number; c: any }) {
  const inv = usePoll(() => api<any[]>("/api/insights/inventory"), 30000);
  const row = (inv.data ?? []).find((r) => r.vmid === vmid);
  return (
    <div className="grid g2">
      <Panel title="Adresses">
        {row ? (
          <div className="kv">
            <div>IPv4</div><div className="ip">{row.ips.length ? row.ips.join(", ") : <span className="muted">{row.status !== "running" ? "machine arrêtée" : row.agent === false ? "installe et active l'agent invité QEMU pour la voir" : "aucune"}</span>}</div>
            <div>IPv6</div><div className="ip">{row.ipv6.length ? row.ipv6.join(", ") : <span className="muted">aucune</span>}</div>
            <div>Source</div><div>{{ agent: "Agent invité QEMU", lxc: "Interfaces du conteneur", config: "Configuration (IP fixe)", aucune: "-" }[row.ipSource as string]}</div>
          </div>
        ) : <Empty>{inv.loading ? "Chargement…" : "Introuvable."}</Empty>}
      </Panel>
      <Panel title="Cartes réseau" pad={false}>
        {row?.nics?.length ? (
          <table className="table">
            <thead><tr><th>Modèle</th><th>MAC</th><th>Pont</th><th>VLAN</th><th>Pare-feu</th></tr></thead>
            <tbody>
              {row.nics.map((n: any, i: number) => (
                <tr key={i}><td>{n.model}</td><td className="ip">{n.mac}</td><td className="mono">{n.bridge}</td><td>{n.vlan || "-"}</td><td>{n.firewall ? <span className="badge on">Actif</span> : <span className="badge off">Non</span>}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{c ? "Aucune carte réseau." : "Chargement…"}</Empty>}
      </Panel>
    </div>
  );
}

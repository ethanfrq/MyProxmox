// Serveurs de métriques externes (InfluxDB, Graphite).
import { Crud, postBody, putBody } from "../../components/Crud";
import { pve } from "../../lib/api";
import type { FieldDef } from "../../components/Form";

const KEYS = ["server", "port", "disable", "influxdbproto", "organization", "bucket", "token", "path", "proto", "mtu", "timeout", "max-body-size", "verify-certificate"];
const fields = (editing: boolean): FieldDef[] => [
  { name: "id", label: "Nom", required: true, readOnly: editing },
  { name: "type", label: "Type", type: "select", readOnly: editing, default: "influxdb", options: [{ value: "influxdb", label: "InfluxDB" }, { value: "graphite", label: "Graphite" }] },
  { name: "server", label: "Serveur", required: true, placeholder: "10.0.1.20" },
  { name: "port", label: "Port", type: "number", required: true, default: 8089 },
  { name: "influxdbproto", label: "Protocole", type: "select", show: (v) => v.type === "influxdb", options: [{ value: "udp", label: "UDP (InfluxDB 1.x)" }, { value: "http", label: "HTTP (InfluxDB 2)" }, { value: "https", label: "HTTPS (InfluxDB 2)" }] },
  { name: "organization", label: "Organisation", show: (v) => v.type === "influxdb" && v.influxdbproto !== "udp" },
  { name: "bucket", label: "Bucket", show: (v) => v.type === "influxdb" && v.influxdbproto !== "udp" },
  { name: "token", label: "Jeton", type: "password", show: (v) => v.type === "influxdb" && v.influxdbproto !== "udp" },
  { name: "proto", label: "Protocole", type: "select", show: (v) => v.type === "graphite", options: [{ value: "udp", label: "UDP" }, { value: "tcp", label: "TCP" }] },
  { name: "path", label: "Préfixe", placeholder: "proxmox", show: (v) => v.type === "graphite" },
  { name: "disable", label: "Désactivé", type: "checkbox" },
  { name: "mtu", label: "MTU", type: "number", advanced: true },
  { name: "timeout", label: "Délai", type: "number", unit: "s", advanced: true },
];

export function DcMetrics() {
  return (
    <Crud<any>
      title="Serveurs de métriques"
      help="Proxmox envoie ses statistiques (CPU, RAM, réseau, disques de chaque nœud et machine) à ces serveurs, pour des graphiques longue durée dans Grafana par exemple."
      list="/cluster/metrics/server"
      rowKey={(m) => m.id}
      perm={["/", "Sys.Modify"]}
      createLabel="Ajouter un serveur"
      columns={[
        { id: "id", header: "Nom", cell: (m) => <strong>{m.id}</strong> },
        { id: "type", header: "Type", cell: (m) => (m.type === "influxdb" ? "InfluxDB" : "Graphite") },
        { id: "server", header: "Adresse", cell: (m) => <span className="mono">{m.server}:{m.port}</span> },
        { id: "proto", header: "Protocole", cell: (m) => m.influxdbproto ?? m.proto ?? "udp" },
        { id: "on", header: "État", cell: (m) => (Number(m.disable) ? <span className="badge off">désactivé</span> : <span className="badge on">actif</span>) },
      ]}
      fields={fields}
      initial={(m) => ({ ...m, disable: !!Number(m.disable) })}
      create={(v) => pve.post(`/cluster/metrics/server/${v.id}`, { type: v.type, ...postBody(v, KEYS) })}
      update={(m, v) => pve.put(`/cluster/metrics/server/${m.id}`, putBody(v, m, KEYS))}
      remove={(m) => pve.del(`/cluster/metrics/server/${m.id}`)}
    />
  );
}

// Réseau logiciel (SDN) : zones, VNets et sous-réseaux, contrôleurs, IPAM, DNS, et « Appliquer ».
import { useState } from "react";
import { Button, Confirm, Notice, Tabs, useToast } from "../../components/ui";
import { Crud, postBody, putBody } from "../../components/Crud";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import type { FieldDef } from "../../components/Form";

type Tab = "zones" | "vnets" | "controllers" | "ipams" | "dns";
const ZONE_TYPES = [{ value: "simple", label: "Simple (réseau isolé, NAT possible)" }, { value: "vlan", label: "VLAN (sur un pont existant)" }, { value: "qinq", label: "QinQ (VLAN empilés)" }, { value: "vxlan", label: "VXLAN (tunnel entre nœuds)" }, { value: "evpn", label: "EVPN (VXLAN + BGP)" }];
const nodes = async () => (await pve.get<any[]>("/nodes")).map((n) => ({ value: n.node, label: n.node }));
const ipams = async () => (await pve.get<any[]>("/cluster/sdn/ipams")).map((i) => ({ value: i.ipam, label: i.ipam }));
const changed = (r: any) => (r.state ? <span className="tag" title="Changement pas encore appliqué">en attente</span> : null);

export function DcSdn() {
  const { toast, watch } = useToast();
  const { allowed } = usePermission("/sdn", "SDN.Allocate");
  const [tab, setTab] = useState<Tab>("zones");
  const [apply, setApply] = useState(false);
  const [vnet, setVnet] = useState("");
  const [tick, setTick] = useState(0);
  const zones = usePoll(() => pve.get<any[]>("/cluster/sdn/zones", { pending: 1 }), 0, [tick]);
  const pending = (zones.data ?? []).some((z) => z.state);
  const bump = () => setTick((t) => t + 1);

  const zoneFields = (editing: boolean): FieldDef[] => [
    { name: "zone", label: "Nom", required: true, readOnly: editing, validate: (x) => (/^[a-z][a-z0-9]{0,7}$/.test(String(x)) ? null : "8 caractères au plus, minuscules et chiffres.") },
    { name: "type", label: "Type", type: "select", readOnly: editing, options: ZONE_TYPES, default: "simple" },
    { name: "bridge", label: "Pont", placeholder: "vmbr0", required: true, show: (v) => v.type === "vlan" || v.type === "qinq" },
    { name: "tag", label: "VLAN de service", type: "number", show: (v) => v.type === "qinq", required: true },
    { name: "peers", label: "Pairs VXLAN", placeholder: "10.0.1.101,10.0.1.102", show: (v) => v.type === "vxlan", required: true },
    { name: "controller", label: "Contrôleur EVPN", type: "api-select", show: (v) => v.type === "evpn", required: true, load: async () => (await pve.get<any[]>("/cluster/sdn/controllers")).map((c) => ({ value: c.controller, label: c.controller })) },
    { name: "vrf-vxlan", label: "VXLAN du VRF", type: "number", show: (v) => v.type === "evpn", required: true },
    { name: "ipam", label: "IPAM", type: "api-select", allowEmpty: "Aucun", load: ipams },
    { name: "dhcp", label: "DHCP automatique (dnsmasq)", type: "select", show: (v) => v.type === "simple", options: [{ value: "", label: "Non" }, { value: "dnsmasq", label: "Oui" }] },
    { name: "mtu", label: "MTU", type: "number", advanced: true },
    { name: "nodes", label: "Nœuds", type: "multi", load: nodes, help: "Rien de coché : tous.", advanced: true },
  ];

  return (
    <div className="stack">
      {pending && (
        <Notice kind="warn">
          Des changements SDN ne sont pas encore appliqués aux nœuds.{" "}
          <Button size="sm" variant="primary" disabled={!allowed} onClick={() => setApply(true)}>Appliquer</Button>
        </Notice>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "zones", label: "Zones" }, { id: "vnets", label: "VNets et sous-réseaux" }, { id: "controllers", label: "Contrôleurs" }, { id: "ipams", label: "IPAM" }, { id: "dns", label: "DNS" }]} />
      {tab === "zones" && (
        <Crud<any>
          title="Zones" help="Une zone définit comment les réseaux virtuels (VNets) sont transportés entre les nœuds." list="/cluster/sdn/zones" query={{ pending: 1 }} rowKey={(z) => z.zone} perm={["/sdn", "SDN.Allocate"]} createLabel="Ajouter une zone" onChange={bump}
          columns={[{ id: "zone", header: "Zone", cell: (z) => <><strong>{z.zone}</strong> {changed(z)}</> }, { id: "type", header: "Type", cell: (z) => ZONE_TYPES.find((t) => t.value === z.type)?.label.split(" (")[0] ?? z.type }, { id: "detail", header: "Détail", cell: (z) => <span className="small mono">{z.bridge ?? z.peers ?? z.controller ?? ""}</span> }, { id: "ipam", header: "IPAM", cell: (z) => z.ipam ?? "" }]}
          fields={zoneFields}
          initial={(z) => ({ ...z, nodes: String(z.nodes ?? "").split(",").filter(Boolean) })}
          create={(v) => pve.post("/cluster/sdn/zones", postBody(v, ["zone", "type", "bridge", "tag", "peers", "controller", "vrf-vxlan", "ipam", "dhcp", "mtu", "nodes"]))}
          update={(z, v) => pve.put(`/cluster/sdn/zones/${z.zone}`, putBody(v, z, ["bridge", "tag", "peers", "controller", "vrf-vxlan", "ipam", "dhcp", "mtu", "nodes"]))}
          remove={(z) => pve.del(`/cluster/sdn/zones/${z.zone}`)}
        />
      )}
      {tab === "vnets" && (
        <>
          <Crud<any>
            title="VNets" help="Un VNet est un réseau virtuel auquel on branche les machines, comme un pont." list="/cluster/sdn/vnets" query={{ pending: 1 }} rowKey={(n) => n.vnet} perm={["/sdn", "SDN.Allocate"]} createLabel="Ajouter un VNet" onChange={bump}
            columns={[{ id: "vnet", header: "VNet", cell: (n) => <><strong>{n.vnet}</strong> {changed(n)}</> }, { id: "zone", header: "Zone", cell: (n) => n.zone }, { id: "tag", header: "VLAN / VNI", cell: (n) => n.tag ?? "" }, { id: "alias", header: "Alias", cell: (n) => n.alias ?? "" }]}
            fields={(editing) => [
              { name: "vnet", label: "Nom", required: true, readOnly: editing, validate: (x) => (/^[a-z][a-z0-9]{0,7}$/.test(String(x)) ? null : "8 caractères au plus, minuscules et chiffres.") },
              { name: "zone", label: "Zone", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/cluster/sdn/zones")).map((z) => ({ value: z.zone, label: `${z.zone} (${z.type})` })) },
              { name: "tag", label: "VLAN ou VNI", type: "number", help: "Obligatoire pour les zones VLAN, QinQ, VXLAN et EVPN." },
              { name: "alias", label: "Alias" },
              { name: "vlanaware", label: "Compatible VLAN", type: "checkbox", advanced: true },
            ]}
            initial={(n) => ({ ...n, vlanaware: !!Number(n.vlanaware) })}
            create={(v) => pve.post("/cluster/sdn/vnets", postBody(v, ["vnet", "zone", "tag", "alias", "vlanaware"]))}
            update={(n, v) => pve.put(`/cluster/sdn/vnets/${n.vnet}`, putBody(v, n, ["zone", "tag", "alias", "vlanaware"]))}
            remove={(n) => pve.del(`/cluster/sdn/vnets/${n.vnet}`)}
            extraActions={(n) => <Button size="sm" variant={vnet === n.vnet ? "dark" : "default"} onClick={() => setVnet(n.vnet)}>Sous-réseaux</Button>}
          />
          {vnet && (
            <Crud<any>
              key={vnet}
              title={`Sous-réseaux de ${vnet}`} list={`/cluster/sdn/vnets/${vnet}/subnets`} rowKey={(s) => s.subnet} perm={["/sdn", "SDN.Allocate"]} createLabel="Ajouter un sous-réseau" onChange={bump}
              columns={[{ id: "cidr", header: "Réseau", cell: (s) => <span className="mono">{s.cidr ?? s.subnet}</span> }, { id: "gw", header: "Passerelle", cell: (s) => <span className="mono">{s.gateway ?? ""}</span> }, { id: "snat", header: "NAT sortant", cell: (s) => (Number(s.snat) ? "Oui" : "Non") }, { id: "dhcp", header: "Plage DHCP", cell: (s) => <span className="small mono">{(s["dhcp-range"] ?? []).join(" ")}</span> }]}
              fields={(editing) => [
                { name: "subnet", label: "Réseau", type: "cidr", required: true, readOnly: editing },
                { name: "gateway", label: "Passerelle", placeholder: "10.10.0.1" },
                { name: "snat", label: "NAT vers l'extérieur (SNAT)", type: "checkbox" },
                { name: "dhcp-range", label: "Plage DHCP", placeholder: "start-address=10.10.0.100,end-address=10.10.0.200", advanced: true },
              ]}
              initial={(s) => ({ ...s, subnet: s.cidr, snat: !!Number(s.snat), "dhcp-range": (s["dhcp-range"] ?? []).join(" ") })}
              create={(v) => pve.post(`/cluster/sdn/vnets/${vnet}/subnets`, { type: "subnet", ...postBody(v, ["subnet", "gateway", "snat", "dhcp-range"]) })}
              update={(s, v) => pve.put(`/cluster/sdn/vnets/${vnet}/subnets/${s.subnet}`, putBody(v, s, ["gateway", "snat", "dhcp-range"]))}
              remove={(s) => pve.del(`/cluster/sdn/vnets/${vnet}/subnets/${s.subnet}`)}
            />
          )}
        </>
      )}
      {tab === "controllers" && (
        <Crud<any>
          title="Contrôleurs" help="Pour les zones EVPN : le contrôleur échange les routes entre nœuds (BGP)." list="/cluster/sdn/controllers" rowKey={(c) => c.controller} perm={["/sdn", "SDN.Allocate"]} createLabel="Ajouter un contrôleur" onChange={bump}
          columns={[{ id: "c", header: "Contrôleur", cell: (c) => <strong>{c.controller}</strong> }, { id: "type", header: "Type", cell: (c) => c.type }, { id: "asn", header: "ASN", cell: (c) => c.asn ?? "" }, { id: "peers", header: "Pairs", cell: (c) => <span className="mono small">{c.peers ?? ""}</span> }]}
          fields={(editing) => [
            { name: "controller", label: "Nom", required: true, readOnly: editing },
            { name: "type", label: "Type", type: "select", readOnly: editing, options: [{ value: "evpn", label: "EVPN" }, { value: "bgp", label: "BGP" }, { value: "isis", label: "IS-IS" }], default: "evpn" },
            { name: "asn", label: "Numéro d'AS", type: "number", required: true, show: (v) => v.type !== "isis" },
            { name: "peers", label: "Pairs", placeholder: "10.0.1.101,10.0.1.102", show: (v) => v.type !== "isis" },
            { name: "node", label: "Nœud", type: "api-select", load: nodes, show: (v) => v.type !== "evpn" },
          ]}
          create={(v) => pve.post("/cluster/sdn/controllers", postBody(v, ["controller", "type", "asn", "peers", "node"]))}
          update={(c, v) => pve.put(`/cluster/sdn/controllers/${c.controller}`, putBody(v, c, ["asn", "peers", "node"]))}
          remove={(c) => pve.del(`/cluster/sdn/controllers/${c.controller}`)}
        />
      )}
      {tab === "ipams" && (
        <Crud<any>
          title="IPAM" help="Où sont gérées les adresses des sous-réseaux : l'IPAM intégré de Proxmox, NetBox ou phpIPAM." list="/cluster/sdn/ipams" rowKey={(i) => i.ipam} perm={["/sdn", "SDN.Allocate"]} createLabel="Ajouter un IPAM" canRemove={(i) => i.ipam !== "pve"} canEdit={(i) => i.type !== "pve"} onChange={bump}
          columns={[{ id: "i", header: "IPAM", cell: (i) => <strong>{i.ipam}</strong> }, { id: "type", header: "Type", cell: (i) => i.type }, { id: "url", header: "Adresse", cell: (i) => <span className="mono small">{i.url ?? ""}</span> }]}
          fields={(editing) => [
            { name: "ipam", label: "Nom", required: true, readOnly: editing },
            { name: "type", label: "Type", type: "select", readOnly: editing, options: [{ value: "netbox", label: "NetBox" }, { value: "phpipam", label: "phpIPAM" }], default: "netbox" },
            { name: "url", label: "Adresse de l'API", required: true, placeholder: "https://netbox.exemple.fr/api" },
            { name: "token", label: "Jeton", type: "password", required: !editing },
            { name: "section", label: "Section", type: "number", show: (v) => v.type === "phpipam" },
          ]}
          create={(v) => pve.post("/cluster/sdn/ipams", postBody(v, ["ipam", "type", "url", "token", "section"]))}
          update={(i, v) => pve.put(`/cluster/sdn/ipams/${i.ipam}`, putBody(v, i, ["url", "section", ...(v.token ? ["token"] : [])]))}
          remove={(i) => pve.del(`/cluster/sdn/ipams/${i.ipam}`)}
        />
      )}
      {tab === "dns" && (
        <Crud<any>
          title="DNS" help="Pour enregistrer automatiquement le nom des machines dans un serveur PowerDNS." list="/cluster/sdn/dns" rowKey={(d) => d.dns} perm={["/sdn", "SDN.Allocate"]} createLabel="Ajouter un DNS" onChange={bump}
          columns={[{ id: "d", header: "DNS", cell: (d) => <strong>{d.dns}</strong> }, { id: "type", header: "Type", cell: (d) => d.type }, { id: "url", header: "Adresse", cell: (d) => <span className="mono small">{d.url}</span> }]}
          fields={(editing) => [
            { name: "dns", label: "Nom", required: true, readOnly: editing },
            { name: "type", label: "Type", type: "select", readOnly: editing, options: [{ value: "powerdns", label: "PowerDNS" }], default: "powerdns" },
            { name: "url", label: "Adresse de l'API", required: true, placeholder: "http://10.0.1.53:8081/api/v1/servers/localhost" },
            { name: "key", label: "Clé de l'API", type: "password", required: !editing },
            { name: "ttl", label: "TTL", type: "number", unit: "s" },
          ]}
          create={(v) => pve.post("/cluster/sdn/dns", postBody(v, ["dns", "type", "url", "key", "ttl"]))}
          update={(d, v) => pve.put(`/cluster/sdn/dns/${d.dns}`, putBody(v, d, ["url", "ttl", ...(v.key ? ["key"] : [])]))}
          remove={(d) => pve.del(`/cluster/sdn/dns/${d.dns}`)}
        />
      )}
      {apply && (
        <Confirm title="Appliquer la configuration SDN ?" danger confirmLabel="Appliquer sur tous les nœuds" onConfirm={async () => {
          try { const upid = await pve.put<string>("/cluster/sdn"); watch(String(upid).split(":")[1] || "pve", upid, "Application du SDN", bump); } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setApply(false)}>
          <p>Le réseau de chaque nœud est rechargé. Les machines branchées sur un VNet modifié peuvent perdre le réseau quelques secondes.</p>
        </Confirm>
      )}
    </div>
  );
}

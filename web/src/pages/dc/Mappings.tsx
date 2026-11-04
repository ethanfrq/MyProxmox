// Mappings de ressources : PCI, USB et répertoires partagés, nœud par nœud.
import { useState } from "react";
import { Tabs } from "../../components/ui";
import { Crud } from "../../components/Crud";
import { pve } from "../../lib/api";
import type { FieldDef, Values } from "../../components/Form";

type Kind = "pci" | "usb" | "dir";
const HELP: Record<Kind, string> = {
  pci: "Un mappage PCI donne un nom à un périphérique (carte graphique, contrôleur) sur chaque nœud : une VM qui l'utilise peut alors migrer entre nœuds qui ont le même matériel.",
  usb: "Un mappage USB nomme un périphérique USB (onduleur, clé Zigbee) sur chaque nœud.",
  dir: "Un mappage de répertoire nomme un dossier du serveur, partagé avec les VM par VirtIO-FS (Proxmox VE 8.4 ou plus récent).",
};

function mapFields(kind: Kind, editing: boolean): FieldDef[] {
  const nodes = async () => (await pve.get<any[]>("/nodes")).map((n) => ({ value: n.node, label: n.node }));
  return [
    { name: "id", label: "Nom", required: true, readOnly: editing, validate: (x) => (/^[a-zA-Z][\w-]*$/.test(String(x)) ? null : "Lettres, chiffres, - et _.") },
    { name: "description", label: "Description", full: true },
    { name: "node", label: "Nœud", type: "api-select", load: nodes, required: true },
    ...(kind === "pci" ? [{ name: "device", label: "Périphérique PCI", type: "api-select" as const, loadDeps: ["node"], required: true, load: async (v: Values) => (v.node ? (await pve.get<any[]>(`/nodes/${v.node}/hardware/pci`)).map((d) => ({ value: `${d.id}|${d.vendor ?? d.id}`, label: `${d.id} · ${d.vendor_name ?? ""} ${d.device_name ?? ""}` })) : []) }] : []),
    ...(kind === "usb" ? [{ name: "device", label: "Périphérique USB", type: "api-select" as const, loadDeps: ["node"], required: true, load: async (v: Values) => (v.node ? (await pve.get<any[]>(`/nodes/${v.node}/hardware/usb`)).map((d) => ({ value: `${d.vendid}:${d.prodid}`, label: `${d.vendid}:${d.prodid} · ${d.manufacturer ?? ""} ${d.product ?? ""}` })) : []) }] : []),
    ...(kind === "dir" ? [{ name: "path", label: "Dossier sur ce nœud", required: true, placeholder: "/tank/media" }] : []),
  ];
}
function mapValue(kind: Kind, v: Values) {
  if (kind === "pci") { const [path] = String(v.device).split("|"); return `node=${v.node},path=${path}`; }
  if (kind === "usb") return `node=${v.node},id=${v.device}`;
  return `node=${v.node},path=${v.path}`;
}

export function DcMappings() {
  const [kind, setKind] = useState<Kind>("pci");
  return (
    <>
      <Tabs value={kind} onChange={setKind} tabs={[{ id: "pci", label: "PCI" }, { id: "usb", label: "USB" }, { id: "dir", label: "Répertoires" }]} />
      <Crud<any>
        key={kind}
        title={kind === "pci" ? "Mappages PCI" : kind === "usb" ? "Mappages USB" : "Mappages de répertoires"}
        help={HELP[kind]}
        list={`/cluster/mapping/${kind}`}
        rowKey={(m) => m.id}
        perm={["/mapping", "Mapping.Modify"]}
        columns={[
          { id: "id", header: "Nom", sort: (m) => m.id, cell: (m) => <strong>{m.id}</strong> },
          { id: "desc", header: "Description", cell: (m) => m.description },
          { id: "map", header: "Par nœud", cell: (m) => <span className="mono small">{(m.map ?? []).join(" · ")}</span> },
        ]}
        fields={(editing) => mapFields(kind, editing)}
        initial={(m) => { const first = String((m.map ?? [])[0] ?? ""); const pr = Object.fromEntries(first.split(",").map((x) => x.split("="))); return { id: m.id, description: m.description, node: pr.node, device: pr.path ?? pr.id, path: pr.path }; }}
        create={(v) => pve.post(`/cluster/mapping/${kind}`, { id: v.id, description: v.description || undefined, map: mapValue(kind, v) })}
        update={(m, v) => pve.put(`/cluster/mapping/${kind}/${m.id}`, { description: v.description ?? "", map: [...(m.map ?? []).filter((x: string) => !x.startsWith(`node=${v.node},`)), mapValue(kind, v)].join(",") })}
        remove={(m) => pve.del(`/cluster/mapping/${kind}/${m.id}`)}
        removeText={() => <p>Les machines qui utilisent ce mappage ne trouveront plus leur périphérique.</p>}
      />
    </>
  );
}

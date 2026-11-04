// Réseau du nœud : ponts, bonds, VLAN, OVS. Les changements sont préparés, montrés sous forme
// de diff de /etc/network/interfaces, puis appliqués après une confirmation forte.
import { useState } from "react";
import { Button, Confirm, Modal, Notice, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form, type FieldDef, type Values } from "../../components/Form";
import { I } from "../../components/icons";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";

type Kind = "bridge" | "bond" | "vlan" | "OVSBridge" | "OVSBond" | "OVSIntPort";
const KIND_LABEL: Record<string, string> = { bridge: "Pont Linux", bond: "Bond Linux", vlan: "VLAN Linux", eth: "Carte réseau", loopback: "Boucle locale", OVSBridge: "Pont OVS", OVSBond: "Bond OVS", OVSIntPort: "Port interne OVS", OVSPort: "Port OVS" };
const BOND_MODES = ["balance-rr", "active-backup", "balance-xor", "broadcast", "802.3ad", "balance-tlb", "balance-alb"].map((m) => ({ value: m, label: m === "802.3ad" ? "802.3ad (LACP, demande un switch compatible)" : m === "active-backup" ? "active-backup (secours, sans config du switch)" : m }));

function fieldsFor(kind: string, editing: boolean): FieldDef[] {
  const ip: FieldDef[] = [
    { name: "cidr", label: "Adresse IPv4", type: "cidr", help: "Vide : pas d'adresse sur cette interface." },
    { name: "gateway", label: "Passerelle IPv4", placeholder: "10.0.1.1", help: "Une seule passerelle par nœud." },
    { name: "cidr6", label: "Adresse IPv6", type: "cidr", advanced: true },
    { name: "gateway6", label: "Passerelle IPv6", advanced: true },
  ];
  const common: FieldDef[] = [
    { name: "autostart", label: "Démarrer automatiquement", type: "checkbox", default: true },
    { name: "comments", label: "Commentaire", full: true },
    { name: "mtu", label: "MTU", type: "number", min: 576, max: 65535, advanced: true },
  ];
  const name: FieldDef = { name: "iface", label: "Nom", required: true, readOnly: editing, placeholder: kind === "bridge" || kind === "OVSBridge" ? "vmbr2" : kind === "bond" || kind === "OVSBond" ? "bond0" : kind === "vlan" ? "vmbr0.20" : "vlan20", validate: (x) => (/^[a-zA-Z][\w.:-]{0,19}$/.test(String(x)) ? null : "Lettres, chiffres, point et tiret ; 20 caractères au plus.") };
  switch (kind) {
    case "bridge": return [name, ...ip, { name: "bridge_ports", label: "Ports du pont", placeholder: "enp3s0", help: "Cartes réseau reliées au pont, séparées par des espaces. Vide : pont isolé." }, { name: "bridge_vlan_aware", label: "Pont compatible VLAN", type: "checkbox" }, ...common];
    case "bond": return [name, ...ip, { name: "slaves", label: "Cartes du bond", required: true, placeholder: "enp3s0 enp4s0" }, { name: "bond_mode", label: "Mode", type: "select", options: BOND_MODES, default: "active-backup" }, { name: "bond-primary", label: "Carte principale", advanced: true, show: (v) => v.bond_mode === "active-backup" }, { name: "bond_xmit_hash_policy", label: "Répartition", type: "select", advanced: true, options: [{ value: "", label: "Par défaut" }, { value: "layer2", label: "layer2" }, { value: "layer2+3", label: "layer2+3" }, { value: "layer3+4", label: "layer3+4" }] }, ...common];
    case "vlan": return [name, ...ip, { name: "vlan-raw-device", label: "Interface parente", placeholder: "vmbr0", help: "Vide si le nom est de la forme parent.VLAN (ex. vmbr0.20)." }, { name: "vlan-id", label: "Numéro de VLAN", type: "number", min: 1, max: 4094 }, ...common];
    case "OVSBridge": return [name, ...ip, { name: "ovs_ports", label: "Ports OVS", placeholder: "enp3s0 vlan20" }, { name: "ovs_options", label: "Options OVS", advanced: true }, ...common];
    case "OVSBond": return [name, { name: "ovs_bridge", label: "Pont OVS", required: true, placeholder: "vmbr1" }, { name: "ovs_bonds", label: "Cartes du bond", required: true, placeholder: "enp3s0 enp4s0" }, { name: "bond_mode", label: "Mode", type: "select", options: [{ value: "active-backup", label: "active-backup" }, { value: "balance-slb", label: "balance-slb" }, { value: "lacp-balance-slb", label: "LACP (balance-slb)" }, { value: "lacp-balance-tcp", label: "LACP (balance-tcp)" }] }, { name: "ovs_tag", label: "VLAN", type: "number", min: 1, max: 4094 }, ...common];
    case "OVSIntPort": return [name, ...ip, { name: "ovs_bridge", label: "Pont OVS", required: true, placeholder: "vmbr1" }, { name: "ovs_tag", label: "VLAN", type: "number", min: 1, max: 4094 }, ...common];
    default: return [name, ...ip, ...common];
  }
}

function toParams(kind: string, v: Values, before?: Values) {
  const keys = ["cidr", "gateway", "cidr6", "gateway6", "comments", "mtu", "bridge_ports", "slaves", "bond_mode", "bond-primary", "bond_xmit_hash_policy", "vlan-raw-device", "vlan-id", "ovs_ports", "ovs_options", "ovs_bridge", "ovs_bonds", "ovs_tag"];
  const body: Record<string, unknown> = { type: kind, autostart: v.autostart ? 1 : 0 };
  if (kind === "bridge") body.bridge_vlan_aware = v.bridge_vlan_aware ? 1 : 0;
  const del: string[] = [];
  for (const k of keys) {
    const x = v[k];
    if (x === undefined || x === "") { if (before && before[k] !== undefined && before[k] !== "") del.push(k); } else body[k] = x;
  }
  if (del.length) body.delete = del.join(",");
  return body;
}

/** Ne garde que les lignes modifiées et 3 lignes de contexte autour, comme un diff unifié. */
function compactDiff(text: string, ctx = 3) {
  const lines = text.split("\n");
  const changed = (l: string) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---"));
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (i < 2 || changed(l)) for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep.add(k);
  });
  const out: string[] = [];
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!keep.has(i)) continue;
    if (last >= 0 && i > last + 1) out.push("@@ … @@");
    out.push(lines[i]);
    last = i;
  }
  return out;
}

export function NodeNetwork({ node }: { node: string }) {
  const { toast, watch } = useToast();
  const { allowed } = usePermission(`/nodes/${node}`, "Sys.Modify");
  const net = usePoll(() => pve.get<{ data: any[]; changes: string | null }>(`/nodes/${node}/network`, { _full: 1 }), 0, [node]);
  const [edit, setEdit] = useState<{ kind: string; row?: any } | null>(null);
  const [menu, setMenu] = useState(false);
  const [del, setDel] = useState<any | null>(null);
  const [apply, setApply] = useState(false);
  const [revert, setRevert] = useState(false);
  const list = net.data?.data ?? [];
  const changes = net.data?.changes;

  return (
    <div className="stack">
      {changes && (
        <Panel title="Changements en attente" right={
          <span className="row">
            <Button size="sm" disabled={!allowed} onClick={() => setRevert(true)}>Annuler les changements</Button>
            <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setApply(true)}>Appliquer</Button>
          </span>
        }>
          <div className="stack">
            <Notice kind="warn">Rien n&apos;est encore appliqué. Voici la différence entre le fichier actuel et le nouveau <code>/etc/network/interfaces</code>. Relis-la : une erreur peut couper l&apos;accès au serveur.</Notice>
            <pre className="diff">{compactDiff(changes).map((l, i) => <span key={i} className={l.startsWith("@@") ? "hunk" : l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : ""}>{l}{"\n"}</span>)}</pre>
          </div>
        </Panel>
      )}
      <Panel pad={false} title="Interfaces" right={
        <div style={{ position: "relative" }}>
          <Button size="sm" variant="primary" icon={<I.plus />} disabled={!allowed} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Créer</Button>
          {menu && (
            <div className="ctx-menu" role="menu" style={{ position: "absolute", right: 0, top: 32 }}>
              {(["bridge", "bond", "vlan", "OVSBridge", "OVSBond", "OVSIntPort"] as Kind[]).map((k) => <button key={k} role="menuitem" type="button" onClick={() => { setMenu(false); setEdit({ kind: k }); }}>{KIND_LABEL[k]}</button>)}
            </div>
          )}
        </div>
      }>
        <DataTable
          rows={net.data ? list : null}
          loading={net.loading}
          error={net.error}
          rowKey={(i) => i.iface}
          initialSort={{ id: "iface", dir: "asc" }}
          filter={false}
          columns={[
            { id: "iface", header: "Nom", sort: (i) => i.iface, cell: (i) => <strong className="mono">{i.iface}</strong> },
            { id: "type", header: "Type", sort: (i) => i.type, cell: (i) => KIND_LABEL[i.type] ?? i.type },
            { id: "active", header: "Actif", cell: (i) => (i.active ? <span className="badge on">Oui</span> : <span className="badge off">Non</span>) },
            { id: "auto", header: "Auto", cell: (i) => (i.autostart ? "Oui" : "Non") },
            { id: "ports", header: "Ports / esclaves", cell: (i) => <span className="mono small">{i.bridge_ports ?? i.slaves ?? i.ovs_ports ?? i["vlan-raw-device"] ?? ""}</span> },
            { id: "vlan", header: "VLAN", cell: (i) => (i.bridge_vlan_aware ? "compatible" : i["vlan-id"] ?? "") },
            { id: "cidr", header: "Adresse", sort: (i) => i.cidr ?? "", cell: (i) => <span className="mono">{i.cidr ?? ""}{i.cidr6 ? <div className="small muted">{i.cidr6}</div> : null}</span> },
            { id: "gw", header: "Passerelle", cell: (i) => <span className="mono">{i.gateway ?? ""}</span> },
            { id: "comments", header: "Commentaire", cell: (i) => <span className="small">{i.comments}</span> },
          ]}
          actions={(i) => (i.type === "loopback" ? null : (
            <span className="btn-group">
              <Button size="sm" disabled={!allowed} onClick={() => setEdit({ kind: i.type, row: i })}>Modifier</Button>
              {i.type !== "eth" && <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(i)}>Supprimer</Button>}
            </span>
          ))}
        />
      </Panel>

      {edit && (
        <Modal title={edit.row ? `${KIND_LABEL[edit.kind] ?? edit.kind} ${edit.row.iface}` : `Créer : ${KIND_LABEL[edit.kind]}`} wide onClose={() => setEdit(null)}>
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>Le changement est préparé : il ne s&apos;applique qu&apos;après « Appliquer ».</p>
            <Form
              fields={fieldsFor(edit.kind, !!edit.row)}
              initial={edit.row ? { ...edit.row, autostart: !!edit.row.autostart, bridge_vlan_aware: !!edit.row.bridge_vlan_aware } : undefined}
              submitLabel="Préparer le changement"
              onCancel={() => setEdit(null)}
              onSubmit={async (_c, v) => {
                if (edit.row) await pve.put(`/nodes/${node}/network/${edit.row.iface}`, toParams(edit.kind, v, edit.row));
                else await pve.post(`/nodes/${node}/network`, { iface: v.iface, ...toParams(edit.kind, v) });
                toast("Changement préparé : vérifie le diff puis applique", "ok");
                setEdit(null);
                net.refresh();
              }}
            />
          </div>
        </Modal>
      )}
      {del && <Confirm title={`Supprimer ${del.iface} ?`} danger confirmLabel="Préparer la suppression" onConfirm={async () => { try { await pve.del(`/nodes/${node}/network/${del.iface}`); net.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDel(null)}><p>La suppression est préparée et n&apos;est appliquée qu&apos;avec « Appliquer ». Les machines branchées sur cette interface perdront le réseau.</p></Confirm>}
      {revert && <Confirm title="Annuler les changements en attente ?" confirmLabel="Annuler les changements" onConfirm={async () => { try { await pve.del(`/nodes/${node}/network`); toast("Changements annulés", "ok"); net.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setRevert(false)}><p>Le fichier en attente est supprimé ; la configuration actuelle reste en place.</p></Confirm>}
      {apply && (
        <Confirm
          title={`Appliquer la nouvelle configuration réseau de ${node} ?`}
          danger
          requireText={node}
          confirmLabel="Appliquer maintenant"
          onConfirm={async () => {
            try {
              const upid = await pve.put<string>(`/nodes/${node}/network`);
              if (typeof upid === "string") watch(node, upid, "Réseau appliqué", net.refresh); else net.refresh();
            } catch (e) { toast(`${(e as Error).message}. La configuration précédente reste active.`, "error"); }
          }}
          onClose={() => setApply(false)}
        >
          <p><strong>Risque de perte d&apos;accès.</strong> Si l&apos;adresse, la passerelle ou le pont qui porte l&apos;interface de gestion est faux, ce serveur, Proxmox et MyProxmox deviennent injoignables. Il faudra alors corriger sur place, avec un écran et un clavier.</p>
          <p>Proxmox applique les changements à chaud (ifreload). Les machines branchées sur une interface modifiée peuvent perdre le réseau quelques secondes.</p>
        </Confirm>
      )}
    </div>
  );
}

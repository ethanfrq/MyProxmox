// Résumé du datacenter : cluster, quorum, corosync, ressources ; créer ou rejoindre un cluster.
import { useState } from "react";
import { Button, CopyButton, Empty, Meter, Modal, Notice, Panel, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { bytes } from "../../../../shared/format";

/** Informations de jonction, au même format que l'interface de Proxmox (JSON en base64). */
function joinString(j: any) {
  const self = j.nodelist.find((n: any) => n.name === j.preferred_node) ?? j.nodelist[0];
  const info = { ipAddress: self.pve_addr, fingerprint: self.pve_fp, peerLinks: { 0: self.ring0_addr }, ring_addr: [self.ring0_addr], totem: j.totem };
  return btoa(JSON.stringify(info));
}

export function DcSummary() {
  const { toast, watch } = useToast();
  const { allowed } = usePermission("/", "Sys.Modify");
  const status = usePoll(() => pve.get<any[]>("/cluster/status"), 10000);
  const res = usePoll(() => pve.get<any[]>("/cluster/resources"), 15000);
  const cnodes = usePoll(() => pve.get<any[]>("/cluster/config/nodes").catch(() => []), 0);
  const totem = usePoll(() => pve.get<any>("/cluster/config/totem").catch(() => null), 0);
  const [join, setJoin] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [joinOther, setJoinOther] = useState(false);
  const cluster = (status.data ?? []).find((x) => x.type === "cluster");
  const nodes = (status.data ?? []).filter((x) => x.type === "node");
  const r = res.data ?? [];
  const nres = r.filter((x) => x.type === "node");
  const guests = r.filter((x) => (x.type === "qemu" || x.type === "lxc") && !x.template);
  const seen = new Set<string>();
  const stores = r.filter((x) => x.type === "storage").filter((x) => { const k = x.shared ? x.storage : x.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const sum = (l: any[], k: string) => l.reduce((a, x) => a + (x[k] ?? 0), 0);
  const cpu = sum(nres.map((n) => ({ v: (n.cpu ?? 0) * (n.maxcpu ?? 0) })), "v") / Math.max(1, sum(nres, "maxcpu"));

  return (
    <div className="stack">
      <div className="grid g2">
        <Panel title="Cluster" right={cluster
          ? <Button size="sm" disabled={!allowed} onClick={async () => { try { setJoin(joinString(await pve.get("/cluster/config/join"))); } catch (e) { toast((e as Error).message, "error"); } }}>Informations de jonction</Button>
          : <span className="row"><Button size="sm" variant="primary" disabled={!allowed} onClick={() => setCreate(true)}>Créer un cluster</Button><Button size="sm" disabled={!allowed} onClick={() => setJoinOther(true)}>Rejoindre un cluster</Button></span>}>
          {cluster ? (
            <div className="kv">
              <div>Nom</div><div><strong>{cluster.name}</strong></div>
              <div>Quorum</div><div>{cluster.quorate ? <span className="badge on">Atteint</span> : <span className="badge err">Perdu</span>}</div>
              <div>Nœuds</div><div>{nodes.filter((n) => n.online).length} en ligne sur {cluster.nodes}</div>
              <div>Version de la config</div><div>{cluster.version}</div>
              {totem.data && <><div>Corosync</div><div className="small">transport {totem.data.transport ?? "knet"}, chiffrement {totem.data.secauth === "on" ? "actif" : "inactif"}, IP {totem.data.ip_version}</div></>}
            </div>
          ) : <Notice>Ce nœud est seul : il ne fait pas partie d&apos;un cluster. Un cluster permet la migration à chaud, la réplication et la haute disponibilité (trois nœuds conseillés).</Notice>}
        </Panel>
        <Panel title="Ressources du datacenter">
          {res.data ? (
            <div className="stack">
              <Meter label="Processeur" value={cpu} max={1} text={`${Math.round(cpu * 100)} % de ${sum(nres, "maxcpu")} threads`} />
              <Meter label="Mémoire" value={sum(nres, "mem")} max={sum(nres, "maxmem") || 1} text={`${bytes(sum(nres, "mem"))} / ${bytes(sum(nres, "maxmem"))}`} />
              <Meter label="Stockage" value={sum(stores, "disk")} max={sum(stores, "maxdisk") || 1} text={`${bytes(sum(stores, "disk"))} / ${bytes(sum(stores, "maxdisk"))}`} />
              <div className="kv"><div>Machines</div><div>{guests.filter((g) => g.status === "running").length} en marche sur {guests.length} ({guests.filter((g) => g.type === "qemu").length} VM, {guests.filter((g) => g.type === "lxc").length} conteneurs)</div></div>
            </div>
          ) : <Empty>Chargement…</Empty>}
        </Panel>
      </div>
      <Panel pad={false} title="Nœuds">
        <DataTable rows={status.data ? nodes : null} loading={status.loading} rowKey={(n) => n.name} filter={false} columns={[
          { id: "name", header: "Nœud", cell: (n) => <strong>{n.name}</strong> },
          { id: "id", header: "ID", cell: (n) => n.nodeid },
          { id: "online", header: "État", cell: (n) => (n.online ? <span className="badge on">En ligne</span> : <span className="badge err">Hors ligne</span>) },
          { id: "ip", header: "Adresse", cell: (n) => <span className="mono">{n.ip}</span> },
          { id: "votes", header: "Votes", cell: (n) => (cnodes.data ?? []).find((c: any) => c.node === n.name)?.quorum_votes ?? 1 },
          { id: "local", header: "", cell: (n) => (n.local ? <span className="tag">ce nœud</span> : "") },
        ]} />
      </Panel>
      {join && (
        <Modal title="Informations de jonction" wide onClose={() => setJoin(null)} foot={<Button onClick={() => setJoin(null)}>Fermer</Button>}>
          <div className="stack">
            <p style={{ margin: 0 }}>Sur le nouveau nœud, dans « Rejoindre un cluster », colle ce texte puis le mot de passe root de ce nœud.</p>
            <textarea className="input mono" readOnly rows={6} value={join} aria-label="Informations de jonction" onFocus={(e) => e.target.select()} />
            <div><CopyButton text={join} label="Copier les informations" /></div>
          </div>
        </Modal>
      )}
      {create && (
        <Modal title="Créer un cluster" onClose={() => setCreate(false)}>
          <Form fields={[
            { name: "clustername", label: "Nom du cluster", required: true, validate: (x) => (/^[a-zA-Z0-9-]{1,15}$/.test(String(x)) ? null : "15 caractères au plus : lettres, chiffres, tiret.") },
            { name: "link0", label: "Réseau du cluster (lien 0)", placeholder: "10.0.1.101", help: "Adresse de ce nœud sur le réseau dédié au cluster. Vide : son adresse principale." },
            { name: "link1", label: "Lien de secours", advanced: true },
          ]} submitLabel="Créer" onCancel={() => setCreate(false)} onSubmit={async (v) => {
            const upid = await pve.post<string>("/cluster/config", v);
            watch("pve", upid, "Création du cluster", status.refresh);
            setCreate(false);
          }} />
        </Modal>
      )}
      {joinOther && (
        <Modal title="Rejoindre un cluster" onClose={() => setJoinOther(false)}>
          <div className="stack">
            <Notice kind="warn">Le nœud doit être vide (aucune machine) avant de rejoindre un cluster.</Notice>
            <Form fields={[
              { name: "info", label: "Informations de jonction", type: "code", rows: 4, required: true, help: "Copiées depuis le Datacenter d'un nœud du cluster." },
              { name: "password", label: "Mot de passe root du nœud distant", type: "password", required: true },
              { name: "link0", label: "Adresse de ce nœud sur le réseau du cluster", advanced: true },
            ]} submitLabel="Rejoindre" onCancel={() => setJoinOther(false)} onSubmit={async (v) => {
              let info: any;
              try { info = JSON.parse(atob(String(v.info).trim())); } catch { throw new Error("Ces informations de jonction sont illisibles. Recopie-les en entier."); }
              const upid = await pve.post<string>("/cluster/config/join", { hostname: info.ipAddress, fingerprint: info.fingerprint, password: v.password, link0: v.link0 || undefined });
              watch("pve", upid, "Jonction au cluster", status.refresh);
              setJoinOther(false);
            }} />
          </div>
        </Modal>
      )}
    </div>
  );
}

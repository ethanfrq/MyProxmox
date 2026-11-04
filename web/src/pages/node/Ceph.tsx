// Ceph : état, moniteurs, gestionnaires, OSD, pools, CephFS, configuration et journal.
// Si Ceph n'est pas installé, un message clair avec un lien vers la documentation.
import { useState } from "react";
import { Button, Confirm, Empty, Meter, Modal, Notice, Panel, Tabs, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { bytes, rate } from "../../../../shared/format";

const DOC = "https://pve.proxmox.com/wiki/Deploy_Hyper-Converged_Ceph_Cluster";
type Sub = "etat" | "mon" | "mgr" | "osd" | "pools" | "fs" | "cfg" | "log";

export function NodeCeph({ node }: { node: string }) {
  const { toast, watch } = useToast();
  const { allowed } = usePermission("/", "Sys.Modify");
  const status = usePoll(() => pve.get<any>(`/nodes/${node}/ceph/status`), 10000, [node]);
  const [sub, setSub] = useState<Sub>("etat");
  const mon = usePoll(() => (sub === "mon" ? pve.get<any[]>(`/nodes/${node}/ceph/mon`) : Promise.resolve(null)), 0, [node, sub]);
  const mgr = usePoll(() => (sub === "mgr" ? pve.get<any[]>(`/nodes/${node}/ceph/mgr`) : Promise.resolve(null)), 0, [node, sub]);
  const osd = usePoll(() => (sub === "osd" ? pve.get<any>(`/nodes/${node}/ceph/osd`) : Promise.resolve(null)), 0, [node, sub]);
  const pools = usePoll(() => (sub === "pools" ? pve.get<any[]>(`/nodes/${node}/ceph/pool`) : Promise.resolve(null)), 0, [node, sub]);
  const fs = usePoll(() => (sub === "fs" ? pve.get<any[]>(`/nodes/${node}/ceph/fs`) : Promise.resolve(null)), 0, [node, sub]);
  const cfg = usePoll(() => (sub === "cfg" ? pve.get<string>(`/nodes/${node}/ceph/cfg/raw`) : Promise.resolve(null)), 0, [node, sub]);
  const log = usePoll(() => (sub === "log" ? pve.get<any[]>(`/nodes/${node}/ceph/log`, { limit: 500 }) : Promise.resolve(null)), 5000, [node, sub]);
  const [newPool, setNewPool] = useState(false);
  const [delPool, setDelPool] = useState<any | null>(null);
  const [osdAct, setOsdAct] = useState<{ osd: any; act: "in" | "out" } | null>(null);

  if (status.error) {
    const missing = /not installed|binary not installed|not initialized|no such file/i.test(status.error);
    return (
      <Panel title="Ceph">
        <div className="stack">
          <Notice kind={missing ? "info" : "error"}>{missing ? "Ceph n'est pas installé sur ce nœud." : `Ceph ne répond pas : ${status.error}`}</Notice>
          <p style={{ margin: 0 }}>Ceph répartit le stockage sur plusieurs nœuds (au moins trois conseillés). L&apos;installation se fait depuis l&apos;interface de Proxmox ou en ligne de commande avec <code>pveceph install</code>.</p>
          <a className="btn" style={{ alignSelf: "flex-start" }} href={DOC} target="_blank" rel="noreferrer">Lire la documentation de Proxmox sur Ceph</a>
        </div>
      </Panel>
    );
  }
  const s = status.data;
  if (!s) return <Empty>Chargement…</Empty>;
  const pg = s.pgmap ?? {};
  const checks = Object.values(s.health?.checks ?? {}) as any[];
  const osdRows: any[] = (osd.data?.root?.children ?? []).flatMap((root: any) => (root.children ?? []).flatMap((host: any) => (host.children ?? []).map((o: any) => ({ ...o, host: host.name }))));

  return (
    <>
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "etat", label: "État" }, { id: "mon", label: "Moniteurs" }, { id: "mgr", label: "Gestionnaires" }, { id: "osd", label: "OSD" }, { id: "pools", label: "Pools" }, { id: "fs", label: "CephFS" }, { id: "cfg", label: "Configuration" }, { id: "log", label: "Journal" }]} />
      {sub === "etat" && (
        <div className="grid g2">
          <Panel title="Santé">
            <div className="stack">
              <div className={`mon-big ${s.health.status === "HEALTH_OK" ? "health-ok" : "health-bad"}`} style={{ fontSize: 28 }}>{s.health.status === "HEALTH_OK" ? "OK" : s.health.status === "HEALTH_WARN" ? "Attention" : "Erreur"}</div>
              {checks.map((c, i) => <Notice key={i} kind={c.severity === "HEALTH_ERR" ? "error" : "warn"}>{c.summary?.message}</Notice>)}
              <div className="kv">
                <div>Moniteurs</div><div>{(s.monmap?.mons ?? []).map((m: any) => m.name).join(", ")}</div>
                <div>Gestionnaire actif</div><div>{s.mgrmap?.active_name ?? "-"}</div>
                <div>OSD</div><div>{s.osdmap?.num_up_osds} actif(s), {s.osdmap?.num_in_osds} dans le cluster, sur {s.osdmap?.num_osds}</div>
                <div>Placement groups</div><div>{(pg.pgs_by_state ?? []).map((x: any) => `${x.count} ${x.state_name}`).join(", ")}</div>
              </div>
            </div>
          </Panel>
          <Panel title="Stockage et débit">
            <div className="stack">
              <Meter label="Espace utilisé" value={pg.bytes_used ?? 0} max={pg.bytes_total || 1} text={`${bytes(pg.bytes_used)} / ${bytes(pg.bytes_total)}`} />
              <div className="kv"><div>Lecture</div><div>{rate(pg.read_bytes_sec)}</div><div>Écriture</div><div>{rate(pg.write_bytes_sec)}</div></div>
            </div>
          </Panel>
        </div>
      )}
      {sub === "mon" && <Panel pad={false} title="Moniteurs"><DataTable rows={mon.data} loading={mon.loading} rowKey={(m) => m.name} filter={false} columns={[
        { id: "name", header: "Nom", cell: (m) => <strong>{m.name}</strong> }, { id: "host", header: "Nœud", cell: (m) => m.host },
        { id: "addr", header: "Adresse", cell: (m) => <span className="mono">{m.addr}</span> }, { id: "quorum", header: "Quorum", cell: (m) => (m.quorum ? "Oui" : "Non") },
        { id: "ver", header: "Version", cell: (m) => m.ceph_version },
      ]} /></Panel>}
      {sub === "mgr" && <Panel pad={false} title="Gestionnaires"><DataTable rows={mgr.data} loading={mgr.loading} rowKey={(m) => m.name} filter={false} columns={[
        { id: "name", header: "Nom", cell: (m) => <strong>{m.name}</strong> }, { id: "host", header: "Nœud", cell: (m) => m.host },
        { id: "state", header: "État", cell: (m) => <span className={`badge ${m.state === "active" ? "on" : "off"}`}>{m.state === "active" ? "actif" : "en attente"}</span> },
      ]} /></Panel>}
      {sub === "osd" && (
        <Panel pad={false} title="OSD">
          <DataTable rows={osd.data ? osdRows : null} loading={osd.loading} rowKey={(o) => o.id} filter={false} columns={[
            { id: "name", header: "OSD", cell: (o) => <strong className="mono">{o.name}</strong> }, { id: "host", header: "Nœud", cell: (o) => o.host },
            { id: "class", header: "Classe", cell: (o) => o.device_class },
            { id: "status", header: "État", cell: (o) => <>{o.status === "up" ? <span className="badge on">up</span> : <span className="badge err">down</span>} {o.in ? <span className="badge on">in</span> : <span className="badge warn">out</span>}</> },
            { id: "use", header: "Occupation", cell: (o) => <div style={{ minWidth: 160 }}><Meter label="" value={o.percent_used ?? 0} max={100} text={`${(o.percent_used ?? 0).toFixed(1)} % de ${bytes(o.total_space)}`} /></div> },
            { id: "lat", header: "Latence", cell: (o) => `${o.apply_latency_ms ?? 0} / ${o.commit_latency_ms ?? 0} ms` },
          ]} actions={(o) => <Button size="sm" variant={o.in ? "danger" : "default"} disabled={!allowed} onClick={() => setOsdAct({ osd: o, act: o.in ? "out" : "in" })}>{o.in ? "Sortir (out)" : "Remettre (in)"}</Button>} />
        </Panel>
      )}
      {sub === "pools" && (
        <Panel pad={false} title="Pools" right={<Button size="sm" variant="primary" disabled={!allowed} onClick={() => setNewPool(true)}>Créer un pool</Button>}>
          <DataTable rows={pools.data} loading={pools.loading} rowKey={(p) => p.pool_name} filter={false} columns={[
            { id: "name", header: "Nom", cell: (p) => <strong className="mono">{p.pool_name}</strong> },
            { id: "size", header: "Copies (min.)", cell: (p) => `${p.size} (${p.min_size})` },
            { id: "pg", header: "PG", cell: (p) => `${p.pg_num}${p.pg_autoscale_mode === "on" ? " (auto)" : ""}` },
            { id: "app", header: "Usage", cell: (p) => Object.keys(p.application_metadata ?? {}).join(", ") },
            { id: "used", header: "Utilisé", cell: (p) => `${bytes(p.bytes_used)} (${((p.percent_used ?? 0) * 100).toFixed(1)} %)` },
          ]} actions={(p) => (p.pool_name === ".mgr" ? null : <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDelPool(p)}>Supprimer</Button>)} />
        </Panel>
      )}
      {sub === "fs" && <Panel pad={false} title="CephFS"><DataTable rows={fs.data} loading={fs.loading} rowKey={(f) => f.name} filter={false} empty="Aucun CephFS. Il faut un serveur de métadonnées (MDS) pour en créer un." columns={[{ id: "name", header: "Nom", cell: (f) => f.name }, { id: "data", header: "Pool de données", cell: (f) => f.data_pool }, { id: "meta", header: "Pool de métadonnées", cell: (f) => f.metadata_pool }]} /></Panel>}
      {sub === "cfg" && <Panel title="ceph.conf"><pre className="code">{cfg.data ?? "Chargement…"}</pre></Panel>}
      {sub === "log" && <Panel title="Journal Ceph"><pre className="log">{(log.data ?? []).map((l: any) => l.t).join("\n") || "…"}</pre></Panel>}

      {newPool && (
        <Modal title="Nouveau pool Ceph" onClose={() => setNewPool(false)}>
          <Form fields={[
            { name: "name", label: "Nom", required: true, placeholder: "vm-disques" },
            { name: "size", label: "Nombre de copies", type: "number", min: 1, max: 7, default: 3, help: "3 est conseillé." },
            { name: "min_size", label: "Copies minimum pour écrire", type: "number", min: 1, max: 7, default: 2 },
            { name: "application", label: "Usage", type: "select", default: "rbd", options: [{ value: "rbd", label: "Disques de VM et conteneurs (RBD)" }, { value: "cephfs", label: "CephFS" }, { value: "rgw", label: "Objets (RGW)" }] },
            { name: "pg_autoscale_mode", label: "Ajustement automatique des PG", type: "select", default: "on", options: [{ value: "on", label: "Activé" }, { value: "warn", label: "Avertir seulement" }, { value: "off", label: "Désactivé" }] },
            { name: "add_storages", label: "Ajouter comme stockage Proxmox", type: "checkbox", default: true },
          ]} submitLabel="Créer" onCancel={() => setNewPool(false)} onSubmit={async (_c, v) => {
            const upid = await pve.post<string>(`/nodes/${node}/ceph/pool`, { ...v, add_storages: v.add_storages ? 1 : 0 });
            watch(node, upid, `Création du pool ${v.name}`, pools.refresh);
            setNewPool(false);
          }} />
        </Modal>
      )}
      {delPool && <Confirm title={`Supprimer le pool ${delPool.pool_name} ?`} danger requireText={delPool.pool_name} confirmLabel="Détruire le pool" onConfirm={async () => { try { const upid = await pve.del<string>(`/nodes/${node}/ceph/pool/${delPool.pool_name}`, { remove_storages: 1 }); watch(node, upid, "Suppression du pool", pools.refresh); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDelPool(null)}><p>Toutes les données du pool sont détruites. Les disques de machines qui s&apos;y trouvent sont perdus.</p></Confirm>}
      {osdAct && <Confirm title={`${osdAct.act === "out" ? "Sortir" : "Remettre"} ${osdAct.osd.name} ?`} danger={osdAct.act === "out"} confirmLabel={osdAct.act === "out" ? "Sortir l'OSD" : "Remettre l'OSD"} onConfirm={async () => { try { await pve.post(`/nodes/${node}/ceph/osd/${osdAct.osd.id}/${osdAct.act}`); osd.refresh(); status.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setOsdAct(null)}><p>{osdAct.act === "out" ? "Ceph déplace les données de cet OSD vers les autres. Le cluster est plus chargé pendant ce temps." : "L'OSD reçoit de nouveau des données."}</p></Confirm>}
    </>
  );
}

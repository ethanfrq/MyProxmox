// Disques du nœud : liste, SMART, GPT, effacement ; LVM, LVM-thin, répertoires et pools ZFS,
// avec un assistant qui explique les niveaux de RAID ZFS.
import { useState, type ReactElement } from "react";
import { Button, Confirm, Empty, Meter, Modal, Notice, Panel, Tabs, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form, type FieldDef, type Option } from "../../components/Form";
import { Wizard } from "../../components/Wizard";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { bytes } from "../../../../shared/format";

type Sub = "disques" | "lvm" | "lvmthin" | "dir" | "zfs";
const TYPE: Record<string, string> = { nvme: "NVMe", ssd: "SSD", hdd: "HDD", usb: "USB" };

const unusedDisks = (node: string) => async (): Promise<Option[]> =>
  (await pve.get<any[]>(`/nodes/${node}/disks/list`, { type: "unused" })).filter((d) => !d.used).map((d) => ({ value: d.devpath, label: `${d.devpath} · ${d.model} · ${bytes(d.size)}` }));

function PhysicalDisks({ node, canEdit }: { node: string; canEdit: boolean }) {
  const { toast, watch } = useToast();
  const list = usePoll(() => pve.get<any[]>(`/nodes/${node}/disks/list`), 0, [node]);
  const [smart, setSmart] = useState<{ dev: string; data: any } | null>(null);
  const [act, setAct] = useState<{ kind: "gpt" | "wipe"; disk: any } | null>(null);
  return (
    <Panel pad={false} title="Disques physiques">
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(d) => d.devpath}
        filter={false}
        columns={[
          { id: "dev", header: "Disque", sort: (d) => d.devpath, cell: (d) => <strong className="mono">{d.devpath}</strong> },
          { id: "model", header: "Modèle", cell: (d) => <>{d.model}<div className="small muted mono">{d.serial}</div></> },
          { id: "type", header: "Type", cell: (d) => `${TYPE[d.type] ?? d.type}${d.rpm ? ` ${d.rpm} tr/min` : ""}` },
          { id: "size", header: "Taille", sort: (d) => d.size, cell: (d) => bytes(d.size), className: "num" },
          { id: "used", header: "Utilisé par", cell: (d) => d.used || <span className="muted">libre</span> },
          { id: "gpt", header: "GPT", cell: (d) => (d.gpt ? "Oui" : "Non") },
          { id: "health", header: "SMART", cell: (d) => <span className={["PASSED", "OK"].includes(String(d.health).toUpperCase()) ? "health-ok" : "health-bad"}>{d.health}</span> },
          { id: "wear", header: "Durée de vie", cell: (d) => (typeof d.wearout === "number" ? <span className={d.wearout <= 10 ? "health-bad" : ""}>{d.wearout} % restants</span> : <span className="muted">-</span>) },
        ]}
        actions={(d) => (
          <span className="btn-group">
            <Button size="sm" onClick={async () => setSmart({ dev: d.devpath, data: await pve.get(`/nodes/${node}/disks/smart`, { disk: d.devpath }) })}>SMART</Button>
            {!d.used && !d.gpt && <Button size="sm" disabled={!canEdit} onClick={() => setAct({ kind: "gpt", disk: d })}>Initialiser en GPT</Button>}
            <Button size="sm" variant="danger" disabled={!canEdit} onClick={() => setAct({ kind: "wipe", disk: d })}>Effacer</Button>
          </span>
        )}
      />
      {smart && (
        <Modal title={`SMART : ${smart.dev}`} wide onClose={() => setSmart(null)} foot={<Button onClick={() => setSmart(null)}>Fermer</Button>}>
          <div className="stack">
            <div>Santé : <strong className={["PASSED", "OK"].includes(String(smart.data?.health).toUpperCase()) ? "health-ok" : "health-bad"}>{smart.data?.health}</strong></div>
            {smart.data?.attributes?.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>ID</th><th>Attribut</th><th className="num">Valeur</th><th className="num">Pire</th><th className="num">Seuil</th><th className="num">Brut</th><th>État</th></tr></thead>
                <tbody>{smart.data.attributes.map((a: any) => <tr key={a.id}><td className="mono">{a.id}</td><td>{a.name}</td><td className="num">{a.value}</td><td className="num">{a.worst}</td><td className="num">{a.threshold}</td><td className="num mono">{a.raw}</td><td>{a.fail && a.fail !== "-" ? <span className="health-bad">{a.fail}</span> : "-"}</td></tr>)}</tbody>
              </table></div>
            ) : <pre className="log">{smart.data?.text ?? "Pas de données SMART."}</pre>}
          </div>
        </Modal>
      )}
      {act?.kind === "gpt" && <Confirm title={`Initialiser ${act.disk.devpath} en GPT ?`} confirmLabel="Initialiser" onConfirm={async () => { try { const upid = await pve.post<string>(`/nodes/${node}/disks/initgpt`, { disk: act.disk.devpath }); watch(node, upid, "Initialisation GPT", list.refresh); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setAct(null)}><p>Une table de partitions GPT vide est écrite sur le disque. Il doit être libre.</p></Confirm>}
      {act?.kind === "wipe" && (
        <Confirm title={`Effacer ${act.disk.devpath} ?`} danger requireText={act.disk.devpath} confirmLabel="Effacer le disque" onConfirm={async () => {
          try { const upid = await pve.put<string>(`/nodes/${node}/disks/wipedisk`, { disk: act.disk.devpath }); watch(node, upid, `Effacement de ${act.disk.devpath}`, list.refresh); } catch (e) { toast(`${(e as Error).message}. Un disque utilisé par le système ou monté ne peut pas être effacé.`, "error"); }
        }} onClose={() => setAct(null)}>
          <p>Les partitions et signatures (LVM, ZFS, système de fichiers) sont détruites. <strong>Toutes les données du disque sont perdues.</strong></p>
          {act.disk.used && <p>Ce disque est marqué « {act.disk.used} » : vérifie qu&apos;il ne sert plus.</p>}
        </Confirm>
      )}
    </Panel>
  );
}

/** Liste + création + suppression d'un type de volume (LVM, LVM-thin, répertoire). */
function VolumeKind({ node, kind, canEdit }: { node: string; kind: "lvm" | "lvmthin" | "dir"; canEdit: boolean }) {
  const { toast, watch } = useToast();
  const path = kind === "dir" ? "directory" : kind;
  const list = usePoll(async () => {
    const r = await pve.get<any>(`/nodes/${node}/disks/${path}`);
    if (kind === "lvm") return (r.children ?? []).map((v: any) => ({ id: v.name, name: v.name, size: v.size, free: v.free, devices: (v.children ?? []).map((c: any) => c.name).join(", ") }));
    if (kind === "lvmthin") return r.map((t: any) => ({ id: t.lv, name: t.lv, vg: t.vg, size: t.lv_size, used: t.used, meta: t.metadata_used }));
    return r.map((d: any) => ({ id: d.path, name: d.path.split("/").pop(), path: d.path, device: d.device, type: d.type }));
  }, 0, [node, kind]);
  const [create, setCreate] = useState(false);
  const [del, setDel] = useState<any | null>(null);
  const title = kind === "lvm" ? "Groupes de volumes LVM" : kind === "lvmthin" ? "Pools LVM-thin" : "Répertoires montés";
  const help = kind === "lvm"
    ? "LVM découpe un disque en volumes. Pour des VM et des snapshots, préfère LVM-thin."
    : kind === "lvmthin"
      ? "LVM-thin n'occupe que l'espace réellement écrit et permet les snapshots des VM et conteneurs. C'est le choix par défaut de Proxmox."
      : "Un répertoire formate le disque (ext4 ou xfs) et le monte : idéal pour stocker des ISO, des modèles et des sauvegardes.";
  const fields: FieldDef[] = [
    { name: "device", label: "Disque", type: "api-select", required: true, load: unusedDisks(node), help: "Seuls les disques libres sont proposés." },
    { name: "name", label: "Nom", required: true, validate: (x) => (/^[a-zA-Z][\w-]*$/.test(String(x)) ? null : "Lettres, chiffres, - et _, en commençant par une lettre.") },
    ...(kind === "dir" ? [{ name: "filesystem", label: "Système de fichiers", type: "select" as const, default: "ext4", options: [{ value: "ext4", label: "ext4" }, { value: "xfs", label: "xfs" }] }] : []),
    { name: "add_storage", label: "Ajouter comme stockage Proxmox", type: "checkbox", default: true },
  ];
  return (
    <Panel pad={false} title={title} right={<Button size="sm" variant="primary" disabled={!canEdit} onClick={() => setCreate(true)}>Créer</Button>}>
      <div style={{ padding: "12px 16px 0" }}><p className="small muted" style={{ margin: 0 }}>{help}</p></div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(v: any) => v.id}
        filter={false}
        empty="Rien pour l'instant."
        columns={kind === "lvm" ? [
          { id: "name", header: "Groupe", cell: (v: any) => <strong className="mono">{v.name}</strong> },
          { id: "devices", header: "Disques", cell: (v: any) => <span className="mono small">{v.devices}</span> },
          { id: "use", header: "Occupation", cell: (v: any) => <div style={{ minWidth: 200 }}><Meter label="" value={v.size - v.free} max={v.size || 1} text={`${bytes(v.size - v.free)} / ${bytes(v.size)}`} /></div> },
        ] : kind === "lvmthin" ? [
          { id: "name", header: "Pool", cell: (v: any) => <strong className="mono">{v.name}</strong> },
          { id: "vg", header: "Groupe", cell: (v: any) => <span className="mono">{v.vg}</span> },
          { id: "use", header: "Données", cell: (v: any) => <div style={{ minWidth: 200 }}><Meter label="" value={v.used} max={1} text={`${Math.round(v.used * 100)} % de ${bytes(v.size)}`} /></div> },
          { id: "meta", header: "Métadonnées", cell: (v: any) => `${Math.round(v.meta * 100)} %` },
        ] : [
          { id: "path", header: "Chemin", cell: (v: any) => <strong className="mono">{v.path}</strong> },
          { id: "device", header: "Partition", cell: (v: any) => <span className="mono">{v.device}</span> },
          { id: "type", header: "Système", cell: (v: any) => v.type },
        ]}
        actions={(v: any) => <Button size="sm" variant="danger" disabled={!canEdit} onClick={() => setDel(v)}>Supprimer</Button>}
      />
      {create && (
        <Modal title={`Créer : ${title.toLowerCase()}`} onClose={() => setCreate(false)}>
          <Form fields={fields} submitLabel="Créer" onCancel={() => setCreate(false)} onSubmit={async (_c, v) => {
            const upid = await pve.post<string>(`/nodes/${node}/disks/${path}`, { device: v.device, name: v.name, filesystem: kind === "dir" ? v.filesystem : undefined, add_storage: v.add_storage ? 1 : 0 });
            watch(node, upid, `Création de ${v.name}`, list.refresh);
            setCreate(false);
          }} />
        </Modal>
      )}
      {del && (
        <Confirm title={`Supprimer ${del.name} ?`} danger requireText={del.name} confirmLabel="Supprimer" onConfirm={async () => {
          try {
            const upid = await pve.del<string>(`/nodes/${node}/disks/${path}/${encodeURIComponent(del.name)}`, { "cleanup-disks": 1, "cleanup-config": 1, ...(kind === "lvmthin" ? { "volume-group": del.vg } : {}) });
            watch(node, upid, `Suppression de ${del.name}`, list.refresh);
          } catch (e) { toast(`${(e as Error).message}. Retire d'abord les disques de machines qui l'utilisent.`, "error"); }
        }} onClose={() => setDel(null)}>
          <p>Le volume, son stockage Proxmox et ses données sont supprimés, puis les disques sont effacés. <strong>Ça ne se défait pas.</strong></p>
        </Confirm>
      )}
    </Panel>
  );
}

// ── ZFS ───────────────────────────────────────────────────────────
const RAID: { id: string; min: number; title: string; desc: string; usable: (n: number) => number }[] = [
  { id: "single", min: 1, title: "Un seul disque", desc: "Aucune redondance : si le disque lâche, tout est perdu. Pour des données que tu peux refaire.", usable: (n) => n },
  { id: "mirror", min: 2, title: "Miroir (RAID 1)", desc: "Chaque donnée est écrite sur tous les disques. Survit à la perte de tous les disques sauf un. Capacité d'un seul disque.", usable: () => 1 },
  { id: "raid10", min: 4, title: "RAID 10 (miroirs agrégés)", desc: "Paires de miroirs. Rapide, survit à un disque par paire. Moitié de la capacité. Nombre pair de disques.", usable: (n) => n / 2 },
  { id: "raidz", min: 3, title: "RAIDZ-1", desc: "Comme un RAID 5 : survit à la perte d'un disque. Capacité de tous les disques moins un.", usable: (n) => n - 1 },
  { id: "raidz2", min: 4, title: "RAIDZ-2", desc: "Comme un RAID 6 : survit à la perte de deux disques. Conseillé pour les grands disques.", usable: (n) => n - 2 },
  { id: "raidz3", min: 5, title: "RAIDZ-3", desc: "Survit à la perte de trois disques. Pour de très grandes grappes.", usable: (n) => n - 3 },
  { id: "draid", min: 3, title: "dRAID-1", desc: "RAIDZ distribué, reconstruction plus rapide. Pour beaucoup de disques.", usable: (n) => n - 1 },
  { id: "draid2", min: 4, title: "dRAID-2", desc: "dRAID qui survit à la perte de deux disques.", usable: (n) => n - 2 },
];

function ZfsWizard({ node, onClose, onDone }: { node: string; onClose: () => void; onDone: () => void }) {
  const { watch } = useToast();
  const disks = usePoll(() => pve.get<any[]>(`/nodes/${node}/disks/list`, { type: "unused" }), 0, [node]);
  const free = (disks.data ?? []).filter((d) => !d.used);
  return (
    <Modal title="Créer un pool ZFS" wide onClose={onClose}>
      {!disks.data ? <Empty>Chargement…</Empty> : !free.length ? <Notice kind="warn">Aucun disque libre. Efface d&apos;abord un disque (onglet Disques) pour l&apos;utiliser dans un pool.</Notice> : (
        <Wizard
          steps={[
            { id: "niveau", title: "Redondance", lead: "Choisis comment le pool protège tes données.", fields: [{ name: "name", label: "Nom du pool", required: true, placeholder: "tank", validate: (x) => (/^[a-zA-Z][\w-]*$/.test(String(x)) ? null : "Lettres, chiffres, - et _.") }], render: (v, set) => (
              <div className="choice">
                {RAID.map((r) => (
                  <label key={r.id} className={v.raidlevel === r.id ? "sel" : ""}>
                    <input type="radio" name="raidlevel" checked={v.raidlevel === r.id} onChange={() => set("raidlevel", r.id)} />
                    <div><div className="t">{r.title} <span className="muted small">· {r.min} disque{r.min > 1 ? "s" : ""} minimum</span></div><div className="d">{r.desc}</div></div>
                  </label>
                ))}
              </div>
            ) },
            { id: "disques", title: "Disques", lead: "Coche les disques du pool. Idéalement, tous de la même taille.", render: (v, set) => {
              const sel: string[] = v.devices ?? [];
              return (
                <div className="choice">
                  {free.map((d) => (
                    <label key={d.devpath} className={sel.includes(d.devpath) ? "sel" : ""}>
                      <input type="checkbox" checked={sel.includes(d.devpath)} onChange={(e) => set("devices", e.target.checked ? [...sel, d.devpath] : sel.filter((x) => x !== d.devpath))} />
                      <div><div className="t mono">{d.devpath}</div><div className="d">{d.model} · {bytes(d.size)} · {TYPE[d.type] ?? d.type}</div></div>
                    </label>
                  ))}
                </div>
              );
            }, validate: (v) => {
              const r = RAID.find((x) => x.id === v.raidlevel)!;
              const n = (v.devices ?? []).length;
              if (n < r.min) return `${r.title} demande au moins ${r.min} disque(s).`;
              if (v.raidlevel === "raid10" && n % 2) return "RAID 10 demande un nombre pair de disques.";
              return null;
            } },
            { id: "options", title: "Options", fields: [
              { name: "compression", label: "Compression", type: "select", default: "on", options: [{ value: "on", label: "Activée (lz4, conseillé)" }, { value: "zstd", label: "zstd (plus forte)" }, { value: "off", label: "Désactivée" }] },
              { name: "ashift", label: "Taille de secteur (ashift)", type: "select", default: "12", options: [{ value: "12", label: "12 (4 Kio, la plupart des disques)" }, { value: "13", label: "13 (8 Kio, certains SSD)" }, { value: "9", label: "9 (512 octets, vieux disques)" }], help: "Ne se change plus après la création." },
              { name: "add_storage", label: "Ajouter comme stockage Proxmox", type: "checkbox", default: true },
            ] },
          ]}
          initial={{ raidlevel: free.length >= 2 ? "mirror" : "single", devices: [] }}
          finishLabel="Créer le pool"
          onCancel={onClose}
          summaryExtra={(v) => {
            const r = RAID.find((x) => x.id === v.raidlevel)!;
            const sel = free.filter((d) => (v.devices ?? []).includes(d.devpath));
            const smallest = Math.min(...sel.map((d) => d.size));
            return (
              <div className="summary-block">
                <div className="kv">
                  <div>Redondance</div><div>{r.title}</div>
                  <div>Disques</div><div className="mono small">{sel.map((d) => d.devpath).join(", ")}</div>
                  <div>Capacité utile estimée</div><div><strong>{bytes(r.usable(sel.length) * smallest)}</strong></div>
                </div>
                <Notice kind="warn">Les disques choisis sont effacés.</Notice>
              </div>
            );
          }}
          onFinish={async (_c, v) => {
            const upid = await pve.post<string>(`/nodes/${node}/disks/zfs`, { name: v.name, raidlevel: v.raidlevel, devices: (v.devices ?? []).join(","), compression: v.compression, ashift: v.ashift, add_storage: v.add_storage ? 1 : 0 });
            watch(node, upid, `Création du pool ${v.name}`, onDone);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

function ZfsPools({ node, canEdit }: { node: string; canEdit: boolean }) {
  const { toast, watch } = useToast();
  const list = usePoll(() => pve.get<any[]>(`/nodes/${node}/disks/zfs`), 0, [node]);
  const [create, setCreate] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const tree = (n: any, depth = 0): ReactElement[] => [
    <tr key={`${n.name}-${depth}`}><td style={{ paddingLeft: 16 + depth * 18 }} className="mono">{n.name}</td><td className={n.state === "ONLINE" ? "health-ok" : "health-bad"}>{n.state}</td><td className="num">{n.read ?? ""}</td><td className="num">{n.write ?? ""}</td><td className="num">{n.cksum ?? ""}</td></tr>,
    ...(n.children ?? []).flatMap((c: any) => tree(c, depth + 1)),
  ];
  return (
    <Panel pad={false} title="Pools ZFS" right={<Button size="sm" variant="primary" disabled={!canEdit} onClick={() => setCreate(true)}>Créer un pool</Button>}>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(p) => p.name}
        filter={false}
        empty="Aucun pool ZFS."
        columns={[
          { id: "name", header: "Pool", cell: (p) => <strong className="mono">{p.name}</strong> },
          { id: "health", header: "État", cell: (p) => <span className={p.health === "ONLINE" ? "health-ok" : "health-bad"}>{p.health}</span> },
          { id: "use", header: "Occupation", cell: (p) => <div style={{ minWidth: 220 }}><Meter label="" value={p.alloc} max={p.size || 1} text={`${bytes(p.alloc)} / ${bytes(p.size)}`} /></div> },
          { id: "frag", header: "Fragmentation", cell: (p) => `${p.frag} %`, className: "num" },
          { id: "dedup", header: "Dédup", cell: (p) => `×${p.dedup}`, className: "num" },
        ]}
        actions={(p) => (
          <span className="btn-group">
            <Button size="sm" onClick={async () => setDetail(await pve.get(`/nodes/${node}/disks/zfs/${p.name}`))}>Détails</Button>
            <Button size="sm" variant="danger" disabled={!canEdit} onClick={() => setDel(p)}>Supprimer</Button>
          </span>
        )}
      />
      {create && <ZfsWizard node={node} onClose={() => setCreate(false)} onDone={list.refresh} />}
      {detail && (
        <Modal title={`Pool ${detail.name}`} wide onClose={() => setDetail(null)} foot={<Button onClick={() => setDetail(null)}>Fermer</Button>}>
          <div className="stack">
            {detail.status && <Notice kind="warn">{detail.status} {detail.action}</Notice>}
            <div className="kv"><div>État</div><div>{detail.state}</div><div>Dernière vérification</div><div className="small">{detail.scan}</div><div>Erreurs</div><div className="small">{detail.errors}</div></div>
            <table className="table"><thead><tr><th>Périphérique</th><th>État</th><th className="num">Lecture</th><th className="num">Écriture</th><th className="num">Somme</th></tr></thead><tbody>{(detail.children ?? []).flatMap((c: any) => tree(c))}</tbody></table>
          </div>
        </Modal>
      )}
      {del && (
        <Confirm title={`Supprimer le pool ${del.name} ?`} danger requireText={del.name} confirmLabel="Détruire le pool" onConfirm={async () => {
          try { const upid = await pve.del<string>(`/nodes/${node}/disks/zfs/${del.name}`, { "cleanup-disks": 1, "cleanup-config": 1 }); watch(node, upid, `Suppression de ${del.name}`, list.refresh); } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setDel(null)}>
          <p>Le pool et <strong>toutes ses données</strong> sont détruits, puis ses disques effacés.</p>
        </Confirm>
      )}
    </Panel>
  );
}

export function NodeDisks({ node }: { node: string }) {
  const [sub, setSub] = useState<Sub>("disques");
  const { allowed } = usePermission(`/nodes/${node}`, "Sys.Modify");
  return (
    <>
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "disques", label: "Disques" }, { id: "lvm", label: "LVM" }, { id: "lvmthin", label: "LVM-thin" }, { id: "dir", label: "Répertoires" }, { id: "zfs", label: "ZFS" }]} />
      {sub === "disques" && <PhysicalDisks node={node} canEdit={allowed} />}
      {(sub === "lvm" || sub === "lvmthin" || sub === "dir") && <VolumeKind key={sub} node={node} kind={sub} canEdit={allowed} />}
      {sub === "zfs" && <ZfsPools node={node} canEdit={allowed} />}
    </>
  );
}

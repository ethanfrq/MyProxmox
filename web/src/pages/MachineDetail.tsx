import { Link, useNavigate, useParams } from "react-router-dom";
import { Fragment, useEffect, useState } from "react";
import { Button, Confirm, Empty, Field, Meter, Notice, PageHead, Panel, Status, Tabs, TypeTag, useToast } from "../components/ui";
import { GuestActions } from "../components/GuestActions";
import { Sparkline } from "../components/Sparkline";
import { I } from "../components/icons";
import { api, pve, usePoll } from "../lib/api";
import { useApp } from "../lib/app";
import { DEMO } from "../lib/env";
import { ago, bytes, date, pct, rate, uptime } from "../../../shared/format";

type Tab = "resume" | "reseau" | "materiel" | "snapshots" | "sauvegardes" | "supprimer";

export function MachineDetail() {
  const params = useParams<{ node: string; type: "qemu" | "lxc"; vmid: string }>();
  const node = params.node!;
  const type = params.type as "qemu" | "lxc";
  const vmid = params.vmid!;
  const { settings } = useApp();
  const base = `/nodes/${node}/${type}/${vmid}`;
  const [tab, setTab] = useState<Tab>("resume");

  const status = usePoll(() => pve.get(`${base}/status/current`), 4000, [base]);
  const config = usePoll(() => pve.get(`${base}/config`), 0, [base]);

  const s = status.data;
  const c = config.data;
  const name = c?.name ?? c?.hostname ?? s?.name ?? `#${vmid}`;
  const g = { node, type, vmid: Number(vmid), name, status: s?.status ?? "unknown" };
  const consoleUrl = settings?.pveUrl
    ? `${settings.pveUrl}/?console=${type === "qemu" ? "kvm" : "lxc"}&novnc=1&vmid=${vmid}&vmname=${encodeURIComponent(name)}&node=${node}&resize=off&cmd=`
    : "";
  const refreshAll = () => { status.refresh(); config.refresh(); };

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link to="/machines" className="btn btn-sm btn-ghost"><I.back /> Machines</Link>
      </div>
      <PageHead
        title={<span className="row" style={{ gap: 10 }}><TypeTag type={type} /> {name} <span className="muted mono" style={{ fontWeight: 400, fontSize: 15 }}>{vmid}</span></span>}
        sub={<span className="row"><Status status={g.status} /> <span>sur {node}</span>{s?.uptime ? <span>· allumée depuis {uptime(s.uptime)}</span> : null}</span>}
        actions={
          <>
            {s && <GuestActions g={g} full onChange={status.refresh} />}
            {consoleUrl && !DEMO && (
              <a className="btn" href={consoleUrl} target="_blank" rel="noreferrer" title="Ouvre la console noVNC de Proxmox (connexion à Proxmox requise dans ce navigateur)">
                <I.console /> Console
              </a>
            )}
          </>
        }
      />
      {status.error && <div style={{ marginBottom: 16 }}><Notice kind="error">{status.error}</Notice></div>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "resume", label: "Résumé" },
          { id: "reseau", label: "Réseau" },
          { id: "materiel", label: "Matériel" },
          { id: "snapshots", label: "Snapshots" },
          { id: "sauvegardes", label: "Sauvegardes" },
          { id: "supprimer", label: "Supprimer" },
        ]}
      />

      {tab === "resume" && <Summary base={base} s={s} c={c} type={type} />}
      {tab === "reseau" && <GuestNetwork vmid={Number(vmid)} c={c} />}
      {tab === "materiel" && c && <Hardware base={base} c={c} type={type} running={g.status === "running"} onSaved={refreshAll} />}
      {tab === "snapshots" && <Snapshots base={base} node={node} type={type} />}
      {tab === "sauvegardes" && <Backups node={node} type={type} vmid={Number(vmid)} running={g.status === "running"} />}
      {tab === "supprimer" && <DeleteGuest base={base} node={node} vmid={vmid} name={name} running={g.status === "running"} />}
    </>
  );
}

function Summary({ base, s, c, type }: { base: string; s: any; c: any; type: string }) {
  const rrd = usePoll(() => pve.get<any[]>(`${base}/rrddata`, { timeframe: "hour" }), 60000, [base]);
  const pts = (rrd.data ?? []).filter((p) => p.cpu !== undefined);
  const disks = c ? Object.entries(c).filter(([k]) => /^(scsi|virtio|sata|ide|rootfs|mp)\d*$/.test(k)) : [];
  const nets = c ? Object.entries(c).filter(([k]) => /^net\d+$/.test(k)) : [];

  return (
    <div className="grid g2">
      <Panel title="Utilisation">
        {s ? (
          <div className="stack">
            <Meter label="Processeur" value={s.cpu} max={1} text={`${pct(s.cpu)} de ${s.cpus ?? s.maxcpu ?? c?.cores} cœurs`} />
            <Meter label="Mémoire" value={s.mem} max={s.maxmem} text={`${bytes(s.mem)} / ${bytes(s.maxmem)}`} />
            {type === "lxc" && <Meter label="Disque" value={s.disk} max={s.maxdisk} text={`${bytes(s.disk)} / ${bytes(s.maxdisk)}`} />}
            <Sparkline label="Processeur (1 h)" values={pts.map((p) => p.cpu)} max={1} current={pct(s.cpu)} />
            <Sparkline label="Mémoire (1 h)" values={pts.map((p) => p.mem ?? 0)} max={pts[0]?.maxmem} current={bytes(s.mem)} />
            <Sparkline label="Réseau entrant (1 h)" values={pts.map((p) => p.netin ?? 0)} current={rate(pts.at(-1)?.netin)} />
            <Sparkline label="Réseau sortant (1 h)" values={pts.map((p) => p.netout ?? 0)} current={rate(pts.at(-1)?.netout)} />
          </div>
        ) : <Empty>Chargement…</Empty>}
      </Panel>
      <Panel title="Configuration">
        {c ? (
          <div className="kv">
            <div>Cœurs</div><div>{c.cores ?? 1}{c.sockets > 1 ? ` × ${c.sockets} sockets` : ""}</div>
            <div>Mémoire</div><div>{c.memory} Mo{c.swap !== undefined ? ` · swap ${c.swap} Mo` : ""}</div>
            <div>Système</div><div>{c.ostype ?? "—"}</div>
            <div>Démarrage auto</div><div>{Number(c.onboot) ? "Oui, au démarrage du serveur" : "Non"}</div>
            {c.tags && (<><div>Tags</div><div className="chips">{String(c.tags).split(/[;,\s]+/).filter(Boolean).map((t: string) => <span key={t} className="chip">{t}</span>)}</div></>)}
            {type === "qemu" && (<><div>Agent invité</div><div>{String(c.agent ?? "0").startsWith("1") ? "Activé" : <span className="muted">Désactivé : sans lui, pas d'adresse IP ni d'arrêt propre garanti</span>}</div></>)}
            {type === "qemu" && c.bios && (<><div>Firmware</div><div>{c.bios === "ovmf" ? "UEFI (OVMF)" : "BIOS (SeaBIOS)"}{c.machine ? ` · ${c.machine}` : ""}</div></>)}
            {disks.map(([k, v]) => (<Fragment key={k}><div>Disque {k}</div><div className="mono small">{String(v)}</div></Fragment>))}
            {nets.map(([k, v]) => (<Fragment key={k}><div>Réseau {k}</div><div className="mono small">{String(v)}</div></Fragment>))}
            {c.description && (<><div>Notes</div><div>{c.description}</div></>)}
          </div>
        ) : <Empty>Chargement…</Empty>}
      </Panel>
    </div>
  );
}

function Hardware({ base, c, type, running, onSaved }: { base: string; c: any; type: string; running: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(c.name ?? c.hostname ?? "");
  const [cores, setCores] = useState(Number(c.cores ?? 1));
  const [memory, setMemory] = useState(Number(c.memory ?? 512));
  const [onboot, setOnboot] = useState(!!Number(c.onboot ?? 0));
  const [description, setDescription] = useState(c.description ?? "");
  const [tags, setTags] = useState(String(c.tags ?? "").split(/[;,\s]+/).filter(Boolean).join(", "));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await pve.put(`${base}/config`, {
        [type === "qemu" ? "name" : "hostname"]: name, cores, memory, onboot: onboot ? 1 : 0, description,
        tags: tags.split(/[,;\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean).join(";"),
      });
      toast("Configuration enregistrée", "ok");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Modifier les ressources" right={<Button variant="primary" busy={busy} onClick={save}>Enregistrer</Button>}>
      <div className="stack">
        {running && type === "qemu" && <Notice kind="warn">La machine est allumée : les changements de cœurs et de mémoire s&apos;appliquent au prochain redémarrage.</Notice>}
        <div className="form-grid">
          <Field label={type === "qemu" ? "Nom" : "Nom d'hôte"}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Cœurs"><input className="input" type="number" min={1} max={128} value={cores} onChange={(e) => setCores(Number(e.target.value))} /></Field>
          <Field label="Mémoire (Mo)" help={`${(memory / 1024).toFixed(1).replace(".", ",")} Go`}>
            <input className="input" type="number" min={64} step={256} value={memory} onChange={(e) => setMemory(Number(e.target.value))} />
          </Field>
          <Field label="Démarrage automatique">
            <label className="check" style={{ height: 36 }}><input type="checkbox" checked={onboot} onChange={(e) => setOnboot(e.target.checked)} /> Démarrer avec le serveur</label>
          </Field>
          <Field label="Tags" help="Séparés par des virgules. Ex. prod, web" full><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <Field label="Notes" full><textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <p className="small muted">Disques, cartes réseau et périphériques : utilise l&apos;interface officielle de Proxmox, ces réglages sont trop risqués pour une interface simplifiée.</p>
      </div>
    </Panel>
  );
}

function Snapshots({ base, node, type }: { base: string; node: string; type: string }) {
  const { watch, toast } = useToast();
  const list = usePoll(() => pve.get<any[]>(`${base}/snapshot`), 0, [base]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [ram, setRam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "rollback" | "delete"; name: string } | null>(null);
  const snaps = (list.data ?? []).filter((s) => s.name !== "current").sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0));

  async function create() {
    setBusy(true);
    try {
      const upid = await pve.post(`${base}/snapshot`, { snapname: name, description: desc, ...(type === "qemu" && ram ? { vmstate: 1 } : {}) });
      watch(node, upid, `Snapshot ${name}`, list.refresh);
      setName("");
      setDesc("");
      setTimeout(list.refresh, 1000);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid g2">
      <Panel title="Snapshots" pad={false}>
        {snaps.length ? (
          <table className="table">
            <thead><tr><th>Nom</th><th>Date</th><th>Description</th><th className="actions" /></tr></thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.name}>
                  <td><strong className="mono">{s.name}</strong></td>
                  <td className="small muted">{date(s.snaptime)}</td>
                  <td className="small">{s.description}</td>
                  <td className="actions">
                    <span className="btn-group">
                      <Button size="sm" onClick={() => setConfirm({ kind: "rollback", name: s.name })}>Restaurer</Button>
                      <Button size="sm" variant="danger" icon={<I.trash />} onClick={() => setConfirm({ kind: "delete", name: s.name })} aria-label="Supprimer" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{list.loading ? "Chargement…" : "Aucun snapshot."}</Empty>}
      </Panel>
      <Panel title="Nouveau snapshot">
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>Une photo instantanée de la machine. Pratique avant une mise à jour risquée : tu reviens en arrière en un clic.</p>
          <Field label="Nom" help="Lettres, chiffres, - et _ ; commence par une lettre. Ex. avant-maj">
            <input className="input mono" value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, "-"))} />
          </Field>
          <Field label="Description"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          {type === "qemu" && <label className="check"><input type="checkbox" checked={ram} onChange={(e) => setRam(e.target.checked)} /> Inclure la mémoire vive (plus lent, reprend l&apos;état exact)</label>}
          <div><Button variant="primary" icon={<I.camera />} busy={busy} disabled={!/^[a-zA-Z][\w-]*$/.test(name)} onClick={create}>Prendre le snapshot</Button></div>
        </div>
      </Panel>
      {confirm && (
        <Confirm
          title={confirm.kind === "rollback" ? `Revenir au snapshot « ${confirm.name} » ?` : `Supprimer le snapshot « ${confirm.name} » ?`}
          danger
          confirmLabel={confirm.kind === "rollback" ? "Restaurer" : "Supprimer"}
          onConfirm={async () => {
            try {
              const upid = confirm.kind === "rollback"
                ? await pve.post(`${base}/snapshot/${confirm.name}/rollback`)
                : await pve.del(`${base}/snapshot/${confirm.name}`);
              watch(node, upid, undefined, list.refresh);
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setConfirm(null)}
        >
          <p>{confirm.kind === "rollback" ? "Tout ce qui a changé depuis ce snapshot sera perdu." : "Le snapshot sera définitivement effacé."}</p>
        </Confirm>
      )}
    </div>
  );
}

function Backups({ node, type, vmid, running }: { node: string; type: string; vmid: number; running: boolean }) {
  const { watch, toast } = useToast();
  const storages = usePoll(() => pve.get<any[]>(`/nodes/${node}/storage`, { content: "backup" }), 0, [node]);
  const backupStores = (storages.data ?? []).filter((s) => String(s.content).includes("backup") && s.active);
  const [store, setStore] = useState("");
  const [mode, setMode] = useState("snapshot");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "restore" | "delete"; volid: string; storage: string } | null>(null);

  useEffect(() => { if (!store && backupStores[0]) setStore(backupStores[0].storage); }, [backupStores, store]);

  const list = usePoll(async () => {
    const all = await Promise.all(backupStores.map((s) =>
      pve.get<any[]>(`/nodes/${node}/storage/${s.storage}/content`, { content: "backup", vmid }).then((l) => l.map((x) => ({ ...x, storage: s.storage }))),
    ));
    return all.flat().sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0));
  }, 0, [backupStores.map((s) => s.storage).join(",")]);

  async function backup() {
    setBusy(true);
    try {
      const upid = await pve.post(`/nodes/${node}/vzdump`, { vmid, storage: store, mode, compress: "zstd" });
      watch(node, upid, "Sauvegarde", list.refresh);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid g2">
      <Panel title="Sauvegardes de cette machine" pad={false} right={<Button size="sm" icon={<I.refresh />} onClick={list.refresh}>Actualiser</Button>}>
        {(list.data ?? []).length ? (
          <table className="table">
            <thead><tr><th>Date</th><th>Stockage</th><th className="num">Taille</th><th className="actions" /></tr></thead>
            <tbody>
              {(list.data ?? []).map((b) => (
                <tr key={b.volid}>
                  <td>{date(b.ctime)}</td>
                  <td className="muted">{b.storage}</td>
                  <td className="num">{bytes(b.size)}</td>
                  <td className="actions">
                    <span className="btn-group">
                      <Button size="sm" onClick={() => setConfirm({ kind: "restore", volid: b.volid, storage: b.storage })}>Restaurer</Button>
                      <Button size="sm" variant="danger" icon={<I.trash />} aria-label="Supprimer" onClick={() => setConfirm({ kind: "delete", volid: b.volid, storage: b.storage })} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{list.loading ? "Chargement…" : "Aucune sauvegarde."}</Empty>}
      </Panel>
      <Panel title="Sauvegarder maintenant">
        {backupStores.length ? (
          <div className="stack">
            <Field label="Stockage de destination">
              <select className="select input" value={store} onChange={(e) => setStore(e.target.value)}>
                {backupStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({bytes(s.avail)} libres)</option>)}
              </select>
            </Field>
            <Field label="Mode" help="Snapshot : la machine reste allumée. Arrêt : la plus fiable, mais coupe le service.">
              <select className="select input" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="snapshot">Snapshot (sans interruption)</option>
                <option value="suspend">Suspension</option>
                <option value="stop">Arrêt</option>
              </select>
            </Field>
            <div><Button variant="primary" icon={<I.download />} busy={busy} onClick={backup}>Lancer la sauvegarde</Button></div>
          </div>
        ) : <Notice kind="warn">Aucun stockage n&apos;accepte les sauvegardes. Active le contenu « VZDump backup » sur un stockage dans Proxmox.</Notice>}
      </Panel>
      {confirm && (
        <Confirm
          title={confirm.kind === "restore" ? "Restaurer cette sauvegarde ?" : "Supprimer cette sauvegarde ?"}
          danger
          requireText={confirm.kind === "restore" ? String(vmid) : undefined}
          confirmLabel={confirm.kind === "restore" ? "Écraser et restaurer" : "Supprimer"}
          onConfirm={async () => {
            try {
              if (confirm.kind === "delete") {
                const upid = await pve.del(`/nodes/${node}/storage/${confirm.storage}/content/${encodeURIComponent(confirm.volid)}`);
                if (typeof upid === "string" && upid.startsWith("UPID")) watch(node, upid, "Suppression", list.refresh); else list.refresh();
              } else {
                if (running) throw new Error("Éteins la machine avant de la restaurer.");
                const upid = type === "qemu"
                  ? await pve.post(`/nodes/${node}/qemu`, { vmid, archive: confirm.volid, force: 1 })
                  : await pve.post(`/nodes/${node}/lxc`, { vmid, ostemplate: confirm.volid, restore: 1, force: 1 });
                watch(node, upid, "Restauration");
              }
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setConfirm(null)}
        >
          <p className="mono small">{confirm.volid}</p>
          {confirm.kind === "restore" && <p>La machine actuelle sera <strong>entièrement remplacée</strong> par cette sauvegarde. Elle doit être éteinte.</p>}
        </Confirm>
      )}
    </div>
  );
}

function DeleteGuest({ base, node, vmid, name, running }: { base: string; node: string; vmid: string; name: string; running: boolean }) {
  const router = useNavigate();
  const { watch, toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Panel title="Supprimer la machine">
      <div className="stack">
        <p style={{ margin: 0 }}>Supprime <strong>{name}</strong> et tous ses disques. Les sauvegardes sont conservées.</p>
        {running && <Notice kind="warn">Éteins d&apos;abord la machine.</Notice>}
        <div><Button variant="danger" icon={<I.trash />} disabled={running} onClick={() => setOpen(true)}>Supprimer définitivement</Button></div>
      </div>
      {open && (
        <Confirm
          title={`Supprimer ${name} ?`}
          danger
          requireText={vmid}
          confirmLabel="Supprimer"
          onConfirm={async () => {
            try {
              const upid = await pve.del(base, { purge: 1, "destroy-unreferenced-disks": 1 });
              watch(node, upid, `Suppression de ${name}`);
              router("/machines");
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setOpen(false)}
        >
          <p>Cette action est irréversible.</p>
        </Confirm>
      )}
    </Panel>
  );
}

function GuestNetwork({ vmid, c }: { vmid: number; c: any }) {
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

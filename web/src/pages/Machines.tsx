import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Confirm, MiniMeter, Modal, Notice, PageHead, Panel, Status, TypeTag, useToast } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Form, type FieldDef, type Values } from "../components/Form";
import { GuestActions } from "../components/GuestActions";
import { I } from "../components/icons";
import { tagList } from "../components/Tree";
import { api, pve, usePoll } from "../lib/api";
import { useApp } from "../lib/app";
import { hasPermission, usePermissions } from "../lib/permissions";
import { ago, bytes, pct, uptime } from "../../../shared/format";

type Filter = "all" | "running" | "stopped" | "qemu" | "lxc";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Toutes" }, { id: "running", label: "En marche" }, { id: "stopped", label: "Arrêtées" },
  { id: "qemu", label: "VM" }, { id: "lxc", label: "Conteneurs" },
];
type Bulk = "start" | "shutdown" | "reboot" | "snapshot" | "backup" | "migrate" | "tags";
const BULK: Record<Bulk, { button: string; title: string; label: string; priv: string }> = {
  start: { button: "Démarrer", title: "Démarrer la sélection ?", label: "Démarrer", priv: "VM.PowerMgmt" },
  shutdown: { button: "Éteindre", title: "Éteindre la sélection ?", label: "Éteindre", priv: "VM.PowerMgmt" },
  reboot: { button: "Redémarrer", title: "Redémarrer la sélection ?", label: "Redémarrer", priv: "VM.PowerMgmt" },
  snapshot: { button: "Snapshot", title: "Snapshot de la sélection ?", label: "Prendre les snapshots", priv: "VM.Snapshot" },
  backup: { button: "Sauvegarder", title: "Sauvegarder la sélection", label: "Lancer les sauvegardes", priv: "VM.Backup" },
  migrate: { button: "Migrer", title: "Migrer la sélection", label: "Migrer", priv: "VM.Migrate" },
  tags: { button: "Tags", title: "Tags de la sélection", label: "Appliquer", priv: "VM.Config.Options" },
};
const FORMS: Partial<Record<Bulk, FieldDef[]>> = {
  backup: [
    { name: "storage", label: "Stockage", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/cluster/resources", { type: "storage" })).filter((s) => String(s.content).includes("backup") && s.status === "available").filter((s, i, a) => a.findIndex((x) => x.storage === s.storage) === i).map((s) => ({ value: s.storage, label: s.storage })) },
    { name: "mode", label: "Mode", type: "select", default: "snapshot", options: [{ value: "snapshot", label: "Snapshot (sans interruption)" }, { value: "suspend", label: "Suspension" }, { value: "stop", label: "Arrêt" }] },
    { name: "compress", label: "Compression", type: "select", default: "zstd", options: [{ value: "zstd", label: "ZSTD" }, { value: "gzip", label: "GZIP" }, { value: "0", label: "Aucune" }] },
  ],
  migrate: [
    { name: "target", label: "Nœud cible", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/nodes")).filter((n) => n.status === "online").map((n) => ({ value: n.node, label: n.node })) },
    { name: "online", label: "À chaud pour les VM allumées, redémarrage pour les conteneurs allumés", type: "checkbox", default: true },
  ],
  tags: [
    { name: "op", label: "Action", type: "select", default: "add", options: [{ value: "add", label: "Ajouter le tag" }, { value: "remove", label: "Retirer le tag" }] },
    { name: "tag", label: "Tag", required: true, validate: (x) => (/^[a-z0-9_][a-z0-9_.+-]*$/i.test(String(x)) ? null : "Lettres, chiffres, _ . + et -.") },
  ],
};

export function Machines() {
  const navigate = useNavigate();
  const { settings } = useApp();
  const { toast, watch } = useToast();
  const { map } = usePermissions();
  const [filter, setFilter] = useState<Filter>("all");
  const [tag, setTag] = useState("");
  const [bulk, setBulk] = useState<{ kind: Bulk; list: any[]; clear: () => void } | null>(null);

  const res = usePoll(() => pve.get<any[]>("/cluster/resources", { type: "vm" }), 4000);
  const inv = usePoll(() => api<any[]>("/api/insights/inventory"), 30000);
  const showBackups = settings?.modules.backups !== false;
  const bk = usePoll(() => (showBackups ? api("/api/insights/backups") : Promise.resolve(null)), 120000, [showBackups]);

  const all = useMemo(() => (res.data ?? []).filter((r) => !r.template), [res.data]);
  const byId = useMemo(() => new Map((inv.data ?? []).map((r) => [r.vmid, r])), [inv.data]);
  const bkById = useMemo(() => new Map((bk.data?.rows ?? []).map((r: any) => [r.vmid, r])), [bk.data]);
  const tags = [...new Set(all.flatMap((g) => tagList(g.tags)))].sort();

  const list = all.filter((g) => {
    if (filter === "running" && g.status !== "running") return false;
    if (filter === "stopped" && g.status === "running") return false;
    if ((filter === "qemu" || filter === "lxc") && g.type !== filter) return false;
    if (tag && !tagList(g.tags).includes(tag)) return false;
    return true;
  });

  async function runBulk(kind: Bulk, selected: any[], v: Values = {}) {
    const name = `lot-${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`;
    const targets = selected.filter((g) => (kind === "start" ? g.status !== "running" : kind === "shutdown" || kind === "reboot" ? g.status === "running" : kind === "migrate" ? g.node !== v.target : true));
    let ok = 0;
    if (kind === "backup") {
      // Une seule tâche vzdump par nœud, avec la liste des machines
      const byNode = new Map<string, any[]>();
      for (const g of targets) byNode.set(g.node, [...(byNode.get(g.node) ?? []), g]);
      for (const [node, gs] of byNode) {
        try {
          const upid = await pve.post<string>(`/nodes/${node}/vzdump`, { vmid: gs.map((g) => g.vmid).join(","), storage: v.storage, mode: v.mode, compress: v.compress });
          watch(node, upid, `Sauvegarde de ${gs.length} machine(s) sur ${node}`);
          ok += gs.length;
        } catch (e) { toast(`${node} : ${(e as Error).message}`, "error"); }
      }
    } else {
      for (const g of targets) {
        try {
          const base = `/nodes/${g.node}/${g.type}/${g.vmid}`;
          let upid: unknown = null;
          if (kind === "snapshot") upid = await pve.post(`${base}/snapshot`, { snapname: name, description: "Snapshot groupé depuis MyProxmox" });
          else if (kind === "migrate") upid = await pve.post(`${base}/migrate`, { target: v.target, online: g.type === "qemu" && g.status === "running" && v.online ? 1 : undefined, restart: g.type === "lxc" && g.status === "running" && v.online ? 1 : undefined });
          else if (kind === "tags") {
            const cur = tagList(g.tags);
            const next = v.op === "add" ? [...new Set([...cur, String(v.tag)])] : cur.filter((t) => t !== v.tag);
            await pve.put(`${base}/config`, next.length ? { tags: next.join(";") } : { delete: "tags" });
          } else upid = await pve.post(`${base}/status/${kind}`);
          if (typeof upid === "string") watch(g.node, upid, `${g.name}`);
          ok++;
        } catch (e) {
          toast(`${g.name} : ${(e as Error).message}. Vérifie son état puis réessaie.`, "error");
        }
      }
    }
    toast(`${ok} action(s) lancée(s)${targets.length < selected.length ? ` (${selected.length - targets.length} déjà dans l'état voulu)` : ""}`, "ok");
    setTimeout(res.refresh, 1500);
  }

  const columns: Column<any>[] = [
    { id: "vmid", header: "ID", cell: (g) => <span className="mono muted">{g.vmid}</span>, sort: (g) => g.vmid, width: 60 },
    {
      id: "name", header: "Nom", className: "name", sort: (g) => g.name, text: (g) => `${g.name} ${g.tags ?? ""}`,
      cell: (g) => (
        <>
          <TypeTag type={g.type} /> <strong style={{ marginLeft: 6 }}>{g.name}</strong>
          {g.tags && <div className="chips" style={{ marginTop: 4 }}>{tagList(g.tags).map((t) => <span key={t} className="chip">{t}</span>)}</div>}
        </>
      ),
    },
    { id: "status", header: "Statut", cell: (g) => <Status status={g.status} />, sort: (g) => g.status },
    { id: "node", header: "Nœud", className: "mono small", hidden: new Set(all.map((g) => g.node)).size < 2, sort: (g) => g.node, cell: (g) => g.node },
    {
      id: "ip", header: "Adresse IP", className: "ip", text: (g) => (byId.get(g.vmid)?.ips ?? []).join(" "), sort: (g) => byId.get(g.vmid)?.ips?.[0] ?? "",
      cell: (g) => {
        const i = byId.get(g.vmid);
        return i?.ips?.length ? i.ips.join(", ") : <span className="muted small">{g.status !== "running" ? "-" : i?.agent === false ? "agent absent" : inv.loading ? "…" : "inconnue"}</span>;
      },
    },
    {
      id: "cpu", header: "Processeur", className: "small nowrap", sort: (g) => (g.status === "running" ? g.cpu : -1),
      cell: (g) => (g.status === "running" ? <><MiniMeter ratio={g.cpu} />{pct(g.cpu)} <span className="muted">· {g.maxcpu} c.</span></> : <span className="muted">{g.maxcpu} cœurs</span>),
    },
    {
      id: "mem", header: "Mémoire", className: "small nowrap", sort: (g) => (g.status === "running" ? g.mem : -1),
      cell: (g) => (g.status === "running" ? <><MiniMeter ratio={g.mem / g.maxmem} />{bytes(g.mem)}</> : <span className="muted">{bytes(g.maxmem)}</span>),
    },
    { id: "uptime", header: "Allumée depuis", className: "small muted", sort: (g) => g.uptime ?? 0, cell: (g) => uptime(g.uptime) },
    {
      id: "backup", header: "Sauvegarde", className: "small", hidden: !showBackups, sort: (g) => (bkById.get(g.vmid) as any)?.lastBackup ?? 0,
      cell: (g) => {
        const b: any = bkById.get(g.vmid);
        return b ? <span className={b.stale ? "health-bad" : ""}>{ago(b.lastBackup)}</span> : <span className="muted">…</span>;
      },
    },
  ];

  const can = (sel: any[], priv: string) => sel.every((g) => hasPermission(map, `/vms/${g.vmid}`, priv));

  return (
    <>
      <PageHead
        title="Machines"
        sub={`${all.length} au total · ${all.filter((g) => g.status === "running").length} en marche`}
        actions={<Link to="/creer" className="btn btn-primary"><I.plus /> Créer</Link>}
      />
      {res.error && <div style={{ marginBottom: 16 }}><Notice kind="error">{res.error}</Notice></div>}

      <Panel pad={false}>
        <DataTable
          rows={res.data ? list : null}
          loading={res.loading}
          columns={columns}
          rowKey={(g) => g.id}
          rowLabel={(g) => g.name}
          initialSort={{ id: "vmid", dir: "asc" }}
          filter="Nom, ID, tag ou adresse IP"
          onRowClick={(g) => navigate(`/machines/${g.node}/${g.type}/${g.vmid}`)}
          actions={(g) => <GuestActions g={g} size="sm" onChange={res.refresh} />}
          empty={<>Aucune machine. <Link to="/creer" style={{ color: "var(--orange-ink)" }}>Créer la première</Link></>}
          toolbar={
            <span className="row">
              <span className="btn-group">
                {FILTERS.map((f) => <Button key={f.id} size="sm" variant={filter === f.id ? "dark" : "default"} onClick={() => setFilter(f.id)}>{f.label}</Button>)}
              </span>
              {tags.length > 0 && (
                <select className="select input" aria-label="Filtrer par tag" style={{ width: 150, height: 28 }} value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">Tous les tags</option>
                  {tags.map((t) => <option key={t}>{t}</option>)}
                </select>
              )}
            </span>
          }
          bulk={(selected, clear) => (
            <>
              {(Object.keys(BULK) as Bulk[]).map((k) => {
                const ok = can(selected, BULK[k].priv);
                return (
                  <span key={k} title={ok ? undefined : `Il te manque le droit ${BULK[k].priv} sur au moins une machine`}>
                    <Button size="sm" disabled={!ok} icon={k === "start" ? <I.play /> : k === "shutdown" ? <I.power /> : k === "reboot" ? <I.reboot /> : k === "snapshot" ? <I.camera /> : k === "backup" ? <I.download /> : undefined} onClick={() => setBulk({ kind: k, list: selected, clear })}>
                      {BULK[k].button}
                    </Button>
                  </span>
                );
              })}
            </>
          )}
        />
      </Panel>

      {bulk && !FORMS[bulk.kind] && (
        <Confirm
          title={BULK[bulk.kind].title}
          confirmLabel={BULK[bulk.kind].label}
          onConfirm={async () => {
            await runBulk(bulk.kind, bulk.list);
            bulk.clear();
          }}
          onClose={() => setBulk(null)}
        >
          <p>{bulk.list.map((g) => g.name).join(", ")}</p>
        </Confirm>
      )}
      {bulk && FORMS[bulk.kind] && (
        <Modal title={BULK[bulk.kind].title} onClose={() => setBulk(null)}>
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>{bulk.list.map((g) => g.name).join(", ")}</p>
            <Form
              fields={FORMS[bulk.kind]!}
              submitLabel={BULK[bulk.kind].label}
              onCancel={() => setBulk(null)}
              onSubmit={async (_c, v) => {
                await runBulk(bulk.kind, bulk.list, v);
                bulk.clear();
                setBulk(null);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

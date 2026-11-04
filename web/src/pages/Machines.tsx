import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Confirm, MiniMeter, Notice, PageHead, Panel, Status, TypeTag, useToast } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
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
type Bulk = "start" | "shutdown" | "snapshot";
const BULK: Record<Bulk, { title: string; label: string; priv: string }> = {
  start: { title: "Démarrer la sélection ?", label: "Démarrer", priv: "VM.PowerMgmt" },
  shutdown: { title: "Éteindre la sélection ?", label: "Éteindre", priv: "VM.PowerMgmt" },
  snapshot: { title: "Snapshot de la sélection ?", label: "Prendre les snapshots", priv: "VM.Snapshot" },
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

  async function runBulk(kind: Bulk, selected: any[]) {
    const name = `lot-${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`;
    const targets = selected.filter((g) => (kind === "start" ? g.status !== "running" : kind === "shutdown" ? g.status === "running" : true));
    let ok = 0;
    for (const g of targets) {
      try {
        const base = `/nodes/${g.node}/${g.type}/${g.vmid}`;
        const upid = kind === "snapshot"
          ? await pve.post(`${base}/snapshot`, { snapname: name, description: "Snapshot groupé depuis MyProxmox" })
          : await pve.post(`${base}/status/${kind}`);
        watch(g.node, upid, `${g.name}`);
        ok++;
      } catch (e) {
        toast(`${g.name} : ${(e as Error).message}. Vérifie son état puis réessaie.`, "error");
      }
    }
    toast(`${ok} action(s) lancée(s)`, "ok");
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
          empty={<>Aucune machine. <Link to="/creer" style={{ color: "var(--orange)" }}>Créer la première</Link></>}
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
                    <Button size="sm" disabled={!ok} icon={k === "start" ? <I.play /> : k === "shutdown" ? <I.power /> : <I.camera />} onClick={() => setBulk({ kind: k, list: selected, clear })}>
                      {k === "start" ? "Démarrer" : k === "shutdown" ? "Éteindre" : "Snapshot"}
                    </Button>
                  </span>
                );
              })}
            </>
          )}
        />
      </Panel>

      {bulk && (
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
    </>
  );
}

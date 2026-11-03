import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Confirm, Empty, MiniMeter, Notice, PageHead, Panel, Status, TypeTag, useToast } from "../components/ui";
import { GuestActions } from "../components/GuestActions";
import { I } from "../components/icons";
import { api, pve, usePoll } from "../lib/api";
import { useApp } from "../lib/app";
import { ago, bytes, pct, uptime } from "../../../shared/format";

type Filter = "all" | "running" | "stopped" | "qemu" | "lxc";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Toutes" }, { id: "running", label: "En marche" }, { id: "stopped", label: "Arrêtées" },
  { id: "qemu", label: "VM" }, { id: "lxc", label: "Conteneurs" },
];

export function Machines() {
  const navigate = useNavigate();
  const { settings } = useApp();
  const { toast, watch } = useToast();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tag, setTag] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<"start" | "shutdown" | "snapshot" | null>(null);

  const res = usePoll(() => pve.get<any[]>("/cluster/resources", { type: "vm" }), 4000);
  const inv = usePoll(() => api<any[]>("/api/insights/inventory"), 30000);
  const bk = usePoll(() => (settings?.modules.backups !== false ? api("/api/insights/backups") : Promise.resolve(null)), 120000, [settings?.modules.backups]);

  const all = (res.data ?? []).filter((r) => !r.template).sort((a, b) => a.vmid - b.vmid);
  const byId = useMemo(() => new Map((inv.data ?? []).map((r) => [r.vmid, r])), [inv.data]);
  const bkById = useMemo(() => new Map((bk.data?.rows ?? []).map((r: any) => [r.vmid, r])), [bk.data]);
  const tags = [...new Set(all.flatMap((g) => String(g.tags ?? "").split(/[;,\s]+/).filter(Boolean)))].sort();

  const list = all.filter((g) => {
    if (filter === "running" && g.status !== "running") return false;
    if (filter === "stopped" && g.status === "running") return false;
    if ((filter === "qemu" || filter === "lxc") && g.type !== filter) return false;
    if (tag && !String(g.tags ?? "").split(/[;,\s]+/).includes(tag)) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const ips = byId.get(g.vmid)?.ips ?? [];
    return String(g.vmid).includes(s) || (g.name ?? "").toLowerCase().includes(s) || ips.some((ip: string) => ip.includes(s));
  });

  const selected = all.filter((g) => sel.has(g.vmid));
  const toggle = (vmid: number) => setSel((s) => { const n = new Set(s); n.has(vmid) ? n.delete(vmid) : n.add(vmid); return n; });

  async function runBulk(kind: "start" | "shutdown" | "snapshot") {
    const name = `lot-${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`;
    const targets = selected.filter((g) => (kind === "start" ? g.status !== "running" : kind === "shutdown" ? g.status === "running" : true));
    let ok = 0;
    for (const g of targets) {
      try {
        const base = `/nodes/${g.node}/${g.type}/${g.vmid}`;
        const upid = kind === "snapshot" ? await pve.post(`${base}/snapshot`, { snapname: name, description: "Snapshot groupé depuis MyProxmox" }) : await pve.post(`${base}/status/${kind}`);
        watch(g.node, upid, `${g.name}`);
        ok++;
      } catch (e) {
        toast(`${g.name} : ${(e as Error).message}`, "error");
      }
    }
    toast(`${ok} action(s) lancée(s)`, "ok");
    setSel(new Set());
    setTimeout(res.refresh, 1500);
  }

  return (
    <>
      <PageHead
        title="Machines"
        sub={`${all.length} au total · ${all.filter((g) => g.status === "running").length} en marche`}
        actions={<Link to="/creer" className="btn btn-primary"><I.plus /> Créer</Link>}
      />
      {res.error && <div style={{ marginBottom: 16 }}><Notice kind="error">{res.error}</Notice></div>}

      <Panel
        pad={false}
        title={
          <span className="row">
            <span className="btn-group">
              {FILTERS.map((f) => <Button key={f.id} size="sm" variant={filter === f.id ? "dark" : "default"} onClick={() => setFilter(f.id)}>{f.label}</Button>)}
            </span>
            {tags.length > 0 && (
              <select className="select input" style={{ width: 150, height: 28 }} value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Tous les tags</option>
                {tags.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
          </span>
        }
        right={<input className="input" style={{ width: 260, height: 30 }} placeholder="Nom, ID ou adresse IP" value={q} onChange={(e) => setQ(e.target.value)} />}
      >
        {selected.length > 0 && (
          <div className="bulkbar">
            <strong>{selected.length} sélectionnée(s)</strong>
            <Button size="sm" icon={<I.play />} onClick={() => setBulk("start")}>Démarrer</Button>
            <Button size="sm" icon={<I.power />} onClick={() => setBulk("shutdown")}>Éteindre</Button>
            <Button size="sm" icon={<I.camera />} onClick={() => setBulk("snapshot")}>Snapshot</Button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())} style={{ color: "#fff", background: "transparent" }}>Annuler</Button>
          </div>
        )}
        {list.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}><input type="checkbox" aria-label="Tout sélectionner" checked={list.length > 0 && list.every((g) => sel.has(g.vmid))} onChange={(e) => setSel(e.target.checked ? new Set(list.map((g) => g.vmid)) : new Set())} /></th>
                  <th>ID</th><th>Nom</th><th>Statut</th><th>Adresse IP</th><th>Processeur</th><th>Mémoire</th><th>Allumée depuis</th>
                  {settings?.modules.backups !== false && <th>Sauvegarde</th>}
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((g) => {
                  const i = byId.get(g.vmid);
                  const b: any = bkById.get(g.vmid);
                  return (
                    <tr key={g.id} className="clickable" onClick={() => navigate(`/machines/${g.node}/${g.type}/${g.vmid}`)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(g.vmid)} onChange={() => toggle(g.vmid)} aria-label={`Sélectionner ${g.name}`} /></td>
                      <td className="mono muted">{g.vmid}</td>
                      <td className="name">
                        <TypeTag type={g.type} /> <strong style={{ marginLeft: 6 }}>{g.name}</strong>
                        {g.tags && <div className="chips" style={{ marginTop: 4 }}>{String(g.tags).split(/[;,\s]+/).filter(Boolean).map((t: string) => <span key={t} className="chip">{t}</span>)}</div>}
                      </td>
                      <td><Status status={g.status} /></td>
                      <td className="ip">
                        {i?.ips?.length ? i.ips.join(", ") : <span className="muted small">{g.status !== "running" ? "-" : i?.agent === false ? "agent absent" : inv.loading ? "…" : "inconnue"}</span>}
                      </td>
                      <td className="small nowrap">{g.status === "running" ? <><MiniMeter ratio={g.cpu} />{pct(g.cpu)} <span className="muted">· {g.maxcpu} c.</span></> : <span className="muted">{g.maxcpu} cœurs</span>}</td>
                      <td className="small nowrap">{g.status === "running" ? <><MiniMeter ratio={g.mem / g.maxmem} />{bytes(g.mem)}</> : <span className="muted">{bytes(g.maxmem)}</span>}</td>
                      <td className="small muted">{uptime(g.uptime)}</td>
                      {settings?.modules.backups !== false && (
                        <td className="small">{b ? <span className={b.stale ? "health-bad" : ""}>{ago(b.lastBackup)}</span> : <span className="muted">…</span>}</td>
                      )}
                      <td className="actions"><GuestActions g={g} size="sm" onChange={res.refresh} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{res.loading ? "Chargement…" : all.length ? "Aucune machine ne correspond." : <>Aucune machine. <Link to="/creer" style={{ color: "var(--orange)" }}>Créer la première</Link></>}</Empty>
        )}
      </Panel>

      {bulk && (
        <Confirm
          title={bulk === "start" ? "Démarrer la sélection ?" : bulk === "shutdown" ? "Éteindre la sélection ?" : "Snapshot de la sélection ?"}
          confirmLabel={bulk === "start" ? "Démarrer" : bulk === "shutdown" ? "Éteindre" : "Prendre les snapshots"}
          onConfirm={() => runBulk(bulk)}
          onClose={() => setBulk(null)}
        >
          <p>{selected.map((g) => g.name).join(", ")}</p>
        </Confirm>
      )}
    </>
  );
}

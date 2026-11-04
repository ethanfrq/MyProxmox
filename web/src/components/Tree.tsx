// Arbre des ressources façon Proxmox : Datacenter > nœuds > VM, conteneurs et stockages,
// avec une vue par pool et une vue par tag. Clic droit : menu des actions de la ressource.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pve, usePoll } from "../lib/api";
import { hasPermission, usePermissions } from "../lib/permissions";
import { Confirm, useToast } from "./ui";
import { I } from "./icons";

export interface Res {
  id: string;
  type: "node" | "qemu" | "lxc" | "storage" | "pool" | "sdn" | string;
  node?: string;
  vmid?: number;
  name?: string;
  storage?: string;
  pool?: string;
  status?: string;
  tags?: string;
  template?: number;
}

type View = "serveurs" | "pools" | "tags";

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* navigation privée */
    }
  },
};

export const tagList = (t?: string) => String(t ?? "").split(/[;,\s]+/).filter(Boolean);

export function resLabel(r: Res) {
  if (r.type === "qemu" || r.type === "lxc") return `${r.vmid} (${r.name ?? "?"})`;
  if (r.type === "storage") return `${r.storage} (${r.node})`;
  if (r.type === "pool") return r.pool ?? r.id;
  return r.node ?? r.id;
}

export function resPath(r: Res) {
  if (r.type === "qemu" || r.type === "lxc") return `/machines/${r.node}/${r.type}/${r.vmid}`;
  if (r.type === "node") return `/serveur?node=${encodeURIComponent(r.node ?? "")}`;
  if (r.type === "storage") return `/stockage?storage=${encodeURIComponent(r.storage ?? "")}`;
  return "/";
}

interface TreeNodeData { key: string; label: ReactNode; icon: ReactNode; res?: Res; to?: string; children?: TreeNodeData[]; status?: string }

function guestIcon(r: Res) {
  const cls = `tree-ico ${r.type === "qemu" ? "vm" : "ct"} ${r.status === "running" ? "on" : r.template ? "tpl" : "off"}`;
  return <span className={cls} aria-hidden>{r.template ? "T" : r.type === "qemu" ? "VM" : "CT"}</span>;
}

function build(view: View, list: Res[]): TreeNodeData[] {
  const guests = list.filter((r) => r.type === "qemu" || r.type === "lxc").sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0));
  const leaf = (r: Res): TreeNodeData => ({ key: r.id, label: resLabel(r), icon: guestIcon(r), res: r, to: resPath(r), status: r.status });
  if (view === "pools") {
    const pools = [...new Set([...list.filter((r) => r.type === "pool").map((r) => r.pool!), ...guests.map((g) => g.pool).filter(Boolean) as string[]])].sort();
    const out: TreeNodeData[] = pools.map((p) => ({
      key: `pool/${p}`, label: p, icon: <span className="tree-ico pool" aria-hidden>P</span>, children: guests.filter((g) => g.pool === p).map(leaf),
    }));
    const none = guests.filter((g) => !g.pool);
    if (none.length) out.push({ key: "pool/-", label: <span className="muted">Sans pool</span>, icon: <span className="tree-ico pool" aria-hidden>-</span>, children: none.map(leaf) });
    return out;
  }
  if (view === "tags") {
    const tags = [...new Set(guests.flatMap((g) => tagList(g.tags)))].sort();
    const out: TreeNodeData[] = tags.map((t) => ({
      key: `tag/${t}`, label: t, icon: <span className="tree-ico tag" aria-hidden>#</span>, children: guests.filter((g) => tagList(g.tags).includes(t)).map(leaf),
    }));
    const none = guests.filter((g) => !tagList(g.tags).length);
    if (none.length) out.push({ key: "tag/-", label: <span className="muted">Sans tag</span>, icon: <span className="tree-ico tag" aria-hidden>-</span>, children: none.map(leaf) });
    return out;
  }
  const nodes = list.filter((r) => r.type === "node").sort((a, b) => String(a.node).localeCompare(String(b.node)));
  return nodes.map((n) => ({
    key: n.id, label: n.node, res: n, to: resPath(n), status: n.status,
    icon: <span className={`tree-ico node ${n.status === "online" ? "on" : "off"}`} aria-hidden><I.server /></span>,
    children: [
      ...guests.filter((g) => g.node === n.node).map(leaf),
      ...list.filter((r) => r.type === "storage" && r.node === n.node).sort((a, b) => String(a.storage).localeCompare(String(b.storage))).map((s) => ({
        key: s.id, label: s.storage, res: s, to: resPath(s), status: s.status,
        icon: <span className={`tree-ico sto ${s.status === "available" ? "on" : "off"}`} aria-hidden><I.storage /></span>,
      })),
    ],
  }));
}

// ── Menu contextuel ───────────────────────────────────────────────
type Menu = { x: number; y: number; res: Res };
type Pending = { res: Res; action: "start" | "shutdown" | "reboot" | "stop" };

function ContextMenu({ menu, onClose, onAction }: { menu: Menu; onClose: () => void; onAction: (p: Pending) => void }) {
  const navigate = useNavigate();
  const { map } = usePermissions();
  const ref = useRef<HTMLDivElement>(null);
  const r = menu.res;
  useEffect(() => {
    const close = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", onClose, true);
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const guest = r.type === "qemu" || r.type === "lxc";
  const power = guest && hasPermission(map, `/vms/${r.vmid}`, "VM.PowerMgmt");
  const deny = "Il te manque le droit VM.PowerMgmt";
  const item = (label: string, fn: () => void, opts: { disabled?: boolean; danger?: boolean; title?: string } = {}) => (
    <button type="button" role="menuitem" className={opts.danger ? "danger" : ""} disabled={opts.disabled} title={opts.disabled ? opts.title : undefined} onClick={() => { onClose(); fn(); }}>{label}</button>
  );
  const running = r.status === "running";
  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 260) }}>
      <div className="ctx-title">{resLabel(r)}</div>
      {item("Ouvrir", () => navigate(resPath(r)))}
      {guest && !r.template && (
        <>
          {!running && item("Démarrer", () => onAction({ res: r, action: "start" }), { disabled: !power, title: deny })}
          {running && item("Éteindre", () => onAction({ res: r, action: "shutdown" }), { disabled: !power, title: deny })}
          {running && item("Redémarrer", () => onAction({ res: r, action: "reboot" }), { disabled: !power, title: deny })}
          {running && item("Arrêt forcé", () => onAction({ res: r, action: "stop" }), { disabled: !power, title: deny, danger: true })}
        </>
      )}
      {r.type === "node" && item("Santé du serveur", () => navigate(resPath(r)))}
      {r.type === "storage" && item("Voir le contenu", () => navigate(resPath(r)))}
    </div>
  );
}

const LABEL: Record<Pending["action"], [string, string]> = {
  start: ["Démarrer", "La machine démarre avec sa configuration actuelle."],
  shutdown: ["Éteindre", "Proxmox demande au système invité de s'éteindre proprement."],
  reboot: ["Redémarrer", "Les services de cette machine seront coupés quelques instants."],
  stop: ["Couper l'alimentation", "Revient à débrancher la prise : tout ce qui n'est pas enregistré est perdu."],
};

// ── Panneau ───────────────────────────────────────────────────────
export function TreePanel() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { watch, toast } = useToast();
  const [collapsed, setCollapsed] = useState(store.get("myproxmox-tree") === "closed");
  const [view, setView] = useState<View>((store.get("myproxmox-tree-view") as View) || "serveurs");
  const [closed, setClosed] = useState<Set<string>>(() => new Set(JSON.parse(store.get("myproxmox-tree-closed") ?? "[]")));
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const res = usePoll(() => (collapsed ? Promise.resolve(null) : pve.get<Res[]>("/cluster/resources")), 10000, [collapsed]);

  useEffect(() => store.set("myproxmox-tree", collapsed ? "closed" : "open"), [collapsed]);
  useEffect(() => store.set("myproxmox-tree-view", view), [view]);
  useEffect(() => store.set("myproxmox-tree-closed", JSON.stringify([...closed])), [closed]);

  const tree = useMemo(() => build(view, res.data ?? []), [view, res.data]);
  const here = loc.pathname + loc.search;

  if (collapsed) {
    return (
      <aside className="tree tree-collapsed" aria-label="Arbre des ressources (replié)">
        <button className="tree-toggle" title="Afficher l'arbre des ressources" aria-label="Afficher l'arbre des ressources" onClick={() => setCollapsed(false)}>»</button>
      </aside>
    );
  }

  const toggle = (k: string) => setClosed((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const renderNode = (n: TreeNodeData, depth: number): ReactNode => {
    const open = !closed.has(n.key);
    const active = n.to && (here === n.to || (n.res && (n.res.type === "qemu" || n.res.type === "lxc") && loc.pathname === n.to));
    const onCtx = (e: MouseEvent) => {
      if (!n.res) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, res: n.res });
    };
    return (
      <li key={n.key} role="treeitem" aria-expanded={n.children ? open : undefined} aria-selected={!!active}>
        <div className={`tree-row ${active ? "active" : ""}`} style={{ paddingLeft: 6 + depth * 14 }} onContextMenu={onCtx}>
          {n.children ? (
            <button type="button" className="tree-caret" aria-label={open ? "Replier" : "Déplier"} onClick={() => toggle(n.key)}>{open ? "▾" : "▸"}</button>
          ) : <span className="tree-caret" />}
          <button
            type="button"
            className="tree-label"
            onClick={() => (n.to ? navigate(n.to) : toggle(n.key))}
            onKeyDown={(e) => {
              if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                e.preventDefault();
                const b = (e.target as HTMLElement).getBoundingClientRect();
                if (n.res) setMenu({ x: b.left + 20, y: b.bottom, res: n.res });
              }
            }}
          >
            {n.icon}<span className="tree-text">{n.label}</span>
          </button>
        </div>
        {n.children && open && n.children.length > 0 && <ul role="group">{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  async function run(p: Pending) {
    const r = p.res;
    try {
      const upid = await pve.post<string>(`/nodes/${r.node}/${r.type}/${r.vmid}/status/${p.action}`);
      watch(r.node!, upid, `${r.name ?? r.vmid}`, res.refresh);
      setTimeout(res.refresh, 1200);
    } catch (e) {
      toast(`${r.name} : ${(e as Error).message}`, "error");
    }
  }

  return (
    <aside className="tree" aria-label="Arbre des ressources">
      <div className="tree-head">
        <select className="input select" aria-label="Vue de l'arbre" value={view} onChange={(e) => setView(e.target.value as View)}>
          <option value="serveurs">Vue serveurs</option>
          <option value="pools">Vue par pool</option>
          <option value="tags">Vue par tag</option>
        </select>
        <button className="tree-toggle" title="Replier l'arbre" aria-label="Replier l'arbre" onClick={() => setCollapsed(true)}>«</button>
      </div>
      <ul className="tree-list" role="tree">
        <li role="treeitem" aria-expanded aria-selected={here === "/"}>
          <div className={`tree-row ${loc.pathname === "/" ? "active" : ""}`} style={{ paddingLeft: 6 }}>
            <span className="tree-caret" />
            <button type="button" className="tree-label" onClick={() => navigate("/")}><span className="tree-ico dc" aria-hidden><I.overview /></span><span className="tree-text">Datacenter</span></button>
          </div>
          <ul role="group">
            {tree.map((n) => renderNode(n, 1))}
            {!res.data && !res.error && <li className="tree-empty"><span className="spin" /> Chargement…</li>}
            {res.error && <li className="tree-empty">Arbre indisponible : {res.error}</li>}
            {res.data && !tree.length && <li className="tree-empty">{view === "pools" ? "Aucun pool." : view === "tags" ? "Aucune machine." : "Aucun nœud."}</li>}
          </ul>
        </li>
      </ul>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} onAction={setPending} />}
      {pending && (
        <Confirm
          title={`${LABEL[pending.action][0]} ${pending.res.name} ?`}
          danger={pending.action === "stop"}
          confirmLabel={LABEL[pending.action][0]}
          onConfirm={() => run(pending)}
          onClose={() => setPending(null)}
        >
          <p>{LABEL[pending.action][1]}</p>
        </Confirm>
      )}
    </aside>
  );
}

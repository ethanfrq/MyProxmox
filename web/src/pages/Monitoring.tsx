// Écran de monitoring : lecture seule, données vives toutes les 5 s, pensé pour rester
// affiché sur une TV. Deux modes :
//  - vues standard (Vue d'ensemble, Machines, Nœuds...), fixes par défaut, avec défilement en option ;
//  - « mur » : disposition nommée choisie par ?layout=nom, éditable par un administrateur.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, usePoll } from "../lib/api";
import { uptime } from "../../../shared/format";
import { VIEWS, WIDGETS, WIDGET_IDS, type MonLayout, type WidgetId, type WidgetPlace } from "../../../shared/layouts";
import { RENDER, widgetsForAlert, type Ctx, type GuestGroup, type GuestSort, type Snap } from "./monitoring/widgets";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
};

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mon-clock">
      <div className="time">{now.toLocaleTimeString("fr-FR")}</div>
      <div className="date">{now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div>
    </div>
  );
}

/** Petit bip à deux tons, joué quand une nouvelle alerte critique apparaît. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ac = new Ctx();
    [880, 660].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.15, ac.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.25 + 0.22);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.25);
      o.stop(ac.currentTime + i * 0.25 + 0.24);
    });
    setTimeout(() => ac.close(), 800);
  } catch {
    /* pas de son disponible */
  }
}

function Widget({ place, d, ctx, alarm, onCtx }: { place: WidgetPlace; d: Snap; ctx: Ctx; alarm: boolean; onCtx: (c: Partial<Ctx>) => void }) {
  return (
    <section className={`mon-card mw-${place.w} mh-${place.h} ${alarm ? "alarm" : ""}`} aria-label={WIDGETS[place.id]}>
      <div className="mon-card-head">
        <h3>{WIDGETS[place.id]}</h3>
        {(place.id === "guests" || place.id === "guests-table") && (
          <span className="mon-tools">
            <select aria-label="Trier les machines" value={ctx.sort} onChange={(e) => onCtx({ sort: e.target.value as GuestSort })}>
              <option value="status">En marche d'abord</option><option value="vmid">Par ID</option><option value="name">Par nom</option>
              <option value="cpu">Par CPU</option><option value="mem">Par RAM</option><option value="net">Par réseau</option>
            </select>
            <select aria-label="Regrouper les machines" value={ctx.group} onChange={(e) => onCtx({ group: e.target.value as GuestGroup })}>
              <option value="none">Sans regroupement</option><option value="tag">Par tag</option><option value="node">Par nœud</option>
            </select>
          </span>
        )}
      </div>
      <div className="mon-card-body">{RENDER[place.id](d, ctx)}</div>
    </section>
  );
}

// ── Éditeur de disposition (administrateurs) ──────────────────────
function LayoutEditor({ initial, name: initialName, onClose, onSaved }: { initial: WidgetPlace[]; name: string; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  const [list, setList] = useState<WidgetPlace[]>(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const move = (from: number, to: number) => setList((l) => {
    const n = [...l];
    const [x] = n.splice(from, 1);
    n.splice(to, 0, x);
    return n;
  });
  const set = (i: number, patch: Partial<WidgetPlace>) => setList((l) => l.map((w, k) => (k === i ? { ...w, ...patch } : w)));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/monitoring-layouts/${encodeURIComponent(name)}`, { method: "PUT", body: { widgets: list } });
      onSaved(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mon-editor" role="dialog" aria-label="Disposition du mur">
      <div className="mon-editor-head">
        <strong>Disposition du mur</strong>
        <button type="button" onClick={onClose} aria-label="Fermer l'éditeur">×</button>
      </div>
      <label className="mon-editor-field">Nom (dans l&apos;adresse : ?layout=nom)
        <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="salon" />
      </label>
      <p className="mon-sub">Glisse les lignes pour changer l&apos;ordre. Largeur sur 12 colonnes, hauteur en rangées.</p>
      <ol className="mon-editor-list">
        {list.map((w, i) => (
          <li
            key={`${w.id}-${i}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }}
            onDragEnd={() => setDrag(null)}
            className={drag === i ? "dragging" : ""}
          >
            <span className="grip" aria-hidden>⋮⋮</span>
            <span className="w-name">{WIDGETS[w.id]}</span>
            <select aria-label={`Largeur de ${WIDGETS[w.id]}`} value={w.w} onChange={(e) => set(i, { w: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => <option key={n} value={n}>{n} col.</option>)}
            </select>
            <select aria-label={`Hauteur de ${WIDGETS[w.id]}`} value={w.h} onChange={(e) => set(i, { h: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} rang.</option>)}
            </select>
            <button type="button" aria-label={`Monter ${WIDGETS[w.id]}`} disabled={!i} onClick={() => move(i, i - 1)}>↑</button>
            <button type="button" aria-label={`Retirer ${WIDGETS[w.id]}`} onClick={() => setList((l) => l.filter((_, k) => k !== i))}>×</button>
          </li>
        ))}
      </ol>
      <select aria-label="Ajouter un widget" value="" onChange={(e) => e.target.value && setList((l) => [...l, { id: e.target.value as WidgetId, w: 6, h: 2 }])}>
        <option value="">+ Ajouter un widget</option>
        {WIDGET_IDS.map((id) => <option key={id} value={id}>{WIDGETS[id]}</option>)}
      </select>
      {error && <div className="mon-editor-error">{error}</div>}
      <div className="mon-editor-foot">
        <button type="button" className="btn btn-sm" onClick={onClose}>Annuler</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || !name || !list.length} onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}

export function Monitoring() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const key = params.get("key") ?? undefined;
  const layoutName = params.get("layout") ?? "";
  const snap = usePoll(() => api<Snap>("/api/monitoring", { query: { key } }), 5000, [key]);
  const d = snap.data;
  const layouts = usePoll(() => api<{ layouts: Record<string, MonLayout>; canEdit: boolean }>("/api/monitoring/layouts", { query: { key } }), 60000, [key]);

  // Sans lien secret, l'écran suit la session : on propose de se déconnecter
  const [viewer, setViewer] = useState<{ username: string; local: boolean } | null>(null);
  useEffect(() => {
    if (key) return;
    api("/api/auth/me").then((m) => setViewer({ username: m.displayName ?? m.username, local: m.kind === "local" })).catch(() => navigate("/login?compte=local&next=/monitoring", { replace: true }));
  }, [key, navigate]);
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    navigate(viewer?.local ? "/login?compte=local" : "/login", { replace: true });
  };

  // Réglages propres à cet écran
  // Pas de défilement par défaut : l'écran reste sur la vue choisie
  const [rotation, setRotation] = useState(() => Number(params.get("rotation") ?? store.get("myproxmox-mon-defilement") ?? 0));
  const [sound, setSound] = useState(() => store.get("myproxmox-mon-sound") === "on");
  const [ctx, setCtx] = useState<Ctx>(() => ({ sort: (store.get("myproxmox-mon-sort") as GuestSort) || "status", group: (store.get("myproxmox-mon-group") as GuestGroup) || "none" }));
  const [view, setView] = useState(() => Math.max(0, VIEWS.findIndex((v) => v.id === (params.get("vue") ?? store.get("myproxmox-mon-vue")))));
  const [elapsed, setElapsed] = useState(0);
  const [editing, setEditing] = useState(false);
  useEffect(() => store.set("myproxmox-mon-defilement", String(rotation)), [rotation]);
  useEffect(() => store.set("myproxmox-mon-vue", VIEWS[view].id), [view]);
  useEffect(() => store.set("myproxmox-mon-sound", sound ? "on" : "off"), [sound]);
  const updateCtx = useCallback((c: Partial<Ctx>) => setCtx((o) => {
    const n = { ...o, ...c };
    store.set("myproxmox-mon-sort", n.sort);
    store.set("myproxmox-mon-group", n.group);
    return n;
  }), []);

  // Rotation des vues
  const wall = layoutName ? layouts.data?.layouts[layoutName] : undefined;
  useEffect(() => {
    if (layoutName || !rotation || editing) return;
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => {
      const e = (Date.now() - start) / 1000;
      if (e >= rotation) {
        setView((v) => (v + 1) % VIEWS.length);
      } else setElapsed(e);
    }, 250);
    return () => clearInterval(id);
  }, [view, rotation, layoutName, editing]);

  // Garde l'écran allumé, et recharge la page toutes les 6 h (mise à jour de l'app, mémoire)
  useEffect(() => {
    let lock: any = null;
    const ask = async () => {
      try { lock = await (navigator as any).wakeLock?.request("screen"); } catch { /* non pris en charge */ }
    };
    ask();
    const onVis = () => document.visibilityState === "visible" && ask();
    document.addEventListener("visibilitychange", onVis);
    const reload = setTimeout(() => location.reload(), 6 * 3600 * 1000);
    document.title = "Monitoring · MyProxmox";
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(reload); lock?.release?.(); };
  }, []);

  // Son à l'arrivée d'une nouvelle alerte critique
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!d) return;
    const crit = new Set(d.alerts.filter((a) => a.level === "critical").map((a) => a.key));
    if (known.current && sound && [...crit].some((k) => !known.current!.has(k))) beep();
    known.current = crit;
  }, [d, sound]);

  const alarmed = useMemo(() => new Set((d?.alerts ?? []).filter((a) => a.level === "critical").flatMap((a) => widgetsForAlert(a.key))), [d]);

  if (!d) {
    return (
      <div className="mon mon-wait">
        <div>
          <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
          <p>{snap.error ? (snap.error.includes("Clé") ? "Lien de monitoring invalide ou expiré. Crée un nouveau lien dans Paramètres." : `Connexion impossible : ${snap.error}. L'écran réessaie tout seul.`) : "Chargement…"}</p>
        </div>
      </div>
    );
  }

  const crit = d.alerts.filter((a) => a.level === "critical");
  const warn = d.alerts.filter((a) => a.level === "warning");
  const level = crit.length ? "critical" : warn.length ? "warning" : "ok";
  const ageS = Math.round((Date.now() - Date.parse(d.at)) / 1000);
  const stale = ageS > 20 || !!snap.error;
  const places = editing ? null : wall?.widgets ?? (layoutName ? null : VIEWS[view].widgets);

  return (
    <div className={`mon ${level === "critical" ? "mon-critical" : ""}`}>
      <header className="mon-head">
        <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
        <div className="mon-nodes">
          {d.nodes.map((n) => <span key={n.node}><i className={`dot ${n.status === "online" ? "ok" : "crit"}`} /> {n.node} · {n.status === "online" ? `en ligne depuis ${uptime(n.uptime)}` : "HORS LIGNE"}</span>)}
        </div>
        <div className="mon-head-right">
          <span className={`mon-fresh ${stale ? "stale" : ""}`} role="status">
            {stale ? `Données figées depuis ${ageS} s${snap.error ? ` : ${snap.error}` : ""}` : `Mis à jour à ${new Date(d.at).toLocaleTimeString("fr-FR")}`}
          </span>
          {viewer && (
            <span className="mon-who">
              {viewer.local ? <Link to="/compte" title="Mon compte">{viewer.username}</Link> : <Link to="/">{viewer.username}</Link>}
              <button type="button" onClick={logout}>Se déconnecter</button>
            </span>
          )}
          <Clock />
        </div>
      </header>

      {d.source === "personnel" && (
        <div className="mon-banner info" role="note">
          Tu vois seulement ce que ton compte Proxmox a le droit de lire.
          <span className="mon-banner-msg">Pour tout voir sans être administrateur : un compte MyProxmox « monitoring », ou un compte Proxmox avec le rôle PVEAuditor (lecture seule) sur « / ».</span>
        </div>
      )}
      <div className={`mon-banner ${level}`} role="alert">
        {level === "ok" ? "Tout fonctionne normalement" : `${crit.length ? `${crit.length} alerte(s) critique(s)` : ""}${crit.length && warn.length ? " · " : ""}${warn.length ? `${warn.length} point(s) à surveiller` : ""}`}
        {level !== "ok" && <span className="mon-banner-msg">{(crit[0] ?? warn[0]).title}</span>}
      </div>

      <nav className="mon-views" aria-label="Vues">
        {layoutName ? (
          <span className="mon-view cur">Mur « {layoutName} »</span>
        ) : VIEWS.map((v, i) => (
          <button key={v.id} type="button" className={`mon-view ${i === view ? "cur" : ""}`} onClick={() => setView(i)} aria-current={i === view ? "true" : undefined}>
            {v.title}
            {i === view && rotation > 0 && <span className="mon-progress" style={{ "--p": `${Math.min(100, (elapsed / rotation) * 100)}%` } as CSSProperties} />}
          </button>
        ))}
        <span className="mon-controls">
          {!layoutName && (
            <select aria-label="Défilement des vues" value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
              <option value={0}>Vue fixe</option><option value={30}>Faire défiler toutes les 30 s</option><option value={60}>Faire défiler toutes les minutes</option><option value={120}>Faire défiler toutes les 2 min</option>
            </select>
          )}
          <select aria-label="Disposition" value={layoutName} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set("layout", e.target.value); else p.delete("layout"); setParams(p); }}>
            <option value="">Vues standard</option>
            {Object.keys(layouts.data?.layouts ?? {}).map((n) => <option key={n} value={n}>Mur : {n}</option>)}
          </select>
          <label className="mon-check"><input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); if (e.target.checked) beep(); }} /> Son des alertes</label>
          {layouts.data?.canEdit && <button type="button" onClick={() => setEditing(true)}>{layoutName ? "Modifier le mur" : "Créer un mur"}</button>}
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.()}>Plein écran</button>
        </span>
      </nav>

      {editing && (
        <LayoutEditor
          name={layoutName || "salon"}
          initial={wall?.widgets ?? VIEWS[0].widgets}
          onClose={() => setEditing(false)}
          onSaved={(n) => {
            setEditing(false);
            layouts.refresh();
            const p = new URLSearchParams(params);
            p.set("layout", n);
            setParams(p);
          }}
        />
      )}

      {layoutName && !wall && !editing && (
        <div className="mon-wait-inline">{layouts.data ? `Aucune disposition nommée « ${layoutName} ». Choisis-en une autre dans la liste, ou crée-la.` : "Chargement de la disposition…"}</div>
      )}
      <main className="mon-grid">
        {(places ?? wall?.widgets ?? []).map((p, i) => <Widget key={`${p.id}-${i}`} place={p} d={d} ctx={ctx} alarm={alarmed.has(p.id)} onCtx={updateCtx} />)}
      </main>
    </div>
  );
}

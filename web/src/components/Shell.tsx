import { Suspense, useEffect, useRef, useState, type ReactElement } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { I } from "./icons";
import { Button, useToast } from "./ui";
import { TreePanel } from "./Tree";
import { resetPermissions } from "../lib/permissions";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { DEMO, REPO_URL } from "../lib/env";
import { date } from "../../../shared/format";
import type { Modules } from "../../../shared/types";

type Item = { to: string; label: string; icon: () => ReactElement; module?: keyof Modules; end?: boolean; admin?: boolean; write?: boolean };
const NAV: { group: string; items: Item[] }[] = [
  { group: "Pilotage", items: [
    { to: "/", label: "Vue d'ensemble", icon: I.overview, end: true },
    { to: "/machines", label: "Machines", icon: I.machines },
    { to: "/creer", label: "Créer", icon: I.plus, write: true },
  ] },
  { group: "Infrastructure", items: [
    { to: "/datacenter", label: "Datacenter", icon: I.overview },
    { to: "/serveur", label: "Nœuds", icon: I.server },
    { to: "/stockage", label: "Stockage", icon: I.storage },
    { to: "/reseau", label: "Réseau", icon: I.network },
    { to: "/sauvegardes", label: "Sauvegardes", icon: I.backup, module: "backups" },
    { to: "/taches", label: "Tâches", icon: I.tasks },
  ] },
  { group: "Surveillance", items: [
    { to: "/alertes", label: "Alertes", icon: I.alert, module: "alerts" },
    { to: "/securite", label: "Sécurité", icon: I.shield, module: "security" },
  ] },
  { group: "Système", items: [
    { to: "/claude", label: "Claude & MCP", icon: I.claude, module: "mcp" },
    { to: "/parametres", label: "Paramètres", icon: I.settings, end: true },
    { to: "/parametres/comptes", label: "Comptes MyProxmox", icon: I.key, admin: true },
  ] },
];

export function Shell() {
  const { me, settings, alerts, notifications, markAllRead } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read).length;
  const crit = alerts.filter((a) => a.level === "critical").length;
  const warn = alerts.filter((a) => a.level === "warning").length;
  const mods = settings?.modules;

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <>
      <a href="#contenu" className="skip-link">Aller au contenu</a>
      {DEMO && <div className="demo-banner">Démo avec de fausses données : rien n'est envoyé nulle part. <a href={REPO_URL} target="_blank" rel="noreferrer">Installer MyProxmox chez toi</a></div>}
      <header className="topbar">
        <Link to="/" className="brand"><span className="brand-mark">P</span>MyProxmox</Link>
        {DEMO && <span className="mode-demo">DÉMO</span>}
        <span className="spacer" />
        {mods?.alerts !== false && (crit + warn > 0) && (
          <Link to="/alertes" className="btn btn-sm alert-pill" style={{ background: crit ? "var(--red)" : "var(--orange)", borderColor: "transparent", color: "#fff" }}>
            <I.alert /> {crit ? `${crit} critique${crit > 1 ? "s" : ""}` : ""}{crit && warn ? " · " : ""}{warn ? `${warn} attention` : ""}
          </Link>
        )}
        {mods?.monitoring !== false && (
          <Link to="/monitoring" className="icon-btn" title="Écran de monitoring" aria-label="Écran de monitoring"><I.monitor /></Link>
        )}
        <div ref={ref} style={{ position: "relative" }}>
          <button className="icon-btn" title="Notifications" aria-label="Notifications" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <I.bell />
            {unread > 0 && <span className={`dot-count ${notifications.some((n) => !n.read && n.level === "critical") ? "crit" : ""}`}>{unread > 99 ? "99+" : unread}</span>}
          </button>
          {open && (
            <div className="dropdown">
              <div className="dd-head">
                <strong>Notifications</strong>
                <span className="row">
                  {unread > 0 && <Button size="sm" variant="ghost" onClick={markAllRead}>Tout marquer lu</Button>}
                  <Button size="sm" onClick={() => { setOpen(false); navigate("/alertes"); }}>Tout voir</Button>
                </span>
              </div>
              {notifications.length ? notifications.slice(0, 15).map((n) => (
                <div key={n.id} className={`notif ${n.resolved ? "resolved" : n.level} ${n.read ? "" : "unread"}`}>
                  <span className="bar" />
                  <div>
                    <div className="t">{n.resolved ? "Résolu : " : ""}{n.title}</div>
                    <div className="m">{n.message}</div>
                    <div className="d">{date(n.at)}</div>
                  </div>
                </div>
              )) : <div className="empty">Aucune notification.</div>}
            </div>
          )}
        </div>
        {me.kind === "local"
          ? <Link to="/compte" className="user-chip" title="Mon compte">{me.displayName ?? me.username}<span className="tag">lecture seule</span></Link>
          : <span className="user-chip">{me.username}{me.admin && <span className="tag">admin</span>}</span>}
        <button className="icon-btn" title="Déconnexion" aria-label="Déconnexion" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); resetPermissions(); navigate("/login"); }}><I.logout /></button>
      </header>
      <div className="layout">
        <nav className="side" aria-label="Navigation">
          {NAV.map((g) => {
            const items = g.items.filter((it) => (!it.module || mods?.[it.module] !== false) && (!it.admin || me.admin) && (!it.write || !me.readOnly));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="side-group">{g.group}</div>
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? "active" : "")}>
                    <it.icon />{it.label}
                    {it.to === "/alertes" && alerts.length > 0 && <span className="tag" style={{ marginLeft: "auto", background: crit ? "var(--red-soft)" : "var(--orange-soft)", color: crit ? "var(--red)" : "var(--orange-ink)" }}>{alerts.length}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
          {settings && <div className="side-group" style={{ marginTop: 20, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>v{settings.version}</div>}
        </nav>
        <TreePanel />
        <main className="main" id="contenu" tabIndex={-1}><Suspense fallback={<div className="empty">Chargement…</div>}><Outlet /></Suspense></main>
      </div>
    </>
  );
}

/** Branche les notifications en direct sur les toasts. */
export function useLiveToasts() {
  const { toast } = useToast();
  return (n: { title: string; level: string; resolved?: boolean }) => toast(`${n.resolved ? "Résolu : " : ""}${n.title}`, n.resolved ? "ok" : n.level === "critical" ? "error" : "info");
}

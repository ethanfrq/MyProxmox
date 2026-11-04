// Fiche d'une VM ou d'un conteneur. Chaque onglet est dans web/src/pages/machine/.
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Suspense, lazy, useMemo } from "react";
import { Notice, PageHead, Status, Tabs, TypeTag } from "../components/ui";
import { GuestActions } from "../components/GuestActions";
import { I } from "../components/icons";
import { pve, usePoll } from "../lib/api";
import { uptime } from "../../../shared/format";
import type { GuestCtx } from "./machine/common";
import { Summary } from "./machine/Summary";
import { Hardware } from "./machine/Hardware";
import { CloudInit } from "./machine/CloudInit";
import { Options } from "./machine/Options";
import { History } from "./machine/History";
import { Snapshots } from "./machine/Snapshots";
import { Backups } from "./machine/Backups";
import { DeleteGuest } from "./machine/Danger";
import { GuestNetwork } from "./machine/Network";
import { Replication } from "./machine/Replication";
import { MoreActions } from "./machine/Lifecycle";
import { FirewallPanel } from "../components/Firewall";
import { AclEditor } from "../components/AclEditor";
import { Panel } from "../components/ui";
import { Agent } from "./machine/Agent";

// La console (noVNC, xterm.js) n'est chargée que quand on ouvre l'onglet
const ConsoleTab = lazy(() => import("./machine/Console"));

type Tab = "resume" | "console" | "agent" | "reseau" | "materiel" | "cloudinit" | "options" | "historique" | "snapshots" | "sauvegardes" | "replication" | "parefeu" | "permissions" | "supprimer";

export function MachineDetail() {
  const params = useParams<{ node: string; type: "qemu" | "lxc"; vmid: string }>();
  const [search, setSearch] = useSearchParams();
  const node = params.node!;
  const type = params.type as "qemu" | "lxc";
  const vmid = params.vmid!;
  const base = `/nodes/${node}/${type}/${vmid}`;
  const tab = (search.get("onglet") as Tab) || "resume";
  const setTab = (t: Tab) => setSearch((p) => { const n = new URLSearchParams(p); n.set("onglet", t); return n; }, { replace: true });

  const status = usePoll(() => pve.get(`${base}/status/current`), 4000, [base]);
  const config = usePoll(() => pve.get<Record<string, string>>(`${base}/config`), 0, [base]);

  const s = status.data;
  const c = config.data;
  const name = c?.name ?? c?.hostname ?? s?.name ?? `#${vmid}`;
  const running = s?.status === "running";
  const g = { node, type, vmid: Number(vmid), name, status: s?.status ?? "unknown", paused: s?.qmpstatus === "paused" || s?.status === "paused" };
  const ctx: GuestCtx | null = useMemo(() => (c ? {
    node, type, vmid: Number(vmid), base, name, running, conf: Object.fromEntries(Object.entries(c).filter(([k]) => k !== "digest").map(([k, v]) => [k, String(v)])),
    refresh: () => { config.refresh(); status.refresh(); },
  } : null), [c, node, type, vmid, base, name, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const template = !!Number(c?.template ?? 0);

  const tabs: { id: Tab; label: string }[] = [
    { id: "resume", label: "Résumé" },
    ...(!template ? [{ id: "console" as Tab, label: "Console" }] : []),
    ...(type === "qemu" && !template ? [{ id: "agent" as Tab, label: "Agent invité" }] : []),
    { id: "reseau", label: "Réseau" },
    { id: "materiel", label: "Matériel" },
    ...(type === "qemu" ? [{ id: "cloudinit" as Tab, label: "Cloud-Init" }] : []),
    { id: "options", label: "Options" },
    { id: "historique", label: "Historique" },
    { id: "snapshots", label: "Snapshots" },
    { id: "sauvegardes", label: "Sauvegardes" },
    { id: "replication", label: "Réplication" },
    { id: "parefeu", label: "Pare-feu" },
    { id: "permissions", label: "Permissions" },
    { id: "supprimer", label: "Supprimer" },
  ];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link to="/machines" className="btn btn-sm btn-ghost"><I.back /> Machines</Link>
      </div>
      <PageHead
        title={<span className="row" style={{ gap: 10 }}><TypeTag type={type} /> {name} <span className="muted mono" style={{ fontWeight: 400, fontSize: 15 }}>{vmid}</span>{template && <span className="tag">modèle</span>}</span>}
        sub={<span className="row"><Status status={g.paused ? "paused" : g.status} /> <span>sur {node}</span>{s?.uptime ? <span>· allumée depuis {uptime(s.uptime)}</span> : null}{c?.lock && <span className="tag">verrou : {c.lock}</span>}</span>}
        actions={
          <>
            {s && !template && <GuestActions g={g} full onChange={status.refresh} />}
            {ctx && <MoreActions ctx={ctx} />}
            {!template && s?.status === "running" && (
              <button type="button" className="btn" onClick={() => setTab("console")}><I.console /> Console</button>
            )}
          </>
        }
      />
      {status.error && <div style={{ marginBottom: 16 }}><Notice kind="error">{status.error}</Notice></div>}

      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      {!ctx ? <div className="empty">Chargement…</div> : (
        <>
          {tab === "resume" && <Summary ctx={ctx} s={s} />}
          {tab === "console" && <Suspense fallback={<div className="empty">Chargement de la console…</div>}><ConsoleTab ctx={ctx} /></Suspense>}
          {tab === "agent" && <Agent ctx={ctx} />}
          {tab === "reseau" && <GuestNetwork vmid={Number(vmid)} c={c} />}
          {tab === "materiel" && <Hardware ctx={ctx} />}
          {tab === "cloudinit" && type === "qemu" && <CloudInit ctx={ctx} />}
          {tab === "options" && <Options ctx={ctx} />}
          {tab === "historique" && <History ctx={ctx} />}
          {tab === "snapshots" && <Snapshots ctx={ctx} />}
          {tab === "sauvegardes" && <Backups ctx={ctx} />}
          {tab === "replication" && <Replication ctx={ctx} />}
          {tab === "parefeu" && <FirewallPanel base={`${base}/firewall`} scope="vm" aclPath={`/vms/${vmid}`} priv="VM.Config.Network" />}
          {tab === "permissions" && <Panel pad={false} title={`Permissions sur /vms/${vmid}`}><AclEditor path={`/vms/${vmid}`} /></Panel>}
          {tab === "supprimer" && <DeleteGuest base={base} node={node} vmid={vmid} name={name} running={running} />}
        </>
      )}
    </>
  );
}

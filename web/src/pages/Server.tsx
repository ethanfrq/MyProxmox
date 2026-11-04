// Page d'un nœud : tout ce que Proxmox permet sur un nœud, onglet par onglet (web/src/pages/node/).
import { Suspense, lazy, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Notice, PageHead, Tabs } from "../components/ui";
import { FirewallPanel } from "../components/Firewall";
import { pve, usePoll } from "../lib/api";
import { NodeSummary } from "./node/Summary";
import { NodeServices } from "./node/Services";
import { NodeLogs } from "./node/Logs";
import { NodeSubscription } from "./node/Subscription";
import { NodeReplication } from "./node/Replication";
import { NodeLegacy } from "./node/Legacy";
import { NodeNetwork } from "./node/Network";
import { NodeSystem } from "./node/System";

const NodeShell = lazy(() => import("./node/Shell"));

type Tab = "resume" | "shell" | "reseau" | "systeme" | "certificats" | "maj" | "disques" | "ceph" | "services" | "replication" | "journaux" | "abonnement" | "parefeu";
const TABS: { id: Tab; label: string }[] = [
  { id: "resume", label: "Résumé" }, { id: "shell", label: "Shell" }, { id: "reseau", label: "Réseau" }, { id: "systeme", label: "Système" },
  { id: "certificats", label: "Certificats" }, { id: "maj", label: "Mises à jour" }, { id: "disques", label: "Disques" }, { id: "ceph", label: "Ceph" },
  { id: "services", label: "Services" }, { id: "replication", label: "Réplication" }, { id: "journaux", label: "Journaux" }, { id: "abonnement", label: "Abonnement" },
  { id: "parefeu", label: "Pare-feu" },
];

export function Server() {
  const nodes = usePoll(() => pve.get<any[]>("/nodes"), 0);
  const [params, setParams] = useSearchParams();
  const node = params.get("node") ?? "";
  const tab = (params.get("onglet") as Tab) || "resume";
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); return n; }, { replace: true });
  useEffect(() => { if (!node && nodes.data?.[0]) set("node", nodes.data[0].node); }, [nodes.data, node]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = (nodes.data ?? []).find((n) => n.node === node);

  return (
    <>
      <PageHead
        title={node ? `Nœud ${node}` : "Serveur"}
        sub={info ? (info.status === "online" ? "En ligne" : "Hors ligne") : "Santé, système, réseau, disques et services"}
        actions={(nodes.data?.length ?? 0) > 1 && (
          <select className="select input" aria-label="Nœud" style={{ width: 180 }} value={node} onChange={(e) => set("node", e.target.value)}>
            {nodes.data!.map((n) => <option key={n.node}>{n.node}</option>)}
          </select>
        )}
      />
      {nodes.error && <Notice kind="error">{nodes.error}</Notice>}
      <Tabs value={tab} onChange={(t) => set("onglet", t)} tabs={TABS} />
      {node && (
        <>
          {tab === "resume" && <NodeSummary node={node} />}
          {tab === "shell" && <Suspense fallback={<div className="empty">Chargement du shell…</div>}><NodeShell node={node} cmd={params.get("cmd") === "upgrade" ? "upgrade" : undefined} /></Suspense>}
          {(tab === "disques" || tab === "maj") && <NodeLegacy node={node} tab={tab} />}
          {tab === "reseau" && <NodeNetwork node={node} />}
          {tab === "systeme" && <NodeSystem node={node} />}
          {(tab === "certificats" || tab === "ceph") && <Notice>Cette partie arrive dans la suite de la phase 5.</Notice>}
          {tab === "services" && <NodeServices node={node} />}
          {tab === "replication" && <NodeReplication node={node} />}
          {tab === "journaux" && <NodeLogs node={node} />}
          {tab === "abonnement" && <NodeSubscription node={node} />}
          {tab === "parefeu" && <FirewallPanel base={`/nodes/${node}/firewall`} scope="node" aclPath={`/nodes/${node}`} priv="Sys.Modify" />}
        </>
      )}
    </>
  );
}

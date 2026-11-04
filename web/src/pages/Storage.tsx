// Stockage : occupation de chaque stockage, puis pour le stockage choisi son résumé
// (graphe 1 jour à 1 an), son contenu par type, ses disques orphelins et l'ajout de fichiers.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Meter, Notice, PageHead, Tabs } from "../components/ui";
import { api, pve, usePoll } from "../lib/api";
import { bytes } from "../../../shared/format";
import { StorageSummary } from "./storage/Summary";
import { StorageBackups, StorageFiles, StorageOrphans } from "./storage/Content";
import { StorageAdd } from "./storage/Upload";

const CONTENT: Record<string, string> = { iso: "ISO", vztmpl: "Modèles", backup: "Sauvegardes", images: "Disques VM", rootdir: "Disques CT", snippets: "Snippets", import: "Import" };
type Tab = "resume" | "iso" | "vztmpl" | "snippets" | "import" | "backup" | "orphelins" | "ajouter";

export function Storage() {
  const [params, setParams] = useSearchParams();
  const nodes = usePoll(() => pve.get<any[]>("/nodes"), 0);
  const node = params.get("node") || nodes.data?.find((n) => n.status === "online")?.node || "";
  const storages = usePoll(() => api<any[]>("/api/insights/storage"), 60000);
  const defs = usePoll(() => pve.get<any[]>("/storage").catch(() => []), 0);
  const list = (storages.data ?? []).filter((s) => !node || s.node === node);
  const sel = params.get("storage") || list[0]?.storage || "";
  const current = list.find((s) => s.storage === sel);
  const tab = (params.get("onglet") as Tab) || "resume";
  const [tick, setTick] = useState(0);
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); if (k === "storage") n.delete("onglet"); return n; }, { replace: true });
  useEffect(() => { if (current && tab !== "resume" && tab !== "ajouter" && tab !== "orphelins" && !String(current.content).includes(tab)) set("onglet", "resume"); }, [current?.storage]); // eslint-disable-line react-hooks/exhaustive-deps

  const kinds = current ? String(current.content).split(",") : [];
  const tabs: { id: Tab; label: string }[] = [
    { id: "resume", label: "Résumé" },
    ...(["iso", "vztmpl", "snippets", "import", "backup"] as Tab[]).filter((k) => kinds.includes(k)).map((k) => ({ id: k, label: CONTENT[k] })),
    ...(kinds.includes("images") || kinds.includes("rootdir") ? [{ id: "orphelins" as Tab, label: "Disques orphelins" }] : []),
    ...(kinds.some((k) => ["iso", "vztmpl", "snippets", "import"].includes(k)) ? [{ id: "ajouter" as Tab, label: "Ajouter" }] : []),
  ];

  return (
    <>
      <PageHead
        title="Stockage"
        sub="Occupation, contenu, envois, disques orphelins et tendance de remplissage"
        actions={(nodes.data?.length ?? 0) > 1 && (
          <select className="select input" aria-label="Nœud" style={{ width: 180 }} value={node} onChange={(e) => set("node", e.target.value)}>
            {nodes.data!.map((n) => <option key={n.node}>{n.node}</option>)}
          </select>
        )}
      />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        {list.map((s) => (
          <button key={s.storage} type="button" className={`panel storage-card ${sel === s.storage ? "sel" : ""}`} aria-pressed={sel === s.storage} onClick={() => set("storage", s.storage)}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <strong>{s.storage}</strong>
              <span className="tag">{s.type}</span>
            </div>
            <Meter label={s.active ? "Utilisé" : "Inactif"} value={s.used ?? 0} max={s.total ?? 1} text={`${bytes(s.used)} / ${bytes(s.total)}`} />
            <div className="small muted" style={{ marginTop: 8 }}>{String(s.content).split(",").map((c) => CONTENT[c] ?? c).join(" · ")}</div>
            <div className="small" style={{ marginTop: 6 }}>
              {s.daysToFull === null || s.daysToFull === undefined
                ? <span className="muted">Occupation stable sur 7 jours</span>
                : <span className={s.daysToFull < 30 ? "health-bad" : ""}>Plein dans environ {s.daysToFull} jour{s.daysToFull > 1 ? "s" : ""} au rythme actuel</span>}
            </div>
          </button>
        ))}
      </div>
      {storages.error && <Notice kind="error">{storages.error}</Notice>}
      {node && current && (
        <>
          <Tabs value={tab} onChange={(t) => set("onglet", t)} tabs={tabs} />
          {tab === "resume" && <StorageSummary key={current.storage} node={node} st={current} def={(defs.data ?? []).find((d) => d.storage === current.storage)} />}
          {(tab === "iso" || tab === "vztmpl" || tab === "snippets" || tab === "import") && <StorageFiles key={`${current.storage}${tab}${tick}`} node={node} st={current} kind={tab} />}
          {tab === "backup" && <StorageBackups key={current.storage} node={node} st={current} />}
          {tab === "orphelins" && <StorageOrphans key={current.storage} node={node} st={current} />}
          {tab === "ajouter" && <StorageAdd node={node} st={current} onDone={() => { setTick((t) => t + 1); storages.refresh(); }} />}
        </>
      )}
    </>
  );
}

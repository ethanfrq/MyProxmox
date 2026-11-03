import { useEffect, useState } from "react";
import { Button, Confirm, Empty, Field, Meter, Notice, PageHead, Panel, Tabs, useToast } from "../components/ui";
import { I } from "../components/icons";
import { api, pve, usePoll } from "../lib/api";
import { bytes, date } from "../../../shared/format";

const CONTENT: Record<string, string> = { iso: "ISO", vztmpl: "Modèles CT", backup: "Sauvegardes", images: "Disques VM", rootdir: "Disques CT", snippets: "Snippets" };

export function Storage() {
  const nodes = usePoll(() => pve.get<any[]>("/nodes"), 0);
  const node = nodes.data?.[0]?.node;
  const storages = usePoll(() => api<any[]>("/api/insights/storage"), 60000);
  const [sel, setSel] = useState("");
  useEffect(() => { if (!sel && storages.data?.[0]) setSel(storages.data[0].storage); }, [storages.data, sel]);
  const current = (storages.data ?? []).find((s) => s.storage === sel);

  return (
    <>
      <PageHead title="Stockage" sub="Occupation, contenu et estimation de remplissage (tendance sur 7 jours)" />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        {(storages.data ?? []).map((s) => (
          <button
            key={s.storage}
            className="panel"
            onClick={() => setSel(s.storage)}
            style={{ textAlign: "left", padding: 16, cursor: "pointer", font: "inherit", borderColor: sel === s.storage ? "var(--orange)" : undefined, outline: sel === s.storage ? "1px solid var(--orange)" : undefined }}
          >
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
      {node && current && <StorageContent key={current.storage} node={node} st={current} />}
    </>
  );
}

function StorageContent({ node, st }: { node: string; st: any }) {
  const { watch, toast } = useToast();
  const kinds = String(st.content).split(",").filter((c) => CONTENT[c]);
  const [kind, setKind] = useState(kinds[0] ?? "iso");
  const list = usePoll(() => pve.get<any[]>(`/nodes/${node}/storage/${st.storage}/content`, { content: kind }), 0, [kind]);
  const [del, setDel] = useState<string | null>(null);

  return (
    <div className="stack">
      <Panel
        title={`Contenu de ${st.storage}`}
        right={<Button size="sm" icon={<I.refresh />} onClick={list.refresh}>Actualiser</Button>}
        pad={false}
      >
        <div style={{ padding: "0 16px" }}>
          <Tabs value={kind} onChange={setKind} tabs={kinds.map((k) => ({ id: k, label: CONTENT[k] }))} />
        </div>
        {(list.data ?? []).length ? (
          <table className="table">
            <thead><tr><th>Fichier</th><th>Machine</th><th>Date</th><th className="num">Taille</th><th className="actions" /></tr></thead>
            <tbody>
              {(list.data ?? []).map((c) => (
                <tr key={c.volid}>
                  <td className="mono small">{c.volid.split(/[:/]/).pop()}</td>
                  <td className="muted">{c.vmid ?? "—"}</td>
                  <td className="small muted">{date(c.ctime)}</td>
                  <td className="num">{bytes(c.size)}</td>
                  <td className="actions">
                    {(kind === "iso" || kind === "vztmpl" || kind === "backup") && (
                      <Button size="sm" variant="danger" icon={<I.trash />} aria-label="Supprimer" onClick={() => setDel(c.volid)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{list.loading ? "Chargement…" : "Rien ici."}</Empty>}
      </Panel>

      <div className="grid g2">
        {kinds.includes("iso") && <DownloadIso node={node} storage={st.storage} onDone={list.refresh} />}
        {kinds.includes("vztmpl") && <Templates node={node} storage={st.storage} onDone={list.refresh} />}
      </div>

      {del && (
        <Confirm
          title="Supprimer ce fichier ?"
          danger
          confirmLabel="Supprimer"
          onConfirm={async () => {
            try {
              const upid = await pve.del(`/nodes/${node}/storage/${st.storage}/content/${encodeURIComponent(del)}`);
              if (typeof upid === "string" && upid.startsWith("UPID")) watch(node, upid, "Suppression", list.refresh); else list.refresh();
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setDel(null)}
        >
          <p className="mono small">{del}</p>
        </Confirm>
      )}
    </div>
  );
}

function DownloadIso({ node, storage, onDone }: { node: string; storage: string; onDone: () => void }) {
  const { watch, toast } = useToast();
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try { const n = new URL(url).pathname.split("/").pop(); if (n) setFilename(n); } catch { /* URL incomplète */ }
  }, [url]);
  return (
    <Panel title="Ajouter une ISO depuis une adresse web">
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Proxmox télécharge le fichier lui-même : rien ne transite par ton PC.</p>
        <Field label="Adresse de l'ISO"><input className="input mono" placeholder="https://cdimage.debian.org/…/debian-12-amd64-netinst.iso" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        <Field label="Nom du fichier"><input className="input mono" value={filename} onChange={(e) => setFilename(e.target.value)} /></Field>
        <div>
          <Button
            variant="primary" icon={<I.download />} busy={busy} disabled={!url || !filename.endsWith(".iso")}
            onClick={async () => {
              setBusy(true);
              try {
                const upid = await pve.post(`/nodes/${node}/storage/${storage}/download-url`, { content: "iso", url, filename });
                watch(node, upid, `Téléchargement de ${filename}`, onDone);
                setUrl(""); setFilename("");
              } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
            }}
          >
            Télécharger
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Templates({ node, storage, onDone }: { node: string; storage: string; onDone: () => void }) {
  const { watch, toast } = useToast();
  const apl = usePoll(() => pve.get<any[]>(`/nodes/${node}/aplinfo`), 0);
  const [q, setQ] = useState("");
  const list = (apl.data ?? []).filter((t) => t.section === "system").filter((t) => !q || `${t.template} ${t.headline}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title="Modèles de conteneur officiels" right={<input className="input" style={{ width: 160, height: 28 }} placeholder="Filtrer" value={q} onChange={(e) => setQ(e.target.value)} />} pad={false}>
      <div style={{ maxHeight: 320, overflow: "auto" }}>
        {list.length ? (
          <table className="table">
            <tbody>
              {list.map((t) => (
                <tr key={t.template}>
                  <td><strong>{t.headline ?? t.os}</strong><div className="mono small muted">{t.template}</div></td>
                  <td className="actions">
                    <Button size="sm" icon={<I.download />} onClick={async () => {
                      try {
                        const upid = await pve.post(`/nodes/${node}/aplinfo`, { storage, template: t.template });
                        watch(node, upid, `Téléchargement de ${t.os}`, onDone);
                      } catch (e) { toast((e as Error).message, "error"); }
                    }}>Télécharger</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{apl.loading ? "Chargement…" : "Aucun modèle (lance « pveam update » dans le shell Proxmox)."}</Empty>}
      </div>
    </Panel>
  );
}

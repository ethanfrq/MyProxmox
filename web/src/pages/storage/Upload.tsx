// Ajouter du contenu à un stockage : téléversement depuis le navigateur (relayé en flux par
// le serveur, avec barre de progression et somme de contrôle), téléchargement depuis une
// adresse web, et catalogue des modèles de conteneurs.
import { useEffect, useRef, useState } from "react";
import { Button, Empty, Field, Notice, Panel, useToast } from "../../components/ui";
import { I } from "../../components/icons";
import { pve, usePoll } from "../../lib/api";
import { DEMO } from "../../lib/env";
import { usePermission } from "../../lib/permissions";
import { bytes } from "../../../../shared/format";

const KINDS: Record<string, { label: string; accept: string }> = {
  iso: { label: "Image ISO", accept: ".iso,.img" },
  vztmpl: { label: "Modèle de conteneur", accept: ".tar.gz,.tar.xz,.tar.zst,.tgz" },
  snippets: { label: "Snippet (Cloud-Init, script)", accept: ".yaml,.yml,.sh,.pl,.txt,.json" },
  import: { label: "Disque à importer", accept: ".ova,.qcow2,.vmdk,.raw,.img" },
};
const ALGOS = ["sha256", "sha512", "sha1", "md5", "sha224", "sha384"];

function UploadPanel({ node, st, kinds, onDone }: { node: string; st: string; kinds: string[]; onDone: () => void }) {
  const { toast, watch } = useToast();
  const [kind, setKind] = useState(kinds[0]);
  const [file, setFile] = useState<File | null>(null);
  const [algo, setAlgo] = useState("");
  const [sum, setSum] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => xhr.current?.abort(), []);

  const send = async () => {
    if (!file) return;
    setProgress(0);
    if (DEMO) {
      // Démo publiée : pas de serveur, on simule la progression
      for (let p = 0.1; p <= 1; p += 0.15) { await new Promise((r) => setTimeout(r, 120)); setProgress(Math.min(1, p)); }
      const upid = await pve.post<string>(`/nodes/${node}/storage/${st}/upload`, { content: kind, filename: file.name, size: file.size });
      watch(node, upid, `Envoi de ${file.name}`, onDone);
      setProgress(null); setFile(null);
      return;
    }
    const fd = new FormData();
    fd.append("content", kind);
    if (algo && sum) { fd.append("checksum-algorithm", algo); fd.append("checksum", sum.trim()); }
    fd.append("filename", file, file.name);
    const r = new XMLHttpRequest();
    xhr.current = r;
    r.open("POST", `/api/upload/${encodeURIComponent(node)}/${encodeURIComponent(st)}`);
    r.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    r.onload = () => {
      const json = (() => { try { return JSON.parse(r.responseText); } catch { return {}; } })();
      setProgress(null);
      if (r.status >= 400) return toast(`Envoi refusé : ${json.error ?? r.status}. Vérifie le type de contenu accepté par ce stockage et l'espace libre.`, "error");
      if (typeof json.data === "string") watch(node, json.data, `Copie de ${file.name}${algo && sum ? " et vérification" : ""}`, onDone);
      setFile(null);
      if (input.current) input.current.value = "";
    };
    r.onerror = () => { setProgress(null); toast("La connexion a été coupée pendant l'envoi. Réessaie.", "error"); };
    r.send(fd);
  };

  return (
    <Panel title="Envoyer un fichier depuis ce PC">
      <div className="stack">
        <div className="form-grid">
          <Field label="Type">
            <select className="input select" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}</select>
          </Field>
          <Field label="Fichier">
            <input ref={input} className="input" type="file" accept={KINDS[kind].accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Somme de contrôle (facultatif)">
            <select className="input select" value={algo} onChange={(e) => setAlgo(e.target.value)}><option value="">Pas de vérification</option>{ALGOS.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}</select>
          </Field>
          <Field label="Valeur attendue" help="Copiée depuis le site de l'éditeur. Proxmox refuse le fichier si elle ne correspond pas.">
            <input className="input mono" disabled={!algo} value={sum} onChange={(e) => setSum(e.target.value)} />
          </Field>
        </div>
        {file && <p className="small muted" style={{ margin: 0 }}>{file.name} · {bytes(file.size)}</p>}
        {progress !== null && (
          <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progression de l'envoi">
            <span style={{ width: `${progress * 100}%` }} /><b>{Math.round(progress * 100)} %</b>
          </div>
        )}
        <div className="row">
          <Button variant="primary" icon={<I.download />} disabled={!file || progress !== null || (!!algo && !sum)} onClick={send}>Envoyer</Button>
          {progress !== null && !DEMO && <Button onClick={() => { xhr.current?.abort(); setProgress(null); }}>Annuler</Button>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Le fichier passe par MyProxmox sans y être stocké : il est relayé directement vers Proxmox.</p>
      </div>
    </Panel>
  );
}

function UrlPanel({ node, st, kinds, onDone }: { node: string; st: string; kinds: string[]; onDone: () => void }) {
  const { toast, watch } = useToast();
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState(kinds.includes("iso") ? "iso" : kinds[0]);
  const [filename, setFilename] = useState("");
  const [size, setSize] = useState<number | null>(null);
  const [algo, setAlgo] = useState("");
  const [sum, setSum] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);
  const query = async () => {
    try {
      const m = await pve.get<any>(`/nodes/${node}/query-url-metadata`, { url, "verify-certificates": verify ? 1 : 0 });
      setFilename(m.filename ?? filename);
      setSize(m.size ?? null);
    } catch (e) { toast(`${(e as Error).message}. Vérifie l'adresse.`, "error"); }
  };
  return (
    <Panel title="Télécharger depuis une adresse web">
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Proxmox télécharge le fichier lui-même : rien ne transite par ton PC.</p>
        <Field label="Adresse">
          <span className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input mono" aria-label="Adresse du fichier" placeholder="https://cdimage.debian.org/…/debian-12-amd64-netinst.iso" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button disabled={!/^https?:\/\//.test(url)} onClick={query}>Interroger</Button>
          </span>
        </Field>
        <div className="form-grid">
          <Field label="Type"><select className="input select" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.filter((k) => k !== "snippets").map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}</select></Field>
          <Field label="Nom du fichier" help={size ? `Taille annoncée : ${bytes(size)}` : undefined}><input className="input mono" value={filename} onChange={(e) => setFilename(e.target.value)} /></Field>
          <Field label="Somme de contrôle"><select className="input select" value={algo} onChange={(e) => setAlgo(e.target.value)}><option value="">Pas de vérification</option>{ALGOS.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}</select></Field>
          <Field label="Valeur attendue"><input className="input mono" disabled={!algo} value={sum} onChange={(e) => setSum(e.target.value)} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> Vérifier le certificat HTTPS du site</label>
        <div>
          <Button variant="primary" icon={<I.download />} busy={busy} disabled={!url || !filename || (!!algo && !sum)} onClick={async () => {
            setBusy(true);
            try {
              const upid = await pve.post<string>(`/nodes/${node}/storage/${st}/download-url`, { content: kind, url, filename, "checksum-algorithm": algo || undefined, checksum: algo ? sum.trim() : undefined, "verify-certificates": verify ? 1 : 0 });
              watch(node, upid, `Téléchargement de ${filename}`, onDone);
              setUrl(""); setFilename(""); setSum(""); setSize(null);
            } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
          }}>Télécharger</Button>
        </div>
      </div>
    </Panel>
  );
}

function Templates({ node, st, onDone }: { node: string; st: string; onDone: () => void }) {
  const { watch, toast } = useToast();
  const apl = usePoll(() => pve.get<any[]>(`/nodes/${node}/aplinfo`), 0, [node]);
  const [q, setQ] = useState("");
  const list = (apl.data ?? []).filter((t) => !q || `${t.template} ${t.headline}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title="Modèles de conteneurs officiels" right={<input className="input" aria-label="Filtrer les modèles" style={{ width: 160, height: 28 }} placeholder="Filtrer" value={q} onChange={(e) => setQ(e.target.value)} />} pad={false}>
      <div style={{ maxHeight: 360, overflow: "auto" }}>
        {list.length ? (
          <table className="table">
            <tbody>
              {list.map((t) => (
                <tr key={t.template}>
                  <td><strong>{t.headline ?? t.os}</strong><div className="mono small muted">{t.template}</div></td>
                  <td className="actions">
                    <Button size="sm" icon={<I.download />} onClick={async () => {
                      try { const upid = await pve.post<string>(`/nodes/${node}/aplinfo`, { storage: st, template: t.template }); watch(node, upid, `Téléchargement de ${t.os}`, onDone); } catch (e) { toast((e as Error).message, "error"); }
                    }}>Télécharger</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{apl.loading ? "Chargement…" : "Aucun modèle. Lance « pveam update » dans le shell du nœud."}</Empty>}
      </div>
    </Panel>
  );
}

export function StorageAdd({ node, st, onDone }: { node: string; st: any; onDone: () => void }) {
  const { allowed } = usePermission(`/storage/${st.storage}`, "Datastore.AllocateTemplate");
  const kinds = String(st.content).split(",").filter((c) => KINDS[c]);
  if (!kinds.length) return <Notice>Ce stockage n&apos;accepte ni ISO, ni modèles, ni snippets. Change son contenu accepté dans Datacenter &gt; Stockage.</Notice>;
  if (!allowed) return <Notice kind="warn">Il te manque le droit Datastore.AllocateTemplate sur ce stockage.</Notice>;
  return (
    <div className="grid g2">
      <UploadPanel node={node} st={st.storage} kinds={kinds} onDone={onDone} />
      {kinds.some((k) => k !== "snippets") ? <UrlPanel node={node} st={st.storage} kinds={kinds} onDone={onDone} /> : <span />}
      {kinds.includes("vztmpl") && <Templates node={node} st={st.storage} onDone={onDone} />}
    </div>
  );
}

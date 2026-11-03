import { useState } from "react";
import { Button, Confirm, CopyButton, Empty, Field, Notice, PageHead, Panel, SecretBox, Tabs, useToast } from "../components/ui";
import { api, usePoll } from "../lib/api";
import { useApp } from "../lib/app";
import { ago, date } from "../../../shared/format";
import type { McpLevel } from "../../../shared/types";

const TOOLS: { name: string; level: McpLevel; desc: string }[] = [
  { name: "etat_general", level: "read", desc: "Vue d'ensemble : nœuds, machines, plus gros consommateurs, stockage, alertes" },
  { name: "lister_machines", level: "read", desc: "Toutes les machines avec IP, MAC, pont, VLAN, tags" },
  { name: "details_machine", level: "read", desc: "Configuration, consommation, snapshots et sauvegardes d'une machine" },
  { name: "alertes_actives", level: "read", desc: "Problèmes détectés en ce moment" },
  { name: "sante_serveur", level: "read", desc: "Services, SMART, ZFS, mises à jour, certificats, DNS" },
  { name: "stockage", level: "read", desc: "Occupation et date estimée de remplissage" },
  { name: "sauvegardes", level: "read", desc: "Dernière sauvegarde de chaque machine, tâches planifiées" },
  { name: "securite", level: "read", desc: "2FA, jetons, pare-feu, échecs de connexion" },
  { name: "reseau", level: "read", desc: "Interfaces, ponts, DNS et IP des machines" },
  { name: "taches_recentes", level: "read", desc: "Dernières tâches et leur résultat" },
  { name: "alimentation_machine", level: "actions", desc: "Démarrer, éteindre proprement, redémarrer" },
  { name: "snapshot_machine", level: "actions", desc: "Prendre un snapshot" },
  { name: "sauvegarder_machine", level: "actions", desc: "Lancer une sauvegarde immédiate" },
];

const EXAMPLES = [
  "Quel est l'état de mon serveur Proxmox ?",
  "Quelle machine consomme le plus de RAM en ce moment ?",
  "Quelles machines n'ont pas été sauvegardées cette semaine ?",
  "Donne-moi l'adresse IP de jellyfin.",
  "Est-ce qu'un de mes disques montre des signes de faiblesse ?",
  "Prends un snapshot de home-assistant avant que je le mette à jour.",
];

export function ClaudeMcp() {
  const { settings, reloadSettings, me } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState("Claude Desktop");
  const [level, setLevel] = useState<McpLevel>("read");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  const [client, setClient] = useState<"desktop" | "code" | "autre">("desktop");
  const [os, setOs] = useState<"windows" | "mac">("windows");
  const activity = usePoll(() => api<any[]>("/api/activity", { query: { actor: "mcp" } }), 10000);

  const appUrl = settings?.appUrl ?? "http://IP-DU-PC:8080";
  const key = newKey ?? "COLLE_TA_CLE_ICI";
  const bridge = os === "windows"
    ? (settings?.bridgePath ?? "C:\\MyProxmox\\bridge\\dist\\myproxmox-mcp.cjs")
    : "/Users/toi/myproxmox-mcp.cjs";
  const desktopJson = JSON.stringify({ mcpServers: { myproxmox: { command: "node", args: [bridge], env: { MYPROXMOX_URL: appUrl, MYPROXMOX_KEY: key } } } }, null, 2);
  const codeCmd = `claude mcp add --transport http myproxmox ${appUrl}/mcp --header "Authorization: Bearer ${key}"`;

  async function create() {
    try {
      const r = await api("/api/settings/mcp-keys", { method: "POST", body: { name, level } });
      setNewKey(r.key);
      await reloadSettings();
    } catch (e) { toast((e as Error).message, "error"); }
  }

  return (
    <>
      <PageHead title="Claude & MCP" sub="Permet à Claude (ou à un autre assistant compatible MCP) de consulter et piloter ton serveur, en passant toujours par MyProxmox" />

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Panel title="Comment ça marche">
          <div className="code" style={{ whiteSpace: "pre", fontSize: 12 }}>{`Claude ──MCP──▶ MyProxmox ──jeton de service──▶ Proxmox
                  │
                  ├─ vérifie la clé et son niveau
                  ├─ n'expose que des actions sûres
                  └─ inscrit tout au journal`}</div>
          <ul className="small" style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>Claude ne voit jamais ton mot de passe ni le jeton Proxmox.</li>
            <li>Une clé <strong>lecture</strong> peut tout consulter. Une clé <strong>actions</strong> peut aussi démarrer, éteindre, redémarrer, prendre un snapshot ou lancer une sauvegarde.</li>
            <li>Jamais possible via MCP : supprimer, arrêt forcé, restaurer, modifier la configuration.</li>
            <li>Le MCP n&apos;est accessible que depuis les plages IP autorisées.</li>
          </ul>
        </Panel>

        <Panel title="Clés MCP" pad={false}>
          {settings?.mcpKeys.length ? (
            <table className="table"><tbody>{settings.mcpKeys.map((k) => (
              <tr key={k.id}>
                <td><strong>{k.name}</strong><div className="small muted mono">{k.prefix}…</div></td>
                <td className="small muted">Créée {date(k.createdAt)}<br />{k.lastUsed ? `Utilisée ${ago(Math.floor(Date.parse(k.lastUsed) / 1000))}` : "Jamais utilisée"}</td>
                <td>
                  {me.admin ? (
                    <select className="select input" style={{ height: 30, width: 130 }} value={k.level} onChange={async (e) => { await api(`/api/settings/mcp-keys/${k.id}`, { method: "PUT", body: { level: e.target.value } }); reloadSettings(); }}>
                      <option value="read">Lecture</option><option value="actions">Actions</option>
                    </select>
                  ) : <span className="tag">{k.level}</span>}
                </td>
                <td className="actions">{me.admin && <Button size="sm" variant="danger" onClick={() => setRevoke(k)}>Révoquer</Button>}</td>
              </tr>
            ))}</tbody></table>
          ) : <Empty>Aucune clé pour l&apos;instant.</Empty>}
          {me.admin && (
            <div style={{ padding: 16, borderTop: "1px solid var(--line-2)" }} className="stack">
              <div className="form-grid">
                <Field label="Nom de la clé" help="Pour savoir qui fait quoi dans le journal"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Niveau">
                  <select className="select input" value={level} onChange={(e) => setLevel(e.target.value as McpLevel)}>
                    <option value="read">Lecture seule</option><option value="actions">Lecture + actions</option>
                  </select>
                </Field>
              </div>
              <div><Button variant="primary" onClick={create}>Créer la clé</Button></div>
              {newKey && (
                <Notice kind="ok">
                  <div style={{ marginBottom: 8 }}><strong>Copie cette clé maintenant.</strong> Elle ne sera plus jamais affichée (MyProxmox n&apos;en garde qu&apos;une empreinte). Elle est déjà insérée dans les configurations ci-dessous.</div>
                  <SecretBox value={newKey} />
                </Notice>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Tutoriel : brancher Claude en 3 étapes">
        <Tabs value={client} onChange={setClient} tabs={[{ id: "desktop", label: "Claude Desktop" }, { id: "code", label: "Claude Code" }, { id: "autre", label: "Autre client MCP" }]} />
        {client === "desktop" && (
          <ol className="step-list">
            <li>
              <div>
                <h3>Crée une clé</h3>
                <p className="small" style={{ margin: 0 }}>Dans le panneau « Clés MCP » ci-dessus. Commence en lecture seule : tu pourras passer en « actions » plus tard.</p>
              </div>
            </li>
            <li>
              <div>
                <h3>Récupère le pont MCP</h3>
                <p className="small" style={{ margin: "0 0 8px" }}>
                  Claude Desktop lance un petit programme local qui relaie ses demandes vers MyProxmox. Il a besoin de <a href="https://nodejs.org" target="_blank" rel="noreferrer" style={{ color: "var(--orange)" }}>Node.js</a> (déjà installé si Claude Desktop tourne sur le PC de MyProxmox).
                  Sur un autre ordinateur, télécharge le fichier et note où tu le ranges.
                </p>
                <a className="btn btn-sm" href="/downloads/myproxmox-mcp.cjs" download>Télécharger myproxmox-mcp.cjs</a>
              </div>
            </li>
            <li>
              <div style={{ minWidth: 0 }}>
                <h3>Ajoute MyProxmox à Claude Desktop</h3>
                <p className="small" style={{ margin: "0 0 8px" }}>
                  Claude Desktop &gt; Paramètres &gt; Développeur &gt; <strong>Modifier la configuration</strong>, ou ouvre directement
                  {" "}<code>{os === "windows" ? "%APPDATA%\\Claude\\claude_desktop_config.json" : "~/Library/Application Support/Claude/claude_desktop_config.json"}</code>.
                  Colle le bloc (si <code>mcpServers</code> existe déjà, ajoute seulement l&apos;entrée <code>myproxmox</code>), enregistre, puis quitte et relance complètement Claude Desktop.
                </p>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="btn-group">
                    <Button size="sm" variant={os === "windows" ? "dark" : "default"} onClick={() => setOs("windows")}>Windows</Button>
                    <Button size="sm" variant={os === "mac" ? "dark" : "default"} onClick={() => setOs("mac")}>macOS</Button>
                  </span>
                  <CopyButton text={desktopJson} />
                </div>
                <div className="code">{desktopJson}</div>
                {/127\.0\.0\.1|localhost/.test(appUrl) && <div style={{ marginTop: 8 }}><Notice kind="warn">Tu as ouvert MyProxmox en local : si Claude Desktop tourne sur un autre ordinateur, remplace <code>{appUrl}</code> par l&apos;adresse IP de ce PC sur le réseau (par exemple <code>http://10.0.1.20:8080</code>).</Notice></div>}
                <p className="small muted" style={{ marginBottom: 0 }}>Remplace le chemin par l&apos;emplacement réel du fichier si tu l&apos;as mis ailleurs.</p>
              </div>
            </li>
          </ol>
        )}
        {client === "code" && (
          <ol className="step-list">
            <li><div><h3>Crée une clé</h3><p className="small" style={{ margin: 0 }}>Dans le panneau « Clés MCP » ci-dessus.</p></div></li>
            <li>
              <div style={{ minWidth: 0 }}>
                <h3>Ajoute le serveur</h3>
                <p className="small" style={{ margin: "0 0 8px" }}>Claude Code parle directement en HTTP, pas besoin du pont. Dans un terminal :</p>
                <div className="row" style={{ justifyContent: "flex-end", marginBottom: 6 }}><CopyButton text={codeCmd} /></div>
                <div className="code" style={{ whiteSpace: "pre-wrap" }}>{codeCmd}</div>
              </div>
            </li>
            <li><div><h3>Vérifie</h3><p className="small" style={{ margin: 0 }}>Lance <code>claude</code>, tape <code>/mcp</code> : « myproxmox » doit apparaître comme connecté.</p></div></li>
          </ol>
        )}
        {client === "autre" && (
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>N&apos;importe quel client compatible MCP « Streamable HTTP » peut se connecter :</p>
            <div className="kv">
              <div>URL</div><div className="mono">{appUrl}/mcp</div>
              <div>Transport</div><div>Streamable HTTP (sans session)</div>
              <div>En-tête</div><div className="mono">Authorization: Bearer {key}</div>
            </div>
            <Notice>Pour un client qui ne sait parler qu&apos;en stdio, utilise le pont : <code>node myproxmox-mcp.cjs</code> avec les variables <code>MYPROXMOX_URL</code> et <code>MYPROXMOX_KEY</code>.</Notice>
          </div>
        )}
      </Panel>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Ce que Claude peut faire" pad={false}>
          <table className="table"><tbody>{TOOLS.map((t) => (
            <tr key={t.name}><td className="mono small">{t.name}</td><td className="small">{t.desc}</td><td>{t.level === "read" ? <span className="tag">lecture</span> : <span className="tag ct">actions</span>}</td></tr>
          ))}</tbody></table>
        </Panel>
        <div className="stack">
          <Panel title="Idées de questions">
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>{EXAMPLES.map((e) => <li key={e}>« {e} »</li>)}</ul>
          </Panel>
          <Panel title="Journal du MCP" pad={false} right={<Button size="sm" onClick={activity.refresh}>Actualiser</Button>}>
            {(activity.data ?? []).length ? (
              <table className="table"><tbody>{(activity.data ?? []).slice(0, 15).map((a, i) => (
                <tr key={i}>
                  <td className="small muted" style={{ width: 100 }}>{date(a.at)}</td>
                  <td><span className="mono small">{a.action}</span><div className="small muted">{a.actor.replace("mcp:", "")}{a.detail ? ` · ${a.detail}` : ""}</div></td>
                  <td className="num"><span className={`badge ${a.result === "ok" ? "on" : a.result === "refusé" ? "warn" : "err"}`}>{a.result}</span></td>
                </tr>
              ))}</tbody></table>
            ) : <Empty>Rien pour l&apos;instant. Les lectures ne sont pas journalisées, seulement les actions et les refus.</Empty>}
          </Panel>
        </div>
      </div>

      {revoke && (
        <Confirm title={`Révoquer « ${revoke.name} » ?`} danger confirmLabel="Révoquer" onConfirm={async () => { await api(`/api/settings/mcp-keys/${revoke.id}`, { method: "DELETE" }); await reloadSettings(); }} onClose={() => setRevoke(null)}>
          <p>Le client qui utilise cette clé perd l&apos;accès immédiatement.</p>
        </Confirm>
      )}
    </>
  );
}

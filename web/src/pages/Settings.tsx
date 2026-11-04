import { useEffect, useState } from "react";
import { Button, Confirm, Field, Notice, PageHead, Panel, SecretBox, Switch, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { DEMO, REPO_URL } from "../lib/env";
import type { Modules } from "../../../shared/types";

const MODULES: { key: keyof Modules; title: string; desc: string }[] = [
  { key: "monitoring", title: "Écran de monitoring", desc: "Vue plein écran en lecture seule, pour une TV ou un second écran" },
  { key: "alerts", title: "Alertes et notifications", desc: "Vérification du serveur toutes les minutes, cloche, Discord, ntfy, webhook" },
  { key: "mcp", title: "Serveur MCP", desc: "Accès de Claude et des assistants compatibles MCP" },
  { key: "security", title: "Audit de sécurité", desc: "2FA, jetons API, pare-feu, échecs de connexion" },
  { key: "backups", title: "Suivi des sauvegardes", desc: "Couverture des sauvegardes et alertes de sauvegarde ancienne" },
  { key: "updates", title: "Suivi des mises à jour", desc: "Alerte quand des paquets Proxmox sont à mettre à jour" },
];

export function Settings() {
  const { settings: s, reloadSettings, me } = useApp();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [tls, setTls] = useState(true);
  const [ranges, setRanges] = useState("");
  const [monKey, setMonKey] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!s) return;
    setUrl(s.pveUrl);
    setTls(s.insecureTls);
    setRanges(s.allowedRanges.join("\n"));
  }, [s]);

  if (!s) return null;
  const save = async (body: unknown, what: string) => {
    setBusy(what);
    try {
      await api("/api/settings", { method: "PUT", body });
      await reloadSettings();
      toast("Enregistré", "ok");
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(""); }
  };
  const monitoringUrl = monKey ? `${location.origin}${DEMO ? "/demo" : ""}/monitoring?key=${monKey}` : "";

  return (
    <>
      <PageHead title="Paramètres" sub={`MyProxmox ${s.version}`} />
      {!me.admin && <div style={{ marginBottom: 16 }}><Notice kind="warn">Lecture seule : seuls les comptes avec Sys.Modify sur « / » peuvent changer les réglages.</Notice></div>}
      <div className="grid g2">
        <div className="stack">
          <Panel title="Connexion à Proxmox" right={me.admin && <Button variant="primary" busy={busy === "pve"} onClick={() => save({ pve: { url, insecureTls: tls } }, "pve")}>Tester et enregistrer</Button>}>
            <div className="stack">
              <Field label="Adresse du serveur"><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
              <label className="check"><input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} /> Accepter le certificat auto-signé</label>
              <div className="kv">
                <div>Compte de service</div><div className="mono">{s.serviceToken || "-"}</div>
              </div>
              {me.admin && (
                <div className="row">
                  <Button size="sm" busy={busy === "token"} onClick={async () => {
                    setBusy("token");
                    try { await api("/api/settings/service-token", { method: "POST" }); await reloadSettings(); toast("Jeton de service recréé", "ok"); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(""); }
                  }}>Recréer le jeton de service</Button>
                  <span className="small muted">Si les alertes ou le monitoring affichent « identifiants refusés ».</span>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Accès réseau" right={me.admin && <Button variant="primary" busy={busy === "ranges"} onClick={() => save({ allowedRanges: ranges.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) }, "ranges")}>Enregistrer</Button>}>
            <div className="stack">
              <Field label="Plages IP autorisées (CIDR, une par ligne)" help={<>Tout le reste reçoit une erreur 403, interface, MCP et monitoring compris. Ton adresse actuelle : <code>{s.clientIp}</code>. Le PC qui héberge l&apos;app garde toujours l&apos;accès en local.</>}>
                <textarea className="input mono" rows={5} value={ranges} onChange={(e) => setRanges(e.target.value)} />
              </Field>
            </div>
          </Panel>

          <Panel title="Écran de monitoring">
            <div className="stack">
              <p className="small" style={{ margin: 0 }}>Un lien secret pour afficher le monitoring sur une TV ou un second écran, sans compte Proxmox. Il ne permet que de regarder. L&apos;écran doit être dans une plage IP autorisée.</p>
              {monKey ? (
                <Notice kind="ok">
                  <div style={{ marginBottom: 8 }}><strong>Copie ce lien maintenant</strong>, il ne sera plus affiché. Ouvre-le sur l&apos;écran, puis F11 pour le plein écran.</div>
                  <SecretBox value={monitoringUrl} />
                </Notice>
              ) : (
                <div className="small">{s.hasMonitoringKey ? "Un lien est déjà actif. En créer un nouveau désactive l'ancien." : "Aucun lien actif."}</div>
              )}
              {me.admin && (
                <div className="row">
                  <Button variant="dark" onClick={async () => { const r = await api("/api/settings/monitoring-key", { method: "POST" }); setMonKey(r.key); reloadSettings(); }}>{s.hasMonitoringKey ? "Nouveau lien" : "Créer le lien"}</Button>
                  {s.hasMonitoringKey && <Button variant="danger" onClick={async () => { await api("/api/settings/monitoring-key", { method: "DELETE" }); setMonKey(null); reloadSettings(); }}>Désactiver</Button>}
                  <a className="btn" href={`${DEMO ? "/demo" : ""}/monitoring`} target="_blank" rel="noreferrer">Ouvrir (avec ma session)</a>
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Modules">
            {MODULES.map((m) => (
              <Switch key={m.key} title={m.title} desc={m.desc} on={s.modules[m.key]} onChange={(v) => me.admin && save({ modules: { [m.key]: v } }, m.key)} />
            ))}
          </Panel>

          <Panel title="Mises à jour de MyProxmox">
            <div className="stack">
              <p className="small" style={{ margin: 0 }}>
                Sous Windows, <code>MyProxmox.bat</code> récupère la dernière version depuis GitHub à chaque lancement, puis démarre l&apos;app. Pour qu&apos;il se lance au démarrage du PC : <code>scripts\windows\autostart-on.bat</code>.
              </p>
              <div className="kv">
                <div>Version installée</div><div className="mono">{s.version}</div>
                <div>Code source</div><div><a href={REPO_URL} target="_blank" rel="noreferrer" style={{ color: "var(--orange-ink)" }}>{REPO_URL.replace("https://", "")}</a></div>
              </div>
            </div>
          </Panel>

          {me.admin && (
            <Panel title="Réinitialiser">
              <div className="stack">
                <p className="small muted" style={{ margin: 0 }}>Efface la connexion Proxmox, les clés MCP et le lien de monitoring, puis relance l&apos;assistant. Les notifications et le journal sont conservés. Le compte <code>myproxmox@pve</code> reste dans Proxmox (tu peux le supprimer à la main).</p>
                <div><Button variant="danger" onClick={() => setReset(true)}>Relancer la configuration</Button></div>
              </div>
            </Panel>
          )}
        </div>
      </div>
      {reset && (
        <Confirm title="Réinitialiser MyProxmox ?" danger requireText="RESET" confirmLabel="Réinitialiser" onConfirm={async () => { await api("/api/settings/reset", { method: "POST", body: { confirm: "RESET" } }); location.href = "/setup"; }} onClose={() => setReset(false)}>
          <p>Il faudra refaire la connexion à Proxmox.</p>
        </Confirm>
      )}
    </>
  );
}

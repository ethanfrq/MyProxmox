import { useEffect, useState } from "react";
import { Button, Confirm, Empty, Field, Lvl, Notice, PageHead, Panel, Switch, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { ago, date } from "../../../shared/format";
import type { AlertRules, Channel } from "../../../shared/types";

type Tab = "actives" | "historique" | "regles" | "canaux";

export function Alerts() {
  const { alerts, notifications, markAllRead, reloadNotifications, me } = useApp();
  const [tab, setTab] = useState<Tab>("actives");
  return (
    <>
      <PageHead title="Alertes" sub="MyProxmox vérifie le serveur chaque minute (disques, sauvegardes et mises à jour toutes les 15 min)" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "actives", label: `En cours (${alerts.length})` },
        { id: "historique", label: "Historique" },
        { id: "regles", label: "Règles" },
        { id: "canaux", label: "Où être prévenu" },
      ]} />
      {tab === "actives" && (
        <Panel pad={false}>
          {alerts.length ? alerts.map((a) => (
            <div key={a.key} className="finding">
              <Lvl level={a.level} />
              <div>
                <div className="t">{a.title}</div>
                <div className="d">{a.message}</div>
                {a.since && <div className="small muted" style={{ marginTop: 4 }}>Depuis {ago(Math.floor(Date.parse(a.since) / 1000))}</div>}
              </div>
            </div>
          )) : <Empty>Tout va bien : aucune alerte en cours.</Empty>}
        </Panel>
      )}
      {tab === "historique" && (
        <Panel pad={false} title={`${notifications.length} notification(s)`} right={<>
          <Button size="sm" onClick={markAllRead}>Tout marquer lu</Button>
          {me.admin && <Button size="sm" variant="danger" onClick={async () => { await api("/api/notifications", { method: "DELETE" }); reloadNotifications(); }}>Vider</Button>}
        </>}>
          {notifications.length ? notifications.map((n) => (
            <div key={n.id} className={`notif ${n.resolved ? "resolved" : n.level} ${n.read ? "" : "unread"}`}>
              <span className="bar" />
              <div><div className="t">{n.resolved ? "Résolu : " : ""}{n.title}</div><div className="m">{n.message}</div><div className="d">{date(n.at)}</div></div>
            </div>
          )) : <Empty>Aucune notification.</Empty>}
        </Panel>
      )}
      {tab === "regles" && <Rules />}
      {tab === "canaux" && <Channels />}
    </>
  );
}

function Rules() {
  const { settings, reloadSettings, me } = useApp();
  const { toast } = useToast();
  const [r, setR] = useState<AlertRules | null>(null);
  useEffect(() => { if (settings) setR(settings.rules); }, [settings]);
  if (!r) return <Empty>Chargement…</Empty>;
  const num = (k: keyof AlertRules) => (e: React.ChangeEvent<HTMLInputElement>) => setR({ ...r, [k]: Number(e.target.value) });
  const save = async () => {
    try {
      await api("/api/settings", { method: "PUT", body: { rules: r } });
      await reloadSettings();
      toast("Règles enregistrées", "ok");
    } catch (e) { toast((e as Error).message, "error"); }
  };
  return (
    <div className="grid g2">
      <Panel title="Seuils" right={me.admin && <Button variant="primary" onClick={save}>Enregistrer</Button>}>
        <div className="form-grid">
          <Field label="Processeur (%)" help="Alerte si le nœud dépasse ce niveau…"><input className="input" type="number" min={10} max={100} value={r.cpu} onChange={num("cpu")} /></Field>
          <Field label="Pendant (minutes)" help="…pendant ce nombre de vérifications de suite"><input className="input" type="number" min={1} max={30} value={r.sustainChecks} onChange={num("sustainChecks")} /></Field>
          <Field label="Mémoire (%)"><input className="input" type="number" min={10} max={100} value={r.memory} onChange={num("memory")} /></Field>
          <div />
          <Field label="Stockage : attention (%)"><input className="input" type="number" min={10} max={100} value={r.storageWarning} onChange={num("storageWarning")} /></Field>
          <Field label="Stockage : critique (%)"><input className="input" type="number" min={10} max={100} value={r.storageCritical} onChange={num("storageCritical")} /></Field>
          <Field label="Sauvegarde trop ancienne (jours)" help="0 pour désactiver"><input className="input" type="number" min={0} max={365} value={r.backupMaxDays} onChange={num("backupMaxDays")} /></Field>
          <Field label="Certificat qui expire (jours)"><input className="input" type="number" min={1} max={120} value={r.certificateDays} onChange={num("certificateDays")} /></Field>
        </div>
      </Panel>
      <Panel title="Contrôles">
        <Switch title="Machine arrêtée qui devrait tourner" desc="Réglée pour démarrer avec le serveur, mais à l'arrêt" on={r.guestDown} onChange={(v) => setR({ ...r, guestDown: v })} />
        <Switch title="Tâches en échec" desc="Sauvegarde ratée, démarrage impossible…" on={r.failedTasks} onChange={(v) => setR({ ...r, failedTasks: v })} />
        <Switch title="Santé des disques" desc="SMART en défaut, SSD usé, pool ZFS dégradé" on={r.disks} onChange={(v) => setR({ ...r, disks: v })} />
        <Switch title="Mises à jour disponibles" desc="Notification de niveau info" on={r.updates} onChange={(v) => setR({ ...r, updates: v })} />
        {!me.admin && <Notice>Seul un administrateur Proxmox (Sys.Modify sur « / ») peut changer les règles.</Notice>}
      </Panel>
    </div>
  );
}

const EMPTY: Partial<Channel> = { type: "discord", name: "", url: "", token: "", minLevel: "warning", enabled: true };
const HELP: Record<Channel["type"], string> = {
  discord: "Salon Discord > Modifier > Intégrations > Webhooks > Nouveau webhook, puis copie l'URL.",
  ntfy: "URL complète du sujet, par exemple https://ntfy.sh/mon-homelab-7f3a. Installe l'appli ntfy sur ton téléphone et abonne-toi au même sujet. Choisis un nom difficile à deviner.",
  webhook: "MyProxmox envoie un POST JSON { level, title, message, at, resolved } à cette adresse (Home Assistant, n8n, Gotify…).",
};

function Channels() {
  const { settings, reloadSettings, me } = useApp();
  const { toast } = useToast();
  const [edit, setEdit] = useState<Partial<Channel> | null>(null);
  const [del, setDel] = useState<Channel | null>(null);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const [browserOn, setBrowserOn] = useState(() => { try { return localStorage.getItem("myproxmox-browser-notif") !== "off"; } catch { return true; } });

  const save = async () => {
    try {
      await api("/api/settings/channels", { method: "POST", body: edit });
      await reloadSettings();
      setEdit(null);
      toast("Canal enregistré", "ok");
    } catch (e) { toast((e as Error).message, "error"); }
  };

  return (
    <div className="grid g2">
      <div className="stack">
        <Panel title="Dans l'app et sur l'écran de monitoring">
          <p className="small" style={{ marginTop: 0 }}>Toujours actif : cloche en haut à droite, bandeau d&apos;alerte et écran de monitoring.</p>
        </Panel>
        <Panel title="Notifications du navigateur">
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>Une notification Windows s&apos;affiche quand une alerte arrive, tant qu&apos;un onglet MyProxmox est ouvert. Réglage propre à ce navigateur.</p>
            {perm === "granted" ? (
              <Switch title="Activées sur ce navigateur" on={browserOn} onChange={(v) => { setBrowserOn(v); try { localStorage.setItem("myproxmox-browser-notif", v ? "on" : "off"); } catch { /* rien */ } }} />
            ) : perm === "denied" ? (
              <Notice kind="warn">Bloquées par le navigateur. Autorise-les dans les réglages du site (icône à gauche de l&apos;adresse).</Notice>
            ) : (
              <div><Button variant="dark" onClick={async () => setPerm(await Notification.requestPermission())}>Autoriser les notifications</Button></div>
            )}
          </div>
        </Panel>
        <Panel title="Discord, ntfy, webhook" pad={false} right={me.admin && <Button size="sm" variant="primary" onClick={() => setEdit({ ...EMPTY })}>Ajouter</Button>}>
          {settings?.channels.length ? (
            <table className="table"><tbody>{settings.channels.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong><div className="small muted">{c.type} · à partir de « {c.minLevel} »{c.enabled ? "" : " · désactivé"}</div></td>
                <td className="actions">
                  <span className="btn-group">
                    <Button size="sm" onClick={async () => { try { await api(`/api/settings/channels/${c.id}/test`, { method: "POST" }); toast(`Test envoyé à ${c.name}`, "ok"); } catch (e) { toast((e as Error).message, "error"); } }}>Tester</Button>
                    {me.admin && <Button size="sm" onClick={() => setEdit(c)}>Modifier</Button>}
                    {me.admin && <Button size="sm" variant="danger" onClick={() => setDel(c)}>Retirer</Button>}
                  </span>
                </td>
              </tr>
            ))}</tbody></table>
          ) : <Empty>Aucun canal. Ajoute Discord ou ntfy pour être prévenu même quand l&apos;app est fermée.</Empty>}
        </Panel>
      </div>
      {edit && (
        <Panel title={edit.id ? "Modifier le canal" : "Nouveau canal"} right={<><Button onClick={() => setEdit(null)}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
          <div className="form-grid">
            <Field label="Type">
              <select className="select input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as Channel["type"] })}>
                <option value="discord">Discord</option><option value="ntfy">ntfy</option><option value="webhook">Webhook générique</option>
              </select>
            </Field>
            <Field label="Nom"><input className="input" placeholder="Ex. Discord #homelab" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Adresse" full help={HELP[edit.type ?? "discord"]}><input className="input mono" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Field>
            {edit.type !== "discord" && (
              <Field label={edit.type === "ntfy" ? "Jeton d'accès (facultatif)" : "En-tête Authorization (facultatif)"} full>
                <input className="input mono" value={edit.token ?? ""} onChange={(e) => setEdit({ ...edit, token: e.target.value })} placeholder={edit.type === "ntfy" ? "tk_…" : "Bearer …"} />
              </Field>
            )}
            <Field label="Niveau minimum">
              <select className="select input" value={edit.minLevel} onChange={(e) => setEdit({ ...edit, minLevel: e.target.value as Channel["minLevel"] })}>
                <option value="info">Tout (info, attention, critique)</option><option value="warning">Attention et critique</option><option value="critical">Critique seulement</option>
              </select>
            </Field>
            <Field label="État"><label className="check" style={{ height: 36 }}><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Actif</label></Field>
          </div>
        </Panel>
      )}
      {del && <Confirm title={`Retirer ${del.name} ?`} danger confirmLabel="Retirer" onConfirm={async () => { await api(`/api/settings/channels/${del.id}`, { method: "DELETE" }); await reloadSettings(); }} onClose={() => setDel(null)} />}
    </div>
  );
}

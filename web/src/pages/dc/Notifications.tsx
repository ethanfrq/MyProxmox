// Notifications de Proxmox : cibles (mail, SMTP, Gotify, webhook) et règles d'envoi.
import { Button, useToast } from "../../components/ui";
import { Crud, postBody, putBody } from "../../components/Crud";
import { pve } from "../../lib/api";
import type { FieldDef } from "../../components/Form";

const TARGET_KEYS = ["comment", "disable", "mailto", "mailto-user", "from-address", "author", "server", "port", "mode", "username", "password", "token", "url", "method", "body"];
function targetFields(editing: boolean): FieldDef[] {
  const users = async () => (await pve.get<any[]>("/access/users")).map((u) => ({ value: u.userid, label: u.userid }));
  return [
    { name: "kind", label: "Type", type: "select", readOnly: editing, default: "sendmail", options: [{ value: "sendmail", label: "Mail (sendmail du nœud)" }, { value: "smtp", label: "Mail (serveur SMTP)" }, { value: "gotify", label: "Gotify" }, { value: "webhook", label: "Webhook" }] },
    { name: "name", label: "Nom", required: true, readOnly: editing },
    { name: "mailto", label: "Adresses mail", placeholder: "moi@exemple.fr", show: (v) => v.kind === "sendmail" || v.kind === "smtp", help: "Séparées par des virgules." },
    { name: "mailto-user", label: "Utilisateurs Proxmox", type: "multi", load: users, show: (v) => v.kind === "sendmail" || v.kind === "smtp", help: "Leur adresse mail sera utilisée." },
    { name: "server", label: "Serveur", required: true, show: (v) => v.kind === "smtp" || v.kind === "gotify", placeholder: "smtp.exemple.fr ou https://gotify.exemple.fr" },
    { name: "port", label: "Port", type: "number", show: (v) => v.kind === "smtp" },
    { name: "mode", label: "Chiffrement", type: "select", show: (v) => v.kind === "smtp", options: [{ value: "tls", label: "TLS" }, { value: "starttls", label: "STARTTLS" }, { value: "insecure", label: "Aucun" }] },
    { name: "username", label: "Utilisateur SMTP", show: (v) => v.kind === "smtp" },
    { name: "password", label: "Mot de passe SMTP", type: "password", show: (v) => v.kind === "smtp", help: editing ? "Vide : inchangé." : undefined },
    { name: "from-address", label: "Adresse d'envoi", show: (v) => v.kind === "smtp" || v.kind === "sendmail" },
    { name: "token", label: "Jeton de l'application Gotify", type: "password", show: (v) => v.kind === "gotify", required: !editing },
    { name: "url", label: "Adresse du webhook", required: true, show: (v) => v.kind === "webhook", placeholder: "https://ntfy.sh/mon-sujet" },
    { name: "method", label: "Méthode", type: "select", show: (v) => v.kind === "webhook", options: [{ value: "post", label: "POST" }, { value: "put", label: "PUT" }, { value: "get", label: "GET" }] },
    { name: "body", label: "Corps", type: "code", rows: 4, show: (v) => v.kind === "webhook", help: "Modèle Handlebars, ex. {{ title }} : {{ message }}" },
    { name: "comment", label: "Commentaire", full: true },
    { name: "disable", label: "Désactivée", type: "checkbox" },
  ];
}

const MATCHER_KEYS = ["comment", "disable", "invert-match", "match-severity", "match-field", "match-calendar", "mode", "target"];
function matcherFields(editing: boolean): FieldDef[] {
  return [
    { name: "name", label: "Nom", required: true, readOnly: editing },
    { name: "target", label: "Envoyer à", type: "multi", required: true, load: async () => (await pve.get<any[]>("/cluster/notifications/targets")).map((t) => ({ value: t.name, label: `${t.name} (${t.type})` })) },
    { name: "match-severity", label: "Gravités", type: "multi", options: [{ value: "info", label: "Info" }, { value: "notice", label: "Notice" }, { value: "warning", label: "Attention" }, { value: "error", label: "Erreur" }, { value: "unknown", label: "Inconnue" }], help: "Rien de coché : toutes." },
    { name: "match-field", label: "Champs à respecter", placeholder: "exact:type=vzdump", help: "Ex. exact:type=vzdump, exact:hostname=pve, regex:job-id=^nuit. Séparés par des virgules." },
    { name: "match-calendar", label: "Plages horaires", placeholder: "mon..fri 8-18", advanced: true },
    { name: "mode", label: "Si plusieurs conditions", type: "select", options: [{ value: "all", label: "Toutes doivent être vraies" }, { value: "any", label: "Une seule suffit" }] },
    { name: "invert-match", label: "Inverser (tout sauf ce qui correspond)", type: "checkbox", advanced: true },
    { name: "comment", label: "Commentaire", full: true },
    { name: "disable", label: "Désactivée", type: "checkbox" },
  ];
}

export function DcNotifications() {
  const { toast } = useToast();
  return (
    <div className="stack">
      <Crud<any>
        title="Cibles de notification"
        help="Où Proxmox envoie ses notifications (sauvegardes, réplication, mises à jour, clôtures HA). Les alertes de MyProxmox ont leurs propres canaux, dans Alertes."
        list="/cluster/notifications/targets"
        rowKey={(t) => t.name}
        perm={["/mapping", "Mapping.Modify"]}
        createLabel="Ajouter une cible"
        wide
        columns={[
          { id: "name", header: "Nom", cell: (t) => <strong>{t.name}</strong> },
          { id: "type", header: "Type", cell: (t) => ({ sendmail: "Mail", smtp: "SMTP", gotify: "Gotify", webhook: "Webhook" } as Record<string, string>)[t.type] ?? t.type },
          { id: "comment", header: "Commentaire", cell: (t) => <span className="small">{t.comment}</span> },
          { id: "state", header: "État", cell: (t) => (Number(t.disable) ? <span className="badge off">désactivée</span> : <span className="badge on">active</span>) },
        ]}
        fields={targetFields}
        initial={(t) => ({ ...t, kind: t.type })}
        canRemove={(t) => t.origin !== "builtin"}
        extraActions={(t) => <Button size="sm" onClick={async () => { try { await pve.post(`/cluster/notifications/targets/${t.name}/test`); toast(`Notification de test envoyée à ${t.name}`, "ok"); } catch (e) { toast((e as Error).message, "error"); } }}>Tester</Button>}
        create={(v) => pve.post(`/cluster/notifications/endpoints/${v.kind}`, { name: v.name, ...postBody(v, TARGET_KEYS) })}
        update={async (t, v) => pve.put(`/cluster/notifications/endpoints/${t.type}/${t.name}`, putBody(v, await pve.get(`/cluster/notifications/endpoints/${t.type}/${t.name}`), TARGET_KEYS.filter((k) => k !== "password" || v.password)))}
        remove={(t) => pve.del(`/cluster/notifications/endpoints/${t.type}/${t.name}`)}
      />
      <Crud<any>
        title="Règles d'envoi"
        help="Une règle choisit quelles notifications partent vers quelles cibles (selon la gravité, le type, le nœud...)."
        list="/cluster/notifications/matchers"
        rowKey={(m) => m.name}
        perm={["/mapping", "Mapping.Modify"]}
        createLabel="Ajouter une règle"
        wide
        columns={[
          { id: "name", header: "Nom", cell: (m) => <strong>{m.name}</strong> },
          { id: "sev", header: "Gravités", cell: (m) => (m["match-severity"] ?? []).join(", ") || "toutes" },
          { id: "field", header: "Conditions", cell: (m) => <span className="mono small">{(m["match-field"] ?? []).join(", ")}</span> },
          { id: "target", header: "Cibles", cell: (m) => (m.target ?? []).join(", ") },
          { id: "comment", header: "Commentaire", cell: (m) => <span className="small">{m.comment}</span> },
        ]}
        fields={matcherFields}
        initial={(m) => ({ ...m, "match-field": (m["match-field"] ?? []).join(","), "match-calendar": (m["match-calendar"] ?? []).join(","), disable: !!Number(m.disable), "invert-match": !!Number(m["invert-match"]) })}
        canRemove={(m) => m.origin !== "builtin"}
        create={(v) => pve.post("/cluster/notifications/matchers", { name: v.name, ...postBody(v, MATCHER_KEYS) })}
        update={(m, v) => pve.put(`/cluster/notifications/matchers/${m.name}`, putBody(v, m, MATCHER_KEYS))}
        remove={(m) => pve.del(`/cluster/notifications/matchers/${m.name}`)}
      />
    </div>
  );
}

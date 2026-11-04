// Paramètres > Comptes MyProxmox : comptes propres à MyProxmox (monitoring, lecture).
import { useState } from "react";
import { Button, Confirm, Modal, Notice, PageHead, Panel, useToast } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Form, type FieldDef } from "../components/Form";
import { api, usePoll } from "../lib/api";
import { useApp } from "../lib/app";
import { ago, date } from "../../../shared/format";
import { LOCAL_ROLES, type LocalRole, type LocalUserInfo, type RegistrationMode } from "../../../shared/types";

const STATUS: Record<LocalUserInfo["status"], [string, string]> = {
  active: ["Actif", "on"],
  pending: ["En attente", "warn"],
  disabled: ["Désactivé", "off"],
};
const REG: { id: RegistrationMode; title: string; desc: string }[] = [
  { id: "off", title: "Désactivée", desc: "Seul un administrateur crée les comptes." },
  { id: "approval", title: "Avec validation", desc: "Tout le monde peut demander un compte monitoring ; un administrateur le valide." },
  { id: "open", title: "Ouverte", desc: "Tout le monde peut créer un compte monitoring, actif tout de suite." },
];
const roleOptions = (Object.keys(LOCAL_ROLES) as LocalRole[]).map((r) => ({ value: r, label: `${LOCAL_ROLES[r].label} : ${LOCAL_ROLES[r].desc}` }));

const CREATE: FieldDef[] = [
  { name: "username", label: "Identifiant", required: true, help: "Minuscules, chiffres, point ou tiret. Exemple : tv-salon" },
  { name: "displayName", label: "Nom affiché", placeholder: "TV du salon" },
  { name: "role", label: "Rôle", type: "select", options: roleOptions, default: "monitoring", full: true },
  { name: "password", label: "Mot de passe", type: "password", required: true, help: "Au moins 10 caractères. Transmets-le par un canal sûr.", validate: (v) => (String(v).length < 10 ? "Au moins 10 caractères." : null) },
];
const RESET: FieldDef[] = [
  { name: "password", label: "Nouveau mot de passe", type: "password", required: true, full: true, help: "La double authentification du compte sera retirée : la personne la refera.", validate: (v) => (String(v).length < 10 ? "Au moins 10 caractères." : null) },
];

export function LocalAccounts() {
  const { me, settings, reloadSettings } = useApp();
  const { toast } = useToast();
  const list = usePoll(() => api<LocalUserInfo[]>("/api/local-users"), 15000);
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<LocalUserInfo | null>(null);
  const [del, setDel] = useState<LocalUserInfo | null>(null);
  const [disable, setDisable] = useState<LocalUserInfo | null>(null);

  if (!me.admin) {
    return (
      <>
        <PageHead title="Comptes MyProxmox" />
        <Notice kind="warn">Réservé aux comptes Proxmox qui ont le droit Sys.Modify sur « / ».</Notice>
      </>
    );
  }

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "ok");
      list.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const put = (u: LocalUserInfo, body: object, ok: string) => act(() => api(`/api/local-users/${u.id}`, { method: "PUT", body }), ok);
  const pending = (list.data ?? []).filter((u) => u.status === "pending");

  const columns: Column<LocalUserInfo>[] = [
    { id: "username", header: "Identifiant", sort: (u) => u.username, text: (u) => `${u.username} ${u.displayName}`, cell: (u) => <><strong>{u.username}</strong>{u.displayName !== u.username && <div className="small muted">{u.displayName}</div>}</> },
    {
      id: "role", header: "Rôle", sort: (u) => u.role,
      cell: (u) => (
        <select className="input select" aria-label={`Rôle de ${u.username}`} style={{ height: 28, width: 140 }} value={u.role} onChange={(e) => put(u, { role: e.target.value }, "Rôle changé")}>
          {(Object.keys(LOCAL_ROLES) as LocalRole[]).map((r) => <option key={r} value={r}>{LOCAL_ROLES[r].label}</option>)}
        </select>
      ),
    },
    { id: "status", header: "Statut", sort: (u) => u.status, cell: (u) => <span className={`badge ${STATUS[u.status][1]}`}>{STATUS[u.status][0]}</span> },
    { id: "totp", header: "2FA", sort: (u) => (u.totp ? 1 : 0), cell: (u) => (u.totp ? <span className="health-ok">Oui</span> : <span className="muted">Non</span>) },
    { id: "created", header: "Créé le", className: "small", sort: (u) => u.createdAt, cell: (u) => date(u.createdAt, true) },
    { id: "last", header: "Dernière connexion", className: "small muted", sort: (u) => u.lastLogin ?? "", cell: (u) => (u.lastLogin ? ago(Date.parse(u.lastLogin) / 1000) : "jamais") },
  ];

  return (
    <>
      <PageHead
        title="Comptes MyProxmox"
        sub="Comptes propres à MyProxmox, à côté des comptes Proxmox. Ils ne créent rien dans Proxmox."
        actions={<Button variant="primary" onClick={() => setCreating(true)}>Créer un compte</Button>}
      />
      <div className="stack">
        {pending.length > 0 && (
          <Panel title={`Inscriptions à valider (${pending.length})`}>
            <div className="stack">
              {pending.map((u) => (
                <div key={u.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span><strong>{u.displayName}</strong> <span className="muted">({u.username}) · demandé {ago(Date.parse(u.createdAt) / 1000)}</span></span>
                  <span className="row">
                    <Button size="sm" variant="primary" onClick={() => act(() => api(`/api/local-users/${u.id}/approve`, { method: "POST" }), `${u.username} validé`)}>Valider</Button>
                    <Button size="sm" variant="danger" onClick={() => setDel(u)}>Refuser</Button>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel pad={false} title="Comptes">
          <DataTable
            rows={list.data}
            loading={list.loading}
            error={list.error}
            columns={columns}
            rowKey={(u) => u.id}
            initialSort={{ id: "username", dir: "asc" }}
            filter="Identifiant ou nom"
            empty="Aucun compte MyProxmox pour l'instant."
            actions={(u) => (
              <span className="btn-group">
                {u.status === "pending" && <Button size="sm" onClick={() => act(() => api(`/api/local-users/${u.id}/approve`, { method: "POST" }), `${u.username} validé`)}>Valider</Button>}
                {u.status === "active" && <Button size="sm" onClick={() => setDisable(u)}>Désactiver</Button>}
                {u.status === "disabled" && <Button size="sm" onClick={() => put(u, { status: "active" }, "Compte réactivé")}>Réactiver</Button>}
                <Button size="sm" onClick={() => setReset(u)}>Mot de passe</Button>
                <Button size="sm" variant="danger" onClick={() => setDel(u)}>Supprimer</Button>
              </span>
            )}
          />
        </Panel>

        <Panel title="Inscription libre">
          <div className="choice">
            {REG.map((r) => (
              <label key={r.id} className={settings?.registration === r.id ? "sel" : ""}>
                <input
                  type="radio"
                  name="registration"
                  checked={settings?.registration === r.id}
                  onChange={async () => {
                    await act(() => api("/api/settings", { method: "PUT", body: { registration: r.id } }), "Réglage enregistré");
                    await reloadSettings();
                  }}
                />
                <div><div className="t">{r.title}</div><div className="d">{r.desc}</div></div>
              </label>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>Le lien secret de l&apos;écran de monitoring reste disponible dans Paramètres, pour un écran sans compte.</p>
        </Panel>
      </div>

      {creating && (
        <Modal title="Créer un compte MyProxmox" onClose={() => setCreating(false)}>
          <Form
            fields={CREATE}
            submitLabel="Créer"
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              await api("/api/local-users", { method: "POST", body: v });
              toast(`Compte ${v.username} créé`, "ok");
              setCreating(false);
              list.refresh();
            }}
          />
        </Modal>
      )}
      {reset && (
        <Modal title={`Nouveau mot de passe pour ${reset.username}`} onClose={() => setReset(null)}>
          <Form
            fields={RESET}
            submitLabel="Changer le mot de passe"
            onCancel={() => setReset(null)}
            onSubmit={async (v) => {
              await api(`/api/local-users/${reset.id}/password`, { method: "POST", body: v });
              toast("Mot de passe changé, sessions fermées", "ok");
              setReset(null);
              list.refresh();
            }}
          />
        </Modal>
      )}
      {disable && (
        <Confirm title={`Désactiver ${disable.username} ?`} confirmLabel="Désactiver" onConfirm={() => put(disable, { status: "disabled" }, "Compte désactivé")} onClose={() => setDisable(null)}>
          <p>La personne est déconnectée tout de suite et ne peut plus se connecter. Tu pourras réactiver le compte.</p>
        </Confirm>
      )}
      {del && (
        <Confirm
          title={del.status === "pending" ? `Refuser la demande de ${del.username} ?` : `Supprimer le compte ${del.username} ?`}
          danger
          requireText={del.status === "pending" ? undefined : del.username}
          confirmLabel={del.status === "pending" ? "Refuser" : "Supprimer"}
          onConfirm={() => act(() => api(`/api/local-users/${del.id}`, { method: "DELETE" }), del.status === "pending" ? "Demande refusée" : "Compte supprimé")}
          onClose={() => setDel(null)}
        >
          <p>{del.status === "pending" ? "La demande est effacée." : "Le compte est effacé et la personne déconnectée. Ça ne se défait pas."}</p>
        </Confirm>
      )}
    </>
  );
}

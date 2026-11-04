// Permissions : utilisateurs, groupes, pools, rôles, ACL, domaines, double authentification, jetons API.
import { useState } from "react";
import { Button, Confirm, Modal, Notice, Panel, SecretBox, Tabs, Toggle, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form, type FieldDef } from "../../components/Form";
import { Crud, postBody, putBody } from "../../components/Crud";
import { AclEditor } from "../../components/AclEditor";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { date } from "../../../../shared/format";
import { PRIVILEGES, ROLE_DESC } from "../../../../shared/privileges";

type Tab = "users" | "groups" | "pools" | "roles" | "acl" | "realms" | "tfa" | "tokens";
const realms = async () => (await pve.get<any[]>("/access/domains")).map((r) => ({ value: r.realm, label: `${r.realm} (${r.type})` }));
const groupsOpts = async () => (await pve.get<any[]>("/access/groups")).map((g) => ({ value: g.groupid, label: g.groupid }));
const toDate = (ts: number) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "");
const fromDate = (d: unknown) => (d ? Math.floor(Date.parse(`${d}T23:59:59`) / 1000) : 0);

// ── Utilisateurs ──────────────────────────────────────────────────
function Users() {
  const { toast } = useToast();
  const { allowed } = usePermission("/access", "User.Modify");
  const [pw, setPw] = useState<any | null>(null);
  const tfa = usePoll(() => pve.get<any[]>("/access/tfa"), 0);
  const has2fa = (u: string) => (tfa.data ?? []).some((t) => t.userid === u && (t.entries ?? []).some((e: any) => e.enable !== 0 && e.type !== "recovery"));
  const userFields = (editing: boolean): FieldDef[] => [
    ...(editing ? [] : [
      { name: "name", label: "Identifiant", required: true, placeholder: "alice", validate: (x: unknown) => (/^[^\s@:]+$/.test(String(x)) ? null : "Sans espace, @ ni deux-points.") },
      { name: "realm", label: "Domaine", type: "api-select" as const, load: realms, default: "pve" },
      { name: "password", label: "Mot de passe", type: "password" as const, show: (v: Record<string, unknown>) => v.realm === "pve", required: true, validate: (x: unknown) => (String(x).length < 8 ? "8 caractères au moins." : null) },
    ]),
    { name: "firstname", label: "Prénom" }, { name: "lastname", label: "Nom" },
    { name: "email", label: "Mail" },
    { name: "groups", label: "Groupes", type: "multi", load: groupsOpts },
    { name: "expire", label: "Expire le", placeholder: "AAAA-MM-JJ", help: "Vide : jamais.", validate: (x) => (!x || /^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? null : "Format AAAA-MM-JJ.") },
    { name: "enable", label: "Compte actif", type: "checkbox", default: true },
    { name: "comment", label: "Commentaire", full: true },
    { name: "keys", label: "Clés Yubico OTP", advanced: true },
  ];
  return (
    <>
      <Crud<any>
        title="Utilisateurs"
        list="/access/users"
        query={{ full: 1 }}
        rowKey={(u) => u.userid}
        perm={["/access", "User.Modify"]}
        createLabel="Créer un utilisateur"
        removeRequireText
        canRemove={(u) => u.userid !== "root@pam"}
        columns={[
          { id: "id", header: "Utilisateur", sort: (u) => u.userid, cell: (u) => <strong>{u.userid}</strong> },
          { id: "name", header: "Nom", text: (u) => `${u.firstname ?? ""} ${u.lastname ?? ""} ${u.email ?? ""}`, cell: (u) => <>{[u.firstname, u.lastname].filter(Boolean).join(" ")}{u.email && <div className="small muted">{u.email}</div>}</> },
          { id: "groups", header: "Groupes", cell: (u) => u.groups },
          { id: "on", header: "Actif", cell: (u) => (Number(u.enable) ? <span className="badge on">Oui</span> : <span className="badge off">Non</span>) },
          { id: "exp", header: "Expire", cell: (u) => (Number(u.expire) ? <span className={Number(u.expire) < Date.now() / 1000 ? "health-bad" : ""}>{date(u.expire, true)}</span> : <span className="muted">jamais</span>) },
          { id: "tfa", header: "2FA", cell: (u) => (has2fa(u.userid) ? <span className="health-ok">Oui</span> : <span className="muted">Non</span>) },
        ]}
        fields={userFields}
        initial={(u) => ({ ...u, groups: String(u.groups ?? "").split(",").filter(Boolean), expire: toDate(Number(u.expire)), enable: !!Number(u.enable) })}
        create={(v) => pve.post("/access/users", { userid: `${v.name}@${v.realm}`, ...postBody({ ...v, expire: fromDate(v.expire) || undefined }, ["password", "firstname", "lastname", "email", "groups", "expire", "enable", "comment", "keys"]) })}
        update={(u, v) => pve.put(`/access/users/${u.userid}`, { ...putBody(v, u, ["firstname", "lastname", "email", "comment", "keys"]), groups: (v.groups as string[]).join(","), expire: fromDate(v.expire), enable: v.enable ? 1 : 0 })}
        remove={(u) => pve.del(`/access/users/${u.userid}`)}
        removeText={(u) => <p>Le compte {u.userid}, ses jetons API et ses permissions sont supprimés.</p>}
        extraActions={(u) => (String(u.userid).endsWith("@pve") ? <Button size="sm" disabled={!allowed} onClick={() => setPw(u)}>Mot de passe</Button> : null)}
      />
      {pw && (
        <Modal title={`Mot de passe de ${pw.userid}`} onClose={() => setPw(null)}>
          <Form fields={[{ name: "password", label: "Nouveau mot de passe", type: "password", required: true, validate: (x) => (String(x).length < 8 ? "8 caractères au moins." : null) }, { name: "confirm", label: "Confirme", type: "password", required: true, validate: (x, v) => (x !== v.password ? "Les deux mots de passe ne sont pas identiques." : null) }]}
            submitLabel="Changer" onCancel={() => setPw(null)} onSubmit={async (v) => { await pve.put("/access/password", { userid: pw.userid, password: v.password }); toast("Mot de passe changé", "ok"); setPw(null); }} />
        </Modal>
      )}
    </>
  );
}

// ── Rôles ─────────────────────────────────────────────────────────
function Roles() {
  const groups = [...new Set(Object.values(PRIVILEGES).map((p) => p.group))];
  const privFields = (): FieldDef[] => [
    { name: "roleid", label: "Nom du rôle", required: true, validate: (x) => (/^[A-Za-z][\w.-]*$/.test(String(x)) ? null : "Lettres, chiffres, point, tiret.") },
    ...groups.map((g): FieldDef => ({ name: `g_${g}`, label: g, type: "multi", full: true, options: Object.entries(PRIVILEGES).filter(([, p]) => p.group === g).map(([k, p]) => ({ value: k, label: `${k} : ${p.desc}` })) })),
  ];
  const split = (privs: string) => Object.fromEntries(groups.map((g) => [`g_${g}`, String(privs).split(",").filter((p) => PRIVILEGES[p]?.group === g)]));
  const join = (v: Record<string, unknown>) => groups.flatMap((g) => (v[`g_${g}`] as string[]) ?? []).join(",");
  return (
    <Crud<any>
      title="Rôles"
      help="Un rôle est un ensemble de privilèges. Les rôles de Proxmox ne se modifient pas ; crée les tiens en cochant les privilèges voulus."
      list="/access/roles"
      rowKey={(r) => r.roleid}
      perm={["/access", "Permissions.Modify"]}
      createLabel="Créer un rôle"
      wide
      canEdit={(r) => !Number(r.special)}
      canRemove={(r) => !Number(r.special)}
      columns={[
        { id: "id", header: "Rôle", sort: (r) => r.roleid, cell: (r) => <><strong>{r.roleid}</strong>{Number(r.special) ? <span className="tag" style={{ marginLeft: 6 }}>Proxmox</span> : null}</> },
        { id: "desc", header: "Usage", cell: (r) => <span className="small">{ROLE_DESC[r.roleid] ?? ""}</span> },
        { id: "privs", header: "Privilèges", text: (r) => r.privs, cell: (r) => <span className="small mono">{String(r.privs).split(",").filter(Boolean).length} : {String(r.privs).split(",").slice(0, 4).join(", ")}{String(r.privs).split(",").length > 4 ? "…" : ""}</span> },
      ]}
      fields={(editing) => privFields().map((f) => (f.name === "roleid" ? { ...f, readOnly: editing } : f))}
      initial={(r) => ({ roleid: r.roleid, ...split(r.privs) })}
      create={(v) => pve.post("/access/roles", { roleid: v.roleid, privs: join(v) })}
      update={(r, v) => pve.put(`/access/roles/${r.roleid}`, { privs: join(v) })}
      remove={(r) => pve.del(`/access/roles/${r.roleid}`)}
      removeText={() => <p>Retire d&apos;abord ce rôle des permissions qui l&apos;utilisent.</p>}
    />
  );
}

// ── ACL en arbre ──────────────────────────────────────────────────
function AclTree() {
  const acl = usePoll(() => pve.get<any[]>("/access/acl"), 0);
  const paths = [...new Set((acl.data ?? []).map((a) => a.path))].sort();
  const all = new Set<string>(["/"]);
  for (const p of paths) { const parts = p.split("/").filter(Boolean); for (let i = 1; i <= parts.length; i++) all.add(`/${parts.slice(0, i).join("/")}`); }
  const list = [...all].sort();
  const LABEL: Record<string, string> = { "/": "Tout (racine)", "/vms": "Toutes les machines", "/storage": "Tous les stockages", "/nodes": "Tous les nœuds", "/pool": "Tous les pools", "/access": "Comptes et permissions", "/sdn": "Réseau logiciel", "/mapping": "Mappings" };
  return (
    <div className="stack">
      <Panel title="Arbre des chemins">
        <ul className="acl-tree">
          {list.map((p) => {
            const depth = p === "/" ? 0 : p.split("/").filter(Boolean).length;
            const here = (acl.data ?? []).filter((a) => a.path === p);
            return (
              <li key={p} style={{ paddingLeft: depth * 20 }}>
                <span className="mono">{p}</span> <span className="muted small">{LABEL[p] ?? ""}</span>
                {here.map((a) => <span key={`${a.ugid}${a.roleid}`} className="chip" style={{ marginLeft: 8 }}>{a.ugid} : {a.roleid}{a.propagate ? "" : " (non transmis)"}</span>)}
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel pad={false} title="Toutes les permissions"><AclEditor onChange={acl.refresh} /></Panel>
    </div>
  );
}

// ── Domaines d'authentification ───────────────────────────────────
function Realms() {
  const { toast, watch } = useToast();
  const KEYS = ["comment", "default", "tfa", "server1", "server2", "port", "secure", "mode", "base_dn", "user_attr", "bind_dn", "password", "domain", "issuer-url", "client-id", "client-key", "username-claim", "autocreate", "scopes", "group_filter", "group_dn", "sync-defaults-options"];
  const fields = (editing: boolean): FieldDef[] => [
    { name: "type", label: "Type", type: "select", readOnly: editing, default: "ldap", options: [{ value: "ldap", label: "LDAP" }, { value: "ad", label: "Active Directory" }, { value: "openid", label: "OpenID Connect" }, { value: "pve", label: "Proxmox VE" }, { value: "pam", label: "Linux PAM" }] },
    { name: "realm", label: "Nom", required: true, readOnly: editing, placeholder: "entreprise" },
    { name: "server1", label: "Serveur", required: true, show: (v) => v.type === "ldap" || v.type === "ad" },
    { name: "server2", label: "Serveur de secours", show: (v) => v.type === "ldap" || v.type === "ad", advanced: true },
    { name: "port", label: "Port", type: "number", show: (v) => v.type === "ldap" || v.type === "ad", advanced: true },
    { name: "mode", label: "Connexion", type: "select", show: (v) => v.type === "ldap" || v.type === "ad", options: [{ value: "ldap", label: "LDAP (non chiffré)" }, { value: "ldap+starttls", label: "LDAP + STARTTLS" }, { value: "ldaps", label: "LDAPS" }] },
    { name: "base_dn", label: "Base DN", required: true, placeholder: "dc=exemple,dc=fr", show: (v) => v.type === "ldap" },
    { name: "user_attr", label: "Attribut utilisateur", default: "uid", required: true, show: (v) => v.type === "ldap" },
    { name: "domain", label: "Domaine AD", required: true, placeholder: "exemple.local", show: (v) => v.type === "ad" },
    { name: "bind_dn", label: "Compte de lecture (bind DN)", show: (v) => v.type === "ldap" || v.type === "ad", help: "Pour la synchronisation des utilisateurs et groupes." },
    { name: "password", label: "Mot de passe du compte de lecture", type: "password", show: (v) => v.type === "ldap" || v.type === "ad" },
    { name: "issuer-url", label: "Adresse de l'émetteur", required: true, placeholder: "https://auth.exemple.fr/realms/maison", show: (v) => v.type === "openid" },
    { name: "client-id", label: "Identifiant client", required: true, show: (v) => v.type === "openid" },
    { name: "client-key", label: "Secret client", type: "password", show: (v) => v.type === "openid" },
    { name: "username-claim", label: "Champ du nom d'utilisateur", placeholder: "subject", show: (v) => v.type === "openid", advanced: true },
    { name: "autocreate", label: "Créer les utilisateurs à la première connexion", type: "checkbox", show: (v) => v.type === "openid" },
    { name: "default", label: "Domaine proposé par défaut à la connexion", type: "checkbox" },
    { name: "comment", label: "Commentaire", full: true },
  ];
  return (
    <Crud<any>
      title="Domaines d'authentification"
      help="Où Proxmox vérifie les mots de passe : comptes Linux (PAM), comptes Proxmox (PVE), annuaire LDAP ou Active Directory, ou fournisseur OpenID (Keycloak, Authentik...)."
      list="/access/domains"
      rowKey={(r) => r.realm}
      perm={["/access", "Realm.Allocate"]}
      createLabel="Ajouter un domaine"
      wide
      canRemove={(r) => !["pam", "pve"].includes(r.realm)}
      columns={[
        { id: "realm", header: "Domaine", cell: (r) => <><strong>{r.realm}</strong>{Number(r.default) ? <span className="tag" style={{ marginLeft: 6 }}>par défaut</span> : null}</> },
        { id: "type", header: "Type", cell: (r) => ({ pam: "Linux PAM", pve: "Proxmox VE", ldap: "LDAP", ad: "Active Directory", openid: "OpenID" } as Record<string, string>)[r.type] ?? r.type },
        { id: "comment", header: "Commentaire", cell: (r) => <span className="small">{r.comment}</span> },
      ]}
      fields={fields}
      initial={(r) => ({ ...r, default: !!Number(r.default), autocreate: !!Number(r.autocreate) })}
      create={(v) => pve.post("/access/domains", { realm: v.realm, type: v.type, ...postBody(v, KEYS) })}
      update={(r, v) => pve.put(`/access/domains/${r.realm}`, putBody(v, r, KEYS.filter((k) => !["password", "client-key"].includes(k) || v[k])))}
      remove={(r) => pve.del(`/access/domains/${r.realm}`)}
      extraActions={(r) => (r.type === "ldap" || r.type === "ad" ? <Button size="sm" onClick={async () => { try { const upid = await pve.post<string>(`/access/domains/${r.realm}/sync`, { scope: "both", "remove-vanished": "acl;entry;properties" }); watch(String(upid).split(":")[1] || "pve", upid, `Synchronisation de ${r.realm}`); } catch (e) { toast((e as Error).message, "error"); } }}>Synchroniser</Button> : null)}
    />
  );
}

// ── Double authentification ───────────────────────────────────────
function newTotpSecret() {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => abc[b % 32]).join("");
}
function b64url(buf: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function fromB64url(s: string) { return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); }

function Tfa() {
  const { toast } = useToast();
  const { allowed } = usePermission("/access", "User.Modify");
  const tfa = usePoll(() => pve.get<any[]>("/access/tfa"), 0);
  const users = usePoll(() => pve.get<any[]>("/access/users"), 0);
  const [add, setAdd] = useState<{ user: string; type: "totp" | "webauthn" | "recovery"; secret?: string } | null>(null);
  const [keys, setKeys] = useState<string[] | null>(null);
  const [del, setDel] = useState<{ user: string; id: string } | null>(null);
  const [user, setUser] = useState("");
  const rows = (tfa.data ?? []).flatMap((t) => (t.entries ?? []).map((e: any) => ({ ...e, userid: t.userid })));
  const issuer = "Proxmox";
  return (
    <div className="stack">
      <Panel title="Ajouter un second facteur">
        <div className="row">
          <select className="input select" aria-label="Utilisateur" style={{ width: 240 }} value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Choisis un utilisateur</option>
            {(users.data ?? []).map((u) => <option key={u.userid} value={u.userid}>{u.userid}</option>)}
          </select>
          {(["totp", "webauthn", "recovery"] as const).map((t) => (
            <Button key={t} size="sm" disabled={!allowed || !user} title={user ? undefined : "Choisis d'abord un utilisateur"} onClick={() => setAdd({ user, type: t, secret: t === "totp" ? newTotpSecret() : undefined })}>{t === "totp" ? "Application (TOTP)" : t === "webauthn" ? "Clé de sécurité (WebAuthn)" : "Codes de récupération"}</Button>
          ))}
        </div>
      </Panel>
      <Panel pad={false} title="Seconds facteurs enregistrés">
        <DataTable rows={tfa.data ? rows : null} loading={tfa.loading} rowKey={(e) => `${e.userid}/${e.id}`} filter={false} empty="Aucun second facteur. Active au moins la 2FA de root@pam." columns={[
          { id: "user", header: "Utilisateur", cell: (e) => <strong>{e.userid}</strong> },
          { id: "type", header: "Type", cell: (e) => ({ totp: "Application TOTP", webauthn: "Clé WebAuthn", recovery: "Codes de récupération", yubico: "Yubico OTP", u2f: "U2F" } as Record<string, string>)[e.type] ?? e.type },
          { id: "desc", header: "Description", cell: (e) => e.description },
          { id: "created", header: "Ajouté le", cell: (e) => (e.created ? date(e.created, true) : "-") },
          { id: "on", header: "Actif", cell: (e) => (e.type === "recovery" ? "" : <Toggle on={e.enable !== 0} label={`Activer ${e.id}`} onChange={async (on) => { if (!allowed) return; try { await pve.put(`/access/tfa/${e.userid}/${e.id}`, { enable: on ? 1 : 0 }); tfa.refresh(); } catch (x) { toast((x as Error).message, "error"); } }} />) },
        ]} actions={(e) => <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel({ user: e.userid, id: e.id })}>Supprimer</Button>} />
      </Panel>
      {add?.type === "totp" && (
        <Modal title={`Application TOTP pour ${add.user}`} onClose={() => setAdd(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>Ajoute ce compte dans ton application d&apos;authentification, puis entre le code affiché.</p>
            <SecretBox value={add.secret!} />
            <SecretBox value={`otpauth://totp/${issuer}:${encodeURIComponent(add.user)}?secret=${add.secret}&issuer=${issuer}`} />
            <Form fields={[{ name: "description", label: "Description", default: "Téléphone" }, { name: "value", label: "Code à 6 chiffres", required: true, validate: (x) => (/^\d{6}$/.test(String(x)) ? null : "6 chiffres.") }]} submitLabel="Ajouter" onCancel={() => setAdd(null)} onSubmit={async (v) => {
              await pve.post(`/access/tfa/${add.user}`, { type: "totp", description: v.description, totp: `otpauth://totp/${issuer}:${add.user}?secret=${add.secret}&issuer=${issuer}`, value: v.value });
              toast("Application TOTP ajoutée", "ok"); setAdd(null); tfa.refresh();
            }} />
          </div>
        </Modal>
      )}
      {add?.type === "webauthn" && (
        <Modal title={`Clé de sécurité pour ${add.user}`} onClose={() => setAdd(null)}>
          <div className="stack">
            <Notice>WebAuthn demande une adresse en HTTPS et que l&apos;option WebAuthn soit réglée dans les options du datacenter (identifiant et origine du site).</Notice>
            <Form fields={[{ name: "description", label: "Description", default: "Clé USB" }]} submitLabel="Enregistrer la clé" onCancel={() => setAdd(null)} onSubmit={async (v) => {
              const r = await pve.post<any>(`/access/tfa/${add.user}`, { type: "webauthn", description: v.description });
              const ch = JSON.parse(r.challenge);
              if (!navigator.credentials || !window.isSecureContext) throw new Error("Ce navigateur ou cette adresse (HTTP) ne permet pas WebAuthn. Ouvre MyProxmox en HTTPS.");
              const pk = ch.publicKey;
              const cred = (await navigator.credentials.create({ publicKey: { ...pk, challenge: fromB64url(pk.challenge), user: pk.user ? { ...pk.user, id: fromB64url(pk.user.id) } : undefined } as PublicKeyCredentialCreationOptions })) as PublicKeyCredential;
              const resp = cred.response as AuthenticatorAttestationResponse;
              await pve.post(`/access/tfa/${add.user}`, { type: "webauthn", description: v.description, challenge: r.challenge, value: JSON.stringify({ id: cred.id, type: cred.type, rawId: b64url(cred.rawId), response: { attestationObject: b64url(resp.attestationObject), clientDataJSON: b64url(resp.clientDataJSON) } }) });
              toast("Clé de sécurité ajoutée", "ok"); setAdd(null); tfa.refresh();
            }} />
          </div>
        </Modal>
      )}
      {add?.type === "recovery" && (
        <Confirm title={`Générer des codes de récupération pour ${add.user} ?`} confirmLabel="Générer" onConfirm={async () => {
          try { const r = await pve.post<any>(`/access/tfa/${add.user}`, { type: "recovery" }); setKeys(r.recovery ?? []); tfa.refresh(); } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setAdd(null)}><p>Dix codes à usage unique, pour se connecter si le téléphone ou la clé est perdu. Ils ne sont affichés qu&apos;une fois.</p></Confirm>
      )}
      {keys && (
        <Modal title="Codes de récupération" onClose={() => setKeys(null)} foot={<Button variant="primary" onClick={() => setKeys(null)}>Je les ai notés</Button>}>
          <div className="stack">
            <Notice kind="warn">Note-les maintenant et range-les en lieu sûr : ils ne seront plus affichés.</Notice>
            <pre className="code">{keys.join("\n")}</pre>
          </div>
        </Modal>
      )}
      {del && <Confirm title="Supprimer ce second facteur ?" danger confirmLabel="Supprimer" onConfirm={async () => { try { await pve.del(`/access/tfa/${del.user}/${del.id}`); tfa.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDel(null)}><p>{del.user} ne pourra plus l&apos;utiliser pour se connecter.</p></Confirm>}
    </div>
  );
}

// ── Jetons API ────────────────────────────────────────────────────
function Tokens() {
  const { toast } = useToast();
  const { allowed } = usePermission("/access", "User.Modify");
  const users = usePoll(() => pve.get<any[]>("/access/users", { full: 1 }), 0);
  const [add, setAdd] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const rows = (users.data ?? []).flatMap((u) => (u.tokens ?? []).map((t: any) => ({ ...t, userid: u.userid, full: `${u.userid}!${t.tokenid}` })));
  return (
    <>
      <Panel pad={false} title="Jetons API" right={<Button size="sm" variant="primary" disabled={!allowed} onClick={() => setAdd(true)}>Créer un jeton</Button>}>
        <DataTable rows={users.data ? rows : null} loading={users.loading} rowKey={(t) => t.full} filter={false} empty="Aucun jeton." columns={[
          { id: "id", header: "Jeton", cell: (t) => <strong className="mono">{t.full}</strong> },
          { id: "privsep", header: "Droits", cell: (t) => (Number(t.privsep) ? "Séparés (ses propres permissions)" : <span className="health-bad">Tous ceux de l&apos;utilisateur</span>) },
          { id: "exp", header: "Expire", cell: (t) => (Number(t.expire) ? date(t.expire, true) : <span className="muted">jamais</span>) },
          { id: "comment", header: "Commentaire", cell: (t) => t.comment },
        ]} actions={(t) => <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(t)}>Révoquer</Button>} />
      </Panel>
      {add && (
        <Modal title="Nouveau jeton API" onClose={() => setAdd(false)}>
          <Form fields={[
            { name: "userid", label: "Utilisateur", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/access/users")).map((u) => ({ value: u.userid, label: u.userid })) },
            { name: "tokenid", label: "Nom du jeton", required: true, placeholder: "terraform", validate: (x) => (/^[A-Za-z][\w.-]*$/.test(String(x)) ? null : "Lettres, chiffres, point, tiret.") },
            { name: "privsep", label: "Droits séparés (conseillé : donne-lui ensuite ses propres permissions)", type: "checkbox", default: true },
            { name: "expire", label: "Expire le", placeholder: "AAAA-MM-JJ" },
            { name: "comment", label: "Commentaire", full: true },
          ]} submitLabel="Créer" onCancel={() => setAdd(false)} onSubmit={async (v) => {
            const r = await pve.post<any>(`/access/users/${v.userid}/token/${v.tokenid}`, { privsep: v.privsep ? 1 : 0, expire: fromDate(v.expire), comment: v.comment || undefined });
            setAdd(false); setSecret({ id: r["full-tokenid"], value: r.value }); users.refresh();
          }} />
        </Modal>
      )}
      {secret && (
        <Modal title="Secret du jeton" onClose={() => setSecret(null)} foot={<Button variant="primary" onClick={() => setSecret(null)}>Je l&apos;ai copié</Button>}>
          <div className="stack">
            <Notice kind="warn">Copie le secret maintenant : il ne sera plus jamais affiché.</Notice>
            <div className="kv"><div>Identifiant</div><div className="mono">{secret.id}</div></div>
            <SecretBox value={secret.value} />
          </div>
        </Modal>
      )}
      {del && <Confirm title={`Révoquer ${del.full} ?`} danger confirmLabel="Révoquer" onConfirm={async () => { try { await pve.del(`/access/users/${del.userid}/token/${del.tokenid}`); toast("Jeton révoqué", "ok"); users.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDel(null)}><p>Les scripts et outils qui l&apos;utilisent ne pourront plus se connecter.</p></Confirm>}
    </>
  );
}

// ── Pools ─────────────────────────────────────────────────────────
function Pools() {
  const { toast } = useToast();
  const [members, setMembers] = useState<any | null>(null);
  return (
    <>
      <Crud<any>
        title="Pools"
        help="Un pool regroupe des machines et des stockages, pour donner des permissions d'un coup (/pool/nom) ou les sauvegarder ensemble."
        list="/pools"
        rowKey={(p) => p.poolid}
        perm={["/pool", "Pool.Allocate"]}
        createLabel="Créer un pool"
        columns={[{ id: "id", header: "Pool", sort: (p) => p.poolid, cell: (p) => <strong>{p.poolid}</strong> }, { id: "comment", header: "Commentaire", cell: (p) => p.comment }]}
        fields={(editing) => [{ name: "poolid", label: "Nom", required: true, readOnly: editing }, { name: "comment", label: "Commentaire", full: true }]}
        create={(v) => pve.post("/pools", postBody(v, ["poolid", "comment"]))}
        update={(p, v) => pve.put(`/pools/${p.poolid}`, { comment: v.comment ?? "" })}
        remove={(p) => pve.del(`/pools/${p.poolid}`)}
        removeText={() => <p>Le pool doit être vide. Les machines ne sont pas touchées.</p>}
        extraActions={(p) => <Button size="sm" onClick={async () => setMembers({ poolid: p.poolid, ...(await pve.get(`/pools/${p.poolid}`)) })}>Membres</Button>}
      />
      {members && (
        <Modal title={`Membres du pool ${members.poolid}`} wide onClose={() => setMembers(null)}>
          <Form
            fields={[
              { name: "vms", label: "Machines", type: "multi", load: async () => (await pve.get<any[]>("/cluster/resources", { type: "vm" })).map((g) => ({ value: String(g.vmid), label: `${g.vmid} ${g.name}${g.pool && g.pool !== members.poolid ? ` (dans ${g.pool})` : ""}` })) },
              { name: "storage", label: "Stockages", type: "multi", load: async () => (await pve.get<any[]>("/storage")).map((s) => ({ value: s.storage, label: s.storage })) },
            ]}
            initial={{ vms: (members.members ?? []).filter((m: any) => m.vmid).map((m: any) => String(m.vmid)), storage: (members.members ?? []).filter((m: any) => m.type === "storage").map((m: any) => m.storage) }}
            onCancel={() => setMembers(null)}
            onSubmit={async (_c, v) => {
              const curVms: string[] = (members.members ?? []).filter((m: any) => m.vmid).map((m: any) => String(m.vmid));
              const curSt: string[] = (members.members ?? []).filter((m: any) => m.type === "storage").map((m: any) => m.storage);
              const vms = v.vms as string[];
              const st = v.storage as string[];
              const addV = vms.filter((x) => !curVms.includes(x));
              const remV = curVms.filter((x) => !vms.includes(x));
              const addS = st.filter((x) => !curSt.includes(x));
              const remS = curSt.filter((x) => !st.includes(x));
              if (addV.length || addS.length) await pve.put(`/pools/${members.poolid}`, { vms: addV.join(",") || undefined, storage: addS.join(",") || undefined, "allow-move": 1 });
              if (remV.length || remS.length) await pve.put(`/pools/${members.poolid}`, { vms: remV.join(",") || undefined, storage: remS.join(",") || undefined, delete: 1 });
              toast("Membres enregistrés", "ok");
              setMembers(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}

export function DcPermissions() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "users", label: "Utilisateurs" }, { id: "groups", label: "Groupes" }, { id: "pools", label: "Pools" }, { id: "roles", label: "Rôles" },
        { id: "acl", label: "Permissions (ACL)" }, { id: "realms", label: "Domaines" }, { id: "tfa", label: "Double authentification" }, { id: "tokens", label: "Jetons API" },
      ]} />
      {tab === "users" && <Users />}
      {tab === "groups" && (
        <Crud<any>
          title="Groupes" list="/access/groups" rowKey={(g) => g.groupid} perm={["/access", "Group.Allocate"]} createLabel="Créer un groupe"
          columns={[{ id: "id", header: "Groupe", sort: (g) => g.groupid, cell: (g) => <strong>{g.groupid}</strong> }, { id: "users", header: "Membres", cell: (g) => <span className="small">{g.users}</span> }, { id: "comment", header: "Commentaire", cell: (g) => g.comment }]}
          fields={(editing) => [{ name: "groupid", label: "Nom", required: true, readOnly: editing }, { name: "comment", label: "Commentaire", full: true }]}
          create={(v) => pve.post("/access/groups", postBody(v, ["groupid", "comment"]))}
          update={(g, v) => pve.put(`/access/groups/${g.groupid}`, { comment: v.comment ?? "" })}
          remove={(g) => pve.del(`/access/groups/${g.groupid}`)}
          removeText={() => <p>Les membres perdent les permissions données au groupe. Les comptes ne sont pas supprimés.</p>}
        />
      )}
      {tab === "pools" && <Pools />}
      {tab === "roles" && <Roles />}
      {tab === "acl" && <AclTree />}
      {tab === "realms" && <Realms />}
      {tab === "tfa" && <Tfa />}
      {tab === "tokens" && <Tokens />}
    </>
  );
}


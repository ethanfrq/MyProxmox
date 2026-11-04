// Comptes ACME (Let's Encrypt...) et plugins de validation DNS, communs à tout le datacenter.
import { useState } from "react";
import { Button, Confirm, Modal, Panel, useToast } from "./ui";
import { DataTable } from "./DataTable";
import { Form } from "./Form";
import { pve, usePoll } from "../lib/api";
import { usePermission } from "../lib/permissions";
import { date } from "../../../shared/format";

export function AcmeAccounts() {
  const { toast, watch } = useToast();
  const { allowed } = usePermission("/", "Sys.Modify");
  const list = usePoll(async () => Promise.all((await pve.get<any[]>("/cluster/acme/account")).map((a) => pve.get<any>(`/cluster/acme/account/${a.name}`).then((d) => ({ name: a.name, ...d })))), 0);
  const [add, setAdd] = useState(false);
  const [del, setDel] = useState<any | null>(null);
  return (
    <Panel pad={false} title="Comptes ACME" right={<Button size="sm" variant="primary" disabled={!allowed} onClick={() => setAdd(true)}>Créer un compte</Button>}>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(a) => a.name}
        filter={false}
        empty="Aucun compte. Il en faut un pour obtenir des certificats gratuits auprès de Let's Encrypt."
        columns={[
          { id: "name", header: "Nom", cell: (a) => <strong>{a.name}</strong> },
          { id: "contact", header: "Contact", cell: (a) => (a.account?.contact ?? []).map((c: string) => c.replace("mailto:", "")).join(", ") },
          { id: "dir", header: "Autorité", cell: (a) => <span className="small">{/staging/.test(a.directory) ? "Let's Encrypt (test)" : /letsencrypt/.test(a.directory) ? "Let's Encrypt" : a.directory}</span> },
          { id: "status", header: "État", cell: (a) => <span className={`badge ${a.account?.status === "valid" ? "on" : "warn"}`}>{a.account?.status === "valid" ? "Valide" : a.account?.status ?? "?"}</span> },
          { id: "created", header: "Créé le", cell: (a) => (a.account?.createdAt ? date(a.account.createdAt, true) : "-") },
        ]}
        actions={(a) => <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(a)}>Désactiver</Button>}
      />
      {add && (
        <Modal title="Nouveau compte ACME" onClose={() => setAdd(false)}>
          <Form
            fields={[
              { name: "name", label: "Nom du compte", default: "default", required: true },
              { name: "contact", label: "Adresse mail", required: true, help: "Let's Encrypt y envoie les alertes d'expiration." },
              { name: "directory", label: "Autorité", type: "api-select", load: async () => (await pve.get<any[]>("/cluster/acme/directories")).map((d) => ({ value: d.url, label: d.name })) },
              { name: "tos", label: "J'accepte les conditions d'utilisation de l'autorité", type: "checkbox", required: true, validate: (x) => (x ? null : "Il faut accepter les conditions pour créer un compte.") },
            ]}
            submitLabel="Créer le compte"
            onCancel={() => setAdd(false)}
            onSubmit={async (_c, v) => {
              const tos = await pve.get<string>("/cluster/acme/tos", { directory: v.directory });
              const upid = await pve.post<string>("/cluster/acme/account", { name: v.name, contact: v.contact, directory: v.directory, tos_url: tos });
              if (typeof upid === "string") watch(String(upid).split(":")[1] || "pve", upid, "Création du compte ACME", list.refresh);
              setAdd(false);
              setTimeout(list.refresh, 800);
            }}
          />
        </Modal>
      )}
      {del && <Confirm title={`Désactiver le compte ${del.name} ?`} danger confirmLabel="Désactiver" onConfirm={async () => { try { await pve.del(`/cluster/acme/account/${del.name}`); setTimeout(list.refresh, 800); toast("Compte désactivé", "ok"); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDel(null)}><p>Le compte est désactivé chez l&apos;autorité. Les certificats déjà obtenus restent valides jusqu&apos;à leur expiration.</p></Confirm>}
    </Panel>
  );
}

export function AcmePlugins() {
  const { toast } = useToast();
  const { allowed } = usePermission("/", "Sys.Modify");
  const list = usePoll(() => pve.get<any[]>("/cluster/acme/plugins"), 0);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [del, setDel] = useState<any | null>(null);
  return (
    <Panel pad={false} title="Plugins de validation" right={<Button size="sm" variant="primary" disabled={!allowed} onClick={() => setEdit("new")}>Ajouter un plugin DNS</Button>}>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        rowKey={(p) => p.plugin}
        filter={false}
        columns={[
          { id: "id", header: "Nom", cell: (p) => <strong>{p.plugin}</strong> },
          { id: "type", header: "Type", cell: (p) => (p.type === "standalone" ? "HTTP (port 80 du nœud)" : "DNS") },
          { id: "api", header: "Fournisseur DNS", cell: (p) => p.api ?? "-" },
          { id: "delay", header: "Attente", cell: (p) => (p.type === "dns" ? `${p["validation-delay"] ?? 30} s` : "-") },
        ]}
        actions={(p) => (p.type === "standalone" ? null : (
          <span className="btn-group">
            <Button size="sm" disabled={!allowed} onClick={() => setEdit(p)}>Modifier</Button>
            <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(p)}>Supprimer</Button>
          </span>
        ))}
      />
      {edit && (
        <Modal title={edit === "new" ? "Nouveau plugin DNS" : `Plugin ${edit.plugin}`} wide onClose={() => setEdit(null)}>
          <Form
            fields={[
              { name: "id", label: "Nom", required: true, readOnly: edit !== "new", placeholder: "ovh" },
              { name: "api", label: "Fournisseur DNS", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/cluster/acme/challenge-schema")).filter((x) => x.type === "dns").map((x) => ({ value: x.id, label: x.name })) },
              { name: "data", label: "Identifiants de l'API", type: "code", rows: 5, full: true, required: true, placeholder: "CLE=valeur\nAUTRE_CLE=valeur", help: "Une variable par ligne, comme demandé par acme.sh pour ce fournisseur. Ils restent dans la config du cluster." },
              { name: "validation-delay", label: "Attente avant validation", type: "number", unit: "s", min: 0, max: 172800, default: 30 },
            ]}
            initial={edit === "new" ? undefined : { id: edit.plugin, api: edit.api, data: edit.data, "validation-delay": edit["validation-delay"] }}
            onCancel={() => setEdit(null)}
            onSubmit={async (_c, v) => {
              if (edit === "new") await pve.post("/cluster/acme/plugins", { id: v.id, type: "dns", api: v.api, data: v.data, "validation-delay": v["validation-delay"] });
              else await pve.put(`/cluster/acme/plugins/${edit.plugin}`, { api: v.api, data: v.data, "validation-delay": v["validation-delay"] });
              toast("Plugin enregistré", "ok");
              setEdit(null);
              list.refresh();
            }}
          />
        </Modal>
      )}
      {del && <Confirm title={`Supprimer le plugin ${del.plugin} ?`} danger confirmLabel="Supprimer" onConfirm={async () => { try { await pve.del(`/cluster/acme/plugins/${del.plugin}`); list.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDel(null)}><p>Les domaines qui l&apos;utilisent ne pourront plus renouveler leur certificat.</p></Confirm>}
    </Panel>
  );
}

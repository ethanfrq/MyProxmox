// Permissions (ACL) sur un chemin Proxmox : qui a quel rôle, avec l'héritage des parents.
import { useState } from "react";
import { Button, Confirm, Modal, Notice, useToast } from "./ui";
import { DataTable } from "./DataTable";
import { Form } from "./Form";
import { pve, usePoll } from "../lib/api";
import { usePermission } from "../lib/permissions";

interface Acl { path: string; type: "user" | "group" | "token"; ugid: string; roleid: string; propagate: number }
const TYPE: Record<string, string> = { user: "Utilisateur", group: "Groupe", token: "Jeton API" };

function parents(path: string) {
  const parts = path.split("/").filter(Boolean);
  return ["/", ...parts.map((_, i) => "/" + parts.slice(0, i + 1).join("/"))];
}

/** `path` : chemin exact (ex. /vms/101). `inherited` : affiche aussi les droits hérités des parents. */
export function AclEditor({ path, inherited = true }: { path?: string; inherited?: boolean }) {
  const { toast } = useToast();
  const acl = usePoll(() => pve.get<Acl[]>("/access/acl"), 0);
  const { allowed } = usePermission(path ?? "/", "Permissions.Modify");
  const [add, setAdd] = useState(false);
  const [del, setDel] = useState<Acl | null>(null);
  const chain = path ? parents(path) : null;
  const rows = (acl.data ?? []).filter((a) => !chain || a.path === path || (inherited && chain.includes(a.path) && a.propagate));
  return (
    <>
      <DataTable
        rows={acl.data ? rows : null}
        loading={acl.loading}
        error={acl.error}
        rowKey={(a) => `${a.path}|${a.type}|${a.ugid}|${a.roleid}`}
        initialSort={{ id: "path", dir: "asc" }}
        filter={path ? false : "Chemin, utilisateur ou rôle"}
        toolbar={<Button size="sm" variant="primary" disabled={!allowed} title={allowed ? undefined : "Il te manque le droit Permissions.Modify"} onClick={() => setAdd(true)}>Ajouter une permission</Button>}
        empty="Aucune permission particulière."
        columns={[
          { id: "path", header: "Chemin", sort: (a) => a.path, cell: (a) => <span className="mono">{a.path}{path && a.path !== path ? <span className="tag" style={{ marginLeft: 6 }}>hérité</span> : null}</span> },
          { id: "who", header: "Qui", sort: (a) => a.ugid, text: (a) => `${a.ugid} ${a.roleid} ${a.path}`, cell: (a) => <><span className="small muted">{TYPE[a.type]}</span> <strong>{a.ugid}</strong></> },
          { id: "role", header: "Rôle", sort: (a) => a.roleid, cell: (a) => a.roleid },
          { id: "prop", header: "Transmis aux sous-chemins", cell: (a) => (a.propagate ? "Oui" : "Non") },
        ]}
        actions={(a) => (!path || a.path === path ? <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(a)}>Retirer</Button> : null)}
      />
      {add && (
        <Modal title="Ajouter une permission" onClose={() => setAdd(false)}>
          <div className="stack">
            {path && <Notice>Sur <span className="mono">{path}</span>.</Notice>}
            <Form
              fields={[
                ...(path ? [] : [{ name: "path", label: "Chemin", required: true, placeholder: "/vms/101, /storage/local, /pool/lab, /" }]),
                { name: "type", label: "Pour", type: "select", default: "user", options: [{ value: "user", label: "Un utilisateur" }, { value: "group", label: "Un groupe" }, { value: "token", label: "Un jeton API" }] },
                { name: "ugid", label: "Qui", type: "api-select", required: true, loadDeps: ["type"], load: async (v) => {
                  if (v.type === "group") return (await pve.get<any[]>("/access/groups")).map((g) => ({ value: g.groupid, label: g.groupid }));
                  const users = await pve.get<any[]>("/access/users", { full: 1 });
                  if (v.type === "token") return users.flatMap((u) => (u.tokens ?? []).map((t: any) => ({ value: `${u.userid}!${t.tokenid}`, label: `${u.userid}!${t.tokenid}` })));
                  return users.map((u) => ({ value: u.userid, label: u.userid }));
                } },
                { name: "roleid", label: "Rôle", type: "api-select", required: true, load: async () => (await pve.get<any[]>("/access/roles")).map((r) => ({ value: r.roleid, label: r.roleid })) },
                { name: "propagate", label: "Transmettre aux sous-chemins", type: "checkbox", default: true },
              ]}
              onCancel={() => setAdd(false)}
              onSubmit={async (_c, v) => {
                const key = v.type === "user" ? "users" : v.type === "group" ? "groups" : "tokens";
                await pve.put("/access/acl", { path: path ?? v.path, roles: v.roleid, [key]: v.ugid, propagate: v.propagate ? 1 : 0 });
                toast("Permission ajoutée", "ok");
                setAdd(false);
                acl.refresh();
              }}
            />
          </div>
        </Modal>
      )}
      {del && (
        <Confirm title="Retirer cette permission ?" danger confirmLabel="Retirer" onConfirm={async () => {
          try {
            const key = del.type === "user" ? "users" : del.type === "group" ? "groups" : "tokens";
            await pve.put("/access/acl", { path: del.path, roles: del.roleid, [key]: del.ugid, delete: 1 });
            toast("Permission retirée", "ok");
            acl.refresh();
          } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setDel(null)}>
          <p><strong>{del.ugid}</strong> perd le rôle {del.roleid} sur <span className="mono">{del.path}</span>.</p>
        </Confirm>
      )}
    </>
  );
}

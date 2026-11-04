// Abonnement Proxmox : saisie, vérification et retrait de la clé.
import { useState } from "react";
import { Button, Confirm, Notice, Panel, useToast } from "../../components/ui";
import { Form } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { date } from "../../../../shared/format";

export function NodeSubscription({ node }: { node: string }) {
  const { toast } = useToast();
  const sub = usePoll(() => pve.get<any>(`/nodes/${node}/subscription`), 0, [node]);
  const { allowed } = usePermission(`/nodes/${node}`, "Sys.Modify");
  const [del, setDel] = useState(false);
  const s = sub.data;
  const active = s?.status === "active";
  return (
    <div className="grid g2">
      <Panel title="Abonnement">
        {s ? (
          <div className="stack">
            {active ? <Notice kind="ok">Abonnement actif : tu as accès au dépôt entreprise et au support Proxmox.</Notice> : <Notice>Pas d&apos;abonnement. C&apos;est normal pour un homelab : utilise le dépôt « no-subscription » (onglet Mises à jour) pour recevoir les mises à jour.</Notice>}
            <div className="kv">
              <div>État</div><div>{active ? "Actif" : s.status === "notfound" ? "Aucune clé" : s.status}</div>
              {s.productname && <><div>Produit</div><div>{s.productname}</div></>}
              {s.key && <><div>Clé</div><div className="mono">{s.key}</div></>}
              {s.nextduedate && <><div>Échéance</div><div>{s.nextduedate}</div></>}
              {s.checktime && <><div>Dernière vérification</div><div>{date(s.checktime, true)}</div></>}
              <div>Identifiant du serveur</div><div className="mono small">{s.serverid}</div>
            </div>
            {active && (
              <div className="row">
                <Button disabled={!allowed} onClick={async () => { try { await pve.post(`/nodes/${node}/subscription`, { force: 1 }); toast("Abonnement vérifié", "ok"); sub.refresh(); } catch (e) { toast((e as Error).message, "error"); } }}>Vérifier maintenant</Button>
                <Button variant="danger" disabled={!allowed} onClick={() => setDel(true)}>Retirer la clé</Button>
              </div>
            )}
          </div>
        ) : <span className="muted">{sub.error ?? "Chargement…"}</span>}
      </Panel>
      <Panel title={active ? "Changer de clé" : "Saisir une clé"}>
        <Form
          fields={[{ name: "key", label: "Clé d'abonnement", required: true, placeholder: "pve2c-0123456789", help: "Elle se trouve dans ton espace client Proxmox. La clé est vérifiée en ligne par Proxmox." }]}
          submitLabel="Enregistrer la clé"
          onSubmit={async (v) => {
            await pve.put(`/nodes/${node}/subscription`, { key: String(v.key).trim() });
            toast("Clé enregistrée", "ok");
            sub.refresh();
          }}
        />
      </Panel>
      {del && <Confirm title="Retirer la clé d'abonnement ?" danger confirmLabel="Retirer" onConfirm={async () => { try { await pve.del(`/nodes/${node}/subscription`); sub.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setDel(false)}><p>Le dépôt entreprise ne fonctionnera plus sur ce nœud.</p></Confirm>}
    </div>
  );
}

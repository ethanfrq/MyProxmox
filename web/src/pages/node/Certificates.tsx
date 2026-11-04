// Certificats du nœud : liste, certificat personnalisé, ACME (domaines, commande, renouvellement).
import { useState } from "react";
import { Button, Confirm, Modal, Notice, Panel, Tabs, useToast } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { Form } from "../../components/Form";
import { AcmeAccounts, AcmePlugins } from "../../components/Acme";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { date } from "../../../../shared/format";
import { parseProps } from "../machine/common";

export function NodeCertificates({ node }: { node: string }) {
  const { toast, watch } = useToast();
  const { allowed } = usePermission(`/nodes/${node}`, "Sys.Modify");
  const certs = usePoll(() => pve.get<any[]>(`/nodes/${node}/certificates/info`), 0, [node]);
  const cfg = usePoll(() => pve.get<Record<string, string>>(`/nodes/${node}/config`), 0, [node]);
  const [sub, setSub] = useState<"certs" | "acme">("certs");
  const [upload, setUpload] = useState(false);
  const [domain, setDomain] = useState<{ key: string; value?: string } | null>(null);
  const [confirm, setConfirm] = useState<"custom" | "revoke" | { key: string } | null>(null);
  const c = cfg.data ?? {};
  const domains = Object.entries(c).filter(([k]) => /^acmedomain\d+$/.test(k)).map(([k, v]): Record<string, string> => ({ key: k, ...parseProps(v, "domain") }));
  const account = parseProps(c.acme ?? "", "account").account ?? "default";
  const hasCustom = (certs.data ?? []).some((x) => x.filename === "pveproxy-ssl.pem");
  const order = async (method: "post" | "put") => {
    try {
      const upid = method === "post" ? await pve.post<string>(`/nodes/${node}/certificates/acme/certificate`) : await pve.put<string>(`/nodes/${node}/certificates/acme/certificate`, { force: 1 });
      watch(node, upid, method === "post" ? "Commande du certificat" : "Renouvellement du certificat", certs.refresh);
    } catch (e) { toast(`${(e as Error).message}. Vérifie les domaines et le compte ACME.`, "error"); }
  };
  const nextFree = () => { for (let i = 0; i < 6; i++) if (!c[`acmedomain${i}`]) return `acmedomain${i}`; return "acmedomain5"; };

  return (
    <>
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "certs", label: "Certificats du nœud" }, { id: "acme", label: "Comptes et plugins ACME" }]} />
      {sub === "certs" ? (
        <div className="stack">
          <Panel pad={false} title="Certificats" right={
            <span className="row">
              <Button size="sm" disabled={!allowed} onClick={() => setUpload(true)}>Téléverser un certificat</Button>
              {hasCustom && <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setConfirm("custom")}>Supprimer le certificat personnalisé</Button>}
            </span>
          }>
            <DataTable
              rows={certs.data}
              loading={certs.loading}
              rowKey={(x) => x.filename}
              filter={false}
              columns={[
                { id: "file", header: "Fichier", cell: (x) => <span className="mono">{x.filename}</span> },
                { id: "subject", header: "Sujet", cell: (x) => <span className="small mono">{x.subject}</span> },
                { id: "issuer", header: "Émetteur", cell: (x) => <span className="small">{String(x.issuer).replace(/^.*CN=/, "")}</span> },
                { id: "san", header: "Noms couverts", cell: (x) => <span className="small mono">{(x.san ?? []).join(", ")}</span> },
                { id: "exp", header: "Expire le", sort: (x) => x.notafter, cell: (x) => { const d = Math.floor((x.notafter - Date.now() / 1000) / 86400); return <span className={d < 14 ? "health-bad" : ""}>{date(x.notafter, true)}<div className="small muted">dans {d} j</div></span>; } },
              ]}
            />
          </Panel>
          <Panel pad={false} title="Certificat ACME (Let's Encrypt)" right={
            <span className="row">
              <Button size="sm" disabled={!allowed} onClick={() => setDomain({ key: nextFree() })}>Ajouter un domaine</Button>
              <Button size="sm" variant="primary" disabled={!allowed || !domains.length} onClick={() => order("post")}>Commander le certificat</Button>
              <Button size="sm" disabled={!allowed || !domains.length || !hasCustom} onClick={() => order("put")}>Renouveler</Button>
              <Button size="sm" variant="danger" disabled={!allowed || !hasCustom} onClick={() => setConfirm("revoke")}>Révoquer</Button>
            </span>
          }>
            <div style={{ padding: "12px 16px 0" }}>
              <p className="small muted" style={{ margin: 0 }}>Compte utilisé : <strong>{account}</strong>. Proxmox renouvelle tout seul le certificat avant expiration. Le type « HTTP » demande que le port 80 du nœud soit joignable depuis Internet ; le type « DNS » passe par ton fournisseur DNS.</p>
            </div>
            <DataTable
              rows={cfg.data ? domains : null}
              rowKey={(d) => d.key}
              filter={false}
              empty="Aucun domaine. Ajoute le nom public du nœud, par exemple pve.exemple.fr."
              columns={[
                { id: "domain", header: "Domaine", cell: (d) => <strong className="mono">{d.domain}</strong> },
                { id: "type", header: "Validation", cell: (d) => (d.plugin ? `DNS (${d.plugin})` : "HTTP") },
                { id: "alias", header: "Alias", cell: (d) => d.alias ?? "" },
              ]}
              actions={(d) => (
                <span className="btn-group">
                  <Button size="sm" disabled={!allowed} onClick={() => setDomain({ key: d.key, value: c[d.key] })}>Modifier</Button>
                  <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setConfirm({ key: d.key })}>Retirer</Button>
                </span>
              )}
            />
          </Panel>
        </div>
      ) : (
        <div className="stack"><AcmeAccounts /><AcmePlugins /></div>
      )}

      {upload && (
        <Modal title="Téléverser un certificat personnalisé" wide onClose={() => setUpload(false)}>
          <div className="stack">
            <Notice>Il remplace le certificat auto-signé de l&apos;interface web (pveproxy). Colle le certificat au format PEM, chaîne comprise, et sa clé privée.</Notice>
            <Form
              fields={[
                { name: "certificates", label: "Certificat (et chaîne)", type: "code", rows: 6, required: true, placeholder: "-----BEGIN CERTIFICATE-----" },
                { name: "key", label: "Clé privée", type: "code", rows: 5, placeholder: "-----BEGIN PRIVATE KEY-----", help: "Vide : la clé actuelle est gardée." },
                { name: "restart", label: "Redémarrer l'interface web pour l'utiliser tout de suite", type: "checkbox", default: true },
                { name: "force", label: "Remplacer un certificat personnalisé existant", type: "checkbox", default: true },
              ]}
              submitLabel="Téléverser"
              onCancel={() => setUpload(false)}
              onSubmit={async (_c, v) => {
                await pve.post(`/nodes/${node}/certificates/custom`, { certificates: v.certificates, key: v.key || undefined, restart: v.restart ? 1 : 0, force: v.force ? 1 : 0 });
                toast("Certificat installé", "ok");
                setUpload(false);
                certs.refresh();
              }}
            />
          </div>
        </Modal>
      )}
      {domain && (
        <Modal title={domain.value ? "Modifier le domaine" : "Ajouter un domaine"} onClose={() => setDomain(null)}>
          <Form
            fields={[
              { name: "domain", label: "Domaine", required: true, placeholder: "pve.exemple.fr" },
              { name: "type", label: "Validation", type: "select", default: "http", options: [{ value: "http", label: "HTTP (port 80 ouvert sur Internet)" }, { value: "dns", label: "DNS (plugin)" }] },
              { name: "plugin", label: "Plugin DNS", type: "api-select", required: true, show: (v) => v.type === "dns", load: async () => (await pve.get<any[]>("/cluster/acme/plugins", { type: "dns" })).map((p) => ({ value: p.plugin, label: p.plugin })) },
              { name: "alias", label: "Alias de validation", advanced: true, show: (v) => v.type === "dns" },
            ]}
            initial={domain.value ? (() => { const p = parseProps(domain.value, "domain"); return { domain: p.domain, type: p.plugin ? "dns" : "http", plugin: p.plugin, alias: p.alias }; })() : undefined}
            onCancel={() => setDomain(null)}
            onSubmit={async (_c, v) => {
              const value = [`domain=${v.domain}`, v.type === "dns" && v.plugin ? `plugin=${v.plugin}` : "", v.type === "dns" && v.alias ? `alias=${v.alias}` : ""].filter(Boolean).join(",");
              await pve.put(`/nodes/${node}/config`, { [domain.key]: value, ...(c.acme ? {} : { acme: "account=default" }) });
              toast("Domaine enregistré", "ok");
              setDomain(null);
              cfg.refresh();
            }}
          />
        </Modal>
      )}
      {confirm === "custom" && <Confirm title="Supprimer le certificat personnalisé ?" danger confirmLabel="Supprimer" onConfirm={async () => { try { await pve.del(`/nodes/${node}/certificates/custom`, { restart: 1 }); certs.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setConfirm(null)}><p>L&apos;interface web revient au certificat auto-signé de Proxmox : les navigateurs afficheront de nouveau un avertissement.</p></Confirm>}
      {confirm === "revoke" && <Confirm title="Révoquer le certificat ACME ?" danger confirmLabel="Révoquer" onConfirm={async () => { try { const upid = await pve.del<string>(`/nodes/${node}/certificates/acme/certificate`); watch(node, upid, "Révocation", certs.refresh); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setConfirm(null)}><p>Le certificat est déclaré invalide auprès de l&apos;autorité et retiré du nœud.</p></Confirm>}
      {confirm && typeof confirm === "object" && <Confirm title="Retirer ce domaine ?" confirmLabel="Retirer" onConfirm={async () => { try { await pve.put(`/nodes/${node}/config`, { delete: confirm.key }); cfg.refresh(); } catch (e) { toast((e as Error).message, "error"); } }} onClose={() => setConfirm(null)}><p>Il ne sera plus inclus au prochain renouvellement.</p></Confirm>}
    </>
  );
}

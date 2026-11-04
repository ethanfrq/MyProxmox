// Migration (en ligne ou hors ligne), clonage (complet ou lié, vers un autre nœud),
// conversion en modèle. Utilisés dans la fiche machine et pour les actions groupées.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Confirm, Modal, Notice, useToast } from "../../components/ui";
import { Form, type FieldDef } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { nodesList, storagesFor, type GuestCtx } from "./common";

export function MigrateDialog({ ctx, onClose }: { ctx: GuestCtx; onClose: () => void }) {
  const { watch } = useToast();
  const navigate = useNavigate();
  const pre = usePoll(() => pve.get<any>(`${ctx.base}/migrate`), 0, [ctx.base]);
  const p = pre.data;
  const q = ctx.type === "qemu";
  const allowed: string[] = p?.allowed_nodes ?? [];
  const fields: FieldDef[] = [
    { name: "target", label: "Nœud cible", type: "select", required: true, options: allowed.map((n) => ({ value: n, label: n })), default: allowed[0] },
    ...(q && ctx.running ? [{ name: "online", label: "Migration à chaud (la VM reste allumée)", type: "checkbox" as const, default: true }] : []),
    ...(!q && ctx.running ? [{ name: "restart", label: "Redémarrer le conteneur sur le nœud cible (coupure de quelques secondes)", type: "checkbox" as const, default: true, required: true }] : []),
    ...(q && p?.local_disks?.length ? [{ name: "with-local-disks", label: "Copier aussi les disques locaux", type: "checkbox" as const, default: true }] : []),
    { name: "targetstorage", label: "Stockage cible des disques", type: "api-select", allowEmpty: "Même nom de stockage", load: (v) => storagesFor(String(v.target || ctx.node), q ? "images" : "rootdir")(), loadDeps: ["target"] },
    { name: "bwlimit", label: "Limite de débit", type: "number", unit: "Kio/s", advanced: true },
  ];
  return (
    <Modal title={`Migrer ${ctx.name}`} onClose={onClose}>
      {!p ? <div className="empty">{pre.error ?? "Vérification…"}</div> : !allowed.length ? (
        <Notice kind="warn">Aucun autre nœud disponible. La migration demande un cluster d&apos;au moins deux nœuds en ligne.</Notice>
      ) : (
        <div className="stack">
          {p.local_resources?.length > 0 && <Notice kind="warn">Ressources locales attachées ({p.local_resources.join(", ")}) : la migration à chaud est impossible tant qu&apos;elles sont branchées, sauf si elles passent par un mappage du datacenter.</Notice>}
          {p.local_disks?.length > 0 && <p className="small muted" style={{ margin: 0 }}>Disques locaux : {p.local_disks.map((d: any) => d.volid).join(", ")}. Ils seront copiés, ce qui peut prendre du temps.</p>}
          {!q && ctx.running && <p className="small muted" style={{ margin: 0 }}>Les conteneurs ne migrent pas à chaud : ils sont redémarrés sur le nœud cible.</p>}
          <Form
            fields={fields}
            submitLabel="Migrer"
            onCancel={onClose}
            onSubmit={async (_c, v) => {
              const upid = await pve.post<string>(`${ctx.base}/migrate`, {
                target: v.target, online: q && v.online ? 1 : undefined, restart: !q && v.restart ? 1 : undefined,
                "with-local-disks": v["with-local-disks"] ? 1 : undefined, targetstorage: v.targetstorage || undefined, bwlimit: v.bwlimit || undefined,
              });
              watch(ctx.node, upid, `Migration de ${ctx.name} vers ${v.target}`, () => navigate(`/machines/${v.target}/${ctx.type}/${ctx.vmid}`, { replace: true }));
              onClose();
            }}
          />
        </div>
      )}
    </Modal>
  );
}

export function CloneDialog({ ctx, onClose, title }: { ctx: GuestCtx; onClose: () => void; title?: string }) {
  const { watch } = useToast();
  const navigate = useNavigate();
  const template = ctx.conf.template === "1";
  const nextid = usePoll(() => pve.get<string>("/cluster/nextid"), 0);
  const q = ctx.type === "qemu";
  if (!nextid.data) return <Modal title="Cloner" onClose={onClose}><div className="empty">Chargement…</div></Modal>;
  const fields: FieldDef[] = [
    { name: "newid", label: "ID de la nouvelle machine", type: "number", min: 100, required: true, default: Number(nextid.data) },
    { name: "name", label: q ? "Nom" : "Nom d'hôte", required: true, default: template ? "" : `${ctx.name}-copie`, validate: (x) => (/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(String(x)) ? null : "Lettres, chiffres, point et tiret.") },
    { name: "target", label: "Nœud", type: "api-select", load: nodesList(), default: ctx.node },
    ...(template ? [{ name: "full", label: "Type de copie", type: "select" as const, default: "0", options: [{ value: "0", label: "Clone lié (instantané, partage les disques du modèle)" }, { value: "1", label: "Clone complet (copie indépendante)" }] }] : []),
    { name: "storage", label: "Stockage", type: "api-select", allowEmpty: "Même stockage que l'original", load: (v) => storagesFor(String(v.target || ctx.node), q ? "images" : "rootdir")(), loadDeps: ["target"], show: (v) => !template || v.full === "1" },
    { name: "pool", label: "Pool", type: "api-select", allowEmpty: "Aucun", load: async () => (await pve.get<any[]>("/pools")).map((x) => ({ value: x.poolid, label: x.poolid })), advanced: true },
    { name: "description", label: "Description", type: "textarea", rows: 2, advanced: true },
  ];
  return (
    <Modal title={title ?? (template ? `Nouvelle machine depuis ${ctx.name}` : `Cloner ${ctx.name}`)} onClose={onClose}>
      <div className="stack">
        {!template && ctx.running && <p className="small muted" style={{ margin: 0 }}>La machine est allumée : la copie reprend l&apos;état de ses disques à cet instant.</p>}
        <Form
          fields={fields}
          submitLabel={template ? "Créer" : "Cloner"}
          onCancel={onClose}
          onSubmit={async (_c, v) => {
            const upid = await pve.post<string>(`${ctx.base}/clone`, {
              newid: v.newid, [q ? "name" : "hostname"]: v.name, target: v.target !== ctx.node ? v.target : undefined,
              full: template ? Number(v.full) : 1, storage: v.storage || undefined, pool: v.pool || undefined, description: v.description || undefined,
            });
            watch(ctx.node, upid, `Clonage vers ${v.newid}`, () => navigate(`/machines/${v.target || ctx.node}/${ctx.type}/${v.newid}`));
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}

/** Bouton « Plus » de la fiche machine : migrer, cloner, convertir en modèle. */
export function MoreActions({ ctx }: { ctx: GuestCtx }) {
  const { toast, watch } = useToast();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"migrate" | "clone" | "template" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const can = (p: string) => usePermission(`/vms/${ctx.vmid}`, p).allowed; // eslint-disable-line react-hooks/rules-of-hooks
  const canMigrate = can("VM.Migrate");
  const canClone = can("VM.Clone");
  const canAlloc = can("VM.Allocate");
  const template = ctx.conf.template === "1";
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const item = (label: string, on: boolean, fn: () => void, why: string) => (
    <button type="button" role="menuitem" disabled={!on} title={on ? undefined : why} onClick={() => { setOpen(false); fn(); }}>{label}</button>
  );
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button aria-expanded={open} onClick={() => setOpen((o) => !o)}>Plus ▾</Button>
      {open && (
        <div className="ctx-menu" role="menu" style={{ position: "absolute", right: 0, top: 38 }}>
          {item("Migrer vers un autre nœud", canMigrate, () => setDialog("migrate"), "Il te manque le droit VM.Migrate")}
          {item(template ? "Créer une machine depuis ce modèle" : "Cloner", canClone, () => setDialog("clone"), "Il te manque le droit VM.Clone")}
          {!template && item("Convertir en modèle", canAlloc && !ctx.running, () => setDialog("template"), ctx.running ? "Éteins d'abord la machine" : "Il te manque le droit VM.Allocate")}
        </div>
      )}
      {dialog === "migrate" && <MigrateDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === "clone" && <CloneDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === "template" && (
        <Confirm title={`Convertir ${ctx.name} en modèle ?`} danger requireText={String(ctx.vmid)} confirmLabel="Convertir" onConfirm={async () => {
          try {
            const upid = await pve.post(`${ctx.base}/template`);
            if (typeof upid === "string" && upid.startsWith("UPID")) watch(ctx.node, upid, "Conversion en modèle", ctx.refresh);
            else { toast("Machine convertie en modèle", "ok"); ctx.refresh(); }
          } catch (e) { toast((e as Error).message, "error"); }
        }} onClose={() => setDialog(null)}>
          <p>Un modèle ne démarre plus : il sert de base pour créer des machines (clones liés ou complets). <strong>Ça ne se défait pas.</strong></p>
        </Confirm>
      )}
    </div>
  );
}


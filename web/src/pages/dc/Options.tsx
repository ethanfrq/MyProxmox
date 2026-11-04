// Options du datacenter (datacenter.cfg).
import { Empty, Panel, useToast } from "../../components/ui";
import { Form, type FieldDef, type Values } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { joinProps, parseProps } from "../machine/common";

const KEYBOARDS = ["", "fr", "fr-be", "fr-ca", "fr-ch", "de", "de-ch", "en-us", "en-gb", "es", "it", "pt", "nl", "sv", "da", "fi", "no", "pl", "tr", "ja"];

const FIELDS: FieldDef[] = [
  { name: "keyboard", label: "Clavier de la console", type: "select", options: KEYBOARDS.map((k) => ({ value: k, label: k || "Par défaut (navigateur)" })) },
  { name: "console", label: "Console par défaut", type: "select", options: [{ value: "", label: "Par défaut (noVNC)" }, { value: "html5", label: "noVNC (HTML5)" }, { value: "xtermjs", label: "xterm.js" }, { value: "vv", label: "SPICE (virt-viewer)" }] },
  { name: "language", label: "Langue de l'interface Proxmox", type: "select", options: [{ value: "", label: "Par défaut" }, { value: "fr", label: "Français" }, { value: "en", label: "Anglais" }, { value: "de", label: "Allemand" }] },
  { name: "email_from", label: "Adresse d'envoi des mails", placeholder: "proxmox@exemple.fr" },
  { name: "http_proxy", label: "Proxy HTTP", placeholder: "http://proxy.lan:3128", help: "Pour apt et les téléchargements de Proxmox." },
  { name: "mac_prefix", label: "Préfixe des adresses MAC", placeholder: "BC:24:11" },
  { name: "mig_type", label: "Migration : chiffrement", type: "select", options: [{ value: "", label: "Par défaut (sécurisée)" }, { value: "secure", label: "Sécurisée (SSH)" }, { value: "insecure", label: "Non chiffrée (plus rapide, réseau de confiance)" }] },
  { name: "mig_network", label: "Migration : réseau dédié", type: "cidr", help: "Vide : le réseau du cluster." },
  { name: "bw_default", label: "Limite de débit par défaut", type: "number", unit: "Kio/s", advanced: true },
  { name: "bw_migration", label: "Limite pour les migrations", type: "number", unit: "Kio/s", advanced: true },
  { name: "bw_restore", label: "Limite pour les restaurations", type: "number", unit: "Kio/s", advanced: true },
  { name: "bw_clone", label: "Limite pour les clonages", type: "number", unit: "Kio/s", advanced: true },
  { name: "bw_move", label: "Limite pour les déplacements de disque", type: "number", unit: "Kio/s", advanced: true },
  { name: "max_workers", label: "Tâches en parallèle (tout démarrer, tout migrer)", type: "number", min: 1, max: 64, advanced: true },
  { name: "ha_policy", label: "HA : à l'arrêt d'un nœud", type: "select", advanced: true, options: [{ value: "", label: "Par défaut (conditionnel)" }, { value: "freeze", label: "Geler les ressources" }, { value: "failover", label: "Basculer les ressources" }, { value: "migrate", label: "Migrer les ressources" }, { value: "conditional", label: "Conditionnel" }] },
  { name: "nextid_lower", label: "ID libre proposé à partir de", type: "number", min: 100, advanced: true },
  { name: "nextid_upper", label: "ID libre proposé jusqu'à", type: "number", advanced: true },
  { name: "tag_shape", label: "Forme des tags", type: "select", advanced: true, options: [{ value: "", label: "Par défaut" }, { value: "full", label: "Pleine" }, { value: "circle", label: "Cercle" }, { value: "dense", label: "Dense" }, { value: "none", label: "Aucune" }] },
  { name: "tag_ordering", label: "Ordre des tags", type: "select", advanced: true, options: [{ value: "", label: "Par défaut" }, { value: "config", label: "Ordre de la configuration" }, { value: "alphabetical", label: "Alphabétique" }] },
  { name: "registered-tags", label: "Tags réservés aux administrateurs", type: "tags", advanced: true, full: true },
  { name: "description", label: "Notes du datacenter", type: "textarea", rows: 3, full: true, advanced: true },
];

function toValues(o: Record<string, any>): Values {
  const mig = parseProps(o.migration ?? "", "type");
  const bw = parseProps(o.bwlimit ?? "", "_");
  const nid = parseProps(o["next-id"] ?? "", "_");
  const tag = parseProps(o["tag-style"] ?? "", "_");
  const ha = parseProps(o.ha ?? "", "_");
  return {
    keyboard: o.keyboard ?? "", console: o.console ?? "", language: o.language ?? "", email_from: o.email_from ?? "", http_proxy: o.http_proxy ?? "", mac_prefix: o.mac_prefix ?? "",
    mig_type: mig.type ?? "", mig_network: mig.network ?? "", bw_default: bw.default ?? "", bw_migration: bw.migration ?? "", bw_restore: bw.restore ?? "", bw_clone: bw.clone ?? "", bw_move: bw.move ?? "",
    max_workers: o.max_workers ?? "", ha_policy: ha.shutdown_policy ?? "", nextid_lower: nid.lower ?? "", nextid_upper: nid.upper ?? "", tag_shape: tag.shape ?? "", tag_ordering: tag.ordering ?? "",
    "registered-tags": o["registered-tags"] ?? "", description: o.description ?? "",
  };
}

export function DcOptions() {
  const { toast } = useToast();
  const { allowed } = usePermission("/", "Sys.Modify");
  const opts = usePoll(() => pve.get<Record<string, any>>("/cluster/options"), 0);
  if (!opts.data) return <Empty>{opts.error ?? "Chargement…"}</Empty>;
  return (
    <Panel title="Options du datacenter">
      <Form
        key={JSON.stringify(opts.data)}
        fields={FIELDS.map((f) => ({ ...f, readOnly: !allowed }))}
        initial={toValues(opts.data)}
        submitLabel="Enregistrer les options"
        onSubmit={async (_c, v) => {
          const o = opts.data!;
          const out: Record<string, unknown> = {};
          const del: string[] = [];
          const set = (k: string, val: unknown) => { if (val === "" || val === undefined) { if (o[k] !== undefined) del.push(k); } else out[k] = val; };
          for (const k of ["keyboard", "console", "language", "email_from", "http_proxy", "mac_prefix", "max_workers", "description"]) set(k, v[k]);
          set("migration", v.mig_type || v.mig_network ? joinProps({ type: v.mig_type || "secure", network: v.mig_network }, "type") : "");
          set("bwlimit", joinProps({ default: v.bw_default, migration: v.bw_migration, restore: v.bw_restore, clone: v.bw_clone, move: v.bw_move }, "_none"));
          set("ha", v.ha_policy ? `shutdown_policy=${v.ha_policy}` : "");
          set("next-id", joinProps({ lower: v.nextid_lower, upper: v.nextid_upper }, "_none"));
          set("tag-style", joinProps({ shape: v.tag_shape, ordering: v.tag_ordering }, "_none"));
          set("registered-tags", (Array.isArray(v["registered-tags"]) ? v["registered-tags"] : String(v["registered-tags"] ?? "").split(/[;,\s]+/)).filter(Boolean).join(";"));
          if (del.length) out.delete = del.join(",");
          await pve.put("/cluster/options", out);
          toast("Options enregistrées", "ok");
          opts.refresh();
        }}
      />
    </Panel>
  );
}

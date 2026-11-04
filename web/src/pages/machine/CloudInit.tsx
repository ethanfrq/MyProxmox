// Onglet « Cloud-Init » (VM) : utilisateur, mot de passe, clés SSH, IP, DNS, régénération de l'image.
import { useState } from "react";
import { Button, Modal, Notice, Panel, useToast } from "../../components/ui";
import { Form, type FieldDef } from "../../components/Form";
import { pve } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { parseProps, type GuestCtx } from "./common";
import { cloudinitDrive, type Spec } from "./specs";
import { SpecDialog } from "./SpecDialog";

export function CloudInit({ ctx }: { ctx: GuestCtx }) {
  const { toast } = useToast();
  const c = ctx.conf;
  const { allowed } = usePermission(`/vms/${ctx.vmid}`, "VM.Config.Cloudinit");
  const drive = Object.entries(c).find(([, v]) => /cloudinit/.test(v));
  const [spec, setSpec] = useState<Spec | null>(null);
  const [dump, setDump] = useState<{ type: string; text: string } | null>(null);
  const nets = Object.keys(c).filter((k) => /^net\d+$/.test(k)).sort();

  if (!drive) {
    return (
      <Panel title="Cloud-Init">
        <div className="stack">
          <Notice>Cloud-Init configure une VM au premier démarrage (utilisateur, clés SSH, adresse IP). Il faut une image compatible (images « cloud » de Debian, Ubuntu...) et un lecteur Cloud-Init.</Notice>
          <div><Button variant="primary" disabled={!allowed} onClick={() => setSpec(cloudinitDrive(ctx))}>Ajouter un lecteur Cloud-Init</Button></div>
        </div>
        {spec && <SpecDialog ctx={ctx} spec={spec} onClose={() => setSpec(null)} />}
      </Panel>
    );
  }

  const fields: FieldDef[] = [
    { name: "ciuser", label: "Utilisateur", placeholder: "Celui de l'image si vide" },
    { name: "cipassword", label: "Mot de passe", type: "password", help: c.cipassword ? "Un mot de passe est déjà défini. Vide : on le garde." : "Vide : connexion par clé SSH seulement." },
    { name: "sshkeys", label: "Clés SSH publiques", type: "code", rows: 4, full: true, help: "Une clé par ligne." },
    ...nets.flatMap((n): FieldDef[] => {
      const i = n.slice(3);
      return [
        { name: `ip4mode${i}`, label: `IPv4 (${n})`, type: "select", options: [{ value: "dhcp", label: "DHCP" }, { value: "static", label: "Fixe" }, { value: "", label: "Aucune" }] },
        { name: `ip${i}`, label: `Adresse (${n})`, type: "cidr", show: (v) => v[`ip4mode${i}`] === "static", required: true },
        { name: `gw${i}`, label: `Passerelle (${n})`, placeholder: "10.0.1.1", show: (v) => v[`ip4mode${i}`] === "static" },
        { name: `ip6mode${i}`, label: `IPv6 (${n})`, type: "select", advanced: true, options: [{ value: "", label: "Aucune" }, { value: "dhcp", label: "DHCPv6" }, { value: "auto", label: "SLAAC" }, { value: "static", label: "Fixe" }] },
        { name: `ip6${i}`, label: `Adresse IPv6 (${n})`, type: "cidr", advanced: true, show: (v) => v[`ip6mode${i}`] === "static" },
      ];
    }),
    { name: "searchdomain", label: "Domaine de recherche", placeholder: "Celui du serveur si vide" },
    { name: "nameserver", label: "Serveurs DNS", placeholder: "Ceux du serveur si vide" },
    { name: "ciupgrade", label: "Mettre à jour les paquets au premier démarrage", type: "checkbox", advanced: true },
    { name: "citype", label: "Format", type: "select", advanced: true, options: [{ value: "", label: "Automatique" }, { value: "nocloud", label: "NoCloud (Linux)" }, { value: "configdrive2", label: "ConfigDrive2 (Windows, cloudbase-init)" }, { value: "opennebula", label: "OpenNebula" }] },
  ];
  const initial: Record<string, unknown> = {
    ciuser: c.ciuser ?? "", cipassword: "", sshkeys: decodeURIComponent(c.sshkeys ?? ""), searchdomain: c.searchdomain ?? "", nameserver: c.nameserver ?? "",
    ciupgrade: c.ciupgrade !== "0", citype: c.citype ?? "",
  };
  for (const n of nets) {
    const i = n.slice(3);
    const p = parseProps(c[`ipconfig${i}`] ?? "", "_");
    initial[`ip4mode${i}`] = p.ip === "dhcp" ? "dhcp" : p.ip ? "static" : "";
    initial[`ip${i}`] = p.ip && p.ip !== "dhcp" ? p.ip : "";
    initial[`gw${i}`] = p.gw ?? "";
    initial[`ip6mode${i}`] = ["dhcp", "auto"].includes(p.ip6) ? p.ip6 : p.ip6 ? "static" : "";
    initial[`ip6${i}`] = p.ip6 && !["dhcp", "auto"].includes(p.ip6) ? p.ip6 : "";
  }

  return (
    <div className="grid g2">
      <Panel title="Paramètres Cloud-Init">
        <Form
          fields={fields}
          initial={initial}
          onSubmit={async (_clean, v) => {
            const body: Record<string, unknown> = {};
            const del: string[] = [];
            const setOrDel = (k: string, val: unknown) => {
              if (val === undefined || val === "") { if (c[k] !== undefined) del.push(k); } else body[k] = val;
            };
            setOrDel("ciuser", v.ciuser);
            if (v.cipassword) body.cipassword = v.cipassword;
            setOrDel("sshkeys", v.sshkeys ? encodeURIComponent(String(v.sshkeys).trim()) : "");
            setOrDel("searchdomain", v.searchdomain);
            setOrDel("nameserver", v.nameserver);
            setOrDel("citype", v.citype);
            body.ciupgrade = v.ciupgrade ? 1 : 0;
            for (const n of nets) {
              const i = n.slice(3);
              const parts = [
                v[`ip4mode${i}`] === "dhcp" ? "ip=dhcp" : v[`ip4mode${i}`] === "static" ? `ip=${v[`ip${i}`]}${v[`gw${i}`] ? `,gw=${v[`gw${i}`]}` : ""}` : "",
                v[`ip6mode${i}`] === "static" ? `ip6=${v[`ip6${i}`]}` : v[`ip6mode${i}`] ? `ip6=${v[`ip6mode${i}`]}` : "",
              ].filter(Boolean).join(",");
              setOrDel(`ipconfig${i}`, parts);
            }
            if (del.length) body.delete = del.join(",");
            await pve.put(`${ctx.base}/config`, body);
            toast("Cloud-Init enregistré. Régénère l'image pour l'appliquer.", "ok");
            ctx.refresh();
          }}
        />
      </Panel>
      <div className="stack">
        <Panel title="Image Cloud-Init">
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>Lecteur <span className="mono">{drive[0]}</span> : {drive[1].split(",")[0]}. Les changements sont lus au prochain démarrage de la VM.</p>
            <div className="row">
              <Button variant="primary" disabled={!allowed} onClick={async () => {
                try {
                  await pve.put(`${ctx.base}/cloudinit`);
                  toast("Image Cloud-Init régénérée", "ok");
                } catch (e) { toast((e as Error).message, "error"); }
              }}>Régénérer l&apos;image</Button>
              {(["user", "network", "meta"] as const).map((t) => (
                <Button key={t} onClick={async () => setDump({ type: t, text: String(await pve.get(`${ctx.base}/cloudinit/dump`, { type: t })) })}>
                  Voir {t === "user" ? "user-data" : t === "network" ? "network-config" : "meta-data"}
                </Button>
              ))}
            </div>
          </div>
        </Panel>
      </div>
      {dump && <Modal title={`Configuration générée (${dump.type})`} wide onClose={() => setDump(null)} foot={<Button onClick={() => setDump(null)}>Fermer</Button>}><pre className="code">{dump.text}</pre></Modal>}
    </div>
  );
}

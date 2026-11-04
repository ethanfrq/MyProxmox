// Pare-feu Proxmox, commun à une machine, un nœud et au datacenter :
// règles (ajout, édition, ordre par glisser-déposer, activation), options, alias, IPsets, journal.
import { useState } from "react";
import { Button, Confirm, Empty, Modal, Panel, Tabs, Toggle, useToast } from "./ui";
import { DataTable } from "./DataTable";
import { Form, type FieldDef, type Values } from "./Form";
import { I } from "./icons";
import { pve, usePoll } from "../lib/api";
import { usePermission } from "../lib/permissions";

export type FwScope = "vm" | "node" | "cluster";

const MACROS = ["", "SSH", "HTTP", "HTTPS", "DNS", "Ping", "SMB", "NFS", "SMTP", "IMAP", "IMAPS", "POP3S", "NTP", "SNMP", "RDP", "VNC", "MySQL", "PostgreSQL", "Ceph", "Web", "BitTorrent", "Telnet", "Syslog", "OpenVPN", "DHCPfwd", "DHCPv6", "Squid"];
const LOG = [{ value: "", label: "Aucun" }, { value: "info", label: "info" }, { value: "notice", label: "notice" }, { value: "warning", label: "warning" }, { value: "err", label: "err" }, { value: "crit", label: "crit" }, { value: "debug", label: "debug" }, { value: "nolog", label: "nolog" }];
const ACTION_CLASS: Record<string, string> = { ACCEPT: "on", DROP: "err", REJECT: "warn" };

function ruleFields(scope: FwScope, groups: string[]): FieldDef[] {
  return [
    { name: "type", label: "Sens", type: "select", options: [{ value: "in", label: "Entrant" }, { value: "out", label: "Sortant" }, ...(scope !== "node" || groups.length ? [{ value: "group", label: "Groupe de sécurité" }] : []), ...(scope !== "vm" ? [{ value: "forward", label: "Transfert" }] : [])], default: "in" },
    { name: "action", label: "Action", type: "select", show: (v) => v.type !== "group", options: [{ value: "ACCEPT", label: "Accepter" }, { value: "DROP", label: "Ignorer (DROP)" }, { value: "REJECT", label: "Refuser (REJECT)" }], default: "ACCEPT" },
    { name: "group", label: "Groupe", type: "select", show: (v) => v.type === "group", options: groups.map((g) => ({ value: g, label: g })), required: true },
    { name: "macro", label: "Service connu (macro)", type: "select", show: (v) => v.type !== "group", options: MACROS.map((m) => ({ value: m, label: m || "Aucun : je précise le protocole et les ports" })) },
    { name: "proto", label: "Protocole", type: "select", show: (v) => v.type !== "group" && !v.macro, options: [{ value: "", label: "Tous" }, ...["tcp", "udp", "icmp", "icmpv6", "gre", "esp", "ah", "sctp"].map((p) => ({ value: p, label: p }))] },
    { name: "dport", label: "Port de destination", placeholder: "443 ou 8000:8100", show: (v) => v.type !== "group" && !v.macro && (v.proto === "tcp" || v.proto === "udp") },
    { name: "sport", label: "Port source", show: (v) => v.type !== "group" && !v.macro && (v.proto === "tcp" || v.proto === "udp"), advanced: true },
    { name: "source", label: "Source", placeholder: "10.0.1.0/24, alias ou +ipset", show: (v) => v.type !== "group", help: "Vide : n'importe quelle adresse." },
    { name: "dest", label: "Destination", placeholder: "10.0.1.50", show: (v) => v.type !== "group" },
    { name: "iface", label: "Interface", placeholder: scope === "vm" ? "net0" : "vmbr0", advanced: true },
    { name: "log", label: "Journalisation", type: "select", options: LOG, advanced: true, show: (v) => v.type !== "group" },
    { name: "comment", label: "Commentaire", full: true },
    { name: "enable", label: "Règle active", type: "checkbox", default: true },
  ];
}

function ruleParams(v: Values, existing?: Values) {
  const isGroup = v.type === "group";
  const body: Record<string, unknown> = {
    type: v.type, action: isGroup ? v.group : v.action, enable: v.enable ? 1 : 0,
    macro: isGroup ? undefined : v.macro || undefined, proto: isGroup || v.macro ? undefined : v.proto || undefined,
    dport: isGroup || v.macro ? undefined : v.dport || undefined, sport: isGroup || v.macro ? undefined : v.sport || undefined,
    source: isGroup ? undefined : v.source || undefined, dest: isGroup ? undefined : v.dest || undefined,
    iface: v.iface || undefined, log: isGroup ? undefined : v.log || undefined, comment: v.comment || undefined,
  };
  if (existing) {
    const del = ["macro", "proto", "dport", "sport", "source", "dest", "iface", "log", "comment"].filter((k) => body[k] === undefined && existing[k] !== undefined && existing[k] !== "");
    if (del.length) body.delete = del.join(",");
  }
  return Object.fromEntries(Object.entries(body).filter(([, x]) => x !== undefined));
}

export function FirewallRules({ fw, scope, canEdit, groupsFw, rb = `${fw}/rules` }: { fw: string; scope: FwScope; canEdit: boolean; groupsFw?: string; rb?: string }) {
  const { toast } = useToast();
  const rules = usePoll(() => pve.get<any[]>(`${rb}`), 0, [rb]);
  const groups = usePoll(() => (groupsFw ? pve.get<any[]>(`${groupsFw}/groups`) : Promise.resolve([])), 0, [groupsFw]);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const list = rules.data ?? [];
  const groupNames = (groups.data ?? []).map((g) => g.group);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, "ok");
      rules.refresh();
    } catch (e) { toast(`${(e as Error).message}. Vérifie la règle puis réessaie.`, "error"); }
  };
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--line-2)" }}>
        <span className="small muted">Les règles s&apos;appliquent de haut en bas : la première qui correspond l&apos;emporte. Glisse une ligne pour changer l&apos;ordre.</span>
        <Button size="sm" variant="primary" icon={<I.plus />} disabled={!canEdit} onClick={() => setEdit("new")}>Ajouter une règle</Button>
      </div>
      {list.length ? (
        <div className="table-wrap">
          <table className="table fw-table">
            <thead><tr><th style={{ width: 24 }} /><th>Active</th><th>Sens</th><th>Action</th><th>Service / protocole</th><th>Source</th><th>Destination</th><th>Commentaire</th><th className="actions" /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr
                  key={`${r.pos}-${r.comment ?? ""}-${r.action}`}
                  draggable={canEdit}
                  onDragStart={() => setDrag(r.pos)}
                  onDragOver={(e) => { e.preventDefault(); setOver(r.pos); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onDrop={() => {
                    if (drag !== null && drag !== r.pos) act(() => pve.put(`${rb}/${drag}`, { moveto: r.pos }), "Ordre enregistré");
                    setDrag(null);
                    setOver(null);
                  }}
                  className={`${drag === r.pos ? "dragging" : ""} ${over === r.pos && drag !== r.pos ? "drop-target" : ""} ${r.enable ? "" : "fw-off"}`}
                >
                  <td className="grip" aria-hidden title="Glisser pour déplacer">⋮⋮</td>
                  <td><Toggle on={!!r.enable} label={`Activer la règle ${r.pos}`} onChange={(on) => canEdit && act(() => pve.put(`${rb}/${r.pos}`, { enable: on ? 1 : 0 }))} /></td>
                  <td className="small">{r.type === "in" ? "Entrant" : r.type === "out" ? "Sortant" : r.type === "group" ? "Groupe" : "Transfert"}</td>
                  <td>{r.type === "group" ? <span className="tag">{r.action}</span> : <span className={`badge ${ACTION_CLASS[r.action] ?? ""}`}>{r.action}</span>}</td>
                  <td className="small mono">{r.macro ?? (r.proto ? `${r.proto}${r.dport ? ` ${r.dport}` : ""}` : "tout")}</td>
                  <td className="small mono">{r.source ?? "partout"}</td>
                  <td className="small mono">{r.dest ?? "partout"}</td>
                  <td className="small">{r.comment}</td>
                  <td className="actions">
                    <span className="btn-group">
                      <Button size="sm" disabled={!canEdit || r.pos === 0} aria-label={`Monter la règle ${r.pos}`} onClick={() => act(() => pve.put(`${rb}/${r.pos}`, { moveto: r.pos - 1 }))}>↑</Button>
                      <Button size="sm" disabled={!canEdit} onClick={() => setEdit(r)}>Modifier</Button>
                      <Button size="sm" variant="danger" icon={<I.trash />} aria-label={`Supprimer la règle ${r.pos}`} disabled={!canEdit} onClick={() => setDel(r)} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>{rules.loading ? "Chargement…" : "Aucune règle : seule la politique par défaut (onglet Options) s'applique."}</Empty>}
      {edit && (
        <Modal title={edit === "new" ? "Nouvelle règle" : `Règle ${edit.pos}`} wide onClose={() => setEdit(null)}>
          <Form
            fields={ruleFields(scope, groupNames)}
            initial={edit === "new" ? undefined : { ...edit, group: edit.type === "group" ? edit.action : "", enable: !!edit.enable }}
            onCancel={() => setEdit(null)}
            onSubmit={async (_c, v) => {
              if (edit === "new") await pve.post(`${rb}`, ruleParams(v));
              else await pve.put(`${rb}/${edit.pos}`, ruleParams(v, edit));
              toast("Règle enregistrée", "ok");
              setEdit(null);
              rules.refresh();
            }}
          />
        </Modal>
      )}
      {del && (
        <Confirm title="Supprimer cette règle ?" danger confirmLabel="Supprimer" onConfirm={() => act(() => pve.del(`${rb}/${del.pos}`), "Règle supprimée")} onClose={() => setDel(null)}>
          <p>{del.type === "group" ? `Groupe ${del.action}` : `${del.action} ${del.macro ?? del.proto ?? ""} ${del.dport ?? ""}`} {del.comment ? `(${del.comment})` : ""}</p>
        </Confirm>
      )}
    </>
  );
}

function optionFields(scope: FwScope): FieldDef[] {
  const policy = (name: string, label: string): FieldDef => ({ name, label, type: "select", options: [{ value: "DROP", label: "Ignorer (DROP)" }, { value: "REJECT", label: "Refuser (REJECT)" }, { value: "ACCEPT", label: "Accepter" }] });
  if (scope === "vm") {
    return [
      { name: "enable", label: "Pare-feu actif pour cette machine", type: "checkbox", help: "Il faut aussi cocher « Pare-feu » sur la carte réseau." },
      policy("policy_in", "Politique entrante par défaut"), policy("policy_out", "Politique sortante par défaut"),
      { name: "dhcp", label: "Autoriser DHCP", type: "checkbox" }, { name: "ndp", label: "Autoriser NDP (IPv6)", type: "checkbox" },
      { name: "radv", label: "Autoriser les annonces de routeur", type: "checkbox", advanced: true },
      { name: "macfilter", label: "Filtrer les adresses MAC usurpées", type: "checkbox", advanced: true },
      { name: "ipfilter", label: "Filtrer les adresses IP usurpées (IPset ipfilter-net*)", type: "checkbox", advanced: true },
      { name: "log_level_in", label: "Journal entrant", type: "select", options: LOG, advanced: true },
      { name: "log_level_out", label: "Journal sortant", type: "select", options: LOG, advanced: true },
    ];
  }
  if (scope === "node") {
    return [
      { name: "enable", label: "Pare-feu actif sur ce nœud", type: "checkbox" },
      { name: "nosmurfs", label: "Filtre anti-smurf", type: "checkbox" },
      { name: "tcpflags", label: "Filtrer les drapeaux TCP illégaux", type: "checkbox" },
      { name: "ndp", label: "Autoriser NDP (IPv6)", type: "checkbox" },
      { name: "nf_conntrack_max", label: "Connexions suivies max", type: "number", advanced: true },
      { name: "log_level_in", label: "Journal entrant", type: "select", options: LOG, advanced: true },
      { name: "log_level_out", label: "Journal sortant", type: "select", options: LOG, advanced: true },
    ];
  }
  return [
    { name: "enable", label: "Pare-feu du datacenter actif", type: "checkbox", help: "Sans lui, aucune règle de pare-feu ne s'applique, ni aux nœuds ni aux machines." },
    policy("policy_in", "Politique entrante par défaut"), policy("policy_out", "Politique sortante par défaut"),
    { name: "ebtables", label: "ebtables", type: "checkbox", advanced: true },
    { name: "log_ratelimit", label: "Limite de journalisation", placeholder: "enable=1,rate=1/second,burst=5", advanced: true },
  ];
}

function Options({ fw, scope, canEdit }: { fw: string; scope: FwScope; canEdit: boolean }) {
  const { toast } = useToast();
  const opts = usePoll(() => pve.get<Record<string, any>>(`${fw}/options`), 0, [fw]);
  if (!opts.data) return <Empty>Chargement…</Empty>;
  const fields = optionFields(scope).map((f) => ({ ...f, readOnly: !canEdit }));
  const initial: Values = Object.fromEntries(fields.map((f) => [f.name, f.type === "checkbox" ? !!Number(opts.data![f.name] ?? (f.name === "dhcp" || f.name === "ndp" || f.name === "macfilter" ? 1 : 0)) : opts.data![f.name] ?? (f.name.startsWith("policy_in") ? "DROP" : f.name.startsWith("policy_out") ? "ACCEPT" : "")]));
  return (
    <div style={{ padding: 16 }}>
      <Form
        key={JSON.stringify(opts.data)}
        fields={fields}
        initial={initial}
        submitLabel="Enregistrer les options"
        onSubmit={async (_c, v) => {
          const body: Record<string, unknown> = {};
          const del: string[] = [];
          for (const f of fields) {
            const x = v[f.name];
            if (f.type === "checkbox") body[f.name] = x ? 1 : 0;
            else if (x === "" || x === undefined) { if (opts.data![f.name] !== undefined) del.push(f.name); } else body[f.name] = x;
          }
          if (del.length) body.delete = del.join(",");
          await pve.put(`${fw}/options`, body);
          toast("Options du pare-feu enregistrées", "ok");
          opts.refresh();
        }}
      />
    </div>
  );
}

function Aliases({ fw, canEdit }: { fw: string; canEdit: boolean }) {
  const { toast } = useToast();
  const list = usePoll(() => pve.get<any[]>(`${fw}/aliases`), 0, [fw]);
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [del, setDel] = useState<any | null>(null);
  return (
    <>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(a) => a.name}
        filter={false}
        toolbar={<Button size="sm" variant="primary" icon={<I.plus />} disabled={!canEdit} onClick={() => setEdit("new")}>Ajouter un alias</Button>}
        empty="Aucun alias. Un alias donne un nom à une adresse ou un réseau, réutilisable dans les règles."
        columns={[
          { id: "name", header: "Nom", sort: (a) => a.name, cell: (a) => <strong className="mono">{a.name}</strong> },
          { id: "cidr", header: "Adresse ou réseau", cell: (a) => <span className="mono">{a.cidr}</span> },
          { id: "comment", header: "Commentaire", cell: (a) => a.comment },
        ]}
        actions={(a) => (
          <span className="btn-group">
            <Button size="sm" disabled={!canEdit} onClick={() => setEdit(a)}>Modifier</Button>
            <Button size="sm" variant="danger" disabled={!canEdit} onClick={() => setDel(a)}>Supprimer</Button>
          </span>
        )}
      />
      {edit && (
        <Modal title={edit === "new" ? "Nouvel alias" : `Alias ${edit.name}`} onClose={() => setEdit(null)}>
          <Form
            fields={[
              { name: "name", label: "Nom", required: true, validate: (x) => (/^[A-Za-z][\w-]{1,62}$/.test(String(x)) ? null : "Lettres, chiffres, - et _, en commençant par une lettre.") },
              { name: "cidr", label: "Adresse ou réseau", required: true, placeholder: "10.0.1.20 ou 10.0.1.0/24" },
              { name: "comment", label: "Commentaire", full: true },
            ]}
            initial={edit === "new" ? undefined : edit}
            onCancel={() => setEdit(null)}
            onSubmit={async (_c, v) => {
              if (edit === "new") await pve.post(`${fw}/aliases`, { name: v.name, cidr: v.cidr, comment: v.comment || undefined });
              else await pve.put(`${fw}/aliases/${edit.name}`, { cidr: v.cidr, comment: v.comment ?? "", rename: v.name !== edit.name ? v.name : undefined });
              toast("Alias enregistré", "ok");
              setEdit(null);
              list.refresh();
            }}
          />
        </Modal>
      )}
      {del && <Confirm title={`Supprimer l'alias ${del.name} ?`} danger confirmLabel="Supprimer" onConfirm={async () => { try { await pve.del(`${fw}/aliases/${del.name}`); list.refresh(); } catch (e) { toast(`${(e as Error).message}. Retire d'abord l'alias des règles qui l'utilisent.`, "error"); } }} onClose={() => setDel(null)}><p>Les règles qui l&apos;utilisent ne fonctionneront plus.</p></Confirm>}
    </>
  );
}

function IpSets({ fw, canEdit }: { fw: string; canEdit: boolean }) {
  const { toast } = useToast();
  const sets = usePoll(() => pve.get<any[]>(`${fw}/ipset`), 0, [fw]);
  const [cur, setCur] = useState<string>("");
  const entries = usePoll(() => (cur ? pve.get<any[]>(`${fw}/ipset/${cur}`) : Promise.resolve([])), 0, [cur]);
  const [newSet, setNewSet] = useState(false);
  const [newEntry, setNewEntry] = useState(false);
  const [del, setDel] = useState<{ kind: "set" | "entry"; name: string } | null>(null);
  return (
    <div className="grid g2" style={{ padding: 16 }}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h3>IPsets</h3><Button size="sm" variant="primary" disabled={!canEdit} onClick={() => setNewSet(true)}>Ajouter</Button></div>
        {(sets.data ?? []).length ? (
          <div className="choice">
            {(sets.data ?? []).map((s) => (
              <label key={s.name} className={cur === s.name ? "sel" : ""}>
                <input type="radio" name="ipset" checked={cur === s.name} onChange={() => setCur(s.name)} />
                <div style={{ flex: 1 }}><div className="t mono">{s.name}</div><div className="d">{s.comment}</div></div>
                <Button size="sm" variant="danger" icon={<I.trash />} aria-label={`Supprimer l'IPset ${s.name}`} disabled={!canEdit} onClick={(e) => { e.preventDefault(); setDel({ kind: "set", name: s.name }); }} />
              </label>
            ))}
          </div>
        ) : <Empty>Aucun IPset. Un IPset regroupe plusieurs adresses, utilisables dans les règles avec +nom.</Empty>}
      </div>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h3>{cur ? `Adresses de ${cur}` : "Adresses"}</h3>{cur && <Button size="sm" variant="primary" disabled={!canEdit} onClick={() => setNewEntry(true)}>Ajouter</Button>}</div>
        {!cur ? <Empty>Choisis un IPset.</Empty> : (entries.data ?? []).length ? (
          <table className="table">
            <tbody>
              {(entries.data ?? []).map((e) => (
                <tr key={e.cidr}>
                  <td className="mono">{e.nomatch ? "!" : ""}{e.cidr}</td><td className="small">{e.comment}</td>
                  <td className="actions"><Button size="sm" variant="danger" icon={<I.trash />} aria-label={`Retirer ${e.cidr}`} disabled={!canEdit} onClick={() => setDel({ kind: "entry", name: e.cidr })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Vide.</Empty>}
      </div>
      {newSet && (
        <Modal title="Nouvel IPset" onClose={() => setNewSet(false)}>
          <Form fields={[{ name: "name", label: "Nom", required: true, validate: (x) => (/^[A-Za-z][\w-]{1,62}$/.test(String(x)) ? null : "Lettres, chiffres, - et _.") }, { name: "comment", label: "Commentaire" }]} onCancel={() => setNewSet(false)} onSubmit={async (v) => {
            await pve.post(`${fw}/ipset`, v);
            setNewSet(false);
            setCur(String(v.name));
            sets.refresh();
          }} />
        </Modal>
      )}
      {newEntry && (
        <Modal title={`Ajouter à ${cur}`} onClose={() => setNewEntry(false)}>
          <Form fields={[{ name: "cidr", label: "Adresse ou réseau", required: true, placeholder: "10.0.1.0/24" }, { name: "comment", label: "Commentaire" }, { name: "nomatch", label: "Exclure cette adresse (nomatch)", type: "checkbox" }]} onCancel={() => setNewEntry(false)} onSubmit={async (v) => {
            await pve.post(`${fw}/ipset/${cur}`, v);
            setNewEntry(false);
            entries.refresh();
          }} />
        </Modal>
      )}
      {del && (
        <Confirm title={del.kind === "set" ? `Supprimer l'IPset ${del.name} ?` : `Retirer ${del.name} ?`} danger confirmLabel="Supprimer" onConfirm={async () => {
          try {
            if (del.kind === "set") { await pve.del(`${fw}/ipset/${del.name}`); setCur(""); sets.refresh(); } else { await pve.del(`${fw}/ipset/${cur}/${encodeURIComponent(del.name)}`); entries.refresh(); }
          } catch (e) { toast(`${(e as Error).message}${del.kind === "set" ? ". Vide d'abord l'IPset." : ""}`, "error"); }
        }} onClose={() => setDel(null)}><p>{del.kind === "set" ? "L'IPset doit être vide." : "Les règles qui utilisent l'IPset ne couvriront plus cette adresse."}</p></Confirm>
      )}
    </div>
  );
}

function Log({ fw }: { fw: string }) {
  const log = usePoll(() => pve.get<any[]>(`${fw}/log`, { limit: 500 }), 5000, [fw]);
  return <div style={{ padding: 16 }}><pre className="log">{(log.data ?? []).map((l) => l.t).join("\n") || "Journal vide. Active la journalisation sur une règle ou dans les options."}</pre></div>;
}

type Sub = "regles" | "options" | "alias" | "ipsets" | "journal";

/** `base` : chemin du pare-feu, ex. /nodes/pve/qemu/101/firewall. */
export function FirewallPanel({ base: fw, scope, aclPath, priv, extraTabs }: { base: string; scope: FwScope; aclPath: string; priv: string; extraTabs?: { id: string; label: string; render: () => React.ReactNode }[] }) {
  const [sub, setSub] = useState<string>("regles");
  const { allowed } = usePermission(aclPath, priv);
  const tabs: { id: string; label: string }[] = [
    { id: "regles", label: "Règles" }, { id: "options", label: "Options" }, { id: "alias", label: "Alias" }, { id: "ipsets", label: "IPsets" },
    ...(extraTabs ?? []).map((t) => ({ id: t.id, label: t.label })),
    ...(scope !== "cluster" ? [{ id: "journal", label: "Journal" }] : []),
  ];
  return (
    <Panel pad={false} title="Pare-feu" right={!allowed && <span className="small muted">Lecture seule : il te manque le droit {priv}</span>}>
      <div style={{ padding: "0 16px" }}><Tabs value={sub} onChange={setSub} tabs={tabs} /></div>
      {(sub as Sub) === "regles" && <FirewallRules fw={fw} scope={scope} canEdit={allowed} groupsFw={scope === "cluster" ? fw : "/cluster/firewall"} />}
      {(sub as Sub) === "options" && <Options fw={fw} scope={scope} canEdit={allowed} />}
      {(sub as Sub) === "alias" && <Aliases fw={fw} canEdit={allowed} />}
      {(sub as Sub) === "ipsets" && <IpSets fw={fw} canEdit={allowed} />}
      {(sub as Sub) === "journal" && <Log fw={fw} />}
      {extraTabs?.find((t) => t.id === sub)?.render()}
    </Panel>
  );
}

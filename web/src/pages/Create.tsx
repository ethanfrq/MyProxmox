import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Notice, PageHead, Panel, Tabs, useToast } from "../components/ui";
import { pve, usePoll } from "../lib/api";
import { bytes } from "../../../shared/format";
import { VmWizard, CtWizard } from "./create/Wizards";
import { CloneDialog } from "./machine/Lifecycle";

type Kind = "lxc" | "qemu" | "modele";
type Mode = "assistant" | "simple";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
};

export function Create() {
  const [kind, setKind] = useState<Kind>("lxc");
  const [mode, setMode] = useState<Mode>((store.get("myproxmox-create-mode") as Mode) || "assistant");
  const nodes = usePoll(() => pve.get<any[]>("/nodes"), 0);
  const [node, setNode] = useState("");
  useEffect(() => { if (!node && nodes.data?.[0]) setNode(nodes.data[0].node); }, [nodes.data, node]);
  useEffect(() => store.set("myproxmox-create-mode", mode), [mode]);

  return (
    <>
      <PageHead
        title="Créer"
        sub="Une nouvelle machine virtuelle ou un conteneur"
        actions={kind !== "modele" && (
          <span className="btn-group" role="group" aria-label="Mode de création">
            <Button size="sm" variant={mode === "assistant" ? "dark" : "default"} onClick={() => setMode("assistant")}>Assistant complet</Button>
            <Button size="sm" variant={mode === "simple" ? "dark" : "default"} onClick={() => setMode("simple")}>Mode simple</Button>
          </span>
        )}
      />
      <Tabs
        value={kind}
        onChange={setKind}
        tabs={[{ id: "lxc", label: "Conteneur (LXC)" }, { id: "qemu", label: "Machine virtuelle" }, { id: "modele", label: "Depuis un modèle" }]}
      />
      <div style={{ marginBottom: 16 }}>
        <Notice>
          {kind === "lxc"
            ? "Un conteneur partage le noyau Linux du serveur : léger et rapide. Idéal pour un service (Pi-hole, Nextcloud, base de données…)."
            : kind === "qemu"
              ? "Une VM émule un ordinateur complet : plus lourd, mais tu peux installer n'importe quel système (Windows, BSD, Linux)."
              : "Un modèle est une machine préparée une fois pour toutes. Un clone lié se crée en quelques secondes ; un clone complet est une copie indépendante."}
        </Notice>
      </div>
      {node && kind === "modele" && <FromTemplate />}
      {node && kind !== "modele" && mode === "assistant" && (kind === "lxc" ? <CtWizard key="ct" defaultNode={node} /> : <VmWizard key="vm" defaultNode={node} />)}
      {node && kind !== "modele" && mode === "simple" && (kind === "lxc" ? <CreateLxc node={node} /> : <CreateVm node={node} />)}
      {mode === "simple" && kind !== "modele" && nodes.data && nodes.data.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <Field label="Nœud">
            <select className="select input" style={{ maxWidth: 240 }} value={node} onChange={(e) => setNode(e.target.value)}>
              {nodes.data.map((n) => <option key={n.node}>{n.node}</option>)}
            </select>
          </Field>
        </div>
      )}
    </>
  );
}

// Données communes : prochain ID libre, stockages, ponts réseau
function useCreateData(node: string, wanted: string[]) {
  const nextid = usePoll(() => pve.get<string>("/cluster/nextid"), 0, [node]);
  const storages = usePoll(() => pve.get<any[]>(`/nodes/${node}/storage`), 0, [node]);
  const network = usePoll(() => pve.get<any[]>(`/nodes/${node}/network`), 0, [node]);
  const files = usePoll(async () => {
    const st = (storages.data ?? []).filter((s) => s.active && wanted.some((w) => String(s.content).includes(w)));
    const lists = await Promise.all(st.flatMap((s) => wanted.filter((w) => String(s.content).includes(w)).map((w) => pve.get<any[]>(`/nodes/${node}/storage/${s.storage}/content`, { content: w }))));
    return lists.flat();
  }, 0, [storages.data?.length, node]);
  const bridges = (network.data ?? []).filter((n) => n.type === "bridge").map((n) => n.iface).sort();
  return { nextid: nextid.data, storages: storages.data ?? [], bridges, files: files.data ?? [] };
}

function DiskStorage({ storages, need, value, onChange }: { storages: any[]; need: string; value: string; onChange: (v: string) => void }) {
  const list = storages.filter((s) => s.active && String(s.content).includes(need));
  useEffect(() => { if (!value && list[0]) onChange(list[0].storage); }, [list, value, onChange]);
  return (
    <select className="select input" value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({bytes(s.avail)} libres)</option>)}
    </select>
  );
}

function useSubmit(node: string, kind: Kind) {
  const router = useNavigate();
  const { watch, toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(params: Record<string, unknown>, vmid: number) {
    setBusy(true);
    setError("");
    try {
      const upid = await pve.post(`/nodes/${node}/${kind}`, params);
      watch(node, upid, kind === "lxc" ? "Création du conteneur" : "Création de la VM", () => router(`/machines/${node}/${kind}/${vmid}`));
      toast("Création lancée, tu seras redirigé à la fin.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { submit, busy, error };
}

function CreateLxc({ node }: { node: string }) {
  const d = useCreateData(node, ["vztmpl"]);
  const templates = d.files.filter((f) => f.content === "vztmpl");
  const [f, setF] = useState({ vmid: "", hostname: "", template: "", password: "", password2: "", cores: 1, memory: 1024, swap: 512, disk: 8, storage: "", bridge: "vmbr0", ipMode: "dhcp", ip: "", gw: "", unprivileged: true, start: true, onboot: true });
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" ? Number(e.target.value) : e.target.value }));
  const setStorage = useMemo(() => (v: string) => setF((x) => ({ ...x, storage: v })), []);
  useEffect(() => { if (d.nextid && !f.vmid) setF((x) => ({ ...x, vmid: String(d.nextid) })); }, [d.nextid, f.vmid]);
  useEffect(() => { if (templates[0] && !f.template) setF((x) => ({ ...x, template: templates[0].volid })); }, [templates, f.template]);
  const { submit, busy, error } = useSubmit(node, "lxc");

  const problems = [
    !f.hostname && "nom d'hôte",
    !f.template && "modèle",
    f.password.length < 5 && "mot de passe (5 caractères min.)",
    f.password !== f.password2 && "mots de passe identiques",
    f.ipMode === "static" && !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(f.ip) && "adresse IP au format 10.0.1.50/24",
  ].filter(Boolean) as string[];

  return (
    <div className="grid g2">
      <Panel title="Général">
        <div className="form-grid">
          <Field label="ID" help="Numéro unique, proposé automatiquement."><input className="input mono" value={f.vmid} onChange={set("vmid")} /></Field>
          <Field label="Nom d'hôte" help="Ex. pihole, nextcloud"><input className="input" value={f.hostname} onChange={(e) => setF((x) => ({ ...x, hostname: e.target.value.replace(/[^a-zA-Z0-9-]/g, "") }))} /></Field>
          <Field label="Modèle de système" full help={!templates.length ? undefined : "Système de base du conteneur."}>
            {templates.length ? (
              <select className="select input" value={f.template} onChange={set("template")}>
                {templates.map((t) => <option key={t.volid} value={t.volid}>{t.volid.split("/").pop()}</option>)}
              </select>
            ) : <Notice kind="warn">Aucun modèle téléchargé. <Link to="/stockage" style={{ color: "var(--orange)", fontWeight: 600 }}>Télécharge-en un dans Stockage</Link>, puis reviens.</Notice>}
          </Field>
          <Field label="Mot de passe root"><input className="input" type="password" value={f.password} onChange={set("password")} /></Field>
          <Field label="Confirmer"><input className="input" type="password" value={f.password2} onChange={set("password2")} /></Field>
          <Field label="Options" full>
            <div className="stack" style={{ gap: 8 }}>
              <label className="check"><input type="checkbox" checked={f.unprivileged} onChange={set("unprivileged")} /> Conteneur non privilégié (recommandé, plus sûr)</label>
              <label className="check"><input type="checkbox" checked={f.onboot} onChange={set("onboot")} /> Démarrer avec le serveur</label>
              <label className="check"><input type="checkbox" checked={f.start} onChange={set("start")} /> Démarrer après la création</label>
            </div>
          </Field>
        </div>
      </Panel>
      <div className="stack">
        <Panel title="Ressources">
          <div className="form-grid">
            <Field label="Cœurs"><input className="input" type="number" min={1} value={f.cores} onChange={set("cores")} /></Field>
            <Field label="Mémoire (Mo)"><input className="input" type="number" min={128} step={256} value={f.memory} onChange={set("memory")} /></Field>
            <Field label="Swap (Mo)"><input className="input" type="number" min={0} step={256} value={f.swap} onChange={set("swap")} /></Field>
            <Field label="Disque (Go)"><input className="input" type="number" min={1} value={f.disk} onChange={set("disk")} /></Field>
            <Field label="Stockage du disque" full><DiskStorage storages={d.storages} need="rootdir" value={f.storage} onChange={setStorage} /></Field>
          </div>
        </Panel>
        <Panel title="Réseau">
          <div className="form-grid">
            <Field label="Pont"><select className="select input" value={f.bridge} onChange={set("bridge")}>{d.bridges.map((b) => <option key={b}>{b}</option>)}</select></Field>
            <Field label="Adresse IP"><select className="select input" value={f.ipMode} onChange={set("ipMode")}><option value="dhcp">Automatique (DHCP)</option><option value="static">Fixe</option></select></Field>
            {f.ipMode === "static" && (
              <>
                <Field label="IP / masque"><input className="input mono" placeholder="10.0.1.50/24" value={f.ip} onChange={set("ip")} /></Field>
                <Field label="Passerelle"><input className="input mono" placeholder="10.0.1.1" value={f.gw} onChange={set("gw")} /></Field>
              </>
            )}
          </div>
        </Panel>
        {error && <Notice kind="error">{error}</Notice>}
        {problems.length > 0 && <p className="small muted" style={{ margin: 0 }}>À compléter : {problems.join(", ")}.</p>}
        <div>
          <Button
            variant="primary" size="lg" busy={busy} disabled={problems.length > 0}
            onClick={() => submit({
              vmid: f.vmid, hostname: f.hostname, ostemplate: f.template, password: f.password,
              cores: f.cores, memory: f.memory, swap: f.swap, rootfs: `${f.storage}:${f.disk}`,
              net0: `name=eth0,bridge=${f.bridge},ip=${f.ipMode === "dhcp" ? "dhcp" : f.ip}${f.ipMode === "static" && f.gw ? `,gw=${f.gw}` : ""}`,
              unprivileged: f.unprivileged ? 1 : 0, start: f.start ? 1 : 0, onboot: f.onboot ? 1 : 0,
              features: f.unprivileged ? "nesting=1" : undefined,
            }, Number(f.vmid))}
          >
            Créer le conteneur
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateVm({ node }: { node: string }) {
  const d = useCreateData(node, ["iso"]);
  const isos = d.files.filter((f) => f.content === "iso");
  const [f, setF] = useState({ vmid: "", name: "", iso: "", ostype: "l26", cores: 2, memory: 2048, disk: 32, storage: "", bridge: "vmbr0", start: false, onboot: false, agent: true });
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" ? Number(e.target.value) : e.target.value }));
  const setStorage = useMemo(() => (v: string) => setF((x) => ({ ...x, storage: v })), []);
  useEffect(() => { if (d.nextid && !f.vmid) setF((x) => ({ ...x, vmid: String(d.nextid) })); }, [d.nextid, f.vmid]);
  const { submit, busy, error } = useSubmit(node, "qemu");
  const problems = [!f.name && "nom"].filter(Boolean) as string[];

  return (
    <div className="grid g2">
      <Panel title="Général">
        <div className="form-grid">
          <Field label="ID"><input className="input mono" value={f.vmid} onChange={set("vmid")} /></Field>
          <Field label="Nom"><input className="input" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value.replace(/[^a-zA-Z0-9.-]/g, "") }))} /></Field>
          <Field label="Image d'installation (ISO)" full help={isos.length ? "Le disque d'installation, comme une clé USB." : <>Aucune ISO. <Link to="/stockage" style={{ color: "var(--orange)" }}>Ajoute-en une dans Stockage</Link>.</>}>
            <select className="select input" value={f.iso} onChange={set("iso")}>
              <option value="">Aucune (installer plus tard)</option>
              {isos.map((i) => <option key={i.volid} value={i.volid}>{i.volid.split("/").pop()}</option>)}
            </select>
          </Field>
          <Field label="Système invité" full>
            <select className="select input" value={f.ostype} onChange={set("ostype")}>
              <option value="l26">Linux (noyau 2.6 et plus récent)</option>
              <option value="win10">Windows 10 / Server 2016-2019</option>
              <option value="other">Autre</option>
            </select>
          </Field>
          <Field label="Options" full>
            <div className="stack" style={{ gap: 8 }}>
              <label className="check"><input type="checkbox" checked={f.agent} onChange={set("agent")} /> Activer l&apos;agent invité QEMU</label>
              <label className="check"><input type="checkbox" checked={f.onboot} onChange={set("onboot")} /> Démarrer avec le serveur</label>
              <label className="check"><input type="checkbox" checked={f.start} onChange={set("start")} /> Démarrer après la création</label>
            </div>
          </Field>
        </div>
      </Panel>
      <div className="stack">
        <Panel title="Ressources">
          <div className="form-grid">
            <Field label="Cœurs"><input className="input" type="number" min={1} value={f.cores} onChange={set("cores")} /></Field>
            <Field label="Mémoire (Mo)"><input className="input" type="number" min={256} step={512} value={f.memory} onChange={set("memory")} /></Field>
            <Field label="Disque (Go)"><input className="input" type="number" min={1} value={f.disk} onChange={set("disk")} /></Field>
            <Field label="Stockage du disque"><DiskStorage storages={d.storages} need="images" value={f.storage} onChange={setStorage} /></Field>
            <Field label="Pont réseau" full><select className="select input" value={f.bridge} onChange={set("bridge")}>{d.bridges.map((b) => <option key={b}>{b}</option>)}</select></Field>
          </div>
        </Panel>
        <Notice>Pour Windows 11 (TPM, UEFI) ou le partage de matériel (GPU, USB), passe par l&apos;interface officielle de Proxmox.</Notice>
        {error && <Notice kind="error">{error}</Notice>}
        <div>
          <Button
            variant="primary" size="lg" busy={busy} disabled={problems.length > 0}
            onClick={() => submit({
              vmid: f.vmid, name: f.name, ostype: f.ostype, cores: f.cores, sockets: 1, memory: f.memory, cpu: "host",
              scsihw: "virtio-scsi-single", scsi0: `${f.storage}:${f.disk},iothread=1`,
              ide2: f.iso ? `${f.iso},media=cdrom` : undefined, boot: f.iso ? "order=scsi0;ide2" : "order=scsi0",
              net0: `virtio,bridge=${f.bridge}`, agent: f.agent ? 1 : 0, onboot: f.onboot ? 1 : 0, start: f.start ? 1 : 0,
            }, Number(f.vmid))}
          >
            Créer la machine virtuelle
          </Button>
        </div>
      </div>
    </div>
  );
}

function FromTemplate() {
  const res = usePoll(() => pve.get<any[]>("/cluster/resources", { type: "vm" }), 0);
  const [pick, setPick] = useState<any | null>(null);
  const tpl = (res.data ?? []).filter((r) => r.template);
  if (res.loading) return <div className="empty">Chargement…</div>;
  if (!tpl.length) return <Notice>Aucun modèle pour l&apos;instant. Prépare une machine puis, dans sa fiche, choisis « Plus » puis « Convertir en modèle ».</Notice>;
  return (
    <div className="grid g3">
      {tpl.map((t) => (
        <button key={t.id} type="button" className="panel tpl-card" onClick={() => setPick(t)}>
          <div className="row" style={{ justifyContent: "space-between" }}><strong>{t.name}</strong><span className="tag">{t.type === "qemu" ? "VM" : "CT"} {t.vmid}</span></div>
          <div className="small muted" style={{ marginTop: 6 }}>{t.maxcpu} cœur(s) · {bytes(t.maxmem)} · disque {bytes(t.maxdisk)} · {t.node}</div>
          <div className="small" style={{ marginTop: 10, color: "var(--orange)", fontWeight: 600 }}>Créer depuis ce modèle</div>
        </button>
      ))}
      {pick && (
        <CloneDialog
          ctx={{ node: pick.node, type: pick.type, vmid: pick.vmid, base: `/nodes/${pick.node}/${pick.type}/${pick.vmid}`, name: pick.name, running: false, conf: { template: "1" }, refresh: res.refresh }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}

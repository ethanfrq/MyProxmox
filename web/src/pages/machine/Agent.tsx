// Onglet « Agent invité » (VM) : système, systèmes de fichiers, utilisateurs connectés,
// arrêt propre et gel/dégel des fichiers via qemu-guest-agent.
import { useState } from "react";
import { Button, Confirm, Empty, Meter, Modal, Notice, Panel, useToast } from "../../components/ui";
import { Form } from "../../components/Form";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { bytes, date } from "../../../../shared/format";
import type { GuestCtx } from "./common";

export function Agent({ ctx }: { ctx: GuestCtx }) {
  const { toast } = useToast();
  const enabled = String(ctx.conf.agent ?? "0").startsWith("1");
  const ok = enabled && ctx.running;
  const a = `${ctx.base}/agent`;
  const os = usePoll(() => (ok ? pve.get<any>(`${a}/get-osinfo`) : Promise.resolve(null)), 0, [ok]);
  const fs = usePoll(() => (ok ? pve.get<any>(`${a}/get-fsinfo`) : Promise.resolve(null)), 30000, [ok]);
  const users = usePoll(() => (ok ? pve.get<any>(`${a}/get-users`) : Promise.resolve(null)), 30000, [ok]);
  const freeze = usePoll(() => (ok ? pve.post<any>(`${a}/fsfreeze-status`) : Promise.resolve(null)), 0, [ok]);
  const tz = usePoll(() => (ok ? pve.get<any>(`${a}/get-timezone`) : Promise.resolve(null)), 0, [ok]);
  const vcpus = usePoll(() => (ok ? pve.get<any>(`${a}/get-vcpus`) : Promise.resolve(null)), 0, [ok]);
  const host = usePoll(() => (ok ? pve.get<any>(`${a}/get-host-name`) : Promise.resolve(null)), 0, [ok]);
  const time = usePoll(() => (ok ? pve.get<any>(`${a}/get-time`) : Promise.resolve(null)), 0, [ok]);
  const info = usePoll(() => (ok ? pve.get<any>(`${a}/info`) : Promise.resolve(null)), 0, [ok]);
  const [pw, setPw] = useState(false);
  const canPower = usePermission(`/vms/${ctx.vmid}`, "VM.PowerMgmt").allowed;
  const canMonitor = usePermission(`/vms/${ctx.vmid}`, "VM.Monitor").allowed;
  const [confirm, setConfirm] = useState<"shutdown" | "freeze" | null>(null);

  if (!enabled) return <Notice>L&apos;agent invité n&apos;est pas activé. Installe <code>qemu-guest-agent</code> dans la VM, puis active-le dans Options.</Notice>;
  if (!ctx.running) return <Notice>La VM est arrêtée : l&apos;agent ne répond que quand elle tourne.</Notice>;
  if (os.error) return <Notice kind="warn">L&apos;agent ne répond pas : {os.error}. Vérifie que le service qemu-guest-agent tourne dans la VM.</Notice>;
  const o = os.data?.result;
  const frozen = freeze.data?.result === "frozen";

  return (
    <div className="grid g2">
      <Panel title="Système invité">
        {o ? (
          <div className="kv">
            <div>Système</div><div>{o["pretty-name"] ?? o.name}</div>
            <div>Version</div><div>{o.version ?? "-"}</div>
            <div>Noyau</div><div className="mono small">{o["kernel-release"]}</div>
            <div>Architecture</div><div>{o.machine}</div>
            <div>Nom d&apos;hôte</div><div className="mono">{host.data?.result?.["host-name"] ?? "-"}</div>
            <div>Fuseau horaire</div><div>{tz.data?.result?.zone ?? "-"}</div>
            <div>Heure de la VM</div><div>{time.data?.result ? <>{new Date(time.data.result / 1e6).toLocaleString("fr-FR")}{Math.abs(time.data.result / 1e6 - Date.now()) > 60000 && <span className="badge warn" style={{ marginLeft: 6 }}>décalée</span>}</> : "-"}</div>
            <div>Version de l&apos;agent</div><div>{info.data?.result?.version ?? "-"}</div>
            <div>vCPU en ligne</div><div>{vcpus.data?.result ? `${vcpus.data.result.filter((c: any) => c.online).length} / ${vcpus.data.result.length}` : "-"}</div>
          </div>
        ) : <Empty>Chargement…</Empty>}
      </Panel>
      <Panel title="Actions de l'agent">
        <div className="stack">
          <div className="row">
            <Button onClick={async () => { try { await pve.post(`${a}/ping`); toast("L'agent répond.", "ok"); } catch (e) { toast(`${(e as Error).message}. Vérifie que qemu-guest-agent tourne dans la VM.`, "error"); } }}>Tester l&apos;agent</Button>
            <Button disabled={!canPower} onClick={() => setConfirm("shutdown")}>Arrêt propre par l&apos;agent</Button>
            {frozen
              ? <Button variant="primary" disabled={!canMonitor} onClick={async () => { try { await pve.post(`${a}/fsfreeze-thaw`); toast("Fichiers dégelés", "ok"); freeze.refresh(); } catch (e) { toast((e as Error).message, "error"); } }}>Dégeler les fichiers</Button>
              : <Button disabled={!canMonitor} onClick={() => setConfirm("freeze")}>Geler les fichiers</Button>}
            <Button disabled={!canMonitor} onClick={async () => {
              try {
                const r = await pve.post<any>(`${a}/fstrim`);
                const n = r?.result?.paths?.length ?? 0;
                toast(`TRIM terminé sur ${n} système(s) de fichiers : l'espace libéré est rendu au stockage`, "ok");
              } catch (e) { toast((e as Error).message, "error"); }
            }}>Lancer un TRIM</Button>
            <Button disabled={!canMonitor} onClick={() => setPw(true)}>Changer un mot de passe</Button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            État des systèmes de fichiers : <strong>{frozen ? "gelés (écritures bloquées)" : "normal"}</strong>. Le gel sert à prendre une copie cohérente à la main ; Proxmox le fait tout seul pendant les sauvegardes.
          </p>
          {frozen && <Notice kind="warn">Les écritures sont bloquées dans la VM tant que tu ne dégèles pas.</Notice>}
        </div>
      </Panel>
      <Panel title="Systèmes de fichiers">
        {fs.data?.result?.length ? (
          <div className="stack">
            {fs.data.result.map((f: any) => (
              <Meter key={f.mountpoint} label={`${f.mountpoint} (${f.type})`} value={f["used-bytes"] ?? 0} max={f["total-bytes"] || 1} text={`${bytes(f["used-bytes"])} / ${bytes(f["total-bytes"])}`} />
            ))}
          </div>
        ) : <Empty>{fs.loading ? "Chargement…" : "Aucune information."}</Empty>}
      </Panel>
      <Panel title="Utilisateurs connectés">
        {users.data?.result?.length ? (
          <table className="table"><tbody>{users.data.result.map((u: any) => <tr key={`${u.user}${u["login-time"]}`}><td><strong>{u.user}</strong></td><td className="small muted">depuis le {date(Math.floor(u["login-time"]))}</td></tr>)}</tbody></table>
        ) : <Empty>{users.loading ? "Chargement…" : "Personne n'est connecté."}</Empty>}
      </Panel>
      {pw && (
        <Modal title="Changer le mot de passe d'un utilisateur de la VM" onClose={() => setPw(false)}>
          <Form
            fields={[
              { name: "username", label: "Utilisateur", required: true, default: "root" },
              { name: "password", label: "Nouveau mot de passe", type: "password", required: true, validate: (x) => (String(x).length < 5 ? "5 caractères au moins." : null) },
            ]}
            submitLabel="Changer"
            onCancel={() => setPw(false)}
            onSubmit={async (v) => {
              await pve.post(`${a}/set-user-password`, v);
              toast(`Mot de passe de ${v.username} changé dans la VM`, "ok");
              setPw(false);
            }}
          />
        </Modal>
      )}
      {confirm && (
        <Confirm
          title={confirm === "shutdown" ? `Éteindre ${ctx.name} par l'agent ?` : "Geler les systèmes de fichiers ?"}
          danger={confirm === "freeze"}
          confirmLabel={confirm === "shutdown" ? "Éteindre" : "Geler"}
          onConfirm={async () => {
            try {
              if (confirm === "shutdown") await pve.post(`${a}/shutdown`);
              else await pve.post(`${a}/fsfreeze-freeze`);
              toast(confirm === "shutdown" ? "Arrêt demandé au système invité" : "Fichiers gelés", "ok");
              if (confirm === "shutdown") setTimeout(ctx.refresh, 1500); else freeze.refresh();
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setConfirm(null)}
        >
          <p>{confirm === "shutdown" ? "L'agent demande au système de s'éteindre proprement, comme le bouton Arrêter dans la VM." : "Toutes les écritures disque de la VM sont bloquées jusqu'au dégel. Les applications peuvent se figer : ne laisse pas la VM gelée."}</p>
        </Confirm>
      )}
    </div>
  );
}

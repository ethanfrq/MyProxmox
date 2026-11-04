// Résumé d'un nœud : santé, matériel, graphiques, et actions d'alimentation.
import { Fragment, useState } from "react";
import { Button, Confirm, Empty, Meter, Modal, Notice, Panel, useToast } from "../../components/ui";
import { Form } from "../../components/Form";
import { LineChart } from "../../components/Chart";
import { api, pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { bytes, date, pct, rate, uptime } from "../../../../shared/format";

export function NodeSummary({ node }: { node: string }) {
  const { toast, watch } = useToast();
  const h = usePoll(() => api(`/api/insights/server/${node}`), 30000, [node]);
  const [range, setRange] = useState<"hour" | "day" | "week">("hour");
  const rrd = usePoll(() => pve.get<any[]>(`/nodes/${node}/rrddata`, { timeframe: range }), 60000, [node, range]);
  const canPower = usePermission(`/nodes/${node}`, "Sys.PowerMgmt").allowed;
  const canVm = usePermission("/vms", "VM.PowerMgmt").allowed;
  const canMigrate = usePermission("/vms", "VM.Migrate").allowed;
  const [power, setPower] = useState<"reboot" | "shutdown" | null>(null);
  const [power2, setPower2] = useState<"reboot" | "shutdown" | null>(null);
  const [bulk, setBulk] = useState<"startall" | "stopall" | "migrateall" | null>(null);
  const d: any = h.data;
  const pts = (rrd.data ?? []).filter((p) => p.cpu !== undefined);
  const t = pts.map((p) => p.time);

  if (!d) return <Empty>{h.error ?? "Chargement…"}</Empty>;
  const stoppedServices = (d.services ?? []).filter((s: any) => s.state !== "running" && s["unit-state"] !== "disabled");
  const badDisks = (d.disks ?? []).filter((x: any) => x.health && !["PASSED", "OK"].includes(String(x.health).toUpperCase()));
  const badZfs = (d.zfs ?? []).filter((p: any) => p.health !== "ONLINE");
  const certSoon = (d.certificates ?? []).filter((c: any) => (c.notafter - Date.now() / 1000) / 86400 < 30);

  return (
    <div className="stack">
      <div className="row">
        <Button disabled={!canVm} onClick={() => setBulk("startall")}>Tout démarrer</Button>
        <Button disabled={!canVm} onClick={() => setBulk("stopall")}>Tout arrêter</Button>
        <Button disabled={!canMigrate} onClick={() => setBulk("migrateall")}>Tout migrer</Button>
        <span style={{ flex: 1 }} />
        <Button disabled={!canPower} title={canPower ? undefined : "Il te manque le droit Sys.PowerMgmt"} onClick={() => setPower("reboot")}>Redémarrer le nœud</Button>
        <Button variant="danger" disabled={!canPower} title={canPower ? undefined : "Il te manque le droit Sys.PowerMgmt"} onClick={() => setPower("shutdown")}>Éteindre le nœud</Button>
      </div>
      <div className="grid g2">
        <Panel title="Utilisation" right={
          <select className="input select" aria-label="Période des graphiques" style={{ height: 28, width: 140 }} value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
            <option value="hour">Dernière heure</option><option value="day">24 heures</option><option value="week">7 jours</option>
          </select>
        }>
          <div className="stack">
            {d.status && (
              <>
                <Meter label="Processeur" value={d.status.cpu} max={1} text={`${pct(d.status.cpu)} · attente disque ${pct(d.status.wait ?? 0, 1)}`} />
                <Meter label="Mémoire" value={d.status.memory.used} max={d.status.memory.total} text={`${bytes(d.status.memory.used)} / ${bytes(d.status.memory.total)}`} />
                <Meter label="Swap" value={d.status.swap.used} max={d.status.swap.total || 1} text={`${bytes(d.status.swap.used)} / ${bytes(d.status.swap.total)}`} />
                <Meter label="Disque système (/)" value={d.status.rootfs.used} max={d.status.rootfs.total} text={`${bytes(d.status.rootfs.used)} / ${bytes(d.status.rootfs.total)}`} />
              </>
            )}
            <LineChart title="Processeur" series={[{ label: "CPU", color: "var(--orange)", values: pts.map((p) => p.cpu) }, { label: "Attente disque", color: "var(--amber)", values: pts.map((p) => p.iowait ?? 0) }]} max={1} format={(v) => pct(v)} times={t} height={80} />
            <LineChart title="Charge" series={[{ label: "Charge", color: "var(--blue)", values: pts.map((p) => p.loadavg ?? 0) }]} format={(v) => v.toFixed(2)} times={t} height={70} />
            <LineChart title="Réseau" series={[{ label: "Entrant", color: "var(--green)", values: pts.map((p) => p.netin ?? 0) }, { label: "Sortant", color: "var(--orange)", values: pts.map((p) => p.netout ?? 0) }]} format={(v) => rate(v)} times={t} height={70} />
          </div>
        </Panel>
        <div className="stack">
          <Panel title="Points de contrôle" pad={false}>
            {[
              { ok: !stoppedServices.length, t: "Services Proxmox", d: stoppedServices.length ? `Arrêté(s) : ${stoppedServices.map((s: any) => s.name).join(", ")}` : "Tous les services actifs tournent" },
              { ok: !badDisks.length, t: "Santé SMART des disques", d: badDisks.length ? badDisks.map((x: any) => `${x.devpath} : ${x.health}`).join(", ") : `${d.disks.length} disque(s) sans défaut signalé` },
              { ok: !badZfs.length, t: "Pools ZFS", d: d.zfs.length ? (badZfs.length ? badZfs.map((p: any) => `${p.name} : ${p.health}`).join(", ") : `${d.zfs.length} pool(s) ONLINE`) : "Aucun pool ZFS" },
              { ok: !certSoon.length, t: "Certificats", d: certSoon.length ? certSoon.map((c: any) => `${c.filename} expire le ${date(c.notafter, true)}`).join(", ") : "Aucun certificat n'expire dans les 30 jours" },
              { ok: !(d.updates?.length), t: "Mises à jour", d: d.updates?.length ? `${d.updates.length} paquet(s) à mettre à jour` : "Le système est à jour (selon la dernière vérification de Proxmox)" },
              { ok: d.subscription?.status === "active", t: "Abonnement", d: d.subscription?.status === "active" ? `Actif (${d.subscription.level})` : "Pas d'abonnement : utilise le dépôt no-subscription", soft: true },
            ].map((x) => (
              <div className="finding" key={x.t}>
                <span className={`lvl ${x.ok ? "ok" : x.soft ? "info" : "warning"}`}>{x.ok ? "OK" : x.soft ? "Info" : "À voir"}</span>
                <div><div className="t">{x.t}</div><div className="d">{x.d}</div></div>
              </div>
            ))}
          </Panel>
          {d.status && (
            <Panel title="Matériel et version">
              <div className="kv">
                <div>Processeur</div><div>{d.status.cpuinfo?.model}</div>
                <div>Cœurs / threads</div><div>{d.status.cpuinfo?.cores ?? "?"} / {d.status.cpuinfo?.cpus} ({d.status.cpuinfo?.sockets} socket)</div>
                <div>Virtualisation</div><div>{/svm|vmx/.test(d.status.cpuinfo?.flags ?? "svm") ? "Disponible (AMD-V / VT-x)" : "Non détectée"}</div>
                <div>Proxmox</div><div className="mono">{d.status.pveversion}</div>
                <div>Noyau</div><div className="mono small">{d.status.kversion}</div>
                <div>Démarrage</div><div>{d.status["boot-info"]?.mode === "efi" ? "UEFI" : "BIOS"}{d.status["boot-info"]?.secureboot ? " + Secure Boot" : ""}</div>
                <div>Allumé depuis</div><div>{uptime(d.status.uptime)}</div>
                <div>Charge</div><div className="mono">{(d.status.loadavg ?? []).join("  ")}</div>
                <div>KSM partagé</div><div>{bytes(d.status.ksm?.shared)}</div>
                {d.certificates.map((c: any) => (<Fragment key={c.filename}><div>{c.filename}</div><div>Expire le {date(c.notafter, true)}</div></Fragment>))}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {power && (
        <Confirm
          title={power === "reboot" ? `Redémarrer ${node} ?` : `Éteindre ${node} ?`}
          danger
          confirmLabel="Continuer"
          onConfirm={() => setPower2(power)}
          onClose={() => setPower(null)}
        >
          <p>{power === "reboot" ? "Toutes les machines du nœud s'arrêtent puis redémarrent si elles sont en démarrage automatique. MyProxmox sera injoignable pendant quelques minutes s'il tourne sur ce nœud." : "Toutes les machines du nœud s'arrêtent. Il faudra rallumer le serveur à la main (bouton ou IPMI)."}</p>
        </Confirm>
      )}
      {power2 && (
        <Confirm
          title={`Dernière confirmation : ${power2 === "reboot" ? "redémarrer" : "éteindre"} ${node}`}
          danger
          requireText={node}
          confirmLabel={power2 === "reboot" ? "Redémarrer maintenant" : "Éteindre maintenant"}
          onConfirm={async () => {
            try {
              await pve.post(`/nodes/${node}/status`, { command: power2 });
              toast(power2 === "reboot" ? `${node} redémarre` : `${node} s'éteint`, "ok");
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setPower2(null)}
        >
          <p>Tape le nom du nœud pour confirmer.</p>
        </Confirm>
      )}
      {bulk && (
        <Modal title={bulk === "startall" ? "Tout démarrer" : bulk === "stopall" ? "Tout arrêter" : "Tout migrer"} onClose={() => setBulk(null)}>
          <div className="stack">
            <Notice kind={bulk === "stopall" ? "warn" : "info"}>
              {bulk === "startall" ? "Démarre les machines du nœud réglées pour démarrer avec le serveur (ou toutes, si tu coches « forcer »), dans l'ordre de démarrage." : bulk === "stopall" ? "Arrête proprement toutes les machines du nœud, dans l'ordre inverse du démarrage." : "Déplace toutes les machines vers un autre nœud, par exemple avant une maintenance."}
            </Notice>
            <Form
              fields={[
                ...(bulk === "startall" ? [{ name: "force", label: "Démarrer aussi celles qui ne sont pas en démarrage automatique", type: "checkbox" as const }] : []),
                ...(bulk === "migrateall" ? [
                  { name: "target", label: "Nœud cible", type: "api-select" as const, required: true, load: async () => (await pve.get<any[]>("/nodes")).filter((n) => n.node !== node && n.status === "online").map((n) => ({ value: n.node, label: n.node })) },
                  { name: "maxworkers", label: "Migrations en parallèle", type: "number" as const, min: 1, max: 16, default: 2 },
                  { name: "with-local-disks", label: "Copier aussi les disques locaux", type: "checkbox" as const, default: true },
                ] : []),
                ...(bulk === "stopall" ? [{ name: "timeout", label: "Délai avant arrêt forcé", type: "number" as const, unit: "s", min: 0, default: 180, advanced: true }] : []),
              ]}
              submitLabel={bulk === "startall" ? "Tout démarrer" : bulk === "stopall" ? "Tout arrêter" : "Tout migrer"}
              onCancel={() => setBulk(null)}
              onSubmit={async (_c, v) => {
                const body: Record<string, unknown> = bulk === "startall" ? { force: v.force ? 1 : 0 } : bulk === "stopall" ? { timeout: v.timeout } : { target: v.target, maxworkers: v.maxworkers, "with-local-disks": v["with-local-disks"] ? 1 : 0 };
                const upid = bulk === "startall" ? await pve.post<string>(`/nodes/${node}/startall`, body) : bulk === "stopall" ? await pve.post<string>(`/nodes/${node}/stopall`, body) : await pve.post<string>(`/nodes/${node}/migrateall`, body);
                watch(node, upid);
                setBulk(null);
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

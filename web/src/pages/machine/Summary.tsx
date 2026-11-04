// Onglet « Résumé » : utilisation, configuration, notes en Markdown.
import { Fragment, useState } from "react";
import { Button, Empty, Meter, Panel, useToast } from "../../components/ui";
import { LineChart } from "../../components/Chart";
import { pve, usePoll } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { Markdown } from "../../lib/markdown";
import { bytes, pct, rate } from "../../../../shared/format";
import { DISK_KEY, isCdrom, type GuestCtx } from "./common";

export function Summary({ ctx, s }: { ctx: GuestCtx; s: any }) {
  const c = ctx.conf;
  const [range, setRange] = useState<"hour" | "day" | "week">("hour");
  const rrd = usePoll(() => pve.get<any[]>(`${ctx.base}/rrddata`, { timeframe: range }), 60000, [ctx.base, range]);
  const pts = (rrd.data ?? []).filter((p) => p.cpu !== undefined);
  const t = pts.map((p) => p.time);
  const disks = Object.entries(c).filter(([k, v]) => (DISK_KEY.test(k) && !isCdrom(v)) || k === "rootfs" || /^mp\d+$/.test(k));
  const nets = Object.entries(c).filter(([k]) => /^net\d+$/.test(k));
  const q = ctx.type === "qemu";

  return (
    <div className="stack">
      <div className="grid g2">
        <Panel title="Utilisation" right={
          <select className="input select" aria-label="Période des graphiques" style={{ height: 28, width: 140 }} value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
            <option value="hour">Dernière heure</option><option value="day">24 heures</option><option value="week">7 jours</option>
          </select>
        }>
          {s ? (
            <div className="stack">
              <Meter label="Processeur" value={s.cpu} max={1} text={`${pct(s.cpu)} de ${s.cpus ?? s.maxcpu ?? c.cores} cœurs`} />
              <Meter label="Mémoire" value={s.mem} max={s.maxmem} text={`${bytes(s.mem)} / ${bytes(s.maxmem)}`} />
              {!q && <Meter label="Disque" value={s.disk} max={s.maxdisk} text={`${bytes(s.disk)} / ${bytes(s.maxdisk)}`} />}
              <LineChart title="Processeur" series={[{ label: "CPU", color: "var(--orange)", values: pts.map((p) => p.cpu) }]} max={1} format={(v) => pct(v)} times={t} height={90} />
              <LineChart title="Mémoire" series={[{ label: "RAM", color: "var(--blue)", values: pts.map((p) => p.mem ?? 0) }]} max={pts[0]?.maxmem} format={(v) => bytes(v)} times={t} height={90} />
              <LineChart title="Réseau" series={[{ label: "Entrant", color: "var(--green)", values: pts.map((p) => p.netin ?? 0) }, { label: "Sortant", color: "var(--orange)", values: pts.map((p) => p.netout ?? 0) }]} format={(v) => rate(v)} times={t} height={90} />
            </div>
          ) : <Empty>Chargement…</Empty>}
        </Panel>
        <Panel title="Configuration">
          <div className="kv">
            <div>Cœurs</div><div>{c.cores ?? (q ? 1 : "tous")}{Number(c.sockets) > 1 ? ` × ${c.sockets} sockets` : ""}</div>
            <div>Mémoire</div><div>{c.memory} Mo{c.swap !== undefined ? ` · swap ${c.swap} Mo` : ""}</div>
            <div>Système</div><div>{c.ostype ?? "-"}</div>
            <div>Démarrage auto</div><div>{Number(c.onboot) ? "Oui, au démarrage du serveur" : "Non"}</div>
            {c.tags && (<><div>Tags</div><div className="chips">{String(c.tags).split(/[;,\s]+/).filter(Boolean).map((tg: string) => <span key={tg} className="chip">{tg}</span>)}</div></>)}
            {q && (<><div>Agent invité</div><div>{String(c.agent ?? "0").startsWith("1") ? "Activé" : <span className="muted">Désactivé : sans lui, pas d&apos;adresse IP ni d&apos;arrêt propre garanti</span>}</div></>)}
            {q && (<><div>Micrologiciel</div><div>{c.bios === "ovmf" ? "UEFI (OVMF)" : "BIOS (SeaBIOS)"}{c.machine ? ` · ${c.machine}` : ""}</div></>)}
            {disks.map(([k, v]) => (<Fragment key={k}><div>Disque {k}</div><div className="mono small">{String(v)}</div></Fragment>))}
            {nets.map(([k, v]) => (<Fragment key={k}><div>Réseau {k}</div><div className="mono small">{String(v)}</div></Fragment>))}
          </div>
        </Panel>
      </div>
      <Notes ctx={ctx} />
    </div>
  );
}

function Notes({ ctx }: { ctx: GuestCtx }) {
  const { toast } = useToast();
  const { allowed } = usePermission(`/vms/${ctx.vmid}`, "VM.Config.Options");
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = ctx.conf.description ?? "";
  return (
    <Panel title="Notes" right={edit === null
      ? <Button size="sm" disabled={!allowed} title={allowed ? undefined : "Il te manque le droit VM.Config.Options"} onClick={() => setEdit(text)}>Modifier</Button>
      : (
        <span className="row">
          <Button size="sm" onClick={() => setEdit(null)}>Annuler</Button>
          <Button size="sm" variant="primary" busy={busy} onClick={async () => {
            setBusy(true);
            try {
              await pve.put(`${ctx.base}/config`, edit ? { description: edit } : { delete: "description" });
              toast("Notes enregistrées", "ok");
              setEdit(null);
              ctx.refresh();
            } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
          }}>Enregistrer</Button>
        </span>
      )}>
      {edit !== null ? (
        <div className="grid g2">
          <textarea className="input mono" aria-label="Notes en Markdown" rows={12} value={edit} onChange={(e) => setEdit(e.target.value)} placeholder={"## À quoi sert cette machine\n- **Accès** : https://...\n- Sauvegardée chaque nuit"} />
          <div className="md-preview"><Markdown text={edit || "_Aperçu_"} /></div>
        </div>
      ) : text ? <Markdown text={text} /> : <span className="muted">Aucune note. Tu peux noter ici à quoi sert la machine, ses accès, ses particularités (Markdown accepté).</span>}
    </Panel>
  );
}

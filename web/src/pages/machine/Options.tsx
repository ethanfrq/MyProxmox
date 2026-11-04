// Onglet « Options » : nom, démarrage, ordre de boot, agent, protection, ajout à chaud, verrou...
import { useState, type ReactNode } from "react";
import { Button, Confirm, Modal, Notice, Panel, useToast } from "../../components/ui";
import { pve } from "../../lib/api";
import { usePermission } from "../../lib/permissions";
import { DISK_KEY, OSTYPES_LXC, OSTYPES_QEMU, isCdrom, parseProps, type GuestCtx } from "./common";
import { option, type Spec } from "./specs";
import { SpecDialog } from "./SpecDialog";

const yesNo = (v?: string, def = false) => ((v === undefined ? def : v === "1") ? "Oui" : "Non");

export function Options({ ctx }: { ctx: GuestCtx }) {
  const { toast } = useToast();
  const c = ctx.conf;
  const q = ctx.type === "qemu";
  const [spec, setSpec] = useState<Spec | null>(null);
  const [boot, setBoot] = useState(false);
  const [unlock, setUnlock] = useState(false);
  const { allowed } = usePermission(`/vms/${ctx.vmid}`, "VM.Config.Options");
  const startup = parseProps(c.startup ?? "", "_");
  const agent = parseProps(c.agent ?? "0", "enabled");
  const os = (q ? OSTYPES_QEMU : OSTYPES_LXC).find((o) => o.value === c.ostype)?.label ?? c.ostype ?? "-";

  const rows: [string, string, ReactNode][] = q
    ? [
      ["name", "Nom", c.name],
      ["onboot", "Démarrer avec le serveur", yesNo(c.onboot)],
      ["startup", "Ordre de démarrage", c.startup ? `ordre ${startup.order ?? "-"}${startup.up ? `, attente ${startup.up} s` : ""}${startup.down ? `, arrêt ${startup.down} s` : ""}` : "par défaut"],
      ["ostype", "Système invité", os],
      ["boot", "Ordre de boot", (c.boot ?? "").replace(/^order=/, "").split(";").filter(Boolean).join(" → ") || "par défaut"],
      ["agent", "Agent invité QEMU", agent.enabled === "1" ? `Activé${agent.fstrim_cloned_disks === "1" ? ", TRIM après clonage" : ""}` : "Désactivé"],
      ["protection", "Protection", yesNo(c.protection)],
      ["hotplug", "Ajout à chaud", c.hotplug ?? "disk, network, usb"],
      ["tags", "Tags", c.tags ? c.tags.split(";").join(", ") : "aucun"],
      ["kvm", "Virtualisation matérielle (KVM)", yesNo(c.kvm, true)],
      ["acpi", "ACPI", yesNo(c.acpi, true)],
      ["tablet", "Pointeur tablette", yesNo(c.tablet, true)],
      ["localtime", "Horloge à l'heure locale", yesNo(c.localtime)],
      ["freeze", "Pause au démarrage", yesNo(c.freeze)],
      ["hookscript", "Script d'accroche", c.hookscript ?? "aucun"],
    ]
    : [
      ["hostname", "Nom d'hôte", c.hostname],
      ["onboot", "Démarrer avec le serveur", yesNo(c.onboot)],
      ["startup", "Ordre de démarrage", c.startup ? `ordre ${startup.order ?? "-"}${startup.up ? `, attente ${startup.up} s` : ""}${startup.down ? `, arrêt ${startup.down} s` : ""}` : "par défaut"],
      ["ostype", "Système", os],
      ["arch", "Architecture", c.arch ?? "amd64"],
      ["unprivileged", "Non privilégié", yesNo(c.unprivileged)],
      ["protection", "Protection", yesNo(c.protection)],
      ["tags", "Tags", c.tags ? c.tags.split(";").join(", ") : "aucun"],
      ["console", "Console", yesNo(c.console, true)],
      ["tty", "Consoles tty", c.tty ?? "2"],
      ["cmode", "Mode de console", c.cmode ?? "tty"],
      ["hookscript", "Script d'accroche", c.hookscript ?? "aucun"],
    ];

  return (
    <div className="stack">
      {c.lock && (
        <Notice kind="warn">
          La machine est verrouillée ({c.lock}) : une opération est en cours ou s&apos;est mal terminée. Si rien ne tourne,{" "}
          <button type="button" className="link-btn" onClick={() => setUnlock(true)}>retire le verrou</button>.
        </Notice>
      )}
      <Panel pad={false} title="Options">
        <table className="table hw-table">
          <tbody>
            {rows.map(([key, label, value]) => {
              const editable = key === "boot" || !!option(ctx, key);
              return (
                <tr key={key}>
                  <td style={{ width: 240 }}><strong>{label}</strong></td>
                  <td>{value}</td>
                  <td className="actions">
                    {editable && (
                      <Button size="sm" disabled={!allowed} title={allowed ? undefined : "Il te manque le droit VM.Config.Options"} onClick={() => (key === "boot" ? setBoot(true) : setSpec(option(ctx, key)))}>
                        Modifier
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      {spec && <SpecDialog ctx={ctx} spec={spec} onClose={() => setSpec(null)} />}
      {boot && <BootOrder ctx={ctx} onClose={() => setBoot(false)} />}
      {unlock && (
        <Confirm title="Retirer le verrou ?" danger confirmLabel="Retirer le verrou" onConfirm={async () => {
          try {
            await pve.put(`${ctx.base}/config`, { delete: "lock", skiplock: 1 });
            toast("Verrou retiré", "ok");
            ctx.refresh();
          } catch (e) { toast(`${(e as Error).message}. Il faut être root@pam pour retirer un verrou.`, "error"); }
        }} onClose={() => setUnlock(false)}>
          <p>Ne le fais que si aucune sauvegarde, migration ou snapshot n&apos;est en cours sur cette machine.</p>
        </Confirm>
      )}
    </div>
  );
}

/** Ordre de boot : on coche les périphériques et on les classe. */
function BootOrder({ ctx, onClose }: { ctx: GuestCtx; onClose: () => void }) {
  const { toast } = useToast();
  const c = ctx.conf;
  const devices = Object.keys(c).filter((k) => DISK_KEY.test(k) || /^net\d+$/.test(k) || /^hostpci\d+$/.test(k) || /^usb\d+$/.test(k));
  const current = (c.boot ?? "").replace(/^order=/, "").split(";").filter((d) => devices.includes(d));
  const [list, setList] = useState<{ dev: string; on: boolean }[]>([...current.map((dev) => ({ dev, on: true })), ...devices.filter((d) => !current.includes(d)).map((dev) => ({ dev, on: false }))]);
  const [busy, setBusy] = useState(false);
  const label = (d: string) => (/^net/.test(d) ? "réseau (PXE)" : isCdrom(c[d]) ? "CD/DVD" : /^hostpci/.test(d) ? "PCI" : /^usb/.test(d) ? "USB" : "disque");
  const move = (i: number, d: number) => setList((l) => {
    const n = [...l];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  return (
    <Modal title="Ordre de boot" onClose={onClose} foot={
      <>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" busy={busy} onClick={async () => {
          setBusy(true);
          try {
            await pve.put(`${ctx.base}/config`, { boot: `order=${list.filter((x) => x.on).map((x) => x.dev).join(";")}` });
            toast("Ordre de boot enregistré", "ok");
            ctx.refresh();
            onClose();
          } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
        }}>Enregistrer</Button>
      </>
    }>
      <p className="small muted">La VM essaie les périphériques cochés, de haut en bas.</p>
      <ol className="order-list">
        {list.map((x, i) => (
          <li key={x.dev}>
            <label className="check"><input type="checkbox" checked={x.on} onChange={(e) => setList((l) => l.map((y) => (y.dev === x.dev ? { ...y, on: e.target.checked } : y)))} /> <span className="mono">{x.dev}</span> <span className="muted small">{label(x.dev)}</span></label>
            <span className="btn-group">
              <Button size="sm" disabled={i === 0} aria-label={`Monter ${x.dev}`} onClick={() => move(i, -1)}>↑</Button>
              <Button size="sm" disabled={i === list.length - 1} aria-label={`Descendre ${x.dev}`} onClick={() => move(i, 1)}>↓</Button>
            </span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

import { useState } from "react";
import { Button, Confirm, useToast } from "./ui";
import { I } from "./icons";
import { pve } from "../lib/api";
import { usePermission } from "../lib/permissions";

export interface GuestRef { node: string; type: "qemu" | "lxc"; vmid: number; name: string; status: string }

/** Boutons d'alimentation d'une machine. `full` ajoute l'arrêt forcé. */
export function GuestActions({ g, onChange, full, size }: { g: GuestRef; onChange?: () => void; full?: boolean; size?: "sm" }) {
  const { watch, toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"stop" | "reboot" | "shutdown" | null>(null);

  async function act(action: string) {
    setBusy(action);
    try {
      const upid = await pve.post(`/nodes/${g.node}/${g.type}/${g.vmid}/status/${action}`);
      watch(g.node, upid, undefined, onChange);
      setTimeout(() => onChange?.(), 1200);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const running = g.status === "running";
  const { allowed, loading } = usePermission(`/vms/${g.vmid}`, "VM.PowerMgmt");
  if (!allowed && !loading) return null; // pas le droit : on masque les boutons d'alimentation
  return (
    <span className="btn-group" onClick={(e) => e.stopPropagation()}>
      {!running && <Button size={size} variant={full ? "primary" : "default"} icon={<I.play />} busy={busy === "start"} onClick={() => act("start")}>Démarrer</Button>}
      {running && (
        <>
          <Button size={size} icon={<I.power />} busy={busy === "shutdown"} onClick={() => setConfirm("shutdown")}>Éteindre</Button>
          <Button size={size} icon={<I.reboot />} busy={busy === "reboot"} onClick={() => setConfirm("reboot")}>Redémarrer</Button>
          {full && <Button size={size} variant="danger" icon={<I.stop />} busy={busy === "stop"} onClick={() => setConfirm("stop")}>Arrêt forcé</Button>}
        </>
      )}
      {confirm && (
        <Confirm
          title={confirm === "stop" ? `Arrêt forcé de ${g.name} ?` : confirm === "reboot" ? `Redémarrer ${g.name} ?` : `Éteindre ${g.name} ?`}
          danger={confirm === "stop"}
          confirmLabel={confirm === "stop" ? "Couper l'alimentation" : confirm === "reboot" ? "Redémarrer" : "Éteindre"}
          onConfirm={() => act(confirm)}
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === "stop"
              ? "Revient à débrancher la prise : tout ce qui n'est pas enregistré est perdu. Préfère « Éteindre » si la machine répond encore."
              : confirm === "shutdown"
                ? "Proxmox demande au système invité de s'éteindre proprement."
                : "Les services de cette machine seront coupés quelques instants."}
          </p>
        </Confirm>
      )}
    </span>
  );
}

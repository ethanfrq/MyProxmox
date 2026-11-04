// Onglet « Console » : écran de la VM (noVNC) ou terminal du conteneur (xterm.js), dans MyProxmox.
// Chargé à la demande pour ne pas alourdir le reste de l'app.
import { useState } from "react";
import { Notice } from "../../components/ui";
import { TermConsole } from "../../components/console/TermConsole";
import { VncConsole } from "../../components/console/VncConsole";
import { usePermission } from "../../lib/permissions";
import { useApp } from "../../lib/app";
import type { GuestCtx } from "./common";

export default function ConsoleTab({ ctx }: { ctx: GuestCtx }) {
  const { settings, me } = useApp();
  const { allowed, loading } = usePermission(`/vms/${ctx.vmid}`, "VM.Console");
  const [serial, setSerial] = useState(false);
  const target = { node: ctx.node, type: ctx.type, vmid: String(ctx.vmid) };
  // api: POST /nodes/{node}/qemu/{vmid}/vncproxy
  // api: POST /nodes/{node}/qemu/{vmid}/termproxy
  // api: POST /nodes/{node}/lxc/{vmid}/termproxy
  const fallback = settings?.pveUrl ? `${settings.pveUrl}/?console=${ctx.type === "qemu" ? "kvm" : "lxc"}&novnc=1&vmid=${ctx.vmid}&vmname=${encodeURIComponent(ctx.name)}&node=${ctx.node}&resize=off&cmd=` : "";
  if (me.kind === "local") return <Notice kind="warn">La console demande un compte Proxmox : connecte-toi avec ton compte Proxmox pour l&apos;ouvrir.</Notice>;
  if (!loading && !allowed) return <Notice kind="warn">Il te manque le droit VM.Console sur cette machine.</Notice>;
  if (!ctx.running) return <Notice>La machine est arrêtée. Démarre-la pour ouvrir sa console.</Notice>;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        {ctx.type === "qemu" && ctx.conf.serial0 ? (
          <span className="btn-group">
            <button className={`btn btn-sm ${!serial ? "btn-dark" : ""}`} onClick={() => setSerial(false)}>Écran</button>
            <button className={`btn btn-sm ${serial ? "btn-dark" : ""}`} onClick={() => setSerial(true)}>Terminal série</button>
          </span>
        ) : <span />}
        {fallback && <a className="small muted" href={fallback} target="_blank" rel="noreferrer">Ouvrir la console de Proxmox à la place</a>}
      </div>
      {ctx.type === "lxc" || serial
        ? <TermConsole key={serial ? "serial" : "ct"} proxy={`${ctx.base}/termproxy`} target={target} label={ctx.name} />
        : <VncConsole proxy={`${ctx.base}/vncproxy`} target={target} label={ctx.name} />}
    </div>
  );
}

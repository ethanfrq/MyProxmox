// Écran d'une VM avec noVNC, relié à vncproxy de Proxmox via /api/console.
import { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";
import { pve } from "../../lib/api";
import { DEMO } from "../../lib/env";
import { useApp } from "../../lib/app";

type State = "connexion" | "connecté" | "fermé" | "erreur";

export function VncConsole({ proxy, target, label }: { proxy: string; target: Record<string, string>; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [state, setState] = useState<State>("connexion");
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const demo = DEMO || useApp().me.demo;

  useEffect(() => {
    if (demo) {
      setState("erreur");
      setError("La démo n'a pas d'écran de VM à montrer. Sur ton serveur, l'écran de la VM s'affiche ici.");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await pve.post<{ port: string; ticket: string }>(proxy, { websocket: 1 });
        if (!alive) return;
        const q = new URLSearchParams({ ...target, mode: "vnc", port: String(r.port), vncticket: r.ticket });
        const c = new RFB(box.current!, `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/console?${q}`, { credentials: { password: r.ticket }, wsProtocols: ["binary"] });
        c.scaleViewport = true;
        c.background = "#111";
        c.addEventListener("connect", () => { setState("connecté"); c.focus(); });
        c.addEventListener("disconnect", (e) => {
          const clean = (e as CustomEvent).detail?.clean;
          setState(clean ? "fermé" : "erreur");
          if (!clean) setError("Connexion perdue. La VM est-elle allumée ? Tu dois avoir le droit VM.Console.");
        });
        c.addEventListener("securityfailure", () => { setState("erreur"); setError("Proxmox a refusé l'accès à l'écran."); });
        rfb.current = c;
      } catch (e) {
        setState("erreur");
        setError(`${(e as Error).message}. Vérifie que la VM est allumée.`);
      }
    })();
    return () => {
      alive = false;
      rfb.current?.disconnect();
      rfb.current = null;
    };
  }, [proxy, round]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="console">
      <div className="console-bar">
        <span className={`badge ${state === "connecté" ? "on" : state === "connexion" ? "warn" : "err"}`}>{state === "connecté" ? "Connecté" : state === "connexion" ? "Connexion…" : state === "fermé" ? "Session terminée" : "Indisponible"}</span>
        {error && <span className="small" style={{ color: "var(--red)" }}>{error}</span>}
        <span style={{ marginLeft: "auto" }} />
        <button className="btn btn-sm" disabled={state !== "connecté"} onClick={() => rfb.current?.sendCtrlAltDel()}>Ctrl+Alt+Suppr</button>
        <button className="btn btn-sm" onClick={() => box.current?.requestFullscreen?.()}>Plein écran</button>
        {state !== "connecté" && state !== "connexion" && !demo && <button className="btn btn-sm" onClick={() => { setError(""); setState("connexion"); setRound((x) => x + 1); }}>Se reconnecter</button>}
      </div>
      <div ref={box} className="console-vnc" aria-label={`Écran de ${label}`} />
    </div>
  );
}

// Terminal xterm.js relié à termproxy de Proxmox (conteneur ou shell du nœud), via /api/console.
// Protocole termproxy : « utilisateur:ticket\n », puis « 0:longueur:données », « 1:colonnes:lignes: », « 2 » (ping).
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { pve } from "../../lib/api";
import { DEMO } from "../../lib/env";

type State = "connexion" | "connecté" | "fermé" | "erreur";

/** Faux shell local pour la démo publiée (pas de serveur derrière). */
function demoShell(term: Terminal, label: string) {
  let line = "";
  const reply: Record<string, string> = {
    ls: "bin  boot  dev  etc  home  lib  opt  root  srv  tmp  usr  var",
    "uname -a": "Linux demo 6.8.12-4-pve #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux",
    uptime: " 10:12:01 up 23 days,  1:10,  1 user,  load average: 0.97, 1.12, 0.98",
    help: "Démo MyProxmox : essaie ls, uname -a, uptime.",
  };
  term.write(`Console de démonstration (${label}). Tape « help ».\r\nroot@${label}:~# `);
  term.onData((d) => {
    for (const ch of d) {
      if (ch === "\r") {
        const cmd = line.trim();
        line = "";
        term.write(`\r\n${cmd ? (reply[cmd] ?? `${cmd} : commande inconnue dans la démo`) : ""}${cmd ? "\r\n" : ""}root@${label}:~# `);
      } else if (ch === "\u007f") {
        if (line) { line = line.slice(0, -1); term.write("\b \b"); }
      } else if (ch >= " ") { line += ch; term.write(ch); }
    }
  });
}

/** `proxy` : chemin POST termproxy ; `target` : paramètres du relais (node, type, vmid). */
export function TermConsole({ proxy, target, label, cmd }: { proxy: string; target: Record<string, string>; label: string; cmd?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("connexion");
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 14, theme: { background: "#1e1e1e" }, convertEol: false });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current!);
    fit.fit();
    term.focus();
    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    const onResize = () => {
      fit.fit();
      if (ws?.readyState === WebSocket.OPEN) ws.send(`1:${term.cols}:${term.rows}:`);
    };
    window.addEventListener("resize", onResize);
    if (DEMO) {
      setState("connecté");
      demoShell(term, label);
    } else {
      (async () => {
        try {
          const r = await pve.post<{ port: string; ticket: string; user: string }>(proxy, cmd ? { cmd } : {});
          const q = new URLSearchParams({ ...target, mode: "term", port: String(r.port), vncticket: r.ticket });
          ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/console?${q}`, "binary");
          ws.binaryType = "arraybuffer";
          let ok = false;
          const dec = new TextDecoder();
          ws.onopen = () => ws!.send(`${r.user}:${r.ticket}\n`);
          ws.onmessage = (e) => {
            const text = typeof e.data === "string" ? e.data : dec.decode(e.data as ArrayBuffer, { stream: true });
            if (!ok) {
              if (text.startsWith("OK")) {
                ok = true;
                setState("connecté");
                ws!.send(`1:${term.cols}:${term.rows}:`);
                const rest = text.slice(2);
                if (rest) term.write(rest);
                return;
              }
              setState("erreur");
              setError("Proxmox a refusé l'authentification de la console.");
              return;
            }
            term.write(text);
          };
          ws.onclose = (e) => {
            setState((s) => (s === "erreur" ? s : "fermé"));
            if (e.code !== 1000 && e.reason) setError(e.reason);
          };
          ws.onerror = () => { setState("erreur"); setError("Connexion à la console impossible. Vérifie que tu as le droit VM.Console (ou Sys.Console pour un nœud)."); };
          const enc = new TextEncoder();
          term.onData((d) => ws?.readyState === WebSocket.OPEN && ws.send(`0:${enc.encode(d).length}:${d}`));
          ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("2"), 30000);
        } catch (e) {
          setState("erreur");
          setError(`${(e as Error).message}. Vérifie que la machine est allumée et que tu as le droit d'ouvrir sa console.`);
        }
      })();
    }
    return () => {
      window.removeEventListener("resize", onResize);
      clearInterval(ping);
      ws?.close();
      term.dispose();
    };
  }, [proxy, round]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="console">
      <div className="console-bar">
        <span className={`badge ${state === "connecté" ? "on" : state === "connexion" ? "warn" : "err"}`}>{state === "connecté" ? "Connecté" : state === "connexion" ? "Connexion…" : state === "fermé" ? "Session terminée" : "Erreur"}</span>
        {error && <span className="small" style={{ color: "var(--red)" }}>{error}</span>}
        <span style={{ marginLeft: "auto" }} />
        {state !== "connecté" && state !== "connexion" && <button className="btn btn-sm" onClick={() => { setError(""); setState("connexion"); setRound((r) => r + 1); }}>Se reconnecter</button>}
      </div>
      <div ref={box} className="console-term" role="application" aria-label={`Terminal de ${label}`} />
    </div>
  );
}

// Relais WebSocket des consoles : le navigateur se connecte à /api/console, le serveur
// vérifie la session (compte Proxmox uniquement), puis relaie vers vncwebsocket de Proxmox
// avec le ticket de la personne. Le ticket VNC a été obtenu juste avant par le navigateur
// (vncproxy ou termproxy, via la passerelle /api/pve, donc avec ses propres droits).
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { DEMO, getConfig, logActivity } from "./config";
import { clientIp, ipAllowed } from "./ipfilter";
import { getSession } from "./sessions";

const wss = new WebSocketServer({ noServer: true });

function reject(socket: Duplex, status: number, msg: string) {
  socket.write(`HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${msg}`);
  socket.destroy();
}

/** Chemin Proxmox du WebSocket selon la cible (machine ou shell du nœud). */
function upstreamPath(q: URLSearchParams) {
  const node = q.get("node") ?? "";
  const type = q.get("type") ?? "";
  const vmid = q.get("vmid") ?? "";
  if (!/^[\w.-]+$/.test(node)) return null;
  // api: GET /nodes/{node}/vncwebsocket
  if (type === "node") return `/nodes/${node}/vncwebsocket`;
  if (!/^(qemu|lxc)$/.test(type) || !/^\d+$/.test(vmid)) return null;
  // api: GET /nodes/{node}/qemu/{vmid}/vncwebsocket
  // api: GET /nodes/{node}/lxc/{vmid}/vncwebsocket
  return `/nodes/${node}/${type}/${vmid}/vncwebsocket`;
}

/** Faux shell pour le mode démo : répond à quelques commandes. */
function demoShell(ws: WebSocket, label: string) {
  let line = "";
  const prompt = () => ws.send(`\r\nroot@${label}:~# `);
  const reply: Record<string, string> = {
    ls: "bin  boot  dev  etc  home  lib  opt  root  srv  tmp  usr  var",
    "uname -a": "Linux demo 6.8.12-4-pve #1 SMP PREEMPT_DYNAMIC PMX 6.8.12-4 x86_64 GNU/Linux",
    uptime: " 10:12:01 up 23 days,  1:10,  1 user,  load average: 0.97, 1.12, 0.98",
    whoami: "root",
    help: "Démo MyProxmox : essaie ls, uname -a, uptime, whoami, df -h, exit.",
    "df -h": "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        30G   12G   17G  41% /",
  };
  let authed = false;
  ws.on("message", (raw: RawData) => {
    const msg = raw.toString();
    if (!authed) {
      authed = true;
      ws.send("OK");
      ws.send(`Bienvenue dans la console de démonstration (${label}).\r\nTape « help » pour la liste des commandes.`);
      prompt();
      return;
    }
    if (msg.startsWith("1:") || msg === "2") return; // redimensionnement, ping
    const data = msg.replace(/^0:\d+:/, "");
    for (const ch of data) {
      if (ch === "\r") {
        const cmd = line.trim();
        line = "";
        if (cmd === "exit") return ws.close(1000, "fin de session");
        ws.send(`\r\n${(reply[cmd] ?? (cmd ? `${cmd.split(" ")[0]} : commande inconnue dans la démo` : "")).replace(/\n/g, "\r\n")}`);
        prompt();
      } else if (ch === "\u007f") {
        if (line) { line = line.slice(0, -1); ws.send("\b \b"); }
      } else if (ch >= " ") {
        line += ch;
        ws.send(ch);
      }
    }
  });
}

export function attachConsole(server: Server) {
  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/api/console") return reject(socket, 404, "Introuvable");
    const ip = clientIp(req as never);
    if (!ipAllowed(ip)) return reject(socket, 403, `Adresse ${ip} non autorisée`);
    // Protection contre les connexions ouvertes depuis un autre site
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return reject(socket, 403, "Origine refusée");
    const s = await getSession(req as never);
    if (!s) return reject(socket, 401, "Session expirée, reconnecte-toi.");
    if (s.kind !== "proxmox") return reject(socket, 403, "La console demande un compte Proxmox.");
    const q = url.searchParams;
    const path = upstreamPath(q);
    if (!path) return reject(socket, 400, "Cible de console invalide.");

    wss.handleUpgrade(req, socket, head, (client) => {
      const target = q.get("type") === "node" ? `shell ${q.get("node")}` : `${q.get("type")} ${q.get("vmid")}`;
      logActivity({ actor: s.username, action: "console ouverte", target, result: "ok" }).catch(() => {});
      if (DEMO) {
        if (q.get("mode") === "vnc") return client.close(4000, "Pas d'écran simulé en démo");
        return demoShell(client, q.get("type") === "node" ? String(q.get("node")) : `ct${q.get("vmid")}`);
      }
      const c = getConfig();
      const wsUrl = `${c.pve!.url.replace(/^http/, "ws")}/api2/json${path}?port=${encodeURIComponent(q.get("port") ?? "")}&vncticket=${encodeURIComponent(q.get("vncticket") ?? "")}`;
      const up = new WebSocket(wsUrl, "binary", {
        headers: { Cookie: `PVEAuthCookie=${encodeURIComponent(s.ticket)}` },
        rejectUnauthorized: !c.pve!.insecureTls,
      });
      const pending: { data: RawData; binary: boolean }[] = [];
      client.on("message", (data, binary) => (up.readyState === WebSocket.OPEN ? up.send(data, { binary }) : pending.push({ data, binary })));
      up.on("open", () => { for (const m of pending.splice(0)) up.send(m.data, { binary: m.binary }); });
      up.on("message", (data, binary) => client.readyState === WebSocket.OPEN && client.send(data, { binary }));
      const closeBoth = (code = 1000, reason = "") => {
        const safe = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011;
        if (client.readyState === WebSocket.OPEN) client.close(safe, reason.slice(0, 120));
        if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING) up.terminate();
      };
      up.on("close", (code, reason) => closeBoth(code, reason.toString()));
      up.on("error", (e) => closeBoth(1011, `Proxmox injoignable : ${e.message}`));
      up.on("unexpected-response", (_r, res) => closeBoth(1011, `Proxmox a refusé la console (${res.statusCode})`));
      client.on("close", () => up.terminate());
    });
  });
}

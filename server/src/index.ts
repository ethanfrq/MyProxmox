// Point d'entrée du serveur MyProxmox.
import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { DATA_DIR, DEMO, ROOT, getConfig, version } from "./config";
import { ipFilter } from "./ipfilter";
import { api } from "./routes";
import { handleMcp } from "./mcp";
import { startEngine } from "./engine";
import { attachConsole } from "./console";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 8080);
const WEB = path.join(ROOT, "web", "dist");

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", true);

// 1. Filtre IP avant tout le reste
app.use(ipFilter);

// 2. En-têtes de sécurité, et aucune indexation par les moteurs de recherche
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "1mb" }));

// 3. Serveur MCP (Claude Code, Claude Desktop via le pont, autres clients MCP)
app.all("/mcp", (req, res) => {
  handleMcp(req, res).catch((e) => {
    console.error("[mcp]", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Erreur interne" }, id: null });
  });
});

// 4. API
app.use("/api", api);

// 5. Le pont MCP à télécharger (pour Claude Desktop sur un autre PC)
app.get("/downloads/myproxmox-mcp.cjs", (_req, res) => {
  const file = path.join(ROOT, "bridge", "dist", "myproxmox-mcp.cjs");
  if (!existsSync(file)) return res.status(404).send("Pont MCP non compilé : lance « npm run build ».");
  res.download(file, "myproxmox-mcp.cjs");
});

// 6. Interface (build Vite) avec repli vers index.html pour le routage côté client
app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /\n"));
if (existsSync(WEB)) {
  app.use(express.static(WEB, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/|\/mcp).*/, (_req, res) => res.sendFile(path.join(WEB, "index.html")));
} else {
  app.get("/", (_req, res) => res.type("text/plain").send("L'interface n'est pas compilée : lance « npm run build »."));
}

const server = app.listen(PORT, HOST, () => {
  const cfg = getConfig();
  console.log("");
  console.log(`  MyProxmox ${version()}${DEMO ? "  [MODE DÉMO]" : ""}`);
  console.log(`  Interface :  http://localhost:${PORT}`);
  console.log(`  MCP       :  http://<ip-de-ce-pc>:${PORT}/mcp`);
  console.log(`  Données   :  ${DATA_DIR}`);
  console.log(`  ${cfg.setupDone ? `Proxmox   :  ${cfg.pve?.url ?? "démo"}` : "Ouvre l'interface pour la première configuration."}`);
  console.log("");
  startEngine();
});
// Consoles (noVNC et xterm.js) : relais WebSocket authentifié
attachConsole(server);
// Les gros téléversements (ISO de plusieurs Go) peuvent durer : une heure au plus
server.requestTimeout = 3600_000;

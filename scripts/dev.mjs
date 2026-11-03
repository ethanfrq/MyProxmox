// Développement : serveur en mode démo (port 8080) + Vite avec rechargement à chaud (port 5173).
import { spawn } from "node:child_process";

const run = (cmd, args, env = {}) => spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });

const build = run("node", ["scripts/build-server.mjs"]);
build.on("exit", (code) => {
  if (code) process.exit(code);
  run("node", ["--watch", "server/dist/index.js"], { MYPROXMOX_DEMO: process.env.MYPROXMOX_DEMO ?? "1" });
  run("npx", ["vite", "--config", "web/vite.config.ts"]);
  console.log("\n  Interface en développement : http://localhost:5173\n");
});

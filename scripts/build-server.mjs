// Compile le serveur et le pont MCP avec esbuild.
import { build } from "esbuild";

await build({
  entryPoints: ["server/src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "server/dist/index.js",
  packages: "external", // les dépendances restent dans node_modules
  sourcemap: true,
  logLevel: "info",
});

// Le pont MCP est autonome (toutes ses dépendances incluses) : on peut le copier
// sur n'importe quel PC qui a Node, même sans le reste du projet.
await build({
  entryPoints: ["bridge/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "bridge/dist/myproxmox-mcp.cjs",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});

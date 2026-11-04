// Mesure le JavaScript chargé au premier affichage (script d'entrée et ses imports
// statiques), compressé en gzip. Échoue au-delà de 250 Ko.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const LIMIT = 250 * 1024;
const dir = path.resolve(process.argv[2] ?? "web/dist");
const html = readFileSync(path.join(dir, "index.html"), "utf8");
const seen = new Set();
const queue = [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g)].map((m) => m[1]);
let total = 0;
while (queue.length) {
  const src = queue.shift();
  const file = path.join(dir, src.replace(/^.*?\/assets\//, "assets/"));
  if (seen.has(file)) continue;
  seen.add(file);
  const code = readFileSync(file);
  total += gzipSync(code).length;
  // Imports statiques seulement (les import() dynamiques sont chargés plus tard)
  for (const m of code.toString().matchAll(/(?:^|[;}\n])\s*import\s*(?:[\w${},*\s]+from\s*)?["']\.\/([^"']+\.js)["']/g)) queue.push(`assets/${m[1]}`);
}
const kb = (n) => `${(n / 1024).toFixed(1)} Ko`;
console.log(`JS initial : ${kb(total)} gzip (${seen.size} fichier${seen.size > 1 ? "s" : ""}), limite ${kb(LIMIT)}`);
if (total > LIMIT) {
  console.error("Trop lourd : charge les pages avec React.lazy ou retire une dépendance du premier écran.");
  process.exit(1);
}

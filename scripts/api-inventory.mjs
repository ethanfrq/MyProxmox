#!/usr/bin/env node
// Inventaire de l'API Proxmox VE et de ce que MyProxmox en couvre.
//
// Lit l'arbre de l'API (copie locale docs/api/apidoc.js de l'API viewer officiel), cherche
// dans le code les chemins déjà appelés, et écrit docs/PARITE.md.
//
//   node scripts/api-inventory.mjs                       utilise docs/api/apidoc.js
//   node scripts/api-inventory.mjs --refresh             retélécharge docs/api/apidoc.js d'abord
//   node scripts/api-inventory.mjs --schema apidoc.js    utilise un autre fichier local
//   node scripts/api-inventory.mjs --out autre.md        change le fichier produit
//
// La colonne « MyProxmox » est recalculée à chaque lancement : relance le script à la fin
// de chaque phase plutôt que d'éditer docs/PARITE.md à la main. Pour classer un point
// d'entrée « Hors périmètre », ajoute-le dans HORS_PERIMETRE ci-dessous.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URL = "https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = path.resolve(ROOT, opt("--out") ?? "docs/PARITE.md");
const LOCAL = path.join(ROOT, "docs/api/apidoc.js");
const REFRESH = args.includes("--refresh");
let fetchedOn = null; // date de récupération de la doc, lue dans l'en-tête de la copie locale

// ── Points d'entrée hors périmètre, choisis à la main ─────────────────
// Clé : "MÉTHODE /chemin". Valeur : la raison, affichée dans la légende.
const HORS_PERIMETRE = {
  "GET /access/ticket": "page factice pour les formateurs de l'API",
  "GET /cluster/config/apiversion": "version du protocole de jonction, lue par pvecm",
  "POST /nodes/{node}/execute": "exécution groupée d'appels, réservée aux outils",
};

// ── Valeurs connues des variables utilisées dans les chemins du code ──
// Une variable du code peut remplacer un segment fixe de l'API seulement si sa valeur
// possible est listée ici. Sinon elle ne remplace qu'un paramètre ({node}, {vmid}...).
const ALIAS_VALUES = {
  type: ["qemu", "lxc"],
  "g.type": ["qemu", "lxc"],
  kind: ["qemu", "lxc", "start", "shutdown", "reboot", "stop"],
  action: ["start", "shutdown", "reboot", "stop"],
  "r.type": ["qemu", "lxc"],
  "ctx.type": ["qemu", "lxc"],
  "act.action": ["start", "stop", "restart", "reload"],
  path: ["lvm", "lvmthin", "directory"],
  "osdAct.act": ["in", "out"],
  "p.action": ["start", "shutdown", "reboot", "stop"],
};
// Préfixes stockés dans une variable avant d'être utilisés. Une liste = plusieurs chemins possibles
// (le composant de pare-feu sert pour une machine, un nœud et le datacenter).
const PREFIXES = {
  fw: ["/nodes/${node}/${type}/${vmid}/firewall", "/nodes/${node}/firewall", "/cluster/firewall"],
  groupsFw: "/cluster/firewall",
  rb: ["/nodes/${node}/${type}/${vmid}/firewall/rules", "/nodes/${node}/firewall/rules", "/cluster/firewall/rules", "/cluster/firewall/groups/${group}"],
  a: "/nodes/${node}/qemu/${vmid}/agent",
  base: "/nodes/${node}/${type}/${vmid}",
  "ctx.base": "/nodes/${node}/${type}/${vmid}",
  b: "/nodes/${node}",
};

// ── Zones et phases ───────────────────────────────────────────────────
const CLUSTER_PARTS = ["config", "status", "ha", "replication", "ceph", "resources", "tasks", "log", "nextid", "bulk-action"];

function zoneOf(p) {
  const s = p.split("/").filter(Boolean);
  if (s[0] === "access") return "Accès";
  if (s[0] === "pools") return "Pools";
  if (s[0] === "storage") return "Stockage";
  if (s[0] === "version") return "Datacenter";
  if (s[0] === "cluster") return s.length === 1 || CLUSTER_PARTS.includes(s[1]) ? "Cluster" : "Datacenter";
  if (s[0] === "nodes") {
    if (s[2] === "qemu") return "VM QEMU";
    if (s[2] === "lxc") return "Conteneur LXC";
    if (s[2] === "storage" || s[2] === "scan") return "Stockage";
    return "Nœud";
  }
  return "Datacenter";
}

function sectionOf(p, zone) {
  const s = p.split("/").filter(Boolean);
  switch (zone) {
    case "VM QEMU":
    case "Conteneur LXC":
      return s[4] ?? "(racine)";
    case "Stockage":
      if (s[0] === "storage") return "définitions";
      if (s[2] === "scan") return "scan";
      return s[4] ?? "(racine)";
    case "Nœud":
      return s[2] ?? "(racine)";
    case "Accès":
      return s[1] ?? "(racine)";
    case "Pools":
      return "pools";
    default:
      return s[0] === "version" ? "version" : s[1] ?? "(racine)";
  }
}

const ZONES = ["Datacenter", "Cluster", "Nœud", "VM QEMU", "Conteneur LXC", "Stockage", "Accès", "Pools"];

const ZONE_PHASES = {
  Datacenter: "3 (lecture sauvegardes), 6",
  Cluster: "3 (quorum, HA, tâches), 6",
  "Nœud": "3 (lecture), 5",
  "VM QEMU": "4",
  "Conteneur LXC": "4",
  Stockage: "3 (occupation), 7",
  "Accès": "1 (permissions), 6",
  Pools: "6",
};

const PHASES = [
  ["1", "Socle commun", "Composants partagés (tableau, formulaire, assistant, journal de tâche, arbre). Accès : `GET /access/permissions` pour masquer les actions interdites. Cluster : `/cluster/resources` pour l'arbre."],
  ["2", "Comptes MyProxmox et monitoring seul", "Comptes locaux propres à MyProxmox. Aucun nouveau point d'entrée Proxmox, à part `POST /access/ticket` déjà utilisé."],
  ["3", "Monitoring complet", "Lecture seule. Nœud (status, rrddata, netstat, disques, services, apt), Cluster (status, HA, tâches, log), Datacenter (sauvegardes planifiées), Stockage (rrddata)."],
  ["4", "VM et conteneurs", "Zones VM QEMU et Conteneur LXC en entier, console comprise (vncproxy, termproxy, vncwebsocket)."],
  ["5", "Nœud", "Zone Nœud : réseau, certificats et ACME, apt, disques, Ceph, réplication, journaux, services, pare-feu, abonnement, shell."],
  ["6", "Datacenter, cluster, accès, SDN", "Zones Datacenter, Cluster, Accès et Pools : options, définitions de stockage, sauvegardes, HA, SDN, permissions, ACME, métriques, notifications, mappings, pare-feu."],
  ["7", "Stockage et contenu", "Zone Stockage : téléversement, téléchargement, contenu, disques orphelins, PBS, rrddata."],
  ["8", "MCP et finitions", "Outils MCP en lecture sur les nouvelles zones, tests, accessibilité. Ce qui reste « À faire » ici passe dans le README, rubrique « Pas encore couvert »."],
];

// ── Lecture du schéma ─────────────────────────────────────────────────
async function loadSchema() {
  const file = opt("--schema");
  let src;
  if (file) {
    src = readFileSync(path.resolve(file), "utf8");
  } else {
    if (REFRESH || !existsSync(LOCAL)) {
      const res = await fetch(SOURCE_URL);
      if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${SOURCE_URL}`);
      const today = new Date().toISOString().slice(0, 10);
      mkdirSync(path.dirname(LOCAL), { recursive: true });
      writeFileSync(LOCAL, `// Récupéré le ${today} depuis ${SOURCE_URL}\n${await res.text()}`);
    }
    src = readFileSync(LOCAL, "utf8");
  }
  fetchedOn = src.match(/^\/\/ Récupéré le (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const start = src.indexOf("[", src.indexOf("apiSchema"));
  const end = src.indexOf("\n;", start);
  if (start < 0 || end < 0) throw new Error("Format de apidoc.js inattendu : tableau apiSchema introuvable.");
  return JSON.parse(src.slice(start, end));
}

function flatten(tree) {
  const out = [];
  const walk = (list) => {
    for (const n of list) {
      for (const [method, info] of Object.entries(n.info ?? {})) out.push({ path: n.path, method, info, node: n });
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

// ── Lisibilité des permissions ────────────────────────────────────────
function fmtCheck(c) {
  if (!Array.isArray(c)) return "";
  const [kind, ...rest] = c;
  if (kind === "and" || kind === "or") {
    const parts = rest.map((x) => {
      const t = fmtCheck(x);
      return Array.isArray(x) && (x[0] === "and" || x[0] === "or") ? `(${t})` : t;
    });
    return parts.join(kind === "and" ? " et " : " ou ");
  }
  if (kind === "perm") {
    const [p, privs = [], ...o] = rest;
    const any = o.includes("any");
    return `${privs.join(any ? " ou " : " + ")} sur ${p}`;
  }
  if (kind === "userid-group") {
    const [privs = [], ...o] = rest;
    const any = o.includes("any");
    return `${privs.join(any ? " ou " : " + ")} sur l'utilisateur ou son groupe`;
  }
  if (kind === "userid-param") return rest[0] === "self" ? "soi-même uniquement" : `${rest[0]} sur le domaine de l'utilisateur`;
  if (kind === "perm-modify") return `droit de modifier les permissions sur ${rest[0]}`;
  return JSON.stringify(c);
}

function fmtPerm(perm) {
  if (!perm) return "non précisée";
  if (perm.check) return fmtCheck(perm.check);
  if (perm.user === "world") return "aucune (public)";
  if (perm.user === "root@pam") return "root@pam uniquement";
  if (perm.description) return clean(perm.description, 160);
  if (perm.user === "all") return "tout utilisateur connecté";
  return "non précisée";
}

function clean(text = "", max = 220) {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
const cell = (t) => String(t).replace(/\|/g, "\\|");

// ── Points d'entrée purement « index » ───────────────────────────────
// Un GET qui ne fait que lister des sous-dossiers fixes (navigation de l'API) n'apporte
// rien à un humain : l'interface appelle directement les sous-chemins.
function isDirectoryIndex(e) {
  if (e.method !== "GET") return false;
  const kids = e.node.children ?? [];
  if (!kids.length) return false;
  const fixed = kids.every((k) => !k.path.split("/").pop().startsWith("{"));
  if (!fixed) return false;
  const d = e.info.description ?? "";
  return !/^(List(?! resource types)|Get |Returns|Read)/.test(d);
}

function horsReason(e) {
  const key = `${e.method} ${e.path}`;
  if (HORS_PERIMETRE[key]) return HORS_PERIMETRE[key];
  if (/internal use/i.test(e.info.description ?? "")) return "réservé à Proxmox (usage interne)";
  if (isDirectoryIndex(e)) return "index de navigation de l'API";
  return null;
}

// ── Recherche des appels dans le code ────────────────────────────────
function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith("dist")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.startsWith("mock")) acc.push(full); // le faux Proxmox ne compte pas
  }
  return acc;
}

const METHOD_OF = { get: "GET", post: "POST", put: "PUT", del: "DELETE" };

function findCalls() {
  const files = ["web/src", "shared", "server/src"].flatMap((d) => walkFiles(path.join(ROOT, d)));
  const calls = [];
  const patterns = [
    // pve.get("/x"), pve.post<T>(`...`), pve.del(base, ...)
    [/pve\.(get|post|put|del)(?:<(?:[^<>()]|<[^<>()]*>)*>)?\(\s*(`[^`]*`|"[^"]*"|base\b)/g, (m) => [METHOD_OF[m[1]], m[2]]],
    // call("GET", "/x")
    [/\bcall\(\s*"(GET|POST|PUT|DELETE)",\s*(`[^`]*`|"[^"]*")/g, (m) => [m[1], m[2]]],
    // Chemin construit à la main (relais WebSocket...) : commentaire « // api: GET /nodes/{node}/... »
    [/\/\/ api: (GET|POST|PUT|DELETE) (\/\S+)/g, (m) => [m[1], `"${m[2].replace(/\{(\w+)\}/g, "${$1}")}"`]],
    // Listes génériques : <Crud list="/cluster/..."> (lecture)
    [/\blist=(?:"(\/[^"]+)"|\{`(\/[^`]+)`\})/g, (m) => ["GET", `"${m[1] ?? m[2]}"`]],
    // request(cible, "GET", "/x")
    [/\brequest\([^;\n]*?"(GET|POST|PUT|DELETE)",\s*(`[^`]*`|"[^"]*")/g, (m) => [m[1], m[2]]],
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const [re, pick] of patterns) {
      for (const m of src.matchAll(re)) {
        const [method, raw] = pick(m);
        const p0 = raw === "base" ? "${base}" : raw.slice(1, -1);
        let variants = [p0];
        for (const [k, v] of Object.entries(PREFIXES)) {
          const re = new RegExp(`^\\$\\{${k.replace(".", "\\.")}\\}`);
          variants = variants.flatMap((x) => (re.test(x) ? (Array.isArray(v) ? v : [v]).map((val) => x.replace(re, val)) : [x]));
        }
        for (const p of variants) {
          if (!p.startsWith("/")) continue;
          calls.push({ method, path: p, file: path.relative(ROOT, f), multi: variants.length > 1 });
        }
      }
    }
  }
  return calls;
}

// Découpe un chemin du code en segments : { lit } ou { v: nomDeVariable }.
function codeSegments(p) {
  return p.split("/").filter(Boolean).map((s) => {
    const m = s.match(/^\$\{([^}]*)\}$/);
    if (m) return { v: m[1].trim() };
    if (s.includes("${")) return { v: "*" }; // segment mixte : traité comme un paramètre
    return { lit: s };
  });
}

function matches(apiPath, seg) {
  const a = apiPath.split("/").filter(Boolean);
  if (a.length !== seg.length) return false;
  return a.every((x, i) => {
    const c = seg[i];
    const param = x.startsWith("{");
    if (c.lit !== undefined) return param || c.lit === x;
    if (param) return true;
    return (ALIAS_VALUES[c.v] ?? []).includes(x);
  });
}

// ── Production du Markdown ───────────────────────────────────────────
const METHOD_ORDER = { GET: 0, POST: 1, PUT: 2, DELETE: 3 };

async function main() {
  const tree = await loadSchema();
  const endpoints = flatten(tree);
  const calls = findCalls();

  const usedBy = new Map();
  const unmatched = [];
  for (const c of calls) {
    const seg = codeSegments(c.path);
    const hits = endpoints.filter((e) => e.method === c.method && matches(e.path, seg));
    if (!hits.length && !c.multi) unmatched.push(c);
    for (const h of hits) {
      const k = `${h.method} ${h.path}`;
      if (!usedBy.has(k)) usedBy.set(k, new Set());
      usedBy.get(k).add(c.file);
    }
  }

  const rows = endpoints.map((e) => {
    const zone = zoneOf(e.path);
    const key = `${e.method} ${e.path}`;
    const hors = horsReason(e);
    const status = usedBy.has(key) ? "Fait" : hors ? "Hors périmètre" : "À faire";
    return { ...e, zone, section: sectionOf(e.path, zone), status, hors, key };
  });

  const stats = Object.fromEntries(ZONES.map((z) => [z, { total: 0, Fait: 0, "À faire": 0, "Hors périmètre": 0 }]));
  for (const r of rows) {
    stats[r.zone].total++;
    stats[r.zone][r.status]++;
  }
  const sum = (k) => ZONES.reduce((a, z) => a + stats[z][k], 0);
  const anchor = (z) => z.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replace(/ /g, "-");
  const today = new Date().toISOString().slice(0, 10);

  const L = [];
  L.push("# Parité avec l'API Proxmox VE", "");
  if (fetchedOn) L.push(`Doc de l'API récupérée le ${fetchedOn} (copie dans \`docs/api/apidoc.js\`, à rafraîchir avec \`--refresh\`).`, "");
  L.push(`Inventaire de tous les points d'entrée de l'API Proxmox VE, et de ce que MyProxmox en couvre. Fichier produit par \`scripts/api-inventory.mjs\` le ${today}, à partir de la doc officielle (${opt("--schema") ? "fichier local" : SOURCE_URL}).`, "");
  L.push("Ne le modifie pas à la main : relance `node scripts/api-inventory.mjs` à la fin de chaque phase. La colonne « MyProxmox » est recalculée en cherchant les chemins appelés dans `web/src`, `shared` et `server/src`.", "");
  L.push("La doc en ligne suit la dernière version de Proxmox VE. Quelques points d'entrée récents (par exemple les fabrics et route maps du SDN, ou `/cluster/bulk-action`) n'existent pas en 8.x : l'interface devra les masquer quand le serveur ne les propose pas.", "");

  L.push("## Résumé", "");
  L.push("| Zone | Points d'entrée | Fait | À faire | Hors périmètre | Phases |", "|---|--:|--:|--:|--:|---|");
  for (const z of ZONES) {
    const s = stats[z];
    L.push(`| [${z}](#${anchor(z)}) | ${s.total} | ${s.Fait} | ${s["À faire"]} | ${s["Hors périmètre"]} | ${ZONE_PHASES[z]} |`);
  }
  L.push(`| **Total** | **${rows.length}** | **${sum("Fait")}** | **${sum("À faire")}** | **${sum("Hors périmètre")}** | |`, "");

  L.push("## Phases", "");
  L.push("| Phase | Sujet | Zones couvertes |", "|---|---|---|");
  for (const [n, t, d] of PHASES) L.push(`| ${n} | ${t} | ${d} |`);
  L.push("");

  L.push("## Légende", "");
  L.push("- **Fait** : MyProxmox appelle déjà ce chemin avec cette méthode. Ça ne veut pas dire que toutes les options du point d'entrée sont proposées dans l'interface.");
  L.push("- **À faire** : pas encore utilisé.");
  L.push("- **Hors périmètre** : sans intérêt pour un humain. Les règles appliquées :");
  L.push("  - index de navigation de l'API (un `GET` qui ne fait que lister des sous-chemins fixes) ;");
  L.push("  - points d'entrée que la doc réserve à un usage interne de Proxmox (tunnels de migration, ajout d'un nœud par la jonction) ;");
  for (const [k, v] of Object.entries(HORS_PERIMETRE)) L.push(`  - \`${k}\` : ${v} ;`);
  L.push("- Les descriptions viennent de la doc officielle, en anglais. La colonne « Permission » résume le contrôle d'accès demandé par Proxmox.", "");

  for (const z of ZONES) {
    const zr = rows.filter((r) => r.zone === z);
    L.push(`## ${z}`, "");
    const s = stats[z];
    L.push(`${s.total} points d'entrée : ${s.Fait} faits, ${s["À faire"]} à faire, ${s["Hors périmètre"]} hors périmètre.`, "");
    const sections = [...new Set(zr.map((r) => r.section))].sort((a, b) => (a === "(racine)" ? -1 : b === "(racine)" ? 1 : a.localeCompare(b)));
    for (const sec of sections) {
      L.push(`### ${z} : ${sec}`, "");
      L.push("| Méthode | Chemin | Description | Permission | MyProxmox |", "|---|---|---|---|---|");
      const list = zr.filter((r) => r.section === sec).sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER[a.method] - METHOD_ORDER[b.method]);
      for (const r of list) {
        L.push(`| ${r.method} | \`${r.path}\` | ${cell(clean(r.info.description) || "(sans description)")} | ${cell(fmtPerm(r.info.permissions))} | ${r.status} |`);
      }
      L.push("");
    }
  }

  writeFileSync(OUT, L.join("\n"));
  console.log(`${path.relative(ROOT, OUT)} : ${rows.length} points d'entrée, ${sum("Fait")} faits, ${sum("À faire")} à faire, ${sum("Hors périmètre")} hors périmètre.`);
  if (unmatched.length) {
    console.log(`\n${unmatched.length} appel(s) du code sans correspondance dans l'API (à vérifier) :`);
    for (const u of unmatched) console.log(`  ${u.method} ${u.path}  (${u.file})`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

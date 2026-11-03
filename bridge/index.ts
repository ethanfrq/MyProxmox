// Pont MCP « stdio » vers le serveur MCP HTTP de MyProxmox.
// Claude Desktop lance ce petit programme ; il relaie chaque demande vers
// http://<pc-myproxmox>:8080/mcp avec ta clé MCP. Rien n'est stocké ici.
//
// Variables : MYPROXMOX_URL (ex. http://10.0.1.20:8080) et MYPROXMOX_KEY (mpx_...).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const base = (process.env.MYPROXMOX_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const key = process.env.MYPROXMOX_KEY ?? "";
const log = (...a: unknown[]) => console.error("[myproxmox-mcp]", ...a); // stdout est réservé au protocole

async function main() {
  if (!key) log("MYPROXMOX_KEY manquante : copie la configuration depuis MyProxmox > Claude & MCP.");
  let remote: Client | null = null;
  let instructions: string | undefined;

  async function connect() {
    if (remote) return remote;
    const c = new Client({ name: "myproxmox-bridge", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
    instructions = c.getInstructions();
    remote = c;
    return c;
  }

  const unreachable = (e: unknown) => ({
    content: [{ type: "text" as const, text: `MyProxmox ne répond pas sur ${base} (${(e as Error).message}). Vérifie que l'app tourne et que ce PC est dans une plage IP autorisée.` }],
    isError: true,
  });

  try {
    await connect();
  } catch (e) {
    log("connexion impossible au démarrage, nouvel essai à la première demande :", (e as Error).message);
  }

  const server = new Server({ name: "myproxmox", version: "1.0.0" }, { capabilities: { tools: {} }, instructions });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      return await (await connect()).listTools();
    } catch (e) {
      remote = null;
      log((e as Error).message);
      return { tools: [] };
    }
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      return await (await connect()).callTool(req.params);
    } catch (e) {
      remote = null;
      return unreachable(e);
    }
  });
  await server.connect(new StdioServerTransport());
  log(`prêt, relié à ${base}/mcp`);
}

main().catch((e) => {
  log(e);
  process.exit(1);
});

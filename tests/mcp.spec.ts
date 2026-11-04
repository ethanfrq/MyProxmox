// Serveur MCP : chaque outil répond sans erreur en mode démo, et une clé en lecture
// ne peut rien modifier.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginProxmox } from "./helpers";

async function rpc(request: APIRequestContext, key: string, method: string, params: unknown) {
  const r = await request.post("/mcp", {
    headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  expect(r.status(), await r.text()).toBe(200);
  const text = await r.text();
  // Réponse en SSE : une ligne « data: {...} »
  const line = text.split("\n").find((l) => l.startsWith("data:")) ?? text;
  return JSON.parse(line.replace(/^data:\s*/, ""));
}

const tool = async (request: APIRequestContext, key: string, name: string, args: Record<string, unknown> = {}) => {
  const res = await rpc(request, key, "tools/call", { name, arguments: args });
  return { error: !!res.result?.isError, text: String(res.result?.content?.[0]?.text ?? "") };
};

test("outils MCP en lecture et en action", async ({ page }) => {
  await loginProxmox(page);
  const create = async (level: string) => {
    const r = await page.request.post("/api/settings/mcp-keys", { data: { name: `test-${level}`, level } });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).data.key as string;
  };
  const reader = await create("read");
  const actor = await create("actions");

  const list = await rpc(page.request, reader, "tools/list", {});
  const names = list.result.tools.map((t: { name: string }) => t.name);
  for (const n of ["datacenter", "haute_disponibilite", "reseau_logiciel", "ceph", "pare_feu", "permissions", "replication", "proxmox_backup_server", "migrer_machine", "cloner_modele", "tag_machine"]) expect(names).toContain(n);
  // Aucun outil destructeur
  expect(names.filter((n: string) => /suppr|delete|destroy|restaur|forcer/.test(n))).toEqual([]);

  for (const n of ["etat_general", "datacenter", "haute_disponibilite", "reseau_logiciel", "ceph", "pare_feu", "permissions", "replication", "proxmox_backup_server"]) {
    const r = await tool(page.request, reader, n);
    expect(r.error, `${n} : ${r.text}`).toBe(false);
  }
  expect((await tool(page.request, reader, "pare_feu", { vmid: 101 })).error).toBe(false);

  // Une clé en lecture est refusée pour les actions
  const denied = await tool(page.request, reader, "tag_machine", { vmid: 101, action: "ajouter", tag: "mcp" });
  expect(denied.error).toBe(true);
  expect(denied.text).toContain("lecture seule");

  // Tag ajouté puis retiré
  expect((await tool(page.request, actor, "tag_machine", { vmid: 101, action: "ajouter", tag: "mcp" })).text).toContain("ajouté");
  expect((await tool(page.request, reader, "details_machine", { vmid: 101 })).text).toContain("mcp");
  expect((await tool(page.request, actor, "tag_machine", { vmid: 101, action: "retirer", tag: "mcp" })).text).toContain("retiré");

  // Cloner une machine qui n'est pas un modèle est refusé
  const notTemplate = await tool(page.request, actor, "cloner_modele", { vmid: 101, nom: "copie" });
  expect(notTemplate.error).toBe(true);
  expect(notTemplate.text).toContain("pas un modèle");

  // Migration vers un nœud inconnu : message clair
  const badNode = await tool(page.request, actor, "migrer_machine", { vmid: 101, cible: "nulle-part" });
  expect(badNode.error).toBe(true);
  expect(badNode.text).toContain("n'existe pas");
});

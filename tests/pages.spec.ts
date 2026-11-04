// Ouvre chaque page de l'app en mode démo et vérifie qu'aucune erreur n'apparaît dans la console.
import { test, expect } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

const PAGES: [string, string][] = [
  ["/", "Vue d'ensemble"],
  ["/machines", "Machines"],
  ["/machines/pve/qemu/101", "home-assistant"],
  ["/machines/pve/lxc/100", "pihole"],
  ["/creer", "Créer"],
  ["/serveur", "Nœud"],
  ...["resume", "options", "stockage", "sauvegardes", "replication", "permissions", "ha", "sdn", "acme", "parefeu", "metriques", "notifications", "mappings"].map((s): [string, string] => [`/datacenter/${s}`, "Datacenter"]),
  ["/stockage", "Stockage"],
  ["/reseau", "Réseau"],
  ["/sauvegardes", "Sauvegardes"],
  ["/taches", "Tâches"],
  ["/alertes", "Alertes"],
  ["/securite", "Sécurité"],
  ["/claude", "Claude"],
  ["/parametres", "Paramètres"],
  ["/parametres/comptes", "Comptes MyProxmox"],
];

for (const [path, title] of PAGES) {
  test(`page ${path}`, async ({ page }) => {
    const errors = watchErrors(page);
    await loginProxmox(page);
    await page.goto(path);
    await expect(page.locator("main h1").first()).toContainText(title);
    await page.waitForTimeout(1200); // laisse les appels se terminer
    expect(errors).toEqual([]);
  });
}

test("monitoring", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/monitoring");
  await expect(page.locator(".mon")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

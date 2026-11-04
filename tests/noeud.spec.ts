// Phase 5 : le nœud.
import { test, expect, type Page } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

async function open(page: Page, tab: string, node = "pve") {
  await page.goto(`/serveur?node=${node}&onglet=${tab}`);
  await expect(page.locator("main h1")).toContainText(`Nœud ${node}`);
}

test("résumé, alimentation avec double confirmation, tout démarrer", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "resume");
  await expect(page.locator("main")).toContainText("AMD Ryzen 7 5700G");
  await page.getByRole("button", { name: "Redémarrer le nœud" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continuer" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Dernière confirmation");
  await expect(dlg.getByRole("button", { name: "Redémarrer maintenant" })).toBeDisabled();
  await dlg.getByRole("textbox").fill("pve");
  await dlg.getByRole("button", { name: "Redémarrer maintenant" }).click();
  await expect(page.getByText("pve redémarre")).toBeVisible();
  await page.getByRole("button", { name: "Tout démarrer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tout démarrer" }).click();
  expect(errors).toEqual([]);
});

test("shell du nœud via le relais", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "shell");
  await expect(page.locator(".xterm-rows")).toContainText("Bienvenue");
  await page.locator(".console-term").click();
  await page.keyboard.type("whoami");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("root");
  expect(errors).toEqual([]);
});

test("services, journal, tâches, abonnement, pare-feu", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "services");
  const row = page.locator("tr", { hasText: "ksmtuned" });
  await row.getByRole("button", { name: "Redémarrer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Redémarrer" }).click();
  await expect(page.getByText("Redémarrer ksmtuned : terminé")).toBeVisible();
  await open(page, "journaux");
  await expect(page.locator("pre.log")).toContainText("pvedaemon");
  await page.getByLabel("Service").selectOption("pvedaemon");
  await expect(page.locator("pre.log")).toContainText("authentication failure");
  await page.getByRole("tab", { name: "Tâches" }).click();
  await expect(page.locator("main table tbody tr").first()).toBeVisible();
  await open(page, "abonnement");
  await page.getByLabel("Clé d'abonnement").fill("pve2c-0123456789");
  await page.getByRole("button", { name: "Enregistrer la clé" }).click();
  await expect(page.getByText("Abonnement actif")).toBeVisible();
  await page.getByRole("button", { name: "Retirer la clé" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
  await expect(page.getByText("Pas d'abonnement")).toBeVisible();
  await open(page, "parefeu");
  await page.getByRole("tab", { name: "Options" }).last().click();
  await expect(page.getByLabel("Pare-feu actif sur ce nœud")).toBeChecked();
  expect(errors).toEqual([]);
});

test("réseau : préparer un pont, voir le diff, appliquer avec confirmation forte", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "reseau");
  await page.getByRole("button", { name: "Créer" }).click();
  await page.getByRole("menuitem", { name: "Pont Linux" }).click();
  const name = `vmbr${10 + (Date.now() % 80)}`;
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(name);
  await page.getByRole("dialog").getByLabel("Adresse IPv4").fill("172.16.5.1/24");
  await page.getByRole("dialog").getByRole("button", { name: "Préparer le changement" }).click();
  await expect(page.locator("pre.diff")).toContainText(`+iface ${name} inet static`);
  await page.getByRole("button", { name: "Appliquer" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Risque de perte d'accès");
  await dlg.getByRole("textbox").fill("pve");
  await dlg.getByRole("button", { name: "Appliquer maintenant" }).click();
  await expect(page.getByText("Changements en attente")).toHaveCount(0);
  await expect(page.locator("tr", { hasText: name })).toContainText("172.16.5.1/24");
  expect(errors).toEqual([]);
});

test("système : DNS, hosts, fuseau", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "systeme");
  await page.getByLabel("Serveur DNS 3").fill("9.9.9.9");
  await page.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(page.getByText("DNS enregistrés")).toBeVisible();
  await page.getByLabel("Contenu de /etc/hosts").fill("127.0.0.1 localhost\n10.0.1.101 pve.maison.lan pve\n10.0.1.10 nas\n");
  await page.locator(".panel", { hasText: "Fichier hosts" }).getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fichier hosts enregistré")).toBeVisible();
  expect(errors).toEqual([]);
});

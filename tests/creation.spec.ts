// Phase 4 : migration, clonage, modèles, réplication, assistants de création, actions groupées.
import { test, expect } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

test("migrer puis cloner une VM", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/machines/pve/qemu/107");
  await page.getByRole("button", { name: "Plus ▾" }).click();
  await page.getByRole("menuitem", { name: "Migrer vers un autre nœud" }).click();
  const dlg = page.getByRole("dialog", { name: /Migrer/ });
  await expect(dlg).toContainText("Disques locaux");
  await dlg.getByRole("button", { name: "Migrer" }).click();
  await expect(page).toHaveURL(/\/machines\/pve2?\/qemu\/107/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Plus ▾" }).click();
  await page.getByRole("menuitem", { name: "Cloner" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cloner" }).click();
  await expect(page.locator("main h1")).toContainText("docker-host-copie", { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("créer depuis un modèle (clone lié)", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/creer");
  await page.getByRole("tab", { name: "Depuis un modèle" }).click();
  await page.locator("main").getByRole("button", { name: /debian-modele/ }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(`web-${Date.now() % 1000}`);
  await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
  await expect(page.locator("main h1")).toContainText("web-", { timeout: 10_000 });
  await page.getByRole("tab", { name: "Matériel" }).click();
  await expect(page.locator("tr", { hasText: "Disque (scsi0)" })).toContainText("base-110-disk-0/vm-");
  expect(errors).toEqual([]);
});

test("assistant complet de création de VM", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/creer");
  await page.getByRole("button", { name: "Assistant complet" }).click();
  await page.getByRole("tab", { name: "Machine virtuelle" }).click();
  const name = `vm-test-${Date.now() % 10000}`;
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill(name);
  for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Récapitulatif" })).toBeVisible();
  await expect(page.locator(".summary-block").first()).toContainText(name);
  await page.getByRole("button", { name: "Créer la VM" }).click();
  await expect(page.locator("main h1")).toContainText(name, { timeout: 10_000 });
  await page.getByRole("tab", { name: "Matériel" }).click();
  await expect(page.locator("tr", { hasText: "Disque (scsi0)" })).toContainText("32 Go");
  expect(errors).toEqual([]);
});

test("assistant complet de création de conteneur", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/creer");
  await page.getByRole("button", { name: "Assistant complet" }).click();
  const name = `ct-test-${Date.now() % 10000}`;
  await page.getByLabel("Nom d'hôte").fill(name);
  await page.getByLabel("Mot de passe root").fill("secret123");
  await page.getByLabel("Confirme le mot de passe").fill("secret123");
  for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Créer le conteneur" }).click();
  await expect(page.locator("main h1")).toContainText(name, { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("actions groupées : tag et sauvegarde", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/machines");
  await page.getByLabel("Sélectionner pihole").check();
  await page.getByLabel("Sélectionner jellyfin").check();
  await page.locator(".bulkbar").getByRole("button", { name: "Tags" }).click();
  await page.getByRole("dialog").getByLabel("Tag").fill("groupe-test");
  await page.getByRole("dialog").getByRole("button", { name: "Appliquer" }).click();
  await expect(page.locator("tr", { hasText: "pihole" })).toContainText("groupe-test");
  await expect(page.locator("tr", { hasText: "jellyfin" })).toContainText("groupe-test");
  await page.getByLabel("Sélectionner pihole").check();
  await page.locator(".bulkbar").getByRole("button", { name: "Sauvegarder" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Lancer les sauvegardes" }).click();
  await expect(page.getByText("1 action(s) lancée(s)")).toBeVisible();
  expect(errors).toEqual([]);
});

test("réplication d'une machine", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/machines/pve/lxc/100?onglet=replication");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  const row = page.locator("tr", { hasText: "100-" }).first();
  await expect(row).toContainText("pve2");
  await row.getByRole("button", { name: "Lancer" }).click();
  await row.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  expect(errors).toEqual([]);
});

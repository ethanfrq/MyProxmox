// Phase 7 : stockage et contenu.
import { test, expect, type Page } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

async function open(page: Page, storage: string, tab = "resume") {
  await page.goto(`/stockage?node=pve&storage=${storage}&onglet=${tab}`);
  await expect(page.locator("main h1")).toHaveText("Stockage");
}

test("résumé : graphe sur 1 jour à 1 an, et informations PBS", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "backup-nas");
  for (const r of ["day", "month", "year"]) await page.getByLabel("Période du graphique").selectOption(r);
  await expect(page.locator("figure.chart")).toBeVisible();
  await open(page, "pbs");
  await expect(page.locator("main")).toContainText("Déduplication");
  await expect(page.locator("main")).toContainText("Dernière vérification");
  expect(errors).toEqual([]);
});

test("envoi d'une ISO depuis le navigateur, relayée en flux, avec progression", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "local", "ajouter");
  const name = `test-${Date.now() % 100000}.iso`;
  await page.getByLabel("Fichier", { exact: true }).setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.alloc(3 * 1024 * 1024, 7) });
  await page.getByLabel("Somme de contrôle (facultatif)").selectOption("sha256");
  await page.getByLabel("Valeur attendue").first().fill("a".repeat(64));
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText(`Copie de ${name} et vérification : terminé`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "ISO" }).click();
  await expect(page.locator("main table")).toContainText(name);
  expect(errors).toEqual([]);
});

test("téléchargement depuis une adresse, somme de contrôle fausse signalée", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "local", "ajouter");
  await page.getByLabel("Adresse du fichier").fill("https://releases.ubuntu.com/24.04/ubuntu-24.04.1-live-server-amd64.iso");
  await page.getByRole("button", { name: "Interroger" }).click();
  await expect(page.getByText("Taille annoncée : 2,6 Go")).toBeVisible();
  await page.getByLabel("Somme de contrôle", { exact: true }).selectOption("sha256");
  await page.getByLabel("Valeur attendue").last().fill(`0000${"b".repeat(60)}`);
  await page.getByRole("button", { name: "Télécharger" }).first().click();
  await expect(page.getByText(/échec \(checksum mismatch\)/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("disques orphelins détectés et supprimés", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "local-lvm", "orphelins");
  const row = page.locator("tr", { hasText: "vm-199-disk-0" });
  await expect(row).toContainText("n'existe plus");
  await expect(page.locator("tr", { hasText: "vm-101-disk-7" })).toContainText("Absent de la configuration");
  await row.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("vm-199-disk-0");
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer le disque" }).click();
  await expect(page.locator("tr", { hasText: "vm-199-disk-0" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sauvegardes : notes, rétention simulée puis appliquée", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "backup-nas", "backup");
  await expect(page.locator("main table tbody tr").first()).toBeVisible();
  const before = await page.locator("main table tbody tr").count();
  await page.getByRole("button", { name: "Appliquer une rétention" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Garder les dernières").fill("1");
  await dlg.getByLabel("Une par jour pendant").fill("");
  await dlg.getByLabel("Une par semaine pendant").fill("");
  await dlg.getByLabel("Une par mois pendant").fill("");
  await dlg.getByRole("button", { name: "Simuler" }).click();
  await expect(dlg.getByText(/à supprimer/)).toBeVisible();
  const n = Number((await dlg.getByText(/à supprimer/).innerText()).match(/\d+/)![0]);
  if (n > 0) {
    await dlg.getByRole("button", { name: /Supprimer ces/ }).click();
    await expect(page.getByText("Rétention appliquée : terminé")).toBeVisible();
    await page.getByRole("button", { name: "Actualiser" }).click();
    await expect(page.locator("main table tbody tr")).toHaveCount(before - n);
  }
  expect(errors).toEqual([]);
});

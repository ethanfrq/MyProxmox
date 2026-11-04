// Phase 6 : Datacenter.
import { test, expect, type Page } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

async function open(page: Page, section: string) {
  await page.goto(`/datacenter/${section}`);
  await expect(page.locator("main h1")).toHaveText("Datacenter");
}
const uniq = (p: string) => `${p}${Date.now() % 100000}`;

test("résumé du cluster, informations de jonction, options", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "resume");
  await expect(page.locator("main")).toContainText("maison");
  await page.getByRole("button", { name: "Informations de jonction" }).click();
  await expect(page.getByRole("dialog").getByLabel("Informations de jonction")).not.toBeEmpty();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();
  await open(page, "options");
  await page.getByLabel("Proxy HTTP").fill("http://proxy.lan:3128");
  await page.getByRole("button", { name: "Enregistrer les options" }).click();
  await expect(page.getByText("Options enregistrées")).toBeVisible();
  expect(errors).toEqual([]);
});

test("pare-feu : groupe de sécurité et ses règles", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "parefeu");
  await page.getByRole("tab", { name: "Groupes de sécurité" }).click();
  const name = uniq("g");
  await page.getByRole("button", { name: "Créer un groupe" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.locator("tr", { hasText: name }).getByRole("button", { name: "Règles" }).click();
  await page.getByRole("button", { name: "Ajouter une règle" }).click();
  await page.getByRole("dialog").getByLabel("Service connu (macro)").selectOption("SSH");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".fw-table")).toContainText("SSH");
  expect(errors).toEqual([]);
});

test("mappings, métriques, notifications", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "mappings");
  await page.getByRole("tab", { name: "USB" }).click();
  await page.getByRole("button", { name: "Ajouter" }).click();
  const m = uniq("usb");
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(m);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: m })).toContainText("node=pve");
  await open(page, "metriques");
  await page.getByRole("button", { name: "Ajouter un serveur" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(uniq("graf"));
  await page.getByRole("dialog").getByLabel("Type").selectOption("graphite");
  await page.getByRole("dialog").getByLabel("Serveur").fill("10.0.1.30");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("main table")).toContainText("10.0.1.30");
  await open(page, "notifications");
  await page.getByRole("button", { name: "Ajouter une cible" }).click();
  const t = uniq("hook");
  await page.getByRole("dialog").getByLabel("Type").selectOption("webhook");
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(t);
  await page.getByRole("dialog").getByLabel("Adresse du webhook").fill("https://ntfy.sh/test");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.locator("tr", { hasText: t }).getByRole("button", { name: "Tester" }).click();
  await expect(page.getByText(`Notification de test envoyée à ${t}`)).toBeVisible();
  await page.getByRole("button", { name: "Ajouter une règle" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(uniq("r"));
  await page.getByRole("dialog").getByLabel(new RegExp(`^${t}`)).check();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: t }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("stockage : ajouter un NFS (partages trouvés sur le serveur), modifier, retirer", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "stockage");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("menuitem", { name: "NFS" }).click();
  const id = uniq("nas");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Identifiant").fill(id);
  await dlg.getByLabel("Serveur").fill("10.0.1.10");
  await expect(dlg.getByLabel("Partage NFS")).toContainText("/volume1/iso");
  await dlg.getByLabel("Partage NFS").selectOption("/volume1/iso");
  await dlg.getByLabel("Images ISO").check();
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  const row = page.locator("tr", { hasText: id });
  await expect(row).toContainText("10.0.1.10:/volume1/iso");
  await row.getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("dialog").getByLabel("Désactivé").check();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(row).toContainText("désactivé");
  await row.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(id);
  await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
  await expect(page.locator("tr", { hasText: id })).toHaveCount(0);
  // Un serveur injoignable donne une erreur claire dans le formulaire
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("menuitem", { name: "NFS" }).click();
  await page.getByRole("dialog").getByLabel("Serveur").fill("192.0.2.1");
  await expect(page.getByRole("dialog")).toContainText("Liste indisponible");
  expect(errors.filter((e) => !e.includes("500"))).toEqual([]);
});

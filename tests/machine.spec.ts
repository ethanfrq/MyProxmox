// Phase 4 : fiche machine (matériel, options, Cloud-Init, historique, notes).
import { test, expect, type Page } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

async function open(page: Page, path: string, tab: string) {
  await page.goto(`${path}?onglet=${tab}`);
  await expect(page.locator("main h1")).toBeVisible();
}

test("matériel VM : ajouter, agrandir, détacher, rattacher un disque", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/101", "materiel");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("menuitem", { name: "Disque dur" }).click();
  const dlg = page.getByRole("dialog", { name: "Ajouter un disque" });
  await dlg.getByLabel("Taille").fill("16");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  const row = page.locator("tr", { hasText: "Disque (scsi1)" });
  await expect(row).toContainText("16 Go");
  await row.getByRole("button", { name: "Agrandir" }).click();
  await page.getByRole("dialog").getByLabel("Espace à ajouter").fill("4");
  await page.getByRole("dialog").getByRole("button", { name: "Lancer" }).click();
  await expect(row).toContainText("20 Go");
  await row.getByRole("button", { name: "Détacher" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Détacher" }).click();
  const unused = page.locator("tr", { hasText: "Disque inutilisé" });
  await expect(unused).toBeVisible();
  await unused.getByRole("button", { name: "Rattacher" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "Disque inutilisé" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("matériel VM : carte réseau, processeur et périphérique USB", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/107", "materiel");
  await page.locator("tr", { hasText: "Carte réseau (net0)" }).getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("dialog").getByLabel("VLAN").fill("30");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "Carte réseau (net0)" })).toContainText("VLAN 30");
  await page.locator("tr", { hasText: "Processeur" }).getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("dialog").getByLabel("Cœurs par socket").fill("6");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "Processeur" })).toContainText("6 cœurs");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("menuitem", { name: "Périphérique USB" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "USB (usb0)" })).toContainText("mapping=onduleur");
  expect(errors).toEqual([]);
});

test("conteneur : point de montage et fonctionnalités", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/lxc/102", "materiel");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("menuitem", { name: "Point de montage" }).click();
  await page.getByRole("dialog").getByLabel("Chemin dans le conteneur").fill("/srv/media");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "Point de montage (mp0)" })).toContainText("/srv/media");
  await page.locator("tr", { hasText: "Fonctionnalités" }).getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("dialog").getByLabel(/keyctl/).check();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "Fonctionnalités" })).toContainText("keyctl=1");
  expect(errors).toEqual([]);
});

test("options, ordre de boot, Cloud-Init, historique et notes", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/107", "options");
  await page.locator("tr", { hasText: "Ordre de boot" }).getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("button", { name: "Monter net0" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "Ordre de boot" })).toContainText("scsi0 → net0");
  await page.getByRole("tab", { name: "Cloud-Init" }).click();
  await page.getByLabel("Utilisateur").fill("admin");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Cloud-Init enregistré")).toBeVisible();
  await page.getByRole("button", { name: "Voir user-data" }).click();
  await expect(page.getByRole("dialog")).toContainText("user: admin");
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("tab", { name: "Historique" }).click();
  await expect(page.locator("main table tbody tr").first()).toBeVisible();
  await page.getByRole("tab", { name: "Résumé" }).click();
  await page.getByRole("button", { name: "Modifier" }).click();
  await page.getByLabel("Notes en Markdown").fill("## Docker\n- **Portainer** : https://10.0.1.57:9443");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".md strong")).toHaveText("Portainer");
  expect(errors).toEqual([]);
});

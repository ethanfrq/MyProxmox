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

test("snapshots en arbre : créer, décrire, revenir, supprimer", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/103", "snapshots");
  await expect(page.locator("tr", { hasText: "outils" })).toContainText("RAM");
  await page.getByRole("button", { name: "Prendre un snapshot" }).click();
  await page.getByRole("dialog").getByLabel("Nom").fill("test-e2e");
  await page.getByRole("dialog").getByRole("button", { name: "Prendre le snapshot" }).click();
  const row = page.locator("tr", { hasText: "test-e2e" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Description" }).click();
  await page.getByRole("dialog").getByLabel("Description").fill("Créé par les tests");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(row).toContainText("Créé par les tests");
  await page.locator("tr", { hasText: "propre" }).getByRole("button", { name: "Revenir ici" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revenir à ce snapshot" }).click();
  await row.getByRole("button", { name: "Supprimer test-e2e" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(page.locator("tr", { hasText: "test-e2e" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sauvegardes : maintenant, notes, protection, restauration, fichiers PBS", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/101", "sauvegardes");
  await page.getByRole("button", { name: "Sauvegarder maintenant" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Notes").fill("Test {{guestname}}");
  await dlg.getByLabel(/Protéger/).check();
  await dlg.getByRole("button", { name: "Lancer la sauvegarde" }).click();
  await page.getByRole("button", { name: "Actualiser" }).click();
  await expect(page.locator("tr", { hasText: "Test home-assistant" })).toContainText("protégée");
  const pbs = page.locator("tr", { hasText: "(PBS)" }).first();
  await pbs.getByRole("button", { name: "Fichiers" }).click();
  await page.getByRole("button", { name: "drive-scsi0.img.fidx/" }).click();
  await page.getByRole("button", { name: "part/" }).click();
  await expect(page.getByRole("dialog")).toContainText("1/");
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();
  await pbs.getByRole("button", { name: "Restaurer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restaurer" }).click();
  await expect(page).toHaveURL(/\/machines\/pve\/qemu\/1\d\d/, { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("pare-feu de la machine : règles, ordre, options, alias, IPsets", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/101", "parefeu");
  const rows = page.locator(".fw-table tbody tr");
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  await page.getByRole("button", { name: "Ajouter une règle" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Service connu (macro)").selectOption("HTTPS");
  await dlg.getByLabel("Commentaire").fill("Web e2e");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(rows).toHaveCount(before + 1);
  await expect(rows.first()).toContainText("Web e2e");
  await page.getByRole("button", { name: "Monter la règle 1" }).click();
  await expect(rows.first()).not.toContainText("Web e2e");
  await page.getByRole("switch", { name: "Activer la règle 1" }).click();
  await page.getByRole("button", { name: "Supprimer la règle 1" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(rows).toHaveCount(before);
  await page.getByRole("tab", { name: "Options" }).last().click();
  await page.getByLabel("Pare-feu actif pour cette machine").check();
  await page.getByRole("button", { name: "Enregistrer les options" }).click();
  await expect(page.getByText("Options du pare-feu enregistrées")).toBeVisible();
  await page.getByRole("tab", { name: "Alias" }).click();
  await page.getByRole("button", { name: "Ajouter un alias" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(`imprimante${Date.now() % 1000}`);
  await page.getByRole("dialog").getByRole("textbox", { name: "Adresse ou réseau", exact: true }).fill("10.0.1.30");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("main table")).toContainText("10.0.1.30");
  await page.getByRole("tab", { name: "IPsets" }).click();
  await page.getByRole("button", { name: "Ajouter" }).first().click();
  const set = `amis${Date.now() % 1000}`;
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(set);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(`Adresses de ${set}`)).toBeVisible();
  await page.getByRole("button", { name: "Ajouter", exact: true }).last().click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Adresse ou réseau", exact: true }).fill("192.168.5.0/24");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("main")).toContainText("192.168.5.0/24");
  await page.getByRole("tab", { name: "Journal" }).click();
  await expect(page.locator("pre.log")).toContainText("DROP");
  expect(errors).toEqual([]);
});

test("permissions sur la machine", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/105", "permissions");
  await expect(page.locator("main table")).toContainText("hérité");
  await page.getByRole("button", { name: "Ajouter une permission" }).click();
  await page.getByRole("dialog").getByLabel("Rôle").selectOption("PVEVMUser");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  const row = page.locator("tr", { hasText: "PVEVMUser" }).filter({ hasText: "/vms/105" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("console intégrée : terminal du conteneur via le relais WebSocket", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/lxc/100", "console");
  await expect(page.getByText("Connecté")).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText("Bienvenue");
  await page.locator(".console-term").click();
  await page.keyboard.type("uptime");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("load average");
  await open(page, "/machines/pve/qemu/101", "console");
  await expect(page.locator(".console")).toContainText("La démo n'a pas d'écran");
  expect(errors).toEqual([]);
});

test("agent invité : informations, gel et dégel", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/101", "agent");
  await expect(page.locator("main")).toContainText("Debian GNU/Linux 12");
  await expect(page.locator("main")).toContainText("/boot/efi");
  await page.getByRole("button", { name: "Geler les fichiers" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Geler" }).click();
  await expect(page.getByText("gelés (écritures bloquées)")).toBeVisible();
  await page.getByRole("button", { name: "Dégeler les fichiers" }).click();
  await expect(page.getByText("normal", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("pause et reprise d'une VM", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "/machines/pve/qemu/107", "resume");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Reprendre" })).toBeVisible();
  await page.getByRole("button", { name: "Reprendre" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(errors).toEqual([]);
});

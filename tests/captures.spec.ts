// Captures de la documentation (docs/images). Lance : CAPTURES=1 npx playwright test captures
import { test, expect, type Page } from "@playwright/test";
import { loginProxmox } from "./helpers";

test.skip(!process.env.CAPTURES, "captures seulement avec CAPTURES=1");
test.use({ viewport: { width: 1440, height: 900 } });

async function shot(page: Page, url: string, file: string, prepare?: () => Promise<void>) {
  await page.goto(url);
  await page.addStyleTag({ content: ".toasts { display: none !important; }" });
  await expect(page.locator("main h1").first()).toBeVisible();
  if (prepare) await prepare();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `docs/images/${file}.png` });
}

test("captures de la fiche machine et de la création", async ({ page }) => {
  await loginProxmox(page);
  await shot(page, "/machines/pve/qemu/101", "machine");
  await shot(page, "/machines/pve/qemu/105?onglet=materiel", "machine-materiel");
  await shot(page, "/machines/pve/qemu/103?onglet=snapshots", "machine-snapshots");
  await shot(page, "/machines/pve/qemu/101?onglet=parefeu", "machine-parefeu");
  await shot(page, "/machines/pve/lxc/100?onglet=console", "machine-console", async () => {
    await expect(page.locator(".xterm-rows")).toContainText("Bienvenue");
    await page.locator(".console-term").click();
    await page.keyboard.type("uname -a");
    await page.keyboard.press("Enter");
  });
  await shot(page, "/creer", "creer-assistant", async () => {
    await page.getByRole("button", { name: "Assistant complet" }).click();
    await page.getByRole("tab", { name: "Machine virtuelle" }).click();
  });
  await shot(page, "/machines", "machines");
});

test("captures du nœud", async ({ page }) => {
  await loginProxmox(page);
  await shot(page, "/serveur?node=pve&onglet=resume", "noeud-resume");
  await shot(page, "/serveur?node=pve&onglet=disques", "serveur-disques");
  await shot(page, "/serveur?node=pve&onglet=reseau", "noeud-reseau", async () => {
    await page.getByRole("button", { name: "Créer" }).click();
    await page.getByRole("menuitem", { name: "Pont Linux" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill("vmbr9");
    await page.getByRole("dialog").getByLabel("Adresse IPv4").fill("172.16.9.1/24");
    await page.getByRole("dialog").getByRole("button", { name: "Préparer le changement" }).click();
    await expect(page.locator("pre.diff")).toBeVisible();
  });
  await shot(page, "/serveur?node=pve&onglet=journaux", "noeud-journal");
});

test("captures du datacenter", async ({ page }) => {
  await loginProxmox(page);
  await shot(page, "/datacenter/resume", "datacenter");
  await shot(page, "/datacenter/stockage", "datacenter-stockage");
  await shot(page, "/datacenter/permissions", "datacenter-permissions");
  await shot(page, "/datacenter/sauvegardes", "datacenter-sauvegardes");
});

test("captures du stockage", async ({ page }) => {
  await loginProxmox(page);
  await shot(page, "/stockage?node=pve&storage=backup-nas&onglet=resume", "stockage");
  await shot(page, "/stockage?node=pve&storage=local-lvm&onglet=orphelins", "stockage-orphelins");
});

test("captures des pages générales, de Claude et du monitoring", async ({ page }) => {
  await loginProxmox(page);
  await shot(page, "/", "overview");
  await shot(page, "/claude", "claude");
  await shot(page, "/securite", "securite");
  await shot(page, "/reseau", "reseau");
  await shot(page, "/alertes", "alertes");
  await shot(page, "/sauvegardes", "sauvegardes");
  for (const [vue, file] of [["general", "monitoring"], ["machines", "monitoring-machines"], ["reseau", "monitoring-reseau"], ["stockage", "monitoring-stockage"], ["securite", "monitoring-securite"], ["historique", "monitoring-historique"]]) {
    await page.goto(`/monitoring?vue=${vue}&rotation=0`);
    await expect(page.locator(".mon")).toBeVisible();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `docs/images/${file}.png` });
  }
});

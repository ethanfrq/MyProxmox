// Phase 2 : comptes MyProxmox (inscription, validation, monitoring seul, lecture seule).
import { test, expect } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

const id = `tv-${Date.now().toString(36)}`;
const PASSWORD = "cheval-batterie-agrafe-42";

test.describe.serial("comptes MyProxmox", () => {
  test("l'admin ouvre l'inscription avec validation", async ({ page }) => {
    const errors = watchErrors(page);
    await loginProxmox(page);
    // Repart d'une inscription fermée, quel que soit l'état laissé par un lancement précédent
    expect((await page.request.put("/api/settings", { data: { registration: "off" } })).status()).toBe(200);
    await page.goto("/parametres/comptes");
    await expect(page.locator("main h1")).toHaveText("Comptes MyProxmox");
    await page.getByText("Avec validation", { exact: true }).click();
    await expect(page.getByText("Réglage enregistré")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("inscription, puis refus tant que ce n'est pas validé", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/login");
    await page.getByRole("tab", { name: "Compte MyProxmox" }).click();
    await page.getByRole("link", { name: "Créer un compte" }).click();
    await page.getByLabel("Identifiant").fill(id);
    await page.getByLabel("Nom affiché").fill("Écran de test");
    await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirme le mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByText("Demande envoyée")).toBeVisible();
    await page.getByRole("link", { name: "Aller à la connexion" }).click();
    await page.getByLabel("Identifiant").fill(id);
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("attend la validation")).toBeVisible();
    // L'erreur 401 attendue apparaît dans la console du navigateur : on ne garde que les autres
    expect(errors.filter((e) => !e.includes("401"))).toEqual([]);
  });

  test("l'admin valide l'inscription", async ({ page }) => {
    await loginProxmox(page);
    await page.goto("/parametres/comptes");
    const panel = page.locator(".panel", { hasText: "Inscriptions à valider" });
    const row = panel.locator(".row", { hasText: id }).first();
    await row.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText(`${id} validé`)).toBeVisible();
  });

  test("le compte monitoring n'a accès qu'au monitoring", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/login?compte=local");
    await page.getByLabel("Identifiant").fill(id);
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.locator(".mon")).toBeVisible();
    await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
    // Les autres pages renvoient vers le monitoring, sans barre latérale
    await page.goto("/machines");
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.locator("nav.side")).toHaveCount(0);
    // Et l'API refuse tout le reste
    for (const url of ["/api/insights/overview", "/api/pve/nodes", "/api/settings", "/api/local-users"]) {
      const r = await page.request.get(url);
      expect(r.status(), url).toBe(403);
    }
    expect((await page.request.get("/api/monitoring")).status()).toBe(200);
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(errors.filter((e) => !e.includes("401"))).toEqual([]);
  });

  test("le compte lecture voit tout mais ne peut rien faire", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/login?compte=local");
    await page.getByLabel("Identifiant").fill("lea");
    await page.getByLabel("Mot de passe").fill("demo-monitoring");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator(".topbar")).toContainText("lecture seule");
    await page.goto("/machines");
    await expect(page.locator("main table tbody tr").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Éteindre" })).toHaveCount(0);
    await expect(page.locator("nav.side")).not.toContainText("Créer");
    const r = await page.request.post("/api/pve/nodes/pve/qemu/101/status/shutdown", { data: {} });
    expect(r.status()).toBe(403);
    expect(errors).toEqual([]);
  });
});

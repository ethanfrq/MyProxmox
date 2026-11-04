// Phase 3 : écran de monitoring complet (vues, mur, performance).
import { test, expect } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

test.use({ viewport: { width: 1920, height: 1080 } });

test("chaque vue s'affiche sans erreur", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/monitoring?rotation=0");
  for (const name of ["Vue d'ensemble", "Machines", "Machines en cartes", "Nœuds et cluster", "Réseau", "Stockage et disques", "Sauvegardes et sécurité", "Historique 24 h / 7 j"]) {
    await page.getByRole("navigation", { name: "Vues" }).getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".mon-card").first()).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Historique 7 jours" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("nouveaux widgets : tâches, machines en tableau, réplication, Ceph", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/monitoring?rotation=0&vue=general");
  await expect(page.getByRole("region", { name: "Tâches" })).toContainText("Échecs sur 24 h");
  const vues = page.getByRole("navigation", { name: "Vues" });
  await vues.getByRole("button", { name: "Machines", exact: true }).click();
  const table = page.getByRole("region", { name: "Machines (tableau)" });
  await expect(table).toContainText("home-assistant");
  await expect(table).toContainText("E/S disque");
  await expect(page.getByRole("region", { name: "Plus gros consommateurs" })).toContainText("Processeur");
  await vues.getByRole("button", { name: "Nœuds et cluster" }).click();
  await expect(page.getByRole("region", { name: "Réplication" })).toContainText("vaultwarden");
  await expect(page.getByRole("region", { name: "Ceph" })).toContainText("OSD actifs");
  expect(errors).toEqual([]);
});

test("pas de défilement par défaut, et défilement à la demande", async ({ page }) => {
  await loginProxmox(page);
  await page.goto("/monitoring");
  await expect(page.getByRole("combobox", { name: "Défilement des vues" })).toHaveValue("0");
  await expect(page.locator(".mon-view.cur")).toHaveText(/Vue d'ensemble/);
  await page.waitForTimeout(2500);
  await expect(page.locator(".mon-view.cur")).toHaveText(/Vue d'ensemble/);
  // La vue choisie est gardée au prochain chargement
  await page.getByRole("navigation", { name: "Vues" }).getByRole("button", { name: "Réseau" }).click();
  await page.reload();
  await expect(page.locator(".mon-view.cur")).toHaveText(/Réseau/);
  // Défilement demandé par l'adresse (écran de TV)
  await page.goto("/monitoring?rotation=3&vue=general");
  await expect(page.locator(".mon-view.cur")).toHaveText(/Machines/, { timeout: 8_000 });
});

test("un administrateur crée un mur, choisi par ?layout=", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/monitoring?rotation=0");
  await page.getByRole("button", { name: "Créer un mur" }).click();
  const editor = page.getByRole("dialog", { name: "Disposition du mur" });
  await editor.getByRole("textbox").fill("test-mur");
  await editor.getByRole("combobox", { name: "Ajouter un widget" }).selectOption("ceph");
  await editor.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/layout=test-mur/);
  await expect(page.getByRole("region", { name: "Ceph" })).toBeVisible();
  await page.goto("/monitoring?layout=salon");
  await expect(page.getByRole("region", { name: "Machines" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("un compte monitoring ne peut pas modifier les murs", async ({ page }) => {
  await page.goto("/login?compte=local");
  await page.getByLabel("Identifiant").fill("tv-salon");
  await page.getByLabel("Mot de passe").fill("demo-monitoring");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator(".mon-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /mur/ })).toHaveCount(0);
  const r = await page.request.put("/api/monitoring-layouts/pirate", { data: { widgets: [{ id: "kpis", w: 12, h: 1 }] } });
  expect(r.status()).toBe(403);
});

test("/api/monitoring répond en moins de 300 ms", async ({ page }) => {
  await loginProxmox(page);
  await page.request.get("/api/monitoring"); // premier appel : remplit le cache des données lourdes
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    const r = await page.request.get("/api/monitoring");
    times.push(Date.now() - t);
    expect(r.ok()).toBeTruthy();
    await page.waitForTimeout(300);
  }
  console.log(`/api/monitoring : ${times.join(", ")} ms`);
  expect(Math.max(...times)).toBeLessThan(300);
});

// Captures de la doc : CAPTURES=1 npx playwright test monitoring
test("captures des vues", async ({ page }) => {
  test.skip(!process.env.CAPTURES, "captures seulement avec CAPTURES=1");
  await loginProxmox(page);
  const views = ["general", "machines", "reseau", "stockage", "securite", "historique"];
  for (const v of views) {
    await page.goto(`/monitoring?rotation=0&vue=${v}`);
    await page.waitForTimeout(v === "general" ? 6000 : 1500);
    await page.screenshot({ path: `docs/images/monitoring${v === "general" ? "" : `-${v}`}.png` });
  }
});

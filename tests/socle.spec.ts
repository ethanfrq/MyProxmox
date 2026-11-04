// Phase 1 : arbre des ressources, tableau générique, journal de tâche.
import { test, expect } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

test("arbre : affiché, repliable, état mémorisé, menu contextuel", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  const tree = page.getByRole("complementary", { name: "Arbre des ressources" });
  await expect(tree).toBeVisible();
  await expect(tree.getByText("101 (home-assistant)")).toBeVisible();
  await tree.getByText("101 (home-assistant)").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Éteindre" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await tree.getByRole("combobox", { name: "Vue de l'arbre" }).selectOption("pools");
  await expect(tree.getByText("infra", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Replier l'arbre" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Afficher l'arbre des ressources" })).toBeVisible();
  await page.getByRole("button", { name: "Afficher l'arbre des ressources" }).click();
  await expect(page.getByRole("complementary", { name: "Arbre des ressources" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("machines : tri, filtre, sélection, journal de tâche", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.goto("/machines");
  const rows = page.locator("main table tbody tr");
  await expect(rows.first()).toContainText("100");
  await page.getByRole("button", { name: "ID" }).click(); // déjà croissant : passe en décroissant
  await expect(rows.first()).toContainText("120");
  await page.getByRole("searchbox").fill("jellyfin");
  await expect(rows).toHaveCount(1);
  await page.getByRole("searchbox").fill("");
  await page.getByLabel("Sélectionner pihole").check();
  await expect(page.locator(".bulkbar")).toContainText("1 sélectionnée");
  await page.locator(".bulkbar").getByRole("button", { name: "Snapshot" }).click();
  await page.getByRole("button", { name: "Prendre les snapshots" }).click();
  await page.getByRole("button", { name: "Voir le journal" }).first().click();
  await expect(page.getByRole("dialog")).toContainText("TASK OK");
  await page.screenshot({ path: "test-results/machines.png" });
  expect(errors).toEqual([]);
});

// Accessibilité : clavier, focus visible, libellés des boutons à icône.
import { expect, test } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

test("lien d'évitement et boutons à icône nommés", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Aller au contenu" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#contenu")).toBeFocused();
  for (const name of ["Notifications", "Déconnexion", "Écran de monitoring"]) await expect(page.getByLabel(name, { exact: true }).first()).toBeVisible();
  // Aucun bouton visible sans nom accessible
  const unnamed = await page.locator("button:visible").evaluateAll((list) => list.filter((b) => !(b.getAttribute("aria-label") || b.textContent?.trim() || b.getAttribute("title"))).length);
  expect(unnamed).toBe(0);
  expect(errors).toEqual([]);
});

test("fenêtre : focus à l'intérieur, Tab reste dedans, Échap ferme et rend le focus", async ({ page }) => {
  await loginProxmox(page);
  await page.goto("/datacenter/resume");
  const opener = page.getByRole("button", { name: "Informations de jonction" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("ligne de tableau ouverte au clavier", async ({ page }) => {
  await loginProxmox(page);
  await page.goto("/sauvegardes");
  const row = page.locator("main tr.clickable").first();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/machines\//);
});

// Outils communs aux tests Playwright.
import { expect, type Page } from "@playwright/test";

/** Collecte les erreurs de la console et les exceptions de la page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console : ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`exception : ${e.message}`));
  return errors;
}

/** Connexion avec un compte Proxmox (n'importe lequel en démo). */
export async function loginProxmox(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Mot de passe").fill("demo");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
}

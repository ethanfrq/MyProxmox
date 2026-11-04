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

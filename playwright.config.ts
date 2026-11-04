// Tests de bout en bout en mode démo (faux Proxmox). Lance : npx playwright test
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1, // une seule session à la fois (voir CLAUDE.md)
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:8080",
    viewport: { width: 1440, height: 900 },
    locale: "fr-FR",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node scripts/demo.mjs",
    url: "http://localhost:8080/api/status",
    reuseExistingServer: true,
    timeout: 30_000,
    env: { MYPROXMOX_DATA: "data-demo-tests" },
  },
});

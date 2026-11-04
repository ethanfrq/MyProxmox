// Phase 6 : Datacenter.
import { test, expect, type Page } from "@playwright/test";
import { loginProxmox, watchErrors } from "./helpers";

async function open(page: Page, section: string) {
  await page.goto(`/datacenter/${section}`);
  await expect(page.locator("main h1")).toHaveText("Datacenter");
}
const uniq = (p: string) => `${p}${Date.now() % 100000}`;

test("résumé du cluster, informations de jonction, options", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "resume");
  await expect(page.locator("main")).toContainText("maison");
  await page.getByRole("button", { name: "Informations de jonction" }).click();
  await expect(page.getByRole("dialog").getByLabel("Informations de jonction")).not.toBeEmpty();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();
  await open(page, "options");
  await page.getByLabel("Proxy HTTP").fill("http://proxy.lan:3128");
  await page.getByRole("button", { name: "Enregistrer les options" }).click();
  await expect(page.getByText("Options enregistrées")).toBeVisible();
  expect(errors).toEqual([]);
});

test("pare-feu : groupe de sécurité et ses règles", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "parefeu");
  await page.getByRole("tab", { name: "Groupes de sécurité" }).click();
  const name = uniq("g");
  await page.getByRole("button", { name: "Créer un groupe" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.locator("tr", { hasText: name }).getByRole("button", { name: "Règles" }).click();
  await page.getByRole("button", { name: "Ajouter une règle" }).click();
  await page.getByRole("dialog").getByLabel("Service connu (macro)").selectOption("SSH");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".fw-table")).toContainText("SSH");
  expect(errors).toEqual([]);
});

test("mappings, métriques, notifications", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "mappings");
  await page.getByRole("tab", { name: "USB" }).click();
  await page.getByRole("button", { name: "Ajouter" }).click();
  const m = uniq("usb");
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(m);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: m })).toContainText("node=pve");
  await open(page, "metriques");
  await page.getByRole("button", { name: "Ajouter un serveur" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(uniq("graf"));
  await page.getByRole("dialog").getByLabel("Type").selectOption("graphite");
  await page.getByRole("dialog").getByLabel("Serveur").fill("10.0.1.30");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("main table")).toContainText("10.0.1.30");
  await open(page, "notifications");
  await page.getByRole("button", { name: "Ajouter une cible" }).click();
  const t = uniq("hook");
  await page.getByRole("dialog").getByLabel("Type").selectOption("webhook");
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(t);
  await page.getByRole("dialog").getByLabel("Adresse du webhook").fill("https://ntfy.sh/test");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.locator("tr", { hasText: t }).getByRole("button", { name: "Tester" }).click();
  await expect(page.getByText(`Notification de test envoyée à ${t}`)).toBeVisible();
  await page.getByRole("button", { name: "Ajouter une règle" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(uniq("r"));
  await page.getByRole("dialog").getByLabel(new RegExp(`^${t}`)).check();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: t }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("stockage : ajouter un NFS (partages trouvés sur le serveur), modifier, retirer", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "stockage");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("menuitem", { name: "NFS" }).click();
  const id = uniq("nas");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Identifiant").fill(id);
  await dlg.getByLabel("Serveur").fill("10.0.1.10");
  await expect(dlg.getByLabel("Partage NFS")).toContainText("/volume1/iso");
  await dlg.getByLabel("Partage NFS").selectOption("/volume1/iso");
  await dlg.getByLabel("Images ISO").check();
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  const row = page.locator("tr", { hasText: id });
  await expect(row).toContainText("10.0.1.10:/volume1/iso");
  await row.getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("dialog").getByLabel("Désactivé").check();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(row).toContainText("désactivé");
  await row.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(id);
  await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
  await expect(page.locator("tr", { hasText: id })).toHaveCount(0);
  // Un serveur injoignable donne une erreur claire dans le formulaire
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("menuitem", { name: "NFS" }).click();
  await page.getByRole("dialog").getByLabel("Serveur").fill("192.0.2.1");
  await expect(page.getByRole("dialog")).toContainText("Liste indisponible");
  expect(errors.filter((e) => !e.includes("500"))).toEqual([]);
});

test("sauvegardes planifiées : créer par tag, exécuter maintenant, machines non couvertes", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "sauvegardes");
  await expect(page.locator(".panel", { hasText: "Machines non couvertes" })).toContainText("lab-kali");
  await page.getByRole("button", { name: "Créer une tâche" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Machines à sauvegarder").selectOption("tag");
  await expect(dlg.getByLabel("Tag")).toContainText("lab");
  await dlg.getByLabel("Tag").selectOption("lab");
  await dlg.getByLabel("Garder les dernières").fill("5");
  await dlg.getByLabel("Commentaire").fill("Machines du lab");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  const row = page.locator("tr", { hasText: "Machines du lab" });
  await expect(row).toContainText("103");
  await expect(page.locator(".panel", { hasText: "Machines non couvertes" })).not.toContainText("lab-kali");
  await row.getByRole("button", { name: "Exécuter maintenant" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Lancer" }).click();
  await expect(page.getByText(/Sauvegarde backup-.* : terminé/).first()).toBeVisible();
  await row.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  expect(errors).toEqual([]);
});

test("réplication du cluster", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "replication");
  await expect(page.locator("main table")).toContainText("106-0");
  await page.getByRole("button", { name: "Ajouter une réplication" }).click();
  await page.getByRole("dialog").getByLabel("Machine").selectOption({ label: "104 nextcloud (sur pve)" });
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "104-" })).toContainText("pve2");
  expect(errors).toEqual([]);
});

test("permissions : utilisateur, rôle personnalisé, ACL, jeton, 2FA, pool", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "permissions");
  const name = uniq("alice");
  await page.getByRole("button", { name: "Créer un utilisateur" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox", { name: "Identifiant", exact: true }).fill(name);
  await dlg.getByLabel("Mot de passe").fill("motdepasse-solide");
  await dlg.getByLabel("famille").check();
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: `${name}@pve` })).toContainText("famille");
  await page.locator("tr", { hasText: `${name}@pve` }).getByRole("button", { name: "Mot de passe" }).click();
  await page.getByRole("dialog").getByLabel("Nouveau mot de passe").fill("encore-plus-solide");
  await page.getByRole("dialog").getByLabel("Confirme").fill("encore-plus-solide");
  await page.getByRole("dialog").getByRole("button", { name: "Changer" }).click();
  await expect(page.getByText("Mot de passe changé")).toBeVisible();

  await page.getByRole("tab", { name: "Rôles" }).click();
  await page.getByRole("button", { name: "Créer un rôle" }).click();
  dlg = page.getByRole("dialog");
  const role = uniq("Lecteur");
  await dlg.getByLabel("Nom du rôle").fill(role);
  await dlg.getByLabel(/^VM.Audit/).check();
  await dlg.getByLabel(/^VM.Console/).check();
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: role })).toContainText("2 : VM.Audit, VM.Console");

  await page.getByRole("tab", { name: "Permissions (ACL)" }).click();
  await page.getByRole("button", { name: "Ajouter une permission" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox", { name: "Chemin", exact: true }).fill("/vms/102");
  await dlg.getByLabel("Qui").selectOption(`${name}@pve`);
  await dlg.getByLabel("Rôle").selectOption(role);
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".acl-tree")).toContainText(`${name}@pve : ${role}`);

  await page.getByRole("tab", { name: "Jetons API" }).click();
  await page.getByRole("button", { name: "Créer un jeton" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Utilisateur").selectOption(`${name}@pve`);
  await dlg.getByLabel("Nom du jeton").fill("script");
  await dlg.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByRole("dialog", { name: "Secret du jeton" })).toContainText(`${name}@pve!script`);
  await page.getByRole("button", { name: "Je l'ai copié" }).click();

  await page.getByRole("tab", { name: "Double authentification" }).click();
  await page.getByLabel("Utilisateur").selectOption(`${name}@pve`);
  await page.getByRole("button", { name: "Codes de récupération" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Générer" }).click();
  await expect(page.getByRole("dialog", { name: "Codes de récupération" })).toContainText("-");
  await page.getByRole("button", { name: "Je les ai notés" }).click();

  await page.getByRole("tab", { name: "Pools" }).click();
  await page.getByRole("button", { name: "Créer un pool" }).click();
  const pool = uniq("pool");
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(pool);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.locator("tr", { hasText: pool }).getByRole("button", { name: "Membres" }).click();
  await page.getByRole("dialog").getByLabel("105 win11-test").check();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Membres enregistrés")).toBeVisible();
  expect(errors).toEqual([]);
});

test("haute disponibilité : groupe, ressource, état", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "ha");
  await expect(page.locator("main")).toContainText("vm:101");
  await page.getByRole("tab", { name: "Groupes" }).click();
  await page.getByRole("button", { name: "Créer un groupe" }).click();
  const g = uniq("ha");
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(g);
  await page.getByRole("dialog").getByLabel("Nœuds et priorités").fill("pve2:2,pve:1");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("tab", { name: "Ressources" }).click();
  await page.getByRole("button", { name: "Ajouter une machine" }).click();
  await page.getByRole("dialog").getByLabel("Machine").selectOption({ label: "102 jellyfin" });
  await page.getByRole("dialog").getByLabel("Groupe").selectOption(g);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("tr", { hasText: "ct:102" })).toContainText(g);
  await page.locator("tr", { hasText: "ct:102" }).getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  expect(errors).toEqual([]);
});

test("SDN : zone, VNet, sous-réseau, appliquer", async ({ page }) => {
  const errors = watchErrors(page);
  await loginProxmox(page);
  await open(page, "sdn");
  const z = `z${Date.now() % 10000}`;
  await page.getByRole("button", { name: "Ajouter une zone" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(z);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Des changements SDN ne sont pas encore appliqués")).toBeVisible();
  await page.getByRole("tab", { name: "VNets et sous-réseaux" }).click();
  await page.getByRole("button", { name: "Ajouter un VNet" }).click();
  const n = `v${Date.now() % 10000}`;
  await page.getByRole("dialog").getByRole("textbox", { name: "Nom", exact: true }).fill(n);
  await page.getByRole("dialog").getByLabel("Zone").selectOption(z);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await page.locator("tr", { hasText: n }).getByRole("button", { name: "Sous-réseaux" }).click();
  await page.getByRole("button", { name: "Ajouter un sous-réseau" }).click();
  await page.getByRole("dialog").getByLabel("Réseau").fill("10.20.0.0/24");
  await page.getByRole("dialog").getByLabel("Passerelle").fill("10.20.0.1");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("main")).toContainText("10.20.0.0/24");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Appliquer sur tous les nœuds" }).click();
  await expect(page.getByText("Application du SDN : terminé")).toBeVisible();
  await expect(page.getByText("Des changements SDN ne sont pas encore appliqués")).toHaveCount(0);
  expect(errors).toEqual([]);
});

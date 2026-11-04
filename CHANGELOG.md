# Historique

## 2.0.0 (en cours)

- Socle commun : tableau triable avec actions groupées, formulaires décrits par schéma, assistants à étapes, journal des tâches en direct (« Voir le journal » dans les notifications), arbre des ressources à gauche (vues serveurs, pools, tags) avec menu contextuel
- Les boutons d'action suivent les droits Proxmox de la personne connectée (`GET /access/permissions`)
- Comptes MyProxmox, à côté des comptes Proxmox : rôles « monitoring » (écran de monitoring seul) et « lecture » (tout voir, rien changer), inscription libre réglable, validation par un administrateur, 2FA TOTP, page Paramètres > Comptes MyProxmox
- Écran de monitoring refait : six vues qui tournent (générale, machines, réseau, stockage et disques, sauvegardes et sécurité, historique 24 h / 7 j), mode « mur » avec dispositions nommées (`?layout=nom`), PSI, cache, KSM, services critiques, débit par pont, SMART et températures, quorum et HA, activité en direct, son optionnel en alerte critique, graphiques SVG maison, tailles adaptées à la 4K et aux tablettes
- Tests de bout en bout Playwright en mode démo

## 1.0.0

Première version publique.

- Connexion avec les comptes Proxmox (2FA comprise) et filtre par plages IP
- Vue d'ensemble, machines, fiche machine, création VM et LXC, stockage, réseau, tâches
- Pages Serveur (SMART, ZFS, services, mises à jour, certificats), Sauvegardes et Sécurité
- Alertes avec notifications dans l'app, dans le navigateur, sur Discord, ntfy et webhook
- Écran de monitoring en lecture seule, ouvert par un lien secret
- Serveur MCP (13 outils) avec clés en lecture ou en actions, et pont stdio pour Claude Desktop
- Lanceurs Windows avec mise à jour automatique depuis GitHub, script Linux, Docker
- Mode démo, vitrine et démo publiables sur Vercel

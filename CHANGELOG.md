# Historique

## 2.0.0 (en cours)

- Socle commun : tableau triable avec actions groupées, formulaires décrits par schéma, assistants à étapes, journal des tâches en direct (« Voir le journal » dans les notifications), arbre des ressources à gauche (vues serveurs, pools, tags) avec menu contextuel
- Les boutons d'action suivent les droits Proxmox de la personne connectée (`GET /access/permissions`)
- Comptes MyProxmox, à côté des comptes Proxmox : rôles « monitoring » (écran de monitoring seul) et « lecture » (tout voir, rien changer), inscription libre réglable, validation par un administrateur, 2FA TOTP, page Paramètres > Comptes MyProxmox
- Écran de monitoring refait : six vues qui tournent (générale, machines, réseau, stockage et disques, sauvegardes et sécurité, historique 24 h / 7 j), mode « mur » avec dispositions nommées (`?layout=nom`), PSI, cache, KSM, services critiques, débit par pont, SMART et températures, quorum et HA, activité en direct, son optionnel en alerte critique, graphiques SVG maison, tailles adaptées à la 4K et aux tablettes
- Machines et conteneurs à parité avec Proxmox : matériel complet, Cloud-Init, options, ordre de boot, historique, notes en Markdown, snapshots en arbre, sauvegardes avec toutes les options, restauration avec options, restauration de fichiers depuis Proxmox Backup Server, réplication, migration, clonage, modèles, pare-feu, permissions, agent invité
- Console intégrée : noVNC pour les VM, xterm.js pour les conteneurs, relais WebSocket authentifié `/api/console`
- Nœud à parité avec Proxmox : alimentation avec double confirmation, tout démarrer / arrêter / migrer, shell intégré, réseau (ponts, bonds, VLAN, OVS) avec diff de /etc/network/interfaces avant application, DNS, hosts, fuseau, certificats personnalisés et ACME (comptes, plugins DNS), mises à jour et dépôts APT, disques (SMART, GPT, effacement, LVM, LVM-thin, répertoires, assistant ZFS), Ceph, services, journal en direct, tâches, abonnement, pare-feu
- Datacenter à parité avec Proxmox : cluster (création, jonction), options, stockages de tous types avec recherche des partages, sauvegardes planifiées complètes, réplication, permissions (utilisateurs, groupes, pools, rôles personnalisés, ACL en arbre, domaines, 2FA, jetons), haute disponibilité, SDN, ACME, métriques, notifications, mappings, pare-feu et groupes de sécurité
- Assistants de création complets (VM et conteneur), création depuis un modèle, mode simple conservé
- Actions groupées : redémarrage, sauvegarde, migration, ajout et retrait de tags
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

# Sécurité

## Signaler une faille

Si tu trouves une faille, ne l'ouvre pas en issue publique. Utilise l'onglet **Security > Report a vulnerability** du dépôt GitHub (signalement privé). Indique la version, les étapes pour reproduire et l'impact. Je réponds dès que possible.

## Ce que fait MyProxmox pour te protéger

| Sujet | Choix |
|---|---|
| Connexion | Avec ton compte Proxmox (2FA TOTP prise en charge). Le ticket Proxmox reste côté serveur ; le navigateur n'a qu'un cookie de session `HttpOnly` et `SameSite=Strict`. |
| Droits | Chaque personne garde ses propres droits Proxmox. Les réglages de MyProxmox demandent `Sys.Modify` sur `/`. |
| Compte de service | `myproxmox@pve` avec le rôle `MyProxmoxService` : lecture, démarrage et arrêt, snapshots, sauvegardes. Pas de suppression, de modification de configuration ni de gestion des permissions. |
| Réseau | Filtre par plages IP (CIDR) devant tout, MCP et monitoring compris. L'assistant de configuration n'est accessible que depuis des adresses privées et se verrouille une fois terminé. |
| Secrets | Clés MCP et lien de monitoring stockés sous forme d'empreinte SHA-256, affichés une seule fois. |
| MCP | Deux niveaux de clé. Aucune action destructrice exposée. Actions et refus journalisés. |
| Indexation | `X-Robots-Tag: noindex` et `robots.txt` qui bloque tout. |

## Limites connues

- Le secret du jeton de service est en clair dans `data/config.json`. Protège ce dossier (droits du système de fichiers, pas de partage réseau, pas de commit).
- L'app parle en HTTP. Sur un réseau local de confiance, ça se défend ; pour tout le reste, mets un reverse proxy HTTPS devant (voir [docs/INSTALL.md](docs/INSTALL.md)).
- Les sessions sont en mémoire : un redémarrage déconnecte tout le monde.
- Le certificat auto-signé de Proxmox est accepté si tu coches l'option. Pour plus de sûreté, installe un vrai certificat sur Proxmox (ACME) et décoche-la.
- Ne publie jamais MyProxmox directement sur Internet.

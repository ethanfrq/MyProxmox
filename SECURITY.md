# Sécurité

## Signaler une faille

Si tu trouves une faille, ne l'ouvre pas en issue publique. Utilise l'onglet **Security > Report a vulnerability** du dépôt GitHub (signalement privé). Indique la version, les étapes pour reproduire et l'impact. Je réponds dès que possible.

## Ce que fait MyProxmox pour te protéger

| Sujet | Choix |
|---|---|
| Connexion | Avec ton compte Proxmox (2FA TOTP prise en charge). Le ticket Proxmox reste côté serveur ; le navigateur n'a qu'un cookie de session `HttpOnly` et `SameSite=Strict`. |
| Droits | Chaque personne garde ses propres droits Proxmox. Les réglages de MyProxmox demandent `Sys.Modify` sur `/`. |
| Comptes MyProxmox | Comptes locaux dans `data/users.json`, indépendants de Proxmox. Mot de passe haché avec scrypt et un sel aléatoire par compte. 10 caractères au minimum, refus des 1000 mots de passe les plus courants (même suivis de chiffres) et de ceux qui contiennent l'identifiant. 5 échecs de connexion par minute et par IP au plus ; chaque connexion, réussie ou non, est journalisée. 2FA TOTP (RFC 6238) au choix de chaque personne. |
| Rôles locaux | Même cookie de session que les comptes Proxmox, avec un champ `kind` (`proxmox` ou `local`). Un compte `monitoring` n'atteint que `/api/monitoring` (403 partout ailleurs). Un compte `lecture` lit tout avec le jeton de service mais ne peut faire aucune écriture ; l'interface ne lui montre que les droits `*.Audit`. Désactiver, supprimer ou changer le rôle d'un compte ferme ses sessions. |
| Inscription | Fermée par défaut. Un administrateur peut l'ouvrir avec validation (notification à chaque demande) ou sans (rôle monitoring uniquement). |
| Compte de service | `myproxmox@pve` avec le rôle `MyProxmoxService` : lecture, démarrage et arrêt, snapshots, sauvegardes. Pas de suppression, de modification de configuration ni de gestion des permissions. |
| Réseau | Filtre par plages IP (CIDR) devant tout, MCP et monitoring compris. L'assistant de configuration n'est accessible que depuis des adresses privées et se verrouille une fois terminé. |
| Console | Le navigateur se connecte à `/api/console` (WebSocket). Le serveur vérifie la plage IP, l'origine de la page, et une session de compte Proxmox, puis relaie vers `vncwebsocket` de Proxmox avec le ticket de la personne. Le ticket VNC est demandé par la personne elle-même (droit `VM.Console` ou `Sys.Console`). Chaque ouverture est journalisée. |
| Secrets | Clés MCP et lien de monitoring stockés sous forme d'empreinte SHA-256, affichés une seule fois. |
| MCP | Deux niveaux de clé. Aucune action destructrice exposée. Actions et refus journalisés. |
| Indexation | `X-Robots-Tag: noindex` et `robots.txt` qui bloque tout. |

## Limites connues

- Un compte MyProxmox en lecture voit tout ce que voit le compte de service (toutes les machines, tous les nœuds). Pour un accès limité à certaines machines, crée plutôt un compte Proxmox avec des droits restreints.
- Le secret du jeton de service est en clair dans `data/config.json`. Protège ce dossier (droits du système de fichiers, pas de partage réseau, pas de commit).
- L'app parle en HTTP. Sur un réseau local de confiance, ça se défend ; pour tout le reste, mets un reverse proxy HTTPS devant (voir [docs/INSTALL.md](docs/INSTALL.md)).
- Les sessions sont en mémoire : un redémarrage déconnecte tout le monde.
- Le certificat auto-signé de Proxmox est accepté si tu coches l'option. Pour plus de sûreté, installe un vrai certificat sur Proxmox (ACME) et décoche-la.
- Ne publie jamais MyProxmox directement sur Internet.

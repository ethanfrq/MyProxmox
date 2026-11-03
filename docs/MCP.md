# Brancher Claude sur MyProxmox

Ce guide explique comment donner à Claude un accès à ton serveur Proxmox à travers MyProxmox. Compte 5 minutes.

## Le principe en une phrase

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) est un standard qui permet à un assistant comme Claude d'utiliser des outils. MyProxmox expose ses propres outils (« donne-moi l'état du serveur », « liste les machines », « prends un snapshot ») et Claude les appelle quand ta question en a besoin.

```
Toi ──question──▶ Claude ──MCP──▶ MyProxmox ──jeton de service──▶ Proxmox
                                     │
                                     ├─ vérifie la clé et son niveau
                                     ├─ n'expose que des actions sûres
                                     └─ inscrit tout au journal
```

Claude ne reçoit jamais ton mot de passe ni le jeton Proxmox. Il n'a qu'une clé MCP, que tu peux révoquer à tout moment.

## Étape 1 : créer une clé

1. Ouvre MyProxmox avec un compte administrateur.
2. Va dans **Claude & MCP**, panneau **Clés MCP**.
3. Donne un nom à la clé (par exemple « Claude Desktop du bureau ») et choisis son niveau :
   - **Lecture seule** : Claude peut tout consulter, rien modifier. Commence par là.
   - **Lecture + actions** : il peut aussi démarrer, éteindre, redémarrer, prendre un snapshot et lancer une sauvegarde.
4. Copie la clé (elle commence par `mpx_`). Elle ne sera plus jamais affichée : MyProxmox n'en garde qu'une empreinte.

Tu peux changer le niveau d'une clé ou la révoquer plus tard, depuis la même page.

## Étape 2 : brancher ton client

### Claude Code

Claude Code parle directement en HTTP. Dans un terminal :

```bash
claude mcp add --transport http myproxmox http://10.0.1.20:8080/mcp \
  --header "Authorization: Bearer mpx_ta_cle"
```

Remplace `10.0.1.20` par l'adresse du PC qui fait tourner MyProxmox. Lance ensuite `claude` et tape `/mcp` : « myproxmox » doit apparaître comme connecté.

### Claude Desktop

Claude Desktop lance les serveurs MCP locaux en « stdio ». MyProxmox fournit un petit pont (`myproxmox-mcp.cjs`) qui relaie les demandes vers son serveur HTTP. Il a besoin de [Node.js](https://nodejs.org).

1. **Récupère le pont.**
   - Si Claude Desktop tourne sur le même PC que MyProxmox, il est déjà là : `C:\MyProxmox\bridge\dist\myproxmox-mcp.cjs` (adapte le chemin).
   - Sinon, télécharge-le depuis la page **Claude & MCP** (bouton « Télécharger myproxmox-mcp.cjs ») ou à l'adresse `http://10.0.1.20:8080/downloads/myproxmox-mcp.cjs`, et range-le où tu veux.
2. **Ouvre la configuration de Claude Desktop** : Paramètres > Développeur > Modifier la configuration. Le fichier est :
   - Windows : `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS : `~/Library/Application Support/Claude/claude_desktop_config.json`
3. **Colle ce bloc**, avec ton chemin, ton adresse et ta clé. Si `mcpServers` existe déjà, ajoute seulement l'entrée `myproxmox` à l'intérieur.

```json
{
  "mcpServers": {
    "myproxmox": {
      "command": "node",
      "args": ["C:\\MyProxmox\\bridge\\dist\\myproxmox-mcp.cjs"],
      "env": {
        "MYPROXMOX_URL": "http://10.0.1.20:8080",
        "MYPROXMOX_KEY": "mpx_ta_cle"
      }
    }
  }
}
```

Sous Windows, les barres obliques inverses doivent être doublées dans le JSON (`C:\\MyProxmox\\...`). La page **Claude & MCP** génère ce bloc tout prêt, avec ta clé juste après sa création.

4. **Quitte complètement Claude Desktop** (icône de la barre des tâches > Quitter) et relance-le. L'icône des outils doit montrer « myproxmox ».

### Un autre client MCP

Tout client compatible « Streamable HTTP » peut se connecter :

| | |
|---|---|
| URL | `http://ADRESSE:8080/mcp` |
| Transport | Streamable HTTP, sans session |
| Authentification | en-tête `Authorization: Bearer mpx_...` |

Pour un client qui ne parle qu'en stdio, utilise le pont avec les variables `MYPROXMOX_URL` et `MYPROXMOX_KEY`.

## Étape 3 : poser des questions

Quelques exemples :

- « Quel est l'état de mon serveur Proxmox ? »
- « Quelle machine consomme le plus de RAM en ce moment ? »
- « Quelles machines n'ont pas été sauvegardées cette semaine ? »
- « Donne-moi l'adresse IP de jellyfin. »
- « Est-ce qu'un de mes disques montre des signes de faiblesse ? »
- « Il reste combien de place sur mes stockages, et pour combien de temps ? »
- « Y a-t-il eu des tentatives de connexion suspectes ? »
- Avec une clé « actions » : « Prends un snapshot de home-assistant avant que je le mette à jour. »

Claude te demande confirmation avant d'éteindre ou de redémarrer une machine.

## Les outils

| Outil | Niveau | Ce qu'il fait |
|---|---|---|
| `etat_general` | lecture | Nœuds, machines, plus gros consommateurs, surallocation, stockage, alertes |
| `lister_machines` | lecture | Toutes les machines avec IP, MAC, pont, VLAN, tags, démarrage auto |
| `details_machine` | lecture | Configuration, consommation, snapshots, sauvegardes d'une machine |
| `alertes_actives` | lecture | Problèmes détectés en ce moment |
| `sante_serveur` | lecture | Services, SMART, usure des SSD, ZFS, mises à jour, certificats, DNS |
| `stockage` | lecture | Occupation et nombre de jours avant d'être plein |
| `sauvegardes` | lecture | Dernière sauvegarde de chaque machine, tâches planifiées |
| `securite` | lecture | 2FA, jetons API, pare-feu, échecs de connexion |
| `reseau` | lecture | Interfaces, ponts, DNS, IP des machines |
| `taches_recentes` | lecture | Dernières tâches Proxmox et leur résultat |
| `alimentation_machine` | actions | Démarrer, éteindre proprement, redémarrer |
| `snapshot_machine` | actions | Prendre un snapshot |
| `sauvegarder_machine` | actions | Lancer une sauvegarde immédiate |

Jamais possible par MCP, quel que soit le niveau : supprimer une machine ou un fichier, forcer un arrêt, restaurer une sauvegarde, modifier une configuration, changer les réglages de MyProxmox.

## Le journal

Chaque action de Claude, et chaque tentative refusée, apparaît dans **Claude & MCP > Journal du MCP** et sur la vue d'ensemble, avec le nom de la clé utilisée. Les simples lectures ne sont pas journalisées.

## Dépannage

| Symptôme | Piste |
|---|---|
| « MyProxmox ne répond pas » | L'app n'est pas lancée, ou l'adresse dans `MYPROXMOX_URL` est fausse |
| Erreur 403 « Accès refusé » | Le PC de Claude n'est pas dans une plage IP autorisée (Paramètres > Accès réseau) |
| « Clé MCP invalide » | Clé mal copiée ou révoquée : crée-en une nouvelle |
| « Refusé : cette clé est en lecture seule » | Passe la clé en « actions » dans la page Claude & MCP |
| myproxmox n'apparaît pas dans Claude Desktop | JSON invalide (une virgule de trop, des `\` non doublés) ou Claude Desktop pas complètement relancé |
| `node` introuvable | Installe Node.js, ou mets le chemin complet dans `command` (`C:\\Program Files\\nodejs\\node.exe`) |
| « Module MCP désactivé » | Réactive-le dans Paramètres > Modules |

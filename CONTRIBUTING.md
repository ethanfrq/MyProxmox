# Contribuer

Merci de t'intéresser à MyProxmox. Les issues, idées et pull requests sont bienvenues.

## Mettre en place l'environnement

```bash
git clone https://github.com/ethanfrq/MyProxmox.git
cd MyProxmox
npm ci
npm run dev   # serveur en mode démo + interface sur http://localhost:5173
```

Le mode démo suffit pour la plupart des changements d'interface. Pour tester contre un vrai Proxmox, lance `npm run build && npm start` et fais la configuration.

## Où est quoi

- `shared/mock.ts` : le faux Proxmox. Si tu utilises un nouveau chemin de l'API, ajoute-le ici pour que la démo continue de marcher.
- `shared/insights.ts` : les informations calculées (inventaire, sauvegardes, sécurité…).
- `shared/alerts.ts` : les règles d'alerte.
- `server/src/mcp.ts` : les outils MCP.
- `web/src/pages/` : une page par écran.

## Règles du projet

- Interface simple : rectangles, pas d'angles arrondis, couleurs de Proxmox (voir `web/src/styles.css`).
- Les textes de l'interface sont en français, courts et directs, sans jargon quand on peut l'éviter.
- Aucune action destructrice dans le MCP.
- Toute action sensible dans l'interface demande une confirmation.
- `npm run typecheck` et `npm run build` doivent passer.

## Proposer un changement

1. Crée une branche depuis `main`.
2. Fais des commits courts avec un message clair.
3. Ouvre une pull request qui explique le pourquoi, avec une capture si l'interface change.

# MyProxmox : règles pour Claude Code

Interface web pour Proxmox VE. React 19 + Vite dans `web/`, serveur Express 5 dans `server/`, code commun dans `shared/` (dont le faux Proxmox `shared/mock.ts`), pont MCP stdio dans `bridge/`.

La v2 vise la parité avec l'interface Proxmox, phase par phase. L'état de la parité est dans `docs/PARITE.md`.

## Style

- Uniquement des rectangles : `border-radius: 0` partout (déjà forcé dans `web/src/styles.css`, ne le contourne pas).
- Couleurs Proxmox définies par les variables de `web/src/styles.css` (`--orange`, `--bar`, `--line`, `--green`, `--red`, `--amber`, `--blue`...). Aucune nouvelle couleur en dur : si une teinte manque, ajoute une variable dans `:root` et utilise-la.
- Réutilise les composants de `web/src/components/ui.tsx` (`Button`, `Panel`, `PageHead`, `Field`, `Tabs`, `Confirm`, `Notice`, `Empty`, `Meter`, `Switch`, `Toggle`, `useToast`...) avant d'en créer un nouveau.

## Textes

- Interface en français, en tutoiement, phrases courtes, sans jargon inutile.
- Pas de tiret cadratin, pas d'emoji.
- Un message d'erreur dit ce qui se passe et quoi faire.

## Actions

- Toute action destructrice (supprimer, arrêt forcé, restaurer, effacer un disque, modifier le réseau du nœud) passe par `<Confirm>`. Pour les plus graves, utilise `requireText` (l'utilisateur retape le nom ou l'ID).
- L'interface masque ou grise les actions que l'utilisateur n'a pas le droit de faire, d'après `GET /access/permissions`.
- Aucune action destructrice dans le MCP (`server/src/mcp.ts`).

## Mode démo

- Chaque nouveau chemin de l'API Proxmox appelé par le code doit aussi être simulé dans `shared/mock.ts`, pour que `npm run demo` et `npm run build:demo` continuent de marcher sans erreur.

## Parité avec l'API

- `docs/PARITE.md` est produit par `node scripts/api-inventory.mjs`. Ne l'édite pas à la main : relance le script à la fin de chaque phase, il retrouve tout seul les chemins utilisés dans `web/src`, `shared` et `server/src`.
- Si le script signale un appel « sans correspondance », corrige le chemin ou complète `ALIAS_VALUES` / `PREFIXES` dans le script.
- Pour classer un point d'entrée « Hors périmètre », ajoute-le avec sa raison dans `HORS_PERIMETRE` du script. Seulement pour ce qui est interne et sans intérêt pour un humain.

## Façon de travailler

- Une seule session à la fois. Jamais de sous-agents en parallèle : la machine du développeur surchauffe.
- Avant de dire qu'une tâche est finie, tout ceci doit passer :
  1. `npm run typecheck`
  2. `npm run build`
  3. `npm run build:demo`
  4. une vérification Playwright en mode démo (`npm run demo`, puis `npx playwright` sur `http://localhost:8080`) qui ouvre chaque page touchée sans erreur dans la console.
- Si une étape échoue, montre la sortie au lieu d'annoncer que c'est fini.
- Un commit par étape logique, message en français.
- Pas de `git push` sans demande explicite.

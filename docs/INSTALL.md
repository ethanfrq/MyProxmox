# Installer MyProxmox

MyProxmox doit tourner sur une machine qui voit ton serveur Proxmox sur le réseau (port 8006) et qui reste allumée si tu veux recevoir les alertes. Il lui faut Node.js 20 ou plus récent, environ 300 Mo d'espace et presque pas de ressources.

Une fois lancé, il écoute sur le port `8080`. Ouvre `http://adresse-de-la-machine:8080` pour l'assistant de configuration.

## Windows

1. Installe [Node.js LTS](https://nodejs.org) avec les options par défaut.
2. Facultatif mais conseillé : installe [Git](https://git-scm.com/download/win). Les mises à jour seront plus rapides et plus fiables.
3. Récupère MyProxmox :
   - avec Git : `git clone https://github.com/ethanfrq/MyProxmox.git C:\MyProxmox`
   - sans Git : [télécharge le zip](https://github.com/ethanfrq/MyProxmox/archive/refs/heads/main.zip) et décompresse-le dans `C:\MyProxmox`. Évite les chemins avec des espaces ou des accents.
4. Double-clique sur `MyProxmox.bat`.

La fenêtre noire doit rester ouverte : la fermer arrête MyProxmox.

### Lancement au démarrage du PC

`scripts\windows\autostart-on.bat` crée une tâche planifiée Windows qui lance MyProxmox 30 secondes après chaque ouverture de session, en récupérant d'abord la dernière version sur GitHub. `autostart-off.bat` la supprime.

Si le PC doit démarrer MyProxmox sans que personne ne se connecte, ouvre le Planificateur de tâches, modifie la tâche « MyProxmox » et choisis « Exécuter même si l'utilisateur n'est pas connecté ».

### Pare-feu Windows

Au premier lancement, Windows peut demander d'autoriser Node.js sur le réseau. Accepte pour les réseaux privés, sinon les autres appareils (TV de monitoring, Claude sur un autre PC) ne pourront pas joindre l'app.

## Linux ou macOS

```bash
git clone https://github.com/ethanfrq/MyProxmox.git
cd MyProxmox
./start.sh
```

### Service systemd

```ini
# /etc/systemd/system/myproxmox.service
[Unit]
Description=MyProxmox
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/MyProxmox
ExecStart=/opt/MyProxmox/start.sh
Restart=on-failure
User=myproxmox
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin myproxmox
sudo git clone https://github.com/ethanfrq/MyProxmox.git /opt/MyProxmox
sudo chown -R myproxmox: /opt/MyProxmox
sudo systemctl enable --now myproxmox
```

`start.sh` fait un `git pull` à chaque démarrage du service.

## Dans un conteneur LXC sur le Proxmox

C'est pratique, mais garde en tête que si le serveur tombe, MyProxmox tombe avec lui : il ne pourra pas te prévenir. Pour des alertes fiables, fais-le tourner sur une autre machine.

1. Crée un conteneur Debian 12 (1 cœur, 512 Mo de RAM, 4 Go de disque suffisent).
2. Dans le conteneur :

```bash
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
git clone https://github.com/ethanfrq/MyProxmox.git /opt/MyProxmox
```

3. Crée le service systemd décrit plus haut.

## Docker

```bash
git clone https://github.com/ethanfrq/MyProxmox.git
cd MyProxmox
docker compose up -d
```

Les données sont dans `./data`. Pour mettre à jour : `git pull && docker compose up -d --build`.

## Derrière un reverse proxy

Si tu places MyProxmox derrière Caddy, Nginx ou Traefik (par exemple pour avoir du HTTPS), lance-le avec `TRUST_PROXY=1` : il lira alors l'adresse du client dans `X-Forwarded-For` pour le filtre IP. N'active jamais cette option sans proxy devant, sinon n'importe qui pourrait se faire passer pour une adresse autorisée.

Les événements en direct utilisent les Server-Sent Events sur `/api/events` : désactive la mise en mémoire tampon pour ce chemin (`X-Accel-Buffering: no` est déjà envoyé, ce qui suffit pour Nginx).

## Désinstaller

1. Arrête MyProxmox et, sous Windows, lance `scripts\windows\autostart-off.bat`.
2. Supprime le dossier.
3. Dans Proxmox, supprime l'utilisateur `myproxmox@pve` (Datacenter > Permissions > Utilisateurs) et le rôle `MyProxmoxService`.

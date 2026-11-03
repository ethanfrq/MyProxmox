// Page de présentation publiée sur Vercel (la démo est sous /demo).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import "./site.css";
import { I } from "../src/components/icons";
import { REPO_URL } from "../src/lib/env";
import overview from "../../docs/images/overview.png";
import monitoring from "../../docs/images/monitoring.png";
import claude from "../../docs/images/claude.png";
import machines from "../../docs/images/machines.png";
import securite from "../../docs/images/securite.png";
import disques from "../../docs/images/serveur-disques.png";
import reseau from "../../docs/images/reseau.png";
import sauvegardes from "../../docs/images/sauvegardes.png";

const FEATURES = [
  { icon: I.overview, t: "Tout sur un écran", d: "CPU, RAM, swap, disques, réseau, plus gros consommateurs et surallocation, avec les graphes de la dernière heure." },
  { icon: I.machines, t: "Machines lisibles", d: "IP de chaque VM et conteneur, tags, dernière sauvegarde, actions groupées (démarrer, éteindre, snapshot)." },
  { icon: I.monitor, t: "Écran de monitoring", d: "Une vue plein écran en lecture seule pour une TV, ouverte par un lien secret. Elle ne permet aucune action." },
  { icon: I.bell, t: "Alertes", d: "Disque SMART en défaut, pool ZFS dégradé, stockage presque plein, sauvegarde ratée ou trop ancienne, machine tombée…" },
  { icon: I.claude, t: "Serveur MCP pour Claude", d: "Pose tes questions à Claude sur ton serveur. Il passe par MyProxmox, avec une clé révocable et des actions limitées." },
  { icon: I.shield, t: "Audit de sécurité", d: "Comptes sans 2FA, jetons API trop puissants, pare-feu coupé, certificats qui expirent, tentatives de connexion par IP." },
  { icon: I.backup, t: "Couverture des sauvegardes", d: "Quelles machines ne sont dans aucune tâche planifiée, lesquelles n'ont pas été sauvegardées depuis 7 jours." },
  { icon: I.storage, t: "Stockage anticipé", d: "Estimation du nombre de jours avant qu'un stockage soit plein, d'après la tendance de la semaine." },
  { icon: I.key, t: "Accès maîtrisé", d: "Connexion avec ton compte Proxmox (2FA comprise), accès limité à des plages IP, aucun jeton dans le navigateur." },
];

const HIDDEN = [
  "L'adresse IP de toutes les machines dans un seul tableau, avec export CSV et détection des IP en double",
  "Les machines réglées pour démarrer avec le serveur mais arrêtées",
  "La santé SMART et l'usure des SSD, avec les attributs détaillés",
  "Le ratio vCPU / threads et RAM allouée / RAM physique",
  "Les échecs de connexion lus dans le journal de pvedaemon, regroupés par adresse IP",
  "Les snapshots oubliés depuis plus de 30 jours",
  "Les mises à jour de sécurité en attente",
];

function Site() {
  return (
    <div className="site">
      <nav className="s-nav">
        <div className="s-wrap">
          <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
          <div className="links">
            <a className="btn btn-sm btn-dark hide-m" style={{ borderColor: "#444" }} href="#mcp">MCP</a>
            <a className="btn btn-sm btn-dark hide-m" style={{ borderColor: "#444" }} href="#installer">Installer</a>
            <a className="btn btn-sm btn-dark" style={{ borderColor: "#444" }} href={REPO_URL}><I.github /> GitHub</a>
          </div>
        </div>
      </nav>

      <header className="s-hero">
        <div className="s-wrap">
          <h1>Ton serveur Proxmox, <span>en clair</span>.</h1>
          <p>MyProxmox est une interface web open source pour Proxmox VE. Elle affiche ce que l&apos;interface officielle cache dans ses menus, prévient quand quelque chose casse et laisse Claude t&apos;aider à gérer ton homelab.</p>
          <div className="cta">
            <a className="btn btn-primary btn-lg" href="/demo/">Essayer la démo</a>
            <a className="btn btn-lg" href={REPO_URL}><I.github /> Code source</a>
          </div>
          <img className="s-shot" src={overview} alt="Vue d'ensemble de MyProxmox" />
        </div>
      </header>

      <section className="s-section">
        <div className="s-wrap">
          <h2>Ce que tu y trouves</h2>
          <p className="lead">Une interface sobre aux couleurs de Proxmox. Les actions sensibles demandent une confirmation, et les réglages risqués (réseau, disques) restent dans l&apos;interface officielle.</p>
          <div className="s-grid">
            {FEATURES.map((f) => (
              <div key={f.t}><span className="ic"><f.icon /></span><h3>{f.t}</h3><p>{f.d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="s-section alt">
        <div className="s-wrap s-two">
          <div>
            <h2>Ce que l&apos;interface native ne montre pas</h2>
            <p className="lead">Ces informations existent dans l&apos;API Proxmox, mais elles sont éparpillées ou demandent une commande dans le shell. MyProxmox les rassemble.</p>
            <ul className="s-list">{HIDDEN.map((h) => <li key={h}>{h}</li>)}</ul>
          </div>
          <img src={reseau} alt="Inventaire réseau" />
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <h2>Un écran qui ne fait que surveiller</h2>
          <p className="lead">Ouvre le lien de monitoring sur une TV ou un second écran : il se rafraîchit toutes les 5 secondes, empêche l&apos;écran de se mettre en veille et passe au rouge quand une alerte critique arrive. Sans compte et sans bouton d&apos;action.</p>
          <img src={monitoring} alt="Écran de monitoring" style={{ width: "100%", border: "1px solid var(--line)" }} />
        </div>
      </section>

      <section className="s-section alt" id="mcp">
        <div className="s-wrap s-two">
          <div>
            <h2>Claude, branché sur ton serveur</h2>
            <p className="lead">MyProxmox embarque un serveur MCP. Claude Desktop, Claude Code ou tout client MCP peut consulter l&apos;état du serveur et, si tu l&apos;autorises, démarrer une machine ou prendre un snapshot.</p>
            <ul className="s-list">
              <li>« Quelles machines n&apos;ont pas été sauvegardées cette semaine ? »</li>
              <li>« Est-ce qu&apos;un de mes disques montre des signes de faiblesse ? »</li>
              <li>« Prends un snapshot de home-assistant avant la mise à jour. »</li>
            </ul>
            <p className="small muted" style={{ marginTop: 20 }}>Chaque clé est en lecture seule ou « actions ». Supprimer, forcer un arrêt ou restaurer reste impossible via MCP, et tout est journalisé.</p>
          </div>
          <img src={claude} alt="Page Claude et MCP" />
        </div>
      </section>

      <section className="s-section">
        <div className="s-wrap">
          <h2>Quelques écrans</h2>
          <p className="lead">Toutes les captures viennent de la démo, avec de fausses données.</p>
          <div className="s-gallery">
            <figure><img src={machines} alt="" /><figcaption>Machines : IP, tags, dernière sauvegarde, actions groupées</figcaption></figure>
            <figure><img src={securite} alt="" /><figcaption>Audit de sécurité</figcaption></figure>
            <figure><img src={disques} alt="" /><figcaption>Disques : SMART, usure des SSD, ZFS</figcaption></figure>
            <figure><img src={sauvegardes} alt="" /><figcaption>Couverture des sauvegardes</figcaption></figure>
          </div>
        </div>
      </section>

      <section className="s-section alt" id="installer">
        <div className="s-wrap">
          <h2>Installer en 3 étapes</h2>
          <p className="lead">MyProxmox tourne sur un PC de ton réseau (Windows, Linux ou macOS) ou dans un conteneur. Il faut Node.js 20 ou plus récent.</p>
          <div className="s-steps">
            <div><div className="n">1</div><h3 style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink)", fontSize: 15 }}>Récupère le code</h3><p className="small"><code>git clone {REPO_URL}.git</code><br />ou télécharge le zip depuis GitHub.</p></div>
            <div><div className="n">2</div><h3 style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink)", fontSize: 15 }}>Lance-le</h3><p className="small">Windows : double-clic sur <code>MyProxmox.bat</code>. Linux/macOS : <code>./start.sh</code>. Docker : <code>docker compose up -d</code>.</p></div>
            <div><div className="n">3</div><h3 style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink)", fontSize: 15 }}>Suis l&apos;assistant</h3><p className="small">Ouvre <code>http://ip-du-pc:8080</code>, donne l&apos;adresse de Proxmox et un compte administrateur. C&apos;est tout.</p></div>
          </div>
        </div>
      </section>

      <footer className="s-foot">
        <div className="s-wrap row" style={{ justifyContent: "space-between" }}>
          <span>MyProxmox, sous licence MIT. Projet indépendant, sans lien avec Proxmox Server Solutions GmbH.</span>
          <a href={REPO_URL}>github.com/ethanfrq/MyProxmox</a>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("site")!).render(<StrictMode><Site /></StrictMode>);

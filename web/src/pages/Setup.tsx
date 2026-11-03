// Assistant de première configuration.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field, Notice } from "../components/ui";
import { api } from "../lib/api";

const STEPS = ["Bienvenue", "Serveur Proxmox", "Compte administrateur", "Accès réseau"];

export function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("https://10.0.1.101:8006");
  const [insecureTls, setInsecure] = useState(true);
  const [realms, setRealms] = useState<any[]>([]);
  const [username, setUsername] = useState("root@pam");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [clientIp, setClientIp] = useState("");
  const [ranges, setRanges] = useState("127.0.0.1/32\n10.0.1.0/24");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/status").then((s) => {
      if (s.setupDone) navigate("/login", { replace: true });
      setUrl(s.defaultUrl);
      setClientIp(s.clientIp);
      // Propose le /24 de la personne qui configure
      const m = String(s.clientIp).match(/^(\d+\.\d+\.\d+)\.\d+$/);
      if (m && s.clientIp !== "127.0.0.1") setRanges(`127.0.0.1/32\n${m[1]}.0/24`);
    }).catch(() => {});
  }, [navigate]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const test = () => run(async () => {
    const r = await api("/api/setup/test", { method: "POST", body: { url, insecureTls } });
    setUrl(r.url);
    setRealms(r.realms);
    setStep(2);
  });

  const finish = () => run(async () => {
    const r = await api("/api/setup/finish", {
      method: "POST",
      body: { url, insecureTls, username, password, otp: needOtp ? otp : undefined, allowedRanges: ranges.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) },
    });
    if (r.needOtp) {
      setNeedOtp(true);
      setStep(2);
      return;
    }
    setPassword("");
    navigate("/", { replace: true });
  });

  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
        <ol className="steps">
          {STEPS.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "cur" : ""}>{s}</li>)}
        </ol>
        <div className="pitch">
          Le mot de passe sert une seule fois : MyProxmox crée un compte de service <code style={{ color: "#fff" }}>myproxmox@pve</code> avec des droits limités, puis ne le garde pas.
        </div>
      </aside>
      <div className="auth-main">
        <div className="auth-card">
          {step === 0 && (
            <>
              <h1>Bienvenue sur MyProxmox</h1>
              <p className="lead">On relie l&apos;app à ton serveur en trois étapes.</p>
              <div className="stack">
                <Notice>Il te faut l&apos;adresse de ton Proxmox (celle que tu tapes pour ouvrir son interface web) et un compte administrateur, idéalement <code>root@pam</code>.</Notice>
                <div className="kv">
                  <div>Ton adresse IP</div><div className="mono">{clientIp || "…"}</div>
                  <div>Ce qui sera créé</div><div>Un rôle <code>MyProxmoxService</code>, un utilisateur <code>myproxmox@pve</code> et son jeton API</div>
                  <div>Ce qu&apos;il pourra faire</div><div>Tout lire, démarrer et éteindre, snapshots et sauvegardes. Il ne pourra rien supprimer ni modifier la configuration.</div>
                </div>
              </div>
              <div className="auth-foot"><span /><Button variant="primary" size="lg" onClick={() => setStep(1)}>Commencer</Button></div>
            </>
          )}

          {step === 1 && (
            <>
              <h1>Ton serveur Proxmox</h1>
              <p className="lead">L&apos;adresse de l&apos;interface web, port 8006 en général.</p>
              <div className="stack">
                <Field label="Adresse" help="Le port 8006 est ajouté s'il manque.">
                  <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && test()} />
                </Field>
                <label className="check"><input type="checkbox" checked={insecureTls} onChange={(e) => setInsecure(e.target.checked)} /> Accepter le certificat auto-signé de Proxmox</label>
                <Notice>Proxmox s&apos;installe avec son propre certificat, que les navigateurs signalent comme « non sûr ». Sur un réseau local, garde la case cochée.</Notice>
                {error && <Notice kind="error">Échec : {error}</Notice>}
              </div>
              <div className="auth-foot">
                <Button onClick={() => setStep(0)}>Retour</Button>
                <Button variant="primary" size="lg" busy={busy} onClick={test}>Tester la connexion</Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Compte administrateur</h1>
              <p className="lead">Connexion réussie. Entre un compte qui peut gérer les permissions.</p>
              <div className="stack">
                {!needOtp ? (
                  <div className="form-grid">
                    <Field label="Utilisateur" help={realms.length ? `Domaines : ${realms.map((r) => r.realm).join(", ")}` : undefined}>
                      <input className="input mono" value={username} onChange={(e) => setUsername(e.target.value)} />
                    </Field>
                    <Field label="Mot de passe"><input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                  </div>
                ) : (
                  <Field label="Code de double authentification"><input className="input mono" autoFocus inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value.trim())} /></Field>
                )}
                {error && <Notice kind="error">{error}</Notice>}
              </div>
              <div className="auth-foot">
                <Button onClick={() => { setNeedOtp(false); setStep(1); }}>Retour</Button>
                <Button variant="primary" size="lg" disabled={!password} onClick={() => setStep(3)}>Continuer</Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1>Qui peut ouvrir MyProxmox ?</h1>
              <p className="lead">Seules ces plages d&apos;adresses IP auront accès à l&apos;app, au MCP et à l&apos;écran de monitoring.</p>
              <div className="stack">
                <Field label="Plages autorisées (une par ligne, format CIDR)" help={<>Exemples : <code>10.0.1.0/24</code> pour tout le réseau 10.0.1.x, <code>10.0.1.42/32</code> pour un seul PC. Ce PC ({clientIp}) garde toujours l&apos;accès en local.</>}>
                  <textarea className="input mono" rows={5} value={ranges} onChange={(e) => setRanges(e.target.value)} />
                </Field>
                {error && <Notice kind="error">{error}</Notice>}
              </div>
              <div className="auth-foot">
                <Button onClick={() => setStep(2)}>Retour</Button>
                <Button variant="primary" size="lg" busy={busy} onClick={finish}>Terminer</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Inscription libre à un compte MyProxmox (rôle monitoring), si un administrateur l'a ouverte.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Field, Notice } from "../components/ui";
import { api } from "../lib/api";
import type { RegistrationMode } from "../../../shared/types";

export function Register() {
  const [mode, setMode] = useState<RegistrationMode | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"active" | "pending" | null>(null);

  useEffect(() => {
    api("/api/status").then((s) => setMode(s.registration ?? "off")).catch(() => setMode("off"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) return setError("Les deux mots de passe ne sont pas identiques.");
    setBusy(true);
    try {
      const r = await api("/api/auth/local/register", { method: "POST", body: { username, displayName, password } });
      setDone(r.status);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
        <div className="pitch">Ce compte donne accès à l&apos;écran de monitoring, en lecture seule. Il n&apos;existe que dans MyProxmox : il ne crée rien dans Proxmox.</div>
      </aside>
      <div className="auth-main">
        <form className="auth-card" onSubmit={submit} style={{ maxWidth: 440 }}>
          <h1>Créer un compte</h1>
          {mode === "off" && (
            <div className="stack">
              <Notice kind="warn">L&apos;inscription est fermée. Demande un compte à un administrateur de MyProxmox.</Notice>
              <Link to="/login" className="btn">Retour à la connexion</Link>
            </div>
          )}
          {done && (
            <div className="stack">
              <Notice kind="ok">
                {done === "pending"
                  ? "Demande envoyée. Un administrateur doit la valider avant que tu puisses te connecter."
                  : "Compte créé. Tu peux te connecter dès maintenant."}
              </Notice>
              <Link to="/login?compte=local" className="btn btn-primary">Aller à la connexion</Link>
            </div>
          )}
          {mode && mode !== "off" && !done && (
            <>
              <p className="lead">{mode === "approval" ? "Un administrateur validera ta demande." : "Ton compte sera actif tout de suite."}</p>
              <div className="stack">
                <Field label="Identifiant" help="Minuscules, chiffres, point ou tiret. Exemple : tv-salon">
                  <input className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
                </Field>
                <Field label="Nom affiché" help="Facultatif. Exemple : TV du salon">
                  <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </Field>
                <Field label="Mot de passe" help="Au moins 10 caractères. Trois ou quatre mots sans lien, c'est solide et facile à retenir.">
                  <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Field label="Confirme le mot de passe">
                  <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
                {error && <Notice kind="error">{error}</Notice>}
                <Button variant="primary" size="lg" block busy={busy} type="submit" disabled={!username || !password}>Créer le compte</Button>
                <Link to="/login?compte=local" className="small muted" style={{ textAlign: "center" }}>J&apos;ai déjà un compte</Link>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

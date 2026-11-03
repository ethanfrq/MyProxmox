import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Notice } from "../components/ui";
import { api } from "../lib/api";
import { DEMO } from "../lib/env";

export function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [realms, setRealms] = useState<{ realm: string; comment?: string; default?: number }[]>([]);
  const [server, setServer] = useState("");
  const [username, setUsername] = useState(DEMO ? "demo" : "root");
  const [realm, setRealm] = useState("pam");
  const [password, setPassword] = useState(DEMO ? "demo" : "");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/status").then((s) => { if (!s.setupDone) navigate("/setup", { replace: true }); setServer(s.demo ? "démo" : ""); }).catch(() => {});
    api("/api/realms").then((r) => {
      setRealms(r);
      if (r.some((x: any) => x.realm === "pam")) setRealm("pam");
    }).catch(() => {});
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { username, realm, password, otp: needOtp ? otp : undefined } });
      if (r.needOtp) {
        setNeedOtp(true);
        setBusy(false);
        return;
      }
      navigate(params.get("next") || "/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
        <div className="pitch">
          Connecte-toi avec ton compte Proxmox. Tu retrouves les mêmes droits que dans l&apos;interface officielle.
          {server && <div style={{ marginTop: 8 }}>Serveur : <strong style={{ color: "#fff" }}>{server}</strong></div>}
        </div>
      </aside>
      <div className="auth-main">
        <form className="auth-card" onSubmit={submit} style={{ maxWidth: 420 }}>
          <h1>Connexion</h1>
          <p className="lead">{needOtp ? "Ce compte utilise la double authentification." : "Mêmes identifiants que sur Proxmox."}</p>
          <div className="stack">
            {!needOtp ? (
              <>
                <div className="form-grid">
                  <Field label="Utilisateur"><input className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
                  <Field label="Domaine">
                    <select className="select input" value={realm} onChange={(e) => setRealm(e.target.value)}>
                      {(realms.length ? realms : [{ realm: "pam" }, { realm: "pve" }]).map((r) => (
                        <option key={r.realm} value={r.realm}>{r.realm === "pam" ? "Linux PAM (root…)" : r.realm === "pve" ? "Proxmox VE" : r.comment || r.realm}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Mot de passe"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              </>
            ) : (
              <Field label="Code à 6 chiffres" help="Celui de ton application d'authentification. Tu peux aussi coller un code de récupération.">
                <input className="input mono" inputMode="numeric" autoComplete="one-time-code" autoFocus value={otp} onChange={(e) => setOtp(e.target.value.trim())} style={{ fontSize: 20, letterSpacing: 4 }} />
              </Field>
            )}
            {error && <Notice kind="error">{error}</Notice>}
            <Button variant="primary" size="lg" block busy={busy} type="submit">{needOtp ? "Valider" : "Se connecter"}</Button>
            {needOtp && <Button type="button" variant="ghost" onClick={() => { setNeedOtp(false); setOtp(""); }}>Retour</Button>}
            {DEMO && <Notice>Démo : n&apos;importe quel identifiant fonctionne.</Notice>}
          </div>
        </form>
      </div>
    </div>
  );
}

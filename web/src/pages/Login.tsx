import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Notice, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { DEMO } from "../lib/env";
import { resetPermissions } from "../lib/permissions";
import type { RegistrationMode } from "../../../shared/types";

type Kind = "proxmox" | "local";

export function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [kind, setKind] = useState<Kind>(params.get("compte") === "local" ? "local" : "proxmox");
  const [realms, setRealms] = useState<{ realm: string; comment?: string; default?: number }[]>([]);
  const [server, setServer] = useState("");
  const [registration, setRegistration] = useState<RegistrationMode>("off");
  const [username, setUsername] = useState(DEMO ? "demo" : "root");
  const [localUser, setLocalUser] = useState(DEMO ? "tv-salon" : "");
  const [realm, setRealm] = useState("pam");
  const [password, setPassword] = useState(DEMO ? "demo" : "");
  const [localPassword, setLocalPassword] = useState(DEMO ? "demo-monitoring" : "");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/status").then((s) => {
      if (!s.setupDone) navigate("/setup", { replace: true });
      setServer(s.demo ? "démo" : "");
      setRegistration(s.registration ?? "off");
    }).catch(() => {});
    api("/api/realms").then((r) => {
      setRealms(r);
      if (r.some((x: any) => x.realm === "pam")) setRealm("pam");
    }).catch(() => {});
  }, [navigate]);

  const switchKind = (k: Kind) => {
    setKind(k);
    setNeedOtp(false);
    setOtp("");
    setError("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = kind === "proxmox"
        ? await api("/api/auth/login", { method: "POST", body: { username, realm, password, otp: needOtp ? otp : undefined } })
        : await api("/api/auth/local/login", { method: "POST", body: { username: localUser, password: localPassword, otp: needOtp ? otp : undefined } });
      if (r.needOtp) {
        setNeedOtp(true);
        setBusy(false);
        return;
      }
      resetPermissions();
      if (kind === "local" && r.role === "monitoring") return navigate("/monitoring", { replace: true });
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
          {kind === "proxmox"
            ? <>Connecte-toi avec ton compte Proxmox. Tu retrouves les mêmes droits que dans l&apos;interface officielle.</>
            : <>Un compte MyProxmox est créé dans MyProxmox, pas dans Proxmox. Il sert à regarder sans toucher : l&apos;écran de monitoring, ou toutes les pages en lecture seule.</>}
          {server && <div style={{ marginTop: 8 }}>Serveur : <strong style={{ color: "var(--panel)" }}>{server}</strong></div>}
        </div>
      </aside>
      <div className="auth-main">
        <form className="auth-card" onSubmit={submit} style={{ maxWidth: 420 }}>
          <h1>Connexion</h1>
          <Tabs<Kind> value={kind} onChange={switchKind} tabs={[{ id: "proxmox", label: "Compte Proxmox" }, { id: "local", label: "Compte MyProxmox" }]} />
          <p className="lead">
            {needOtp ? "Ce compte utilise la double authentification." : kind === "proxmox" ? "Mêmes identifiants que sur Proxmox." : "Identifiant et mot de passe de ton compte MyProxmox."}
          </p>
          <div className="stack">
            {needOtp ? (
              <Field label="Code à 6 chiffres" help={kind === "proxmox" ? "Celui de ton application d'authentification. Tu peux aussi coller un code de récupération." : "Celui de ton application d'authentification."}>
                <input className="input mono" inputMode="numeric" autoComplete="one-time-code" autoFocus value={otp} onChange={(e) => setOtp(e.target.value.trim())} style={{ fontSize: 20, letterSpacing: 4 }} />
              </Field>
            ) : kind === "proxmox" ? (
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
              <>
                <Field label="Identifiant"><input className="input" autoComplete="username" autoFocus value={localUser} onChange={(e) => setLocalUser(e.target.value)} /></Field>
                <Field label="Mot de passe"><input className="input" type="password" autoComplete="current-password" value={localPassword} onChange={(e) => setLocalPassword(e.target.value)} /></Field>
              </>
            )}
            {error && <Notice kind="error">{error}</Notice>}
            <Button variant="primary" size="lg" block busy={busy} type="submit">{needOtp ? "Valider" : "Se connecter"}</Button>
            {needOtp && <Button type="button" variant="ghost" onClick={() => { setNeedOtp(false); setOtp(""); }}>Retour</Button>}
            {kind === "local" && registration !== "off" && !needOtp && (
              <div className="small" style={{ textAlign: "center" }}>
                Pas encore de compte ? <Link to="/inscription" style={{ color: "var(--orange)", fontWeight: 600 }}>Créer un compte</Link>
                {registration === "approval" && <div className="muted">Un administrateur devra le valider.</div>}
              </div>
            )}
            {DEMO && <Notice>{kind === "proxmox" ? "Démo : n'importe quel identifiant fonctionne." : "Démo : « tv-salon » (monitoring) ou « lea » (lecture), mot de passe « demo-monitoring »."}</Notice>}
          </div>
        </form>
      </div>
    </div>
  );
}

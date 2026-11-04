// « Mon compte » pour les comptes MyProxmox : mot de passe et double authentification.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Notice, SecretBox, useToast } from "../components/ui";
import { api } from "../lib/api";
import { LOCAL_ROLES, type Me } from "../../../shared/types";

export function Account() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => api<Me>("/api/auth/me").then(setMe).catch(() => navigate("/login?compte=local&next=/compte", { replace: true }));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!me) return <div className="empty" style={{ paddingTop: 120 }}>Chargement…</div>;
  const back = me.role === "monitoring" ? "/monitoring" : "/";
  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <div className="brand"><span className="brand-mark">P</span>MyProxmox</div>
        <div className="pitch">
          {me.kind === "local" ? <>Compte MyProxmox <strong style={{ color: "var(--panel)" }}>{me.username}</strong>, rôle {LOCAL_ROLES[me.role!].label.toLowerCase()} : {LOCAL_ROLES[me.role!].desc.toLowerCase()}</> : "Compte Proxmox : sa double authentification se règle dans Proxmox."}
        </div>
      </aside>
      <div className="auth-main">
        <div className="auth-card" style={{ maxWidth: 480 }}>
          <h1>Mon compte</h1>
          <p className="lead">{me.displayName ?? me.username}</p>
          {me.kind !== "local" ? (
            <Notice>Ton compte Proxmox se gère dans Proxmox (Datacenter, Permissions, Double authentification).</Notice>
          ) : (
            <div className="stack">
              <h3>Double authentification</h3>
              {me.totp ? (
                <>
                  <Notice kind="ok">Active : un code de ton application est demandé à chaque connexion.</Notice>
                  <Field label="Code actuel, pour la désactiver"><input className="input mono" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.trim())} /></Field>
                  <Button variant="danger" busy={busy === "off"} disabled={code.length !== 6} onClick={() => run("off", async () => {
                    await api("/api/auth/local/totp/disable", { method: "POST", body: { code } });
                    setCode("");
                    toast("Double authentification désactivée", "ok");
                    await load();
                  })}>Désactiver</Button>
                </>
              ) : setup ? (
                <>
                  <p>Dans ton application (Aegis, 2FAS, Google Authenticator, Bitwarden...), ajoute un compte avec cette clé, puis entre le code affiché.</p>
                  <Field label="Clé à saisir dans l'application"><SecretBox value={setup.secret} /></Field>
                  <Field label="Ou ce lien, si ton application l'accepte"><SecretBox value={setup.uri} /></Field>
                  <Field label="Code à 6 chiffres"><input className="input mono" inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value.trim())} /></Field>
                  <Button variant="primary" busy={busy === "on"} disabled={code.length !== 6} onClick={() => run("on", async () => {
                    await api("/api/auth/local/totp/enable", { method: "POST", body: { code } });
                    setSetup(null);
                    setCode("");
                    toast("Double authentification activée", "ok");
                    await load();
                  })}>Activer</Button>
                </>
              ) : (
                <>
                  <p className="muted">Ajoute un code à 6 chiffres, donné par ton téléphone, en plus du mot de passe.</p>
                  <Button busy={busy === "setup"} onClick={() => run("setup", async () => setSetup(await api("/api/auth/local/totp/setup", { method: "POST" })))}>Configurer la double authentification</Button>
                </>
              )}

              <h3 style={{ marginTop: 12 }}>Mot de passe</h3>
              <Field label="Mot de passe actuel"><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
              <Field label="Nouveau mot de passe" help="Au moins 10 caractères."><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
              <Button busy={busy === "pw"} disabled={!current || !pw} onClick={() => run("pw", async () => {
                await api("/api/auth/local/password", { method: "POST", body: { current, password: pw } });
                setCurrent("");
                setPw("");
                toast("Mot de passe changé", "ok");
              })}>Changer le mot de passe</Button>
              {error && <Notice kind="error">{error}</Notice>}
            </div>
          )}
          <div className="auth-foot"><Link to={back} className="btn">Retour</Link></div>
        </div>
      </div>
    </div>
  );
}

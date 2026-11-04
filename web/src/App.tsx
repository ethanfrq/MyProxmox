import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { AppProvider, browserNotify } from "./lib/app";
import { BASENAME } from "./lib/env";
import { Shell, useLiveToasts } from "./components/Shell";
import { ToastProvider } from "./components/ui";
import type { Me } from "../../shared/types";
import { Login } from "./pages/Login";
import { Setup } from "./pages/Setup";
import { Overview } from "./pages/Overview";
import { Machines } from "./pages/Machines";
import { MachineDetail } from "./pages/MachineDetail";
import { Create } from "./pages/Create";
import { Server } from "./pages/Server";
import { Storage } from "./pages/Storage";
import { Network } from "./pages/Network";
import { Backups } from "./pages/Backups";
import { Tasks } from "./pages/Tasks";
import { Alerts } from "./pages/Alerts";
import { Security } from "./pages/Security";
import { ClaudeMcp } from "./pages/ClaudeMcp";
import { Settings } from "./pages/Settings";
import { Monitoring } from "./pages/Monitoring";
import { Register } from "./pages/Register";
import { Account } from "./pages/Account";
import { LocalAccounts } from "./pages/LocalAccounts";

function Protected() {
  const [me, setMe] = useState<Me | null>(null);
  const navigate = useNavigate();
  const loc = useLocation();
  const live = useLiveToasts();

  useEffect(() => {
    (async () => {
      const st = await api("/api/status");
      if (!st.setupDone) return navigate("/setup", { replace: true });
      try {
        const m = await api<Me>("/api/auth/me");
        // Un compte monitoring ne voit que l'écran de monitoring
        if (m.kind === "local" && m.role === "monitoring") return navigate("/monitoring", { replace: true });
        setMe(m);
      } catch {
        navigate(`/login?next=${encodeURIComponent(loc.pathname)}`, { replace: true });
      }
    })().catch(() => navigate("/login", { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return <div className="empty" style={{ paddingTop: 120 }}>Chargement…</div>;
  return (
    <AppProvider me={me} onNotification={(n) => { live(n); browserNotify(n); }}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="machines" element={<Machines />} />
          <Route path="machines/:node/:type/:vmid" element={<MachineDetail />} />
          <Route path="creer" element={<Create />} />
          <Route path="serveur" element={<Server />} />
          <Route path="stockage" element={<Storage />} />
          <Route path="reseau" element={<Network />} />
          <Route path="sauvegardes" element={<Backups />} />
          <Route path="taches" element={<Tasks />} />
          <Route path="alertes" element={<Alerts />} />
          <Route path="securite" element={<Security />} />
          <Route path="claude" element={<ClaudeMcp />} />
          <Route path="parametres" element={<Settings />} />
          <Route path="parametres/comptes" element={<LocalAccounts />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

export function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <Wrap>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/inscription" element={<Register />} />
          <Route path="/compte" element={<Account />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/*" element={<Protected />} />
        </Routes>
      </Wrap>
    </BrowserRouter>
  );
}

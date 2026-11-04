import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { AppProvider, browserNotify } from "./lib/app";
import { BASENAME } from "./lib/env";
import { Shell, useLiveToasts } from "./components/Shell";
import { ToastProvider } from "./components/ui";
import type { Me } from "../../shared/types";
import { Login } from "./pages/Login";

// Chaque page est chargée à la demande : le premier écran reste léger.
const Setup = lazy(() => import("./pages/Setup").then((m) => ({ default: m.Setup })));
const Overview = lazy(() => import("./pages/Overview").then((m) => ({ default: m.Overview })));
const Machines = lazy(() => import("./pages/Machines").then((m) => ({ default: m.Machines })));
const MachineDetail = lazy(() => import("./pages/MachineDetail").then((m) => ({ default: m.MachineDetail })));
const Create = lazy(() => import("./pages/Create").then((m) => ({ default: m.Create })));
const Server = lazy(() => import("./pages/Server").then((m) => ({ default: m.Server })));
const Storage = lazy(() => import("./pages/Storage").then((m) => ({ default: m.Storage })));
const Network = lazy(() => import("./pages/Network").then((m) => ({ default: m.Network })));
const Backups = lazy(() => import("./pages/Backups").then((m) => ({ default: m.Backups })));
const Tasks = lazy(() => import("./pages/Tasks").then((m) => ({ default: m.Tasks })));
const Alerts = lazy(() => import("./pages/Alerts").then((m) => ({ default: m.Alerts })));
const Security = lazy(() => import("./pages/Security").then((m) => ({ default: m.Security })));
const ClaudeMcp = lazy(() => import("./pages/ClaudeMcp").then((m) => ({ default: m.ClaudeMcp })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Monitoring = lazy(() => import("./pages/Monitoring").then((m) => ({ default: m.Monitoring })));
const Register = lazy(() => import("./pages/Register").then((m) => ({ default: m.Register })));
const Account = lazy(() => import("./pages/Account").then((m) => ({ default: m.Account })));
const LocalAccounts = lazy(() => import("./pages/LocalAccounts").then((m) => ({ default: m.LocalAccounts })));
const Datacenter = lazy(() => import("./pages/Datacenter").then((m) => ({ default: m.Datacenter })));

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
          <Route path="datacenter" element={<Navigate to="/datacenter/resume" replace />} />
          <Route path="datacenter/:section" element={<Datacenter />} />
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
        <Suspense fallback={<div className="empty" style={{ paddingTop: 120 }}>Chargement…</div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/inscription" element={<Register />} />
          <Route path="/compte" element={<Account />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/*" element={<Protected />} />
        </Routes>
        </Suspense>
      </Wrap>
    </BrowserRouter>
  );
}

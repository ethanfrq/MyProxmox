// Page Datacenter : la configuration commune à tout le cluster, section par section
// (composants dans web/src/pages/dc/).
import { NavLink, Navigate, useParams } from "react-router-dom";
import { PageHead } from "../components/ui";
import { AcmeAccounts, AcmePlugins } from "../components/Acme";
import { DcSummary } from "./dc/Summary";
import { DcOptions } from "./dc/Options";
import { DcFirewall } from "./dc/Firewall";
import { DcMappings } from "./dc/Mappings";
import { DcMetrics } from "./dc/Metrics";
import { DcNotifications } from "./dc/Notifications";
import { DcStorage } from "./dc/Storage";
import { DcBackups } from "./dc/Backups";
import { DcReplication } from "./dc/Replication";
import { DcPermissions } from "./dc/Permissions";
import { DcHa } from "./dc/Ha";
import { DcSdn } from "./dc/Sdn";

const SECTIONS: { id: string; label: string; group: string }[] = [
  { id: "resume", label: "Résumé et cluster", group: "Cluster" },
  { id: "options", label: "Options", group: "Cluster" },
  { id: "stockage", label: "Stockage", group: "Ressources" },
  { id: "sauvegardes", label: "Sauvegardes", group: "Ressources" },
  { id: "replication", label: "Réplication", group: "Ressources" },
  { id: "permissions", label: "Permissions", group: "Accès" },
  { id: "ha", label: "Haute disponibilité", group: "Services" },
  { id: "sdn", label: "Réseau logiciel (SDN)", group: "Services" },
  { id: "acme", label: "ACME", group: "Services" },
  { id: "parefeu", label: "Pare-feu", group: "Services" },
  { id: "metriques", label: "Serveurs de métriques", group: "Services" },
  { id: "notifications", label: "Notifications", group: "Services" },
  { id: "mappings", label: "Mappings de ressources", group: "Services" },
];

export function Datacenter() {
  const { section = "resume" } = useParams();
  const cur = SECTIONS.find((s) => s.id === section);
  if (!cur) return <Navigate to="/datacenter/resume" replace />;
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  return (
    <>
      <PageHead title="Datacenter" sub={cur.label} />
      <div className="dc-layout">
        <nav className="dc-nav" aria-label="Sections du datacenter">
          {groups.map((g) => (
            <div key={g}>
              <div className="dc-nav-group">{g}</div>
              {SECTIONS.filter((s) => s.group === g).map((s) => <NavLink key={s.id} to={`/datacenter/${s.id}`} className={({ isActive }) => (isActive ? "active" : "")}>{s.label}</NavLink>)}
            </div>
          ))}
        </nav>
        <div className="dc-main">
          {section === "resume" && <DcSummary />}
          {section === "options" && <DcOptions />}
          {section === "stockage" && <DcStorage />}
          {section === "sauvegardes" && <DcBackups />}
          {section === "replication" && <DcReplication />}
          {section === "permissions" && <DcPermissions />}
          {section === "ha" && <DcHa />}
          {section === "sdn" && <DcSdn />}
          {section === "acme" && <div className="stack"><AcmeAccounts /><AcmePlugins /></div>}
          {section === "parefeu" && <DcFirewall />}
          {section === "metriques" && <DcMetrics />}
          {section === "notifications" && <DcNotifications />}
          {section === "mappings" && <DcMappings />}
        </div>
      </div>
    </>
  );
}

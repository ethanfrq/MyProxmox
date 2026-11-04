// Pare-feu du datacenter, avec les groupes de sécurité.
import { useState } from "react";
import { Button, Empty } from "../../components/ui";
import { FirewallPanel, FirewallRules } from "../../components/Firewall";
import { Crud } from "../../components/Crud";
import { pve } from "../../lib/api";
import { usePermission } from "../../lib/permissions";

function Groups() {
  const [cur, setCur] = useState("");
  const { allowed } = usePermission("/", "Sys.Modify");
  return (
    <div className="stack" style={{ padding: 16 }}>
      <Crud<any>
        title="Groupes de sécurité"
        help="Un groupe réunit des règles réutilisables : il s'insère dans les règles du datacenter, d'un nœud ou d'une machine (sens « Groupe de sécurité »)."
        list="/cluster/firewall/groups"
        rowKey={(g) => g.group}
        perm={["/", "Sys.Modify"]}
        createLabel="Créer un groupe"
        columns={[{ id: "group", header: "Groupe", cell: (g) => <strong className="mono">{g.group}</strong> }, { id: "comment", header: "Commentaire", cell: (g) => g.comment }]}
        fields={(editing) => [{ name: "group", label: "Nom", required: true, readOnly: editing }, { name: "comment", label: "Commentaire", full: true }]}
        create={(v) => pve.post("/cluster/firewall/groups", v)}
        update={(g, v) => pve.post("/cluster/firewall/groups", { group: g.group, rename: g.group, comment: v.comment ?? "" })}
        remove={(g) => pve.del(`/cluster/firewall/groups/${g.group}`)}
        removeText={() => <p>Le groupe doit être vide et ne plus être utilisé dans des règles.</p>}
        extraActions={(g) => <Button size="sm" variant={cur === g.group ? "dark" : "default"} onClick={() => setCur(g.group)}>Règles</Button>}
      />
      {cur ? (
        <div className="panel">
          <div className="panel-head"><h2>Règles du groupe {cur}</h2></div>
          <FirewallRules key={cur} fw="/cluster/firewall" scope="cluster" canEdit={allowed} rb={`/cluster/firewall/groups/${cur}`} />
        </div>
      ) : <Empty>Choisis un groupe pour voir ses règles.</Empty>}
    </div>
  );
}

export function DcFirewall() {
  return <FirewallPanel base="/cluster/firewall" scope="cluster" aclPath="/" priv="Sys.Modify" extraTabs={[{ id: "groupes", label: "Groupes de sécurité", render: () => <Groups /> }]} />;
}

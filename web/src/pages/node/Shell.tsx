// Shell du nœud (xterm.js via termproxy), chargé à la demande.
import { Notice } from "../../components/ui";
import { TermConsole } from "../../components/console/TermConsole";
import { usePermission } from "../../lib/permissions";
import { useApp } from "../../lib/app";

export default function NodeShell({ node, cmd }: { node: string; cmd?: "upgrade" }) {
  const { me } = useApp();
  const { allowed, loading } = usePermission(`/nodes/${node}`, "Sys.Console");
  if (me.kind === "local") return <Notice kind="warn">Le shell demande un compte Proxmox.</Notice>;
  if (!loading && !allowed) return <Notice kind="warn">Il te manque le droit Sys.Console sur ce nœud.</Notice>;
  // api: POST /nodes/{node}/termproxy
  return <TermConsole key={cmd ?? "shell"} proxy={`/nodes/${node}/termproxy`} cmd={cmd} target={{ node, type: "node" }} label={node} />;
}

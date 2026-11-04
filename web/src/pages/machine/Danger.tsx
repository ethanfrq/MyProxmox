// Onglet « Supprimer ».
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Confirm, Empty, Field, Notice, Panel, useToast } from "../../components/ui";
import { I } from "../../components/icons";
import { api, pve, usePoll } from "../../lib/api";
import { bytes, date } from "../../../../shared/format";

export function DeleteGuest({ base, node, vmid, name, running }: { base: string; node: string; vmid: string; name: string; running: boolean }) {
  const router = useNavigate();
  const { watch, toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Panel title="Supprimer la machine">
      <div className="stack">
        <p style={{ margin: 0 }}>Supprime <strong>{name}</strong> et tous ses disques. Les sauvegardes sont conservées.</p>
        {running && <Notice kind="warn">Éteins d&apos;abord la machine.</Notice>}
        <div><Button variant="danger" icon={<I.trash />} disabled={running} onClick={() => setOpen(true)}>Supprimer définitivement</Button></div>
      </div>
      {open && (
        <Confirm
          title={`Supprimer ${name} ?`}
          danger
          requireText={vmid}
          confirmLabel="Supprimer"
          onConfirm={async () => {
            try {
              const upid = await pve.del(base, { purge: 1, "destroy-unreferenced-disks": 1 });
              watch(node, upid, `Suppression de ${name}`);
              router("/machines");
            } catch (e) { toast((e as Error).message, "error"); }
          }}
          onClose={() => setOpen(false)}
        >
          <p>Cette action est irréversible.</p>
        </Confirm>
      )}
    </Panel>
  );
}


// Fenêtre qui affiche un « spec » (formulaire décrit dans specs.ts) et l'applique à la machine.
import { Modal, Notice, useToast } from "../../components/ui";
import { Form } from "../../components/Form";
import { pve } from "../../lib/api";
import type { GuestCtx } from "./common";
import type { Spec } from "./specs";

export function SpecDialog({ ctx, spec, onClose, onDone }: { ctx: GuestCtx; spec: Spec; onClose: () => void; onDone?: () => void }) {
  const { toast, watch } = useToast();
  return (
    <Modal title={spec.title} onClose={onClose} wide={spec.fields.length > 6}>
      <div className="stack">
        {spec.help && <Notice>{spec.help}</Notice>}
        {ctx.running && !spec.run && <p className="small muted" style={{ margin: 0 }}>La machine est allumée : ce qui ne peut pas changer à chaud s&apos;appliquera au prochain redémarrage.</p>}
        <Form
          fields={spec.fields}
          initial={spec.initial}
          submitLabel={spec.run ? "Lancer" : "Enregistrer"}
          onCancel={onClose}
          onSubmit={async (_clean, raw) => {
            const res = spec.run ? await spec.run(raw) : await pve.put(`${ctx.base}/config`, spec.params(raw));
            if (typeof res === "string" && res.startsWith("UPID")) watch(ctx.node, res, spec.title, () => { ctx.refresh(); onDone?.(); });
            else toast("Enregistré", "ok");
            ctx.refresh();
            onDone?.();
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}

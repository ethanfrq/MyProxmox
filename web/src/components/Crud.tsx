// Liste générique « créer, modifier, supprimer » pour les objets de configuration Proxmox
// (serveurs de métriques, cibles de notification, mappings, groupes HA, zones SDN...).
import { useState, type ReactNode } from "react";
import { Button, Confirm, Modal, Notice, Panel, useToast } from "./ui";
import { DataTable, type Column } from "./DataTable";
import { Form, type FieldDef, type Values } from "./Form";
import { pve, usePoll } from "../lib/api";
import { usePermission } from "../lib/permissions";

export interface CrudProps<T> {
  title: ReactNode;
  /** Chemin de la liste (GET), ex. /cluster/metrics/server */
  list: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** Transforme la réponse en lignes (par défaut : la réponse telle quelle). */
  map?: (data: any) => T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  /** Champs de création ; `editing` = true pour la modification (souvent identifiant figé). */
  fields: (editing: boolean, row?: T) => FieldDef[];
  /** Valeurs du formulaire pour une ligne (par défaut : la ligne). */
  initial?: (row: T) => Values;
  create?: (v: Values) => Promise<unknown>;
  update?: (row: T, v: Values) => Promise<unknown>;
  remove?: (row: T) => Promise<unknown>;
  /** Texte de la confirmation de suppression. */
  removeText?: (row: T) => ReactNode;
  /** Demande de retaper l'identifiant avant suppression. */
  removeRequireText?: boolean;
  canRemove?: (row: T) => boolean;
  canEdit?: (row: T) => boolean;
  /** Droit nécessaire pour modifier (chemin ACL, privilège). */
  perm: [string, string | string[]];
  empty?: ReactNode;
  help?: ReactNode;
  createLabel?: string;
  extraActions?: (row: T, refresh: () => void) => ReactNode;
  toolbar?: ReactNode;
  wide?: boolean;
  onChange?: () => void;
}

export function Crud<T>(p: CrudProps<T>) {
  const { toast } = useToast();
  const { allowed } = usePermission(p.perm[0], p.perm[1]);
  const data = usePoll(async () => (p.map ? p.map(await pve.get(p.list, p.query)) : ((await pve.get<T[]>(p.list, p.query)) ?? [])), 0, [p.list, JSON.stringify(p.query ?? {})]);
  const [edit, setEdit] = useState<{ row?: T } | null>(null);
  const [del, setDel] = useState<T | null>(null);
  const refresh = () => { data.refresh(); p.onChange?.(); };
  return (
    <Panel pad={false} title={p.title} right={p.create && <Button size="sm" variant="primary" disabled={!allowed} title={allowed ? undefined : `Il te manque le droit ${[p.perm[1]].flat().join(" ou ")}`} onClick={() => setEdit({})}>{p.createLabel ?? "Ajouter"}</Button>}>
      {p.help && <div style={{ padding: "12px 16px 0" }}>{typeof p.help === "string" ? <p className="small muted" style={{ margin: 0 }}>{p.help}</p> : p.help}</div>}
      <DataTable
        rows={data.data}
        loading={data.loading}
        error={data.error}
        rowKey={p.rowKey}
        columns={p.columns}
        filter={(data.data?.length ?? 0) > 8 ? "Filtrer" : false}
        toolbar={p.toolbar}
        empty={p.empty ?? "Rien pour l'instant."}
        actions={(row) => (
          <span className="btn-group">
            {p.extraActions?.(row, refresh)}
            {p.update && (p.canEdit?.(row) ?? true) && <Button size="sm" disabled={!allowed} onClick={() => setEdit({ row })}>Modifier</Button>}
            {p.remove && (p.canRemove?.(row) ?? true) && <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setDel(row)}>Supprimer</Button>}
          </span>
        )}
      />
      {edit && (
        <Modal title={edit.row ? `Modifier ${p.rowKey(edit.row)}` : p.createLabel ?? "Ajouter"} wide={p.wide} onClose={() => setEdit(null)}>
          <Form
            fields={p.fields(!!edit.row, edit.row)}
            initial={edit.row ? (p.initial ? p.initial(edit.row) : (edit.row as unknown as Values)) : undefined}
            onCancel={() => setEdit(null)}
            onSubmit={async (_c, v) => {
              if (edit.row) await p.update!(edit.row, v);
              else await p.create!(v);
              toast("Enregistré", "ok");
              setEdit(null);
              refresh();
            }}
          />
        </Modal>
      )}
      {del && (
        <Confirm title={`Supprimer ${p.rowKey(del)} ?`} danger requireText={p.removeRequireText ? p.rowKey(del) : undefined} confirmLabel="Supprimer" onConfirm={async () => {
          try { await p.remove!(del); toast("Supprimé", "ok"); refresh(); } catch (e) { toast(`${(e as Error).message}. Vérifie que rien ne l'utilise encore.`, "error"); }
        }} onClose={() => setDel(null)}>
          {p.removeText ? p.removeText(del) : <p>La suppression est définitive.</p>}
        </Confirm>
      )}
    </Panel>
  );
}

/** Corps PUT : valeurs non vides, et `delete` pour celles vidées. */
export function putBody(v: Values, before: Record<string, any>, keys: string[]) {
  const out: Record<string, unknown> = {};
  const del: string[] = [];
  for (const k of keys) {
    const x = v[k];
    const empty = x === undefined || x === "" || (Array.isArray(x) && !x.length);
    if (empty) { if (before[k] !== undefined && before[k] !== "") del.push(k); } else out[k] = typeof x === "boolean" ? (x ? 1 : 0) : Array.isArray(x) ? x.join(",") : x;
  }
  if (del.length) out.delete = del.join(",");
  return out;
}

export function postBody(v: Values, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const x = v[k];
    if (x === undefined || x === "" || (Array.isArray(x) && !x.length)) continue;
    out[k] = typeof x === "boolean" ? (x ? 1 : 0) : Array.isArray(x) ? x.join(",") : x;
  }
  return out;
}

export { Notice };

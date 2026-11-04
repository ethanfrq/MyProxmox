// Tableau générique : tri par colonne, filtre texte, sélection multiple, actions par ligne
// et groupées, pagination au-delà de 100 lignes, états vide et chargement.
// Garde le style de .table. À placer dans un <Panel pad={false}>.
import { clickable } from "./ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Valeur de tri. Sans elle, la colonne n'est pas triable. */
  sort?: (row: T) => string | number | undefined | null;
  /** Texte cherché par le filtre. Par défaut : la valeur de tri. */
  text?: (row: T) => string;
  className?: string;
  width?: number | string;
  /** Masque la colonne (utile pour les colonnes qui dépendent d'un module). */
  hidden?: boolean;
}

export interface DataTableProps<T> {
  rows: T[] | null | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: string | null;
  /** Message quand il n'y a aucune ligne du tout. */
  empty?: ReactNode;
  /** Affiche le champ de filtre (texte d'exemple en valeur). */
  filter?: string | false;
  /** Contenu ajouté à gauche de la barre d'outils (filtres maison, boutons). */
  toolbar?: ReactNode;
  /** Active les cases à cocher et la barre d'actions groupées. */
  bulk?: (selected: T[], clear: () => void) => ReactNode;
  /** Boutons à droite de chaque ligne. */
  actions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  initialSort?: { id: string; dir: "asc" | "desc" };
  pageSize?: number;
  /** Libellé d'une ligne pour l'accessibilité des cases à cocher. */
  rowLabel?: (row: T) => string;
  rowClassName?: (row: T) => string;
}

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

export function DataTable<T>({
  rows, columns, rowKey, loading, error, empty = "Rien à afficher.", filter = "Filtrer", toolbar, bulk, actions,
  onRowClick, initialSort, pageSize = 100, rowLabel, rowClassName,
}: DataTableProps<T>) {
  const cols = columns.filter((c) => !c.hidden);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [sel, setSel] = useState<Set<string | number>>(new Set());
  const [page, setPage] = useState(0);
  const all = rows ?? [];

  // Retire de la sélection les lignes qui ont disparu
  useEffect(() => {
    setSel((s) => {
      if (!s.size) return s;
      const keys = new Set(all.map(rowKey));
      const next = new Set([...s].filter((k) => keys.has(k)));
      return next.size === s.size ? s : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = all;
    if (s) {
      list = all.filter((r) => cols.some((c) => {
        const v = c.text ? c.text(r) : c.sort ? c.sort(r) : undefined;
        return v !== undefined && v !== null && String(v).toLowerCase().includes(s);
      }));
    }
    if (sort) {
      const col = cols.find((c) => c.id === sort.id);
      if (col?.sort) {
        const get = col.sort;
        list = [...list].sort((a, b) => {
          const va = get(a);
          const vb = get(b);
          if (va === vb) return 0;
          if (va === undefined || va === null || va === "") return 1;
          if (vb === undefined || vb === null || vb === "") return -1;
          const r = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
          return sort.dir === "asc" ? r : -r;
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, sort, columns]);

  useEffect(() => setPage(0), [q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const visible = filtered.length > pageSize ? filtered.slice(cur * pageSize, (cur + 1) * pageSize) : filtered;
  const selected = all.filter((r) => sel.has(rowKey(r)));
  const clear = () => setSel(new Set());
  const toggle = (k: string | number) => setSel((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const allChecked = filtered.length > 0 && filtered.every((r) => sel.has(rowKey(r)));

  const clickSort = (c: Column<T>) => {
    if (!c.sort) return;
    setSort((s) => (s?.id === c.id ? (s.dir === "asc" ? { id: c.id, dir: "desc" } : null) : { id: c.id, dir: "asc" }));
  };

  const showBar = filter !== false || toolbar;
  return (
    <div className="dt">
      {showBar && (
        <div className="dt-bar">
          {toolbar}
          {filter !== false && (
            <input className="input dt-filter" type="search" placeholder={filter} aria-label={filter} value={q} onChange={(e) => setQ(e.target.value)} />
          )}
        </div>
      )}
      {bulk && selected.length > 0 && (
        <div className="bulkbar">
          <strong>{selected.length} sélectionnée(s)</strong>
          {bulk(selected, clear)}
          <button className="btn btn-sm btn-ghost" style={{ color: "#fff", background: "transparent" }} onClick={clear}>Annuler</button>
        </div>
      )}
      {error && <div className="notice error dt-error">{error}</div>}
      {visible.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {bulk && (
                  <th style={{ width: 30 }}>
                    <input type="checkbox" aria-label="Tout sélectionner" checked={allChecked} onChange={(e) => setSel(e.target.checked ? new Set(filtered.map(rowKey)) : new Set())} />
                  </th>
                )}
                {cols.map((c) => (
                  <th
                    key={c.id}
                    className={`${c.className ?? ""} ${c.sort ? "sortable" : ""}`}
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={sort?.id === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {c.sort ? (
                      <button type="button" className="th-sort" onClick={() => clickSort(c)}>
                        {c.header}
                        <span className="sort-ind">{sort?.id === c.id ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                      </button>
                    ) : c.header}
                  </th>
                ))}
                {actions && <th className="actions">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const k = rowKey(r);
                return (
                  <tr
                    key={k}
                    className={`${onRowClick ? "clickable" : ""} ${sel.has(k) ? "selected" : ""} ${rowClassName?.(r) ?? ""}`}
                    {...(onRowClick ? clickable(() => onRowClick(r)) : {})}
                  >
                    {bulk && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} aria-label={`Sélectionner ${rowLabel?.(r) ?? k}`} />
                      </td>
                    )}
                    {cols.map((c) => <td key={c.id} className={c.className}>{c.cell(r)}</td>)}
                    {actions && <td className="actions" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">{loading && !all.length ? <><span className="spin" /> Chargement…</> : all.length ? "Aucune ligne ne correspond au filtre." : empty}</div>
      )}
      {filtered.length > pageSize && (
        <div className="dt-pager">
          <span className="small muted">{cur * pageSize + 1}–{Math.min(filtered.length, (cur + 1) * pageSize)} sur {filtered.length}</span>
          <span className="btn-group">
            <button className="btn btn-sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Précédent</button>
            <button className="btn btn-sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Suivant</button>
          </span>
        </div>
      )}
    </div>
  );
}

// Formulaire décrit par un schéma : on liste les champs, le composant s'occupe de
// l'affichage, de la validation, de l'aide et des champs avancés repliables.
// Les valeurs vides ne sont jamais envoyées à Proxmox (voir cleanValues).
import { useEffect, useState, type ReactNode } from "react";

export type FieldType =
  | "text" | "number" | "password" | "checkbox" | "select" | "api-select"
  | "tags" | "disk" | "cidr" | "mac" | "code" | "textarea";

export interface Option { value: string; label: string }

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  help?: ReactNode;
  placeholder?: string;
  required?: boolean;
  /** Champ replié sous « Options avancées ». */
  advanced?: boolean;
  /** Prend toute la largeur de la grille. */
  full?: boolean;
  /** Unité affichée à droite d'un nombre (Mo, cœurs, s...). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Liste fixe pour "select". */
  options?: Option[];
  /** Liste chargée depuis l'API pour "api-select". Reçoit les valeurs du formulaire. */
  load?: (values: Values) => Promise<Option[]>;
  /** Champs dont dépend la liste : elle est rechargée quand ils changent. */
  loadDeps?: string[];
  /** Permet de laisser la liste vide ("select" et "api-select"). */
  allowEmpty?: string;
  rows?: number;
  /** Validation en plus des règles du type. Retourne un message ou null. */
  validate?: (value: any, values: Values) => string | null;
  /** N'affiche le champ que si la condition est vraie. */
  show?: (values: Values) => boolean;
  /** Valeur par défaut, utilisée par initialValues(). */
  default?: unknown;
  /** Rend le champ non modifiable. */
  readOnly?: boolean;
}

export type Values = Record<string, any>;

// ── Validation par type ───────────────────────────────────────────
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
export function isCidr(v: string) {
  const [ip, mask, ...rest] = v.split("/");
  if (rest.length || mask === undefined || !/^\d+$/.test(mask)) return false;
  if (IPV4.test(ip)) return Number(mask) <= 32;
  return IPV6.test(ip) && ip.includes(":") && Number(mask) <= 128;
}
export const isMac = (v: string) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v);

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export function validateField(f: FieldDef, v: any, values: Values): string | null {
  if (f.show && !f.show(values)) return null;
  if (isEmpty(v)) return f.required && f.type !== "checkbox" ? "Ce champ est obligatoire." : null;
  switch (f.type) {
    case "number":
    case "disk": {
      const n = Number(v);
      if (!Number.isFinite(n)) return "Entre un nombre.";
      if (f.min !== undefined && n < f.min) return `Minimum : ${f.min}${f.unit ? ` ${f.unit}` : ""}.`;
      if (f.max !== undefined && n > f.max) return `Maximum : ${f.max}${f.unit ? ` ${f.unit}` : ""}.`;
      break;
    }
    case "cidr":
      if (!isCidr(String(v))) return "Format attendu : 10.0.1.20/24 (adresse puis masque).";
      break;
    case "mac":
      if (!isMac(String(v))) return "Format attendu : BC:24:11:AA:BB:CC.";
      break;
  }
  return f.validate ? f.validate(v, values) : null;
}

export function validateAll(fields: FieldDef[], values: Values) {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const e = validateField(f, values[f.name], values);
    if (e) errors[f.name] = e;
  }
  return errors;
}

export function initialValues(fields: FieldDef[], over: Values = {}): Values {
  const v: Values = {};
  for (const f of fields) if (f.default !== undefined) v[f.name] = f.default;
  return { ...v, ...over };
}

/**
 * Prépare les valeurs pour Proxmox : retire les vides et les champs masqués,
 * convertit les cases en 0/1, les tags en liste « a;b », les tailles disque en nombre.
 */
export function cleanValues(fields: FieldDef[], values: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.show && !f.show(values)) continue;
    let v = values[f.name];
    if (f.type === "checkbox") {
      if (v === undefined) continue;
      out[f.name] = v ? 1 : 0;
      continue;
    }
    if (typeof v === "string") v = v.trim();
    if (isEmpty(v)) continue;
    if (f.type === "tags") v = (Array.isArray(v) ? v : String(v).split(/[;,\s]+/)).filter(Boolean).join(";");
    if (f.type === "number" || f.type === "disk") v = Number(v);
    out[f.name] = v;
  }
  return out;
}

// ── Champs ────────────────────────────────────────────────────────
function ApiSelect({ f, value, onChange, id, values }: { f: FieldDef; value: any; onChange: (v: any) => void; id: string; values: Values }) {
  const [opts, setOpts] = useState<Option[] | null>(null);
  const [err, setErr] = useState("");
  const depKey = JSON.stringify((f.loadDeps ?? []).map((d) => values[d]));
  useEffect(() => {
    let live = true;
    setOpts(null);
    setErr("");
    f.load?.(values).then((o) => live && setOpts(o)).catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.name, depKey]);
  useEffect(() => {
    // Choisit la première option si rien n'est sélectionné (ou si l'ancienne valeur n'existe plus)
    if (!opts?.length || f.allowEmpty !== undefined && isEmpty(value)) return;
    if (isEmpty(value) || !opts.some((o) => o.value === String(value))) onChange(opts[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);
  if (err) return <div className="notice error">Liste indisponible : {err}</div>;
  if (opts && !opts.length && f.allowEmpty === undefined) return <div className="notice warn">Rien à choisir ici pour l&apos;instant.</div>;
  return (
    <select id={id} className="input select" value={value ?? ""} disabled={!opts || f.readOnly} onChange={(e) => onChange(e.target.value)}>
      {!opts && <option>Chargement…</option>}
      {opts && f.allowEmpty !== undefined && <option value="">{f.allowEmpty}</option>}
      {opts?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Tags({ value, onChange, id, placeholder }: { value: any; onChange: (v: string[]) => void; id: string; placeholder?: string }) {
  const list: string[] = Array.isArray(value) ? value : String(value ?? "").split(/[;,\s]+/).filter(Boolean);
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().toLowerCase().replace(/[^a-z0-9_.+-]/g, "-");
    if (t && !list.includes(t)) onChange([...list, t]);
    setDraft("");
  };
  return (
    <div className="tags-input">
      {list.map((t) => (
        <span key={t} className="chip">
          {t}
          <button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange(list.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={list.length ? "" : placeholder ?? "Ajoute un tag puis Entrée"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === " ") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && list.length) onChange(list.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}

export function FieldInput({ f, value, onChange, values = {} }: { f: FieldDef; value: any; onChange: (v: any) => void; values?: Values }) {
  const id = `f-${f.name}`;
  const common = { id, readOnly: f.readOnly, placeholder: f.placeholder };
  switch (f.type) {
    case "checkbox":
      return (
        <label className="check">
          <input id={id} type="checkbox" checked={!!value && value !== "0"} disabled={f.readOnly} onChange={(e) => onChange(e.target.checked)} />
          {f.placeholder}
        </label>
      );
    case "select":
      return (
        <select id={id} className="input select" value={value ?? ""} disabled={f.readOnly} onChange={(e) => onChange(e.target.value)}>
          {f.allowEmpty !== undefined && <option value="">{f.allowEmpty}</option>}
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case "api-select":
      return <ApiSelect f={f} value={value} onChange={onChange} id={id} values={values} />;
    case "tags":
      return <Tags value={value} onChange={onChange} id={id} placeholder={f.placeholder} />;
    case "code":
    case "textarea":
      return <textarea {...common} className={`input ${f.type === "code" ? "mono" : ""}`} rows={f.rows ?? 5} spellCheck={f.type !== "code"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "number":
    case "disk": {
      const unit = f.type === "disk" ? "Go" : f.unit;
      return (
        <div className="input-unit">
          <input {...common} className="input" type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step ?? 1} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
          {unit && <span className="unit">{unit}</span>}
        </div>
      );
    }
    case "password":
      return <input {...common} className="input" type="password" autoComplete="new-password" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "cidr":
    case "mac":
      return <input {...common} className="input mono" placeholder={f.placeholder ?? (f.type === "cidr" ? "10.0.1.20/24" : "BC:24:11:AA:BB:CC")} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input {...common} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Affiche une liste de champs (sans bouton). Sert aussi aux étapes du Wizard. */
export function FormFields({ fields, values, onChange, errors = {} }: { fields: FieldDef[]; values: Values; onChange: (name: string, v: any) => void; errors?: Record<string, string> }) {
  const [adv, setAdv] = useState(false);
  const visible = fields.filter((f) => !f.show || f.show(values));
  const basic = visible.filter((f) => !f.advanced);
  const advanced = visible.filter((f) => f.advanced);
  const advError = advanced.some((f) => errors[f.name]);
  const render = (f: FieldDef) => (
    <div key={f.name} className={`field ${f.full || f.type === "code" || f.type === "textarea" ? "full" : ""} ${errors[f.name] ? "has-error" : ""}`}>
      {f.type === "checkbox" ? (
        <FieldInput f={{ ...f, placeholder: f.label }} value={values[f.name]} onChange={(v) => onChange(f.name, v)} />
      ) : (
        <>
          <label htmlFor={`f-${f.name}`}>{f.label}{f.required && <span className="req" aria-hidden> *</span>}</label>
          <FieldInput f={f} value={values[f.name]} values={values} onChange={(v) => onChange(f.name, v)} />
        </>
      )}
      {errors[f.name] ? <div className="help error" role="alert">{errors[f.name]}</div> : f.help && <div className="help">{f.help}</div>}
    </div>
  );
  return (
    <div className="form-grid">
      {basic.map(render)}
      {advanced.length > 0 && (
        <div className="full adv">
          <button type="button" className="adv-toggle" aria-expanded={adv || advError} onClick={() => setAdv((a) => !a)}>
            {adv || advError ? "▾" : "▸"} Options avancées ({advanced.length})
          </button>
        </div>
      )}
      {(adv || advError) && advanced.map(render)}
    </div>
  );
}

/**
 * Formulaire complet avec bouton d'envoi. `onSubmit` reçoit les valeurs nettoyées
 * (sans les vides) et les valeurs brutes.
 */
export function Form({
  fields, initial, onSubmit, submitLabel = "Enregistrer", onCancel, extra, onValuesChange,
}: {
  fields: FieldDef[];
  initial?: Values;
  onSubmit: (clean: Values, raw: Values) => Promise<void> | void;
  submitLabel?: string;
  onCancel?: () => void;
  extra?: ReactNode;
  onValuesChange?: (v: Values) => void;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(fields, initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (name: string, v: any) => {
    setValues((old) => {
      const next = { ...old, [name]: v };
      onValuesChange?.(next);
      return next;
    });
    if (errors[name]) setErrors((e) => ({ ...e, [name]: "" }));
  };
  return (
    <form
      className="stack"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const errs = validateAll(fields, values);
        setErrors(errs);
        if (Object.values(errs).some(Boolean)) return;
        setBusy(true);
        setError("");
        try {
          await onSubmit(cleanValues(fields, values), values);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormFields fields={fields} values={values} onChange={set} errors={errors} />
      {extra}
      {error && <div className="notice error">{error}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <span className="spin" />}{submitLabel}</button>
      </div>
    </form>
  );
}

/** Texte lisible d'une valeur, pour les récapitulatifs. */
export function displayValue(f: FieldDef, v: any): string {
  if (isEmpty(v)) return "";
  if (f.type === "password") return "••••••";
  if (f.type === "checkbox") return v ? "Oui" : "Non";
  if (f.type === "select") return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if (f.type === "tags") return (Array.isArray(v) ? v : String(v).split(/[;,\s]+/)).filter(Boolean).join(", ");
  if (f.type === "disk") return `${v} Go`;
  if (f.type === "number" && f.unit) return `${v} ${f.unit}`;
  return String(v);
}

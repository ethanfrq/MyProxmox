// Assistant multi-étapes, même look que l'onboarding : étapes à gauche sur fond sombre,
// contenu à droite, récapitulatif automatique avant validation.
import { Fragment, useState, type ReactNode } from "react";
import { FormFields, cleanValues, displayValue, initialValues, validateAll, type FieldDef, type Values } from "./Form";

export interface WizardStep {
  id: string;
  title: string;
  /** Phrase d'introduction de l'étape. */
  lead?: ReactNode;
  /** Champs décrits par schéma (voir Form.tsx). */
  fields?: FieldDef[];
  /** Contenu libre, à la place des champs ou en plus. */
  render?: (values: Values, set: (name: string, v: any) => void) => ReactNode;
  /** Validation en plus de celle des champs. Retourne un message ou null. */
  validate?: (values: Values) => string | null;
}

export function Wizard({
  title, steps, initial, onFinish, onCancel, finishLabel = "Créer", summaryExtra, aside,
}: {
  title?: string;
  steps: WizardStep[];
  initial?: Values;
  /** Reçoit les valeurs nettoyées (sans vides) et les valeurs brutes. */
  onFinish: (clean: Values, raw: Values) => Promise<void> | void;
  onCancel?: () => void;
  finishLabel?: string;
  /** Lignes ajoutées au récapitulatif (aperçu de commande, avertissements...). */
  summaryExtra?: (values: Values) => ReactNode;
  /** Texte en bas de la colonne des étapes. */
  aside?: ReactNode;
}) {
  const allFields = steps.flatMap((s) => s.fields ?? []);
  const [values, setValues] = useState<Values>(() => initialValues(allFields, initial));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepError, setStepError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const SUMMARY = steps.length;
  const titles = [...steps.map((s) => s.title), "Récapitulatif"];

  const set = (name: string, v: any) => {
    setValues((o) => ({ ...o, [name]: v }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: "" }));
  };

  const check = (i: number) => {
    const s = steps[i];
    const errs = validateAll(s.fields ?? [], values);
    setErrors(errs);
    const custom = s.validate?.(values) ?? "";
    setStepError(custom);
    return !Object.values(errs).some(Boolean) && !custom;
  };

  const next = () => {
    if (step < SUMMARY && !check(step)) return;
    setStep((s) => Math.min(SUMMARY, s + 1));
  };

  const goto = (i: number) => {
    if (i < step) return setStep(i);
    // On ne saute en avant que si les étapes intermédiaires sont valides
    for (let k = step; k < i; k++) {
      if (!check(k)) return setStep(k);
    }
    setStep(i);
  };

  const finish = async () => {
    for (let k = 0; k < steps.length; k++) if (!check(k)) return setStep(k);
    setBusy(true);
    setError("");
    try {
      await onFinish(cleanValues(allFields, values), values);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cur = steps[step];
  return (
    <div className="wizard">
      <aside className="wizard-aside">
        {title && <div className="wizard-title">{title}</div>}
        <ol className="steps">
          {titles.map((t, i) => (
            <li key={t} className={i < step ? "done" : i === step ? "cur" : ""}>
              <button type="button" onClick={() => goto(i)} aria-current={i === step ? "step" : undefined}>{t}</button>
            </li>
          ))}
        </ol>
        {aside && <div className="pitch">{aside}</div>}
      </aside>
      <div className="wizard-main">
        {step < SUMMARY ? (
          <>
            <h2 className="wizard-h">{cur.title}</h2>
            {cur.lead && <p className="lead">{cur.lead}</p>}
            <div className="stack">
              {cur.fields && <FormFields fields={cur.fields} values={values} onChange={set} errors={errors} />}
              {cur.render?.(values, set)}
              {stepError && <div className="notice error">{stepError}</div>}
            </div>
          </>
        ) : (
          <>
            <h2 className="wizard-h">Récapitulatif</h2>
            <p className="lead">Vérifie avant de valider. Tu peux revenir sur une étape en cliquant dessus.</p>
            <div className="stack">
              {steps.map((s, i) => {
                const rows = (s.fields ?? []).filter((f) => !f.show || f.show(values)).map((f) => [f.label, displayValue(f, values[f.name])]).filter(([, v]) => v);
                if (!rows.length) return null;
                return (
                  <div key={s.id} className="summary-block">
                    <div className="summary-head"><h3>{s.title}</h3><button type="button" className="btn btn-sm btn-ghost" onClick={() => setStep(i)}>Modifier</button></div>
                    <div className="kv">{rows.map(([l, v]) => <Fragment key={l}><div>{l}</div><div>{v}</div></Fragment>)}</div>
                  </div>
                );
              })}
              {summaryExtra?.(values)}
              {error && <div className="notice error">{error}</div>}
            </div>
          </>
        )}
        <div className="auth-foot">
          <span className="row">
            {onCancel && <button type="button" className="btn" onClick={onCancel}>Annuler</button>}
            {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Retour</button>}
          </span>
          {step < SUMMARY ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={next}>Continuer</button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={finish}>{busy && <span className="spin" />}{finishLabel}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Valeurs nettoyées de toutes les étapes, pour un aperçu. */
export function wizardClean(steps: WizardStep[], values: Values) {
  return cleanValues(steps.flatMap((s) => s.fields ?? []), values);
}

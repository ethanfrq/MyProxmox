// Petits composants réutilisables : boutons, panneaux, jauges, onglets, fenêtres.
import { cloneElement, createContext, isValidElement, useCallback, useContext, useId, useState, type ReactElement, type ReactNode, type ButtonHTMLAttributes } from "react";
import { pve } from "../lib/api";
import { STATUS_LABEL, TASK_LABEL } from "../../../shared/format";
import { TaskLogModal } from "./TaskLog";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "dark" | "danger" | "ghost" | "default";
  size?: "sm" | "lg";
  icon?: ReactNode;
  busy?: boolean;
  block?: boolean;
};

export function Button({ variant = "default", size, icon, busy, block, children, className = "", disabled, ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" && `btn-${variant}`, size && `btn-${size}`, block && "btn-block", className].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled || busy} {...rest}>
      {busy ? <span className="spin" /> : icon}
      {children}
    </button>
  );
}

export function Panel({ title, right, children, pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="panel">
      {(title || right) && (
        <div className="panel-head">
          {typeof title === "string" ? <h2>{title}</h2> : title}
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {pad ? <div className="panel-body">{children}</div> : children}
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Meter({ label, value, max, text }: { label: string; value: number; max: number; text?: string }) {
  const ratio = max ? Math.min(1, value / max) : 0;
  return (
    <div className="meter">
      <div className="meter-top">
        <span className="l">{label}</span>
        <span className="r">{text ?? `${Math.round(ratio * 100)} %`}</span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${ratio > 0.85 ? "high" : ""}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function MiniMeter({ ratio }: { ratio: number }) {
  return <span className="mini-meter"><span style={{ width: `${Math.min(1, ratio || 0) * 100}%` }} /></span>;
}

export function Status({ status }: { status: string }) {
  const cls = status === "running" || status === "online" || status === "OK" ? "on" : status === "stopped" ? "off" : status === "paused" ? "warn" : "err";
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function TypeTag({ type }: { type: string }) {
  return type === "qemu" ? <span className="tag vm">VM</span> : <span className="tag ct">CT</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? "active" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, help, children, full }: { label: string; help?: ReactNode; children: ReactNode; full?: boolean }) {
  // Relie le libellé au champ (accessibilité, lecteurs d'écran, tests)
  const auto = useId();
  const child = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
  const id = child?.props.id ?? auto;
  const linked = child && typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type) ? cloneElement(child, { id }) : null;
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label htmlFor={linked ? id : undefined}>{label}</label>
      {linked ?? children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  return <div className={`notice ${kind === "info" ? "" : kind}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// ── Fenêtre simple (formulaires, détails) ───────────────────────────
export function Modal({ title, children, onClose, wide, foot }: { title: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean; foot?: ReactNode }) {
  return (
    <div className="modal-bg" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={typeof title === "string" ? title : undefined}>
        <div className="modal-head"><h2>{title}</h2></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

// ── Fenêtre de confirmation ────────────────────────────────────────
export function Confirm({
  title, children, confirmLabel = "Confirmer", danger, requireText, onConfirm, onClose,
}: {
  title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string;
  onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = requireText !== undefined && typed !== requireText;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${danger ? "danger" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="modal-head"><h2>{title}</h2></div>
        <div className="modal-body stack">
          {children}
          {requireText !== undefined && (
            <Field label={`Tape « ${requireText} » pour confirmer`}>
              <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            busy={busy}
            disabled={blocked}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); onClose(); } finally { setBusy(false); }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Notifications + suivi des tâches Proxmox ───────────────────────
interface ToastAction { label: string; onClick: () => void }
interface Toast { id: number; kind: "info" | "ok" | "error"; text: string; action?: ToastAction }
interface ToastApi {
  toast: (text: string, kind?: Toast["kind"], action?: ToastAction) => void;
  // Suit une tâche Proxmox (UPID) jusqu'à la fin et prévient l'utilisateur.
  watch: (node: string, upid: string, label?: string, onDone?: () => void) => void;
  // Ouvre le journal d'une tâche dans une fenêtre.
  showLog: (upid: string, node?: string) => void;
}
const Ctx = createContext<ToastApi>({ toast: () => {}, watch: () => {}, showLog: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const [log, setLog] = useState<{ upid: string; node?: string } | null>(null);

  const dismiss = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((text: string, kind: Toast["kind"] = "info", action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, kind, text, action }]);
    setTimeout(() => dismiss(id), kind === "error" || action ? 8000 : 4000);
  }, [dismiss]);

  const showLog = useCallback((upid: string, node?: string) => setLog({ upid, node }), []);

  const watch = useCallback((node: string, upid: string, label?: string, onDone?: () => void) => {
    const type = upid.split(":")[5] ?? "";
    const name = label ?? TASK_LABEL[type] ?? type;
    const action = { label: "Voir le journal", onClick: () => showLog(upid, node) };
    toast(`${name} : en cours…`, "info", action);
    let tries = 0;
    const tick = async () => {
      tries++;
      try {
        const st = await pve.get(`/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`);
        if (st.status === "stopped") {
          if (st.exitstatus === "OK") toast(`${name} : terminé`, "ok", action);
          else toast(`${name} : échec (${st.exitstatus})`, "error", action);
          onDone?.();
          return;
        }
      } catch {
        /* on réessaie */
      }
      if (tries < 300) setTimeout(tick, 1500);
    };
    setTimeout(tick, 800);
  }, [toast, showLog]);

  return (
    <Ctx.Provider value={{ toast, watch, showLog }}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            {t.action && <button className="toast-action" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
      {log && <TaskLogModal upid={log.upid} node={log.node} onClose={() => setLog(null)} />}
    </Ctx.Provider>
  );
}

export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "Copié" : label}
    </Button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Switch({ title, desc, on, onChange }: { title: string; desc?: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch">
      <div><div className="t">{title}</div>{desc && <div className="d">{desc}</div>}</div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

const LVL: Record<string, string> = { info: "Info", warning: "Attention", critical: "Critique", ok: "OK" };
export function Lvl({ level }: { level: string }) {
  return <span className={`lvl ${level}`}>{LVL[level] ?? level}</span>;
}

/** Affiche un secret une seule fois, avec un bouton copier. */
export function SecretBox({ value }: { value: string }) {
  return (
    <div className="secret">
      <input className="input" readOnly value={value} onFocus={(e) => e.target.select()} />
      <CopyButton text={value} />
    </div>
  );
}

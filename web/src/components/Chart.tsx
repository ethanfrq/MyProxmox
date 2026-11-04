// Graphiques SVG maison, sans bibliothèque : courbes multi-séries et mini graphes.
// Les couleurs viennent des variables CSS (couleurs Proxmox), lisibles sur fond clair ou sombre.
import { useId } from "react";

export interface Series {
  label: string;
  values: number[];
  /** Variable CSS, ex. "var(--orange)". */
  color: string;
  area?: boolean;
}

const W = 600;

function path(values: number[], max: number, h: number) {
  const n = values.length;
  return values.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, n - 1)) * W).toFixed(1)},${(h - (Math.max(0, v) / max) * (h - 6) - 3).toFixed(1)}`).join(" ");
}

/**
 * Courbes sur une même échelle. `format` met en forme les valeurs (axe et légende),
 * `times` (secondes) sert aux bornes de l'axe horizontal.
 */
export function LineChart({
  series, max, height = 140, format = (v) => v.toFixed(1), times, title,
}: {
  series: Series[];
  max?: number;
  height?: number;
  format?: (v: number) => string;
  times?: number[];
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  const all = series.flatMap((s) => s.values);
  const top = max ?? Math.max(1e-9, ...all) * 1.1;
  const t0 = times?.[0];
  const t1 = times?.at(-1);
  const span = t0 && t1 ? t1 - t0 : 0;
  const fmtT = (t: number) => new Date(t * 1000).toLocaleString("fr-FR", span > 2 * 86400 ? { weekday: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });
  return (
    <figure className="chart" aria-label={title}>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label}><i style={{ background: s.color }} />{s.label} <b>{s.values.length ? format(s.values.at(-1)!) : "-"}</b></span>
        ))}
      </div>
      <div className="chart-plot">
        <span className="chart-max">{format(top)}</span>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height: `${height / 14}em` }} role="img" aria-label={title}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`${id}-g${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity=".28" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} className="chart-grid" x1="0" x2={W} y1={height * f} y2={height * f} />)}
          {series.map((s, i) => s.values.length > 1 && (
            <g key={s.label} className="chart-series">
              {s.area !== false && <path d={`${path(s.values, top, height)} L${W},${height} L0,${height} Z`} fill={`url(#${id}-g${i})`} />}
              <path d={path(s.values, top, height)} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          ))}
        </svg>
      </div>
      {t0 && t1 && <div className="chart-axis"><span>{fmtT(t0)}</span><span>{fmtT(t1)}</span></div>}
    </figure>
  );
}

/** Mini graphe sans axe (par machine). */
export function Spark({ values, max = 1, color = "var(--orange)", height = 28 }: { values: number[]; max?: number; color?: string; height?: number }) {
  if (values.length < 2) return <svg className="spark-mini" style={{ height: `${height / 14}em` }} aria-hidden />;
  return (
    <svg className="spark-mini" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height: `${height / 14}em` }} aria-hidden>
      <path d={`${path(values, max, height)} L${W},${height} L0,${height} Z`} fill={color} opacity=".18" />
      <path d={path(values, max, height)} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Jauge horizontale avec seuils (vert, orange, rouge). */
export function Gauge({ ratio, warn = 0.75, crit = 0.9 }: { ratio: number; warn?: number; crit?: number }) {
  const r = Math.min(1, Math.max(0, ratio || 0));
  return (
    <span className="gauge" role="meter" aria-valuenow={Math.round(r * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className={r >= crit ? "crit" : r >= warn ? "warn" : ""} style={{ width: `${r * 100}%` }} />
    </span>
  );
}

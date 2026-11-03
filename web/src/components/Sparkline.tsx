// Petit graphique de tendance (SVG) pour CPU, RAM ou réseau.
export function Sparkline({ values, max, height = 64, label, current }: { values: number[]; max?: number; height?: number; label: string; current: string }) {
  const w = 300;
  const top = max ?? Math.max(...values, 0.0001);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${height - (v / top) * (height - 4) - 2}`);
  return (
    <div>
      <div className="meter-top" style={{ marginBottom: 6 }}>
        <span className="l">{label}</span>
        <span className="r">{current}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="spark" style={{ width: "100%", height, display: "block", background: "#fafafa", borderBottom: "1px solid var(--line)" }}>
        {values.length > 1 && (
          <>
            <polygon points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill="rgba(229,112,0,.12)" />
            <polyline points={pts.join(" ")} fill="none" stroke="var(--orange)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
    </div>
  );
}

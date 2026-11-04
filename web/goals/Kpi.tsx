import type { ReactNode } from "react";

/** A KPI card: label, value and an optional note. The accent bar takes the page's `--slot`. */
export function Kpi({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note ? <p className="sub">{note}</p> : null}
    </div>
  );
}

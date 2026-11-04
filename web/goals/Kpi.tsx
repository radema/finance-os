import type { ReactNode } from "react";

/**
 * A KPI card: label, value and an optional note. The accent bar takes the page's `--slot`. With an
 * `href` the whole card is a link to the screen that explains the number.
 */
export function Kpi({
  label,
  value,
  note,
  href,
}: {
  label: ReactNode;
  value: string;
  note?: ReactNode;
  href?: string;
}) {
  const text = (
    <>
      <div className="kpi-value">{value}</div>
      {note ? <p className="sub">{note}</p> : null}
    </>
  );
  // The link wraps value and note only: a term button in the label cannot sit inside an <a>.
  return href ? (
    <div className="kpi kpi-link">
      <div className="kpi-label">{label}</div>
      <a className="kpi-main" href={href}>
        {text}
      </a>
    </div>
  ) : (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      {text}
    </div>
  );
}

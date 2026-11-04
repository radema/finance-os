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
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note ? <p className="sub">{note}</p> : null}
    </>
  );
  return href ? (
    <a className="kpi kpi-link" href={href}>
      {body}
    </a>
  ) : (
    <div className="kpi">{body}</div>
  );
}

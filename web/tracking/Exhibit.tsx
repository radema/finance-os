import type { CSSProperties, ReactNode } from "react";

export interface LegendItem {
  label: string;
  kind: "line" | "dash" | "area" | "bar" | "dot" | "ring";
  /** The custom property of the colour, for example `--hl` or `--slot3`. */
  colour: string;
}

/** The compact legend above a multi-series chart. */
export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className="legend legend-tracking">
      {items.map((item) => (
        <li key={item.label}>
          <span
            className={`swatch swatch-${item.kind}`}
            style={{ "--swatch": `var(${item.colour})` } as CSSProperties}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** The exhibit anatomy of DESIGN.md: tag, action title with a number, unit line, chart, callout, source. */
export function Exhibit({
  tag,
  title,
  unit,
  legend,
  callout,
  source,
  children,
}: {
  tag: string;
  title: string;
  unit: ReactNode;
  legend?: readonly LegendItem[];
  callout: ReactNode;
  source: string;
  children: ReactNode;
}) {
  return (
    <figure className="exhibit">
      <div className="tag">{tag}</div>
      <h2 className="exhibit-title">{title}</h2>
      <p className="unit">{unit}</p>
      {legend ? <Legend items={legend} /> : null}
      {children}
      <p className="callout">{callout}</p>
      <figcaption className="source">{source}</figcaption>
    </figure>
  );
}

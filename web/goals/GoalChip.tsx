import type { CSSProperties } from "react";
import { goalDetailHref } from "../nav.ts";

/** Goal chip: a dot in the goal's slot colour, the name, the goal's tint, a link to its detail. */
export function GoalChip({ id, name, slot }: { id: string; name: string; slot: number }) {
  const style = { "--slot": `var(--slot${slot})`, "--tint": `var(--tint${slot})` } as CSSProperties;
  return (
    <a className="chip" href={goalDetailHref(id)} style={style}>
      <span className="chip-dot" />
      {name}
    </a>
  );
}

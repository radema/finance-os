import type { Severity } from "../../engine/rules.ts";
import { ICON_PROPS, Icon } from "./StatusChip.tsx";

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "Medium") return <Icon status="at_risk" />;
  if (severity === "High") return <Icon status="off_track" />;
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative, the word next to it is the label
    <svg {...ICON_PROPS} fill="none" stroke="currentColor">
      <circle cx="10" cy="10" r="6.5" />
    </svg>
  );
}

/** Alert severity chip: an icon and a word, built like the status chip. No red and no green. */
export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`severity severity-${severity}`}>
      <SeverityIcon severity={severity} />
      {severity}
    </span>
  );
}

import type { GoalStatus } from "../../engine/goalStatus.ts";
import { statusLabel } from "./outlook.ts";

export const ICON_PROPS = {
  viewBox: "0 0 20 20",
  "aria-hidden": true,
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function Icon({ status }: { status: GoalStatus }) {
  if (status === "on_track") {
    return (
      // biome-ignore lint/a11y/noSvgWithoutTitle: decorative, the word next to it is the label
      <svg {...ICON_PROPS} fill="none" stroke="currentColor">
        <circle cx="10" cy="10" r="7" />
        <path d="M6.8 10.2l2.2 2.2 4.2-4.6" />
      </svg>
    );
  }
  const filled = status === "off_track";
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative, the word next to it is the label
    <svg {...ICON_PROPS} fill={filled ? "currentColor" : "none"} stroke="currentColor">
      <path d="M10 3.5l7 12.5H3z" />
      <path d="M10 8.5v3.2M10 14v.1" stroke={filled ? "var(--surface)" : "currentColor"} />
    </svg>
  );
}

/** Status chip: an icon and a word, so colour is never the only channel. No red and no green. */
export function StatusChip({ status }: { status: GoalStatus }) {
  return (
    <span className={`status status-${status}`}>
      <Icon status={status} />
      {statusLabel(status)}
    </span>
  );
}

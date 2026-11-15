import type { ReactNode } from "react";

export type MotifKind = "target" | "allocation" | "comparison" | "coverage" | "entries" | "copy";

const shapes: Record<MotifKind, ReactNode> = {
  target: (
    <>
      <rect
        x="12"
        y="12"
        width="76"
        height="76"
        fill="none"
        stroke="var(--slot5)"
        strokeWidth="8.5"
      />
      <circle cx="50" cy="50" r="17" fill="var(--slot4)" />
    </>
  ),
  allocation: (
    <>
      <path d="M50 50H12A38 38 0 0 1 50 12Z" fill="var(--slot4)" />
      <path d="M50 50V12A38 38 0 0 1 88 50Z" fill="var(--slot5)" />
    </>
  ),
  comparison: (
    <>
      <circle cx="28" cy="50" r="23" fill="var(--slot2)" />
      <circle cx="72" cy="50" r="23" fill="var(--slot5)" />
    </>
  ),
  coverage: (
    <>
      <rect
        x="12"
        y="12"
        width="76"
        height="76"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="3.5"
      />
      <rect x="40" y="40" width="45" height="45" fill="var(--slot2)" />
    </>
  ),
  entries: (
    <>
      <rect x="8" y="37" width="23" height="23" fill="var(--ink)" />
      <rect x="37" y="37" width="23" height="23" fill="var(--slot4)" />
      <rect x="66" y="37" width="23" height="23" fill="var(--slot5)" />
    </>
  ),
  copy: (
    <>
      <rect x="12" y="12" width="54" height="54" fill="var(--slot5)" />
      <rect x="34" y="34" width="54" height="54" fill="var(--slot4)" />
    </>
  ),
};

/** A stable section identity; its heading supplies the meaning, never the artwork alone. */
export function Motif({ kind }: { kind: MotifKind }) {
  return (
    <svg
      className="motif"
      data-motif={kind}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[kind]}
    </svg>
  );
}

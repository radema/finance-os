import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GLOSSARY, type TermId } from "./terms.ts";

const GAP = 6;
const MARGIN = 8;
const POPOVER_WIDTH = 320;

/**
 * A jargon term as a button. The popover opens on click, tap and keyboard focus: the Italian term first,
 * then the plain sentence. It uses the native `popover` attribute, so it sits above tables and cards, and
 * closes on Escape or a click outside. Pass `children` only to change the shown words (a column header).
 */
export function TermPopover({
  term,
  children,
  note,
}: {
  term: TermId;
  children?: ReactNode;
  /** A sentence about this one case, shown after the explanation. */
  note?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const entry = GLOSSARY[term];

  const place = useCallback(() => {
    const box = popover.current;
    const rect = button.current?.getBoundingClientRect();
    if (!box || !rect) return;
    box.style.top = `${rect.bottom + GAP}px`;
    box.style.left = `${Math.max(MARGIN, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - MARGIN))}px`;
  }, []);
  const close = () => {
    if (popover.current?.matches(":popover-open")) popover.current.hidePopover();
  };
  // Focus fires before click on a mouse press, so both only open and never toggle.
  const open = () => {
    const box = popover.current;
    if (!box || box.matches(":popover-open")) return;
    place();
    box.showPopover();
  };
  // The box is fixed to the viewport, so it follows the button while the page scrolls or resizes.
  useEffect(() => {
    if (!shown) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [shown, place]);

  return (
    <>
      <button
        ref={button}
        className="term"
        type="button"
        aria-expanded={shown}
        aria-controls={id}
        onFocus={open}
        onClick={open}
        onBlur={(event) => {
          if (!popover.current?.contains(event.relatedTarget)) close();
        }}
      >
        {children ?? entry.en}
      </button>
      <div
        ref={popover}
        id={id}
        className="term-popover"
        popover="auto"
        tabIndex={-1}
        onToggle={(event) => setShown(event.newState === "open")}
      >
        <span className="term-it">{entry.it}</span>
        <span className="term-explanation">{entry.explanation}</span>
        {note ? <span className="term-explanation">{note}</span> : null}
      </div>
    </>
  );
}

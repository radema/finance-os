import { type RefObject, useCallback, useRef } from "react";

/** The part of an element `revealNow` uses. */
export interface RevealTarget {
  closest(selector: string): RevealCard | null;
  querySelector(selector: string): { focus(options: FocusOptions): void } | null;
  scrollIntoView(options: ScrollIntoViewOptions): void;
}

interface RevealCard {
  querySelector(
    selector: string,
  ): { getAttribute(name: string): string | null; click(): void } | null;
  scrollIntoView(options: ScrollIntoViewOptions): void;
}

/** The ref `useRevealForm` returns: it goes on the form element. */
export type RevealFormRef = RefObject<HTMLFormElement | null>;

/** What to bring into view: the whole card (its title says Edit), or just the form when the card also holds a list. */
export type RevealScope = "card" | "form";

const FIRST_FIELD =
  "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])";

/** Opens the folded card of a form. Returns whether it did: the card shows its body on the next render. */
export function openCard(form: RevealTarget): boolean {
  const toggle = form.closest(".card")?.querySelector(".card-toggle");
  if (toggle?.getAttribute("aria-expanded") !== "false") return false;
  toggle.click();
  return true;
}

/** Focuses the first field of a form and scrolls it into view; the scroll is instant when the user asks for less motion. */
export function showForm(form: RevealTarget, scope: RevealScope, reducedMotion: boolean): void {
  form.querySelector(FIRST_FIELD)?.focus({ preventScroll: true });
  const card = form.closest(".card");
  const target = scope === "card" && card ? card : form;
  target.scrollIntoView({
    block: scope === "card" ? "start" : "nearest",
    behavior: reducedMotion ? "instant" : "smooth",
  });
}

/**
 * The ref to put on the form element, and `reveal` to call from the Edit handler. `reveal` waits for the
 * next frame, so the form is rendered with the row's values (a form that remounts for each row included),
 * and one more when it has to open a folded card first.
 */
export function useRevealForm(scope: RevealScope = "card"): {
  formRef: RevealFormRef;
  reveal: () => void;
} {
  const formRef = useRef<HTMLFormElement>(null);
  const reveal = useCallback(() => {
    const show = () => {
      if (formRef.current === null) return;
      showForm(
        formRef.current,
        scope,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    };
    requestAnimationFrame(() => {
      if (formRef.current === null) return;
      if (openCard(formRef.current)) requestAnimationFrame(show);
      else show();
    });
  }, [scope]);
  return { formRef, reveal };
}

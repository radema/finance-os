// THROWAWAY: three structural directions on the existing Overview, selected by ?variant=A|B|C.
import { useEffect, useState } from "react";
import "./bauhaus-prototype.css";

const variants = [
  {
    key: "A",
    name: "Asymmetric studio",
    detail: "Restrained geometry · square chips · consistent checkboxes",
  },
  {
    key: "B",
    name: "Modular workshop",
    detail: "Equal metric modules · ruled sections · geometric sans",
  },
  {
    key: "C",
    name: "Financial ledger",
    detail: "Vertical metric rail · wide reading column · compact sans",
  },
];
const read = () => new URLSearchParams(window.location.search).get("variant");

export function BauhausPrototype() {
  const [key, setKey] = useState(read);
  const current = variants.findIndex((variant) => variant.key === key);
  useEffect(() => {
    const update = () => setKey(read());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    if (current < 0) return;
    document.body.dataset.bauhaus = variants[current].key;
    return () => {
      delete document.body.dataset.bauhaus;
    };
  }, [current]);
  function cycle(direction: number) {
    const next = variants[(current + direction + variants.length) % variants.length];
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next.key);
    window.history.replaceState(null, "", url);
    setKey(next.key);
  }
  useEffect(() => {
    if (current < 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, [contenteditable], [role=slider], [role=tablist]",
        )
      )
        return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cycle(event.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (current < 0) return null;
  const variant = variants[current];
  return (
    <aside className="prototype-switcher" aria-label="Throwaway design prototype">
      <button type="button" onClick={() => cycle(-1)} aria-label="Previous design">
        ←
      </button>
      <div aria-live="polite">
        <small>Prototype · {current + 1} / 3 · live app data</small>
        <strong>
          {variant.key} — {variant.name}
        </strong>
        <small>{variant.detail}</small>
      </div>
      <button type="button" onClick={() => cycle(1)} aria-label="Next design">
        →
      </button>
      <a href={`${window.location.pathname}${window.location.hash}`}>Exit</a>
    </aside>
  );
}

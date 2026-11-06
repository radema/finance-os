import type { ReactNode, Ref } from "react";
import { useId, useState } from "react";
import type { Loaded } from "../api.ts";
import { browserStorage, cardKey, readOpen, screenHash, writeOpen } from "./cardState.ts";

/**
 * A section. Its title is a heading, and the button in it folds the body; the state is remembered per screen in the browser,
 * under `memoryKey` when the title is not plain text. The body stays mounted when folded, so a form
 * keeps its edits.
 */
export function Card({
  title,
  children,
  note,
  memoryKey,
  level = 2,
}: {
  title: ReactNode;
  children: ReactNode;
  note?: ReactNode;
  memoryKey?: string;
  /** The heading level of the title: 3 inside a section that already has an h2. */
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const titleId = useId();
  const bodyId = useId();
  const name = memoryKey ?? (typeof title === "string" ? title : undefined);
  const key = name === undefined ? undefined : cardKey(screenHash(), name);
  const [state, setState] = useState({ key, open: readOpen(browserStorage(), key) });
  // A Card instance kept across a route change reads the memory of its new key.
  const open = state.key === key ? state.open : readOpen(browserStorage(), key);
  const toggle = () => {
    setState({ key, open: !open });
    if (key !== undefined) writeOpen(browserStorage(), key, !open);
  };
  return (
    <section className="card">
      <Heading className="card-head card-head-row" aria-labelledby={titleId}>
        <button
          className="card-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-labelledby={titleId}
          onClick={toggle}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </button>
        <span id={titleId}>{title}</span>
      </Heading>
      <div className="card-body" id={bodyId} hidden={!open}>
        {note ? <p className="note">{note}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function Alert({ message }: { message: string | undefined }) {
  return message ? (
    <p className="alert" role="alert">
      {message}
    </p>
  ) : null;
}

/** Loading and error states of a resource. Renders `children` once there is data. */
export function Resource<T>({
  loaded,
  children,
}: {
  loaded: Loaded<T>;
  children: (data: T) => ReactNode;
}) {
  if (loaded.data !== undefined) return <>{children(loaded.data)}</>;
  if (loaded.error) {
    return (
      <div className="alert" role="alert">
        <p>{loaded.error}</p>
        <button className="btn" type="button" onClick={loaded.reload}>
          Try again
        </button>
      </div>
    );
  }
  return <p className="note">Loading...</p>;
}

/** The one-line legend of a form that has required fields. */
export function RequiredLegend() {
  return (
    <p className="form-legend">
      <span aria-hidden="true">*</span> required
    </p>
  );
}

export function Field({
  label,
  hint,
  required,
  wrap = "label",
  children,
}: {
  label: ReactNode;
  /** A string, or a node. A hint with a control of its own needs `wrap="div"`. */
  hint?: ReactNode;
  /** Shows the required mark. Put the `aria-required` on the control too. */
  required?: boolean;
  /** The root element. Keep it the same for the life of a field: a change remounts the control. */
  wrap?: "label" | "div";
  /** The control. A function gets the id of the label text, for `aria-labelledby`, and the id the control takes. */
  children: ReactNode | ((labelId: string, controlId: string) => ReactNode);
}) {
  const labelId = useId();
  const controlId = useId();
  const control = typeof children === "function" ? children(labelId, controlId) : children;
  const hintText = hint ? <span className="field-hint">{hint}</span> : null;
  const mark = required ? (
    <span className="field-required" aria-hidden="true">
      {" "}
      *
    </span>
  ) : null;
  // A term button in the label, or a button in the hint, is a second labelable element: the field is a div,
  // and the label row points at the control with `for`. A click on the term opens its popover; the rest of
  // the row focuses the control.
  if (typeof label !== "string" || wrap === "div") {
    return (
      <div className="field">
        <label className="field-label" htmlFor={controlId}>
          <span id={labelId}>{label}</span>
          {mark}
        </label>
        {control}
        {hintText}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is `children`, nested in the label
    <label className="field">
      <span className="field-label">
        <span id={labelId}>{label}</span>
        {mark}
      </span>
      {control}
      {hintText}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} required={required}>
      {(labelId, controlId) => (
        <input
          id={controlId}
          type="text"
          aria-labelledby={labelId}
          aria-required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  required,
  step = "any",
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <Field label={label} hint={hint} required={required}>
      {(labelId, controlId) => (
        <input
          id={controlId}
          type="number"
          inputMode="decimal"
          aria-labelledby={labelId}
          aria-required={required}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  wrap,
  selectRef,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: ReactNode;
  wrap?: "label" | "div";
  selectRef?: Ref<HTMLSelectElement>;
}) {
  return (
    <Field label={label} hint={hint} wrap={wrap}>
      {(labelId, controlId) => (
        <select
          id={controlId}
          ref={selectRef}
          aria-labelledby={labelId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/** A destructive button that asks first, in place: no browser dialog. */
export function ConfirmButton({
  label,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className="btn btn-quiet" type="button" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm">
      <button
        className="btn"
        type="button"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button className="btn btn-quiet" type="button" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

const PRIORITY_MARK: Record<string, string> = { Need: "need", Want: "want", Wish: "wish" };

/** Need / Want / Wish tag: a marker plus a tint, so the shape carries the meaning too. */
export function PriorityTag({ priority }: { priority: string }) {
  return <span className={`prio prio-${PRIORITY_MARK[priority] ?? "wish"}`}>{priority}</span>;
}

const PRODUCT_TAG: Record<string, { label: string; className: string }> = {
  etf: { label: "ETF", className: "ptag-etf" },
  govt: { label: "BTP", className: "ptag-govt" },
  pension: { label: "Pension", className: "ptag-pension" },
  direct: { label: "Direct", className: "ptag-other" },
  cash: { label: "Cash", className: "ptag-other" },
};

export function ProductTag({ regime }: { regime: string }) {
  const tag = PRODUCT_TAG[regime] ?? { label: regime, className: "ptag-other" };
  return <span className={`ptag ${tag.className}`}>{tag.label}</span>;
}

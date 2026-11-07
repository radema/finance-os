import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { useId, useState } from "react";
import type { Loaded } from "../api.ts";
import { num, showDecimal } from "../forms.ts";
import { Loading } from "../Loading.tsx";
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
      <div className="alert state-box" role="alert">
        <p>{loaded.error}</p>
        <button className="btn" type="button" onClick={loaded.reload}>
          Try again
        </button>
      </div>
    );
  }
  return <Loading />;
}

/** The one-line legend of a form that has required fields. */
export function RequiredLegend() {
  return (
    <p className="form-legend">
      <span aria-hidden="true">*</span> required
    </p>
  );
}

/** What a control with an error takes: spread it on the control. */
export interface InvalidProps {
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export function Field({
  label,
  hint,
  error,
  required,
  wrap = "label",
  children,
}: {
  label: ReactNode;
  /** A string, or a node. A hint with a control of its own needs `wrap="div"`. */
  hint?: ReactNode;
  /** Plain words for what is wrong. It takes the place of the hint, under the control. */
  error?: string;
  /** Shows the required mark. Put the `aria-required` on the control too. */
  required?: boolean;
  /** The root element. Keep it the same for the life of a field: a change remounts the control. */
  wrap?: "label" | "div";
  /**
   * The control. A function gets the id of the label text, for `aria-labelledby`, the id the control takes,
   * and the props that link the control to its error.
   */
  children: ReactNode | ((labelId: string, controlId: string, invalid: InvalidProps) => ReactNode);
}) {
  const labelId = useId();
  const controlId = useId();
  const errorId = useId();
  const invalid: InvalidProps = error ? { "aria-invalid": true, "aria-describedby": errorId } : {};
  const control = typeof children === "function" ? children(labelId, controlId, invalid) : children;
  const hintText = error ? (
    <span className="field-hint field-error" id={errorId}>
      <svg
        className="field-error-mark"
        aria-hidden="true"
        viewBox="0 0 12 12"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 1.5 11 10.5H1Z M6 5v2.5 M6 9v.01" />
      </svg>
      {error}
    </span>
  ) : hint ? (
    <span className="field-hint">{hint}</span>
  ) : null;
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
  error,
  required,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(labelId, controlId, invalid) => (
        <input
          id={controlId}
          type="text"
          aria-labelledby={labelId}
          aria-required={required}
          {...invalid}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * A text box for a number. It shows a stored dot as the decimal comma and sends what the user types as typed,
 * so a thousands dot (`1.234,5`) is not rewritten while it is typed. `num` reads the text.
 */
export function DecimalInput({
  value,
  onChange,
  onBlur,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [typed, setTyped] = useState<string>();
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={typed === value || !Number.isFinite(num(value)) ? value : showDecimal(value)}
      onChange={(event) => {
        setTyped(event.target.value);
        onChange(event.target.value);
      }}
      onBlur={(event) => {
        setTyped(undefined);
        onBlur?.(event);
      }}
    />
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  unit,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  /** The unit (€, %, years), shown inside the field after the value. Keep it out of the label. */
  unit?: string;
}) {
  const unitId = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(labelId, controlId, invalid) => {
        const input = (
          <DecimalInput
            id={controlId}
            aria-labelledby={unit ? `${labelId} ${unitId}` : labelId}
            aria-required={required}
            {...invalid}
            value={value}
            onChange={onChange}
          />
        );
        return unit ? (
          <span className="input-unit">
            {input}
            <span id={unitId} className="field-unit">
              {unit}
            </span>
          </span>
        ) : (
          input
        );
      }}
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  wrap,
  selectRef,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: ReactNode;
  error?: string;
  wrap?: "label" | "div";
  selectRef?: Ref<HTMLSelectElement>;
}) {
  return (
    <Field label={label} hint={hint} error={error} wrap={wrap}>
      {(labelId, controlId, invalid) => (
        <select
          id={controlId}
          ref={selectRef}
          aria-labelledby={labelId}
          {...invalid}
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
  apart = false,
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  /** In a row-actions group: sit apart from the other actions. */
  apart?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const setApart = apart ? " set-apart" : "";
  if (!asking) {
    return (
      <button className={`btn btn-quiet${setApart}`} type="button" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className={`confirm${setApart}`}>
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

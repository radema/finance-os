import type { ReactNode } from "react";
import { useState } from "react";
import type { Loaded } from "../api.ts";

export function Card({
  title,
  children,
  note,
}: {
  title: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card-head">{title}</header>
      <div className="card-body">
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

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  // A term button is labelable, so it goes after the control in the DOM; CSS shows it first.
  const isText = typeof label === "string";
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is `children`, nested in the label
    <label className="field">
      {isText ? <span className="field-label">{label}</span> : null}
      {children}
      {isText ? null : <span className="field-label field-label-first">{label}</span>}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  step = "any",
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  step?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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

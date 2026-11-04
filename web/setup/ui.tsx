import type { ReactNode } from "react";
import { useId, useState } from "react";
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
  /** The control. A function gets the id of the label text, for `aria-labelledby`. */
  children: ReactNode | ((labelId: string) => ReactNode);
}) {
  const labelId = useId();
  const control = typeof children === "function" ? children(labelId) : children;
  const hintText = hint ? <span className="field-hint">{hint}</span> : null;
  // A term button in the label is a second labelable element, so a term label is a div, not a label.
  if (typeof label !== "string") {
    return (
      <div className="field">
        <span id={labelId} className="field-label">
          {label}
        </span>
        {control}
        {hintText}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is `children`, nested in the label
    <label className="field">
      <span className="field-label">{label}</span>
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
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(labelId) => (
        <input
          type="text"
          aria-labelledby={labelId}
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
      {(labelId) => (
        <input
          type="number"
          inputMode="decimal"
          aria-labelledby={labelId}
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
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      {(labelId) => (
        <select
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

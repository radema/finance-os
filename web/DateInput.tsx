import type { InputHTMLAttributes } from "react";

/**
 * The native date input and its picker, with the picked date in ISO next to it: the date format of the app,
 * whatever the browser locale shows inside the input.
 */
export function DateInput({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange">) {
  return (
    <span className="input-date">
      <input
        {...rest}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="date-iso">{value || "YYYY-MM-DD"}</span>
    </span>
  );
}

import type { ChangeEvent } from "react";
import { useId } from "react";

/**
 * The one file picker: an outlined button that opens the file dialog, then the chosen file name.
 * The real file input stays in the tab order (visually hidden, not `hidden`), so Tab then Enter or Space opens the dialog.
 * The caller keeps the file name: it can clear it, for example when the choice is cancelled.
 */
export function FilePicker({
  label,
  accept,
  fileName,
  disabled = false,
  onChange,
}: {
  label: string;
  accept: string;
  fileName: string | undefined;
  disabled?: boolean;
  onChange: (file: File) => void;
}) {
  const nameId = useId();
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the input, so choosing the same file again fires a change.
    event.target.value = "";
    if (file) onChange(file);
  };
  return (
    <span className="file-picker">
      <label className="btn">
        {label}
        <input
          type="file"
          accept={accept}
          aria-describedby={nameId}
          disabled={disabled}
          onChange={choose}
        />
      </label>
      <span className="file-name" id={nameId}>
        {fileName ?? "No file chosen"}
      </span>
    </span>
  );
}

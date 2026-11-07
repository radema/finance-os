import { type ReactNode, useState } from "react";
import { type RevealFormRef, type RevealScope, useRevealForm } from "./revealForm.ts";
import { ConfirmButton } from "./setup/ui.tsx";

/** What `useRowEditor` returns. `editing` and `copying` are never both set. */
export interface RowEditor<R> {
  /** Goes on the form element: Edit and Duplicate reveal it. */
  formRef: RevealFormRef;
  /** The row being edited. */
  editing: R | undefined;
  /** The row being duplicated: the form adds a new row that starts from it. */
  copying: R | undefined;
  edit: (row: R) => void;
  copy: (row: R) => void;
  /** Leaves Edit or Duplicate: Save, Cancel, and Delete of the row in the form call it. */
  stop: () => void;
}

export interface RowEditorOptions<R> {
  scope?: RevealScope;
  load?: (row: R, copying: boolean) => void;
  clear?: () => void;
}

/**
 * The state behind the Edit and Duplicate buttons of a list with a form. Each button picks the row,
 * lets `load` fill the form (`copying` tells it which button), drops the field errors with `clear`,
 * and reveals the form.
 */
export function useRowEditor<R>(options: RowEditorOptions<R>): RowEditor<R> {
  const { scope, load, clear } = options;
  const [editing, setEditing] = useState<R>();
  const [copying, setCopying] = useState<R>();
  const { formRef, reveal } = useRevealForm(scope);

  const start = (row: R, isCopy: boolean) => {
    setEditing(isCopy ? undefined : row);
    setCopying(isCopy ? row : undefined);
    load?.(row, isCopy);
    clear?.();
    reveal();
  };
  const stop = () => {
    setEditing(undefined);
    setCopying(undefined);
  };
  return {
    formRef,
    editing,
    copying,
    edit: (row) => start(row, false),
    copy: (row) => start(row, true),
    stop,
  };
}

/**
 * The cell of a table row with Edit, Duplicate and Delete. `noun` words the confirm button
 * ("Delete goal"); `before` adds buttons ahead of Edit; `editable` false leaves out Edit and Duplicate.
 */
export function RowActions<R>({
  row,
  editor,
  noun,
  onDelete,
  editable = true,
  before,
}: {
  row: R;
  editor: Pick<RowEditor<R>, "edit" | "copy">;
  noun: string;
  onDelete: () => void;
  editable?: boolean;
  before?: ReactNode;
}) {
  return (
    <td className="row-actions">
      {before}
      {editable ? (
        <>
          <button className="btn btn-quiet" type="button" onClick={() => editor.edit(row)}>
            Edit
          </button>
          <button className="btn btn-quiet" type="button" onClick={() => editor.copy(row)}>
            Duplicate
          </button>
        </>
      ) : null}
      <ConfirmButton label="Delete" confirmLabel={`Delete ${noun}`} apart onConfirm={onDelete} />
    </td>
  );
}

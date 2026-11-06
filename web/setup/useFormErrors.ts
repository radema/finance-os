import { useCallback, useEffect, useState } from "react";
import { type FieldErrors, mapServerError } from "../formErrors.ts";

/** Puts the focus on the first field the page marks invalid. */
function focusFirstInvalid(): void {
  const field = document.querySelector<HTMLElement>('[aria-invalid="true"]');
  field?.focus();
}

/**
 * The errors of a form: one message per field, and an Alert text for what names no field.
 * `reject` shows the client check and `fail` shows a server error; both focus the first bad field.
 * `clear(key)` drops one field's message when the user edits it. `labels` and `alias` are for `mapServerError`.
 */
export function useFormErrors<K extends string>(
  labels: Partial<Record<K, string>>,
  alias: Record<string, K> = {},
) {
  const [state, setState] = useState<{ fields: FieldErrors<K>; alert?: string }>({ fields: {} });
  const [focusTick, setFocusTick] = useState(0);

  // Wait for the render that marks the fields: the focus goes to a field that is already invalid.
  useEffect(() => {
    if (focusTick > 0) focusFirstInvalid();
  }, [focusTick]);

  const reject = useCallback((fields: FieldErrors<K>) => {
    setState({ fields });
    setFocusTick((tick) => tick + 1);
  }, []);
  const fail = useCallback(
    (failure: unknown) => {
      const text = failure instanceof Error ? failure.message : "Something went wrong.";
      setState(mapServerError(text, labels, alias));
      setFocusTick((tick) => tick + 1);
    },
    [labels, alias],
  );
  const clear = useCallback((key?: K) => {
    setState((now) => {
      if (key === undefined) return { fields: {} };
      if (now.fields[key] === undefined) return now;
      const { [key]: _gone, ...rest } = now.fields;
      return { ...now, fields: rest as FieldErrors<K> };
    });
  }, []);

  return { errors: state.fields, alert: state.alert, reject, fail, clear };
}

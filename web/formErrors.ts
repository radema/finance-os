import { num } from "./forms.ts";

/** One message per field, keyed by the key the form uses for the field. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** What a field needs: text, a number, or a number that may stay empty. */
export type Rule = "text" | "number" | "optionalNumber";

const NOT_A_NUMBER = "Enter a number";

const problemOf = (rule: Rule, text: string, label: string): string | undefined => {
  const empty = text.trim() === "";
  if (rule === "text") return empty ? `${label} is required` : undefined;
  if (rule === "optionalNumber" && empty) return undefined;
  return Number.isFinite(num(text)) ? undefined : NOT_A_NUMBER;
};

/** The client check of a form: the fields that fail their rule, each with a short message. */
export function checkFields<K extends string>(
  values: Record<NoInfer<K>, string>,
  rules: Partial<Record<K, Rule>>,
  labels: Readonly<Record<string, string>>,
): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const key of Object.keys(rules) as K[]) {
    const rule = rules[key];
    const problem = rule && problemOf(rule, values[key], labels[key] ?? key);
    if (problem) errors[key] = problem;
  }
  return errors;
}

const NOT_VALID = "Some values are not valid. Check the form and try again.";

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A validator message in plain words. The server's own wording stays when it is already plain. */
function plainIssue(label: string, message: string): string {
  if (/^Too small: expected string/.test(message)) return `${label} is required`;
  if (/^Too big: expected string/.test(message)) return "This is too long.";
  if (/^Invalid input: expected int,/.test(message)) return "Enter a whole number";
  if (/^Invalid input: expected number,/.test(message)) return NOT_A_NUMBER;
  if (/^Too small:/.test(message)) return "This value is too low.";
  if (/^Too big:/.test(message)) return "This value is too high.";
  if (/^Invalid option:/.test(message)) return "Choose one of the options.";
  if (/^Invalid string:/.test(message)) return "Check the format.";
  if (/^(Invalid|Too) /.test(message)) return "Check this value.";
  return capital(message.replace(/\.$/, ""));
}

/** The server's lead sentence of a refused body, and then `path: message` pieces. */
const LEAD = /^invalid (request|settings)$/;
const PIECE = /^([A-Za-z][\w.]*): ([\s\S]*)$/;

/**
 * Splits the text of a server error into messages for the fields of a form, and the rest for an Alert.
 *
 * `labels` names the fields the form shows. `alias` maps a field name of the API to the form's key,
 * where they differ. A path into a list (`events.2.year`) matches its last name. What names no field
 * of the form reaches the Alert in plain words, with no validator text and no code names.
 */
export function mapServerError<K extends string>(
  text: string,
  labels: Partial<Record<K, string>>,
  alias: Record<string, K> = {},
): { fields: FieldErrors<K>; alert: string | undefined } {
  const fields: FieldErrors<K> = {};
  const alerts: string[] = [];
  let refused = false;
  let unplaced = false;
  const pieces = text.split(/\.\s+(?=[A-Za-z][\w.]*: )/);
  for (const piece of pieces) {
    if (LEAD.test(piece.trim())) {
      refused = true;
      continue;
    }
    const named = PIECE.exec(piece.trim());
    const path = named?.[1]?.replace(/\.\d+(?=\.|$)/g, "");
    const last = path?.split(".").at(-1);
    const key = [path, last]
      .map((name) => (name === undefined ? undefined : (alias[name] ?? name)))
      .find((name): name is K => name !== undefined && name in labels);
    if (named && key !== undefined) {
      fields[key] ??= plainIssue(labels[key] as string, named[2] ?? "");
    } else if (named && refused) {
      // Validator text has no plain words without a field; a hand-written message keeps its own.
      const message = named[2] ?? "";
      if (/^(Invalid|Too) /.test(message)) unplaced = true;
      else alerts.push(plainIssue("", message));
    } else {
      alerts.push(piece.trim());
    }
  }
  if (unplaced || (refused && alerts.length === 0 && Object.keys(fields).length === 0)) {
    alerts.push(NOT_VALID);
  }
  return { fields, alert: alerts.length > 0 ? alerts.join(" ") : undefined };
}

/** The text for an Alert that has no fields of its own: a plain message, whatever the server sent. */
export const plainMessage = (text: string): string => mapServerError(text, {}).alert ?? text;

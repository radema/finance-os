import type { TemplateKind } from "../../engine/importTemplate.ts";
import { importTemplate } from "../../engine/importTemplate.ts";
import { download } from "../download.ts";

/** Downloads the CSV template of an import kind: the header row and one example row of made-up data. */
export function TemplateButton({ kind }: { kind: TemplateKind }) {
  return (
    <button
      className="btn"
      type="button"
      onClick={() => download(`gbi-${kind}-template.csv`, importTemplate(kind), "text/csv")}
    >
      Download CSV template
    </button>
  );
}

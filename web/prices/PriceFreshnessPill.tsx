import type { PriceAge } from "../../engine/priceAge.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";

/** Price freshness: a ring or a filled dot plus a word, so colour is never the only channel. */
export function PriceFreshnessPill({ age }: { age: PriceAge }) {
  return (
    <span className={`fresh ${age.old ? "fresh-old" : "fresh-current"}`}>
      {age.old ? (
        <TermPopover term="stale" note={age.reason}>
          Old price
        </TermPopover>
      ) : (
        "Current"
      )}
    </span>
  );
}

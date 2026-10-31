import type { PriceAge } from "../../engine/priceAge.ts";

/** Price freshness: a ring or a filled dot plus a word, so colour is never the only channel. */
export function PriceFreshnessPill({ age }: { age: PriceAge }) {
  return (
    <span className={`fresh ${age.old ? "fresh-old" : "fresh-current"}`} title={age.reason}>
      {age.old ? "Old price" : "Current"}
    </span>
  );
}

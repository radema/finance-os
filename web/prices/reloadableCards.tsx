import { MonthGrid } from "./MonthGrid.tsx";
import { OnlinePrices } from "./OnlinePrices.tsx";

/**
 * The two cards that load again when their counter bumps, as keyed elements. Both counters start at
 * 0 and bump together, so a bare number would give the siblings the same React key and leave a
 * stale copy of a card in the page. The name in each key keeps them apart.
 */
export function reloadableCards(props: {
  reviewKey: number;
  gridKey: number;
  onReviewChanged: () => void;
  onGridChanged: () => void;
}) {
  return [
    <OnlinePrices key={`review-${props.reviewKey}`} onChanged={props.onReviewChanged} />,
    <MonthGrid key={`grid-${props.gridKey}`} onChanged={props.onGridChanged} />,
  ];
}

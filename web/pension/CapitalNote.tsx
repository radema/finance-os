import { TermPopover } from "../glossary/TermPopover.tsx";
/** The pension capital/annuity note, shown on the Pension screen and on the pension goal's detail. */
export function CapitalNote() {
  return (
    <p className="note capital-note">
      Usually at most 50% of the pension pot can be taken as capital; the rest is paid as an
      annuity. A phased payout exists from 31 October 2026. The projection values the whole pot net
      of <TermPopover term="exitTax">exit tax</TermPopover>.
    </p>
  );
}

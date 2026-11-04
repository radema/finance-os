import { useMemo } from "react";
import type { PlanVsActualMonth } from "../../engine/planVsActual.ts";
import { formatEuro } from "../money.ts";
import { lineColour } from "./model.ts";
import { TimeChart } from "./TimeChart.tsx";

const centsAxis = (cents: number) => formatEuro(cents).replace(/,00/, "");

/** Cumulative planned against cumulative put in, month by month. Money in cents. `slot` null is the total. */
export function CumulativeChart({
  months,
  slot,
  label,
}: {
  months: readonly PlanVsActualMonth[];
  slot: number | null;
  label: string;
}) {
  const names = useMemo(() => months.map((m) => m.month), [months]);
  const series = useMemo(
    () => [
      {
        name: "Planned",
        data: months.map((m) => m.cumPlanned),
        colour: "--ctx",
        dashed: true,
        endLabel: true,
      },
      {
        name: "Put in",
        data: months.map((m) => m.cumActual),
        colour: lineColour(slot),
        endLabel: true,
      },
    ],
    [months, slot],
  );
  return <TimeChart months={names} series={series} format={centsAxis} label={label} />;
}

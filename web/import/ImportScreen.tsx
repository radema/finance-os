import { useEffect, useState } from "react";
import { useLoad } from "../api.ts";
import { hashParams } from "../hashQuery.ts";
import { CurrentPortfolioScreen } from "../operations/CurrentPortfolioScreen.tsx";
import { CsvImport } from "../prices/CsvImport.tsx";
import { PastImports } from "./PastImports.tsx";
import { RecordImport } from "./RecordImport.tsx";
import { TransactionsImport } from "./TransactionsImport.tsx";
import type { BatchRow } from "./types.ts";

const TABS = [
  { key: "transactions", label: "Transactions" },
  { key: "prices", label: "Prices" },
  { key: "products", label: "Products" },
  { key: "goals", label: "Goals" },
  { key: "portfolio", label: "Current portfolio" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const tabFromHash = (): TabKey =>
  TABS.find((tab) => tab.key === hashParams().get("tab"))?.key ?? "transactions";

/** Operations > Import: one tab per kind of file, the Current portfolio form, and the past imports. */
export function ImportScreen() {
  const [tab, setTab] = useState<TabKey>(tabFromHash);
  const batches = useLoad<BatchRow[]>("/api/import/batches");

  // A link to `?tab=portfolio` while this screen is open changes the tab, not the route.
  useEffect(() => {
    const onChange = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return (
    <>
      <div className="tag">Operations</div>
      <h1 className="title">Import</h1>
      <div className="tabs" role="tablist" aria-label="Import">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "transactions" ? <TransactionsImport onImported={batches.reload} /> : null}
      {tab === "prices" ? <CsvImport onImported={batches.reload} /> : null}
      {tab === "products" || tab === "goals" ? (
        <RecordImport key={tab} kind={tab} onImported={batches.reload} />
      ) : null}
      {tab === "portfolio" ? <CurrentPortfolioScreen /> : null}

      <PastImports batches={batches} />
    </>
  );
}

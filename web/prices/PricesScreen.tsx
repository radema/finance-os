import { useState } from "react";
import { canUseProvider, PRICE_SOURCES } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { formatUnitPrice } from "../money.ts";
import { Alert, Card, ProductTag, Resource } from "../setup/ui.tsx";
import { CsvImport } from "./CsvImport.tsx";
import { MonthGrid } from "./MonthGrid.tsx";
import { Positions } from "./Positions.tsx";
import { PriceFreshnessPill } from "./PriceFreshnessPill.tsx";
import type { PriceOverviewRow, PriceSource } from "./types.ts";

const SOURCE_LABEL: Record<PriceSource, string> = {
  provider: "Provider",
  csv: "CSV",
  manual: "Manual",
};

/** Operations > Prices: source and last price per product, month-end grid, CSV import, positions. */
export function PricesScreen() {
  const overview = useLoad<PriceOverviewRow[]>("/api/prices/overview");
  // A bump of this key makes the grid load again after an import or a typed price.
  const [gridKey, setGridKey] = useState(0);
  const [error, setError] = useState<string>();

  const setSource = async (productId: string, priceSource: string) => {
    try {
      await api("PUT", "/api/prices/source", { body: { productId, priceSource } });
      setError(undefined);
      overview.reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const changed = () => {
    overview.reload();
    setGridKey((key) => key + 1);
  };

  return (
    <>
      <div className="tag">Operations</div>
      <h1 className="title">Prices</h1>

      <Card title="Price source per product">
        <Resource loaded={overview}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="note">No products yet. Add a product in Setup first.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Source</th>
                      <th className="num">Last price</th>
                      <th>Price date</th>
                      <th>Freshness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.productId}>
                        <td>
                          {row.name} <ProductTag regime={row.regime} />
                        </td>
                        <td>
                          <select
                            aria-label={`Source of ${row.name}`}
                            value={row.priceSource}
                            onChange={(event) => void setSource(row.productId, event.target.value)}
                          >
                            {PRICE_SOURCES.filter(
                              (source) => source !== "provider" || canUseProvider(row.regime),
                            ).map((source) => (
                              <option key={source} value={source}>
                                {SOURCE_LABEL[source]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          {row.lastPrice ? formatUnitPrice(row.lastPrice.price) : "No price"}
                        </td>
                        <td>{row.lastPrice?.priceDate ?? "–"}</td>
                        <td>
                          <PriceFreshnessPill age={row.age} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Resource>
        <Alert message={error} />
      </Card>

      <MonthGrid key={gridKey} onChanged={overview.reload} />
      <CsvImport onImported={changed} />
      <Resource loaded={overview}>
        {(rows) => <Positions products={rows} onSaved={overview.reload} />}
      </Resource>
    </>
  );
}

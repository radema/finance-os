import { useState } from "react";
import { api, messageOf, useLoad } from "../api.ts";
import { formatPrice } from "../money.ts";
import { Alert, Card, Resource } from "../setup/ui.tsx";
import type { FetchResult, ReviewItem, ReviewState } from "./types.ts";

const REASON_LABEL: Record<ReviewItem["reason"], string> = {
  "non-eur": "Not in EUR",
  "move-above-25": "Moved more than 25%",
};

/** Fetch latest prices, the fetch problems and the review list of held-back prices. */
export function OnlinePrices({ onChanged }: { onChanged: () => void }) {
  const review = useLoad<ReviewState>("/api/prices/review");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string>();
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
    review.reload();
    onChanged();
  };
  const fetchAll = () =>
    run(async () => {
      const done = await api<FetchResult>("POST", "/api/prices/fetch", { body: {} });
      setSummary(
        `Stored ${done.stored.length}, held for review ${done.reviewed.length}, problems ${done.problems.length}.`,
      );
    });
  const decide = (item: ReviewItem, decision: "accept" | "discard") =>
    run(async () => {
      await api("POST", `/api/prices/review/${decision}`, { body: { id: item.id } });
    });

  return (
    <Card
      title="Online prices"
      note="Fetches the latest close of every product whose source is Provider. A price in another currency, or one that moved more than 25% from last month, waits here until you accept or discard it."
    >
      <button className="btn btn-primary" type="button" disabled={busy} onClick={fetchAll}>
        {busy ? "Fetching..." : "Fetch latest prices"}
      </button>
      {summary ? <p className="note">{summary}</p> : null}
      <Alert message={error} />
      <Resource loaded={review}>
        {({ items, errors }) => (
          <>
            {errors.length > 0 ? (
              <div className="alert" role="alert">
                <p>Fetch failed for:</p>
                <ul>
                  {errors.map(({ productId, productName, message }) => (
                    <li key={productId}>
                      {productName}: {message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {items.length === 0 ? (
              <p className="note">No price is waiting for review.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Ticker</th>
                      <th>Date</th>
                      <th className="num">Price</th>
                      <th>Currency</th>
                      <th>Reason</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.productName}</td>
                        <td>{item.ticker}</td>
                        <td>{item.date}</td>
                        <td className="num">{formatPrice(item.price)}</td>
                        <td>{item.currency}</td>
                        <td>{REASON_LABEL[item.reason]}</td>
                        <td>
                          <button
                            className="btn"
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(item, "accept")}
                          >
                            Accept
                          </button>{" "}
                          <button
                            className="btn btn-quiet"
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(item, "discard")}
                          >
                            Discard
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Resource>
    </Card>
  );
}

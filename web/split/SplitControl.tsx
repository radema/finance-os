import type { CSSProperties } from "react";
import { useState } from "react";
import type { ConfirmedSplit } from "../../engine/split.ts";
import { confirmSplit } from "../../engine/split.ts";
import { formatEuro } from "../money.ts";
import { Card, NumberField, ProductTag, SelectField } from "../setup/ui.tsx";
import { type Bucket, type Choice, propose, type SplitMode } from "./splitState.ts";

const MODES: readonly { mode: SplitMode; label: string }[] = [
  { mode: "one", label: "One bucket" },
  { mode: "weights", label: "By weights" },
  { mode: "units", label: "By units" },
];

/** A goal chip that is not a link: a dot in the goal's slot colour on its tint. */
function BucketChip({ bucket }: { bucket: Bucket }) {
  const style = {
    "--slot": `var(--slot${bucket.slot})`,
    "--tint": `var(--tint${bucket.slot})`,
  } as CSSProperties;
  return (
    <span className="chip" style={style}>
      <span className="chip-dot" />
      {bucket.name}
    </span>
  );
}

const unitsText = (units: number): string => `${units} unit${units === 1 ? "" : "s"}`;

/**
 * Splits one broker row over buckets: one bucket, by weights, or by units typed by the user.
 * It shows the units left to assign and calls `onConfirm` only when the user presses Confirm.
 * Weights mode uses the buckets whose `weight` is above 0.
 */
export function SplitControl({
  product,
  totalUnits,
  buckets,
  commissionCents = 0,
  onConfirm,
}: {
  product: { name: string; regime?: string };
  totalUnits: number;
  buckets: readonly Bucket[];
  commissionCents?: number;
  onConfirm: (split: ConfirmedSplit) => void;
}) {
  const [choice, setChoice] = useState<Choice>({ oneGoalId: "", typed: {} });
  const [confirmed, setConfirmed] = useState<ConfirmedSplit>();
  const proposal = propose(totalUnits, commissionCents, buckets, choice);
  const nameOf = (goalId: string) => buckets.find((b) => b.goalId === goalId);
  const hasWeights = buckets.some((b) => (b.weight ?? 0) > 0);

  const title = `Split ${product.name}`;
  if (confirmed) {
    return (
      <Card title={title}>
        <p className="split-status" role="status">
          Confirmed: {unitsText(totalUnits)} over {confirmed.parts.length}{" "}
          {confirmed.parts.length === 1 ? "bucket" : "buckets"}.
        </p>
        <ul className="split-parts">
          {confirmed.parts.map((part) => {
            const bucket = nameOf(part.goalId);
            return (
              <li key={part.goalId}>
                {bucket ? <BucketChip bucket={bucket} /> : part.goalId}
                <span>{unitsText(part.units)}</span>
                {commissionCents > 0 ? <span>{formatEuro(part.commissionCents)}</span> : null}
              </li>
            );
          })}
        </ul>
        <div className="actions">
          <button className="btn btn-quiet" type="button" onClick={() => setConfirmed(undefined)}>
            Change
          </button>
        </div>
      </Card>
    );
  }

  const preview = proposal.status === "ready" ? proposal.plan.units : [];
  const previewUnits = (goalId: string) => preview.find((p) => p.goalId === goalId)?.units ?? 0;

  return (
    <Card title={title}>
      <p className="split-head">
        {product.regime ? <ProductTag regime={product.regime} /> : null}
        <span>{unitsText(totalUnits)} to assign</span>
      </p>
      <div className="actions">
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            className={choice.mode === mode ? "btn btn-primary" : "btn"}
            type="button"
            aria-pressed={choice.mode === mode}
            disabled={mode === "weights" && !hasWeights}
            onClick={() => setChoice({ ...choice, mode })}
          >
            {label}
          </button>
        ))}
      </div>
      {hasWeights ? null : <p className="note">No bucket has a weight for this product.</p>}

      {choice.mode === "one" ? (
        <SelectField
          label="Bucket"
          value={choice.oneGoalId}
          onChange={(oneGoalId) => setChoice({ ...choice, oneGoalId })}
          options={[
            { value: "", label: "Choose a bucket" },
            ...buckets.map((b) => ({ value: b.goalId, label: b.name })),
          ]}
        />
      ) : null}

      {choice.mode === "weights" ? (
        <ul className="split-parts">
          {buckets
            .filter((b) => (b.weight ?? 0) > 0)
            .map((bucket) => (
              <li key={bucket.goalId}>
                <BucketChip bucket={bucket} />
                <span>weight {bucket.weight}</span>
                <span>{unitsText(previewUnits(bucket.goalId))}</span>
              </li>
            ))}
        </ul>
      ) : null}

      {choice.mode === "units" ? (
        <div className="split-inputs">
          {buckets.map((bucket) => (
            <div className="split-row" key={bucket.goalId}>
              <BucketChip bucket={bucket} />
              <NumberField
                label={`Units for ${bucket.name}`}
                value={choice.typed[bucket.goalId] ?? ""}
                onChange={(text) =>
                  setChoice({ ...choice, typed: { ...choice.typed, [bucket.goalId]: text } })
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      {proposal.status === "ready" && commissionCents > 0 ? (
        <p className="note">
          Commission {formatEuro(commissionCents)}, split in proportion to the units.
        </p>
      ) : null}

      <p
        className={proposal.status === "invalid" ? "alert" : "split-status"}
        role={proposal.status === "invalid" ? "alert" : "status"}
      >
        {proposal.status === "nothing" ? "Choose how to split the units." : null}
        {proposal.status === "incomplete"
          ? `${unitsText(proposal.remaining)} left to assign.`
          : null}
        {proposal.status === "invalid" ? proposal.message : null}
        {proposal.status === "ready" ? `All ${unitsText(totalUnits)} assigned.` : null}
      </p>

      <div className="actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={proposal.status !== "ready"}
          onClick={() => {
            if (proposal.status !== "ready") return;
            const split = confirmSplit(proposal.plan);
            setConfirmed(split);
            onConfirm(split);
          }}
        >
          Confirm split
        </button>
      </div>
    </Card>
  );
}

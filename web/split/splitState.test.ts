import { describe, expect, it } from "vitest";
import { type Bucket, type Choice, propose } from "./splitState.ts";

const buckets: Bucket[] = [
  { goalId: "A", name: "Home", slot: 1, weight: 50 },
  { goalId: "B", name: "Retire", slot: 2, weight: 30 },
  { goalId: "C", name: "Car", slot: 3, weight: 0 },
];
const choice = (c: Partial<Choice>): Choice => ({ oneGoalId: "", typed: {}, ...c });

describe("propose", () => {
  it("is 'nothing' until a mode is chosen", () => {
    expect(propose(10, 0, buckets, choice({}))).toEqual({ status: "nothing" });
  });

  it("one bucket: incomplete until a bucket is picked, then ready with all the units", () => {
    expect(propose(10, 0, buckets, choice({ mode: "one" }))).toEqual({
      status: "incomplete",
      remaining: 10,
    });
    const result = propose(10, 295, buckets, choice({ mode: "one", oneGoalId: "B" }));
    expect(result).toEqual({
      status: "ready",
      plan: { totalUnits: 10, commissionCents: 295, units: [{ goalId: "B", units: 10 }] },
    });
  });

  it("by weights: ready, using only the buckets with a weight above 0", () => {
    const result = propose(8, 0, buckets, choice({ mode: "weights" }));
    // 8 over 50:30 -> 5 and 3
    expect(result).toMatchObject({
      status: "ready",
      plan: {
        units: [
          { goalId: "A", units: 5 },
          { goalId: "B", units: 3 },
        ],
      },
    });
  });

  it("by weights: invalid, with the reason, for a quantity that is not whole", () => {
    const result = propose(2.5, 0, buckets, choice({ mode: "weights" }));
    expect(result).toMatchObject({ status: "invalid", message: expect.stringMatching(/whole/) });
  });

  it("by units: incomplete with the units left, invalid with the excess, ready when exact", () => {
    const typed = (a: string, b: string) => choice({ mode: "units", typed: { A: a, B: b } });
    expect(propose(10, 0, buckets, typed("6", "3"))).toEqual({
      status: "incomplete",
      remaining: 1,
    });
    expect(propose(10, 0, buckets, typed("", ""))).toEqual({ status: "incomplete", remaining: 10 });
    expect(propose(10, 0, buckets, typed("6", "5"))).toMatchObject({
      status: "invalid",
      message: expect.stringMatching(/1 unit too many/),
    });
    expect(propose(10, 0, buckets, typed("6", "4"))).toMatchObject({ status: "ready" });
  });

  it("by units: invalid for text that is not a number or is negative", () => {
    const typed = (a: string) => choice({ mode: "units", typed: { A: a } });
    expect(propose(10, 0, buckets, typed("abc")).status).toBe("invalid");
    expect(propose(10, 0, buckets, typed("-1")).status).toBe("invalid");
  });
});

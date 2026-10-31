import { describe, expect, it } from "vitest";
import { goalStatus, requiredProbability } from "./goalStatus.ts";

const required = { need: 0.9, want: 0.75, wish: 0.5 };

describe("requiredProbability (AC-58)", () => {
  it("takes the priority default: Need 90, Want 75, Wish 50", () => {
    expect(requiredProbability({ priority: "Need", minProb: null }, required)).toBe(0.9);
    expect(requiredProbability({ priority: "Want", minProb: null }, required)).toBe(0.75);
    expect(requiredProbability({ priority: "Wish", minProb: null }, required)).toBe(0.5);
  });

  it("lets the goal's minProb override the priority default", () => {
    expect(requiredProbability({ priority: "Need", minProb: 0.6 }, required)).toBe(0.6);
    expect(requiredProbability({ priority: "Wish", minProb: 0 }, required)).toBe(0);
  });
});

describe("goalStatus (AC-58)", () => {
  it("is on track when P is at or above the required probability", () => {
    expect(goalStatus(0.9, 0.9, 15)).toBe("on_track");
    expect(goalStatus(1, 0.9, 15)).toBe("on_track");
  });

  it("is at risk when P is within 15 points below the required probability", () => {
    expect(goalStatus(0.89, 0.9, 15)).toBe("at_risk");
    expect(goalStatus(0.76, 0.9, 15)).toBe("at_risk");
  });

  it("counts the exact 15-point boundary as at risk", () => {
    expect(goalStatus(0.75, 0.9, 15)).toBe("at_risk");
    // 600 successes out of 1,000 paths against Want 75%: the float gap is not exactly 0.15.
    expect(goalStatus(0.6, 0.75, 15)).toBe("at_risk");
  });

  it("is off track more than 15 points below", () => {
    expect(goalStatus(0.74, 0.9, 15)).toBe("off_track");
    expect(goalStatus(0, 0.5, 15)).toBe("off_track");
  });

  it("reads the band from its argument", () => {
    expect(goalStatus(0.7, 0.9, 20)).toBe("at_risk");
    expect(goalStatus(0.7, 0.9, 10)).toBe("off_track");
    expect(goalStatus(0.89, 0.9, 0)).toBe("off_track");
  });
});

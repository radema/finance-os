import { describe, expect, it } from "vitest";
import { horizonText, pVsRequired, requiredText, statusLabel, usesSlotLine } from "./outlook.ts";

// it-IT puts a no-break space before the euro sign, so the tests compare with it normalised.
const plain = (text: string) => text.replace(/ /g, " ");

describe("statusLabel", () => {
  it("names the three statuses in words", () => {
    expect(statusLabel("on_track")).toBe("On track");
    expect(statusLabel("at_risk")).toBe("At risk");
    expect(statusLabel("off_track")).toBe("Off track");
  });
});

describe("pVsRequired", () => {
  it("puts P against the required probability, in percent", () => {
    expect(pVsRequired(0.846, 0.9)).toBe("84,6% vs 90% required");
  });
});

describe("requiredText", () => {
  it("says not reachable when the engine gives null", () => {
    expect(requiredText(null, "monthly")).toBe("not reachable");
    expect(requiredText(null, "schedule")).toBe("not reachable");
  });

  it("gives a monthly amount in euros", () => {
    expect(plain(requiredText(412.5, "monthly"))).toBe("412,50 € a month");
  });

  it("says no contribution is needed for 0", () => {
    expect(requiredText(0, "monthly")).toBe("no contribution needed");
  });

  it("gives the pension goal's answer as a multiple of its schedule", () => {
    expect(requiredText(1.3456, "schedule")).toBe("1,35 times the current schedule");
  });
});

describe("horizonText", () => {
  it("gives years with one decimal, or months under a year", () => {
    expect(horizonText(9.75)).toBe("9,8 years");
    expect(horizonText(1)).toBe("1 year");
    expect(horizonText(2 / 12)).toBe("2 months");
    expect(horizonText(0)).toBe("now");
  });
});

describe("usesSlotLine", () => {
  it("allows slots 1, 2 and 5 for lines, and no other", () => {
    expect([1, 2, 3, 4, 5, 6].filter(usesSlotLine)).toEqual([2, 5]);
  });
});

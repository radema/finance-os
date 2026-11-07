import { describe, expect, it } from "vitest";
import { checkFields, mapServerError, plainMessage } from "./formErrors.ts";

const LABELS = {
  name: "Name",
  expReturn: "Expected return",
  volatility: "Volatility",
  ter: "TER",
  target: "Target",
  maturity: "Maturity",
};

describe("checkFields", () => {
  it("asks for an empty name and an empty number, each at its own field", () => {
    const errors = checkFields(
      { name: "  ", expReturn: "" },
      { name: "text", expReturn: "number" },
      LABELS,
    );
    expect(errors).toEqual({ name: "Name is required", expReturn: "Enter a number" });
  });

  it("accepts good values", () => {
    expect(
      checkFields(
        { name: "VWCE", expReturn: "5.5" },
        { name: "text", expReturn: "number" },
        LABELS,
      ),
    ).toEqual({});
  });

  it("refuses text that is not a number", () => {
    expect(checkFields({ ter: "abc" }, { ter: "number" }, LABELS)).toEqual({
      ter: "Enter a number",
    });
  });

  it("lets an optional number stay empty and still refuses a bad one", () => {
    expect(checkFields({ ter: "" }, { ter: "optionalNumber" }, LABELS)).toEqual({});
    expect(checkFields({ ter: "x" }, { ter: "optionalNumber" }, LABELS)).toEqual({
      ter: "Enter a number",
    });
  });
});

describe("mapServerError", () => {
  const RAW =
    "invalid request. name: Too small: expected string to have >=1 characters. " +
    "expReturn: Invalid input: expected number, received null. " +
    "volatility: Invalid input: expected number, received null. " +
    "ter: Invalid input: expected number, received null";

  it("puts each message that names a field at that field, in plain words", () => {
    const { fields, alert } = mapServerError(RAW, LABELS);
    expect(fields).toEqual({
      name: "Name is required",
      expReturn: "Enter a number",
      volatility: "Enter a number",
      ter: "Enter a number",
    });
    expect(alert).toBeUndefined();
  });

  it("shows no validator text and no code name when a field has no place on the form", () => {
    const { fields, alert } = mapServerError(
      "invalid request. expReturn: Invalid input: expected number, received null",
      { name: "Name" },
    );
    expect(fields).toEqual({});
    expect(alert).toBe("Some values are not valid. Check the form and try again.");
  });

  it("maps an API field name to the form's own key", () => {
    const { fields } = mapServerError(
      "invalid request. targetCents: Invalid input: expected number, received null",
      LABELS,
      { targetCents: "target" },
    );
    expect(fields).toEqual({ target: "Enter a number" });
  });

  it("finds a field inside a list item", () => {
    const { fields } = mapServerError(
      "invalid request. events.2.year: Too small: expected number to be >=2000",
      { year: "Year" },
    );
    expect(fields).toEqual({ year: "This value is too low." });
  });

  it("turns range, option and pattern messages into plain words", () => {
    const { fields } = mapServerError(
      "invalid request. ter: Too big: expected number to be <=1. " +
        'name: Invalid option: expected one of "a"|"b". ' +
        "maturity: Invalid string: must match pattern /^x$/",
      LABELS,
    );
    expect(fields).toEqual({
      ter: "This value is too high.",
      name: "Choose one of the options.",
      maturity: "Check the format.",
    });
  });

  it("keeps a plain server message that names a field, with a capital", () => {
    expect(mapServerError("price: must be above 0", { price: "Price" }).fields).toEqual({
      price: "Must be above 0",
    });
  });

  it("keeps a hand-written message of an unplaced path, without the path", () => {
    const { fields, alert } = mapServerError(
      "invalid request. positions.0.parts: the parts must add up to the total units",
      { name: "Name" },
    );
    expect(fields).toEqual({});
    expect(alert).toBe("The parts must add up to the total units");
  });

  it("passes a plain server message that names no field to the alert", () => {
    const text = "This goal has 2 transaction(s). Delete or move them first.";
    expect(mapServerError(text, LABELS)).toEqual({ fields: {}, alert: text });
  });
});

describe("plainMessage", () => {
  it("cleans a validator message for an Alert that has no fields", () => {
    const text = plainMessage(
      "invalid request. name: Too small: expected string to have >=1 characters",
    );
    expect(text).toBe("Some values are not valid. Check the form and try again.");
  });

  it("leaves a plain message as it is", () => {
    expect(plainMessage("The server did not answer. Is gbi still running?")).toBe(
      "The server did not answer. Is gbi still running?",
    );
  });
});

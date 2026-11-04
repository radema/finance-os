import { describe, expect, it } from "vitest";
import type { Transaction } from "../../engine/schemas.ts";
import { fieldsFromTransaction, transactionBody } from "./transactionForm.ts";

const buy: Transaction = {
  id: "t1",
  date: "2026-03-15",
  goalId: "g1",
  productId: "p1",
  type: "buy",
  amountCents: 150_050,
  price: 98.4,
  commissionCents: 295,
  qty: 15.2,
  note: "",
};

describe("transaction form", () => {
  it("prefills the form with the row's date, bucket, product, type, amount, price and fee", () => {
    expect(fieldsFromTransaction(buy)).toEqual({
      date: "2026-03-15",
      goalId: "g1",
      productId: "p1",
      type: "buy",
      amount: "1500.5",
      price: "98.4",
      fee: "2.95",
      flow: "",
    });
  });

  it("builds the API body back from the prefilled fields", () => {
    expect(transactionBody(fieldsFromTransaction(buy), false)).toEqual({
      date: "2026-03-15",
      goalId: "g1",
      productId: "p1",
      type: "buy",
      amountCents: 150_050,
      price: 98.4,
      commissionCents: 295,
      flow: undefined,
    });
  });

  it("keeps a recorded fee of zero, and an empty fee means none", () => {
    expect(fieldsFromTransaction({ ...buy, commissionCents: 0 }).fee).toBe("0");
    expect(fieldsFromTransaction({ ...buy, commissionCents: null }).fee).toBe("");
    expect(
      transactionBody({ ...fieldsFromTransaction(buy), fee: "" }, false).commissionCents,
    ).toBeNull();
  });

  it("prefills the flow of a pension contribution and sends it only when the fund takes both", () => {
    const pension: Transaction = { ...buy, type: "pensionContribution", flow: "Voluntary" };
    const fields = fieldsFromTransaction(pension);
    expect(fields.flow).toBe("Voluntary");
    expect(transactionBody(fields, true).flow).toBe("Voluntary");
    expect(transactionBody(fields, false).flow).toBeUndefined();
  });

  it("sends price 0 for a coupon", () => {
    const coupon: Transaction = { ...buy, type: "coupon", price: 0, qty: 0 };
    expect(transactionBody(fieldsFromTransaction(coupon), false).price).toBe(0);
  });
});

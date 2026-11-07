import type { TransactionType } from "../../engine/holdings.ts";
import type { Transaction } from "../../engine/schemas.ts";
import { centsToEuros, eurosToCents, num } from "../forms.ts";
import { formatEuro } from "../money.ts";

/** What the user sees in the transaction form: every value is text. */
export interface TransactionFields {
  date: string;
  goalId: string;
  productId: string;
  type: TransactionType;
  amount: string;
  price: string;
  fee: string;
  flow: string;
}

/** The form of an existing row, for edit. */
export const fieldsFromTransaction = (t: Transaction): TransactionFields => ({
  date: t.date,
  goalId: t.goalId,
  productId: t.productId,
  type: t.type,
  amount: centsToEuros(t.amountCents),
  price: String(t.price),
  fee: t.commissionCents === null ? "" : centsToEuros(t.commissionCents),
  flow: t.flow ?? "",
});

/**
 * The API body for add and edit. A fund that takes both flows needs the user's choice; with one
 * flow the server picks it.
 */
export const transactionBody = (fields: TransactionFields, takesBothFlows: boolean) => ({
  date: fields.date,
  goalId: fields.goalId,
  productId: fields.productId,
  type: fields.type,
  amountCents: eurosToCents(fields.amount),
  price: fields.type === "coupon" ? 0 : num(fields.price),
  commissionCents: fields.fee.trim() === "" ? null : eurosToCents(fields.fee),
  flow: takesBothFlows && fields.flow !== "" ? fields.flow : undefined,
});

const CASH_SIGN: Partial<Record<TransactionType, "-" | "+">> = {
  buy: "-",
  pensionContribution: "-",
  sell: "+",
  coupon: "+",
};

/** The amount of a row as a cash movement: a buy or a pension contribution is cash out. */
export const cashMovement = (type: TransactionType, amountCents: number): string =>
  `${CASH_SIGN[type] ?? ""}${formatEuro(amountCents)}`;

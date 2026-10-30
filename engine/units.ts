// Integer storage units. Money is integer cents; units and prices are integers scaled by 10^6.
// Conversion to float happens only when data goes to the engine; rounding only in the view.

const CENTS_PER_EURO = 100;
const SCALE = 1_000_000;

// Math.round sends -x.5 towards +infinity; quantities are signed, so round half away from zero.
const roundHalfAway = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

/** Euros to integer cents. */
export const toCents = (euros: number): number => roundHalfAway(euros * CENTS_PER_EURO);

/** Integer cents to euros. */
export const fromCents = (cents: number): number => cents / CENTS_PER_EURO;

/** A unit count or a price to its integer, scaled by 10^6. */
export const toScaled = (value: number): number => roundHalfAway(value * SCALE);

/** A scaled integer back to a unit count or a price. */
export const fromScaled = (scaled: number): number => scaled / SCALE;

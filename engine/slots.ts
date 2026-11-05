const FIRST_SLOT = 2;
const LAST_SLOT = 6;
/** The neutral grey slot for goal 6 and later. */
export const GREY_SLOT = 7;

/**
 * The colour slot of a goal. Goals 1 to 5 take slots 2 to 6 in creation order. Slot 1 (the highlight)
 * is kept for the message, so no goal uses it. Goal 6 and later share the neutral grey slot 7.
 *
 * @param goal The goal to colour.
 * @param goals Every goal, in creation order.
 */
export function goalSlot(goal: { id: string }, goals: readonly { id: string }[]): number {
  const position = Math.max(
    0,
    goals.findIndex(({ id }) => id === goal.id),
  );
  const slot = FIRST_SLOT + position;
  return slot > LAST_SLOT ? GREY_SLOT : slot;
}

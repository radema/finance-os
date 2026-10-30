const SLOT_COUNT = 6;
const PENSION_SLOT = 1;
const FIRST_OTHER_SLOT = 2;

/**
 * The colour slot (1..6) of a goal. The pension goal takes slot 1; the other goals take slots 2 to 6 in
 * creation order and then repeat (past six goals the colours repeat: S7 settles that). The
 * emergency-fund slot 6 is not reserved in S1.
 *
 * @param goal The goal to colour.
 * @param goals Every goal, in creation order.
 * @param pensionGoalId The goal in the pension plan document, if one is set.
 */
export function goalSlot(
  goal: { id: string },
  goals: readonly { id: string }[],
  pensionGoalId?: string,
): number {
  if (goal.id === pensionGoalId) return PENSION_SLOT;
  const others = goals.filter(({ id }) => id !== pensionGoalId);
  const position = Math.max(
    0,
    others.findIndex(({ id }) => id === goal.id),
  );
  return FIRST_OTHER_SLOT + (position % (SLOT_COUNT - FIRST_OTHER_SLOT + 1));
}

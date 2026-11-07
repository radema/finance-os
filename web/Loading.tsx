/** The one loading state: a box of reserved height, so the page does not jump when data arrives. */
export function Loading() {
  return (
    <div className="state-box" role="status">
      <p className="note">Loading…</p>
    </div>
  );
}

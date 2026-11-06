import type { ReactNode } from "react";

/** What the user does next: a link to the screen that fixes it, or a button that does it here. */
export type EmptyAction = { label: string; href: string } | { label: string; onClick: () => void };

/** The one empty state of a card or chart: a short sentence and at most one action. No empty frame or axes. */
export function EmptyState({ message, action }: { message: ReactNode; action?: EmptyAction }) {
  return (
    <div className="empty-state">
      <p className="note">{message}</p>
      {action ? (
        "href" in action ? (
          <a className="btn empty-state-action" href={action.href}>
            {action.label}
          </a>
        ) : (
          <button className="btn empty-state-action" type="button" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}

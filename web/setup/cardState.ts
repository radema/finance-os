/** The part of `Storage` the card memory uses. */
export interface CardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "gbi.card.";
const CLOSED = "closed";

/** The memory key of a card: the screen (the hash route, without its query) and the card's name. */
export function cardKey(hash: string, name: string): string {
  const route = hash.replace(/^#\/?/, "").split("?")[0];
  return `${PREFIX}${route}/${name}`;
}

/** The browser's storage, or undefined when there is none (server render) or it is blocked. */
export function browserStorage(): CardStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The hash of the current screen; empty on the server. */
export const screenHash = (): string => (typeof window === "undefined" ? "" : window.location.hash);

/** A card is open unless the user closed it. A missing or blocked storage, or no key, means open. */
export function readOpen(storage: CardStorage | undefined, key: string | undefined): boolean {
  try {
    return key === undefined || storage?.getItem(key) !== CLOSED;
  } catch {
    return true;
  }
}

/** Remembers a closed card; an open card is the default, so it leaves no entry. */
export function writeOpen(storage: CardStorage | undefined, key: string, open: boolean): void {
  try {
    if (open) storage?.removeItem(key);
    else storage?.setItem(key, CLOSED);
  } catch {
    // The state still holds for this visit.
  }
}

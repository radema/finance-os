const STORAGE_KEY = "gbi.sidebar.collapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Storage can be unavailable, for example in a restricted browser context.
  }
}

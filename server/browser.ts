import { spawn } from "node:child_process";

const OPENERS: Partial<Record<NodeJS.Platform, string>> = { darwin: "open", linux: "xdg-open" };

/**
 * Opens `url` in the default browser.
 *
 * @returns `false` when the platform has no known opener or the opener cannot start.
 */
export function openBrowser(url: string): Promise<boolean> {
  const opener = OPENERS[process.platform];
  if (!opener) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(opener, [url], { stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

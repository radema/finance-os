import { describe, expect, it } from "vitest";
import { isCloudSyncedPath } from "./dataFolder.ts";

describe("isCloudSyncedPath", () => {
  it.each([
    "/Users/raul/Library/Mobile Documents/com~apple~CloudDocs/gbi",
    "/Users/raul/Library/Mobile Documents/iCloud~md~obsidian/Documents/gbi",
    "/Users/raul/iCloud Drive/gbi",
    "/Users/raul/Dropbox/gbi",
    "/Users/raul/Dropbox (Personal)/gbi",
    "/Users/raul/Library/CloudStorage/Dropbox/gbi",
    "/Users/raul/OneDrive/gbi",
    "/Users/raul/OneDrive - Acme/gbi",
    "/Users/raul/Library/CloudStorage/GoogleDrive-raul@example.com/My Drive/gbi",
    "/Users/raul/Google Drive/gbi",
    "C:\\Users\\raul\\OneDrive\\gbi",
  ])("flags %s", (path) => {
    expect(isCloudSyncedPath(path)).toBe(true);
  });

  it.each([
    "/Users/raul/Library/Application Support/gbi",
    "/home/raul/.local/share/gbi",
    "/tmp/gbi-server-abc123",
    "/Users/raul/Documents/dropbox-export-notes/gbi",
  ])("does not flag %s", (path) => {
    expect(isCloudSyncedPath(path)).toBe(false);
  });
});

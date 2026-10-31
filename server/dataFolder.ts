// One folder name per provider, as the desktop clients create them: "Dropbox", "Dropbox (Personal)",
// "OneDrive", "OneDrive - Acme", "OneDrive-Personal", "Google Drive", "GoogleDrive-<account>",
// "iCloud Drive". iCloud Drive itself lives under `Library/Mobile Documents/`.
const CLOUD_FOLDER =
  /^(dropbox( \(.+\))?|onedrive([ -].*)?|google ?drive(-.*)?|icloud ?drive|mobile documents)$/i;

/**
 * Tells whether a path sits inside a cloud-synced folder (iCloud Drive, Dropbox, OneDrive, Google
 * Drive). Sync clients can corrupt a SQLite file, so the app warns about it.
 *
 * @param path Absolute path of the data folder, with `/` or `\` separators.
 */
export const isCloudSyncedPath = (path: string): boolean =>
  path.split(/[\\/]/).some((segment) => CLOUD_FOLDER.test(segment));

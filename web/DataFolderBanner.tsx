import { useLoad } from "./api.ts";

interface DataFolder {
  path: string;
  cloudSynced: boolean;
}

/** A notice at the top of the app when the data folder is cloud-synced. It never blocks the app. */
export function DataFolderBanner() {
  const { data } = useLoad<DataFolder>("/api/data/folder");
  if (!data?.cloudSynced) return null;
  return (
    <p className="alert" role="status">
      The data folder {data.path} is in a cloud-synced folder (iCloud Drive, Dropbox, OneDrive or
      Google Drive). Sync can corrupt the database. Move the folder with GBI_DATA_DIR, and keep your
      exports and backups.
    </p>
  );
}

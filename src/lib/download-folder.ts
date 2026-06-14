export type FolderDownloadCapability = "available" | "insecure" | "unsupported";

export function folderDownloadCapability(
  isSecureContext: boolean,
  hasDirectoryPicker: boolean,
): FolderDownloadCapability {
  if (!isSecureContext) return "insecure";
  return hasDirectoryPicker ? "available" : "unsupported";
}

export function formatDownloadBytes(bytes: number | undefined) {
  if (!bytes || bytes < 1) return "Size unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex > 1 ? 1 : 0)} ${units[unitIndex]}`;
}

export function totalDownloadBytes(downloads: Array<{ size?: number }>) {
  return downloads.reduce((total, download) => total + (download.size || 0), 0);
}

export function folderDownloadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|cors|cross-origin/i.test(message)
  ) {
    return "The provider blocks browser folder streaming. Use the individual download buttons below.";
  }
  return message || "Download failed.";
}

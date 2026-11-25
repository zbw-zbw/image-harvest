// Downloads the UI starts itself already announce their own outcome — a batch
// ZIP toasts "Downloaded 5 images", a collection export "Collection exported".
// The background broadcaster cannot tell those apart from a page-initiated
// download, so it echoes every completion with count=1, which replaced the
// batch toast with "Downloaded 1 file". Record the ids we have already spoken
// for and let message.ts drop their echo.

const MAX_TRACKED = 20;
const selfReported = new Set<number>();

/** Remember a download whose completion the caller toasts itself. */
export function markSelfReportedDownload(downloadId: number): void {
  selfReported.add(downloadId);
  // Cancelled downloads never emit a completion event, so cap the set
  // instead of relying on every id being consumed.
  if (selfReported.size > MAX_TRACKED) {
    const oldest = selfReported.values().next().value;
    if (oldest !== undefined) selfReported.delete(oldest);
  }
}

/** True (and forgets the id) when this completion was already toasted. */
export function consumeSelfReportedDownload(downloadId: unknown): boolean {
  return typeof downloadId === 'number' && selfReported.delete(downloadId);
}

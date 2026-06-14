import { describe, expect, it } from "vitest";
import {
  folderDownloadCapability,
  folderDownloadErrorMessage,
  formatDownloadBytes,
  totalDownloadBytes,
} from "../src/lib/download-folder";

describe("series folder download helpers", () => {
  it("reports folder support separately from secure-context failures", () => {
    expect(folderDownloadCapability(true, true)).toBe("available");
    expect(folderDownloadCapability(true, false)).toBe("unsupported");
    expect(folderDownloadCapability(false, true)).toBe("insecure");
  });

  it("summarizes known download sizes", () => {
    expect(totalDownloadBytes([{ size: 512 }, {}, { size: 512 }])).toBe(1024);
    expect(formatDownloadBytes(1024)).toBe("1 KB");
    expect(formatDownloadBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatDownloadBytes(undefined)).toBe("Size unknown");
  });

  it("turns browser fetch failures into an actionable folder fallback", () => {
    expect(folderDownloadErrorMessage(new TypeError("Failed to fetch"))).toContain(
      "individual download buttons",
    );
    expect(folderDownloadErrorMessage(new Error("Download returned HTTP 403."))).toBe(
      "Download returned HTTP 403.",
    );
  });
});

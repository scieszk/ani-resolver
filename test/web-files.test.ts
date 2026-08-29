import { describe, expect, it } from "vitest";

import { validateAttachments } from "../web/src/files.js";

describe("web attachment validation", () => {
  it("accepts JPEG, PNG, and torrent inputs", () => {
    const result = validateAttachments([
      { name: "frame.png", type: "image/png", size: 100 },
      { name: "release.torrent", type: "application/octet-stream", size: 200 },
    ]);
    expect(result).toEqual({ accepted: expect.any(Array), rejected: [] });
  });

  it("explains unsupported and oversized files before upload", () => {
    const result = validateAttachments([
      { name: "notes.txt", type: "text/plain", size: 10 },
      { name: "huge.png", type: "image/png", size: 21 * 1024 * 1024 },
    ]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ name: "notes.txt", reason: expect.stringContaining("JPEG") }),
      expect.objectContaining({ name: "huge.png", reason: expect.stringContaining("20 MiB") }),
    ]);
  });
});

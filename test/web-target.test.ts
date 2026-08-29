import { describe, expect, it } from "vitest";

import { inferRunTarget, selectResolutionInput } from "../src/web/target.js";

describe("web run target inference", () => {
  it("uses an uploaded image as an image lookup", () => {
    expect(
      inferRunTarget({
        input: "这是谁",
        attachments: [{ kind: "image", path: "C:/tmp/frame.png" }],
      }),
    ).toBe("image");
  });

  it("uses a torrent as work evidence", () => {
    expect(
      inferRunTarget({
        input: "帮我整理这个",
        attachments: [{ kind: "torrent", path: "C:/tmp/release.torrent" }],
      }),
    ).toBe("work");
  });

  it("recognizes descriptive character clues", () => {
    expect(
      inferRunTarget({ input: "女主是白发双马尾，前期没什么表情", attachments: [] }),
    ).toBe("character");
  });

  it("keeps release names in the work path", () => {
    expect(
      inferRunTarget({
        input: "[VCB-Studio] Dungeon Meshi [1080p][HEVC]",
        attachments: [],
      }),
    ).toBe("work");
  });

  it("prefers the file carrying the strongest evidence", () => {
    expect(
      selectResolutionInput({
        input: "帮我看看",
        target: "work",
        attachments: [
          { kind: "image", path: "C:/tmp/frame.png" },
          { kind: "torrent", path: "C:/tmp/release.torrent" },
        ],
      }),
    ).toBe("C:/tmp/release.torrent");

    expect(
      selectResolutionInput({
        input: "这是谁",
        target: "image",
        attachments: [{ kind: "image", path: "C:/tmp/frame.png" }],
      }),
    ).toBe("C:/tmp/frame.png");
  });
});

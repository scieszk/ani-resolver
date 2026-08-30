import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { minimumNodeMajor, runtimeVersionError } from "../src/runtime-version.js";

describe("CLI runtime guard", () => {
  it("rejects old Node versions before loading the CLI implementation", () => {
    expect(minimumNodeMajor).toBe(24);
    expect(runtimeVersionError("20.5.1")).toMatchObject({
      schemaVersion: "ani-resolver.error.v1",
      error: {
        code: "unsupported_node_version",
        details: { current: "20.5.1", required: ">=24" },
      },
    });
    expect(runtimeVersionError("24.0.0")).toBeUndefined();
  });

  it("routes the installed binary through the runtime guard", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.bin).toEqual({ "ani-resolver": "dist/bin.js" });
    expect(packageJson.scripts["start:web"]).toBe("node dist/bin.js web");
  });
});

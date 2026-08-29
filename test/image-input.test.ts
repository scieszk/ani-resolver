import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseImageInput, publicImageEvidence } from "../src/image-input.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "ani-resolver-image-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("parseImageInput", () => {
  it("accepts an existing JPEG file and records provider-facing metadata", async () => {
    const directory = await temporaryDirectory();
    const imagePath = path.join(directory, "frame.jpg");
    await writeFile(imagePath, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]));

    const input = await parseImageInput(imagePath);

    expect(input).toEqual({
      kind: "file",
      source: path.resolve(imagePath),
      display: "frame.jpg",
      fileName: "frame.jpg",
      mimeType: "image/jpeg",
      size: 6,
    });
    expect(publicImageEvidence(input)).toEqual({
      kind: "file",
      display: "frame.jpg",
      mimeType: "image/jpeg",
      size: 6,
    });
  });

  it("accepts a PNG file by signature", async () => {
    const directory = await temporaryDirectory();
    const imagePath = path.join(directory, "frame.png");
    await writeFile(
      imagePath,
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    await expect(parseImageInput(imagePath)).resolves.toMatchObject({
      kind: "file",
      mimeType: "image/png",
    });
  });

  it("keeps a usable URL for providers but redacts credentials and query data in output", async () => {
    const raw = "https://user:secret@example.test/frame.png?token=private#selection";

    const input = await parseImageInput(raw);

    expect(input).toMatchObject({ kind: "url", source: raw });
    expect(publicImageEvidence(input)).toEqual({
      kind: "url",
      display: "https://example.test/frame.png",
    });
    expect(JSON.stringify(publicImageEvidence(input))).not.toContain("secret");
    expect(JSON.stringify(publicImageEvidence(input))).not.toContain("private");
  });

  it("rejects missing paths, directories, unsupported formats, and non-HTTP URLs", async () => {
    const directory = await temporaryDirectory();
    const nested = path.join(directory, "nested");
    const disguised = path.join(directory, "frame.jpg");
    const textFile = path.join(directory, "frame.txt");
    await mkdir(nested);
    await writeFile(disguised, "not an image");
    await writeFile(textFile, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]));

    const missingPath = path.join(directory, "private", "missing.png");
    const missingError = await parseImageInput(missingPath).catch((error: unknown) => error);
    expect(missingError).toBeInstanceOf(Error);
    expect((missingError as Error).message).toContain("Image file does not exist: missing.png");
    expect((missingError as Error).message).not.toContain(directory);
    await expect(parseImageInput(nested)).rejects.toThrow("Image input must be a file");
    await expect(parseImageInput(disguised)).rejects.toThrow("does not contain a JPEG or PNG image");
    await expect(parseImageInput(textFile)).rejects.toThrow("Unsupported image extension");
    await expect(parseImageInput("ftp://example.test/frame.png")).rejects.toThrow(
      "Image URL must use HTTP or HTTPS",
    );
  });
});

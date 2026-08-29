import { open, stat } from "node:fs/promises";
import path from "node:path";

import type { ImageEvidence, ProviderImageInput } from "./types.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;

export async function parseImageInput(value: string): Promise<ProviderImageInput> {
  const input = value.trim();
  if (!input) throw new Error("Image input must not be empty");
  if (URL_SCHEME.test(input)) return parseImageUrl(input);
  return parseImageFile(input);
}

export function publicImageEvidence(input: ProviderImageInput): ImageEvidence {
  return {
    kind: input.kind,
    display: input.display,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
  };
}

function parseImageUrl(input: string): ProviderImageInput {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Image URL must use HTTP or HTTPS");
  }
  const display = new URL(url);
  display.username = "";
  display.password = "";
  display.search = "";
  display.hash = "";
  return { kind: "url", source: input, display: display.toString() };
}

async function parseImageFile(input: string): Promise<ProviderImageInput> {
  const source = path.resolve(input);
  const display = path.basename(source) || "image";
  let metadata;
  try {
    metadata = await stat(source);
  } catch (error) {
    if (isNotFound(error)) throw new Error(`Image file does not exist: ${display}`);
    throw new Error(`Unable to access image file: ${display}`);
  }
  if (!metadata.isFile()) throw new Error(`Image input must be a file: ${display}`);
  const extension = path.extname(source).toLocaleLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(extension)) {
    throw new Error("Unsupported image extension; expected .jpg, .jpeg, or .png");
  }
  if (metadata.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image file exceeds the ${MAX_IMAGE_BYTES} byte limit`);
  }

  let mimeType;
  try {
    mimeType = await detectImageMimeType(source);
  } catch {
    throw new Error(`Unable to read image file: ${display}`);
  }
  if (!mimeType) throw new Error(`Image file does not contain a JPEG or PNG image: ${display}`);
  if ((extension === ".png") !== (mimeType === "image/png")) {
    throw new Error(`Image extension does not match its contents: ${display}`);
  }

  return {
    kind: "file",
    source,
    display,
    fileName: display,
    mimeType,
    size: metadata.size,
  };
}

export function providerUploadFileName(input: ProviderImageInput): string {
  return input.mimeType === "image/png" ? "image.png" : "image.jpg";
}

async function detectImageMimeType(
  source: string,
): Promise<ProviderImageInput["mimeType"] | undefined> {
  const handle = await open(source, "r");
  try {
    const signature = Buffer.alloc(8);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (
      bytesRead >= 8 &&
      signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return "image/png";
    }
    if (bytesRead >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff) {
      return "image/jpeg";
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

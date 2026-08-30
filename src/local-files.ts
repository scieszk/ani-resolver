import { readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_FILES = 100_000;

export interface ScannedLocalFile {
  path: string;
}

export interface DirectoryScanResult {
  files: ScannedLocalFile[];
  skippedSymlinkCount: number;
}

export async function scanDirectoryFiles(
  root: string,
  maxFiles = DEFAULT_MAX_FILES,
): Promise<DirectoryScanResult> {
  const absoluteRoot = path.resolve(root);
  const directories = [""];
  const files: ScannedLocalFile[] = [];
  let skippedSymlinkCount = 0;

  while (directories.length > 0) {
    const relativeDirectory = directories.shift()!;
    const absoluteDirectory = path.join(absoluteRoot, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        skippedSymlinkCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        directories.push(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maxFiles) {
        throw new Error(`Directory contains more than ${maxFiles} files; inspect a narrower folder`);
      }
      files.push({
        path: toPortablePath(relativePath),
      });
    }
  }

  files.sort((left, right) => compareText(left.path, right.path));
  return { files, skippedSymlinkCount };
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

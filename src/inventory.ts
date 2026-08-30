import path from "node:path";

import { parseContentInput, parseEpisodeIdentity } from "./input.js";
import type { ContentEvidence } from "./types.js";

export type InventoryFileKind =
  | "video"
  | "subtitle"
  | "audio"
  | "image"
  | "metadata"
  | "archive"
  | "other";

export interface InventoryFile {
  path: string;
  kind: InventoryFileKind;
  season?: number;
  episode?: number;
}

export interface InventoryEpisodeGroup {
  season?: number;
  episode: number;
  fileCount: number;
  files: InventoryFile[];
  filesTruncated: boolean;
}

export interface ContentInventory {
  schemaVersion: "ani-resolver.inventory.v1";
  source: Omit<ContentEvidence, "files">;
  summary: {
    fileCount: number;
    episodeCount: number;
    seasons: number[];
    byKind: Partial<Record<InventoryFileKind, number>>;
    skippedSymlinkCount: number;
  };
  episodes: InventoryEpisodeGroup[];
  unassignedCount: number;
  unassigned: InventoryFile[];
  unassignedTruncated: boolean;
}

const EXTENSION_KINDS: Record<string, InventoryFileKind> = {
  ".avi": "video", ".flv": "video", ".m2ts": "video", ".m4v": "video",
  ".mkv": "video", ".mov": "video", ".mp4": "video", ".mpeg": "video",
  ".mpg": "video", ".ogm": "video", ".rmvb": "video", ".ts": "video",
  ".webm": "video", ".wmv": "video",
  ".ass": "subtitle", ".idx": "subtitle", ".mks": "subtitle", ".smi": "subtitle",
  ".ssa": "subtitle", ".srt": "subtitle", ".sub": "subtitle", ".sup": "subtitle",
  ".vtt": "subtitle",
  ".aac": "audio", ".ac3": "audio", ".dts": "audio", ".flac": "audio",
  ".m4a": "audio", ".mka": "audio", ".mp3": "audio", ".ogg": "audio",
  ".wav": "audio",
  ".avif": "image", ".bmp": "image", ".gif": "image", ".jpeg": "image",
  ".jpg": "image", ".png": "image", ".webp": "image",
  ".cue": "metadata", ".json": "metadata", ".nfo": "metadata", ".xml": "metadata",
  ".7z": "archive", ".rar": "archive", ".zip": "archive",
};

export async function inspectContentInventory(input: string): Promise<ContentInventory> {
  const evidence = await parseContentInput(input);
  const { files: paths, ...source } = evidence;
  const files = paths.map((filePath) => {
    const portablePath = filePath.replaceAll("\\", "/");
    const identity = parseEpisodeIdentity(portablePath);
    const season = identity.season ?? source.season;
    return {
      path: portablePath,
      kind: classifyFile(portablePath),
      ...(season !== undefined ? { season } : {}),
      ...(identity.episode !== undefined ? { episode: identity.episode } : {}),
    } satisfies InventoryFile;
  });
  const grouped = new Map<string, InventoryFile[]>();
  const unassigned: InventoryFile[] = [];
  for (const file of files) {
    if (file.episode === undefined) {
      unassigned.push(file);
      continue;
    }
    const key = `${file.season ?? ""}:${file.episode}`;
    const group = grouped.get(key) ?? [];
    group.push(file);
    grouped.set(key, group);
  }
  const episodes = [...grouped.values()]
    .map((group): InventoryEpisodeGroup => ({
      ...(group[0]?.season !== undefined ? { season: group[0].season } : {}),
      episode: group[0]!.episode!,
      fileCount: group.length,
      files: group,
      filesTruncated: false,
    }))
    .sort((left, right) =>
      (left.season ?? Number.MAX_SAFE_INTEGER) - (right.season ?? Number.MAX_SAFE_INTEGER) ||
      left.episode - right.episode
    );
  const byKind: Partial<Record<InventoryFileKind, number>> = {};
  for (const file of files) byKind[file.kind] = (byKind[file.kind] ?? 0) + 1;

  return {
    schemaVersion: "ani-resolver.inventory.v1",
    source,
    summary: {
      fileCount: files.length,
      episodeCount: episodes.length,
      seasons: [...new Set(files.flatMap((file) => file.season ?? []))].sort((a, b) => a - b),
      byKind,
      skippedSymlinkCount: source.skippedSymlinkCount ?? 0,
    },
    episodes,
    unassignedCount: unassigned.length,
    unassigned,
    unassignedTruncated: false,
  };
}

export function compactContentInventory(
  inventory: ContentInventory,
  limits: { filesPerEpisode?: number; unassigned?: number } = {},
): ContentInventory {
  const filesPerEpisode = limits.filesPerEpisode ?? 12;
  const unassignedLimit = limits.unassigned ?? 20;
  return {
    ...inventory,
    episodes: inventory.episodes.map((group) => ({
      ...group,
      files: group.files.slice(0, filesPerEpisode),
      filesTruncated: group.files.length > filesPerEpisode,
    })),
    unassigned: inventory.unassigned.slice(0, unassignedLimit),
    unassignedTruncated: inventory.unassigned.length > unassignedLimit,
  };
}

function classifyFile(filePath: string): InventoryFileKind {
  return EXTENSION_KINDS[path.extname(filePath).toLowerCase()] ?? "other";
}

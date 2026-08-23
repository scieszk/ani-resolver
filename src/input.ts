import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import parseTorrent from "parse-torrent";

import type { ContentEvidence, ExternalId, MediaKind } from "./types.js";

const MEDIA_EXTENSIONS = new Set([
  "avi",
  "flv",
  "m2ts",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ogm",
  "rmvb",
  "torrent",
  "ts",
  "webm",
  "wmv",
]);

const TECHNICAL_TOKEN = /^(?:\d{3,4}p|aac|av1|avc|bd|bdrip|flac|h\.?26[45]|hevc|hi10p|ma10p|mkv|opus|web-?dl|webrip|x26[45])(?:[ ._-].*)?$/i;
const RELEASE_GROUP_TOKEN = /(?:raws?|studio|fansub|sub|kissaten|loli|vcb|dbd)/i;

export async function parseContentInput(rawInput: string): Promise<ContentEvidence> {
  const raw = rawInput.trim();
  if (!raw) {
    throw new Error("input must not be empty");
  }

  if (raw.toLowerCase().startsWith("magnet:?")) {
    const torrent = await parseTorrent(raw);
    const display = torrent.name?.trim() || raw;
    return buildEvidence(
      "magnet",
      sanitizeMagnet(raw),
      display,
      torrent.files?.map((file) => file.path) ?? [],
    );
  }

  const fileStat = await safeStat(raw);
  if (fileStat?.isFile() && raw.toLowerCase().endsWith(".torrent")) {
    const torrent = await parseTorrent(await readFile(raw));
    const display = torrent.name?.trim() || path.basename(raw, path.extname(raw));
    return buildEvidence("torrent", raw, display, torrent.files?.map((file) => file.path) ?? []);
  }

  const looksLikePath = Boolean(fileStat) || /[\\/]/.test(raw);
  const kind = looksLikePath ? "path" : looksLikeReleaseName(raw) ? "release_name" : "text";
  const display = looksLikePath ? selectEvidenceSegment(raw) : raw;
  return buildEvidence(kind, raw, display, []);
}

function sanitizeMagnet(value: string): string {
  const input = new URL(value);
  const safe = new URL("magnet:?");
  for (const key of ["xt", "dn", "xl"]) {
    for (const item of input.searchParams.getAll(key)) safe.searchParams.append(key, item);
  }
  return safe.toString();
}

function buildEvidence(
  kind: ContentEvidence["kind"],
  raw: string,
  display: string,
  files: string[],
): ContentEvidence {
  const season =
    extractNumber(raw, /(?:^|\b)(?:season\s*|s)(\d{1,2})(?:\b|e\d{1,3})/i) ??
    extractNumber(display, /(?:^|\b)(?:season\s*|s)(\d{1,2})(?:\b|e\d{1,3})/i);
  const episode = extractEpisode(raw) ?? extractEpisode(display);
  const year = extractNumber(display, /(?:\(|\[|\b)(19\d{2}|20\d{2})(?:\)|\]|\b)/);
  const mediaKind = inferMediaKind(raw, season);
  const externalIds = mergeExternalIds(extractExternalIds(raw), extractExternalIds(display)).map(
    (item): ExternalId =>
      item.source === "tmdb" && mediaKind ? { ...item, mediaKind } : item,
  );
  return {
    kind,
    raw,
    display,
    title: cleanReleaseTitle(display),
    year,
    season,
    episode,
    mediaKind,
    externalIds,
    files,
  };
}

function mergeExternalIds(...groups: ExternalId[][]): ExternalId[] {
  const ids: ExternalId[] = [];
  for (const item of groups.flat()) {
    if (
      !ids.some(
        (existing) =>
          existing.source === item.source &&
          existing.id === item.id &&
          existing.mediaKind === item.mediaKind,
      )
    ) {
      ids.push(item);
    }
  }
  return ids;
}

async function safeStat(value: string) {
  try {
    return await stat(value);
  } catch {
    return undefined;
  }
}

function looksLikeReleaseName(value: string): boolean {
  return /^\[[^\]]+\]/.test(value) || /\.(?:mkv|mp4|torrent)$/i.test(value) || /\bS\d{1,2}E\d{1,3}\b/i.test(value);
}

function selectEvidenceSegment(value: string): string {
  const segments = value.replaceAll("\\", "/").split("/").filter(Boolean);
  return (
    segments.find((segment) => extractExternalIds(segment).length > 0) ??
    segments.find((segment) => /\((?:19|20)\d{2}\)/.test(segment)) ??
    segments.find((segment) => /^\[[^\]]+\]/.test(segment)) ??
    segments.at(-1) ??
    value
  );
}

function extractExternalIds(value: string): ExternalId[] {
  const ids: ExternalId[] = [];
  for (const match of value.matchAll(/\[tmdbid=(\d+)\]|\{tmdb-(\d+)\}/gi)) {
    const id = match[1] ?? match[2];
    if (id && !ids.some((item) => item.source === "tmdb" && item.id === id)) {
      ids.push({ source: "tmdb", id });
    }
  }
  for (const match of value.matchAll(/\[bgmid=(\d+)\]|\{bgm-(\d+)\}/gi)) {
    const id = match[1] ?? match[2];
    if (id && !ids.some((item) => item.source === "bangumi" && item.id === id)) {
      ids.push({ source: "bangumi", id });
    }
  }
  return ids;
}

function extractNumber(value: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(value);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractEpisode(value: string): number | undefined {
  return (
    extractNumber(value, /\bS\d{1,2}E(\d{1,3})\b/i) ??
    extractNumber(value, /\s-\s(\d{1,3})(?:\s|\[|$)/) ??
    extractNumber(value, /\[(\d{1,3})\](?!\d)/)
  );
}

function inferMediaKind(value: string, season: number | undefined): MediaKind | undefined {
  if (/(?:^|[\\/ ])(?:movie|movies|剧场版)(?:[\\/ ]|$)/i.test(value)) return "movie";
  if (/\bOVA\b/i.test(value)) return "ova";
  if (season !== undefined) return "tv";
  return undefined;
}

function cleanReleaseTitle(value: string): string {
  let title = path.basename(value.replaceAll("\\", "/"));
  const extension = path.extname(title).slice(1).toLowerCase();
  if (MEDIA_EXTENSIONS.has(extension)) {
    title = title.slice(0, -(extension.length + 1));
  }

  const leadingBlock = title.match(/^((?:\[[^\]]+\]\s*)+)/)?.[1] ?? "";
  const leadingTags = [...leadingBlock.matchAll(/\[([^\]]+)\]/g)].map(
    (tag) => tag[1]?.trim() ?? "",
  );
  if (leadingTags.length >= 2) {
    const named = leadingTags.slice(1).find((tag) => !isTechnicalOrGroup(tag));
    if (named) return stripTitleNoise(named);
  }

  title = title.replace(/^\[[^\]]+\]\s*/, "");
  return stripTitleNoise(title);
}

function stripTitleNoise(value: string): string {
  let title = value
    .replace(/\[tmdbid=\d+\]|\{tmdb-\d+\}|\[bgmid=\d+\]|\{bgm-\d+\}/gi, " ")
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\bS\d{1,2}E\d{1,3}.*$/i, " ")
    .replace(/\s-\s\d{1,3}(?:\s|\[).*$/i, " ")
    .replace(/\[(?:\d{1,3}|\d{1,3}-\d{1,3})\].*$/, " ")
    .replace(/(?:\s*\[[^\]]+\])+\s*$/, " ")
    .replace(/(?:^|[ ._\-(])(19\d{2}|20\d{2})(?:$|[ ._\-)\]]).*$/, " ")
    .trim()
    .replace(/^[-_.\s]+|[-_.\s]+$/g, "");

  if ((title.match(/\./g)?.length ?? 0) >= 2) title = title.replace(/[._]/g, " ");
  else title = title.replaceAll("_", " ");
  return title.replace(/\s+/g, " ").trim();
}

function isTechnicalOrGroup(value: string): boolean {
  return TECHNICAL_TOKEN.test(value) || RELEASE_GROUP_TOKEN.test(value);
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import type {
  ExternalId,
  ImageMatch,
  ImageQuery,
  MediaKind,
  Provider,
  ProviderManifest,
  ProviderRun,
} from "../types.js";
import { requestJson } from "./http.js";

const titleSchema = z.object({
  native: z.string().nullish(),
  romaji: z.string().nullish(),
  english: z.string().nullish(),
});
const anilistInfoSchema = z
  .object({
    id: z.number().int().positive(),
    idMal: z.number().int().positive().nullish(),
    isAdult: z.boolean(),
    synonyms: z.array(z.string()),
    title: titleSchema,
  })
  .passthrough();
const episodeSchema = z
  .union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))])
  .nullable();
const resultSchema = z
  .object({
    anilist: z.union([z.number().int().positive(), anilistInfoSchema]),
    filename: z.string(),
    episode: episodeSchema,
    from: z.number(),
    to: z.number(),
    at: z.number().optional(),
    duration: z.number().optional(),
    similarity: z.number().min(0).max(1),
    video: z.string(),
    image: z.string(),
  })
  .passthrough();
const responseSchema = z
  .object({
    frameCount: z.number().int().nonnegative(),
    error: z.string(),
    result: z.array(resultSchema),
  })
  .passthrough();

const USER_AGENT = "ani-resolver/0.1.0 (https://github.com/scieszk/ani-resolver)";

export interface TraceMoeProviderOptions {
  fetcher?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  userAgent?: string;
}

export class TraceMoeProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "trace-moe",
    label: "trace.moe",
    mediaTypes: ["anime"],
    capabilities: ["anime_scene_lookup"],
    languages: ["en", "ja"],
    auth: "optional",
    strengths: ["Anime screenshot identification", "Episode and timestamp matches", "AniList IDs"],
    limitations: ["Uploads the query image", "Only matches indexed anime video frames"],
    homepage: "https://trace.moe/",
    attribution: "Scene search by trace.moe",
  };

  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userAgent: string;

  constructor(options: TraceMoeProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.trace.moe/";
    this.apiKey = options.apiKey ?? process.env.TRACE_MOE_API_KEY ?? "";
    this.userAgent = options.userAgent ?? USER_AGENT;
  }

  async searchImage(query: ImageQuery): Promise<ProviderRun<ImageMatch>> {
    const url = new URL("search", this.baseUrl);
    url.searchParams.set("anilistInfo", "");
    url.searchParams.set("cutBorders", "");
    const headers = new Headers({ accept: "application/json", "user-agent": this.userAgent });
    if (this.apiKey) headers.set("x-trace-key", this.apiKey);

    let init: RequestInit = { method: "GET", headers };
    if (query.input.kind === "url") {
      url.searchParams.set("url", query.input.source);
    } else {
      const body = new Uint8Array(await readFile(query.input.source));
      headers.set("content-type", query.input.mimeType ?? "application/octet-stream");
      init = { method: "POST", headers, body };
    }

    const response = await requestJson(this.manifest.id, this.fetcher, url, init);
    if (!response.ok) return { ...response.run, items: [] };
    const parsed = responseSchema.safeParse(response.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    if (parsed.data.error) return invalidResponse(this.manifest.id, parsed.data.error);
    const items = parsed.data.result
      .slice(0, query.limit)
      .map((result, index) => sceneMatch(result, index));
    return { provider: this.manifest.id, status: items.length ? "ok" : "empty", items };
  }
}

function sceneMatch(result: z.infer<typeof resultSchema>, index: number): ImageMatch {
  const info = typeof result.anilist === "number" ? undefined : result.anilist;
  const anilistId = typeof result.anilist === "number" ? result.anilist : result.anilist.id;
  const mediaKind = inferMediaKind(result.episode);
  const externalIds: ExternalId[] = [
    { source: "anilist", id: String(anilistId), mediaKind },
  ];
  if (info?.idMal) externalIds.push({ source: "mal", id: String(info.idMal), mediaKind });
  const names = unique(
    [
      info?.title.romaji,
      info?.title.english,
      info?.title.native,
      ...(info?.synonyms ?? []),
      result.filename,
    ].filter(isText),
  );
  return {
    provider: "trace-moe",
    providerId: `${anilistId}:${episodeKey(result.episode)}:${result.at ?? result.from}:${resultFingerprint(result)}`,
    matchType: "anime_scene",
    rank: index + 1,
    similarity: result.similarity,
    similarityScale: "unit_interval",
    names,
    externalIds,
    facts: {
      filename: result.filename,
      episode: result.episode,
      from: result.from,
      to: result.to,
      ...(result.at === undefined ? {} : { at: result.at }),
      ...(result.duration === undefined ? {} : { duration: result.duration }),
      previewImage: result.image,
      previewVideo: result.video,
      ...(info ? { isAdult: info.isAdult } : {}),
    },
    evidence: [
      {
        provider: "trace-moe",
        kind: "image_similarity",
        value: result.similarity,
      },
    ],
  };
}

function resultFingerprint(result: z.infer<typeof resultSchema>): string {
  return createHash("sha256")
    .update(result.filename)
    .digest("hex")
    .slice(0, 12);
}

function inferMediaKind(episode: z.infer<typeof episodeSchema>): MediaKind {
  return episode === null ? "unknown" : "tv";
}

function episodeKey(episode: z.infer<typeof episodeSchema>): string {
  return episode === null ? "unknown" : Array.isArray(episode) ? episode.join("-") : String(episode);
}

function invalidResponse(provider: string, message: string): ProviderRun<ImageMatch> {
  return { provider, status: "invalid_response", items: [], message };
}

function isText(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { providerUploadFileName } from "../image-input.js";
import type {
  ExternalId,
  ImageMatch,
  ImageQuery,
  Provider,
  ProviderManifest,
  ProviderRun,
} from "../types.js";
import { requestJson } from "./http.js";

const scalarSchema = z.union([z.string(), z.number()]);
const resultDataSchema = z
  .object({
    ext_urls: z.union([z.array(z.string()), z.string()]).nullish(),
    title: z.string().nullish(),
    member_name: z.string().nullish(),
    member_id: scalarSchema.nullish(),
    pixiv_id: scalarSchema.nullish(),
    danbooru_id: scalarSchema.nullish(),
    gelbooru_id: scalarSchema.nullish(),
    mangadex_id: scalarSchema.nullish(),
    anidb_aid: scalarSchema.nullish(),
    anilist_id: scalarSchema.nullish(),
    mal_id: scalarSchema.nullish(),
    characters: z.string().nullish(),
    material: z.string().nullish(),
    source: z.string().nullish(),
    creator: z.union([z.string(), z.array(z.string())]).nullish(),
  })
  .passthrough();
const resultSchema = z.object({
  header: z
    .object({
      similarity: scalarSchema,
      thumbnail: z.string().nullish(),
      index_id: z.number().int(),
      index_name: z.string(),
      dupes: z.number().int().nullish(),
      hidden: z.number().int().nullish(),
    })
    .passthrough(),
  data: resultDataSchema,
});
const responseSchema = z
  .object({
    header: z
      .object({
        status: z.number().int(),
        message: z.string().nullish(),
      })
      .passthrough(),
    results: z.array(resultSchema),
  })
  .passthrough();

const USER_AGENT = "ani-resolver/0.1.0 (https://github.com/scieszk/ani-resolver)";

export interface SauceNaoProviderOptions {
  fetcher?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  userAgent?: string;
}

export class SauceNaoProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "saucenao",
    label: "SauceNAO",
    mediaTypes: ["anime"],
    capabilities: ["reverse_image_lookup"],
    languages: ["en", "ja"],
    auth: "required",
    strengths: ["Artwork source pages", "Creator metadata", "Broad reverse-image indexes"],
    limitations: ["Uploads the query image", "Requires an API key", "Cropped or edited images reduce accuracy"],
    homepage: "https://saucenao.com/",
    attribution: "Reverse image results from SauceNAO",
  };

  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userAgent: string;

  constructor(options: SauceNaoProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://saucenao.com/search.php";
    this.apiKey = options.apiKey ?? process.env.SAUCENAO_API_KEY ?? "";
    this.userAgent = options.userAgent ?? USER_AGENT;
  }

  async searchImage(query: ImageQuery): Promise<ProviderRun<ImageMatch>> {
    if (!this.apiKey) {
      return {
        provider: this.manifest.id,
        status: "auth_required",
        items: [],
        message: "SauceNAO requires an API key",
      };
    }

    const form = new FormData();
    form.set("output_type", "2");
    form.set("api_key", this.apiKey);
    form.set("numres", String(query.limit));
    form.set("db", "999");
    if (query.input.kind === "url") {
      form.set("url", query.input.source);
    } else {
      const bytes = new Uint8Array(await readFile(query.input.source));
      form.set(
        "file",
        new Blob([bytes], { type: query.input.mimeType ?? "application/octet-stream" }),
        providerUploadFileName(query.input),
      );
    }

    const response = await requestJson(this.manifest.id, this.fetcher, this.baseUrl, {
      method: "POST",
      headers: { accept: "application/json", "user-agent": this.userAgent },
      body: form,
    });
    if (!response.ok) return { ...response.run, items: [] };
    const parsed = responseSchema.safeParse(response.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    if (parsed.data.header.status !== 0) {
      const message = parsed.data.header.message || `SauceNAO status ${parsed.data.header.status}`;
      const status = /limit|quota|rate/iu.test(message) ? "rate_limited" : "unavailable";
      return { provider: this.manifest.id, status, items: [], message };
    }
    const items = parsed.data.results
      .slice(0, query.limit)
      .map((result, index) => sourceMatch(result, index));
    return { provider: this.manifest.id, status: items.length ? "ok" : "empty", items };
  }
}

function sourceMatch(result: z.infer<typeof resultSchema>, index: number): ImageMatch {
  const similarityPercent = Number(result.header.similarity);
  const similarity = Number.isFinite(similarityPercent)
    ? similarityPercent
    : undefined;
  const sourceUrls = normalizeUrls(result.data.ext_urls);
  const names = unique(
    [result.data.title, result.data.characters, result.data.material, result.data.source].filter(isText),
  );
  const externalIds = sourceExternalIds(result.data);
  const creator = result.data.member_name ?? normalizeCreator(result.data.creator);
  return {
    provider: "saucenao",
    providerId: `${result.header.index_id}:${sourceFingerprint(result)}`,
    matchType: "source",
    rank: index + 1,
    ...(similarity === undefined ? {} : { similarity }),
    ...(similarity === undefined ? {} : { similarityScale: "percent" as const }),
    names,
    externalIds,
    facts: {
      sourceDatabase: result.header.index_name,
      sourceUrls,
      creator: creator ?? null,
      creatorId: result.data.member_id === null || result.data.member_id === undefined
        ? null
        : String(result.data.member_id),
      thumbnail: result.header.thumbnail ?? null,
      title: result.data.title ?? null,
      characters: result.data.characters ?? null,
      material: result.data.material ?? null,
      sourceData: result.data,
    },
    evidence: similarity === undefined
      ? []
      : [{ provider: "saucenao", kind: "image_similarity", value: similarity }],
  };
}

function sourceFingerprint(result: z.infer<typeof resultSchema>): string {
  const identity = {
    indexId: result.header.index_id,
    sourceUrls: normalizeUrls(result.data.ext_urls).sort(),
    externalIds: sourceExternalIds(result.data)
      .map(({ source, id }) => `${source}:${id}`)
      .sort(),
    title: result.data.title ?? null,
    memberId: result.data.member_id ?? null,
    memberName: result.data.member_name ?? null,
    creator: normalizeCreator(result.data.creator) ?? null,
    characters: result.data.characters ?? null,
    material: result.data.material ?? null,
    source: result.data.source ?? null,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 16);
}

function sourceExternalIds(data: z.infer<typeof resultDataSchema>): ExternalId[] {
  const mappings: Array<[keyof typeof data, string]> = [
    ["pixiv_id", "pixiv"],
    ["danbooru_id", "danbooru"],
    ["gelbooru_id", "gelbooru"],
    ["mangadex_id", "mangadex"],
    ["anidb_aid", "anidb"],
    ["anilist_id", "anilist"],
    ["mal_id", "mal"],
  ];
  return mappings.flatMap(([field, source]) => {
    const value = data[field];
    return typeof value === "string" || typeof value === "number"
      ? [{ source, id: String(value) }]
      : [];
  });
}

function normalizeUrls(value: string[] | string | null | undefined): string[] {
  return unique(typeof value === "string" ? [value] : value ?? []);
}

function normalizeCreator(value: string | string[] | null | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value ?? undefined;
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

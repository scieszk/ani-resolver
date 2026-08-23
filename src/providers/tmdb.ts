import { z } from "zod";

import { normalizeName } from "../resolver.js";
import type {
  ExternalId,
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRun,
  ResolveQuery,
} from "../types.js";
import { requestJson } from "./http.js";

const tmdbResultSchema = z
  .object({
    id: z.number(),
    media_type: z.enum(["tv", "movie", "person"]),
    name: z.string().optional(),
    original_name: z.string().optional(),
    title: z.string().optional(),
    original_title: z.string().optional(),
    first_air_date: z.string().optional(),
    release_date: z.string().optional(),
    overview: z.string().optional(),
    poster_path: z.string().nullable().optional(),
    popularity: z.number().optional(),
  })
  .passthrough();
const tmdbPageSchema = z.object({ results: z.array(tmdbResultSchema) }).passthrough();
type TmdbSearchResult = z.infer<typeof tmdbResultSchema>;
type TmdbWorkSearchResult = TmdbSearchResult & { media_type: "tv" | "movie" };

export interface TmdbProviderOptions {
  token?: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
  language?: string;
}

export class TmdbProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "tmdb",
    label: "TMDB",
    mediaTypes: ["anime"],
    capabilities: ["work_search", "work_detail"],
    languages: ["zh", "ja", "en"],
    auth: "required",
    strengths: ["TMDB IDs", "TV and movie metadata", "localized titles"],
    limitations: ["Requires TMDB_ACCESS_TOKEN", "Cast credits are not anime character records"],
    homepage: "https://developer.themoviedb.org/",
    attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
  };

  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly language: string;

  constructor(options: TmdbProviderOptions = {}) {
    this.token = options.token ?? process.env.TMDB_ACCESS_TOKEN ?? "";
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.themoviedb.org/3";
    this.language = options.language ?? "zh-CN";
  }

  async searchWorks(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    if (!this.token) {
      return {
        provider: this.manifest.id,
        status: "auth_required",
        items: [],
        message: "Set TMDB_ACCESS_TOKEN to enable TMDB work search",
      };
    }

    const url = new URL(`${this.baseUrl}/search/multi`);
    url.searchParams.set("query", query.title ?? query.text);
    url.searchParams.set("language", this.language);
    url.searchParams.set("include_adult", "false");
    const result = await requestJson(this.manifest.id, this.fetcher, url, {
      headers: { accept: "application/json", authorization: `Bearer ${this.token}` },
    });
    if (!result.ok) return result.run;

    const parsed = tmdbPageSchema.safeParse(result.data);
    if (!parsed.success) {
      return { provider: this.manifest.id, status: "invalid_response", items: [], message: parsed.error.message };
    }
    const items = parsed.data.results
      .filter((item): item is TmdbWorkSearchResult => item.media_type !== "person")
      .slice(0, query.limit)
      .map((item, index) => tmdbCandidate(item, query, index));
    return { provider: this.manifest.id, status: items.length ? "ok" : "empty", items };
  }

  async getEntity(
    id: ExternalId,
    entityType: "work" | "character",
  ): Promise<ProviderRun<ProviderCandidate>> {
    if (entityType !== "work" || id.source !== "tmdb") {
      return {
        provider: this.manifest.id,
        status: "unsupported",
        items: [],
        message: "TMDB provider only fetches TMDB work IDs",
      };
    }
    if (!this.token) {
      return {
        provider: this.manifest.id,
        status: "auth_required",
        items: [],
        message: "Set TMDB_ACCESS_TOKEN to enable TMDB work detail",
      };
    }
    if (id.mediaKind !== "tv" && id.mediaKind !== "movie") {
      return {
        provider: this.manifest.id,
        status: "unsupported",
        items: [],
        message: "TMDB IDs require mediaKind tv or movie; use tmdb-tv:id or tmdb-movie:id",
      };
    }

    const result = await requestJson(
      this.manifest.id,
      this.fetcher,
      `${this.baseUrl}/${id.mediaKind}/${encodeURIComponent(id.id)}?language=${encodeURIComponent(this.language)}`,
      { headers: { accept: "application/json", authorization: `Bearer ${this.token}` } },
    );
    if (!result.ok) return result.run;
    const parsed = tmdbResultSchema.safeParse({ ...asObject(result.data), media_type: id.mediaKind });
    if (!parsed.success || parsed.data.media_type === "person") {
      return {
        provider: this.manifest.id,
        status: "invalid_response",
        items: [],
        message: parsed.success ? "TMDB returned a person for a work ID" : parsed.error.message,
      };
    }
    return {
      provider: this.manifest.id,
      status: "ok",
      items: [
        tmdbCandidate(parsed.data as TmdbWorkSearchResult, {
          entityType: "work",
          text: parsed.data.name ?? parsed.data.title ?? id.id,
          limit: 1,
        }, 0),
      ],
    };
  }
}

function tmdbCandidate(
  item: TmdbWorkSearchResult,
  query: ResolveQuery,
  index: number,
): ProviderCandidate {
  const names = [item.name, item.title, item.original_name, item.original_title].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const uniqueNames = [...new Set(names)];
  const date = item.media_type === "tv" ? item.first_air_date : item.release_date;
  const year = date?.slice(0, 4).match(/^\d{4}$/) ? Number.parseInt(date.slice(0, 4), 10) : undefined;
  const normalizedQuery = normalizeName(query.title ?? query.text);
  let score = 0.76 - Math.min(index, 10) * 0.025;
  if (uniqueNames.some((name) => normalizeName(name) === normalizedQuery)) score += 0.12;
  if (query.year !== undefined && query.year === year) score += 0.05;
  return {
    entityType: "work",
    provider: "tmdb",
    providerId: String(item.id),
    names: uniqueNames,
    externalIds: [{ source: "tmdb", id: String(item.id), mediaKind: item.media_type }],
    mediaKind: item.media_type,
    ...(year !== undefined ? { year } : {}),
    providerScore: Math.min(0.95, score),
    facts: {
      summary: item.overview ?? "",
      image: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
      popularity: item.popularity ?? null,
    },
    evidence: [],
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

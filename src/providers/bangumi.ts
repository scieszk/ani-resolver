import { z } from "zod";

import {
  hasAppearanceFacts,
  parseAppearanceText,
  scoreAppearanceMatch,
} from "../appearance.js";
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

const infoboxValueSchema = z.union([
  z.string(),
  z.array(z.union([z.string(), z.object({ v: z.string().optional(), k: z.string().optional() }).passthrough()])),
  z.object({ v: z.string().optional(), k: z.string().optional() }).passthrough(),
]);
const infoboxSchema = z
  .array(z.object({ key: z.string(), value: infoboxValueSchema }).passthrough())
  .nullish()
  .transform((value) => value ?? []);
const imagesSchema = z
  .record(z.string(), z.string())
  .nullish()
  .transform((value) => value ?? undefined);

const subjectSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    name_cn: z.string().optional(),
    date: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
    platform: z.string().optional(),
    summary: z.string().optional(),
    infobox: infoboxSchema,
    images: imagesSchema,
    type: z.number(),
  })
  .passthrough();

const characterSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.number().optional(),
    summary: z.string().optional(),
    infobox: infoboxSchema,
    images: imagesSchema,
    relation: z.string().optional(),
    actors: z.array(z.unknown()).optional(),
  })
  .passthrough();

const subjectPageSchema = z.object({ data: z.array(subjectSchema) }).passthrough();
const characterPageSchema = z.object({ data: z.array(characterSchema) }).passthrough();

export interface BangumiProviderOptions {
  fetcher?: typeof fetch;
  token?: string;
  baseUrl?: string;
  userAgent?: string;
}

export class BangumiProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "bangumi",
    label: "Bangumi API",
    mediaTypes: ["anime"],
    capabilities: [
      "work_search",
      "work_detail",
      "character_search",
      "character_appearance_search",
      "character_detail",
      "work_characters",
    ],
    languages: ["zh", "ja", "en"],
    auth: "optional",
    strengths: ["Chinese and Japanese titles", "anime relations", "character credits"],
    limitations: ["Character search is text/name oriented", "Experimental search endpoints may change"],
    homepage: "https://bangumi.github.io/api/",
    attribution: "Data from Bangumi",
  };

  private readonly fetcher: typeof fetch;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(options: BangumiProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.token = options.token ?? process.env.BANGUMI_ACCESS_TOKEN ?? "";
    this.baseUrl = options.baseUrl ?? "https://api.bgm.tv";
    this.userAgent =
      options.userAgent ?? "ani-resolver/0.1.0 (https://github.com/scieszk/ani-resolver)";
  }

  async searchWorks(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    const result = await requestJson(
      this.manifest.id,
      this.fetcher,
      `${this.baseUrl}/v0/search/subjects?limit=${query.limit}&offset=0`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          keyword: query.title ?? query.text,
          sort: "match",
          filter: { type: [2], nsfw: false },
        }),
      },
    );
    if (!result.ok) return result.run;

    const parsed = subjectPageSchema.safeParse(result.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    const items = parsed.data.data.map((subject, index) => subjectCandidate(subject, query, index));
    return { provider: this.manifest.id, status: items.length ? "ok" : "empty", items };
  }

  async searchCharacters(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    if (query.work && query.work.source !== "bangumi") {
      return {
        provider: this.manifest.id,
        status: "unsupported",
        items: [],
        message: "Bangumi character filtering requires a Bangumi work ID",
      };
    }
    if (query.work) {
      const listed = await this.listWorkCharacters(query.work);
      if (listed.status !== "ok") return listed;
      return {
        ...listed,
        items: listed.items
          .map((candidate) => rankCharacterCandidate(candidate, query))
          .sort((left, right) => right.providerScore - left.providerScore)
          .slice(0, query.limit),
      };
    }

    const result = await requestJson(
      this.manifest.id,
      this.fetcher,
      `${this.baseUrl}/v0/search/characters?limit=${query.limit}&offset=0`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ keyword: query.text, filter: { nsfw: false } }),
      },
    );
    if (!result.ok) return result.run;

    const parsed = characterPageSchema.safeParse(result.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    const items = parsed.data.data.map((character, index) => characterCandidate(character, query, index));
    return { provider: this.manifest.id, status: items.length ? "ok" : "empty", items };
  }

  async getEntity(id: ExternalId, entityType: "work" | "character"): Promise<ProviderRun<ProviderCandidate>> {
    if (id.source !== "bangumi") {
      return { provider: this.manifest.id, status: "unsupported", items: [], message: "not a Bangumi ID" };
    }
    const path = entityType === "work" ? "subjects" : "characters";
    const result = await requestJson(
      this.manifest.id,
      this.fetcher,
      `${this.baseUrl}/v0/${path}/${encodeURIComponent(id.id)}`,
      { headers: this.headers() },
    );
    if (!result.ok) return result.run;

    if (entityType === "work") {
      const parsed = subjectSchema.safeParse(result.data);
      if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
      return {
        provider: this.manifest.id,
        status: "ok",
        items: [subjectCandidate(parsed.data, { entityType: "work", text: parsed.data.name, limit: 1 }, 0)],
      };
    }
    const parsed = characterSchema.safeParse(result.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    return {
      provider: this.manifest.id,
      status: "ok",
      items: [characterCandidate(parsed.data, { entityType: "character", text: parsed.data.name, limit: 1 }, 0)],
    };
  }

  async listWorkCharacters(work: ExternalId): Promise<ProviderRun<ProviderCandidate>> {
    if (work.source !== "bangumi") {
      return { provider: this.manifest.id, status: "unsupported", items: [], message: "not a Bangumi ID" };
    }
    const result = await requestJson(
      this.manifest.id,
      this.fetcher,
      `${this.baseUrl}/v0/subjects/${encodeURIComponent(work.id)}/characters`,
      { headers: this.headers() },
    );
    if (!result.ok) return result.run;
    const parsed = z.array(characterSchema).safeParse(result.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    const query: ResolveQuery = { entityType: "character", text: "", work, limit: parsed.data.length };
    const items = parsed.data.map((character, index) => characterCandidate(character, query, index));
    return { provider: this.manifest.id, status: items.length ? "ok" : "empty", items };
  }

  private headers(): Headers {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": this.userAgent,
    });
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    return headers;
  }
}

function subjectCandidate(
  subject: z.infer<typeof subjectSchema>,
  query: ResolveQuery,
  index: number,
): ProviderCandidate {
  const names = collectNames(subject.name, subject.name_cn, subject.infobox);
  const exact = names.some((name) => normalizeName(name) === normalizeName(query.title ?? query.text));
  const year = yearFromDate(subject.date);
  let score = 0.78 - Math.min(index, 10) * 0.025;
  if (exact) score += 0.1;
  if (query.year !== undefined && query.year === year) score += 0.05;
  const image = preferredImage(subject.images);
  return {
    entityType: "work",
    provider: "bangumi",
    providerId: String(subject.id),
    names,
    externalIds: [{ source: "bangumi", id: String(subject.id) }],
    mediaKind: platformKind(subject.platform),
    ...(year !== undefined ? { year } : {}),
    providerScore: Math.min(0.95, score),
    facts: {
      platform: subject.platform ?? null,
      summary: subject.summary ?? "",
      image: image ?? null,
    },
    evidence: [],
  };
}

function characterCandidate(
  character: z.infer<typeof characterSchema>,
  query: ResolveQuery,
  index: number,
): ProviderCandidate {
  const names = collectNames(character.name, undefined, character.infobox);
  const infobox = Object.fromEntries(
    character.infobox.map((item) => [item.key, flattenFirst(flattenInfobox(item.value))]),
  );
  const appearance = parseAppearanceText(
    [character.summary ?? "", ...Object.values(infobox).flatMap((value) => Array.isArray(value) ? value : [value])]
      .join("\n"),
  );
  const requestedAppearance = parseAppearanceText(query.text);
  const match = scoreAppearanceMatch(requestedAppearance, appearance);
  const base = Math.max(0.5, 0.82 - Math.min(index, 10) * 0.025);
  return {
    entityType: "character",
    provider: "bangumi",
    providerId: String(character.id),
    names,
    externalIds: [{ source: "bangumi", id: String(character.id) }],
    providerScore: Math.min(
      0.95,
      textScore(query.text, names, infobox, base) +
        (hasAppearanceFacts(requestedAppearance) ? match.score * 0.08 : 0),
    ),
    facts: {
      ...infobox,
      appearance,
      ...(infobox["性别"] !== undefined ? { gender: infobox["性别"] } : {}),
      summary: character.summary ?? "",
      role: character.relation ?? null,
      image: preferredImage(character.images) ?? null,
    },
    evidence: [
      {
        provider: "bangumi",
        kind: "appearance_match",
        value: match,
        weight: match.score,
      },
    ],
  };
}

function rankCharacterCandidate(candidate: ProviderCandidate, query: ResolveQuery): ProviderCandidate {
  const requested = parseAppearanceText(query.text);
  const appearance = parseAppearanceText(JSON.stringify(candidate.facts));
  const match = scoreAppearanceMatch(requested, appearance);
  return {
    ...candidate,
    providerScore: Math.min(
      0.95,
      textScore(query.text, candidate.names, candidate.facts, candidate.providerScore) +
        (hasAppearanceFacts(requested) ? match.score * 0.08 : 0),
    ),
    evidence: [
      ...candidate.evidence.filter((item) => item.kind !== "appearance_match"),
      { provider: "bangumi", kind: "appearance_match", value: match, weight: match.score },
    ],
  };
}

function collectNames(
  primary: string,
  chinese: string | undefined,
  infobox: z.infer<typeof infoboxSchema>,
): string[] {
  const names = [primary, ...(chinese?.trim() ? [chinese.trim()] : [])];
  for (const item of infobox) {
    if (!/(?:名|别名|alias|name)/i.test(item.key)) continue;
    names.push(...flattenInfobox(item.value));
  }
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function flattenInfobox(value: z.infer<typeof infoboxValueSchema>): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === "string" ? (item.trim() ? [item.trim()] : []) : item.v?.trim() ? [item.v.trim()] : [],
    );
  }
  return value.v?.trim() ? [value.v.trim()] : [];
}

function textScore(
  query: string,
  names: string[],
  facts: Record<string, unknown>,
  base: number,
): number {
  const normalized = normalizeName(query);
  if (!normalized) return base;
  if (names.some((name) => normalizeName(name) === normalized)) return Math.min(0.95, base + 0.1);
  const haystack = normalizeName(`${names.join(" ")} ${JSON.stringify(facts)}`);
  const tokens = query.split(/[\s,，、]+/).map(normalizeName).filter(Boolean);
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return Math.min(0.9, base + (tokens.length ? (matched / tokens.length) * 0.08 : 0));
}

function flattenFirst(value: string[]): string | string[] {
  return value.length <= 1 ? (value[0] ?? "") : value;
}

function yearFromDate(date: string | undefined): number | undefined {
  const value = date?.slice(0, 4);
  return value && /^\d{4}$/.test(value) ? Number.parseInt(value, 10) : undefined;
}

function platformKind(platform: string | undefined): "tv" | "movie" | "ova" | "web" | "unknown" {
  const normalized = platform?.toLocaleLowerCase() ?? "";
  if (normalized.includes("剧场") || normalized.includes("movie")) return "movie";
  if (normalized.includes("ova") || normalized.includes("oad")) return "ova";
  if (normalized.includes("web")) return "web";
  if (normalized.includes("tv")) return "tv";
  return "unknown";
}

function preferredImage(images: Record<string, string> | undefined): string | undefined {
  return images?.large ?? images?.medium ?? images?.common ?? images?.small;
}

function invalidResponse(provider: string, message: string): ProviderRun<ProviderCandidate> {
  return { provider, status: "invalid_response", items: [], message };
}

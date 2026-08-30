import { z } from "zod";

import {
  emptyAppearance,
  hasAppearanceFacts,
  parseAppearanceText,
  scoreAppearanceMatch,
} from "../appearance.js";
import { normalizeName } from "../resolver.js";
import type {
  ExternalId,
  MediaKind,
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRun,
  ResolveQuery,
} from "../types.js";
import { requestJson } from "./http.js";

const titleSchema = z.object({
  romaji: z.string().nullish(),
  english: z.string().nullish(),
  native: z.string().nullish(),
});
const mediaSchema = z
  .object({
    id: z.number().int().positive(),
    idMal: z.number().int().positive().nullish(),
    title: titleSchema,
    format: z.string().nullish(),
    startDate: z.object({ year: z.number().int().nullish() }).nullish(),
    description: z.string().nullish(),
    coverImage: z.object({ large: z.string().nullish() }).nullish(),
    siteUrl: z.string().nullish(),
    popularity: z.number().nullish(),
  })
  .passthrough();
const characterSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.object({
      full: z.string().nullish(),
      native: z.string().nullish(),
      alternative: z.array(z.string()).nullish(),
      alternativeSpoiler: z.array(z.string()).nullish().optional(),
    }),
    image: z.object({ large: z.string().nullish() }).nullish(),
    description: z.string().nullish(),
    gender: z.string().nullish(),
    age: z.string().nullish(),
    bloodType: z.string().nullish(),
    favourites: z.number().nullish(),
    siteUrl: z.string().nullish(),
  })
  .passthrough();
const graphQlErrorsSchema = z
  .array(z.object({ message: z.string() }).passthrough())
  .optional();

const WORK_SEARCH = `
query WorkSearch($search: String!, $perPage: Int!) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id idMal format siteUrl popularity
      title { romaji english native }
      startDate { year }
      description(asHtml: false)
      coverImage { large }
    }
  }
}`;

const CHARACTER_SEARCH = `
query CharacterSearch($search: String!, $perPage: Int!) {
  Page(page: 1, perPage: $perPage) {
    characters(search: $search, sort: SEARCH_MATCH) {
      id siteUrl favourites gender age bloodType
      name { full native alternative alternativeSpoiler }
      image { large }
      description(asHtml: false)
    }
  }
}`;

const WORK_CHARACTERS = `
query WorkCharacters($id: Int!, $perPage: Int!) {
  Media(id: $id, type: ANIME) {
    characters(page: 1, perPage: $perPage, sort: [ROLE, FAVOURITES_DESC]) {
      edges {
        role
        node {
          id siteUrl favourites gender age bloodType
          name { full native alternative alternativeSpoiler }
          image { large }
          description(asHtml: false)
        }
      }
    }
  }
}`;

const WORK_DETAIL = `
query WorkDetail($id: Int!) {
  Media(id: $id, type: ANIME) {
    id idMal format siteUrl popularity
    title { romaji english native }
    startDate { year }
    description(asHtml: false)
    coverImage { large }
  }
}`;

const CHARACTER_DETAIL = `
query CharacterDetail($id: Int!) {
  Character(id: $id) {
    id siteUrl favourites gender age bloodType
    name { full native alternative alternativeSpoiler }
    image { large }
    description(asHtml: false)
  }
}`;

const USER_AGENT = "ani-resolver/0.1.0 (https://github.com/scieszk/ani-resolver)";

export interface AniListProviderOptions {
  fetcher?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
}

export class AniListProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "anilist",
    label: "AniList GraphQL",
    mediaTypes: ["anime"],
    capabilities: [
      "work_search",
      "work_detail",
      "character_search",
      "character_appearance_search",
      "character_detail",
      "work_characters",
      "id_mapping",
    ],
    languages: ["en", "ja"],
    auth: "none",
    strengths: ["Character descriptions", "Anime cast lists", "AniList and MAL work IDs"],
    limitations: ["Appearance is extracted from descriptive text", "Character search is name oriented without a work ID"],
    homepage: "https://anilist.co/",
    attribution: "Data from AniList",
  };

  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(options: AniListProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://graphql.anilist.co";
    this.userAgent = options.userAgent ?? USER_AGENT;
  }

  async searchWorks(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    const response = await this.graphql(WORK_SEARCH, {
      search: query.title ?? query.text,
      perPage: bounded(query.limit, 50),
    });
    if (!response.ok) return response.run;
    const schema = z.object({
      data: z.object({ Page: z.object({ media: z.array(mediaSchema) }) }),
      errors: graphQlErrorsSchema,
    });
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    if (parsed.data.errors?.length) return graphQlError(this.manifest.id, parsed.data.errors);
    return run(
      this.manifest.id,
      parsed.data.data.Page.media.map((media, index) => workCandidate(media, query, index)),
    );
  }

  async searchCharacters(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    if (query.work) {
      if (query.work.source !== "anilist" || !numericId(query.work.id)) {
        return unsupported(this.manifest.id, "AniList character filtering requires an AniList work ID");
      }
      const listed = await this.fetchWorkCharacters(query.work, Math.max(query.limit * 4, 25));
      if (listed.status !== "ok") return listed;
      return {
        ...listed,
        items: listed.items
          .map((candidate, index) => rankCharacterCandidate(candidate, query, index))
          .sort((left, right) => right.providerScore - left.providerScore)
          .slice(0, query.limit),
      };
    }

    if (!query.text.trim()) {
      return unsupported(
        this.manifest.id,
        "AniList appearance filtering requires a character name or an AniList work ID",
      );
    }

    const response = await this.graphql(CHARACTER_SEARCH, {
      search: query.text,
      perPage: bounded(query.limit, 25),
    });
    if (!response.ok) return response.run;
    const schema = z.object({
      data: z.object({ Page: z.object({ characters: z.array(characterSchema) }) }),
      errors: graphQlErrorsSchema,
    });
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    if (parsed.data.errors?.length) return graphQlError(this.manifest.id, parsed.data.errors);
    return run(
      this.manifest.id,
      parsed.data.data.Page.characters.map((character, index) => characterCandidate(character, query, index)),
    );
  }

  async getEntity(
    id: ExternalId,
    entityType: "work" | "character",
  ): Promise<ProviderRun<ProviderCandidate>> {
    const numeric = id.source === "anilist" ? numericId(id.id) : undefined;
    if (!numeric) return unsupported(this.manifest.id, "AniList IDs must use anilist:<number>");
    if (entityType === "work") {
      const response = await this.graphql(WORK_DETAIL, { id: numeric });
      if (!response.ok) return response.run;
      const schema = z.object({ data: z.object({ Media: mediaSchema.nullable() }), errors: graphQlErrorsSchema });
      const parsed = schema.safeParse(response.data);
      if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
      if (parsed.data.errors?.length) return graphQlError(this.manifest.id, parsed.data.errors);
      const media = parsed.data.data.Media;
      return run(
        this.manifest.id,
        media ? [workCandidate(media, { entityType: "work", text: id.id, limit: 1 }, 0)] : [],
      );
    }
    const response = await this.graphql(CHARACTER_DETAIL, { id: numeric });
    if (!response.ok) return response.run;
    const schema = z.object({ data: z.object({ Character: characterSchema.nullable() }), errors: graphQlErrorsSchema });
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    if (parsed.data.errors?.length) return graphQlError(this.manifest.id, parsed.data.errors);
    const character = parsed.data.data.Character;
    return run(
      this.manifest.id,
      character ? [characterCandidate(character, { entityType: "character", text: id.id, limit: 1 }, 0)] : [],
    );
  }

  async listWorkCharacters(work: ExternalId): Promise<ProviderRun<ProviderCandidate>> {
    if (work.source !== "anilist" || !numericId(work.id)) {
      return unsupported(this.manifest.id, "AniList work IDs must use anilist:<number>");
    }
    return this.fetchWorkCharacters(work, 25);
  }

  private async fetchWorkCharacters(
    work: ExternalId,
    limit: number,
  ): Promise<ProviderRun<ProviderCandidate>> {
    const id = numericId(work.id)!;
    const response = await this.graphql(WORK_CHARACTERS, { id, perPage: bounded(limit, 25) });
    if (!response.ok) return response.run;
    const schema = z.object({
      data: z.object({
        Media: z
          .object({
            characters: z.object({
              edges: z.array(z.object({ role: z.string().nullish(), node: characterSchema })),
            }),
          })
          .nullable(),
      }),
      errors: graphQlErrorsSchema,
    });
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    if (parsed.data.errors?.length) return graphQlError(this.manifest.id, parsed.data.errors);
    const edges = parsed.data.data.Media?.characters.edges ?? [];
    const query: ResolveQuery = { entityType: "character", text: "", work, limit: edges.length };
    return run(
      this.manifest.id,
      edges.map((edge, index) => characterCandidate(edge.node, query, index, edge.role ?? null)),
    );
  }

  private async graphql(query: string, variables: Record<string, unknown>) {
    return requestJson(
      this.manifest.id,
      this.fetcher,
      this.baseUrl,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": this.userAgent,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
  }
}

function workCandidate(
  media: z.infer<typeof mediaSchema>,
  query: ResolveQuery,
  index: number,
): ProviderCandidate {
  const mediaKind = formatKind(media.format);
  const names = unique([media.title.romaji, media.title.english, media.title.native].filter(isText));
  const exact = names.some((name) => normalizeName(name) === normalizeName(query.title ?? query.text));
  const year = media.startDate?.year ?? undefined;
  let score = 0.78 - Math.min(index, 10) * 0.025;
  if (exact) score += 0.1;
  if (query.year !== undefined && query.year === year) score += 0.04;
  const externalIds: ExternalId[] = [{ source: "anilist", id: String(media.id), mediaKind }];
  if (media.idMal) externalIds.push({ source: "mal", id: String(media.idMal), mediaKind });
  return {
    entityType: "work",
    provider: "anilist",
    providerId: String(media.id),
    names,
    externalIds,
    mediaKind,
    ...(year === undefined ? {} : { year }),
    providerScore: Math.min(0.95, score),
    facts: {
      description: plainText(media.description),
      image: media.coverImage?.large ?? null,
      siteUrl: media.siteUrl ?? null,
      popularity: media.popularity ?? null,
    },
    evidence: [],
  };
}

function characterCandidate(
  character: z.infer<typeof characterSchema>,
  query: ResolveQuery,
  index: number,
  role: string | null = null,
): ProviderCandidate {
  const names = unique(
    [
      character.name.full,
      character.name.native,
      ...(character.name.alternative ?? []),
      ...(character.name.alternativeSpoiler ?? []),
    ].filter(isText),
  );
  const description = plainText(character.description);
  const appearance = parseAppearanceText(
    [description, character.gender ?? "", character.age ? `age ${character.age}` : ""].join("\n"),
  );
  const requestedAppearance = query.appearance ?? emptyAppearance();
  const match = scoreAppearanceMatch(requestedAppearance, appearance);
  const nameExact = names.some((name) => normalizeName(name) === normalizeName(query.text));
  const base = Math.max(0.5, 0.76 - Math.min(index, 10) * 0.02);
  const score = Math.min(
    0.95,
    base + (nameExact ? 0.12 : 0) + (hasAppearanceFacts(requestedAppearance) ? match.score * 0.17 : 0),
  );
  return {
    entityType: "character",
    provider: "anilist",
    providerId: String(character.id),
    names: names.length ? names : [String(character.id)],
    externalIds: [{ source: "anilist", id: String(character.id) }],
    providerScore: Number(score.toFixed(4)),
    facts: {
      appearance,
      description,
      gender: character.gender ?? null,
      age: character.age ?? null,
      bloodType: character.bloodType ?? null,
      role,
      image: character.image?.large ?? null,
      siteUrl: character.siteUrl ?? null,
      favourites: character.favourites ?? null,
    },
    evidence: [
      {
        provider: "anilist",
        kind: "appearance_match",
        value: match,
        weight: match.score,
      },
    ],
  };
}

function rankCharacterCandidate(
  candidate: ProviderCandidate,
  query: ResolveQuery,
  index: number,
): ProviderCandidate {
  const appearance = candidate.facts.appearance;
  const normalizedAppearance = z
    .object({
      hairColors: z.array(z.string()),
      eyeColors: z.array(z.string()),
      hairStyles: z.array(z.string()),
      genders: z.array(z.string()),
      apparentAges: z.array(z.string()),
      clothing: z.array(z.string()),
      traits: z.array(z.string()),
    })
    .safeParse(appearance);
  const requested = query.appearance ?? emptyAppearance();
  const match = scoreAppearanceMatch(requested, normalizedAppearance.success ? normalizedAppearance.data : emptyAppearance());
  const base = Math.max(0.5, 0.76 - Math.min(index, 10) * 0.02);
  const score = Math.min(
    0.95,
    base + characterNameBoost(query.text, candidate.names) +
      (hasAppearanceFacts(requested) ? match.score * 0.17 : 0),
  );
  return {
    ...candidate,
    providerScore: Number(score.toFixed(4)),
    evidence: [
      ...candidate.evidence.filter((item) => item.kind !== "appearance_match"),
      { provider: "anilist", kind: "appearance_match", value: match, weight: match.score },
    ],
  };
}

function characterNameBoost(text: string, names: string[]): number {
  const query = normalizeName(text);
  if (!query) return 0;
  const normalizedNames = names.map(normalizeName);
  if (normalizedNames.includes(query)) return 0.2;
  return normalizedNames.some((name) => name.includes(query) || query.includes(name)) ? 0.1 : 0;
}

function plainText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_`]/gu, "")
    .replace(/~!|!~/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/[ \t]+/gu, " ")
    .trim();
}

function numericId(value: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function bounded(value: number, maximum: number): number {
  return Math.max(1, Math.min(Math.trunc(value), maximum));
}

function formatKind(value: string | null | undefined): MediaKind {
  switch (value) {
    case "TV":
    case "TV_SHORT":
      return "tv";
    case "MOVIE":
      return "movie";
    case "OVA":
    case "SPECIAL":
      return "ova";
    case "ONA":
      return "web";
    default:
      return "unknown";
  }
}

function graphQlError(
  provider: string,
  errors: Array<{ message: string }>,
): ProviderRun<ProviderCandidate> {
  return invalidResponse(provider, errors.map((error) => error.message).join("; "));
}

function run(provider: string, items: ProviderCandidate[]): ProviderRun<ProviderCandidate> {
  return { provider, status: items.length ? "ok" : "empty", items };
}

function unsupported(provider: string, message: string): ProviderRun<ProviderCandidate> {
  return { provider, status: "unsupported", items: [], message };
}

function invalidResponse(provider: string, message: string): ProviderRun<ProviderCandidate> {
  return { provider, status: "invalid_response", items: [], message };
}

function isText(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

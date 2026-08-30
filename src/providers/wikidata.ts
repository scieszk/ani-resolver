import { z } from "zod";

import {
  emptyAppearance,
  hasAppearanceFacts,
  parseAppearanceText,
  scoreAppearanceMatch,
} from "../appearance.js";
import type {
  CharacterAppearance,
  ExternalId,
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRun,
  ResolveQuery,
} from "../types.js";
import { requestJson } from "./http.js";

const bindingValueSchema = z.object({ value: z.string() }).passthrough();
const sparqlSchema = z.object({
  results: z.object({
    bindings: z.array(z.record(z.string(), bindingValueSchema)),
  }),
});
const entitySearchSchema = z.object({
  search: z.array(
    z
      .object({
        id: z.string(),
        label: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        description: z.string().optional(),
      })
      .passthrough(),
  ),
});

type Binding = z.infer<typeof sparqlSchema>["results"]["bindings"][number];

const QID = /^Q[1-9][0-9]*$/;
const USER_AGENT = "ani-resolver/0.1.0 (https://github.com/scieszk/ani-resolver)";

const HAIR_COLOR_IDS: Record<string, string[]> = {
  white: ["Q6933946", "Q58628766"],
  silver: ["Q58628766", "Q6933946"],
  black: ["Q1922956"],
  blond: ["Q202466"],
  brown: ["Q2367101"],
  red: ["Q152357"],
  blue: ["Q4930092"],
  green: ["Q26449910"],
  purple: ["Q27790873"],
  pink: ["Q28962042"],
  orange: ["Q19916539"],
};

const EYE_COLOR_IDS: Record<string, string[]> = {
  white: ["Q62391724"],
  silver: ["Q66821598", "Q17245659"],
  black: ["Q17244465"],
  brown: ["Q17122705"],
  red: ["Q17126729"],
  blue: ["Q17122834"],
  green: ["Q17122854"],
  purple: ["Q27839441"],
  yellow: ["Q27777837"],
  pink: ["Q59318252"],
  orange: ["Q59318527"],
};

const HAIR_STYLE_IDS: Record<string, string[]> = {
  twintails: ["Q102292133"],
  ponytail: ["Q653122"],
  long_hair: ["Q14130", "Q102247646"],
  short_hair: ["Q17126303", "Q102247468"],
  braids: ["Q112999842"],
};

const GENDER_IDS: Record<string, string[]> = {
  female: ["Q6581072"],
  male: ["Q6581097"],
  nonbinary: ["Q48270"],
};

export interface WikidataProviderOptions {
  fetcher?: typeof fetch;
  sparqlUrl?: string;
  apiUrl?: string;
  userAgent?: string;
}

export class WikidataProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "wikidata",
    label: "Wikidata",
    mediaTypes: ["anime"],
    capabilities: [
      "character_search",
      "character_appearance_search",
      "character_detail",
      "work_characters",
      "id_mapping",
    ],
    languages: ["zh", "ja", "en"],
    auth: "none",
    strengths: ["Structured character appearance", "Cross-source character IDs", "CC0 data"],
    limitations: ["Appearance coverage varies by character", "Public query service rate limits apply"],
    homepage: "https://www.wikidata.org/",
    attribution: "Structured data from Wikidata (CC0)",
  };

  private readonly fetcher: typeof fetch;
  private readonly sparqlUrl: string;
  private readonly apiUrl: string;
  private readonly userAgent: string;

  constructor(options: WikidataProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.sparqlUrl = options.sparqlUrl ?? "https://query.wikidata.org/sparql";
    this.apiUrl = options.apiUrl ?? "https://www.wikidata.org/w/api.php";
    this.userAgent = options.userAgent ?? USER_AGENT;
  }

  async searchCharacters(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    if (query.work && (query.work.source !== "wikidata" || !QID.test(query.work.id))) {
      return unsupported(this.manifest.id, "Wikidata work filtering requires a valid Wikidata QID");
    }
    const appearance = query.appearance ?? emptyAppearance();
    const structuredSelector = appearanceSelector(appearance, query.work);
    if (!query.text.trim()) {
      if (!structuredSelector) {
        return unsupported(
          this.manifest.id,
          "Wikidata global appearance search requires a supported hair, eye, hairstyle, gender, or work condition",
        );
      }
      return this.runSparql(
        detailQuery(structuredSelector, Math.max(query.limit * 4, 20)),
        appearance,
        query.limit,
      );
    }

    const searched = await requestJson(
      this.manifest.id,
      this.fetcher,
      entitySearchUrl(this.apiUrl, query.text, Math.max(query.limit * 2, 5)),
      { headers: this.headers() },
    );
    if (!searched.ok) return searched.run;
    const parsed = entitySearchSchema.safeParse(searched.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    const ids = parsed.data.search.map((item) => item.id).filter((id) => QID.test(id));
    if (!ids.length) return run(this.manifest.id, []);
    const selectors = [
      `VALUES ?character { ${ids.map((id) => `wd:${id}`).join(" ")} }`,
      structuredSelector,
    ].filter((value): value is string => Boolean(value));
    return this.runSparql(
      detailQuery(selectors.join("\n"), ids.length),
      appearance,
      query.limit,
    );
  }

  async getEntity(
    id: ExternalId,
    entityType: "work" | "character",
  ): Promise<ProviderRun<ProviderCandidate>> {
    if (entityType !== "character" || id.source !== "wikidata" || !QID.test(id.id)) {
      return unsupported(this.manifest.id, "Wikidata character IDs must use wikidata:Q<number>");
    }
    return this.runSparql(detailQuery(`VALUES ?character { wd:${id.id} }`, 1), parseAppearanceText(""), 1);
  }

  async listWorkCharacters(work: ExternalId): Promise<ProviderRun<ProviderCandidate>> {
    if (work.source !== "wikidata" || !QID.test(work.id)) {
      return unsupported(this.manifest.id, "Wikidata work IDs must use wikidata:Q<number>");
    }
    return this.runSparql(
      detailQuery(`?character wdt:P1441 wd:${work.id}.`, 50),
      parseAppearanceText(""),
      50,
    );
  }

  private async runSparql(
    query: string,
    requestedAppearance: CharacterAppearance,
    limit: number,
  ): Promise<ProviderRun<ProviderCandidate>> {
    const url = new URL(this.sparqlUrl);
    url.searchParams.set("format", "json");
    url.searchParams.set("query", query);
    const result = await requestJson(this.manifest.id, this.fetcher, url, { headers: this.headers() });
    if (!result.ok) return result.run;
    const parsed = sparqlSchema.safeParse(result.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    const items = candidatesFromBindings(parsed.data.results.bindings, requestedAppearance)
      .sort((left, right) => right.providerScore - left.providerScore || left.providerId.localeCompare(right.providerId))
      .slice(0, limit);
    return run(this.manifest.id, items);
  }

  private headers(): Headers {
    return new Headers({ accept: "application/sparql-results+json, application/json", "user-agent": this.userAgent });
  }
}

function appearanceSelector(appearance: CharacterAppearance, work: ExternalId | undefined): string | undefined {
  const clauses = [
    valuesClause("hair", appearance.hairColors, HAIR_COLOR_IDS, "?character wdt:P1884 ?hair."),
    valuesClause("eye", appearance.eyeColors, EYE_COLOR_IDS, "?character wdt:P1340 ?eye."),
    valuesClause("style", appearance.hairStyles, HAIR_STYLE_IDS, "?character wdt:P8839 ?style."),
    valuesClause("gender", appearance.genders, GENDER_IDS, "?character wdt:P21 ?gender."),
  ].filter((value): value is string => Boolean(value));
  if (work) clauses.push(`?character wdt:P1441 wd:${work.id}.`);
  if (!clauses.length) return undefined;
  return clauses.join("\n");
}

function valuesClause(
  variable: string,
  values: string[],
  mapping: Record<string, string[]>,
  triple: string,
): string | undefined {
  const ids = [...new Set(values.flatMap((value) => mapping[value] ?? []))];
  if (!ids.length) return undefined;
  return `VALUES ?${variable} { ${ids.map((id) => `wd:${id}`).join(" ")} }\n${triple}`;
}

function detailQuery(selector: string, limit: number): string {
  const bounded = Math.max(1, Math.min(limit, 100));
  return `
SELECT DISTINCT ?character ?characterLabel ?characterAltLabel ?characterDescription ?image ?sitelinks
  ?hair ?hairLabel ?eye ?eyeLabel ?style ?styleLabel ?gender ?genderLabel
  ?clothing ?clothingLabel ?work ?workLabel ?anilistId ?anidbId ?acdbId ?bangumiId
WHERE {
  {
    SELECT DISTINCT ?character WHERE {
      ?character wdt:P31/wdt:P279* wd:Q95074.
      ${selector}
    }
    LIMIT ${bounded}
  }
  OPTIONAL { ?character rdfs:label ?characterLabel. FILTER(LANG(?characterLabel) IN ("zh", "ja", "en")) }
  OPTIONAL { ?character skos:altLabel ?characterAltLabel. FILTER(LANG(?characterAltLabel) IN ("zh", "ja", "en")) }
  OPTIONAL { ?character schema:description ?characterDescription. FILTER(LANG(?characterDescription) IN ("zh", "ja", "en")) }
  OPTIONAL { ?character wdt:P18 ?image. }
  OPTIONAL { ?character wikibase:sitelinks ?sitelinks. }
  OPTIONAL { ?character wdt:P1884 ?hair. }
  OPTIONAL { ?character wdt:P1340 ?eye. }
  OPTIONAL { ?character wdt:P8839 ?style. }
  OPTIONAL { ?character wdt:P21 ?gender. }
  OPTIONAL { ?character wdt:P3828 ?clothing. }
  OPTIONAL { ?character wdt:P1441 ?work. }
  OPTIONAL { ?character wdt:P11736 ?anilistId. }
  OPTIONAL { ?character wdt:P5648 ?anidbId. }
  OPTIONAL { ?character wdt:P7013 ?acdbId. }
  OPTIONAL { ?character wdt:P6296 ?bangumiId. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,ja,en". }
}`.trim();
}

function entitySearchUrl(apiUrl: string, text: string, limit: number): URL {
  const url = new URL(apiUrl);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "zh");
  url.searchParams.set("uselang", "zh");
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 20))));
  url.searchParams.set("search", text);
  return url;
}

function candidatesFromBindings(
  bindings: Binding[],
  requestedAppearance: CharacterAppearance,
): ProviderCandidate[] {
  const groups = new Map<string, Binding[]>();
  for (const binding of bindings) {
    const id = entityId(value(binding, "character"));
    if (!id) continue;
    const rows = groups.get(id) ?? [];
    rows.push(binding);
    groups.set(id, rows);
  }
  return [...groups].map(([id, rows]) => candidateFromRows(id, rows, requestedAppearance));
}

function candidateFromRows(
  id: string,
  rows: Binding[],
  requestedAppearance: CharacterAppearance,
): ProviderCandidate {
  const names = unique(rows.flatMap((row) => [value(row, "characterLabel"), value(row, "characterAltLabel")]).filter(Boolean));
  const descriptions = unique(rows.map((row) => value(row, "characterDescription")).filter(Boolean));
  const labels = unique(
    rows.flatMap((row) => [
      value(row, "hairLabel"),
      value(row, "eyeLabel"),
      value(row, "styleLabel"),
      value(row, "genderLabel"),
      value(row, "clothingLabel"),
    ]).filter(Boolean),
  );
  const appearanceLabels = unique(
    rows.flatMap((row) => {
      const hair = value(row, "hairLabel");
      const eyes = value(row, "eyeLabel");
      return [
        hair ? `${hair} hair` : "",
        eyes ? `${eyes}眼睛 ${eyes} eyes` : "",
        value(row, "styleLabel"),
        value(row, "genderLabel"),
        value(row, "clothingLabel"),
      ];
    }).filter(Boolean),
  );
  const appearance = parseAppearanceText(appearanceLabels.join("\n"));
  const match = scoreAppearanceMatch(requestedAppearance, appearance);
  const sitelinks = Math.max(...rows.map((row) => Number.parseInt(value(row, "sitelinks") || "0", 10)), 0);
  const externalIds = mergeExternalIds([
    { source: "wikidata", id },
    ...externalIdsFrom(rows, "bangumiId", "bangumi"),
    ...externalIdsFrom(rows, "anilistId", "anilist"),
    ...externalIdsFrom(rows, "anidbId", "anidb"),
    ...externalIdsFrom(rows, "acdbId", "acdb"),
  ]);
  const appearanceBoost = hasAppearanceFacts(requestedAppearance) ? match.score * 0.28 : 0.12;
  const popularityBoost = Math.min(0.08, Math.log10(sitelinks + 1) * 0.03);
  return {
    entityType: "character",
    provider: "wikidata",
    providerId: id,
    names: names.length ? names : [id],
    externalIds,
    providerScore: Math.min(0.95, Number((0.55 + appearanceBoost + popularityBoost).toFixed(4))),
    facts: {
      appearance,
      description: descriptions[0] ?? "",
      descriptions,
      image: rows.map((row) => value(row, "image")).find(Boolean) ?? null,
      works: unique(rows.map((row) => value(row, "workLabel")).filter(Boolean)),
      sitelinks,
    },
    evidence: [
      {
        provider: "wikidata",
        kind: "appearance_match",
        value: match,
        weight: match.score,
      },
      {
        provider: "wikidata",
        kind: "structured_statements",
        value: labels,
        weight: 0.9,
      },
    ],
  };
}

function externalIdsFrom(rows: Binding[], field: string, source: string): ExternalId[] {
  return unique(rows.map((row) => value(row, field)).filter(Boolean)).map((id) => ({ source, id }));
}

function value(binding: Binding, key: string): string {
  return binding[key]?.value?.trim() ?? "";
}

function entityId(uri: string): string | undefined {
  const id = uri.split("/").at(-1) ?? "";
  return QID.test(id) ? id : undefined;
}

function mergeExternalIds(ids: ExternalId[]): ExternalId[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const key = `${id.source}:${id.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
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

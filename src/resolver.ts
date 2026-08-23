import { parseContentInput } from "./input.js";
import type {
  Conflict,
  ContentEvidence,
  ExternalId,
  Provider,
  ProviderCandidate,
  ProviderRun,
  ResolveQuery,
  ResolveRequest,
  ResolveResult,
  ResolvedCandidate,
  SourceEvidence,
} from "./types.js";

export class Resolver {
  private readonly providers: Map<string, Provider>;
  private readonly providerTimeoutMs: number;

  constructor(providers: Provider[], options: { providerTimeoutMs?: number } = {}) {
    this.providers = new Map(providers.map((provider) => [provider.manifest.id, provider]));
    this.providerTimeoutMs = Math.max(1, options.providerTimeoutMs ?? 15_000);
  }

  listProviders() {
    return [...this.providers.values()].map((provider) => provider.manifest);
  }

  async resolve(request: ResolveRequest): Promise<ResolveResult> {
    const parsed = await parseContentInput(request.input);
    const limit = Math.max(1, Math.min(request.limit ?? 5, 50));
    const query = toResolveQuery(parsed, request, limit);
    const publicQuery = {
      ...parsed,
      entityType: request.entityType,
      ...(query.work ? { work: query.work } : {}),
    };
    const exact = exactCandidates(parsed, request.entityType);

    if (exact.length > 0) {
      return {
        schemaVersion: "ani-resolver.resolve.v1",
        query: publicQuery,
        candidates: exact,
        providerRuns: [],
      };
    }

    const selected = this.selectProviders(request.providers);
    const providerRuns = await Promise.all(
      selected.map((provider) =>
        runProvider(
          provider,
          queryForProvider(query, parsed.externalIds, provider),
          this.providerTimeoutMs,
        ),
      ),
    );
    const candidates = fuseCandidates(
      providerRuns.flatMap((run) => run.items),
      query,
    ).slice(0, limit);

    return {
      schemaVersion: "ani-resolver.resolve.v1",
      query: publicQuery,
      candidates,
      providerRuns: providerRuns.map(summarizeProviderRun),
    };
  }

  private selectProviders(ids: string[] | undefined): Provider[] {
    if (!ids?.length) return [...this.providers.values()];
    const unknown = [...new Set(ids.filter((id) => !this.providers.has(id)))];
    if (unknown.length > 0) {
      throw new Error(`Unknown provider${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
    }
    return ids.map((id) => this.providers.get(id)!);
  }
}

function summarizeProviderRun(run: ProviderRun) {
  return {
    provider: run.provider,
    status: run.status,
    itemCount: run.items.length,
    ...(run.message ? { message: run.message } : {}),
    ...(run.elapsedMs !== undefined ? { elapsedMs: run.elapsedMs } : {}),
  };
}

function toResolveQuery(
  parsed: ContentEvidence,
  request: ResolveRequest,
  limit: number,
): ResolveQuery {
  const query: ResolveQuery = {
    entityType: request.entityType,
    text: parsed.display,
    title: parsed.title,
    limit,
  };
  if (parsed.year !== undefined) query.year = parsed.year;
  if (parsed.season !== undefined) query.season = parsed.season;
  if (parsed.episode !== undefined) query.episode = parsed.episode;
  if (parsed.mediaKind !== undefined) query.mediaKind = parsed.mediaKind;
  if (request.work !== undefined) query.work = request.work;
  else if (request.entityType === "character" && parsed.externalIds.length === 1) {
    const parsedWork = parsed.externalIds[0];
    if (parsedWork) query.work = parsedWork;
  }
  return query;
}

function queryForProvider(
  query: ResolveQuery,
  parsedIds: ExternalId[],
  provider: Provider,
): ResolveQuery {
  if (query.entityType !== "character" || query.work || parsedIds.length === 0) return query;
  const work = parsedIds.find((id) => id.source === provider.manifest.id) ?? parsedIds[0];
  return work ? { ...query, work } : query;
}

function exactCandidates(
  parsed: ContentEvidence,
  entityType: ResolveRequest["entityType"],
): ResolvedCandidate[] {
  if (entityType !== "work" || parsed.externalIds.length === 0) return [];
  const sourceCounts = new Map<string, number>();
  for (const id of parsed.externalIds) {
    sourceCounts.set(id.source, (sourceCounts.get(id.source) ?? 0) + 1);
  }
  const idGroups = [...sourceCounts.values()].some((count) => count > 1)
    ? parsed.externalIds.map((id) => [id])
    : [parsed.externalIds];

  return idGroups.map((externalIds) => exactCandidate(parsed, entityType, externalIds));
}

function exactCandidate(
  parsed: ContentEvidence,
  entityType: ResolveRequest["entityType"],
  externalIds: ExternalId[],
): ResolvedCandidate {
  return {
    key: candidateKey(entityType, externalIds, parsed.title),
    entityType,
    score: 1,
    names: parsed.title ? [parsed.title] : [],
    externalIds,
    ...(parsed.mediaKind ? { mediaKind: parsed.mediaKind } : {}),
    ...(parsed.year !== undefined ? { year: parsed.year } : {}),
    facts: {},
    evidence: [
      {
        provider: "explicit_input",
        kind: "external_id",
        value: externalIds,
        weight: 1,
      },
    ],
    conflicts: [],
    sources: ["explicit_input"],
  };
}

async function runProvider(
  provider: Provider,
  query: ResolveQuery,
  timeoutMs: number,
): Promise<ProviderRun> {
  const started = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const method = query.entityType === "work" ? provider.searchWorks : provider.searchCharacters;
    if (!method) {
      return {
        provider: provider.manifest.id,
        status: "unsupported",
        items: [],
        message: `${query.entityType}_search is not supported`,
        elapsedMs: Date.now() - started,
      };
    }
    const run = await Promise.race([
      method.call(provider, query),
      new Promise<ProviderRun>((resolve) => {
        timeout = setTimeout(
          () =>
            resolve({
              provider: provider.manifest.id,
              status: "unavailable",
              items: [],
              message: `Timed out after ${timeoutMs}ms`,
            }),
          timeoutMs,
        );
      }),
    ]);
    return { ...run, elapsedMs: Date.now() - started };
  } catch (error) {
    return {
      provider: provider.manifest.id,
      status: "unavailable",
      items: [],
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function fuseCandidates(candidates: ProviderCandidate[], query: ResolveQuery): ResolvedCandidate[] {
  const clusters: ProviderCandidate[][] = [];
  for (const candidate of candidates) {
    const cluster = clusters.find((items) => canMerge(items[0]!, candidate, query));
    if (cluster) cluster.push(candidate);
    else clusters.push([candidate]);
  }

  return clusters
    .map((cluster) => resolveCluster(cluster, query))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
}

function canMerge(left: ProviderCandidate, right: ProviderCandidate, query: ResolveQuery): boolean {
  if (left.entityType !== right.entityType) return false;
  if (left.provider === right.provider) return left.providerId === right.providerId;
  if (left.year !== undefined && right.year !== undefined && left.year !== right.year) return false;
  if (left.mediaKind && right.mediaKind && left.mediaKind !== right.mediaKind) return false;
  if (sharesExternalId(left.externalIds, right.externalIds)) return true;

  const leftNames = new Set(left.names.map(normalizeName));
  if (right.names.some((name) => leftNames.has(normalizeName(name)))) return true;

  const normalizedQuery = normalizeName(query.title ?? query.text);
  return (
    normalizedQuery.length > 0 &&
    left.names.some((name) => normalizeName(name) === normalizedQuery) &&
    right.names.some((name) => normalizeName(name) === normalizedQuery)
  );
}

function resolveCluster(cluster: ProviderCandidate[], query: ResolveQuery): ResolvedCandidate {
  const names = unique(cluster.flatMap((candidate) => candidate.names));
  const externalIds = mergeExternalIds(cluster.flatMap((candidate) => candidate.externalIds));
  const sources = unique(cluster.map((candidate) => candidate.provider));
  const evidence: SourceEvidence[] = cluster.flatMap((candidate) => [
    {
      provider: candidate.provider,
      kind: "provider_candidate",
      value: { providerId: candidate.providerId, names: candidate.names },
      weight: candidate.providerScore,
    },
    ...candidate.evidence,
  ]);
  const conflicts = collectConflicts(cluster);
  const score = clusterScore(cluster, query, names, sources.length, conflicts.length);
  const mediaKind = cluster.find((candidate) => candidate.mediaKind)?.mediaKind;
  const year = cluster.find((candidate) => candidate.year !== undefined)?.year;

  return {
    key: candidateKey(cluster[0]!.entityType, externalIds, names[0] ?? cluster[0]!.providerId),
    entityType: cluster[0]!.entityType,
    score,
    names,
    externalIds,
    ...(mediaKind ? { mediaKind } : {}),
    ...(year !== undefined ? { year } : {}),
    facts: mergeFacts(cluster),
    evidence,
    conflicts,
    sources,
  };
}

function clusterScore(
  cluster: ProviderCandidate[],
  query: ResolveQuery,
  names: string[],
  sourceCount: number,
  conflictCount: number,
): number {
  let score = Math.max(...cluster.map((candidate) => candidate.providerScore));
  score += Math.max(0, sourceCount - 1) * 0.03;
  const normalizedQuery = normalizeName(query.title ?? query.text);
  if (names.some((name) => normalizeName(name) === normalizedQuery)) score += 0.03;
  const year = cluster.find((candidate) => candidate.year !== undefined)?.year;
  if (query.year !== undefined && year === query.year) score += 0.02;
  score -= conflictCount * 0.15;
  return Math.max(0, Math.min(0.99, Number(score.toFixed(4))));
}

function collectConflicts(cluster: ProviderCandidate[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const years = unique(cluster.flatMap((candidate) => (candidate.year === undefined ? [] : [candidate.year])));
  if (years.length > 1) {
    conflicts.push({ field: "year", values: years, providers: unique(cluster.map((item) => item.provider)) });
  }
  const mediaKinds = unique(cluster.flatMap((candidate) => (candidate.mediaKind ? [candidate.mediaKind] : [])));
  if (mediaKinds.length > 1) {
    conflicts.push({
      field: "mediaKind",
      values: mediaKinds,
      providers: unique(cluster.map((item) => item.provider)),
    });
  }
  return conflicts;
}

function mergeFacts(cluster: ProviderCandidate[]): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const candidate of cluster) {
    for (const [key, value] of Object.entries(candidate.facts)) {
      if (!(key in facts)) facts[key] = value;
      else if (JSON.stringify(facts[key]) !== JSON.stringify(value)) {
        const existing = Array.isArray(facts[key]) ? (facts[key] as unknown[]) : [facts[key]];
        facts[key] = uniqueBy([...existing, value], (item) => JSON.stringify(item));
      }
    }
  }
  return facts;
}

function candidateKey(entityType: string, ids: ExternalId[], fallback: string): string {
  const id = [...ids].sort((left, right) => left.source.localeCompare(right.source))[0];
  return id
    ? `${entityType}:${id.source}:${id.mediaKind ?? "unknown"}:${id.id}`
    : `${entityType}:derived:${normalizeName(fallback)}`;
}

function sharesExternalId(left: ExternalId[], right: ExternalId[]): boolean {
  return left.some((a) =>
    right.some(
      (b) =>
        a.source === b.source &&
        a.id === b.id &&
        (a.mediaKind === undefined || b.mediaKind === undefined || a.mediaKind === b.mediaKind),
    ),
  );
}

function mergeExternalIds(items: ExternalId[]): ExternalId[] {
  const merged: ExternalId[] = [];
  for (const item of items) {
    const index = merged.findIndex(
      (existing) =>
        existing.source === item.source &&
        existing.id === item.id &&
        (existing.mediaKind === undefined ||
          item.mediaKind === undefined ||
          existing.mediaKind === item.mediaKind),
    );
    if (index === -1) {
      merged.push(item);
    } else if (merged[index]?.mediaKind === undefined && item.mediaKind !== undefined) {
      merged[index] = item;
    }
  }
  return merged;
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

import type { ContentInventory } from "./inventory.js";
import type {
  ContentEvidence,
  ImageResolveResult,
  ProviderRelatedEntity,
  ResolveResult,
  ResolvedCandidate,
} from "./types.js";

export interface CliOutputOptions {
  json?: boolean;
}

export function writeCliOutput(
  stream: NodeJS.WritableStream,
  value: unknown,
  options: CliOutputOptions = {},
): void {
  const output = options.json ? JSON.stringify(value) : formatHuman(value);
  stream.write(`${output}\n`);
}

export function writeCliJson(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function formatHuman(value: unknown): string {
  const record = asRecord(value);
  if (!record) return String(value);
  if (record.schemaVersion === "ani-resolver.resolve.v1") {
    return formatResolve(value as unknown as ResolveResult);
  }
  if (record.schemaVersion === "ani-resolver.image.v1") {
    return formatImage(value as unknown as ImageResolveResult);
  }
  if (record.schemaVersion === "ani-resolver.inventory.v1") {
    return formatInventory(value as unknown as ContentInventory);
  }
  if (record.schemaVersion === "ani-resolver.relations.v1") {
    return formatRelations(record);
  }
  if (Array.isArray(record.providers)) return formatProviders(record.providers);
  if (asRecord(record.provider)?.capabilities) return formatProvider(asRecord(record.provider)!);
  if (
    typeof record.provider === "string" &&
    typeof record.status === "string" &&
    Array.isArray(record.items)
  ) {
    return formatProviderItems(record);
  }
  if (Array.isArray(record.items) && typeof record.total === "number") {
    return formatHistory(record.items, record.total);
  }
  if (asRecord(record.run)?.id) return formatRun(asRecord(record.run)!);
  if (typeof record.kind === "string" && typeof record.title === "string") {
    return formatEvidence(value as ContentEvidence & { fileCount?: number });
  }
  return formatGeneric(record);
}

function formatResolve(result: ResolveResult): string {
  const lines = [
    `Outcome: ${result.outcome}`,
    `Query: ${result.query.display || result.query.title}`,
  ];
  if (result.candidates.length === 0) lines.push("Candidates: none");
  result.candidates.forEach((candidate, index) => lines.push(...formatCandidate(candidate, index + 1)));
  appendProviderRuns(lines, result.providerRuns);
  return lines.join("\n");
}

function formatCandidate(candidate: ResolvedCandidate, rank: number): string[] {
  const title = candidate.names[0] ?? candidate.key;
  const details = [
    candidate.year !== undefined ? String(candidate.year) : undefined,
    candidate.mediaKind,
    `score ${candidate.score.toFixed(3)}`,
  ].filter(Boolean).join(", ");
  const lines = [`${rank}. ${title}${details ? ` (${details})` : ""}`];
  const ids = formatExternalIds(candidate.externalIds);
  if (ids) lines.push(`   IDs: ${ids}`);
  if (candidate.sources.length > 0) lines.push(`   Sources: ${candidate.sources.join(", ")}`);
  return lines;
}

function formatImage(result: ImageResolveResult): string {
  const lines = [`Outcome: ${result.outcome}`, `Image: ${result.query.display}`];
  if (result.matches.length === 0) lines.push("Matches: none");
  result.matches.forEach((match, index) => {
    const signal = match.similarity === undefined
      ? ""
      : `, similarity ${match.similarity}${match.similarityScale ? ` ${match.similarityScale}` : ""}`;
    lines.push(`${index + 1}. ${match.names[0] ?? match.providerId} (${match.matchType}${signal})`);
    const ids = formatExternalIds(match.externalIds);
    if (ids) lines.push(`   IDs: ${ids}`);
  });
  appendProviderRuns(lines, result.providerRuns);
  return lines.join("\n");
}

function formatInventory(result: ContentInventory): string {
  const lines = [
    `Title: ${result.source.title}`,
    `Source: ${result.source.kind} (${result.source.display})`,
    `Files: ${result.summary.fileCount}`,
    `Episodes: ${result.summary.episodeCount}`,
    `Kinds: ${Object.entries(result.summary.byKind).map(([kind, count]) => `${kind}=${count}`).join(", ") || "none"}`,
  ];
  if (result.summary.skippedSymlinkCount > 0) {
    lines.push(`Skipped symlinks: ${result.summary.skippedSymlinkCount}`);
  }
  for (const group of result.episodes) {
    const label = `${group.season === undefined ? "" : `S${String(group.season).padStart(2, "0")}`}E${String(group.episode).padStart(2, "0")}`;
    lines.push(`${label}: ${group.fileCount} file${group.fileCount === 1 ? "" : "s"}`);
  }
  if (result.unassignedCount > 0) lines.push(`Unassigned: ${result.unassignedCount}`);
  return lines.join("\n");
}

function formatRelations(record: Record<string, unknown>): string {
  const relations = Array.isArray(record.relations)
    ? record.relations as ProviderRelatedEntity[]
    : [];
  const lines = [`Outcome: ${String(record.outcome)}`];
  if (relations.length === 0) lines.push("Relations: none");
  relations.forEach((relation, index) => {
    lines.push(`${index + 1}. ${relation.names[0] ?? relation.providerId} (${relation.entityType}${relation.relation ? `, ${relation.relation}` : ""})`);
    const ids = formatExternalIds(relation.externalIds);
    if (ids) lines.push(`   IDs: ${ids}`);
  });
  const providerRuns = Array.isArray(record.providerRuns) ? record.providerRuns : [];
  appendProviderRuns(lines, providerRuns as ResolveResult["providerRuns"]);
  return lines.join("\n");
}

function formatProviders(values: unknown[]): string {
  const providers = values
    .map(asRecord)
    .filter((provider): provider is Record<string, unknown> => Boolean(provider));
  if (providers.length === 0) return "Providers: none";
  return ["ID\tStatus\tAuth\tCapabilities", ...providers.map((provider) => {
    const capabilities = Array.isArray(provider.capabilities)
      ? provider.capabilities.join(",")
      : "none";
    return `${String(provider.id)}\t${String(provider.status ?? "loaded")}\t${String(provider.auth ?? "unknown")}\t${capabilities}`;
  })].join("\n");
}

function formatProviderItems(run: Record<string, unknown>): string {
  const items = run.items as unknown[];
  const lines = [
    `Provider: ${String(run.provider)}`,
    `Status: ${String(run.status)}`,
  ];
  if (typeof run.message === "string" && run.message) lines.push(`Message: ${run.message}`);
  if (items.length === 0) lines.push("Items: none");
  items.forEach((value, index) => {
    const item = asRecord(value);
    if (!item) return;
    const names = Array.isArray(item.names)
      ? item.names.filter((name): name is string => typeof name === "string")
      : [];
    const details = [item.entityType, item.mediaKind, item.year, item.relation]
      .filter((detail) => detail !== undefined && detail !== null && detail !== "")
      .map(String)
      .join(", ");
    lines.push(`${index + 1}. ${names[0] ?? String(item.providerId ?? "unknown")}${details ? ` (${details})` : ""}`);
    const ids = Array.isArray(item.externalIds)
      ? item.externalIds.map(asRecord).filter((id): id is Record<string, unknown> => {
        if (!id) return false;
        return typeof id.source === "string" && typeof id.id === "string";
      }).map((id) => ({
        source: String(id.source),
        id: String(id.id),
        ...(typeof id.mediaKind === "string" ? { mediaKind: id.mediaKind } : {}),
      }))
      : [];
    const formattedIds = formatExternalIds(ids);
    if (formattedIds) lines.push(`   IDs: ${formattedIds}`);
  });
  return lines.join("\n");
}

function formatProvider(provider: Record<string, unknown>): string {
  const lines = [
    `Provider: ${String(provider.label ?? provider.id)}`,
    `ID: ${String(provider.id)}`,
    `Status: ${String(provider.status ?? "loaded")}`,
    `Authentication: ${String(provider.auth ?? "unknown")}`,
  ];
  if (Array.isArray(provider.capabilities)) lines.push(`Capabilities: ${provider.capabilities.join(", ")}`);
  if (Array.isArray(provider.strengths)) lines.push(`Strengths: ${provider.strengths.join("; ")}`);
  if (Array.isArray(provider.limitations)) lines.push(`Limitations: ${provider.limitations.join("; ")}`);
  return lines.join("\n");
}

function formatHistory(values: unknown[], total: number): string {
  const lines = [`Runs: ${total}`];
  for (const value of values) {
    const run = asRecord(value);
    if (!run) continue;
    lines.push(`${String(run.id)}\t${String(run.status)}\t${String(run.resolvedTarget)}\t${String(run.input)}`);
  }
  return lines.join("\n");
}

function formatRun(run: Record<string, unknown>): string {
  return [
    `Run: ${String(run.id)}`,
    `Status: ${String(run.status)}`,
    `Target: ${String(run.resolvedTarget)}`,
    `Input: ${String(run.input)}`,
    `Created: ${String(run.createdAt)}`,
  ].join("\n");
}

function formatEvidence(evidence: ContentEvidence & { fileCount?: number }): string {
  const lines = [
    `Title: ${evidence.title}`,
    `Kind: ${evidence.kind}`,
  ];
  if (evidence.year !== undefined) lines.push(`Year: ${evidence.year}`);
  if (evidence.season !== undefined) lines.push(`Season: ${evidence.season}`);
  if (evidence.episode !== undefined) lines.push(`Episode: ${evidence.episode}`);
  const ids = formatExternalIds(evidence.externalIds);
  if (ids) lines.push(`IDs: ${ids}`);
  lines.push(`Files: ${evidence.fileCount ?? evidence.files.length}`);
  return lines.join("\n");
}

function formatGeneric(record: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (value === null || typeof value !== "object") {
      lines.push(`${humanize(key)}: ${String(value)}`);
    } else {
      lines.push(`${humanize(key)}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n") || "OK";
}

function appendProviderRuns(lines: string[], runs: ResolveResult["providerRuns"]): void {
  if (runs.length === 0) return;
  lines.push("Providers:");
  for (const run of runs) {
    const message = run.message ? ` - ${run.message}` : "";
    lines.push(`  ${run.provider}: ${run.status} (${run.itemCount})${message}`);
  }
}

function formatExternalIds(ids: Array<{ source: string; id: string; mediaKind?: string }>): string {
  return ids.map((id) => {
    const source = id.source === "tmdb" && id.mediaKind && id.mediaKind !== "unknown"
      ? `tmdb-${id.mediaKind}`
      : id.source;
    return `${source}:${id.id}`;
  }).join(", ");
}

function humanize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).replaceAll(/([A-Z])/g, " $1")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

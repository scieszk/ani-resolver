import type { WebRun } from "./types.js";

export interface DisplayExternalId {
  source: string;
  id: string;
  mediaKind?: string;
}

export interface DisplayResultItem {
  entityType: string;
  title: string;
  alternateNames: string[];
  confidence?: number;
  image?: string;
  description?: string;
  meta: string[];
  externalIds: DisplayExternalId[];
  facts: Array<{ label: string; value: string }>;
  providers: string[];
  raw: Record<string, unknown>;
}

export interface HistorySummary {
  input: string;
  output: string;
  confidence?: number;
  entityType: string;
}

export function resultItems(result: unknown): DisplayResultItem[] {
  const record = asRecord(result);
  if (!record) return [];
  const values = arrayOfRecords(record.candidates ?? record.matches ?? record.items);
  return values.map((value) => normalizeItem(value));
}

export function summarizeRun(run: WebRun): HistorySummary {
  const first = resultItems(run.result)[0];
  return {
    input: run.input || run.attachments.map((attachment) => attachment.fileName).join(", ") || "Untitled run",
    output: first?.title ?? (run.status === "failed" ? "Failed" : run.status === "pending" ? "Resolving" : "No match"),
    ...(first?.confidence !== undefined ? { confidence: first.confidence } : {}),
    entityType: first?.entityType ?? run.resolvedTarget,
  };
}

export function providerRuns(result: unknown): Array<Record<string, unknown>> {
  const record = asRecord(result);
  return record ? arrayOfRecords(record.providerRuns) : [];
}

function normalizeItem(item: Record<string, unknown>): DisplayResultItem {
  const facts = asRecord(item.facts) ?? {};
  const names = stringArray(item.names);
  const entityType = stringValue(item.entityType ?? item.matchType) ?? "entity";
  const confidence = normalizeConfidence(item);
  const image = firstString(facts.image, facts.cover, facts.poster, item.image);
  const description = firstString(facts.summary, facts.description, item.description);
  const meta = [
    typeof item.mediaKind === "string" ? item.mediaKind.toUpperCase() : undefined,
    numberOrString(item.year),
    firstString(facts.role, facts.occupation, facts.type),
  ].filter((value): value is string => Boolean(value));
  const externalIds = arrayOfRecords(item.externalIds)
    .map((id) => ({
      source: stringValue(id.source) ?? "id",
      id: stringValue(id.id) ?? "",
      ...(typeof id.mediaKind === "string" ? { mediaKind: id.mediaKind } : {}),
    }))
    .filter((id) => id.id);
  const providers = [
    ...stringArray(item.sources),
    ...(typeof item.provider === "string" ? [item.provider] : []),
  ];
  const factEntries = Object.entries(facts)
    .filter(([key, value]) => !["image", "cover", "poster", "summary", "description"].includes(key) && isDisplayValue(value))
    .slice(0, 6)
    .map(([key, value]) => ({ label: humanize(key), value: displayValue(value) }));
  return {
    entityType,
    title: names[0] ?? firstString(item.title, item.name) ?? "Untitled result",
    alternateNames: names.slice(1),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(image ? { image } : {}),
    ...(description ? { description } : {}),
    meta,
    externalIds,
    facts: factEntries,
    providers: [...new Set(providers)],
    raw: item,
  };
}

function normalizeConfidence(item: Record<string, unknown>): number | undefined {
  if (typeof item.score === "number") return clamp(item.score);
  if (typeof item.similarity === "number") {
    return clamp(item.similarityScale === "percent" ? item.similarity / 100 : item.similarity);
  }
  if (typeof item.providerScore === "number") return clamp(item.providerScore);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrString(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string" ? String(value) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = stringValue(value);
    if (found) return found;
  }
  return undefined;
}

function isDisplayValue(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && value.length > 0);
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return String(value);
}

function humanize(value: string): string {
  return value.replace(/[_-]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function clamp(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 1_000_000) / 1_000_000;
}

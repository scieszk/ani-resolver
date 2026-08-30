import { deriveResolutionOutcome } from "./outcome.js";
import { selectProvidersForOperation } from "./provider-selection.js";
import type {
  EntityType,
  ExternalId,
  Provider,
  ProviderRelatedEntity,
  ProviderRun,
  ProviderRunSummary,
  ResolutionOutcome,
} from "./types.js";

export interface EntityRelationsRequest {
  entityType: EntityType;
  externalIds: ExternalId[];
  providers: string[];
}

export interface EntityRelationsResult {
  schemaVersion: "ani-resolver.relations.v1";
  outcome: ResolutionOutcome;
  query: {
    entityType: EntityType;
    externalIds: ExternalId[];
  };
  relations: ProviderRelatedEntity[];
  providerRuns: ProviderRunSummary[];
}

export interface EntityRelationsResolverOptions {
  providerTimeoutMs?: number;
}

export class EntityRelationsResolver {
  private readonly providers: Provider[];
  private readonly providerTimeoutMs: number;

  constructor(providers: Provider[], options: EntityRelationsResolverOptions = {}) {
    this.providers = providers;
    this.providerTimeoutMs = Math.max(1, options.providerTimeoutMs ?? 8_000);
  }

  async resolve(request: EntityRelationsRequest): Promise<EntityRelationsResult> {
    if (request.externalIds.length === 0) throw new Error("At least one external ID is required");
    const selected = selectProvidersForOperation(
      this.providers,
      request.providers,
      "entity.relations",
    );
    const runs = await Promise.all(selected.map((provider) =>
      runProviderRelations(provider, request.externalIds, request.entityType, this.providerTimeoutMs)
    ));
    const relations = mergeRelatedEntities(runs.flatMap((run) => run.items));
    const providerRuns = runs.map(summarizeProviderRun);
    return {
      schemaVersion: "ani-resolver.relations.v1",
      outcome: deriveResolutionOutcome(relations.length, providerRuns),
      query: {
        entityType: request.entityType,
        externalIds: request.externalIds,
      },
      relations,
      providerRuns,
    };
  }
}

export async function runProviderRelations(
  provider: Provider,
  externalIds: ExternalId[],
  entityType: EntityType,
  timeoutMs: number,
): Promise<ProviderRun<ProviderRelatedEntity>> {
  const startedAt = Date.now();
  let lastUnsupported: ProviderRun<ProviderRelatedEntity> | undefined;
  for (const id of externalIds) {
    try {
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
      const run = await withTimeout(
        provider.listEntityRelations!(id, entityType),
        remainingMs,
        timeoutMs,
      );
      const completed = { ...run, elapsedMs: Date.now() - startedAt };
      if (run.status !== "unsupported") return completed;
      lastUnsupported = completed;
    } catch (error) {
      return {
        provider: provider.manifest.id,
        status: "unavailable",
        items: [],
        message: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      };
    }
  }
  return lastUnsupported ?? {
    provider: provider.manifest.id,
    status: "unsupported",
    items: [],
    message: "No supplied external ID is supported",
    elapsedMs: Date.now() - startedAt,
  };
}

export function mergeRelatedEntities(items: ProviderRelatedEntity[]): ProviderRelatedEntity[] {
  const merged: ProviderRelatedEntity[] = [];
  for (const item of items) {
    const existingIndex = merged.findIndex((candidate) => relatedEntitiesOverlap(candidate, item));
    if (existingIndex < 0) {
      merged.push({
        ...item,
        names: [...item.names],
        externalIds: [...item.externalIds],
        facts: { ...item.facts },
      });
      continue;
    }
    merged[existingIndex] = mergeRelated(merged[existingIndex]!, item);
  }
  return merged;
}

export function externalIdsOverlap(left: ExternalId, right: ExternalId): boolean {
  if (left.source !== right.source || left.id !== right.id) return false;
  const leftKind = left.mediaKind;
  const rightKind = right.mediaKind;
  return !leftKind || leftKind === "unknown" || !rightKind || rightKind === "unknown" || leftKind === rightKind;
}

function relatedEntitiesOverlap(left: ProviderRelatedEntity, right: ProviderRelatedEntity): boolean {
  if (left.entityType !== right.entityType) return false;
  if (left.externalIds.some((leftId) =>
    right.externalIds.some((rightId) => externalIdsOverlap(leftId, rightId))
  )) return true;
  return left.provider === right.provider && left.providerId === right.providerId;
}

function mergeRelated(left: ProviderRelatedEntity, right: ProviderRelatedEntity): ProviderRelatedEntity {
  const externalIds = [...left.externalIds];
  const externalIdKeys = new Set(externalIds.map(externalIdKey));
  for (const id of right.externalIds) {
    const key = externalIdKey(id);
    if (!externalIdKeys.has(key)) {
      externalIds.push(id);
      externalIdKeys.add(key);
    }
  }
  const image = left.image ?? right.image;
  const mediaKind = !left.mediaKind || left.mediaKind === "unknown"
    ? right.mediaKind ?? left.mediaKind
    : left.mediaKind;
  const year = left.year ?? right.year;
  const relation = left.relation ?? right.relation;
  return {
    ...left,
    names: [...new Set([...left.names, ...right.names])],
    externalIds,
    facts: { ...left.facts, ...right.facts },
    ...(image ? { image } : {}),
    ...(mediaKind ? { mediaKind } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(relation ? { relation } : {}),
  };
}

function externalIdKey(id: ExternalId): string {
  return `${id.source}:${id.id}:${id.mediaKind ?? ""}`;
}

function summarizeProviderRun(run: ProviderRun<ProviderRelatedEntity>): ProviderRunSummary {
  return {
    provider: run.provider,
    status: run.status,
    itemCount: run.items.length,
    ...(run.message ? { message: run.message } : {}),
    ...(run.elapsedMs !== undefined ? { elapsedMs: run.elapsedMs } : {}),
  };
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, configuredTimeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Relation lookup timed out after ${configuredTimeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

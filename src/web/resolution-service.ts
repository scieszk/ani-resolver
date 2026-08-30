import { ImageResolver } from "../image-resolver.js";
import { externalIdsOverlap, mergeRelatedEntities } from "../entity-relations.js";
import { ProviderManager, type ProviderListItem } from "../provider-management.js";
import { Resolver } from "../resolver.js";
import type {
  EntityType,
  ExternalId,
  Provider,
  ProviderRelatedEntity,
  ProviderRun,
  ProviderRunSummary,
} from "../types.js";
import { emptyFavoriteContext, type FavoriteContext } from "./favorite-context.js";
import type { FavoriteRecord } from "./run-store.js";
import type { ResolutionRequest, ResolutionService } from "./server.js";
import { selectResolutionInput } from "./target.js";

export interface DefaultResolutionServiceOptions {
  providerManager?: ProviderManager;
  providers?: Provider[];
  limit?: number;
  relationTimeoutMs?: number;
}

export class DefaultResolutionService implements ResolutionService {
  private readonly providerManager: ProviderManager;
  private readonly injectedProviders: Provider[] | undefined;
  private readonly limit: number;
  private readonly relationTimeoutMs: number;
  private loadedProviders: Promise<Provider[]> | undefined;
  private disposeProviders: (() => Promise<void>) | undefined;

  constructor(options: DefaultResolutionServiceOptions = {}) {
    this.providerManager = options.providerManager ?? new ProviderManager();
    this.injectedProviders = options.providers;
    this.limit = options.limit ?? 5;
    this.relationTimeoutMs = Math.max(1, options.relationTimeoutMs ?? 8_000);
  }

  async listProviders(): Promise<ProviderListItem[]> {
    if (!this.injectedProviders) return this.providerManager.list();
    return this.injectedProviders.map((provider) => ({
      ...provider.manifest,
      installed: true,
      initialized: true,
      status: "ready",
      distribution: "bundled",
    }));
  }

  async resolve(request: ResolutionRequest): Promise<{
    resolvedTarget: "work" | "character" | "image";
    result: unknown;
  }> {
    const attachments = request.attachments
      .filter((attachment) => attachment.stored && attachment.path)
      .map((attachment) => ({ kind: attachment.kind, path: attachment.path! }));
    const resolvedTarget = request.target;
    const input = selectResolutionInput({ input: request.input, target: resolvedTarget, attachments });
    if (!input && resolvedTarget !== "character") {
      throw new Error("No compatible input is available for this resolution target");
    }
    const providers = await this.providers();
    if (resolvedTarget === "image") {
      return {
        resolvedTarget,
        result: await new ImageResolver(providers).resolve({
          input,
          limit: this.limit,
          providers: request.providers,
        }),
      };
    }
    return {
      resolvedTarget,
      result: await new Resolver(providers).resolve({
        entityType: resolvedTarget,
        input,
        limit: this.limit,
        providers: request.providers,
        ...(request.appearance ? { appearance: request.appearance } : {}),
        ...(request.work ? { work: request.work } : {}),
      }),
    };
  }

  async getFavoriteContext(favorite: FavoriteRecord): Promise<FavoriteContext> {
    if (favorite.entityType !== "work" && favorite.entityType !== "character") {
      return emptyFavoriteContext();
    }
    const entityType = favorite.entityType;
    const externalIds = favoriteExternalIds(favorite);
    const providers = await this.providers();
    const direct = await Promise.all(
      providers
        .filter((provider) => provider.listEntityRelations)
        .map((provider) => relationRun(provider, externalIds, entityType, this.relationTimeoutMs)),
    );
    const completed = direct.filter((run): run is ProviderRun<ProviderRelatedEntity> => Boolean(run));
    const relations = completed.flatMap((run) => run.items);

    if (entityType === "character") {
      const works = mergeRelatedEntities(relations.filter((item) => item.entityType === "work")).slice(0, 2);
      const derived = await Promise.all(works.map(async (work) => {
        const provider = providers.find((candidate) => candidate.manifest.id === work.provider);
        return provider ? relationRun(provider, work.externalIds, "work", this.relationTimeoutMs) : null;
      }));
      for (const run of derived) {
        if (!run) continue;
        completed.push(run);
        relations.push(...run.items);
      }
    }

    const withoutFavorite = relations.filter((relation) =>
      !relation.externalIds.some((id) => externalIds.some((favoriteId) => externalIdsOverlap(id, favoriteId))),
    );
    return {
      works: mergeRelatedEntities(withoutFavorite.filter((item) => item.entityType === "work")).slice(0, 24),
      characters: mergeRelatedEntities(withoutFavorite.filter((item) => item.entityType === "character")).slice(0, 24),
      people: mergeRelatedEntities(withoutFavorite.filter((item) => item.entityType === "person")).slice(0, 24),
      providerRuns: completed.map(summarizeProviderRun),
      refreshedAt: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.disposeProviders?.();
    this.loadedProviders = undefined;
    this.disposeProviders = undefined;
  }

  private providers(): Promise<Provider[]> {
    if (this.injectedProviders) return Promise.resolve(this.injectedProviders);
    this.loadedProviders ??= this.providerManager.loadProviderHost().then((host) => {
      this.disposeProviders = () => host.dispose();
      return host.providers();
    });
    return this.loadedProviders;
  }
}

async function relationRun(
  provider: Provider,
  externalIds: ExternalId[],
  entityType: EntityType,
  timeoutMs: number,
): Promise<ProviderRun<ProviderRelatedEntity> | null> {
  if (!provider.listEntityRelations) return null;
  const startedAt = Date.now();
  for (const id of externalIds) {
    try {
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
      const run = await withTimeout(provider.listEntityRelations(id, entityType), remainingMs, timeoutMs);
      if (run.status !== "unsupported") return run;
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
  return null;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, configuredTimeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Relation lookup timed out after ${configuredTimeoutMs}ms`)), timeoutMs);
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

function favoriteExternalIds(favorite: FavoriteRecord): ExternalId[] {
  const candidate = asRecord(favorite.candidate);
  const values = Array.isArray(candidate?.externalIds) ? candidate.externalIds : [];
  return values.flatMap((value) => {
    const record = asRecord(value);
    if (typeof record?.source !== "string" || typeof record.id !== "string") return [];
    const mediaKind = record.mediaKind;
    return [{
      source: record.source,
      id: record.id,
      ...(mediaKind === "tv" || mediaKind === "movie" || mediaKind === "ova" || mediaKind === "web" || mediaKind === "unknown"
        ? { mediaKind }
        : {}),
    }];
  });
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

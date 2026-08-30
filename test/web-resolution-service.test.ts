import { describe, expect, it, vi } from "vitest";

import type {
  ExternalId,
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRelatedEntity,
  ProviderRun,
  ResolveQuery,
} from "../src/types.js";
import type { FavoriteRecord } from "../src/web/run-store.js";
import { DefaultResolutionService } from "../src/web/resolution-service.js";

class FixtureProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "fixture",
    label: "Fixture",
    mediaTypes: ["anime"],
    capabilities: ["work_search", "character_search", "character_appearance_search", "entity_relations"],
    languages: ["zh", "en"],
    auth: "none",
    strengths: ["tests"],
    limitations: [],
  };

  async searchWorks(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    return run({
      entityType: "work",
      provider: "fixture",
      providerId: "work-1",
      names: [query.title ?? query.text],
      externalIds: [{ source: "fixture", id: "work-1" }],
      providerScore: 0.9,
      facts: {},
      evidence: [],
    });
  }

  async searchCharacters(_query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    return run({
      entityType: "character",
      provider: "fixture",
      providerId: "character-1",
      names: ["Isla"],
      externalIds: [{ source: "fixture", id: "character-1" }],
      providerScore: 0.88,
      facts: {},
      evidence: [],
    });
  }

  async listEntityRelations(
    id: ExternalId,
    entityType: "work" | "character",
  ): Promise<ProviderRun<ProviderRelatedEntity>> {
    if (id.source !== "fixture" || entityType !== "character") {
      return { provider: "fixture", status: "unsupported", items: [] };
    }
    return {
      provider: "fixture",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "fixture",
          providerId: "work-1",
          names: ["Plastic Memories"],
          externalIds: [{ source: "fixture", id: "work-1" }],
          relation: "MAIN",
          facts: {},
        },
        {
          entityType: "person",
          provider: "fixture",
          providerId: "person-1",
          names: ["Sora Amamiya"],
          externalIds: [{ source: "fixture-person", id: "person-1" }],
          relation: "Voice actor",
          facts: {},
        },
      ],
    };
  }
}

describe("DefaultResolutionService", () => {
  it("forwards an explicit structured character request", async () => {
    const service = new DefaultResolutionService({ providers: [new FixtureProvider()] });
    const outcome = await service.resolve({
      input: "",
      target: "character",
      providers: ["all"],
      attachments: [],
      appearance: {
        hairColors: ["white"],
        eyeColors: [],
        hairStyles: ["twintails"],
        genders: ["female"],
        apparentAges: [],
        clothing: [],
        traits: ["expressionless"],
      },
    });

    expect(outcome.resolvedTarget).toBe("character");
    expect(outcome.result).toMatchObject({
      schemaVersion: "ani-resolver.resolve.v1",
      query: {
        entityType: "character",
        appearance: expect.objectContaining({ hairColors: ["white"], hairStyles: ["twintails"] }),
      },
      candidates: [expect.objectContaining({ entityType: "character", names: ["Isla"] })],
    });
    await service.close();
  });

  it("keeps explicit work resolution and provider selection intact", async () => {
    const service = new DefaultResolutionService({ providers: [new FixtureProvider()] });
    const outcome = await service.resolve({
      input: "[VCB-Studio] Dungeon Meshi [1080p][HEVC]",
      target: "work",
      providers: ["fixture"],
      attachments: [],
    });

    expect(outcome.resolvedTarget).toBe("work");
    expect(outcome.result).toMatchObject({
      query: { entityType: "work", title: "Dungeon Meshi" },
      providerRuns: [expect.objectContaining({ provider: "fixture", status: "ok" })],
    });
    await service.close();
  });

  it("builds an encyclopedia context for a confirmed favorite", async () => {
    const service = new DefaultResolutionService({ providers: [new FixtureProvider()] });
    const favorite: FavoriteRecord = {
      id: "favorite-1",
      entityKey: "character:fixture:character-1",
      entityType: "character",
      title: "Isla",
      candidate: {
        key: "character:fixture:character-1",
        entityType: "character",
        names: ["Isla"],
        externalIds: [{ source: "fixture", id: "character-1" }],
        sources: ["fixture"],
        facts: {},
      },
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:00:00.000Z",
    };

    const context = await service.getFavoriteContext(favorite);

    expect(context.works[0]).toMatchObject({ names: ["Plastic Memories"], relation: "MAIN" });
    expect(context.people[0]).toMatchObject({ names: ["Sora Amamiya"], relation: "Voice actor" });
    expect(context.providerRuns).toEqual([
      expect.objectContaining({ provider: "fixture", status: "ok", itemCount: 2 }),
    ]);
    await service.close();
  });

  it("does not treat unsupported favorite types as characters", async () => {
    const provider = new FixtureProvider();
    const relationSpy = vi.spyOn(provider, "listEntityRelations");
    const service = new DefaultResolutionService({ providers: [provider] });
    const favorite: FavoriteRecord = {
      id: "favorite-scene",
      entityKey: "anime_scene:trace.moe:123",
      entityType: "anime_scene",
      title: "Unknown scene",
      candidate: {
        matchType: "anime_scene",
        externalIds: [{ source: "trace.moe", id: "123" }],
      },
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:00:00.000Z",
    };

    await expect(service.getFavoriteContext(favorite)).resolves.toMatchObject({
      works: [],
      characters: [],
      people: [],
      providerRuns: [],
    });
    expect(relationSpy).not.toHaveBeenCalled();
    await service.close();
  });

  it("times out a hanging relation provider without discarding successful providers", async () => {
    const hangingProvider: Provider = {
      manifest: {
        id: "hanging",
        label: "Hanging",
        mediaTypes: ["anime"],
        capabilities: ["entity_relations"],
        languages: ["en"],
        auth: "none",
        strengths: [],
        limitations: [],
      },
      listEntityRelations: async () => new Promise<ProviderRun<ProviderRelatedEntity>>(() => undefined),
    };
    const service = new DefaultResolutionService({
      providers: [hangingProvider, new FixtureProvider()],
      relationTimeoutMs: 20,
    });
    const favorite: FavoriteRecord = {
      id: "favorite-1",
      entityKey: "character:fixture:character-1",
      entityType: "character",
      title: "Isla",
      candidate: {
        entityType: "character",
        externalIds: [{ source: "fixture", id: "character-1" }],
      },
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:00:00.000Z",
    };

    const context = await Promise.race([
      service.getFavoriteContext(favorite),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("relation timeout missing")), 250)),
    ]);

    expect(context.works[0]).toMatchObject({ names: ["Plastic Memories"] });
    expect(context.providerRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "hanging", status: "unavailable", itemCount: 0 }),
      expect.objectContaining({ provider: "fixture", status: "ok", itemCount: 2 }),
    ]));
    await service.close();
  });

  it("merges related entities when any compatible external ID overlaps", async () => {
    const duplicateProvider: Provider = {
      manifest: {
        id: "duplicate",
        label: "Duplicate",
        mediaTypes: ["anime"],
        capabilities: ["entity_relations"],
        languages: ["en"],
        auth: "none",
        strengths: [],
        limitations: [],
      },
      async listEntityRelations(id, entityType) {
        if (entityType !== "character" || id.source !== "fixture") {
          return { provider: "duplicate", status: "unsupported", items: [] };
        }
        return {
          provider: "duplicate",
          status: "ok",
          items: [{
            entityType: "work",
            provider: "duplicate",
            providerId: "duplicate-work-1",
            names: ["Plastic Memories", "Plamemo"],
            externalIds: [
              { source: "duplicate", id: "duplicate-work-1" },
              { source: "fixture", id: "work-1", mediaKind: "tv" },
            ],
            mediaKind: "tv",
            year: 2015,
            facts: { episodes: 13 },
          }],
        };
      },
    };
    const service = new DefaultResolutionService({ providers: [new FixtureProvider(), duplicateProvider] });
    const favorite: FavoriteRecord = {
      id: "favorite-1",
      entityKey: "character:fixture:character-1",
      entityType: "character",
      title: "Isla",
      candidate: {
        entityType: "character",
        externalIds: [{ source: "fixture", id: "character-1" }],
      },
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:00:00.000Z",
    };

    const context = await service.getFavoriteContext(favorite);

    expect(context.works).toHaveLength(1);
    expect(context.works[0]).toMatchObject({
      names: ["Plastic Memories", "Plamemo"],
      mediaKind: "tv",
      year: 2015,
      facts: { episodes: 13 },
    });
    expect(context.works[0]?.externalIds).toEqual(expect.arrayContaining([
      { source: "fixture", id: "work-1" },
      { source: "duplicate", id: "duplicate-work-1" },
    ]));
    await service.close();
  });
});

function run(candidate: ProviderCandidate): ProviderRun<ProviderCandidate> {
  return { provider: "fixture", status: "ok", items: [candidate] };
}

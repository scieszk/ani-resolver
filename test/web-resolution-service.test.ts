import { describe, expect, it } from "vitest";

import type {
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRun,
  ResolveQuery,
} from "../src/types.js";
import { DefaultResolutionService } from "../src/web/resolution-service.js";

class FixtureProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "fixture",
    label: "Fixture",
    mediaTypes: ["anime"],
    capabilities: ["work_search", "character_search"],
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
}

describe("DefaultResolutionService", () => {
  it("infers a character request and returns the typed resolver result", async () => {
    const service = new DefaultResolutionService({ providers: [new FixtureProvider()] });
    const outcome = await service.resolve({
      input: "女主是白发双马尾，前期没什么表情",
      target: "auto",
      providers: ["all"],
      attachments: [],
    });

    expect(outcome.resolvedTarget).toBe("character");
    expect(outcome.result).toMatchObject({
      schemaVersion: "ani-resolver.resolve.v1",
      query: { entityType: "character" },
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
});

function run(candidate: ProviderCandidate): ProviderRun<ProviderCandidate> {
  return { provider: "fixture", status: "ok", items: [candidate] };
}

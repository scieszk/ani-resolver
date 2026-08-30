import { describe, expect, it } from "vitest";

import { EntityRelationsResolver } from "../src/entity-relations.js";
import type {
  ExternalId,
  Provider,
  ProviderManifest,
  ProviderRelatedEntity,
  ProviderRun,
} from "../src/types.js";

function provider(
  id: string,
  run: ProviderRun<ProviderRelatedEntity>,
): Provider {
  const manifest: ProviderManifest = {
    id,
    label: id,
    mediaTypes: ["anime"],
    capabilities: ["entity_relations"],
    languages: ["en"],
    auth: "none",
    strengths: [],
    limitations: [],
  };
  return {
    manifest,
    async listEntityRelations(_externalId: ExternalId) {
      return run;
    },
  };
}

describe("EntityRelationsResolver", () => {
  it("merges related entities across explicitly selected providers", async () => {
    const left = provider("left", {
      provider: "left",
      status: "ok",
      items: [{
        entityType: "work",
        provider: "left",
        providerId: "work-left",
        names: ["Dungeon Meshi"],
        externalIds: [{ source: "anilist", id: "153518" }],
        mediaKind: "tv",
        facts: { role: "source" },
      }],
    });
    const right = provider("right", {
      provider: "right",
      status: "ok",
      items: [{
        entityType: "work",
        provider: "right",
        providerId: "work-right",
        names: ["Delicious in Dungeon"],
        externalIds: [
          { source: "anilist", id: "153518", mediaKind: "tv" },
          { source: "mal", id: "52701" },
        ],
        facts: { relation: "appears_in" },
      }],
    });

    const result = await new EntityRelationsResolver([left, right]).resolve({
      entityType: "character",
      externalIds: [{ source: "bangumi", id: "12080" }],
      providers: ["left", "right"],
    });

    expect(result).toMatchObject({
      schemaVersion: "ani-resolver.relations.v1",
      outcome: "matched",
      relations: [{
        entityType: "work",
        names: ["Dungeon Meshi", "Delicious in Dungeon"],
        externalIds: expect.arrayContaining([
          { source: "anilist", id: "153518", mediaKind: "tv" },
          { source: "mal", id: "52701" },
        ]),
      }],
    });
  });

  it("marks relation results partial when another selected provider fails", async () => {
    const healthy = provider("healthy", {
      provider: "healthy",
      status: "ok",
      items: [{
        entityType: "person",
        provider: "healthy",
        providerId: "person-1",
        names: ["Voice Actor"],
        externalIds: [],
        facts: {},
      }],
    });
    const failed = provider("failed", {
      provider: "failed",
      status: "rate_limited",
      items: [],
      message: "try later",
    });

    const result = await new EntityRelationsResolver([healthy, failed]).resolve({
      entityType: "work",
      externalIds: [{ source: "fixture", id: "1" }],
      providers: ["healthy", "failed"],
    });

    expect(result.outcome).toBe("partial");
    expect(result.providerRuns).toContainEqual(
      expect.objectContaining({ provider: "failed", status: "rate_limited" }),
    );
  });
});

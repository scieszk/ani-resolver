import { describe, expect, it } from "vitest";

import type { WebRun } from "../web/src/types.js";
import { resultItems, summarizeRun } from "../web/src/result-model.js";

describe("web result model", () => {
  it("normalizes ranked work and character candidates", () => {
    const items = resultItems({
      schemaVersion: "ani-resolver.resolve.v1",
      candidates: [
        {
          entityType: "work",
          names: ["Dungeon Meshi", "Delicious in Dungeon"],
          score: 0.93,
          mediaKind: "tv",
          year: 2024,
          externalIds: [{ source: "tmdb", id: "123" }],
          facts: { image: "https://example.test/cover.jpg", summary: "A dungeon adventure." },
          sources: ["tmdb", "bangumi"],
        },
      ],
      providerRuns: [],
    });

    expect(items[0]).toMatchObject({
      key: "work:tmdb:123",
      entityType: "work",
      title: "Dungeon Meshi",
      confidence: 0.93,
      image: "https://example.test/cover.jpg",
      meta: ["TV", "2024"],
      externalIds: [{ source: "tmdb", id: "123" }],
    });
  });

  it("keeps native image-match semantics while normalizing percent similarity", () => {
    const items = resultItems({
      schemaVersion: "ani-resolver.image.v1",
      matches: [
        {
          matchType: "anime_scene",
          names: ["Plastic Memories"],
          similarity: 87.4,
          similarityScale: "percent",
          facts: { episode: 1, image: "https://example.test/frame.jpg" },
          externalIds: [],
          provider: "trace-moe",
        },
      ],
      providerRuns: [],
    });

    expect(items[0]).toMatchObject({
      entityType: "anime_scene",
      title: "Plastic Memories",
      confidence: 0.874,
      image: "https://example.test/frame.jpg",
    });
  });

  it("renders future generic entities instead of assuming every result is anime", () => {
    const items = resultItems({
      schemaVersion: "example.generic.v1",
      items: [
        {
          entityType: "person",
          names: ["Hayao Miyazaki"],
          score: 0.81,
          facts: { occupation: "Director" },
          externalIds: [{ source: "wikidata", id: "Q55400" }],
        },
      ],
    });

    expect(items[0]).toMatchObject({ entityType: "person", title: "Hayao Miyazaki" });
  });

  it("summarizes a history run as input to top output", () => {
    const summary = summarizeRun(fixtureRun());
    expect(summary).toMatchObject({
      input: "Isla · White · Twintails · Expressionless",
      output: "Isla",
      confidence: 0.91,
      entityType: "character",
    });
  });
});

function fixtureRun(): WebRun {
  return {
    id: "run-1",
    input: "Isla",
    requestedTarget: "character",
    resolvedTarget: "character",
    status: "completed",
    providers: ["all"],
    query: {
      appearance: {
        hairColors: ["white"], eyeColors: [], hairStyles: ["twintails"],
        genders: [], apparentAges: [], clothing: [], traits: ["expressionless"],
      },
    },
    attachments: [],
    createdAt: "2026-08-30T01:00:00.000Z",
    updatedAt: "2026-08-30T01:00:01.000Z",
    result: {
      schemaVersion: "ani-resolver.resolve.v1",
      candidates: [
        {
          key: "character:anilist:unknown:88753",
          entityType: "character",
          names: ["Isla"],
          score: 0.91,
          facts: {},
          externalIds: [],
        },
      ],
    },
  };
}

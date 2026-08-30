import { describe, expect, it } from "vitest";

import { ImageResolver } from "../src/image-resolver.js";
import type {
  ImageMatch,
  ImageQuery,
  Provider,
  ProviderManifest,
  ProviderRun,
} from "../src/types.js";

function imageMatch(provider: string, rank: number): ImageMatch {
  return {
    provider,
    providerId: `${provider}-${rank}`,
    matchType: "anime_scene",
    rank,
    similarity: 0.9 - rank * 0.01,
    names: [`Match ${rank}`],
    externalIds: [],
    facts: {},
    evidence: [],
  };
}

class ImageFixtureProvider implements Provider {
  readonly manifest: ProviderManifest;

  constructor(
    id: string,
    private readonly search: (query: ImageQuery) => Promise<ProviderRun<ImageMatch>>,
  ) {
    this.manifest = {
      id,
      label: id,
      mediaTypes: ["anime"],
      capabilities: ["anime_scene_lookup"],
      languages: ["en"],
      auth: "none",
      strengths: ["tests"],
      limitations: [],
    };
  }

  async searchImage(query: ImageQuery): Promise<ProviderRun<ImageMatch>> {
    return this.search(query);
  }
}

class TextFixtureProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "text-only",
    label: "Text only",
    mediaTypes: ["anime"],
    capabilities: ["work_search"],
    languages: ["en"],
    auth: "none",
    strengths: ["tests"],
    limitations: [],
  };
}

describe("ImageResolver", () => {
  it("rejects duplicate provider IDs instead of silently replacing one", () => {
    const duplicate = new ImageFixtureProvider("duplicate", async () => ({
      provider: "duplicate",
      status: "empty",
      items: [],
    }));

    expect(() => new ImageResolver([duplicate, duplicate])).toThrow(
      "Duplicate provider ID: duplicate",
    );
  });

  it("expands all to image-capable providers and preserves ordered native match signals", async () => {
    const scene = new ImageFixtureProvider("scene", async (query) => ({
      provider: "scene",
      status: "ok",
      items: [imageMatch("scene", 1), imageMatch("scene", 2), imageMatch("scene", 3)],
      message: `limit=${query.limit}`,
    }));
    const resolver = new ImageResolver([new TextFixtureProvider(), scene]);

    const result = await resolver.resolve({
      input: "https://example.test/frame.jpg?token=private",
      limit: 2,
      providers: ["all"],
    });

    expect(result).toEqual({
      schemaVersion: "ani-resolver.image.v1",
      outcome: "matched",
      query: { kind: "url", display: "https://example.test/frame.jpg" },
      matches: [imageMatch("scene", 1), imageMatch("scene", 2)],
      providerRuns: [
        expect.objectContaining({ provider: "scene", status: "ok", itemCount: 2 }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("isolates provider failures while retaining other provider matches", async () => {
    const failed = new ImageFixtureProvider("failed", async () => {
      throw new Error("upstream unavailable");
    });
    const source = new ImageFixtureProvider("source", async () => ({
      provider: "source",
      status: "ok",
      items: [{ ...imageMatch("source", 1), matchType: "source" }],
    }));
    const resolver = new ImageResolver([failed, source]);

    const result = await resolver.resolve({
      input: "https://example.test/frame.png",
      providers: ["failed", "source"],
    });

    expect(result.matches).toEqual([{ ...imageMatch("source", 1), matchType: "source" }]);
    expect(result.outcome).toBe("partial");
    expect(result.providerRuns).toEqual([
      expect.objectContaining({
        provider: "failed",
        status: "unavailable",
        itemCount: 0,
        message: "upstream unavailable",
      }),
      expect.objectContaining({ provider: "source", status: "ok", itemCount: 1 }),
    ]);
  });

  it("reports unavailable when no selected image provider could run", async () => {
    const failed = new ImageFixtureProvider("failed", async () => ({
      provider: "failed",
      status: "rate_limited",
      items: [],
      message: "quota exhausted",
    }));

    const result = await new ImageResolver([failed]).resolve({
      input: "https://example.test/frame.png",
      providers: ["failed"],
    });

    expect(result.outcome).toBe("unavailable");
  });

  it("redacts a signed input URL echoed by a provider error", async () => {
    const failed = new ImageFixtureProvider("failed", async (query) => ({
      provider: "failed",
      status: "invalid_response",
      items: [],
      message: `Could not fetch ${query.input.source}`,
    }));
    const resolver = new ImageResolver([failed]);

    const result = await resolver.resolve({
      input: "https://example.test/frame.jpg?signature=private",
      providers: ["failed"],
    });

    expect(result.providerRuns[0]?.message).toBe(
      "Could not fetch https://example.test/frame.jpg",
    );
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("rejects explicit text-only providers before invoking compatible providers", async () => {
    let calls = 0;
    const scene = new ImageFixtureProvider("scene", async () => {
      calls += 1;
      return { provider: "scene", status: "empty", items: [] };
    });
    const resolver = new ImageResolver([scene, new TextFixtureProvider()]);

    await expect(
      resolver.resolve({
        input: "https://example.test/frame.png",
        providers: ["scene", "text-only"],
      }),
    ).rejects.toMatchObject({
      code: "unsupported_provider_capability",
      details: {
        operation: "resolve.image",
        providers: ["text-only"],
        compatibleProviders: ["scene"],
      },
    });
    expect(calls).toBe(0);
  });

  it("requires an explicit provider selection", async () => {
    const resolver = new ImageResolver([]);

    await expect(
      resolver.resolve({ input: "https://example.test/frame.png", providers: [] }),
    ).rejects.toMatchObject({ code: "missing_provider_selection" });
  });

  it("still isolates runtime failures after provider validation", async () => {
    const stalled = new ImageFixtureProvider(
      "stalled",
      async () => await new Promise<ProviderRun<ImageMatch>>(() => undefined),
    );
    const source = new ImageFixtureProvider("source", async () => ({
      provider: "source",
      status: "empty",
      items: [],
    }));
    const resolver = new ImageResolver([stalled, source], {
      providerTimeoutMs: 5,
    });

    const result = await resolver.resolve({
      input: "https://example.test/frame.png",
      providers: ["stalled", "source"],
    });

    expect(result.providerRuns).toEqual([
      expect.objectContaining({ provider: "stalled", status: "unavailable", itemCount: 0 }),
      expect.objectContaining({ provider: "source", status: "empty", itemCount: 0 }),
    ]);
  });

  it("rejects unknown explicitly selected providers", async () => {
    const resolver = new ImageResolver([]);

    await expect(
      resolver.resolve({ input: "https://example.test/frame.png", providers: ["missing"] }),
    ).rejects.toThrow("Unknown provider: missing");
  });
});

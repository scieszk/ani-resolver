import { afterEach, describe, expect, it, vi } from "vitest";

import { Resolver } from "../src/resolver.js";
import type {
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRun,
  ResolveQuery,
} from "../src/types.js";

const manifest = (id: string): ProviderManifest => ({
  id,
  label: id,
  mediaTypes: ["anime"],
  capabilities: ["work_search"],
  languages: ["zh", "ja", "en"],
  auth: "none",
  strengths: [],
  limitations: [],
});

class FakeProvider implements Provider {
  constructor(
    readonly manifest: ProviderManifest,
    private readonly run: ProviderRun<ProviderCandidate>,
  ) {}

  async searchWorks(_query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    return this.run;
  }
}

describe("Resolver", () => {
  afterEach(() => vi.useRealTimers());

  it("fuses matching work candidates and preserves TMDB and Bangumi IDs", async () => {
    const bangumi = new FakeProvider(manifest("bangumi"), {
      provider: "bangumi",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "bangumi",
          providerId: "400602",
          names: ["葬送的芙莉莲", "葬送のフリーレン", "Sousou no Frieren"],
          externalIds: [{ source: "bangumi", id: "400602" }],
          mediaKind: "tv",
          year: 2023,
          providerScore: 0.93,
          facts: {},
          evidence: [],
        },
      ],
    });
    const tmdb = new FakeProvider(manifest("tmdb"), {
      provider: "tmdb",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "tmdb",
          providerId: "209867",
          names: ["葬送的芙莉莲", "葬送のフリーレン"],
          externalIds: [{ source: "tmdb", id: "209867" }],
          mediaKind: "tv",
          year: 2023,
          providerScore: 0.9,
          facts: {},
          evidence: [],
        },
      ],
    });

    const result = await new Resolver([bangumi, tmdb]).resolve({
      entityType: "work",
      input: "葬送的芙莉莲 (2023)",
      limit: 5,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.externalIds).toEqual(
      expect.arrayContaining([
        { source: "bangumi", id: "400602" },
        { source: "tmdb", id: "209867" },
      ]),
    );
    expect(result.candidates[0]?.score).toBeGreaterThan(0.9);
    expect(result.providerRuns).toHaveLength(2);
    expect(result.providerRuns[0]).not.toHaveProperty("items");
    expect(result.providerRuns[0]).toHaveProperty("itemCount", 1);
  });

  it("merges normalized appearance facts into one stable object", async () => {
    const left = new FakeProvider(manifest("left"), {
      provider: "left",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "left",
          providerId: "1",
          names: ["Example"],
          externalIds: [{ source: "shared", id: "1" }],
          providerScore: 0.8,
          facts: {
            appearance: {
              hairColors: ["white"], eyeColors: [], hairStyles: ["twintails"],
              genders: [], apparentAges: [], clothing: [], traits: [],
            },
          },
          evidence: [],
        },
      ],
    });
    const right = new FakeProvider(manifest("right"), {
      provider: "right",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "right",
          providerId: "2",
          names: ["Example"],
          externalIds: [{ source: "shared", id: "1" }],
          providerScore: 0.79,
          facts: {
            appearance: {
              hairColors: ["silver"], eyeColors: ["green"], hairStyles: [],
              genders: ["female"], apparentAges: [], clothing: [], traits: ["expressionless"],
            },
          },
          evidence: [],
        },
      ],
    });

    const result = await new Resolver([left, right]).resolve({
      entityType: "work",
      input: "Example",
    });

    expect(result.candidates[0]?.facts.appearance).toEqual({
      hairColors: ["white", "silver"],
      eyeColors: ["green"],
      hairStyles: ["twintails"],
      genders: ["female"],
      apparentAges: [],
      clothing: [],
      traits: ["expressionless"],
    });
  });

  it("fuses the same external ID when only one provider knows its media kind", async () => {
    const online = new FakeProvider(manifest("bangumi"), {
      provider: "bangumi",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "bangumi",
          providerId: "395378",
          names: ["迷宫饭"],
          externalIds: [{ source: "bangumi", id: "395378" }],
          mediaKind: "tv",
          providerScore: 0.9,
          facts: {},
          evidence: [],
        },
      ],
    });
    const archive = new FakeProvider(manifest("bangumi-archive"), {
      provider: "bangumi-archive",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "bangumi-archive",
          providerId: "395378",
          names: ["ダンジョン飯"],
          externalIds: [{ source: "bangumi", id: "395378", mediaKind: "tv" }],
          mediaKind: "tv",
          providerScore: 0.88,
          facts: {},
          evidence: [],
        },
      ],
    });

    const result = await new Resolver([online, archive]).resolve({
      entityType: "work",
      input: "Dungeon Meshi",
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sources).toEqual(["bangumi", "bangumi-archive"]);
    expect(result.candidates[0]?.externalIds).toEqual([
      { source: "bangumi", id: "395378", mediaKind: "tv" },
    ]);
  });

  it("isolates provider failures and still returns other candidates", async () => {
    const failed = new FakeProvider(manifest("failed"), {
      provider: "failed",
      status: "unavailable",
      items: [],
      message: "upstream timeout",
    });
    const healthy = new FakeProvider(manifest("healthy"), {
      provider: "healthy",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "healthy",
          providerId: "1",
          names: ["Example"],
          externalIds: [],
          mediaKind: "tv",
          year: 2024,
          providerScore: 0.8,
          facts: {},
          evidence: [],
        },
      ],
    });

    const result = await new Resolver([failed, healthy]).resolve({
      entityType: "work",
      input: "Example",
      limit: 5,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.providerRuns).toContainEqual(
      expect.objectContaining({ provider: "failed", status: "unavailable" }),
    );
  });

  it("resolves characters without inventing a work identity", async () => {
    const provider = new FakeProvider(
      { ...manifest("bangumi"), capabilities: ["character_search"] },
      {
        provider: "bangumi",
        status: "ok",
        items: [
          {
            entityType: "character",
            provider: "bangumi",
            providerId: "12080",
            names: ["アイラ", "Isla"],
            externalIds: [{ source: "bangumi", id: "12080" }],
            providerScore: 0.82,
            facts: { gender: "female" },
            evidence: [],
          },
          {
            entityType: "character",
            provider: "bangumi",
            providerId: "99999",
            names: ["アイラ", "Isla"],
            externalIds: [{ source: "bangumi", id: "99999" }],
            providerScore: 0.78,
            facts: { gender: "female" },
            evidence: [],
          },
        ],
      },
    );
    provider.searchCharacters = provider.searchWorks;

    const result = await new Resolver([provider]).resolve({
      entityType: "character",
      input: "Isla",
      limit: 3,
    });

    expect(result.candidates[0]).toMatchObject({
      entityType: "character",
      names: ["アイラ", "Isla"],
    });
    expect(result.candidates).toHaveLength(2);
  });

  it("keeps same-provider entities separate even when a mapped ID overlaps", async () => {
    const provider = new FakeProvider(manifest("catalog"), {
      provider: "catalog",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "catalog",
          providerId: "season-1",
          names: ["Example"],
          externalIds: [
            { source: "catalog", id: "season-1" },
            { source: "tmdb", id: "101", mediaKind: "tv" },
          ],
          providerScore: 0.9,
          facts: {},
          evidence: [],
        },
        {
          entityType: "work",
          provider: "catalog",
          providerId: "season-2",
          names: ["Example"],
          externalIds: [
            { source: "catalog", id: "season-2" },
            { source: "tmdb", id: "101", mediaKind: "tv" },
          ],
          providerScore: 0.85,
          facts: {},
          evidence: [],
        },
      ],
    });

    const result = await new Resolver([provider]).resolve({
      entityType: "work",
      input: "Example",
    });

    expect(result.candidates).toHaveLength(2);
  });

  it("returns duplicate-source explicit IDs as separate possibilities", async () => {
    const result = await new Resolver([]).resolve({
      entityType: "work",
      input: "Example [tmdbid=101] [tmdbid=202]",
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.externalIds)).toEqual([
      [{ source: "tmdb", id: "101" }],
      [{ source: "tmdb", id: "202" }],
    ]);
  });

  it("does not reinterpret work tags as exact character IDs", async () => {
    const result = await new Resolver([]).resolve({
      entityType: "character",
      input: "Example [tmdbid=101]/Season 1/Example S01E01.mkv",
    });

    expect(result.candidates).toEqual([]);
  });

  it("times out a provider that never settles", async () => {
    vi.useFakeTimers();
    const stalled: Provider = {
      manifest: manifest("stalled"),
      async searchWorks() {
        return await new Promise<ProviderRun<ProviderCandidate>>(() => undefined);
      },
    };
    const resolution = new Resolver([stalled], { providerTimeoutMs: 10 }).resolve({
      entityType: "work",
      input: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example",
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(11);

    await expect(Promise.race([resolution, Promise.resolve("still pending")])).resolves.toMatchObject({
      providerRuns: [
        expect.objectContaining({ provider: "stalled", status: "unavailable", message: "Timed out after 10ms" }),
      ],
    });
  });

  it("preserves a character work constraint in the public query", async () => {
    const work = { source: "tmdb", id: "101", mediaKind: "tv" } as const;
    const result = await new Resolver([]).resolve({
      entityType: "character",
      input: "white hair",
      work,
    });

    expect(result.query).toMatchObject({ work });
  });

  it("rejects unknown provider selections", async () => {
    await expect(
      new Resolver([]).resolve({
        entityType: "work",
        input: "Example",
        providers: ["missing"],
      }),
    ).rejects.toThrow("Unknown provider: missing");
  });

  it("uses a parsed work ID to constrain character providers", async () => {
    let observedWork: ResolveQuery["work"];
    const provider: Provider = {
      manifest: { ...manifest("bangumi"), capabilities: ["character_search"] },
      async searchCharacters(query) {
        observedWork = query.work;
        return { provider: "bangumi", status: "empty", items: [] };
      },
    };

    const result = await new Resolver([provider]).resolve({
      entityType: "character",
      input: "Example [bgmid=400602]/Season 1/Example S01E01.mkv",
    });

    expect(observedWork).toEqual({ source: "bangumi", id: "400602" });
    expect(result.query.work).toEqual(observedWork);
  });
});

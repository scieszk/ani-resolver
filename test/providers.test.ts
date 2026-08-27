import { afterEach, describe, expect, it, vi } from "vitest";

import { BangumiProvider } from "../src/providers/bangumi.js";
import { requestJson } from "../src/providers/http.js";
import { TmdbProvider } from "../src/providers/tmdb.js";

afterEach(() => vi.useRealTimers());

describe("requestJson", () => {
  it("aborts a stalled fetch at the HTTP boundary", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const request = requestJson("fixture", fetcher, "https://example.test", undefined, 10);

    await vi.advanceTimersByTimeAsync(11);

    await expect(request).resolves.toMatchObject({
      ok: false,
      run: { provider: "fixture", status: "unavailable" },
    });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("keeps the timeout active while reading the response body", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      return {
        ok: true,
        async json() {
          return await new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason));
          });
        },
      } as Response;
    });
    const request = requestJson("fixture", fetcher, "https://example.test", undefined, 10);

    await vi.advanceTimersByTimeAsync(11);

    await expect(Promise.race([request, Promise.resolve("still pending")])).resolves.toMatchObject({
      ok: false,
      run: { provider: "fixture", status: "unavailable" },
    });
  });
});

describe("BangumiProvider", () => {
  it("keeps the underlying network cause in provider failures", async () => {
    const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed", { cause }));

    const result = await new BangumiProvider({ fetcher }).searchWorks({
      entityType: "work",
      text: "Example",
      title: "Example",
      limit: 5,
    });

    expect(result).toMatchObject({ status: "unavailable" });
    expect(result.message).toContain("ECONNRESET");
  });

  it("searches anime works with a project User-Agent", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 400602,
              name: "葬送のフリーレン",
              name_cn: "葬送的芙莉莲",
              date: "2023-09-29",
              platform: "TV",
              summary: "",
              infobox: [
                {
                  key: "别名",
                  value: [{ v: "Sousou no Frieren" }],
                },
              ],
              images: { large: "https://example.test/cover.jpg" },
              type: 2,
              nsfw: false,
            },
          ],
          total: 1,
          limit: 5,
          offset: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new BangumiProvider({ fetcher });

    const result = await provider.searchWorks({
      entityType: "work",
      text: "葬送的芙莉莲",
      title: "葬送的芙莉莲",
      limit: 5,
    });

    expect(result.status).toBe("ok");
    expect(result.items[0]?.names).toEqual(
      expect.arrayContaining(["葬送的芙莉莲", "Sousou no Frieren"]),
    );
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("user-agent")).toContain("ani-resolver");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      keyword: "葬送的芙莉莲",
      filter: { type: [2], nsfw: false },
    });
  });

  it("accepts a null release date in Bangumi work search results", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 395378,
              name: "ダンジョン飯",
              name_cn: "迷宫饭",
              date: "2024-01-04",
              platform: "TV",
              summary: "",
              infobox: [],
              images: null,
              type: 2,
            },
            {
              id: 999999,
              name: "Dungeon Meshi related entry",
              name_cn: "",
              date: null,
              platform: "TV",
              summary: "",
              infobox: [],
              images: null,
              type: 2,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await new BangumiProvider({ fetcher }).searchWorks({
      entityType: "work",
      text: "Dungeon Meshi",
      title: "Dungeon Meshi",
      limit: 5,
    });

    expect(result).toMatchObject({ status: "ok" });
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).not.toHaveProperty("year");
  });

  it("normalizes character records and source facts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 12080,
              name: "アイラ",
              type: 1,
              summary: "白发双马尾，感情表达较少。",
              infobox: [
                { key: "简体中文名", value: "艾拉" },
                { key: "性别", value: "女" },
              ],
              images: { large: "https://example.test/isla.jpg" },
            },
          ],
          total: 1,
          limit: 5,
          offset: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await new BangumiProvider({ fetcher }).searchCharacters({
      entityType: "character",
      text: "艾拉",
      limit: 5,
    });

    expect(result.items[0]).toMatchObject({
      entityType: "character",
      providerId: "12080",
      names: ["アイラ", "艾拉"],
      facts: {
        gender: "女",
        summary: "白发双马尾，感情表达较少。",
        appearance: expect.objectContaining({
          hairColors: ["white"],
          hairStyles: ["twintails"],
          genders: ["female"],
          traits: ["expressionless"],
        }),
      },
    });
  });

  it("accepts nullable Bangumi character infobox and images", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 42, name: "Example", type: 1, summary: "", infobox: null, images: null }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await new BangumiProvider({ fetcher }).searchCharacters({
      entityType: "character",
      text: "Example",
      limit: 5,
    });

    expect(result).toMatchObject({ status: "ok" });
    expect(result.items[0]).toMatchObject({
      providerId: "42",
      facts: { image: null },
    });
  });

  it("does not silently drop a non-Bangumi work constraint", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const result = await new BangumiProvider({ fetcher }).searchCharacters({
      entityType: "character",
      text: "white hair",
      work: { source: "tmdb", id: "101", mediaKind: "tv" },
      limit: 5,
    });

    expect(result).toMatchObject({
      status: "unsupported",
      message: "Bangumi character filtering requires a Bangumi work ID",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("TmdbProvider", () => {
  it("reports auth_required when no token is configured", async () => {
    const result = await new TmdbProvider({ token: "" }).searchWorks({
      entityType: "work",
      text: "Frieren",
      title: "Frieren",
      limit: 5,
    });

    expect(result).toMatchObject({ provider: "tmdb", status: "auth_required", items: [] });
  });

  it("returns TMDB IDs from TV and movie search results", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 209867,
              media_type: "tv",
              name: "Frieren: Beyond Journey's End",
              original_name: "葬送のフリーレン",
              first_air_date: "2023-09-29",
              overview: "",
              poster_path: "/poster.jpg",
              popularity: 100,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await new TmdbProvider({ token: "token", fetcher }).searchWorks({
      entityType: "work",
      text: "Frieren",
      title: "Frieren",
      year: 2023,
      limit: 5,
    });

    expect(result.items[0]).toMatchObject({
      providerId: "209867",
      externalIds: [{ source: "tmdb", id: "209867", mediaKind: "tv" }],
      mediaKind: "tv",
      year: 2023,
    });
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.has("year")).toBe(false);
  });

  it("uses a TMDB v3 API key when no access token is configured", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await new TmdbProvider({ token: "", apiKey: "api-key", fetcher }).searchWorks({
      entityType: "work",
      text: "Frieren",
      title: "Frieren",
      limit: 5,
    });

    expect(result.status).toBe("empty");
    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(new URL(String(input)).searchParams.get("api_key")).toBe("api-key");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it("fetches a TMDB work using the media kind carried by its external ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 209867,
          name: "Frieren: Beyond Journey's End",
          original_name: "葬送のフリーレン",
          first_air_date: "2023-09-29",
          overview: "",
          poster_path: null,
          popularity: 100,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new TmdbProvider({ token: "token", fetcher });

    const result = await provider.getEntity(
      { source: "tmdb", id: "209867", mediaKind: "tv" },
      "work",
    );

    expect(result.items[0]).toMatchObject({ providerId: "209867", mediaKind: "tv" });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/tv/209867");
  });
});

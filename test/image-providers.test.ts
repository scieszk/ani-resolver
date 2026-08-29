import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnimeTraceProvider } from "../src/providers/animetrace.js";
import { SauceNaoProvider } from "../src/providers/saucenao.js";
import { TraceMoeProvider } from "../src/providers/trace-moe.js";
import type { ImageQuery, ProviderImageInput } from "../src/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function urlInput(source = "https://images.example.test/frame.jpg?signature=private"): ProviderImageInput {
  return {
    kind: "url",
    source,
    display: "https://images.example.test/frame.jpg",
  };
}

function query(input: ProviderImageInput = urlInput(), limit = 5): ImageQuery {
  return { input, limit };
}

async function jpegInput(fileName = "frame.jpg"): Promise<ProviderImageInput> {
  const directory = await mkdtemp(path.join(tmpdir(), "ani-resolver-provider-image-"));
  temporaryDirectories.push(directory);
  const source = path.join(directory, fileName);
  await writeFile(source, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]));
  return {
    kind: "file",
    source,
    display: source,
    fileName,
    mimeType: "image/jpeg",
    size: 6,
  };
}

describe("TraceMoeProvider", () => {
  it("maps scene timing, previews, titles, and AniList IDs without changing similarity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          frameCount: 10320513,
          error: "",
          result: [
            {
              anilist: {
                id: 154587,
                idMal: 52991,
                isAdult: false,
                synonyms: ["Frieren"],
                title: {
                  native: "葬送のフリーレン",
                  romaji: "Sousou no Frieren",
                  english: "Frieren: Beyond Journey's End",
                },
              },
              filename: "[SubsPlease] Sousou no Frieren - 01.mkv",
              episode: 1,
              from: 123.5,
              to: 125.5,
              at: 124.5,
              duration: 1440,
              similarity: 0.947123,
              video: "https://api.trace.moe/video/preview",
              image: "https://api.trace.moe/image/preview",
            },
            {
              anilist: {
                id: 154587,
                idMal: 52991,
                isAdult: false,
                synonyms: ["Frieren"],
                title: {
                  native: "葬送のフリーレン",
                  romaji: "Sousou no Frieren",
                  english: "Frieren: Beyond Journey's End",
                },
              },
              filename: "[Alternate] Sousou no Frieren - 01.mkv",
              episode: 1,
              from: 123.5,
              to: 125.5,
              at: 124.5,
              duration: 1440,
              similarity: 0.947123,
              video: "https://api.trace.moe/video/alternate",
              image: "https://api.trace.moe/image/alternate",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new TraceMoeProvider({ fetcher, apiKey: "trace-key" });

    const result = await provider.searchImage(query(urlInput(), 3));

    expect(result).toMatchObject({ provider: "trace-moe", status: "ok" });
    expect(result.items[0]).toMatchObject({
      provider: "trace-moe",
      matchType: "anime_scene",
      rank: 1,
      similarity: 0.947123,
      names: expect.arrayContaining([
        "Sousou no Frieren",
        "Frieren: Beyond Journey's End",
        "葬送のフリーレン",
      ]),
      externalIds: expect.arrayContaining([
        { source: "anilist", id: "154587", mediaKind: "tv" },
        { source: "mal", id: "52991", mediaKind: "tv" },
      ]),
      facts: {
        filename: "[SubsPlease] Sousou no Frieren - 01.mkv",
        episode: 1,
        from: 123.5,
        to: 125.5,
        at: 124.5,
        duration: 1440,
        previewImage: "https://api.trace.moe/image/preview",
        previewVideo: "https://api.trace.moe/video/preview",
        isAdult: false,
      },
    });
    expect(new Set(result.items.map((item) => item.providerId)).size).toBe(2);
    const [input, init] = fetcher.mock.calls[0] ?? [];
    const requestUrl = new URL(String(input));
    expect(requestUrl.pathname).toBe("/search");
    expect(requestUrl.searchParams.get("url")).toContain("signature=private");
    expect(requestUrl.searchParams.has("anilistInfo")).toBe(true);
    expect(requestUrl.searchParams.has("cutBorders")).toBe(true);
    expect(new Headers(init?.headers).get("x-trace-key")).toBe("trace-key");
  });

  it("uploads local image bytes with the detected content type", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ frameCount: 0, error: "", result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new TraceMoeProvider({ fetcher });

    const result = await provider.searchImage(query(await jpegInput()));

    expect(result.status).toBe("empty");
    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(new URL(String(input)).searchParams.has("url")).toBe(false);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]),
    );
  });

  it("keeps result IDs stable when expiring preview URLs change", async () => {
    const result = (preview: string) => ({
      frameCount: 1,
      error: "",
      result: [
        {
          anilist: 154587,
          filename: "[SubsPlease] Sousou no Frieren - 01.mkv",
          episode: 1,
          from: 123.5,
          to: 125.5,
          at: 124.5,
          similarity: 0.947123,
          video: preview.replace("image", "video"),
          image: preview,
        },
      ],
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(result("https://api.trace.moe/image/first"))))
      .mockResolvedValueOnce(new Response(JSON.stringify(result("https://api.trace.moe/image/second"))));
    const provider = new TraceMoeProvider({ fetcher });

    const first = await provider.searchImage(query());
    const second = await provider.searchImage(query());

    expect(first.items[0]?.providerId).toBe(second.items[0]?.providerId);
  });

  it("reports quotas and malformed responses explicitly", async () => {
    const limited = new TraceMoeProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: "Daily quota exceeded" }), { status: 402 }),
      ),
    });
    const malformed = new TraceMoeProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ result: [{ similarity: "high" }] }), { status: 200 }),
      ),
    });

    await expect(limited.searchImage(query())).resolves.toMatchObject({ status: "rate_limited" });
    await expect(malformed.searchImage(query())).resolves.toMatchObject({
      status: "invalid_response",
    });
  });
});

describe("SauceNaoProvider", () => {
  it("requires an API key before uploading an image", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const result = await new SauceNaoProvider({ fetcher, apiKey: "" }).searchImage(query());

    expect(result).toMatchObject({ provider: "saucenao", status: "auth_required", items: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps source database metadata, creator fields, URLs, IDs, and similarity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          header: { status: 0, message: "", results_requested: 3 },
          results: [
            {
              header: {
                similarity: "92.34",
                thumbnail: "https://img.example.test/thumb.jpg",
                index_id: 5,
                index_name: "Pixiv Images",
                dupes: 1,
                hidden: 0,
              },
              data: {
                ext_urls: ["https://www.pixiv.net/artworks/123456"],
                title: "Dungeon Meshi fan art",
                member_name: "Example Artist",
                member_id: "42",
                pixiv_id: 123456,
                characters: "Marcille",
                material: "Dungeon Meshi",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new SauceNaoProvider({ fetcher, apiKey: "sauce-key" });

    const result = await provider.searchImage(query(urlInput(), 3));

    expect(result.items[0]).toMatchObject({
      provider: "saucenao",
      matchType: "source",
      rank: 1,
      similarity: 92.34,
      similarityScale: "percent",
      names: ["Dungeon Meshi fan art", "Marcille", "Dungeon Meshi"],
      externalIds: [{ source: "pixiv", id: "123456" }],
      facts: expect.objectContaining({
        sourceDatabase: "Pixiv Images",
        sourceUrls: ["https://www.pixiv.net/artworks/123456"],
        creator: "Example Artist",
        creatorId: "42",
        thumbnail: "https://img.example.test/thumb.jpg",
      }),
      evidence: [
        { provider: "saucenao", kind: "image_similarity", value: 92.34 },
      ],
    });
    expect(result.items[0]?.evidence[0]).not.toHaveProperty("weight");
    const [, init] = fetcher.mock.calls[0] ?? [];
    const form = init?.body as FormData;
    expect(form.get("api_key")).toBe("sauce-key");
    expect(form.get("output_type")).toBe("2");
    expect(form.get("db")).toBe("999");
    expect(form.get("numres")).toBe("3");
    expect(form.get("url")).toContain("signature=private");
  });

  it("uploads a local image as multipart form data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ header: { status: 0 }, results: [] }), { status: 200 }),
    );
    const provider = new SauceNaoProvider({ fetcher, apiKey: "sauce-key" });

    await provider.searchImage(query(await jpegInput("private-avatar.jpg")));

    const [, init] = fetcher.mock.calls[0] ?? [];
    const file = (init?.body as FormData).get("file") as File;
    expect(file.name).toBe("image.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(6);
  });

  it("does not reuse an ID when different results share their first source URL", async () => {
    const sharedUrl = "https://example.test/shared-source";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          header: { status: 0 },
          results: [
            {
              header: { similarity: "90", index_id: 5, index_name: "Pixiv Images" },
              data: { ext_urls: [sharedUrl], title: "First", pixiv_id: 1 },
            },
            {
              header: { similarity: "89", index_id: 5, index_name: "Pixiv Images" },
              data: { ext_urls: [sharedUrl], title: "Second", pixiv_id: 2 },
            },
          ],
        }),
      ),
    );

    const result = await new SauceNaoProvider({ fetcher, apiKey: "sauce-key" }).searchImage(
      query(),
    );

    expect(new Set(result.items.map((item) => item.providerId)).size).toBe(2);
  });
});

describe("AnimeTraceProvider", () => {
  it("uploads a local image without disclosing its original filename", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }),
    );
    const provider = new AnimeTraceProvider({ fetcher });

    await provider.searchImage(query(await jpegInput("private-avatar.jpg")));

    const [, init] = fetcher.mock.calls[0] ?? [];
    const file = (init?.body as FormData).get("file") as File;
    expect(file.name).toBe("image.jpg");
  });

  it("returns ordered candidates for every detected character without inventing similarity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          ai: false,
          trace_id: "trace-123",
          data: [
            {
              box: [0.173, 0.219, 0.46, 0.398],
              box_id: "box-1",
              not_confident: true,
              character: [
                { work: "ご注文はうさぎですか？", character: "保登心愛" },
                { work: "Clover Day's", character: "鷹倉杏鈴" },
              ],
            },
            {
              box: [0.489, 0.035, 0.724, 0.197],
              box_id: "box-2",
              not_confident: false,
              character: [{ work: "Clover Day's", character: "鷹倉杏璃" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new AnimeTraceProvider({ fetcher });

    const result = await provider.searchImage(query());

    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      provider: "animetrace",
      providerId: "box-1:1",
      matchType: "character",
      rank: 1,
      names: ["保登心愛"],
      externalIds: [],
      facts: {
        work: "ご注文はうさぎですか？",
        box: [0.173, 0.219, 0.46, 0.398],
        boxId: "box-1",
        boxIndex: 1,
        candidateRank: 1,
        notConfident: true,
        aiGenerated: false,
        traceId: "trace-123",
      },
    });
    expect(result.items[0]).not.toHaveProperty("similarity");
    expect(result.items[1]).toMatchObject({
      providerId: "box-2:1",
      rank: 1,
      names: ["鷹倉杏璃"],
      facts: expect.objectContaining({ notConfident: false, boxIndex: 2 }),
    });
    expect(result.items[2]).toMatchObject({
      providerId: "box-1:2",
      rank: 2,
      names: ["鷹倉杏鈴"],
      facts: expect.objectContaining({ boxIndex: 1, candidateRank: 2 }),
    });
    const [, init] = fetcher.mock.calls[0] ?? [];
    const form = init?.body as FormData;
    expect(form.get("url")).toContain("signature=private");
    expect(form.get("is_multi")).toBe("1");
    expect(form.get("ai_detect")).toBe("1");
    expect(form.get("model")).toBeNull();
  });

  it("maps service usage limits and malformed responses", async () => {
    const limited = new AnimeTraceProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ code: 17728, message: "usage limit reached", data: [] }), {
          status: 200,
        }),
      ),
    });
    const malformed = new AnimeTraceProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ code: 0, data: [{ character: "invalid" }] }), {
          status: 200,
        }),
      ),
    });

    await expect(limited.searchImage(query())).resolves.toMatchObject({ status: "rate_limited" });
    await expect(malformed.searchImage(query())).resolves.toMatchObject({
      status: "invalid_response",
    });
  });

  it("uses AnimeTrace business codes for non-2xx maintenance and busy responses", async () => {
    const maintenance = new AnimeTraceProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ code: 17704, message: "API maintenance" }), {
          status: 403,
        }),
      ),
    });
    const busy = new AnimeTraceProvider({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ code: 17702, message: "server busy" }), {
          status: 503,
        }),
      ),
    });

    await expect(maintenance.searchImage(query())).resolves.toMatchObject({
      status: "unavailable",
      message: "API maintenance",
    });
    await expect(busy.searchImage(query())).resolves.toMatchObject({
      status: "unavailable",
      message: "server busy",
    });
  });
});

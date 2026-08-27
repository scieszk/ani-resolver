import { describe, expect, it, vi } from "vitest";

import { WikidataProvider } from "../src/providers/wikidata.js";

const bindings = [
  {
    character: { type: "uri", value: "http://www.wikidata.org/entity/Q104144455" },
    characterLabel: { type: "literal", value: "芙莉莲", "xml:lang": "zh" },
    characterAltLabel: { type: "literal", value: "Frieren", "xml:lang": "en" },
    characterDescription: { type: "literal", value: "fictional elf mage", "xml:lang": "en" },
    image: { type: "uri", value: "https://commons.wikimedia.org/example.jpg" },
    sitelinks: { type: "literal", value: "18", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
    hairLabel: { type: "literal", value: "white hair", "xml:lang": "en" },
    eyeLabel: { type: "literal", value: "绿色", "xml:lang": "zh" },
    styleLabel: { type: "literal", value: "twintails", "xml:lang": "en" },
    genderLabel: { type: "literal", value: "female", "xml:lang": "en" },
    clothingLabel: { type: "literal", value: "robe", "xml:lang": "en" },
    workLabel: { type: "literal", value: "Frieren: Beyond Journey's End", "xml:lang": "en" },
    anilistId: { type: "literal", value: "176754" },
    anidbId: { type: "literal", value: "130947" },
    acdbId: { type: "literal", value: "130626" },
    bangumiId: { type: "literal", value: "86246" },
  },
];

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("WikidataProvider", () => {
  it("queries appearance through fixed Wikidata IDs and returns cross-source character IDs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ head: { vars: [] }, results: { bindings } }),
    );
    const provider = new WikidataProvider({ fetcher });

    const result = await provider.searchCharacters({
      entityType: "character",
      text: "女主 白发 双马尾 前期没什么表情",
      limit: 5,
    });

    expect(result).toMatchObject({ provider: "wikidata", status: "ok" });
    expect(result.items[0]).toMatchObject({
      providerId: "Q104144455",
      names: expect.arrayContaining(["芙莉莲", "Frieren"]),
      externalIds: expect.arrayContaining([
        { source: "wikidata", id: "Q104144455" },
        { source: "bangumi", id: "86246" },
        { source: "anilist", id: "176754" },
        { source: "anidb", id: "130947" },
        { source: "acdb", id: "130626" },
      ]),
      facts: {
        appearance: expect.objectContaining({
          hairColors: ["white"],
          eyeColors: ["green"],
          hairStyles: ["twintails"],
          genders: ["female"],
        }),
        description: "fictional elf mage",
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({ provider: "wikidata", kind: "appearance_match" }),
      ]),
    });

    const [input, init] = fetcher.mock.calls[0] ?? [];
    const query = new URL(String(input)).searchParams.get("query") ?? "";
    expect(query).toContain("wd:Q6933946");
    expect(query).toContain("wd:Q58628766");
    expect(query).toContain("wd:Q102292133");
    expect(query).toContain("wd:Q6581072");
    expect(query).not.toContain("前期没什么表情");
    expect(new Headers(init?.headers).get("user-agent")).toContain("ani-resolver");
  });

  it("uses entity search for a plain character name before enriching fixed QIDs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          search: [
            {
              id: "Q104144455",
              label: "Frieren",
              aliases: ["芙莉莲"],
              description: "fictional character",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ head: { vars: [] }, results: { bindings } }));
    const provider = new WikidataProvider({ fetcher });

    const result = await provider.searchCharacters({
      entityType: "character",
      text: "Frieren",
      limit: 3,
    });

    expect(result.items[0]?.providerId).toBe("Q104144455");
    const firstUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.get("action")).toBe("wbsearchentities");
    expect(firstUrl.searchParams.get("search")).toBe("Frieren");
    const detailQuery = new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get("query");
    expect(detailQuery).toContain("VALUES ?character { wd:Q104144455 }");
    expect(detailQuery).toContain("?character wdt:P31/wdt:P279* wd:Q95074");
  });

  it("rejects malformed QIDs without sending a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new WikidataProvider({ fetcher });

    const result = await provider.getEntity(
      { source: "wikidata", id: "Q1) SERVICE wikibase:label {" },
      "character",
    );

    expect(result).toMatchObject({ status: "unsupported", items: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

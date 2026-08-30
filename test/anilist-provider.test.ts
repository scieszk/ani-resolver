import { describe, expect, it, vi } from "vitest";

import { AniListProvider } from "../src/providers/anilist.js";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const frieren = {
  id: 176754,
  name: { full: "Frieren", native: "フリーレン", alternative: ["芙莉莲"] },
  image: { large: "https://example.test/frieren.jpg" },
  description: "A <b>white-haired</b> elf with twintails and an expressionless face who traveled with [Hero Himmel](https://anilist.co/character/184311/Himmel) in _Sousou no Frieren_.",
  gender: "Female",
  age: "1000+",
  bloodType: null,
  favourites: 50000,
  siteUrl: "https://anilist.co/character/176754",
};

describe("AniListProvider", () => {
  it("maps anime work search into AniList and MAL IDs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          Page: {
            media: [
              {
                id: 154587,
                idMal: 52991,
                title: {
                  romaji: "Sousou no Frieren",
                  english: "Frieren: Beyond Journey's End",
                  native: "葬送のフリーレン",
                },
                format: "TV",
                startDate: { year: 2023 },
                description: "<i>Fantasy anime</i>",
                coverImage: { large: "https://example.test/cover.jpg" },
                siteUrl: "https://anilist.co/anime/154587",
                popularity: 500000,
              },
            ],
          },
        },
      }),
    );
    const provider = new AniListProvider({ fetcher });

    const result = await provider.searchWorks({
      entityType: "work",
      text: "Frieren",
      title: "Frieren",
      limit: 5,
    });

    expect(result.items[0]).toMatchObject({
      providerId: "154587",
      names: expect.arrayContaining(["Sousou no Frieren", "葬送のフリーレン"]),
      externalIds: expect.arrayContaining([
        { source: "anilist", id: "154587", mediaKind: "tv" },
        { source: "mal", id: "52991", mediaKind: "tv" },
      ]),
      mediaKind: "tv",
      year: 2023,
      facts: { description: "Fantasy anime" },
    });
    const [, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.variables).toMatchObject({ search: "Frieren", perPage: 5 });
    expect(body.query).toContain("Page");
  });

  it("normalizes appearance clues from character descriptions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: { Page: { characters: [frieren] } } }),
    );
    const provider = new AniListProvider({ fetcher });

    const result = await provider.searchCharacters({
      entityType: "character",
      text: "Frieren",
      limit: 5,
    });

    expect(result.items[0]).toMatchObject({
      providerId: "176754",
      externalIds: [{ source: "anilist", id: "176754" }],
      facts: {
        description: "A white-haired elf with twintails and an expressionless face who traveled with Hero Himmel in Sousou no Frieren.",
        appearance: expect.objectContaining({
          hairColors: ["white"],
          hairStyles: ["twintails"],
          genders: ["female"],
          traits: ["expressionless"],
        }),
      },
    });
  });

  it("ranks a known work cast by appearance coverage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          Media: {
            characters: {
              edges: [
                {
                  role: "MAIN",
                  node: {
                    ...frieren,
                    description: "A white-haired female elf with twintails and a stoic expression.",
                  },
                },
                {
                  role: "MAIN",
                  node: {
                    id: 183965,
                    name: { full: "Fern", native: "フェルン", alternative: [] },
                    image: { large: null },
                    description: "A young woman with long purple hair.",
                    gender: "Female",
                    age: "18",
                    bloodType: null,
                    favourites: 30000,
                    siteUrl: "https://anilist.co/character/183965",
                  },
                },
              ],
            },
          },
        },
      }),
    );
    const provider = new AniListProvider({ fetcher });

    const result = await provider.searchCharacters({
      entityType: "character",
      text: "",
      appearance: {
        hairColors: ["white"],
        eyeColors: [],
        hairStyles: ["twintails"],
        genders: ["female"],
        apparentAges: [],
        clothing: [],
        traits: ["expressionless"],
      },
      work: { source: "anilist", id: "154587" },
      limit: 2,
    });

    expect(result.items.map((item) => item.providerId)).toEqual(["176754", "183965"]);
    expect(result.items[0]?.providerScore).toBeGreaterThan(result.items[1]?.providerScore ?? 0);
    expect(result.items[0]?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "appearance_match", weight: 1 })]),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.variables).toMatchObject({ id: 154587 });
    expect(body.query).toContain("Media");
  });

  it("keeps a literal character name when a work constraint is present", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          Media: {
            characters: {
              edges: [
                { role: "MAIN", node: frieren },
                {
                  role: "MAIN",
                  node: {
                    id: 183965,
                    name: { full: "Fern", native: "フェルン", alternative: [] },
                    image: { large: null },
                    description: "A young woman with long purple hair.",
                    gender: "Female",
                    age: "18",
                    bloodType: null,
                    favourites: 30000,
                    siteUrl: "https://anilist.co/character/183965",
                  },
                },
              ],
            },
          },
        },
      }),
    );
    const provider = new AniListProvider({ fetcher });

    const result = await provider.searchCharacters({
      entityType: "character",
      text: "Fern",
      work: { source: "anilist", id: "154587" },
      limit: 2,
    });

    expect(result.items.map((item) => item.providerId)).toEqual(["183965", "176754"]);
  });

  it("lists anime related to a confirmed character", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          Character: {
            media: {
              edges: [{
                characterRole: "MAIN",
                node: {
                  id: 154587,
                  idMal: 52991,
                  title: {
                    romaji: "Sousou no Frieren",
                    english: "Frieren: Beyond Journey's End",
                    native: "葬送のフリーレン",
                  },
                  format: "TV",
                  startDate: { year: 2023 },
                  description: "Fantasy anime",
                  coverImage: { large: "https://example.test/cover.jpg" },
                  siteUrl: "https://anilist.co/anime/154587",
                  popularity: 500000,
                },
              }],
            },
          },
        },
      }),
    );
    const provider = new AniListProvider({ fetcher });

    const result = await provider.listEntityRelations!(
      { source: "anilist", id: "176754" },
      "character",
    );

    expect(result.items[0]).toMatchObject({
      entityType: "work",
      providerId: "154587",
      relation: "MAIN",
      names: expect.arrayContaining(["Sousou no Frieren"]),
      image: "https://example.test/cover.jpg",
    });
  });

  it("lists a work's cast and voice actors as encyclopedia relations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          Media: {
            characters: {
              edges: [{
                role: "MAIN",
                node: frieren,
                voiceActors: [{
                  id: 95061,
                  name: { full: "Atsumi Tanezaki", native: "種﨑敦美", alternative: [] },
                  image: { large: "https://example.test/atsumi.jpg" },
                  siteUrl: "https://anilist.co/staff/95061",
                  languageV2: "Japanese",
                }],
              }],
            },
          },
        },
      }),
    );
    const provider = new AniListProvider({ fetcher });

    const result = await provider.listEntityRelations!(
      { source: "anilist", id: "154587" },
      "work",
    );

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "character", providerId: "176754", relation: "MAIN" }),
      expect.objectContaining({
        entityType: "person",
        providerId: "95061",
        names: expect.arrayContaining(["Atsumi Tanezaki", "種﨑敦美"]),
        relation: "Voice actor",
      }),
    ]));
  });
});

import { describe, expect, it } from "vitest";

import { parseContentInput } from "../src/input.js";

describe("parseContentInput", () => {
  it("extracts a clean title and episode from an anime release name", async () => {
    const result = await parseContentInput(
      "[VCB-Studio] Sousou no Frieren [01][Ma10p_1080p][x265_flac].mkv",
    );

    expect(result).toMatchObject({
      kind: "release_name",
      title: "Sousou no Frieren",
      episode: 1,
    });
  });

  it("keeps explicit TMDB identity evidence from a path", async () => {
    const result = await parseContentInput(
      "Bangumi/2025-04/末日后酒店 (2025) [tmdbid=262929]/Season 1/末日后酒店 S01E01.mkv",
    );

    expect(result.title).toBe("末日后酒店");
    expect(result.year).toBe(2025);
    expect(result.season).toBe(1);
    expect(result.externalIds).toContainEqual({ source: "tmdb", id: "262929", mediaKind: "tv" });
  });

  it("uses a magnet display name as title evidence", async () => {
    const result = await parseContentInput(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=%5BGroup%5D%20GIRLS%20BAND%20CRY%20-%2002%20%5B1080p%5D",
    );

    expect(result).toMatchObject({
      kind: "magnet",
      title: "GIRLS BAND CRY",
      episode: 2,
    });
  });

  it("redacts private tracker data from magnet evidence", async () => {
    const result = await parseContentInput(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example&tr=https%3A%2F%2Ftracker.example%2Fannounce%3Fpasskey%3Dsecret-value&ws=https%3A%2F%2Ffiles.example%2Fsecret-value",
    );

    expect(result.raw).toContain("0123456789abcdef0123456789abcdef01234567");
    expect(result.raw).not.toContain("tr=");
    expect(result.raw).not.toContain("ws=");
    expect(result.raw).not.toContain("secret-value");
  });
});

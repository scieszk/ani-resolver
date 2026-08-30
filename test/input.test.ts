import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseContentInput } from "../src/input.js";

describe("parseContentInput", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

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

  it("recursively inventories an existing anime directory with relative paths", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-input-"));
    temporaryDirectories.push(temporary);
    const root = path.join(temporary, "Dungeon Meshi (2024) [bgmid=395378]");
    await mkdir(path.join(root, "Season 1"), { recursive: true });
    await writeFile(path.join(root, "Season 1", "Dungeon Meshi S01E01.mkv"), "video");
    await writeFile(path.join(root, "Season 1", "Dungeon Meshi S01E01.zh.ass"), "subtitle");

    const result = await parseContentInput(root);

    expect(result).toMatchObject({
      kind: "directory",
      title: "Dungeon Meshi",
      year: 2024,
      externalIds: [{ source: "bangumi", id: "395378" }],
      files: [
        "Season 1/Dungeon Meshi S01E01.mkv",
        "Season 1/Dungeon Meshi S01E01.zh.ass",
      ],
    });
  });
});

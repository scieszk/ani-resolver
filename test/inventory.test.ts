import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectContentInventory } from "../src/inventory.js";

describe("inspectContentInventory", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it("groups downloaded video, subtitle, and audio files by episode without moving them", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-inventory-"));
    temporaryDirectories.push(temporary);
    const root = path.join(temporary, "Dungeon Meshi");
    await mkdir(path.join(root, "Season 1"), { recursive: true });
    await writeFile(path.join(root, "Season 1", "Dungeon Meshi S01E01.mkv"), "video-1");
    await writeFile(path.join(root, "Season 1", "Dungeon Meshi S01E01.zh.ass"), "subtitle-1");
    await writeFile(path.join(root, "Season 1", "Dungeon Meshi S01E01.ja.mka"), "audio-1");
    await writeFile(path.join(root, "Season 1", "Dungeon Meshi S01E02.mkv"), "video-2");
    await writeFile(path.join(root, "cover.jpg"), "image");

    const result = await inspectContentInventory(root);

    expect(result).toMatchObject({
      schemaVersion: "ani-resolver.inventory.v1",
      source: { kind: "directory", title: "Dungeon Meshi" },
      summary: {
        fileCount: 5,
        episodeCount: 2,
        byKind: { video: 2, subtitle: 1, audio: 1, image: 1 },
      },
      episodes: [
        {
          season: 1,
          episode: 1,
          files: [
            expect.objectContaining({ kind: "audio" }),
            expect.objectContaining({ kind: "video" }),
            expect.objectContaining({ kind: "subtitle" }),
          ],
        },
        {
          season: 1,
          episode: 2,
          files: [expect.objectContaining({ kind: "video" })],
        },
      ],
      unassigned: [expect.objectContaining({ path: "cover.jpg", kind: "image" })],
    });
  });

  it("inherits a source season for bracket-numbered episode files", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-inventory-season-"));
    temporaryDirectories.push(temporary);
    const root = path.join(temporary, "Dungeon Meshi S1");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "[Group] Dungeon Meshi [01].mkv"), "video");

    const result = await inspectContentInventory(root);

    expect(result.summary.seasons).toEqual([1]);
    expect(result.episodes[0]).toMatchObject({ season: 1, episode: 1 });
    expect(result.episodes[0]?.files[0]?.path).not.toContain("\\");
  });

  it("recognizes plain and episode-prefixed filenames with common companion formats", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-inventory-plain-"));
    temporaryDirectories.push(temporary);
    const root = path.join(temporary, "Dungeon Meshi", "Season 2");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "01.mkv"), "video-1");
    await writeFile(path.join(root, "01.zh.mks"), "subtitle-1");
    await writeFile(path.join(root, "Episode 02.mp4"), "video-2");
    await writeFile(path.join(root, "Episode 02.en.srt"), "subtitle-2");
    await writeFile(path.join(root, "02.mka"), "audio-2");

    const result = await inspectContentInventory(path.dirname(root));

    expect(result.episodes).toMatchObject([
      {
        season: 2,
        episode: 1,
        files: [
          expect.objectContaining({ path: "Season 2/01.mkv", kind: "video" }),
          expect.objectContaining({ path: "Season 2/01.zh.mks", kind: "subtitle" }),
        ],
      },
      {
        season: 2,
        episode: 2,
        files: [
          expect.objectContaining({ path: "Season 2/02.mka", kind: "audio" }),
          expect.objectContaining({ path: "Season 2/Episode 02.en.srt", kind: "subtitle" }),
          expect.objectContaining({ path: "Season 2/Episode 02.mp4", kind: "video" }),
        ],
      },
    ]);
  });

  it("reports skipped nested symbolic links instead of presenting an incomplete scan as complete", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-inventory-link-"));
    temporaryDirectories.push(temporary);
    const root = path.join(temporary, "Anime");
    const external = path.join(temporary, "External");
    await mkdir(root, { recursive: true });
    await mkdir(external, { recursive: true });
    await writeFile(path.join(root, "01.mkv"), "video");
    await writeFile(path.join(external, "02.mkv"), "external-video");
    await symlink(external, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

    const result = await inspectContentInventory(root);

    expect(result.summary.skippedSymlinkCount).toBe(1);
    expect(result.summary.fileCount).toBe(1);
  });
});

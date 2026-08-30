import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { zipSync, strToU8 } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  BangumiArchiveProvider,
  buildBangumiArchiveIndex,
} from "../src/providers/bangumi-archive.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ archive: string; index: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "ani-resolver-archive-"));
  temporaryDirectories.push(directory);
  const archive = path.join(directory, "dump.zip");
  const index = path.join(directory, "archive.sqlite");
  const lines = (items: unknown[]) => `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;

  await writeFile(
    archive,
    zipSync({
      "subject.jsonlines": strToU8(
        lines([
          {
            id: 395378,
            type: 2,
            name: "ダンジョン飯",
            name_cn: "迷宫饭",
            summary: "在迷宫中烹饪魔物的冒险故事。",
            infobox: "{{Infobox animanga/TVAnime\n|中文名= 迷宫饭\n|别名={\n[Dungeon Meshi]\n[第二中文名|]\n[Delicious in Dungeon]\n}\n}}",
            tags: [{ name: "奇幻" }, { name: "美食" }],
            score: 8.1,
            rank: 145,
            date: "2024-01-04",
            platform: 1,
          },
          {
            id: 499073,
            type: 2,
            name: "ダンジョン飯 第2期",
            name_cn: "迷宫饭 第二季",
            summary: "Dungeon Meshi returns for a second season.",
            infobox: "{{Infobox animanga/TVAnime\n|别名={\n[Dungeon Meshi 2nd Season]\n}\n}}",
            tags: [{ name: "奇幻" }],
            score: 8.3,
            rank: 0,
            date: "",
            platform: 1,
          },
          { id: 1, type: 1, name: "not anime", name_cn: "", summary: "" },
        ]),
      ),
      "subject-characters.jsonlines": strToU8(
        lines([
          { subject_id: 395378, character_id: 999, type: 5, order: 0 },
          { subject_id: 395378, character_id: 120910, type: 1, order: 1 },
          { subject_id: 395378, character_id: 130000, type: 1, order: 2 },
        ]),
      ),
      "character.jsonlines": strToU8(
        lines([
          {
            id: 120910,
            role: 1,
            name: "マルシル・ドナトー",
            summary: "金发的精灵魔法师，感情丰富。",
            infobox: [{ key: "简体中文名", value: "玛露希尔·多纳托" }],
            comments: 100,
            collects: 200,
          },
          {
            id: 999,
            role: 5,
            name: "ナレーション",
            summary: "旁白",
            infobox: "{{Infobox Crt\n|简体中文名= 旁白\n}}",
          },
          {
            id: 130000,
            role: 1,
            name: "アイラ",
            summary: "白发双马尾的女性，前期面无表情。",
            infobox: [{ key: "简体中文名", value: "艾拉" }],
          },
        ]),
      ),
    }),
  );
  return { archive, index };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("BangumiArchiveProvider", () => {
  it("streams a dump ZIP into an anime-only SQLite FTS index", async () => {
    const paths = await fixture();

    const result = await buildBangumiArchiveIndex(paths);

    expect(result).toMatchObject({ subjects: 2, characters: 3, relations: 3 });
    expect(result.sourceBytes).toBeGreaterThan(0);
  });

  it("searches indexed aliases and returns Bangumi identities", async () => {
    const paths = await fixture();
    await buildBangumiArchiveIndex(paths);
    const provider = new BangumiArchiveProvider({ indexPath: paths.index });

    const result = await provider.searchWorks!({
      entityType: "work",
      text: "Dungeon Meshi",
      title: "Dungeon Meshi",
      limit: 3,
    });

    expect(result.status).toBe("ok");
    expect(result.items[0]).toMatchObject({
      provider: "bangumi-archive",
      providerId: "395378",
      names: expect.arrayContaining(["迷宫饭", "Dungeon Meshi"]),
      externalIds: [{ source: "bangumi", id: "395378", mediaKind: "tv" }],
    });
    expect(result.items[0]?.names).not.toContain("{");
    expect(result.items[0]?.names).not.toContain("第二中文名");
    expect(result.items[0]?.facts).not.toHaveProperty("infobox");
  });

  it("searches character text and scopes characters by work", async () => {
    const paths = await fixture();
    await buildBangumiArchiveIndex(paths);
    const provider = new BangumiArchiveProvider({ indexPath: paths.index });

    const search = await provider.searchCharacters!({
      entityType: "character",
      text: "精灵魔法师",
      work: { source: "bangumi", id: "395378" },
      limit: 3,
    });
    const characters = await provider.listWorkCharacters!({ source: "bangumi", id: "395378" });

    expect(search.items[0]).toMatchObject({ providerId: "120910" });
    expect(characters.items[0]).toMatchObject({ providerId: "120910" });
  });

  it("ranks a literal character name inside a known work", async () => {
    const paths = await fixture();
    await buildBangumiArchiveIndex(paths);
    const provider = new BangumiArchiveProvider({ indexPath: paths.index });

    const result = await provider.searchCharacters!({
      entityType: "character",
      text: "艾拉",
      work: { source: "bangumi", id: "395378" },
      limit: 3,
    });

    expect(result.items[0]).toMatchObject({ providerId: "130000" });
  });

  it("searches two-character CJK clues in indexed full text", async () => {
    const paths = await fixture();
    await buildBangumiArchiveIndex(paths);
    const provider = new BangumiArchiveProvider({ indexPath: paths.index });

    const result = await provider.searchCharacters!({
      entityType: "character",
      text: "精灵",
      work: { source: "bangumi", id: "395378" },
      limit: 3,
    });

    expect(result.items[0]).toMatchObject({ providerId: "120910" });
  });

  it("ranks a known work cast with cross-language normalized appearance clues", async () => {
    const paths = await fixture();
    await buildBangumiArchiveIndex(paths);
    const provider = new BangumiArchiveProvider({ indexPath: paths.index });

    const result = await provider.searchCharacters!({
      entityType: "character",
      text: "",
      appearance: {
        hairColors: ["silver"],
        eyeColors: [],
        hairStyles: ["twintails"],
        genders: ["female"],
        apparentAges: [],
        clothing: [],
        traits: ["expressionless"],
      },
      work: { source: "bangumi", id: "395378" },
      limit: 3,
    });

    expect(result.items[0]).toMatchObject({
      providerId: "130000",
      facts: {
        appearance: expect.objectContaining({
          hairColors: ["white"],
          hairStyles: ["twintails"],
          genders: ["female"],
          traits: ["expressionless"],
        }),
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({ kind: "appearance_match", weight: 1 }),
      ]),
    });
  });

  it("searches the archive globally from structured appearance conditions", async () => {
    const paths = await fixture();
    await buildBangumiArchiveIndex(paths);
    const provider = new BangumiArchiveProvider({ indexPath: paths.index });

    const result = await provider.searchCharacters!({
      entityType: "character",
      text: "",
      appearance: {
        hairColors: ["silver"],
        eyeColors: [],
        hairStyles: ["twintails"],
        genders: ["female"],
        apparentAges: [],
        clothing: [],
        traits: ["expressionless"],
      },
      limit: 3,
    });

    expect(result.status).toBe("ok");
    expect(result.items[0]).toMatchObject({ providerId: "130000" });
  });

  it("asks for reinitialization when a legacy index lacks appearance data", async () => {
    const paths = await fixture();
    await buildBangumiArchiveIndex(paths);
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(paths.index);
    database.exec("DROP TABLE character_appearance");
    database.close();
    const provider = new BangumiArchiveProvider({ indexPath: paths.index });

    const result = await provider.searchCharacters!({
      entityType: "character",
      text: "",
      appearance: {
        hairColors: ["white"],
        eyeColors: [],
        hairStyles: [],
        genders: [],
        apparentAges: [],
        clothing: [],
        traits: [],
      },
      limit: 3,
    });

    expect(result).toMatchObject({
      status: "unsupported",
      items: [],
      message: expect.stringContaining("provider init bangumi-archive"),
    });
  });
});

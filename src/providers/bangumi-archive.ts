import { createInterface } from "node:readline";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Readable } from "node:stream";

import { open as openZip, type Entry, type ZipFile } from "yauzl";

import { normalizeName } from "../resolver.js";
import type {
  ExternalId,
  MediaKind,
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRun,
  ResolveQuery,
} from "../types.js";

export interface BangumiArchiveIndexOptions {
  archive: string;
  index: string;
}

export interface BangumiArchiveIndexResult {
  subjects: number;
  characters: number;
  relations: number;
  sourceBytes: number;
  indexPath: string;
}

export interface BangumiArchiveProviderOptions {
  indexPath: string;
}

interface ArchiveObject {
  [key: string]: unknown;
}

interface SubjectRow {
  id: number;
  names_json: string;
  media_kind: MediaKind;
  year: number | null;
  facts_json: string;
}

interface CharacterRow {
  id: number;
  names_json: string;
  facts_json: string;
  relation_type?: string | null;
}

export const bangumiArchiveManifest: ProviderManifest = {
  id: "bangumi-archive",
  label: "Bangumi Archive",
  mediaTypes: ["anime"],
  capabilities: [
    "work_search",
    "work_detail",
    "character_search",
    "character_detail",
    "work_characters",
  ],
  languages: ["zh", "ja"],
  auth: "none",
  strengths: ["Offline anime and character search", "Weekly Bangumi data dumps"],
  limitations: ["Requires a local index", "Appearance traits are limited to archived text"],
  homepage: "https://github.com/bangumi/Archive",
  attribution: "Data from Bangumi Archive",
};

export async function buildBangumiArchiveIndex(
  options: BangumiArchiveIndexOptions,
): Promise<BangumiArchiveIndexResult> {
  const archive = path.resolve(options.archive);
  const indexPath = path.resolve(options.index);
  const source = await stat(archive);
  if (!source.isFile()) throw new Error(`Archive is not a file: ${archive}`);
  await mkdir(path.dirname(indexPath), { recursive: true });

  const temporary = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  const database = new DatabaseSync(temporary);
  let subjects = 0;
  let relations = 0;
  let characters = 0;

  try {
    createSchema(database);
    const subjectIds = new Set<number>();
    const characterIds = new Set<number>();
    const insertSubject = database.prepare(
      "INSERT INTO subjects(id, names_json, media_kind, year, facts_json) VALUES (?, ?, ?, ?, ?)",
    );
    const insertSubjectFts = database.prepare(
      "INSERT INTO subject_fts(rowid, names, text) VALUES (?, ?, ?)",
    );

    database.exec("BEGIN");
    try {
      for await (const item of readJsonLines(archive, "subject.jsonlines")) {
        if (toNumber(item.type) !== 2) continue;
        const id = requiredNumber(item.id, "subject id");
        const names = collectNames(item.name, item.name_cn, item.infobox);
        const mediaKind = archivePlatformKind(item.platform);
        const year = yearFromDate(item.date);
        const facts = {
          summary: toText(item.summary),
          tags: collectTagNames(item.tags),
          score: item.score ?? null,
          rank: item.rank ?? null,
          date: item.date ?? null,
          platform: item.platform ?? null,
          image: null,
        };
        insertSubject.run(id, JSON.stringify(names), mediaKind, year ?? null, JSON.stringify(facts));
        insertSubjectFts.run(id, names.join("\n"), searchableText(item, names));
        subjectIds.add(id);
        subjects += 1;
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const insertRelation = database.prepare(
      "INSERT OR IGNORE INTO subject_characters(subject_id, character_id, relation_type, sort_order) VALUES (?, ?, ?, ?)",
    );
    database.exec("BEGIN");
    try {
      for await (const item of readJsonLines(archive, "subject-characters.jsonlines")) {
        const subjectId = requiredNumber(item.subject_id, "relation subject id");
        if (!subjectIds.has(subjectId)) continue;
        const characterId = requiredNumber(item.character_id, "relation character id");
        insertRelation.run(
          subjectId,
          characterId,
          item.type === undefined ? null : String(item.type),
          toNumber(item.order) ?? 0,
        );
        characterIds.add(characterId);
        relations += 1;
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const insertCharacter = database.prepare(
      "INSERT INTO characters(id, names_json, facts_json) VALUES (?, ?, ?)",
    );
    const insertCharacterFts = database.prepare(
      "INSERT INTO character_fts(rowid, names, text) VALUES (?, ?, ?)",
    );
    database.exec("BEGIN");
    try {
      for await (const item of readJsonLines(archive, "character.jsonlines")) {
        const id = requiredNumber(item.id, "character id");
        if (!characterIds.has(id)) continue;
        const names = collectNames(item.name, undefined, item.infobox);
        const facts = {
          summary: toText(item.summary),
          attributes: compactInfobox(item.infobox),
          role: item.role ?? null,
          comments: item.comments ?? null,
          collects: item.collects ?? null,
          image: null,
        };
        insertCharacter.run(id, JSON.stringify(names), JSON.stringify(facts));
        insertCharacterFts.run(id, names.join("\n"), searchableText(item, names));
        characters += 1;
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    database
      .prepare("INSERT INTO metadata(key, value) VALUES (?, ?)")
      .run("source", path.basename(archive));
    database.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("subjects", String(subjects));
    database
      .prepare("INSERT INTO metadata(key, value) VALUES (?, ?)")
      .run("characters", String(characters));
    database.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run("relations", String(relations));
    database.close();
    await replaceIndex(temporary, indexPath);
    return { subjects, characters, relations, sourceBytes: source.size, indexPath };
  } catch (error) {
    try {
      database.close();
    } catch {
      // The database may already be closed after a successful build.
    }
    await rm(temporary, { force: true });
    throw error;
  }
}

export class BangumiArchiveProvider implements Provider {
  readonly manifest = bangumiArchiveManifest;
  private readonly indexPath: string;

  constructor(options: BangumiArchiveProviderOptions) {
    this.indexPath = path.resolve(options.indexPath);
  }

  async searchWorks(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    const database = this.open();
    try {
      const rows = searchSubjects(database, query.title ?? query.text, Math.max(query.limit * 4, 20));
      const items = rows
        .map((row, index) => subjectCandidate(row, query, index))
        .sort((left, right) => right.providerScore - left.providerScore)
        .slice(0, query.limit);
      return run(this.manifest.id, items);
    } finally {
      database.close();
    }
  }

  async searchCharacters(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    if (query.work && query.work.source !== "bangumi") {
      return {
        provider: this.manifest.id,
        status: "unsupported",
        items: [],
        message: "Bangumi Archive character filtering requires a Bangumi work ID",
      };
    }
    const database = this.open();
    try {
      const rows = searchCharacters(database, query.text, query.limit, query.work?.id);
      const items = rows.map((row, index) => characterCandidate(row, index));
      return run(this.manifest.id, items);
    } finally {
      database.close();
    }
  }

  async getEntity(
    id: ExternalId,
    entityType: "work" | "character",
  ): Promise<ProviderRun<ProviderCandidate>> {
    if (id.source !== "bangumi") {
      return { provider: this.manifest.id, status: "unsupported", items: [], message: "not a Bangumi ID" };
    }
    const database = this.open();
    try {
      if (entityType === "work") {
        const row = database
          .prepare("SELECT id, names_json, media_kind, year, facts_json FROM subjects WHERE id = ?")
          .get(id.id) as SubjectRow | undefined;
        return run(
          this.manifest.id,
          row
            ? [
                subjectCandidate(
                  row,
                  { entityType: "work", text: parseJson<string[]>(row.names_json, [id.id])[0] ?? id.id, limit: 1 },
                  0,
                ),
              ]
            : [],
        );
      }
      const row = database
        .prepare("SELECT id, names_json, facts_json FROM characters WHERE id = ?")
        .get(id.id) as CharacterRow | undefined;
      return run(this.manifest.id, row ? [characterCandidate(row, 0)] : []);
    } finally {
      database.close();
    }
  }

  async listWorkCharacters(work: ExternalId): Promise<ProviderRun<ProviderCandidate>> {
    if (work.source !== "bangumi") {
      return { provider: this.manifest.id, status: "unsupported", items: [], message: "not a Bangumi ID" };
    }
    const database = this.open();
    try {
      const rows = database
        .prepare(
          `SELECT c.id, c.names_json, c.facts_json, r.relation_type
           FROM subject_characters r
           JOIN characters c ON c.id = r.character_id
           WHERE r.subject_id = ?
           ORDER BY CASE CAST(r.relation_type AS INTEGER)
             WHEN 1 THEN 0
             WHEN 2 THEN 1
             ELSE 2
           END, r.sort_order, c.id`,
        )
        .all(work.id) as unknown as CharacterRow[];
      return run(
        this.manifest.id,
        rows.map((row, index) => characterCandidate(row, index)),
      );
    } finally {
      database.close();
    }
  }

  private open(): DatabaseSync {
    return new DatabaseSync(this.indexPath, { readOnly: true });
  }
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE subjects (
      id INTEGER PRIMARY KEY,
      names_json TEXT NOT NULL,
      media_kind TEXT NOT NULL,
      year INTEGER,
      facts_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE subject_fts USING fts5(names, text, tokenize='trigram');
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      names_json TEXT NOT NULL,
      facts_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE character_fts USING fts5(names, text, tokenize='trigram');
    CREATE TABLE subject_characters (
      subject_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      relation_type TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (subject_id, character_id)
    );
    CREATE INDEX subject_characters_character ON subject_characters(character_id);
  `);
}

function searchSubjects(database: DatabaseSync, text: string, limit: number): SubjectRow[] {
  const match = ftsQuery(text);
  if (!match) {
    return database
      .prepare(
        `SELECT s.id, s.names_json, s.media_kind, s.year, s.facts_json
         FROM subject_fts
         JOIN subjects s ON s.id = subject_fts.rowid
         WHERE subject_fts.names LIKE ? ESCAPE '\\' OR subject_fts.text LIKE ? ESCAPE '\\'
         LIMIT ?`,
      )
      .all(`%${escapeLike(text)}%`, `%${escapeLike(text)}%`, limit) as unknown as SubjectRow[];
  }
  return database
    .prepare(
      `SELECT s.id, s.names_json, s.media_kind, s.year, s.facts_json
       FROM subject_fts
       JOIN subjects s ON s.id = subject_fts.rowid
       WHERE subject_fts MATCH ?
       ORDER BY bm25(subject_fts)
       LIMIT ?`,
    )
    .all(match, limit) as unknown as SubjectRow[];
}

function searchCharacters(
  database: DatabaseSync,
  text: string,
  limit: number,
  workId: string | undefined,
): CharacterRow[] {
  const match = ftsQuery(text);
  if (!match) {
    const scoped = workId
      ? `JOIN subject_characters r ON r.character_id = c.id AND r.subject_id = ?`
      : "";
    return database
      .prepare(
        `SELECT c.id, c.names_json, c.facts_json${workId ? ", r.relation_type" : ""}
         FROM character_fts
         JOIN characters c ON c.id = character_fts.rowid
         ${scoped}
         WHERE character_fts.names LIKE ? ESCAPE '\\' OR character_fts.text LIKE ? ESCAPE '\\'
         LIMIT ?`,
      )
      .all(...(workId
        ? [workId, `%${escapeLike(text)}%`, `%${escapeLike(text)}%`, limit]
        : [`%${escapeLike(text)}%`, `%${escapeLike(text)}%`, limit])) as unknown as CharacterRow[];
  }

  const scoped = workId
    ? "JOIN subject_characters r ON r.character_id = c.id AND r.subject_id = ?"
    : "";
  const parameters = workId ? [workId, match, limit] : [match, limit];
  return database
    .prepare(
      `SELECT c.id, c.names_json, c.facts_json${workId ? ", r.relation_type" : ""}
       FROM character_fts
       JOIN characters c ON c.id = character_fts.rowid
       ${scoped}
       WHERE character_fts MATCH ?
       ORDER BY bm25(character_fts)
       LIMIT ?`,
    )
    .all(...parameters) as unknown as CharacterRow[];
}

function subjectCandidate(row: SubjectRow, query: ResolveQuery, index: number): ProviderCandidate {
  const names = parseJson<string[]>(row.names_json, []);
  const normalizedQuery = normalizeName(query.title ?? query.text);
  const exact = names.some((name) => normalizeName(name) === normalizedQuery);
  const sequelPenalty =
    query.season === 1 &&
    names.some((name) => /(?:第\s*2\s*期|第二季|2nd\s+season)/i.test(name));
  let score = 0.82 - Math.min(index, 10) * 0.02;
  if (exact) score += 0.12;
  if (query.year !== undefined && row.year === query.year) score += 0.04;
  if (sequelPenalty) score -= 0.12;
  return {
    entityType: "work",
    provider: "bangumi-archive",
    providerId: String(row.id),
    names,
    externalIds: [{ source: "bangumi", id: String(row.id), mediaKind: row.media_kind }],
    mediaKind: row.media_kind,
    ...(row.year === null ? {} : { year: row.year }),
    providerScore: Math.max(0.5, Math.min(0.96, score)),
    facts: parseJson<Record<string, unknown>>(row.facts_json, {}),
    evidence: [],
  };
}

function characterCandidate(row: CharacterRow, index: number): ProviderCandidate {
  const facts = parseJson<Record<string, unknown>>(row.facts_json, {});
  if (row.relation_type !== undefined && row.relation_type !== null) facts.relationType = row.relation_type;
  return {
    entityType: "character",
    provider: "bangumi-archive",
    providerId: String(row.id),
    names: parseJson<string[]>(row.names_json, []),
    externalIds: [{ source: "bangumi", id: String(row.id) }],
    providerScore: Math.max(0.55, 0.88 - index * 0.035),
    facts,
    evidence: [],
  };
}

function run(provider: string, items: ProviderCandidate[]): ProviderRun<ProviderCandidate> {
  return { provider, status: items.length ? "ok" : "empty", items };
}

function searchableText(item: ArchiveObject, names: string[]): string {
  return [
    ...names,
    toText(item.summary),
    stringifyText(item.infobox),
    stringifyText(item.tags),
  ]
    .filter(Boolean)
    .join("\n");
}

function collectNames(primary: unknown, chinese: unknown, infobox: unknown): string[] {
  const names = [toText(primary), toText(chinese)].filter(Boolean);
  if (Array.isArray(infobox)) {
    for (const item of infobox) {
      if (!isObject(item) || !/(?:名|别名|alias|name)/i.test(toText(item.key))) continue;
      names.push(...flattenText(item.value));
    }
  } else if (typeof infobox === "string") {
    for (const [key, values] of parseWikiInfobox(infobox)) {
      if (/(?:名|别名|alias|name)/i.test(key)) names.push(...values);
    }
  }
  return [
    ...new Set(
      names
        .map((name) => name.trim())
        .filter((name) => name && name !== "{" && name !== "}" && name !== "*"),
    ),
  ];
}

function parseWikiInfobox(value: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let blockKey: string | undefined;
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (blockKey) {
      if (trimmed === "}") {
        blockKey = undefined;
        continue;
      }
      for (const match of trimmed.matchAll(/\[([^\]]+)\]/g)) {
        const raw = match[1] ?? "";
        const parts = raw.split("|");
        const text = (parts.length > 1 ? parts.at(-1) : raw)?.trim();
        if (text) appendField(fields, blockKey, text);
      }
      continue;
    }
    const match = trimmed.match(/^\|?\s*([^=]+?)\s*=\s*(.*)$/);
    if (!match?.[1]) continue;
    const key = match[1].trim();
    const fieldValue = match[2]?.trim() ?? "";
    if (fieldValue === "{") {
      blockKey = key;
    } else if (fieldValue && fieldValue !== "*") {
      appendField(fields, key, fieldValue);
    }
  }
  return fields;
}

function appendField(fields: Map<string, string[]>, key: string, value: string): void {
  const values = fields.get(key) ?? [];
  values.push(value);
  fields.set(key, values);
}

function compactInfobox(value: unknown): Record<string, string | string[]> {
  const allowed = /^(?:性别|生日|血型|身高|体重|BWH|年龄|人种|出生地区)$/;
  const fields = new Map<string, string[]>();
  if (typeof value === "string") {
    for (const [key, values] of parseWikiInfobox(value)) {
      if (allowed.test(key)) fields.set(key, values);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (!isObject(item)) continue;
      const key = toText(item.key);
      if (!allowed.test(key)) continue;
      const values = flattenText(item.value);
      if (values.length) fields.set(key, values);
    }
  }
  return Object.fromEntries(
    [...fields].map(([key, values]) => [key, values.length === 1 ? values[0]! : values]),
  );
}

function collectTagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => (isObject(item) ? [toText(item.name)] : []))
    .filter(Boolean);
}

function flattenText(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (isObject(value)) return flattenText(value.v ?? value.value);
  return [];
}

function archivePlatformKind(value: unknown): MediaKind {
  switch (toNumber(value)) {
    case 1:
      return "tv";
    case 2:
      return "ova";
    case 3:
    case 4:
      return "movie";
    case 5:
      return "web";
    default:
      return "unknown";
  }
}

function yearFromDate(value: unknown): number | undefined {
  const match = toText(value).match(/^(\d{4})/);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function ftsQuery(value: string): string | undefined {
  const terms = value
    .normalize("NFKC")
    .split(/[\s,，、/|]+/)
    .map((term) => term.trim())
    .filter((term) => [...term].length >= 3)
    .map((term) => `"${term.replaceAll('"', '""')}"`);
  return terms.length ? terms.join(" AND ") : undefined;
}

function escapeLike(value: string): string {
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

async function* readJsonLines(archive: string, entryName: string): AsyncGenerator<ArchiveObject> {
  const { zip, entry } = await findEntry(archive, entryName);
  try {
    const stream = await entryStream(zip, entry);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!isObject(value)) throw new Error("expected an object");
        yield value;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${entryName}:${lineNumber}: ${message}`);
      }
    }
  } finally {
    zip.close();
  }
}

async function findEntry(archive: string, entryName: string): Promise<{ zip: ZipFile; entry: Entry }> {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    openZip(
      archive,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
      (error, opened) => (error ? reject(error) : resolve(opened)),
    );
  });

  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      zip.close();
      reject(error);
    };
    zip.once("error", fail);
    zip.on("entry", (entry: Entry) => {
      if (entry.fileName === entryName) {
        zip.removeListener("error", fail);
        resolve({ zip, entry });
      } else {
        zip.readEntry();
      }
    });
    zip.once("end", () => fail(new Error(`Archive entry not found: ${entryName}`)));
    zip.readEntry();
  });
}

async function entryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

async function replaceIndex(temporary: string, destination: string): Promise<void> {
  const previous = `${destination}.previous`;
  await rm(previous, { force: true });
  let hadPrevious = false;
  try {
    await rename(destination, previous);
    hadPrevious = true;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    await rename(temporary, destination);
    if (hadPrevious) await rm(previous, { force: true });
  } catch (error) {
    if (hadPrevious) await rename(previous, destination);
    throw error;
  }
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = toNumber(value);
  if (parsed === undefined) throw new Error(`Invalid ${field}`);
  return parsed;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringifyText(value: unknown): string {
  return value === undefined || value === null ? "" : JSON.stringify(value);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isObject(value: unknown): value is ArchiveObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

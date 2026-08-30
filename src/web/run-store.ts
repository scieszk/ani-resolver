import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CharacterAppearance, ExternalId } from "../types.js";
import type { AttachmentKind, ResolvedRunTarget, RunTarget } from "./target.js";

const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_RUNS = 500;

export type RunStatus = "pending" | "completed" | "failed";

export interface StoredAttachment {
  id: string;
  runId: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  stored: boolean;
  path?: string;
  createdAt: string;
  purgedAt?: string;
}

export interface RunRecord {
  id: string;
  input: string;
  requestedTarget: RunTarget;
  resolvedTarget: ResolvedRunTarget;
  status: RunStatus;
  providers: string[];
  query?: StoredRunQuery;
  result?: unknown;
  error?: string;
  attachments: StoredAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredRunQuery {
  appearance?: CharacterAppearance;
  work?: ExternalId;
}

export interface FavoriteRecord {
  id: string;
  entityKey: string;
  entityType: string;
  title: string;
  image?: string;
  candidate: unknown;
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunStoreOptions {
  root: string;
  maxAttachmentBytes?: number;
  maxRuns?: number;
}

export interface CreateRunInput {
  input: string;
  requestedTarget: RunTarget;
  resolvedTarget: ResolvedRunTarget;
  providers: string[];
  query?: StoredRunQuery;
}

export interface SaveFavoriteInput {
  entityKey: string;
  entityType: string;
  title: string;
  image?: string;
  candidate: unknown;
  sourceRunId?: string;
}

export interface FavoriteListOptions {
  query?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
}

export interface AddAttachmentInput {
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  data: Buffer;
}

export interface RunListOptions {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface StorageStats {
  bytesUsed: number;
  maxBytes: number;
  storedAttachments: number;
  totalAttachments: number;
  runs: number;
}

export interface CleanupResult extends StorageStats {
  purgedAttachments: number;
  deletedRuns: number;
  bytesFreed: number;
}

interface RunRow {
  id: string;
  input: string;
  requested_target: RunTarget;
  resolved_target: ResolvedRunTarget;
  status: RunStatus;
  providers_json: string;
  query_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface FavoriteRow {
  id: string;
  entity_key: string;
  entity_type: string;
  title: string;
  image: string | null;
  candidate_json: string;
  source_run_id: string | null;
  created_at: number;
  updated_at: number;
}

interface AttachmentRow {
  id: string;
  run_id: string;
  file_name: string;
  mime_type: string;
  kind: AttachmentKind;
  size: number;
  stored_name: string | null;
  created_at: number;
  purged_at: number | null;
}

export class RunStore {
  readonly root: string;
  readonly maxAttachmentBytes: number;
  readonly maxRuns: number;
  private readonly filesDirectory: string;
  private database: DatabaseSync | undefined;

  constructor(options: RunStoreOptions) {
    this.root = path.resolve(options.root);
    this.filesDirectory = path.join(this.root, "attachments");
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
  }

  async open(): Promise<void> {
    if (this.database) return;
    await mkdir(this.filesDirectory, { recursive: true });
    const database = new DatabaseSync(path.join(this.root, "runs.sqlite"));
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        input TEXT NOT NULL,
        requested_target TEXT NOT NULL,
        resolved_target TEXT NOT NULL,
        status TEXT NOT NULL,
        providers_json TEXT NOT NULL,
        query_json TEXT,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        stored_name TEXT,
        created_at INTEGER NOT NULL,
        purged_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS runs_created_at ON runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS attachments_created_at ON attachments(created_at ASC);
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        entity_key TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL,
        title TEXT NOT NULL,
        image TEXT,
        candidate_json TEXT NOT NULL,
        source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS favorites_created_at ON favorites(created_at DESC);
      CREATE INDEX IF NOT EXISTS favorites_entity_type ON favorites(entity_type);
    `);
    const runColumns = database.prepare("PRAGMA table_info(runs)").all() as unknown as Array<{ name: string }>;
    if (!runColumns.some((column) => column.name === "query_json")) {
      database.exec("ALTER TABLE runs ADD COLUMN query_json TEXT");
    }
    this.database = database;
  }

  async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const database = this.getDatabase();
    const id = randomUUID();
    const now = Date.now();
    database
      .prepare(
        `INSERT INTO runs(
          id, input, requested_target, resolved_target, status, providers_json,
          query_json, result_json, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        input.input,
        input.requestedTarget,
        input.resolvedTarget,
        JSON.stringify(input.providers),
        input.query ? JSON.stringify(input.query) : null,
        now,
        now,
      );
    return (await this.getRun(id))!;
  }

  async addAttachment(runId: string, input: AddAttachmentInput): Promise<StoredAttachment> {
    const database = this.getDatabase();
    if (!(await this.getRun(runId))) throw new Error(`Run not found: ${runId}`);
    const id = randomUUID();
    const storedName = `${id}${safeExtension(input.fileName, input.kind)}`;
    const destination = path.join(this.filesDirectory, storedName);
    await writeFile(destination, input.data, { flag: "wx" });
    const now = Date.now();
    try {
      database
        .prepare(
          `INSERT INTO attachments(
            id, run_id, file_name, mime_type, kind, size, stored_name, created_at, purged_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          runId,
          path.basename(input.fileName),
          input.mimeType,
          input.kind,
          input.data.byteLength,
          storedName,
          now,
        );
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
    return (await this.getAttachment(id))!;
  }

  async completeRun(
    id: string,
    result: unknown,
    resolvedTarget?: ResolvedRunTarget,
  ): Promise<RunRecord> {
    const now = Date.now();
    const database = this.getDatabase();
    const update = resolvedTarget
      ? database.prepare(
          "UPDATE runs SET status = 'completed', result_json = ?, error = NULL, resolved_target = ?, updated_at = ? WHERE id = ?",
        ).run(JSON.stringify(result), resolvedTarget, now, id)
      : database.prepare(
          "UPDATE runs SET status = 'completed', result_json = ?, error = NULL, updated_at = ? WHERE id = ?",
        ).run(JSON.stringify(result), now, id);
    if (Number(update.changes) === 0) throw new Error(`Run not found: ${id}`);
    return (await this.getRun(id))!;
  }

  async failRun(id: string, error: string): Promise<RunRecord> {
    const update = this.getDatabase()
      .prepare("UPDATE runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(error, Date.now(), id);
    if (Number(update.changes) === 0) throw new Error(`Run not found: ${id}`);
    return (await this.getRun(id))!;
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const row = this.getDatabase().prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | RunRow
      | undefined;
    return row ? this.hydrateRun(row) : null;
  }

  async listRuns(options: RunListOptions = {}): Promise<{ items: RunRecord[]; total: number }> {
    const database = this.getDatabase();
    const limit = clampInteger(options.limit ?? 50, 1, 100);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const query = options.query?.trim();
    const where = query ? "WHERE input LIKE ? OR query_json LIKE ? OR result_json LIKE ?" : "";
    const parameters = query ? [`%${query}%`, `%${query}%`, `%${query}%`] : [];
    const rows = database
      .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...parameters, limit, offset) as unknown as RunRow[];
    const count = database
      .prepare(`SELECT COUNT(*) AS count FROM runs ${where}`)
      .get(...parameters) as { count: number };
    return {
      items: await Promise.all(rows.map((row) => this.hydrateRun(row))),
      total: Number(count.count),
    };
  }

  async getAttachment(id: string): Promise<StoredAttachment | null> {
    const row = this.getDatabase()
      .prepare("SELECT * FROM attachments WHERE id = ?")
      .get(id) as AttachmentRow | undefined;
    return row ? this.hydrateAttachment(row) : null;
  }

  async deleteRun(id: string): Promise<boolean> {
    const database = this.getDatabase();
    const rows = database
      .prepare("SELECT * FROM attachments WHERE run_id = ? AND stored_name IS NOT NULL")
      .all(id) as unknown as AttachmentRow[];
    const result = database.prepare("DELETE FROM runs WHERE id = ?").run(id);
    if (Number(result.changes) === 0) return false;
    await Promise.all(
      rows.map((row) => rm(path.join(this.filesDirectory, row.stored_name!), { force: true })),
    );
    return true;
  }

  async saveFavorite(input: SaveFavoriteInput): Promise<FavoriteRecord> {
    const database = this.getDatabase();
    if (input.sourceRunId && !(await this.getRun(input.sourceRunId))) {
      throw new Error(`Run not found: ${input.sourceRunId}`);
    }
    const existing = database
      .prepare("SELECT id, created_at FROM favorites WHERE entity_key = ?")
      .get(input.entityKey) as { id: string; created_at: number } | undefined;
    const id = existing?.id ?? randomUUID();
    const now = Date.now();
    database.prepare(
      `INSERT INTO favorites(
        id, entity_key, entity_type, title, image, candidate_json,
        source_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_key) DO UPDATE SET
        entity_type = excluded.entity_type,
        title = excluded.title,
        image = COALESCE(excluded.image, favorites.image),
        candidate_json = excluded.candidate_json,
        source_run_id = excluded.source_run_id,
        updated_at = excluded.updated_at`,
    ).run(
      id,
      input.entityKey,
      input.entityType,
      input.title,
      input.image ?? null,
      JSON.stringify(input.candidate),
      input.sourceRunId ?? null,
      existing?.created_at ?? now,
      now,
    );
    return (await this.getFavorite(id))!;
  }

  async getFavorite(id: string): Promise<FavoriteRecord | null> {
    const row = this.getDatabase()
      .prepare("SELECT * FROM favorites WHERE id = ?")
      .get(id) as FavoriteRow | undefined;
    return row ? this.hydrateFavorite(row) : null;
  }

  async listFavorites(
    options: FavoriteListOptions = {},
  ): Promise<{ items: FavoriteRecord[]; total: number }> {
    const database = this.getDatabase();
    const limit = clampInteger(options.limit ?? 100, 1, 200);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    const query = options.query?.trim();
    if (query) {
      clauses.push("(title LIKE ? OR entity_key LIKE ? OR candidate_json LIKE ?)");
      parameters.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (options.entityType?.trim()) {
      clauses.push("entity_type = ?");
      parameters.push(options.entityType.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = database
      .prepare(`SELECT * FROM favorites ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...parameters, limit, offset) as unknown as FavoriteRow[];
    const count = database
      .prepare(`SELECT COUNT(*) AS count FROM favorites ${where}`)
      .get(...parameters) as { count: number };
    return { items: rows.map((row) => this.hydrateFavorite(row)), total: Number(count.count) };
  }

  async deleteFavorite(id: string): Promise<boolean> {
    const result = this.getDatabase().prepare("DELETE FROM favorites WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  async storageStats(): Promise<StorageStats> {
    const database = this.getDatabase();
    const attachments = database
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN stored_name IS NOT NULL THEN size ELSE 0 END), 0) AS bytes_used,
          SUM(CASE WHEN stored_name IS NOT NULL THEN 1 ELSE 0 END) AS stored_attachments,
          COUNT(*) AS total_attachments
        FROM attachments`,
      )
      .get() as { bytes_used: number; stored_attachments: number; total_attachments: number };
    const runs = database.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number };
    return {
      bytesUsed: Number(attachments.bytes_used),
      maxBytes: this.maxAttachmentBytes,
      storedAttachments: Number(attachments.stored_attachments),
      totalAttachments: Number(attachments.total_attachments),
      runs: Number(runs.count),
    };
  }

  async cleanup(): Promise<CleanupResult> {
    const database = this.getDatabase();
    let stats = await this.storageStats();
    let purgedAttachments = 0;
    let bytesFreed = 0;
    if (stats.bytesUsed > this.maxAttachmentBytes) {
      const rows = database
        .prepare(
          "SELECT rowid, * FROM attachments WHERE stored_name IS NOT NULL ORDER BY created_at ASC, rowid ASC",
        )
        .all() as unknown as Array<AttachmentRow & { rowid: number }>;
      for (const row of rows) {
        if (stats.bytesUsed - bytesFreed <= this.maxAttachmentBytes) break;
        await rm(path.join(this.filesDirectory, row.stored_name!), { force: true });
        database
          .prepare("UPDATE attachments SET stored_name = NULL, purged_at = ? WHERE id = ?")
          .run(Date.now(), row.id);
        purgedAttachments += 1;
        bytesFreed += Number(row.size);
      }
    }

    let deletedRuns = 0;
    const runCount = database.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number };
    const excessRuns = Math.max(0, Number(runCount.count) - this.maxRuns);
    if (excessRuns > 0) {
      const rows = database
        .prepare("SELECT id FROM runs ORDER BY created_at ASC, rowid ASC LIMIT ?")
        .all(excessRuns) as unknown as Array<{ id: string }>;
      for (const row of rows) {
        if (await this.deleteRun(row.id)) deletedRuns += 1;
      }
    }
    stats = await this.storageStats();
    return { ...stats, purgedAttachments, deletedRuns, bytesFreed };
  }

  private async hydrateRun(row: RunRow): Promise<RunRecord> {
    const attachments = this.getDatabase()
      .prepare("SELECT * FROM attachments WHERE run_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(row.id) as unknown as AttachmentRow[];
    return {
      id: row.id,
      input: row.input,
      requestedTarget: row.requested_target,
      resolvedTarget: row.resolved_target,
      status: row.status,
      providers: parseJson<string[]>(row.providers_json, []),
      ...(row.query_json ? { query: parseJson<StoredRunQuery>(row.query_json, {}) } : {}),
      ...(row.result_json ? { result: parseJson<unknown>(row.result_json, null) } : {}),
      ...(row.error ? { error: row.error } : {}),
      attachments: attachments.map((attachment) => this.hydrateAttachment(attachment)),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private hydrateFavorite(row: FavoriteRow): FavoriteRecord {
    return {
      id: row.id,
      entityKey: row.entity_key,
      entityType: row.entity_type,
      title: row.title,
      ...(row.image ? { image: row.image } : {}),
      candidate: parseJson<unknown>(row.candidate_json, null),
      ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private hydrateAttachment(row: AttachmentRow): StoredAttachment {
    const stored = Boolean(row.stored_name);
    return {
      id: row.id,
      runId: row.run_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      kind: row.kind,
      size: Number(row.size),
      stored,
      ...(stored ? { path: path.join(this.filesDirectory, row.stored_name!) } : {}),
      createdAt: new Date(row.created_at).toISOString(),
      ...(row.purged_at ? { purgedAt: new Date(row.purged_at).toISOString() } : {}),
    };
  }

  private getDatabase(): DatabaseSync {
    if (!this.database) throw new Error("RunStore is not open");
    return this.database;
  }
}

function safeExtension(fileName: string, kind: AttachmentKind): string {
  const extension = path.extname(path.basename(fileName)).toLowerCase();
  if (kind === "torrent") return ".torrent";
  return extension === ".jpg" || extension === ".jpeg" || extension === ".png"
    ? extension
    : ".image";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

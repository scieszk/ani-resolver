import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

import { hasAppearanceFacts, parseAppearanceInput } from "../appearance.js";
import type { ProviderListItem } from "../provider-management.js";
import type { CharacterAppearance, ExternalId } from "../types.js";
import type { FavoriteContext } from "./favorite-context.js";
import {
  type AddAttachmentInput,
  type RunRecord,
  type RunStore,
  type StoredAttachment,
  type FavoriteRecord,
} from "./run-store.js";
import { type ResolvedRunTarget } from "./target.js";

const acceptedAttachmentTypes = [
  "image/jpeg",
  "image/png",
  "application/x-bittorrent",
] as const;
const targets = new Set<ResolvedRunTarget>(["work", "character", "image"]);

export interface ResolutionRequest {
  input: string;
  target: ResolvedRunTarget;
  providers: string[];
  attachments: StoredAttachment[];
  appearance?: CharacterAppearance;
  work?: ExternalId;
}

export interface ResolutionService {
  resolve(request: ResolutionRequest): Promise<{
    resolvedTarget: ResolvedRunTarget;
    result: unknown;
  }>;
  listProviders(): Promise<ProviderListItem[]>;
  getFavoriteContext(favorite: FavoriteRecord): Promise<FavoriteContext>;
}

export interface CreateWebAppOptions {
  store: RunStore;
  service: ResolutionService;
  serveStatic?: boolean;
  staticRoot?: string;
}

interface ParsedRunInput {
  input: string;
  target: ResolvedRunTarget;
  providers: string[];
  attachments: AddAttachmentInput[];
  appearance?: CharacterAppearance;
  work?: ExternalId;
}

export async function createWebApp(options: CreateWebAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 24 * 1024 * 1024 });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 4, fields: 20 },
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({
        error: { code: "attachment_too_large", message: "Attachments are limited to 20 MiB each" },
      });
    }
    if (error.code === "UNSUPPORTED_ATTACHMENT") {
      return reply.code(415).send(unsupportedAttachmentResponse());
    }
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? "internal_error" : "invalid_request",
        message: statusCode >= 500 ? "The request could not be completed" : error.message,
      },
    });
  });

  app.get("/api/health", async () => ({ status: "ok", auth: "none" }));

  app.get("/api/providers", async () => ({ items: await options.service.listProviders() }));

  app.get<{ Querystring: { query?: string; limit?: string; offset?: string } }>(
    "/api/runs",
    async (request) =>
      publicRunList(
        await options.store.listRuns({
          ...(request.query.query ? { query: request.query.query } : {}),
          ...(request.query.limit ? { limit: Number(request.query.limit) } : {}),
          ...(request.query.offset ? { offset: Number(request.query.offset) } : {}),
        }),
      ),
  );

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = await options.store.getRun(request.params.id);
    if (!run) return reply.code(404).send(notFound("run_not_found", "Run not found"));
    return publicRun(run);
  });

  app.post("/api/runs", async (request, reply) => {
    const parsed = await parseRunInput(request);
    validateRunInput(parsed);
    if (
      !parsed.input.trim() &&
      parsed.attachments.length === 0 &&
      !parsed.appearance &&
      !parsed.work
    ) {
      return reply.code(400).send({
        error: { code: "missing_input", message: "Provide a name, structured condition, image, or torrent" },
      });
    }

    const query = {
      ...(parsed.appearance ? { appearance: parsed.appearance } : {}),
      ...(parsed.work ? { work: parsed.work } : {}),
    };
    const run = await options.store.createRun({
      input: parsed.input.trim(),
      requestedTarget: parsed.target,
      resolvedTarget: parsed.target,
      providers: parsed.providers,
      ...(Object.keys(query).length ? { query } : {}),
    });
    try {
      const attachments: StoredAttachment[] = [];
      for (const attachment of parsed.attachments) {
        attachments.push(await options.store.addAttachment(run.id, attachment));
      }
      const outcome = await options.service.resolve({
        input: parsed.input.trim(),
        target: parsed.target,
        providers: parsed.providers,
        attachments,
        ...(parsed.appearance ? { appearance: parsed.appearance } : {}),
        ...(parsed.work ? { work: parsed.work } : {}),
      });
      const completed = await options.store.completeRun(
        run.id,
        outcome.result,
        outcome.resolvedTarget,
      );
      await options.store.cleanup();
      return reply.code(201).send(publicRun(completed));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await options.store.failRun(run.id, message);
      await options.store.cleanup();
      const failed = await options.store.getRun(run.id);
      return reply.code(422).send({
        error: { code: "resolution_failed", message },
        ...(failed ? { run: publicRun(failed) } : {}),
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    if (!(await options.store.deleteRun(request.params.id))) {
      return reply.code(404).send(notFound("run_not_found", "Run not found"));
    }
    return reply.code(204).send();
  });

  app.get<{ Querystring: { query?: string; type?: string; limit?: string; offset?: string } }>(
    "/api/favorites",
    async (request) => options.store.listFavorites({
      ...(request.query.query ? { query: request.query.query } : {}),
      ...(request.query.type ? { entityType: request.query.type } : {}),
      ...(request.query.limit ? { limit: Number(request.query.limit) } : {}),
      ...(request.query.offset ? { offset: Number(request.query.offset) } : {}),
    }),
  );

  app.post<{ Body: { runId?: unknown; candidateKey?: unknown } }>(
    "/api/favorites",
    async (request, reply) => {
      const runId = typeof request.body?.runId === "string" ? request.body.runId : "";
      const candidateKey = typeof request.body?.candidateKey === "string"
        ? request.body.candidateKey
        : "";
      if (!runId || !candidateKey) {
        return reply.code(400).send({
          error: { code: "invalid_favorite", message: "runId and candidateKey are required" },
        });
      }
      const run = await options.store.getRun(runId);
      if (!run) return reply.code(404).send(notFound("run_not_found", "Run not found"));
      const favorite = favoriteInputFromRun(run, candidateKey);
      if (!favorite) {
        return reply.code(404).send(notFound("candidate_not_found", "Candidate not found in run"));
      }
      return reply.code(201).send(await options.store.saveFavorite({ ...favorite, sourceRunId: runId }));
    },
  );

  app.get<{ Params: { id: string } }>("/api/favorites/:id", async (request, reply) => {
    const favorite = await options.store.getFavorite(request.params.id);
    if (!favorite) {
      return reply.code(404).send(notFound("favorite_not_found", "Favorite not found"));
    }
    return {
      favorite,
      context: await options.service.getFavoriteContext(favorite),
    };
  });

  app.delete<{ Params: { id: string } }>("/api/favorites/:id", async (request, reply) => {
    if (!(await options.store.deleteFavorite(request.params.id))) {
      return reply.code(404).send(notFound("favorite_not_found", "Favorite not found"));
    }
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/attachments/:id", async (request, reply) => {
    const attachment = await options.store.getAttachment(request.params.id);
    if (!attachment?.stored || !attachment.path) {
      return reply.code(404).send(notFound("attachment_not_found", "Attachment is not stored"));
    }
    reply.header("content-type", attachment.mimeType);
    reply.header(
      "content-disposition",
      `${attachment.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    return reply.send(createReadStream(attachment.path));
  });

  app.get("/api/storage", async () => options.store.storageStats());
  app.post("/api/storage/cleanup", async () => options.store.cleanup());

  if (options.serveStatic !== false) {
    const staticRoot =
      options.staticRoot ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "client");
    await app.register(fastifyStatic, { root: staticRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send(notFound("route_not_found", "API route not found"));
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

async function parseRunInput(request: FastifyRequest): Promise<ParsedRunInput> {
  if (!request.isMultipart()) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      input: typeof body.input === "string" ? body.input : "",
      target: parseTarget(body.target),
      providers: parseProviders(body.providers),
      attachments: [],
      ...parseStructuredFields(body.appearance, body.work),
    };
  }

  const fields = new Map<string, string[]>();
  const attachments: AddAttachmentInput[] = [];
  for await (const part of request.parts()) {
    if (part.type === "field") {
      const values = fields.get(part.fieldname) ?? [];
      values.push(String(part.value ?? ""));
      fields.set(part.fieldname, values);
      continue;
    }
    if (part.fieldname !== "attachments") {
      part.file.resume();
      continue;
    }
    const classified = classifyAttachment(part.filename, part.mimetype);
    if (!classified) {
      part.file.resume();
      throw Object.assign(new Error(`Unsupported attachment: ${part.filename}`), {
        statusCode: 415,
        code: "UNSUPPORTED_ATTACHMENT",
      });
    }
    attachments.push({
      fileName: part.filename,
      mimeType: classified.mimeType,
      kind: classified.kind,
      data: await part.toBuffer(),
    });
  }
  return {
    input: fields.get("input")?.at(-1) ?? "",
    target: parseTarget(fields.get("target")?.at(-1)),
    providers: parseProviders(fields.get("providers") ?? []),
    attachments,
    ...parseStructuredFields(
      fields.get("appearance")?.at(-1),
      fields.get("work")?.at(-1),
    ),
  };
}

function parseTarget(value: unknown): ResolvedRunTarget {
  if (typeof value !== "string" || !targets.has(value as ResolvedRunTarget)) {
    throw Object.assign(
      new Error("target must be one of work, character, or image"),
      { statusCode: 400 },
    );
  }
  return value as ResolvedRunTarget;
}

function parseProviders(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const providers = values
    .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
    .map((item) => item.trim())
    .filter(Boolean);
  return providers.length > 0 ? [...new Set(providers)] : ["all"];
}

function classifyAttachment(
  fileName: string,
  mimeType: string,
): Pick<AddAttachmentInput, "kind" | "mimeType"> | null {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/png") {
    return { kind: "image", mimeType: normalized };
  }
  if (
    normalized === "application/x-bittorrent" ||
    (normalized === "application/octet-stream" && fileName.toLowerCase().endsWith(".torrent"))
  ) {
    return { kind: "torrent", mimeType: "application/x-bittorrent" };
  }
  return null;
}

function parseStructuredFields(
  rawAppearance: unknown,
  rawWork: unknown,
): Pick<ParsedRunInput, "appearance" | "work"> {
  const appearanceValue = parseJsonField(rawAppearance, "appearance");
  if (
    appearanceValue !== undefined &&
    (!appearanceValue || typeof appearanceValue !== "object" || Array.isArray(appearanceValue))
  ) {
    throw Object.assign(new Error("appearance must be a JSON object"), { statusCode: 400 });
  }
  let appearance: CharacterAppearance | undefined;
  if (appearanceValue !== undefined) {
    try {
      appearance = parseAppearanceInput(appearanceValue);
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { statusCode: 400 });
    }
  }
  const workValue = parseJsonField(rawWork, "work");
  const work = parseWork(workValue);
  return {
    ...(appearance && hasAppearanceFacts(appearance) ? { appearance } : {}),
    ...(work ? { work } : {}),
  };
}

function parseJsonField(value: unknown, label: string): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    if (label === "work" && value.includes(":")) return value;
    throw Object.assign(new Error(`${label} must contain valid JSON`), { statusCode: 400 });
  }
}

function parseWork(value: unknown): ExternalId | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const [source, id, ...rest] = value.trim().split(":");
    if (!source || !id || rest.length) {
      throw Object.assign(new Error("work must use source:id"), { statusCode: 400 });
    }
    const externalId = { source: source === "bgm" ? "bangumi" : source, id };
    validateKnownExternalId(externalId);
    return externalId;
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    typeof (value as Record<string, unknown>).source !== "string" ||
    typeof (value as Record<string, unknown>).id !== "string"
  ) {
    throw Object.assign(new Error("work must be an external ID object"), { statusCode: 400 });
  }
  const record = value as Record<string, unknown>;
  const mediaKind = typeof record.mediaKind === "string" && isMediaKind(record.mediaKind)
    ? record.mediaKind
    : undefined;
  const source = (record.source as string).trim();
  const externalId = {
    source: source === "bgm" ? "bangumi" : source,
    id: (record.id as string).trim(),
    ...(mediaKind ? { mediaKind } : {}),
  };
  validateKnownExternalId(externalId);
  return externalId;
}

function validateKnownExternalId(value: ExternalId): void {
  if (value.source === "wikidata" && !/^Q[1-9][0-9]*$/u.test(value.id)) {
    throw Object.assign(new Error("work must use a valid Wikidata QID"), { statusCode: 400 });
  }
  if (["bangumi", "anilist", "tmdb"].includes(value.source) && !/^[0-9]+$/u.test(value.id)) {
    throw Object.assign(new Error(`work must use a numeric ${value.source} ID`), { statusCode: 400 });
  }
}

function isMediaKind(value: string): value is NonNullable<ExternalId["mediaKind"]> {
  return value === "tv" || value === "movie" || value === "ova" || value === "web" || value === "unknown";
}

function validateRunInput(input: ParsedRunInput): void {
  if (input.target !== "character" && (input.appearance || input.work)) {
    throw Object.assign(
      new Error("appearance and work constraints are only valid for character queries"),
      { statusCode: 400 },
    );
  }
  const incompatible = input.attachments.find((attachment) =>
    input.target === "image" ? attachment.kind !== "image" :
      input.target === "work" ? attachment.kind !== "torrent" : true,
  );
  if (incompatible) {
    throw Object.assign(
      new Error(`${incompatible.kind} attachments are not valid for ${input.target} queries`),
      { statusCode: 400 },
    );
  }
}

function favoriteInputFromRun(run: RunRecord, requestedKey: string) {
  const result = asRecord(run.result);
  const values = arrayOfRecords(result?.candidates ?? result?.matches ?? result?.items);
  const candidate = values.find((item) => candidateKey(item, run.resolvedTarget) === requestedKey);
  if (!candidate) return null;
  const facts = asRecord(candidate.facts);
  const names = Array.isArray(candidate.names)
    ? candidate.names.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  const title = names[0] ?? firstString(candidate.title, candidate.name) ?? "Untitled result";
  const entityType = firstString(candidate.entityType, candidate.matchType) ?? run.resolvedTarget;
  const image = firstString(facts?.image, facts?.cover, facts?.poster, candidate.image);
  return {
    entityKey: requestedKey,
    entityType,
    title,
    ...(image ? { image } : {}),
    candidate,
  };
}

function candidateKey(candidate: Record<string, unknown>, fallbackType: string): string {
  const explicit = firstString(candidate.key);
  if (explicit) return explicit;
  const provider = firstString(candidate.provider) ?? "unknown";
  const providerId = firstString(candidate.providerId) ?? "unknown";
  const type = firstString(candidate.entityType, candidate.matchType) ?? fallbackType;
  return `${type}:${provider}:${providerId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function publicRun(run: RunRecord): Omit<RunRecord, "attachments"> & {
  attachments: Array<Omit<StoredAttachment, "path">>;
} {
  return {
    ...run,
    attachments: run.attachments.map(({ path: _path, ...attachment }) => attachment),
  };
}

function publicRunList(list: { items: RunRecord[]; total: number }) {
  return { ...list, items: list.items.map(publicRun) };
}

function notFound(code: string, message: string) {
  return { error: { code, message } };
}

export function unsupportedAttachmentResponse() {
  return {
    error: {
      code: "unsupported_attachment_type",
      message: "Only JPEG, PNG, and torrent attachments are accepted",
      accepted: [...acceptedAttachmentTypes],
    },
  };
}

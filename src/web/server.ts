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

import type { ProviderListItem } from "../provider-management.js";
import {
  type AddAttachmentInput,
  type RunRecord,
  type RunStore,
  type StoredAttachment,
} from "./run-store.js";
import { inferRunTarget, type ResolvedRunTarget, type RunTarget } from "./target.js";

const acceptedAttachmentTypes = [
  "image/jpeg",
  "image/png",
  "application/x-bittorrent",
] as const;
const targets = new Set<RunTarget>(["auto", "work", "character", "image"]);

export interface ResolutionRequest {
  input: string;
  target: RunTarget;
  providers: string[];
  attachments: StoredAttachment[];
}

export interface ResolutionService {
  resolve(request: ResolutionRequest): Promise<{
    resolvedTarget: ResolvedRunTarget;
    result: unknown;
  }>;
  listProviders(): Promise<ProviderListItem[]>;
}

export interface CreateWebAppOptions {
  store: RunStore;
  service: ResolutionService;
  serveStatic?: boolean;
  staticRoot?: string;
}

interface ParsedRunInput {
  input: string;
  target: RunTarget;
  providers: string[];
  attachments: AddAttachmentInput[];
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
    const inferredTarget =
      parsed.target === "auto"
        ? inferRunTarget({
            input: parsed.input,
            attachments: parsed.attachments.map((item) => ({ kind: item.kind, path: "" })),
          })
        : parsed.target;
    if (!parsed.input.trim() && parsed.attachments.length === 0) {
      return reply.code(400).send({
        error: { code: "missing_input", message: "Provide text, an image, or a torrent" },
      });
    }

    const run = await options.store.createRun({
      input: parsed.input.trim(),
      requestedTarget: parsed.target,
      resolvedTarget: inferredTarget,
      providers: parsed.providers,
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
  };
}

function parseTarget(value: unknown): RunTarget {
  if (typeof value !== "string" || !value) return "auto";
  if (!targets.has(value as RunTarget)) {
    throw Object.assign(new Error(`Unknown target: ${value}`), { statusCode: 400 });
  }
  return value as RunTarget;
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

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RunStore } from "../src/web/run-store.js";
import { createWebApp, type ResolutionService } from "../src/web/server.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-web-"));
  temporaryDirectories.push(root);
  const store = new RunStore({ root });
  await store.open();
  const resolve = vi.fn<ResolutionService["resolve"]>(async (request) => ({
    resolvedTarget: request.target === "auto" ? "character" : request.target,
    result: {
      schemaVersion: "ani-resolver.resolve.v1",
      candidates: [{
        key: "character:anilist:unknown:12080",
        names: ["Isla"],
        score: 0.91,
        entityType: "character",
        facts: { image: "https://example.test/isla.jpg" },
        externalIds: [{ source: "anilist", id: "12080" }],
      }],
      providerRuns: [{ provider: "anilist", status: "ok", itemCount: 1 }],
    },
  }));
  const service: ResolutionService = {
    resolve,
    getFavoriteContext: vi.fn(async () => ({
      works: [{
        entityType: "work",
        provider: "anilist",
        providerId: "154587",
        names: ["Plastic Memories"],
        externalIds: [{ source: "anilist", id: "154587" }],
        relation: "MAIN",
        facts: {},
      }],
      characters: [],
      people: [{
        entityType: "person",
        provider: "bangumi",
        providerId: "1001",
        names: ["Sora Amamiya"],
        externalIds: [{ source: "bangumi-person", id: "1001" }],
        relation: "Voice actor",
        facts: {},
      }],
      providerRuns: [{ provider: "anilist", status: "ok", itemCount: 1 }],
      refreshedAt: "2026-08-30T02:00:00.000Z",
    })),
    listProviders: vi.fn(async () => [
      {
        id: "anilist",
        label: "AniList",
        mediaTypes: ["anime"],
        capabilities: ["character_search"],
        languages: ["en"],
        auth: "none",
        strengths: ["characters"],
        limitations: [],
        installed: true,
        initialized: true,
        status: "ready",
        distribution: "bundled",
      },
    ]),
  };
  const app = await createWebApp({ store, service, serveStatic: false });
  return { app, store, service, resolve };
}

describe("ani-resolver web API", () => {
  it("exposes health and provider metadata without a browser token", async () => {
    const { app, store } = await fixture();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", auth: "none" });

    const providers = await app.inject({ method: "GET", url: "/api/providers" });
    expect(providers.statusCode).toBe(200);
    expect(providers.json().items[0]).toMatchObject({ id: "anilist", status: "ready" });
    expect(JSON.stringify(providers.json())).not.toMatch(/token|apiKey|secret/i);
    await app.close();
    await store.close();
  });

  it("creates, searches, loads, and deletes a run", async () => {
    const { app, store, resolve } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        input: "Isla",
        target: "character",
        providers: ["all"],
        appearance: {
          hairColors: ["white"],
          hairStyles: ["twintails"],
          traits: ["expressionless"],
        },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      input: "Isla",
      requestedTarget: "character",
      resolvedTarget: "character",
      status: "completed",
      query: {
        appearance: expect.objectContaining({
          hairColors: ["white"],
          hairStyles: ["twintails"],
          traits: ["expressionless"],
        }),
      },
    });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "character",
        providers: ["all"],
        appearance: expect.objectContaining({ hairColors: ["white"] }),
      }),
    );

    const id = created.json().id as string;
    const list = await app.inject({ method: "GET", url: "/api/runs?query=twintails" });
    expect(list.json().items).toHaveLength(1);
    const detail = await app.inject({ method: "GET", url: `/api/runs/${id}` });
    expect(detail.json().result.candidates[0].names[0]).toBe("Isla");
    const deleted = await app.inject({ method: "DELETE", url: `/api/runs/${id}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/runs/${id}` })).statusCode).toBe(404);
    await app.close();
    await store.close();
  });

  it("rejects automatic target inference for new runs", async () => {
    const { app, store, resolve } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { input: "white-haired girl", target: "auto", providers: ["all"] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(resolve).not.toHaveBeenCalled();
    await app.close();
    await store.close();
  });

  it("rejects malformed structured character fields before resolution", async () => {
    const { app, store, resolve } = await fixture();
    const malformedAppearance = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        input: "Isla",
        target: "character",
        providers: ["wikidata"],
        appearance: { hairColors: "white" },
      },
    });
    const malformedWork = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        input: "Isla",
        target: "character",
        providers: ["wikidata"],
        work: { source: "wikidata", id: "Q1. } UNION {" },
      },
    });

    expect(malformedAppearance.statusCode).toBe(400);
    expect(malformedAppearance.json().error.message).toContain("appearance.hairColors");
    expect(malformedWork.statusCode).toBe(400);
    expect(malformedWork.json().error.message).toContain("Wikidata QID");
    expect(resolve).not.toHaveBeenCalled();
    await app.close();
    await store.close();
  });

  it("normalizes object-form work identifiers before resolution", async () => {
    const { app, store, resolve } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        input: "Isla",
        target: "character",
        providers: ["bangumi"],
        work: { source: " bgm ", id: " 265 " },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ work: { source: "bangumi", id: "265" } }),
    );
    await app.close();
    await store.close();
  });

  it("creates, searches, and deletes favorite candidate snapshots", async () => {
    const { app, store, service } = await fixture();
    const createdRun = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { input: "Isla", target: "character", providers: ["all"] },
    });
    const runId = createdRun.json().id as string;
    const created = await app.inject({
      method: "POST",
      url: "/api/favorites",
      payload: { runId, candidateKey: "character:anilist:unknown:12080" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      entityKey: "character:anilist:unknown:12080",
      entityType: "character",
      title: "Isla",
      sourceRunId: runId,
    });
    const favoriteId = created.json().id as string;
    const detail = await app.inject({ method: "GET", url: `/api/favorites/${favoriteId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      favorite: { id: favoriteId, title: "Isla" },
      context: {
        works: [expect.objectContaining({ names: ["Plastic Memories"] })],
        people: [expect.objectContaining({ names: ["Sora Amamiya"] })],
      },
    });
    expect(service.getFavoriteContext).toHaveBeenCalledWith(expect.objectContaining({ id: favoriteId }));
    const list = await app.inject({ method: "GET", url: "/api/favorites?query=Isla&type=character" });
    expect(list.json()).toMatchObject({ total: 1, items: [{ id: favoriteId }] });

    await app.inject({ method: "DELETE", url: `/api/runs/${runId}` });
    const retained = await app.inject({ method: "GET", url: "/api/favorites" });
    expect(retained.json().items[0]).not.toHaveProperty("sourceRunId");
    expect((await app.inject({ method: "DELETE", url: `/api/favorites/${favoriteId}` })).statusCode).toBe(204);
    await app.close();
    await store.close();
  });

  it("stores accepted image uploads and rejects unsupported attachments explicitly", async () => {
    const { app, store } = await fixture();
    const acceptedForm = new FormData();
    acceptedForm.set("input", "这是谁");
    acceptedForm.set("target", "image");
    acceptedForm.set("providers", "all");
    acceptedForm.append("attachments", new File(["png"], "frame.png", { type: "image/png" }));
    const accepted = await injectForm(app, acceptedForm);
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().attachments[0]).toMatchObject({
      fileName: "frame.png",
      kind: "image",
      stored: true,
    });

    const rejectedForm = new FormData();
    rejectedForm.append(
      "attachments",
      new File(["notes"], "notes.txt", { type: "text/plain" }),
    );
    const rejected = await injectForm(app, rejectedForm);
    expect(rejected.statusCode).toBe(415);
    expect(rejected.json()).toMatchObject({
      error: {
        code: "unsupported_attachment_type",
        accepted: ["image/jpeg", "image/png", "application/x-bittorrent"],
      },
    });
    await app.close();
    await store.close();
  });

  it("reports storage usage and supports manual cleanup", async () => {
    const { app, store } = await fixture();
    const before = await app.inject({ method: "GET", url: "/api/storage" });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ bytesUsed: 0, maxBytes: expect.any(Number) });
    const cleanup = await app.inject({ method: "POST", url: "/api/storage/cleanup" });
    expect(cleanup.statusCode).toBe(200);
    expect(cleanup.json()).toMatchObject({ purgedAttachments: 0 });
    await app.close();
    await store.close();
  });

  it("enforces the attachment quota even when resolution fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-web-failure-"));
    temporaryDirectories.push(root);
    const store = new RunStore({ root, maxAttachmentBytes: 2 });
    await store.open();
    const service: ResolutionService = {
      listProviders: vi.fn(async () => []),
      getFavoriteContext: vi.fn(async () => ({
        works: [], characters: [], people: [], providerRuns: [], refreshedAt: new Date().toISOString(),
      })),
      resolve: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };
    const app = await createWebApp({ store, service, serveStatic: false });
    const form = new FormData();
    form.set("target", "image");
    form.append("attachments", new File(["png"], "frame.png", { type: "image/png" }));

    const response = await injectForm(app, form);
    expect(response.statusCode).toBe(422);
    expect(await store.storageStats()).toMatchObject({ bytesUsed: 0, totalAttachments: 1 });
    expect(response.json().run).toMatchObject({
      status: "failed",
      attachments: [expect.objectContaining({ stored: false })],
    });
    await app.close();
    await store.close();
  });
});

async function injectForm(
  app: Awaited<ReturnType<typeof createWebApp>>,
  form: FormData,
) {
  const request = new Request("http://localhost/api/runs", { method: "POST", body: form });
  return app.inject({
    method: "POST",
    url: "/api/runs",
    headers: { "content-type": request.headers.get("content-type")! },
    payload: Buffer.from(await request.arrayBuffer()),
  });
}

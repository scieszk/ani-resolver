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
      candidates: [{ names: ["Isla"], score: 0.91, entityType: "character" }],
      providerRuns: [{ provider: "anilist", status: "ok", itemCount: 1 }],
    },
  }));
  const service: ResolutionService = {
    resolve,
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
        input: "女主是白发双马尾，前期没什么表情",
        target: "auto",
        providers: ["all"],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      input: "女主是白发双马尾，前期没什么表情",
      requestedTarget: "auto",
      resolvedTarget: "character",
      status: "completed",
    });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ target: "auto", providers: ["all"] }),
    );

    const id = created.json().id as string;
    const list = await app.inject({ method: "GET", url: "/api/runs?query=白发" });
    expect(list.json().items).toHaveLength(1);
    const detail = await app.inject({ method: "GET", url: `/api/runs/${id}` });
    expect(detail.json().result.candidates[0].names[0]).toBe("Isla");
    const deleted = await app.inject({ method: "DELETE", url: `/api/runs/${id}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/runs/${id}` })).statusCode).toBe(404);
    await app.close();
    await store.close();
  });

  it("stores accepted image uploads and rejects unsupported attachments explicitly", async () => {
    const { app, store } = await fixture();
    const acceptedForm = new FormData();
    acceptedForm.set("input", "这是谁");
    acceptedForm.set("target", "auto");
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

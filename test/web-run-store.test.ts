import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunStore } from "../src/web/run-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createStore(options: { maxAttachmentBytes?: number } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-runs-"));
  temporaryDirectories.push(root);
  const store = new RunStore({ root, ...options });
  await store.open();
  return store;
}

describe("RunStore", () => {
  it("persists a completed run and its attachment", async () => {
    const store = await createStore();
    const run = await store.createRun({
      input: "白发双马尾",
      requestedTarget: "auto",
      resolvedTarget: "character",
      providers: ["all"],
    });
    const attachment = await store.addAttachment(run.id, {
      fileName: "frame.png",
      mimeType: "image/png",
      kind: "image",
      data: Buffer.from("image-data"),
    });
    await store.completeRun(run.id, { schemaVersion: "test.result.v1", candidates: [] });

    const restored = await store.getRun(run.id);
    expect(restored).toMatchObject({
      id: run.id,
      input: "白发双马尾",
      status: "completed",
      requestedTarget: "auto",
      resolvedTarget: "character",
      providers: ["all"],
      result: { schemaVersion: "test.result.v1", candidates: [] },
    });
    expect(restored?.attachments).toHaveLength(1);
    expect(restored?.attachments[0]).toMatchObject({
      id: attachment.id,
      fileName: "frame.png",
      kind: "image",
      stored: true,
    });
    await expect(access(attachment.path!)).resolves.toBeUndefined();
    await store.close();
  });

  it("searches both the input and serialized result", async () => {
    const store = await createStore();
    const first = await store.createRun({
      input: "无表情白发角色",
      requestedTarget: "character",
      resolvedTarget: "character",
      providers: ["anilist"],
    });
    await store.completeRun(first.id, { candidates: [{ names: ["Isla"] }] });
    const second = await store.createRun({
      input: "Dungeon Meshi torrent",
      requestedTarget: "work",
      resolvedTarget: "work",
      providers: ["bangumi"],
    });
    await store.completeRun(second.id, { candidates: [{ names: ["Delicious in Dungeon"] }] });

    expect((await store.listRuns({ query: "白发" })).items.map((item) => item.id)).toEqual([
      first.id,
    ]);
    expect((await store.listRuns({ query: "Delicious" })).items.map((item) => item.id)).toEqual([
      second.id,
    ]);
    await store.close();
  });

  it("purges oldest stored files when the quota is exceeded but retains run history", async () => {
    const store = await createStore({ maxAttachmentBytes: 8 });
    const older = await store.createRun({
      input: "older",
      requestedTarget: "image",
      resolvedTarget: "image",
      providers: ["all"],
    });
    const first = await store.addAttachment(older.id, {
      fileName: "older.png",
      mimeType: "image/png",
      kind: "image",
      data: Buffer.from("12345"),
    });
    const newer = await store.createRun({
      input: "newer",
      requestedTarget: "image",
      resolvedTarget: "image",
      providers: ["all"],
    });
    const second = await store.addAttachment(newer.id, {
      fileName: "newer.png",
      mimeType: "image/png",
      kind: "image",
      data: Buffer.from("67890"),
    });

    const cleanup = await store.cleanup();
    expect(cleanup).toMatchObject({ purgedAttachments: 1, bytesUsed: 5 });
    expect((await store.getAttachment(first.id))?.stored).toBe(false);
    expect((await store.getAttachment(second.id))?.stored).toBe(true);
    expect(await store.getRun(older.id)).not.toBeNull();
    await store.close();
  });

  it("deletes attachment files together with a run", async () => {
    const store = await createStore();
    const run = await store.createRun({
      input: "delete me",
      requestedTarget: "work",
      resolvedTarget: "work",
      providers: ["all"],
    });
    const attachment = await store.addAttachment(run.id, {
      fileName: "release.torrent",
      mimeType: "application/x-bittorrent",
      kind: "torrent",
      data: Buffer.from("torrent"),
    });

    expect(await store.deleteRun(run.id)).toBe(true);
    expect(await store.getRun(run.id)).toBeNull();
    await expect(access(attachment.path!)).rejects.toThrow();
    await store.close();
  });

  it("deduplicates favorites and keeps their snapshot after history is deleted", async () => {
    const store = await createStore();
    const run = await store.createRun({
      input: "Isla",
      requestedTarget: "character",
      resolvedTarget: "character",
      providers: ["anilist"],
    });
    const candidate = {
      key: "character:anilist:unknown:12080",
      entityType: "character",
      names: ["Isla"],
      facts: { image: "https://example.test/isla.jpg" },
    };
    const first = await store.saveFavorite({
      entityKey: candidate.key,
      entityType: "character",
      title: "Isla",
      image: "https://example.test/isla.jpg",
      candidate,
      sourceRunId: run.id,
    });
    const duplicate = await store.saveFavorite({
      entityKey: candidate.key,
      entityType: "character",
      title: "アイラ / Isla",
      candidate,
      sourceRunId: run.id,
    });

    expect(duplicate.id).toBe(first.id);
    expect((await store.listFavorites({ query: "Isla" })).items).toHaveLength(1);
    expect((await store.listFavorites({ entityType: "work" })).items).toHaveLength(0);

    await store.deleteRun(run.id);
    expect(await store.getFavorite(first.id)).toMatchObject({
      id: first.id,
      entityKey: candidate.key,
      title: "アイラ / Isla",
      candidate,
    });
    expect((await store.getFavorite(first.id))?.sourceRunId).toBeUndefined();
    expect(await store.deleteFavorite(first.id)).toBe(true);
    expect(await store.getFavorite(first.id)).toBeNull();
    await store.close();
  });
});

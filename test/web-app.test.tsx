// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../web/src/App.js";
import type { AniResolverApi, WebRun } from "../web/src/types.js";

afterEach(cleanup);

describe("web App", () => {
  it("loads history as an input-to-output trail and opens the typed result", async () => {
    const api = fixtureApi([fixtureRun()]);
    render(<App api={api} />);

    expect((await screen.findAllByText("白发双马尾，前期没什么表情")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Isla")).length).toBeGreaterThan(0);
    expect(screen.getByText("CHARACTER")).toBeTruthy();
    expect(screen.getByText("91%")).toBeTruthy();
  });

  it("submits a new auto-typed run through the API", async () => {
    const created = fixtureRun();
    const api = fixtureApi([]);
    vi.mocked(api.createRun).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<App api={api} />);

    const input = await screen.findByLabelText("Resolution input");
    await user.type(input, "白发双马尾，前期没什么表情");
    await user.click(within(input.closest("form")!).getByRole("button", { name: "Resolve" }));

    expect(api.createRun).toHaveBeenCalledWith({
      input: "白发双马尾，前期没什么表情",
      target: "auto",
      providers: ["all"],
      attachments: [],
    });
    expect((await screen.findAllByText("Isla")).length).toBeGreaterThan(0);
  });

  it("searches persisted history through the API", async () => {
    const api = fixtureApi([fixtureRun()]);
    const user = userEvent.setup();
    render(<App api={api} />);

    const search = (await screen.findAllByLabelText("Search history"))[0]!;
    await user.type(search, "Isla");

    await vi.waitFor(() => expect(api.listRuns).toHaveBeenCalledWith("Isla"));
  });
});

function fixtureApi(runs: WebRun[]): AniResolverApi {
  return {
    listRuns: vi.fn(async () => ({ items: runs, total: runs.length })),
    getRun: vi.fn(async (id) => runs.find((run) => run.id === id) ?? null),
    createRun: vi.fn(),
    deleteRun: vi.fn(async () => undefined),
    listProviders: vi.fn(async () => ({
      items: [
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
      ],
    })),
    getStorage: vi.fn(async () => ({
      bytesUsed: 0,
      maxBytes: 100 * 1024 * 1024,
      storedAttachments: 0,
      totalAttachments: 0,
      runs: runs.length,
    })),
    cleanupStorage: vi.fn(async () => ({
      bytesUsed: 0,
      maxBytes: 100 * 1024 * 1024,
      storedAttachments: 0,
      totalAttachments: 0,
      runs: runs.length,
      purgedAttachments: 0,
      deletedRuns: 0,
      bytesFreed: 0,
    })),
  };
}

function fixtureRun(): WebRun {
  return {
    id: "run-1",
    input: "白发双马尾，前期没什么表情",
    requestedTarget: "auto",
    resolvedTarget: "character",
    status: "completed",
    providers: ["all"],
    attachments: [],
    createdAt: "2026-08-30T01:00:00.000Z",
    updatedAt: "2026-08-30T01:00:01.000Z",
    result: {
      schemaVersion: "ani-resolver.resolve.v1",
      candidates: [
        {
          entityType: "character",
          names: ["Isla"],
          score: 0.91,
          facts: { image: "https://example.test/isla.png", role: "main" },
          externalIds: [{ source: "anilist", id: "88753" }],
          sources: ["anilist"],
        },
      ],
      providerRuns: [{ provider: "anilist", status: "ok", itemCount: 1, elapsedMs: 42 }],
    },
  };
}

// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../web/src/App.js";
import type { AniResolverApi, WebFavorite, WebRun } from "../web/src/types.js";

afterEach(cleanup);

describe("web App", () => {
  it("loads history as an input-to-output trail and opens the typed result", async () => {
    const api = fixtureApi([fixtureRun()]);
    render(<App api={api} />);

    expect((await screen.findAllByText("Isla · White · Twintails · Expressionless")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Isla")).length).toBeGreaterThan(0);
    expect(screen.getByText("CHARACTER")).toBeTruthy();
    expect(screen.getByText("91%")).toBeTruthy();
  });

  it("submits explicit character conditions through the API", async () => {
    const created = fixtureRun();
    const api = fixtureApi([]);
    vi.mocked(api.createRun).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<App api={api} />);

    const input = await screen.findByLabelText("Character name");
    await user.type(input, "Isla");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(await screen.findByRole("button", { name: "White" }));
    await user.click(screen.getByRole("button", { name: "Twintails" }));
    await user.click(screen.getByRole("button", { name: "Close conditions" }));
    await user.click(within(input.closest("form")!).getByRole("button", { name: "Resolve" }));

    expect(api.createRun).toHaveBeenCalledWith({
      input: "Isla",
      target: "character",
      providers: ["all"],
      attachments: [],
      appearance: {
        hairColors: ["white"],
        eyeColors: [],
        hairStyles: ["twintails"],
        genders: [],
        apparentAges: [],
        clothing: [],
        traits: [],
      },
    });
    expect((await screen.findAllByText("Isla")).length).toBeGreaterThan(0);
  });

  it("saves a ranked candidate as a favorite", async () => {
    const api = fixtureApi([fixtureRun()]);
    const favorite = fixtureFavorite();
    vi.mocked(api.saveFavorite).mockResolvedValue(favorite);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Save Isla" }));

    expect(api.saveFavorite).toHaveBeenCalledWith(
      "run-1",
      "character:anilist:unknown:88753",
    );
  });

  it("searches persisted history through the API", async () => {
    const api = fixtureApi([fixtureRun()]);
    const user = userEvent.setup();
    render(<App api={api} />);

    const search = (await screen.findAllByLabelText("Search history"))[0]!;
    await user.type(search, "Isla");

    await vi.waitFor(() => expect(api.listRuns).toHaveBeenCalledWith("Isla"));
  });

  it("deletes a favorite returned only by server-side search", async () => {
    Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    const favorite = fixtureFavorite();
    const api = fixtureApi([]);
    vi.mocked(api.listFavorites).mockImplementation(async (query = "") => (
      query ? { items: [favorite], total: 1 } : { items: [], total: 101 }
    ));
    const user = userEvent.setup();
    render(<App api={api} />);

    const savedTab = (await screen.findAllByRole("tab", { name: "Saved" }))[0]!;
    await user.click(savedTab);
    const search = (await screen.findAllByLabelText("Search favorites"))[0]!;
    await user.type(search, "Isla");
    await user.click(await screen.findByRole("button", { name: "Remove Isla from favorites" }));

    expect(api.deleteFavorite).toHaveBeenCalledWith("favorite-1");
  });
});

function fixtureApi(runs: WebRun[]): AniResolverApi {
  return {
    listRuns: vi.fn(async () => ({ items: runs, total: runs.length })),
    getRun: vi.fn(async (id) => runs.find((run) => run.id === id) ?? null),
    createRun: vi.fn(),
    deleteRun: vi.fn(async () => undefined),
    listFavorites: vi.fn(async () => ({ items: [], total: 0 })),
    saveFavorite: vi.fn(),
    deleteFavorite: vi.fn(async () => undefined),
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
    input: "Isla",
    requestedTarget: "character",
    resolvedTarget: "character",
    status: "completed",
    providers: ["all"],
    query: {
      appearance: {
        hairColors: ["white"], eyeColors: [], hairStyles: ["twintails"],
        genders: [], apparentAges: [], clothing: [], traits: ["expressionless"],
      },
    },
    attachments: [],
    createdAt: "2026-08-30T01:00:00.000Z",
    updatedAt: "2026-08-30T01:00:01.000Z",
    result: {
      schemaVersion: "ani-resolver.resolve.v1",
      candidates: [
        {
          key: "character:anilist:unknown:88753",
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

function fixtureFavorite(): WebFavorite {
  const candidate = (fixtureRun().result as { candidates: unknown[] }).candidates[0];
  return {
    id: "favorite-1",
    entityKey: "character:anilist:unknown:88753",
    entityType: "character",
    title: "Isla",
    image: "https://example.test/isla.png",
    candidate,
    sourceRunId: "run-1",
    createdAt: "2026-08-30T01:01:00.000Z",
    updatedAt: "2026-08-30T01:01:00.000Z",
  };
}

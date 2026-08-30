// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../web/src/App.js";
import type {
  AniResolverApi,
  WebFavorite,
  WebFavoriteDetail,
  WebRun,
} from "../web/src/types.js";

afterEach(cleanup);

describe("web App", () => {
  it("opens as a personal encyclopedia and shows one confirmed favorite with relations", async () => {
    const favorite = fixtureFavorite();
    const api = fixtureApi([fixtureRun()], [favorite]);
    const user = userEvent.setup();
    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "Library" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /Open Isla/ }));

    expect(await screen.findByRole("heading", { name: "Isla" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Appears in" })).toBeTruthy();
    expect(screen.getByText("Plastic Memories")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "People" })).toBeTruthy();
    expect(screen.getByText("Sora Amamiya")).toBeTruthy();
    expect(screen.queryByText("91%")).toBeNull();
    expect(screen.queryByText("Ranked candidates")).toBeNull();
    expect(screen.queryByText("ani-resolver")).toBeNull();
    expect(api.getFavorite).toHaveBeenCalledWith("favorite-1");
  });

  it("distinguishes incomplete relation data and allows retrying it", async () => {
    const favorite = fixtureFavorite();
    const api = fixtureApi([], [favorite]);
    vi.mocked(api.getFavorite).mockResolvedValue({
      favorite,
      context: {
        works: [],
        characters: [],
        people: [],
        providerRuns: [{
          provider: "bangumi",
          status: "unavailable",
          itemCount: 0,
          message: "people endpoint unavailable",
        }],
        refreshedAt: "2026-08-30T02:00:00.000Z",
      },
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /Open Isla/ }));

    expect(await screen.findByText(/Related entries may be incomplete/)).toBeTruthy();
    expect(screen.queryByText("No relationships are available from the configured sources.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry related entries" }));
    await vi.waitFor(() => expect(api.getFavorite).toHaveBeenCalledTimes(2));
  });

  it("loads history as an input-to-output trail and opens the typed result", async () => {
    const api = fixtureApi([fixtureRun()]);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click((await screen.findAllByRole("button", { name: "Activity" }))[0]!);
    expect(await screen.findByText("Isla · White · Twintails · Expressionless")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Open run/ }));
    expect(screen.getByText("CHARACTER")).toBeTruthy();
    expect(screen.getByText("91%")).toBeTruthy();
  });

  it("submits explicit character conditions through the API", async () => {
    const created = fixtureRun();
    const api = fixtureApi([]);
    vi.mocked(api.createRun).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click((await screen.findAllByRole("button", { name: "Identify" }))[0]!);
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

  it("bounds custom condition labels so chips remain usable on narrow screens", async () => {
    const api = fixtureApi([]);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click((await screen.findAllByRole("button", { name: "Identify" }))[0]!);
    await user.click(await screen.findByRole("button", { name: "Add" }));
    const customInput = await screen.findByLabelText("Custom condition value");

    expect(customInput.getAttribute("maxlength")).toBe("64");
    await user.type(customInput, "x".repeat(80));
    const boundedValue = (customInput as HTMLInputElement).value;
    expect(boundedValue).toHaveLength(64);
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.click(screen.getByRole("button", { name: "Close conditions" }));

    const chipLabel = await screen.findByText(`X${boundedValue.slice(1)}`);
    expect(chipLabel.classList.contains("ui-chip-label")).toBe(true);
  });

  it("saves a ranked candidate as a favorite", async () => {
    const api = fixtureApi([fixtureRun()]);
    const favorite = fixtureFavorite();
    vi.mocked(api.saveFavorite).mockResolvedValue(favorite);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click((await screen.findAllByRole("button", { name: "Identify" }))[0]!);
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

    await user.click((await screen.findAllByRole("button", { name: "Activity" }))[0]!);
    const search = await screen.findByLabelText("Search history");
    await user.type(search, "Isla");

    await vi.waitFor(() => expect(api.listRuns).toHaveBeenCalledWith("Isla"));
  });

  it("deletes a favorite returned only by server-side search", async () => {
    const favorite = fixtureFavorite();
    const api = fixtureApi([]);
    vi.mocked(api.listFavorites).mockImplementation(async (query = "") => (
      query ? { items: [favorite], total: 1 } : { items: [], total: 101 }
    ));
    const user = userEvent.setup();
    render(<App api={api} />);

    const search = await screen.findByLabelText("Search library");
    await user.type(search, "Isla");
    await user.click(await screen.findByRole("button", { name: "Remove Isla from library" }));

    expect(api.deleteFavorite).toHaveBeenCalledWith("favorite-1");
  });
});

function fixtureApi(runs: WebRun[], favorites: WebFavorite[] = []): AniResolverApi {
  return {
    listRuns: vi.fn(async () => ({ items: runs, total: runs.length })),
    getRun: vi.fn(async (id) => runs.find((run) => run.id === id) ?? null),
    createRun: vi.fn(),
    deleteRun: vi.fn(async () => undefined),
    listFavorites: vi.fn(async () => ({ items: favorites, total: favorites.length })),
    getFavorite: vi.fn(async (id) => {
      const favorite = favorites.find((item) => item.id === id);
      return favorite ? fixtureFavoriteDetail(favorite) : null;
    }),
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

function fixtureFavoriteDetail(favorite = fixtureFavorite()): WebFavoriteDetail {
  return {
    favorite,
    context: {
      works: [{
        entityType: "work",
        provider: "anilist",
        providerId: "154587",
        names: ["Plastic Memories", "プラスティック・メモリーズ"],
        externalIds: [{ source: "anilist", id: "154587", mediaKind: "tv" }],
        image: "https://example.test/plastic-memories.jpg",
        mediaKind: "tv",
        year: 2015,
        relation: "MAIN",
        facts: {},
      }],
      characters: [{
        entityType: "character",
        provider: "anilist",
        providerId: "12121",
        names: ["Tsukasa Mizugaki"],
        externalIds: [{ source: "anilist", id: "12121" }],
        image: "https://example.test/tsukasa.jpg",
        relation: "Co-star",
        facts: {},
      }],
      people: [{
        entityType: "person",
        provider: "bangumi",
        providerId: "1001",
        names: ["Sora Amamiya"],
        externalIds: [{ source: "bangumi-person", id: "1001" }],
        image: "https://example.test/sora-amamiya.jpg",
        relation: "Voice actor",
        facts: {},
      }],
      providerRuns: [],
      refreshedAt: "2026-08-30T02:00:00.000Z",
    },
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

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { Readable, Writable } from "node:stream";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { compactQueryFiles, createCli, parseExternalId, runCli } from "../src/cli.js";
import { ProviderManager } from "../src/provider-management.js";
import { RunStore } from "../src/web/run-store.js";
import type {
  ExternalId,
  ImageMatch,
  ImageQuery,
  Provider,
  ProviderCandidate,
  ProviderManifest,
  ProviderRun,
  ResolveQuery,
} from "../src/types.js";

class MemoryStream extends Writable {
  value = "";

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void) {
    this.value += chunk.toString();
    callback();
  }
}

class ImageCliProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "image-fixture",
    label: "Image Fixture",
    mediaTypes: ["anime"],
    capabilities: ["anime_scene_lookup"],
    languages: ["en"],
    auth: "none",
    strengths: ["tests"],
    limitations: [],
  };

  async searchImage(query: ImageQuery): Promise<ProviderRun<ImageMatch>> {
    return {
      provider: this.manifest.id,
      status: "ok",
      items: Array.from({ length: query.limit }, (_, index) => ({
        provider: this.manifest.id,
        providerId: String(index + 1),
        matchType: "anime_scene" as const,
        rank: index + 1,
        similarity: 0.9 - index * 0.01,
        names: [`Scene ${index + 1}`],
        externalIds: [{ source: "anilist", id: String(100 + index) }],
        facts: {},
        evidence: [],
      })),
    };
  }
}

class CliProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "fixture",
    label: "Fixture",
    mediaTypes: ["anime"],
    capabilities: ["work_search", "work_detail", "work_characters", "character_search"],
    languages: ["en"],
    auth: "none",
    strengths: ["tests"],
    limitations: [],
  };

  async searchWorks(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    return this.work(query.title ?? query.text);
  }

  async searchCharacters(_query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>> {
    return this.character();
  }

  async getEntity(id: ExternalId, entityType: "work" | "character") {
    return entityType === "work" ? this.work("Fixture Work", id) : this.character(id);
  }

  async listWorkCharacters(_work: ExternalId) {
    return this.character();
  }

  private work(name: string, id: ExternalId = { source: "fixture", id: "1" }): ProviderRun<ProviderCandidate> {
    return {
      provider: "fixture",
      status: "ok",
      items: [
        {
          entityType: "work",
          provider: "fixture",
          providerId: id.id,
          names: [name],
          externalIds: [id],
          mediaKind: "tv",
          providerScore: 0.9,
          facts: {},
          evidence: [],
        },
      ],
    };
  }

  private character(id: ExternalId = { source: "fixture", id: "2" }): ProviderRun<ProviderCandidate> {
    return {
      provider: "fixture",
      status: "ok",
      items: [
        {
          entityType: "character",
          provider: "fixture",
          providerId: id.id,
          names: ["Fixture Character"],
          externalIds: [id],
          providerScore: 0.85,
          facts: { role: "main" },
          evidence: [],
        },
      ],
    };
  }
}

class AlternateCliProvider extends CliProvider {
  override readonly manifest: ProviderManifest = {
    id: "fixture-local",
    label: "Fixture Local",
    mediaTypes: ["anime"],
    capabilities: ["work_characters"],
    languages: ["en"],
    auth: "none",
    strengths: ["tests"],
    limitations: [],
  };

  override async listWorkCharacters(_work: ExternalId) {
    return {
      provider: "fixture-local",
      status: "ok" as const,
      items: [
        {
          entityType: "character" as const,
          provider: "fixture-local",
          providerId: "local-2",
          names: ["Local Character"],
          externalIds: [{ source: "fixture", id: "local-2" }],
          providerScore: 0.9,
          facts: {},
          evidence: [],
        },
      ],
    };
  }
}

class RelationCliProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "relation-fixture",
    label: "Relation Fixture",
    mediaTypes: ["anime"],
    capabilities: ["entity_relations"],
    languages: ["en"],
    auth: "none",
    strengths: ["tests"],
    limitations: [],
  };

  async listEntityRelations() {
    return {
      provider: "relation-fixture",
      status: "ok" as const,
      items: [{
        entityType: "person" as const,
        provider: "relation-fixture",
        providerId: "person-1",
        names: ["Fixture Person"],
        externalIds: [{ source: "fixture", id: "person-1" }],
        relation: "voice_actor",
        facts: {},
      }],
    };
  }
}

async function run(args: string[]) {
  return runWithProviders(args, [new CliProvider()]);
}

async function runWithProviders(args: string[], providers: Provider[]) {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const cli = createCli({ providers, stdout, stderr });
  await cli.parseAsync(args, { from: "user" });
  return { stdout: stdout.value, stderr: stderr.value };
}

function webOptionNames(cli: ReturnType<typeof createCli>): string[] {
  const web = cli.commands.find((command) => command.name() === "web")!;
  return web.options.map((option) => option.attributeName());
}

describe("CLI", () => {
  it("documents explicit provider selection in command-specific help", () => {
    const cli = createCli({ providers: [new CliProvider(), new ImageCliProvider()] });
    const resolve = cli.commands.find((command) => command.name() === "resolve")!;
    const work = resolve.commands.find((command) => command.name() === "work")!;
    const character = resolve.commands.find((command) => command.name() === "character")!;
    const image = resolve.commands.find((command) => command.name() === "image")!;
    const provider = cli.commands.find((command) => command.name() === "provider")!;
    const providerList = provider.commands.find((command) => command.name() === "list")!;
    const providerInstall = provider.commands.find((command) => command.name() === "install")!;
    const providerInit = provider.commands.find((command) => command.name() === "init")!;
    const web = cli.commands.find((command) => command.name() === "web")!;

    expect(cli.description()).toContain("metadata resolution infrastructure");
    expect(work.description()).toContain("work");
    expect(work.helpInformation()).toContain("--providers <ids>");
    expect(work.helpInformation()).toContain("required");
    expect(work.helpInformation()).not.toContain("--work <external-id>");
    expect(character.helpInformation()).toContain("--work <external-id>");
    expect(character.helpInformation()).toContain("--hair-color <value>");
    expect(character.helpInformation()).toContain("--input-json <path>");
    expect(character.description()).not.toContain("descriptive clues");
    expect(image.helpInformation()).toMatch(/selected providers receive\s+image data/);
    expect(providerList.description()).toContain("capabilities");
    expect(providerInstall.description()).toContain("provider package");
    expect(providerInit.description()).toContain("credentials");
    expect(web.description()).toContain("browser");
    expect(web.helpInformation()).toContain("--host <host>");
    expect(web.helpInformation()).toContain("0.0.0.0");
  });

  it("builds a character query from explicit repeated appearance flags", async () => {
    const searchCharacters = vi.fn(async (_query: ResolveQuery) => ({
      provider: "fixture",
      status: "empty" as const,
      items: [],
    }));
    const provider: Provider = {
      manifest: {
        ...new CliProvider().manifest,
        capabilities: ["character_search", "character_appearance_search"],
      },
      searchCharacters,
    };
    const stdout = new MemoryStream();
    const cli = createCli({ providers: [provider], stdout, stderr: new MemoryStream() });

    await cli.parseAsync([
      "resolve", "character", "--providers", "fixture",
      "--hair-color", "white", "--hair-color", "silver",
      "--hair-style", "twintails", "--gender", "female", "--json",
    ], { from: "user" });

    expect(searchCharacters).toHaveBeenCalledWith(expect.objectContaining({
      text: "",
      appearance: {
        hairColors: ["white", "silver"],
        eyeColors: [],
        hairStyles: ["twintails"],
        genders: ["female"],
        apparentAges: [],
        clothing: [],
        traits: [],
      },
    }));
    expect(JSON.parse(stdout.value).query.appearance.hairStyles).toEqual(["twintails"]);
  });

  it("reads a complete structured character request from JSON stdin", async () => {
    const searchCharacters = vi.fn(async (_query: ResolveQuery) => ({
      provider: "fixture",
      status: "empty" as const,
      items: [],
    }));
    const provider: Provider = {
      manifest: {
        ...new CliProvider().manifest,
        capabilities: ["character_search", "character_appearance_search"],
      },
      searchCharacters,
    };
    const stdout = new MemoryStream();
    const stdin = Readable.from([JSON.stringify({
      name: "Isla",
      providers: ["fixture"],
      top: 3,
      work: "anilist:20931",
      appearance: { traits: ["expressionless"] },
    })]);
    const cli = createCli({ providers: [provider], stdin, stdout, stderr: new MemoryStream() });

    await cli.parseAsync(["resolve", "character", "--input-json", "-", "--json"], { from: "user" });

    expect(searchCharacters).toHaveBeenCalledWith(expect.objectContaining({
      text: "Isla",
      work: { source: "anilist", id: "20931" },
      limit: 3,
      appearance: expect.objectContaining({ traits: ["expressionless"] }),
    }));
  });

  it("runs a work query from one stable JSON request on stdin", async () => {
    const stdout = new MemoryStream();
    const cli = createCli({
      providers: [new CliProvider()],
      stdin: Readable.from([JSON.stringify({
        target: "work",
        input: "Fixture Work",
        providers: ["fixture"],
        top: 3,
      })]),
      stdout,
      stderr: new MemoryStream(),
    });

    await cli.parseAsync(["query", "--input-json", "-", "--json"], { from: "user" });

    expect(JSON.parse(stdout.value)).toMatchObject({
      schemaVersion: "ani-resolver.resolve.v1",
      outcome: "matched",
      query: { entityType: "work", title: "Fixture Work" },
      candidates: [expect.objectContaining({ names: ["Fixture Work"] })],
    });
  });

  it("runs an image query from the same typed JSON entry point", async () => {
    const stdout = new MemoryStream();
    const cli = createCli({
      providers: [new ImageCliProvider()],
      stdin: Readable.from([JSON.stringify({
        target: "image",
        input: "https://example.test/frame.jpg",
        providers: ["image-fixture"],
        top: 2,
      })]),
      stdout,
      stderr: new MemoryStream(),
    });

    await cli.parseAsync(["query", "--input-json", "-", "--json"], { from: "user" });

    expect(JSON.parse(stdout.value)).toMatchObject({
      schemaVersion: "ani-resolver.image.v1",
      outcome: "matched",
      matches: [
        expect.objectContaining({ provider: "image-fixture", rank: 1 }),
        expect.objectContaining({ provider: "image-fixture", rank: 2 }),
      ],
    });
  });

  it("runs a structured character query with work and appearance fields", async () => {
    const searchCharacters = vi.fn(async (_query: ResolveQuery) => ({
      provider: "fixture",
      status: "empty" as const,
      items: [],
    }));
    const provider: Provider = {
      manifest: {
        ...new CliProvider().manifest,
        capabilities: ["character_search", "character_appearance_search"],
      },
      searchCharacters,
    };
    const cli = createCli({
      providers: [provider],
      stdin: Readable.from([JSON.stringify({
        target: "character",
        input: "Isla",
        providers: ["fixture"],
        work: "anilist:20931",
        appearance: { traits: ["expressionless"] },
      })]),
      stdout: new MemoryStream(),
      stderr: new MemoryStream(),
    });

    await cli.parseAsync(["query", "--input-json", "-", "--json"], { from: "user" });

    expect(searchCharacters).toHaveBeenCalledWith(expect.objectContaining({
      text: "Isla",
      work: { source: "anilist", id: "20931" },
      appearance: expect.objectContaining({ traits: ["expressionless"] }),
    }));
  });

  it("rejects character-only fields on a work query", async () => {
    const stderr = new MemoryStream();
    const exitCode = await runCli(
      ["node", "ani-resolver", "query", "--input-json", "-", "--json"],
      {
        providers: [new CliProvider()],
        stdin: Readable.from([JSON.stringify({
          target: "work",
          input: "Dungeon Meshi",
          providers: ["fixture"],
          appearance: { traits: ["fantasy"] },
        })]),
        stdout: new MemoryStream(),
        stderr,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr.value).error.message).toContain(
      "appearance is only valid for character queries",
    );
  });

  it("rejects non-string provider entries instead of silently dropping them", async () => {
    const stderr = new MemoryStream();
    const exitCode = await runCli(
      ["node", "ani-resolver", "query", "--input-json", "-", "--json"],
      {
        providers: [new CliProvider()],
        stdin: Readable.from([JSON.stringify({
          target: "work",
          input: "Dungeon Meshi",
          providers: ["fixture", 42],
        })]),
        stdout: new MemoryStream(),
        stderr,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr.value).error.message).toContain(
      "providers must contain only non-empty strings",
    );
  });

  it("rejects malformed appearance arrays in character JSON", async () => {
    const stderr = new MemoryStream();
    const exitCode = await runCli(
      ["node", "ani-resolver", "resolve", "character", "--input-json", "-", "--json"],
      {
        providers: [new CliProvider()],
        stdin: Readable.from([JSON.stringify({
          name: "Isla",
          providers: ["fixture"],
          appearance: { hairColors: "white" },
        })]),
        stdout: new MemoryStream(),
        stderr,
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr.value).error.message).toContain("appearance.hairColors");
  });

  it("starts the browser UI with LAN-safe options and no access token", async () => {
    const startWebServer = vi.fn(async () => undefined);
    const cli = createCli({ providers: [new CliProvider()], startWebServer });

    await cli.parseAsync(
      ["web", "--host", "0.0.0.0", "--port", "4517", "--max-storage-mb", "64"],
      { from: "user" },
    );

    expect(startWebServer).toHaveBeenCalledWith({
      host: "0.0.0.0",
      port: 4517,
      maxStorageMb: 64,
      stdout: process.stdout,
    });
    expect(webOptionNames(cli)).not.toContain("token");
  });

  it("preserves a TMDB media kind in external ID syntax", () => {
    expect(parseExternalId("tmdb-tv:209867")).toEqual({
      source: "tmdb",
      id: "209867",
      mediaKind: "tv",
    });
  });

  it("lists provider capability manifests without orchestration hints", async () => {
    const result = await run(["provider", "list", "--json"]);
    const output = JSON.parse(result.stdout);

    expect(output.providers[0]).toMatchObject({
      id: "fixture",
      capabilities: ["work_search", "work_detail", "work_characters", "character_search"],
    });
    expect(result.stdout).not.toContain("recommended_disambiguators");
  });

  it("uses concise human output by default and compact JSON when requested", async () => {
    const human = await run([
      "resolve", "work", "Fixture Work", "--providers", "fixture", "--top", "1",
    ]);
    const machine = await run([
      "resolve", "work", "Fixture Work", "--providers", "fixture", "--top", "1", "--json",
    ]);

    expect(human.stdout).toContain("Outcome: matched");
    expect(human.stdout).toContain("1. Fixture Work");
    expect(human.stdout).toContain("fixture:1");
    expect(human.stdout.trimStart().startsWith("{")).toBe(false);
    expect(JSON.parse(machine.stdout)).toMatchObject({ outcome: "matched" });
    expect(machine.stdout).not.toContain("\n  \"");
  });

  it("renders a scannable provider catalog without JSON flags", async () => {
    const result = await runWithProviders(
      ["provider", "list", "--ready"],
      [new CliProvider(), new ImageCliProvider()],
    );

    expect(result.stdout).toContain("ID\tStatus\tAuth\tCapabilities");
    expect(result.stdout).toContain("fixture");
    expect(result.stdout).toContain("work_search");
    expect(result.stdout.trimStart().startsWith("{")).toBe(false);
  });

  it("filters providers by readiness and capability and shows one provider", async () => {
    const providers = [new CliProvider(), new ImageCliProvider()];
    const filtered = JSON.parse((await runWithProviders(
      ["provider", "list", "--ready", "--capability", "character_search", "--json"],
      providers,
    )).stdout);
    const shown = JSON.parse((await runWithProviders(
      ["provider", "show", "image-fixture", "--json"],
      providers,
    )).stdout);

    expect(filtered.providers.map((provider: ProviderManifest) => provider.id)).toEqual(["fixture"]);
    expect(shown.provider).toMatchObject({
      id: "image-fixture",
      status: "ready",
      capabilities: ["anime_scene_lookup"],
    });
  });

  it("reads provider credentials from stdin instead of requiring a command-line secret", async () => {
    const providerManager = new ProviderManager();
    const init = vi.spyOn(providerManager, "init").mockResolvedValue({
      provider: "tmdb",
      status: "ready",
    });
    const stdout = new MemoryStream();
    const cli = createCli({
      providers: [new CliProvider()],
      providerManager,
      stdin: Readable.from(["secret-token\n"]),
      stdout,
      stderr: new MemoryStream(),
    });

    await cli.parseAsync(["provider", "init", "tmdb", "--token-stdin", "--json"], {
      from: "user",
    });

    expect(init).toHaveBeenCalledWith("tmdb", { token: "secret-token" });
    expect(stdout.value).not.toContain("secret-token");
  });

  it("reports a known provider that still needs initialization", async () => {
    const providerManager = new ProviderManager();
    vi.spyOn(providerManager, "list").mockResolvedValue([{
      id: "bangumi-archive",
      label: "Bangumi Archive",
      mediaTypes: ["anime"],
      capabilities: ["work_search"],
      languages: ["zh", "ja"],
      auth: "none",
      strengths: [],
      limitations: [],
      installed: true,
      initialized: false,
      status: "needs_init",
      distribution: "bundled",
    }]);
    vi.spyOn(providerManager, "loadProviderHost").mockResolvedValue({
      providers: () => [],
      dispose: async () => undefined,
    } as never);
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      ["node", "ani-resolver", "resolve", "work", "Dungeon Meshi", "--providers", "bangumi-archive", "--json"],
      { providerManager, historyStore: false, stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe("");
    expect(JSON.parse(stderr.value)).toMatchObject({
      error: {
        code: "provider_not_ready",
        details: {
          providers: ["bangumi-archive"],
          providerStatuses: [{ id: "bangumi-archive", status: "needs_init" }],
        },
      },
    });
  });

  it("disposes the provider host when a command fails", async () => {
    const providerManager = new ProviderManager();
    const dispose = vi.fn(async () => undefined);
    vi.spyOn(providerManager, "loadProviderHost").mockResolvedValue({
      providers: () => [],
      dispose,
    } as never);
    vi.spyOn(providerManager, "list").mockResolvedValue([]);

    const exitCode = await runCli(
      ["node", "ani-resolver", "resolve", "work", "Dungeon Meshi", "--providers", "missing", "--json"],
      {
        providerManager,
        historyStore: false,
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
      },
    );

    expect(exitCode).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("returns initialization requirements without an interactive prompt", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const providerManager = new ProviderManager({
      home: path.join(process.cwd(), ".test-provider-home-does-not-need-to-exist"),
    });
    const cli = createCli({ providers: [new CliProvider()], providerManager, stdout, stderr });

    await cli.parseAsync(["provider", "init", "bangumi-archive", "--json"], { from: "user" });

    expect(JSON.parse(stdout.value)).toMatchObject({
      provider: "bangumi-archive",
      status: "needs_input",
      required: ["archive"],
    });
  });

  it("compacts large file evidence for agent-facing output", () => {
    const files = Array.from({ length: 100 }, (_, index) => `Episode ${index + 1}.mkv`);

    expect(compactQueryFiles(files)).toEqual({
      fileCount: 100,
      files: [
        "Episode 1.mkv",
        "Episode 2.mkv",
        "Episode 3.mkv",
        "Episode 4.mkv",
        "Episode 5.mkv",
        "Episode 6.mkv",
        "Episode 7.mkv",
        "Episode 8.mkv",
      ],
      filesTruncated: true,
    });
  });

  it("parses release evidence as JSON", async () => {
    const result = await run(["parse", "[Group] Example - 02 [1080p].mkv", "--json"]);
    expect(JSON.parse(result.stdout)).toMatchObject({ title: "Example", episode: 2 });
  });

  it("exposes a non-destructive inventory command for organizing local files", () => {
    const cli = createCli({ providers: [new CliProvider()] });
    const inventory = cli.commands.find((command) => command.name() === "inventory");

    expect(inventory?.description()).toContain("without moving");
    expect(inventory?.helpInformation()).toContain("--full-files");
  });

  it("resolves top-N works through selected providers", async () => {
    const result = await run([
      "resolve",
      "work",
      "Fixture Work",
      "--providers",
      "fixture",
      "--top",
      "3",
      "--json",
    ]);
    const output = JSON.parse(result.stdout);

    expect(output.schemaVersion).toBe("ani-resolver.resolve.v1");
    expect(output.candidates[0]).toMatchObject({ entityType: "work", names: ["Fixture Work"] });
  });

  it("records direct resolutions in shared history and can opt out", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-cli-history-"));
    const store = new RunStore({ root });
    await store.open();
    try {
      const first = createCli({
        providers: [new CliProvider()],
        historyStore: store,
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
      });
      await first.parseAsync([
        "resolve", "work", "Fixture Work", "--providers", "fixture", "--json",
      ], { from: "user" });

      const second = createCli({
        providers: [new CliProvider()],
        historyStore: store,
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
      });
      await second.parseAsync([
        "resolve", "work", "Do Not Record", "--providers", "fixture", "--no-history", "--json",
      ], { from: "user" });

      const history = await store.listRuns();
      expect(history.total).toBe(1);
      expect(history.items[0]).toMatchObject({
        input: "Fixture Work",
        resolvedTarget: "work",
        status: "completed",
        result: { outcome: "matched" },
      });
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores local image inputs with CLI history and applies automatic cleanup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-cli-attachment-"));
    const imagePath = path.join(root, "frame.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const store = new RunStore({ root: path.join(root, "history") });
    await store.open();
    const cleanup = vi.spyOn(store, "cleanup");
    try {
      const cli = createCli({
        providers: [new ImageCliProvider()],
        historyStore: store,
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
      });

      await cli.parseAsync([
        "resolve", "image", imagePath, "--providers", "image-fixture", "--json",
      ], { from: "user" });

      const history = await store.listRuns();
      expect(history.items[0]?.attachments).toMatchObject([{
        fileName: "frame.png",
        mimeType: "image/png",
        kind: "image",
        stored: true,
      }]);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores a local torrent input without copying its referenced media files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-cli-torrent-"));
    const torrentPath = path.join(root, "release.torrent");
    await writeFile(
      torrentPath,
      Buffer.from("d4:infod6:lengthi1e4:name8:test.mkv12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee"),
    );
    const store = new RunStore({ root: path.join(root, "history") });
    await store.open();
    try {
      const cli = createCli({
        providers: [new CliProvider()],
        historyStore: store,
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
      });

      await cli.parseAsync([
        "resolve", "work", torrentPath, "--providers", "fixture", "--json",
      ], { from: "user" });

      const history = await store.listRuns();
      expect(history.items[0]?.attachments).toMatchObject([{
        fileName: "release.torrent",
        mimeType: "application/x-bittorrent",
        kind: "torrent",
        stored: true,
      }]);
      expect(history.items[0]?.attachments).toHaveLength(1);
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let history persistence failure mask a successful resolution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-cli-history-failure-"));
    const store = new RunStore({ root });
    await store.open();
    vi.spyOn(store, "createRun").mockRejectedValue(new Error("history disk full"));
    const stdout = new MemoryStream();
    try {
      const cli = createCli({
        providers: [new CliProvider()],
        historyStore: store,
        stdout,
        stderr: new MemoryStream(),
      });

      await cli.parseAsync([
        "resolve", "work", "Fixture Work", "--providers", "fixture", "--json",
      ], { from: "user" });

      expect(JSON.parse(stdout.value)).toMatchObject({ outcome: "matched" });
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("continues resolving when the history database cannot open", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-cli-history-open-"));
    const store = new RunStore({ root });
    vi.spyOn(store, "open").mockRejectedValue(new Error("history unavailable"));
    const stdout = new MemoryStream();
    try {
      const cli = createCli({
        providers: [new CliProvider()],
        historyStore: store,
        stdout,
        stderr: new MemoryStream(),
      });

      await cli.parseAsync([
        "resolve", "work", "Fixture Work", "--providers", "fixture", "--json",
      ], { from: "user" });

      expect(JSON.parse(stdout.value)).toMatchObject({ outcome: "matched" });
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists and deletes shared history through CLI commands", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ani-resolver-cli-history-command-"));
    const store = new RunStore({ root });
    await store.open();
    try {
      const run = await store.createRun({
        input: "Dungeon Meshi",
        requestedTarget: "work",
        resolvedTarget: "work",
        providers: ["fixture"],
      });
      await store.completeRun(run.id, { outcome: "matched", candidates: [] });
      const stdout = new MemoryStream();
      const cli = createCli({
        providers: [new CliProvider()],
        historyStore: store,
        stdout,
        stderr: new MemoryStream(),
      });

      await cli.parseAsync(["history", "list", "--query", "Dungeon", "--json"], {
        from: "user",
      });
      expect(JSON.parse(stdout.value)).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: run.id, input: "Dungeon Meshi" })],
      });

      const deleteOutput = new MemoryStream();
      const deleteCli = createCli({
        providers: [new CliProvider()],
        historyStore: store,
        stdout: deleteOutput,
        stderr: new MemoryStream(),
      });
      await deleteCli.parseAsync(["history", "delete", run.id, "--json"], { from: "user" });
      expect(JSON.parse(deleteOutput.value)).toEqual({ deleted: true, id: run.id });
      expect((await store.listRuns()).total).toBe(0);
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves an image path or URL through selected image providers", async () => {
    const result = await runWithProviders(
      [
        "resolve",
        "image",
        "https://example.test/frame.jpg?signature=private",
        "--providers",
        "image-fixture",
        "--top",
        "2",
        "--json",
      ],
      [new CliProvider(), new ImageCliProvider()],
    );
    const output = JSON.parse(result.stdout);

    expect(output).toMatchObject({
      schemaVersion: "ani-resolver.image.v1",
      query: { kind: "url", display: "https://example.test/frame.jpg" },
      matches: [
        expect.objectContaining({ provider: "image-fixture", rank: 1 }),
        expect.objectContaining({ provider: "image-fixture", rank: 2 }),
      ],
      providerRuns: [
        expect.objectContaining({ provider: "image-fixture", status: "ok", itemCount: 2 }),
      ],
    });
    expect(result.stdout).not.toContain("private");
  });

  it("rejects a syntactically present but empty provider list", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      ["node", "ani-resolver", "resolve", "image", "https://example.test/frame.jpg", "--providers", ","],
      { providers: [new ImageCliProvider()], stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe("");
    expect(JSON.parse(stderr.value)).toMatchObject({
      schemaVersion: "ani-resolver.error.v1",
      error: { code: "missing_provider_selection" },
    });
  });

  it("rejects a missing provider selection with a stable error code", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      ["node", "ani-resolver", "resolve", "work", "Example"],
      { providers: [new CliProvider()], stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe("");
    expect(JSON.parse(stderr.value)).toMatchObject({
      schemaVersion: "ani-resolver.error.v1",
      error: { code: "missing_provider_selection" },
    });
  });

  it("rejects providers that do not support the selected operation", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      [
        "node",
        "ani-resolver",
        "resolve",
        "image",
        "https://example.test/frame.jpg",
        "--providers",
        "fixture",
      ],
      { providers: [new CliProvider(), new ImageCliProvider()], stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe("");
    expect(JSON.parse(stderr.value)).toMatchObject({
      schemaVersion: "ani-resolver.error.v1",
      error: {
        code: "unsupported_provider_capability",
        message: expect.stringContaining("does not support image lookup"),
        details: {
          operation: "resolve.image",
          providers: ["fixture"],
          compatibleProviders: ["image-fixture"],
        },
      },
    });
  });

  it("gets entity details and lists work characters", async () => {
    const entity = JSON.parse((await run(["entity", "get", "work", "fixture:1", "--json"])).stdout);
    const characters = JSON.parse(
      (await run(["work", "characters", "fixture:1", "--json"])).stdout,
    );

    expect(entity.items[0]).toMatchObject({ entityType: "work", providerId: "1" });
    expect(characters.items[0]).toMatchObject({ entityType: "character", providerId: "2" });
  });

  it("renders provider entity lists as readable summaries by default", async () => {
    const entity = await run([
      "entity", "get", "work", "fixture:1", "--provider", "fixture",
    ]);
    const characters = await run([
      "work", "characters", "fixture:1", "--provider", "fixture",
    ]);

    expect(entity.stdout).toContain("Provider: fixture");
    expect(entity.stdout).toContain("1. Fixture Work (work, tv)");
    expect(entity.stdout).toContain("IDs: fixture:1");
    expect(characters.stdout).toContain("1. Fixture Character (character)");
    expect(characters.stdout).not.toContain('Items: [{"entityType"');
  });

  it("lists typed entity relations through explicitly selected providers", async () => {
    const result = await runWithProviders(
      [
        "entity", "relations", "work", "fixture:1",
        "--providers", "relation-fixture", "--json",
      ],
      [new RelationCliProvider()],
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: "ani-resolver.relations.v1",
      outcome: "matched",
      relations: [expect.objectContaining({
        entityType: "person",
        names: ["Fixture Person"],
        relation: "voice_actor",
      })],
    });
  });

  it("selects an explicit provider for a shared external ID namespace", async () => {
    const result = await runWithProviders(
      ["work", "characters", "fixture:1", "--provider", "fixture-local", "--json"],
      [new CliProvider(), new AlternateCliProvider()],
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      provider: "fixture-local",
      items: [expect.objectContaining({ providerId: "local-2" })],
    });
  });

  it("emits structured JSON and a nonzero code for unknown providers", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      ["node", "ani-resolver", "resolve", "work", "Example", "--providers", "missing"],
      { providers: [new CliProvider()], stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe("");
    expect(JSON.parse(stderr.value)).toMatchObject({
      schemaVersion: "ani-resolver.error.v1",
      error: { code: "unknown_provider", message: expect.stringContaining("Unknown provider: missing") },
    });
  });
});

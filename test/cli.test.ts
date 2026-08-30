import { Readable, Writable } from "node:stream";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { compactQueryFiles, createCli, parseExternalId, runCli } from "../src/cli.js";
import { ProviderManager } from "../src/provider-management.js";
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

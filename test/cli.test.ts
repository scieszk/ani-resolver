import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createCli, parseExternalId, runCli } from "../src/cli.js";
import type {
  ExternalId,
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

async function run(args: string[]) {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const cli = createCli({ providers: [new CliProvider()], stdout, stderr });
  await cli.parseAsync(args, { from: "user" });
  return { stdout: stdout.value, stderr: stderr.value };
}

describe("CLI", () => {
  it("preserves a TMDB media kind in external ID syntax", () => {
    expect(parseExternalId("tmdb-tv:209867")).toEqual({
      source: "tmdb",
      id: "209867",
      mediaKind: "tv",
    });
  });

  it("lists provider capability manifests without orchestration hints", async () => {
    const result = await run(["providers", "list", "--json"]);
    const output = JSON.parse(result.stdout);

    expect(output.providers[0]).toMatchObject({
      id: "fixture",
      capabilities: ["work_search", "work_detail", "work_characters", "character_search"],
    });
    expect(result.stdout).not.toContain("recommended_disambiguators");
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

  it("gets entity details and lists work characters", async () => {
    const entity = JSON.parse((await run(["entity", "get", "work", "fixture:1", "--json"])).stdout);
    const characters = JSON.parse(
      (await run(["work", "characters", "fixture:1", "--json"])).stdout,
    );

    expect(entity.items[0]).toMatchObject({ entityType: "work", providerId: "1" });
    expect(characters.items[0]).toMatchObject({ entityType: "character", providerId: "2" });
  });

  it("emits structured JSON and a nonzero code for runtime errors", async () => {
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
      error: { code: "runtime_error", message: "Unknown provider: missing" },
    });
  });
});

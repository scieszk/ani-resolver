import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderManager,
  validateProviderPackageManifest,
} from "../src/provider-management.js";
import type { Provider } from "../src/types.js";

const temporaryDirectories: string[] = [];

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "ani-resolver-provider-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("provider package manifests", () => {
  it("rejects entry points that escape the provider directory", () => {
    expect(() =>
      validateProviderPackageManifest({
        schemaVersion: "ani-resolver.provider.v1",
        id: "unsafe",
        version: "1.0.0",
        entry: "../outside.js",
      }),
    ).toThrow("entry must stay inside the provider directory");
  });
});

describe("ProviderManager", () => {
  it("lists bundled providers and their initialization state", async () => {
    const manager = new ProviderManager({ home: await temporaryHome() });

    const providers = await manager.list();

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bangumi-archive",
          installed: true,
          initialized: false,
          status: "needs_init",
        }),
      ]),
    );
  });

  it("returns structured input requirements instead of prompting during JSON initialization", async () => {
    const manager = new ProviderManager({ home: await temporaryHome() });

    const result = await manager.init("bangumi-archive", {});

    expect(result).toMatchObject({
      provider: "bangumi-archive",
      status: "needs_input",
      required: ["archive"],
    });
  });

  it("reports Archive as needing initialization when its configured index is missing", async () => {
    const home = await temporaryHome();
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(home, "state"));
    await writeFile(
      path.join(home, "state", "bangumi-archive.json"),
      JSON.stringify({
        initialized: true,
        indexPath: path.join(home, "missing.sqlite"),
      }),
    );
    const manager = new ProviderManager({ home });

    const archive = (await manager.list()).find((provider) => provider.id === "bangumi-archive");

    expect(archive).toMatchObject({ initialized: false, status: "needs_init" });
  });

  it("stores provider tokens through the credential store", async () => {
    const values = new Map<string, string>();
    const credentials = {
      get: async (provider: string, name: string) => values.get(`${provider}:${name}`),
      set: async (provider: string, name: string, value: string) => {
        values.set(`${provider}:${name}`, value);
      },
    };
    const manager = new ProviderManager({ home: await temporaryHome(), credentials });

    const result = await manager.init("tmdb", { token: "secret-token" });

    expect(result).toMatchObject({ provider: "tmdb", status: "ready" });
    await expect(credentials.get("tmdb", "access-token")).resolves.toBe("secret-token");
  });

  it("stores a TMDB v3 API key through the credential store", async () => {
    const values = new Map<string, string>();
    const credentials = {
      get: async (provider: string, name: string) => values.get(`${provider}:${name}`),
      set: async (provider: string, name: string, value: string) => {
        values.set(`${provider}:${name}`, value);
      },
    };
    const manager = new ProviderManager({ home: await temporaryHome(), credentials });

    const result = await manager.init("tmdb", { apiKey: "secret-api-key" });

    expect(result).toMatchObject({ provider: "tmdb", status: "ready" });
    await expect(credentials.get("tmdb", "api-key")).resolves.toBe("secret-api-key");
  });

  it("loads ready bundled providers through the Cordis host", async () => {
    const manager = new ProviderManager({ home: await temporaryHome() });

    const host = await manager.loadProviderHost();

    expect(host.providers().map((provider) => provider.manifest.id)).toEqual(["bangumi", "tmdb"]);
    await host.dispose();
  });

  it("ignores hidden staging directories left by interrupted installs", async () => {
    const home = await temporaryHome();
    const staging = path.join(home, "providers", ".partial-install");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(staging, { recursive: true });
    await writeFile(
      path.join(staging, "ani-resolver.provider.json"),
      JSON.stringify({
        schemaVersion: "ani-resolver.provider.v1",
        id: "partial-install",
        version: "1.0.0",
        entry: "missing.js",
      }),
    );
    const manager = new ProviderManager({
      home,
      moduleLoader: async () => {
        throw new Error("staging provider was loaded");
      },
    });

    const providers = await manager.list();

    expect(providers.some((provider) => provider.id === "partial-install")).toBe(false);
  });

  it("disposes a local plugin that registers the wrong provider ID", async () => {
    const home = await temporaryHome();
    const source = path.join(home, "wrong-source");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(source);
    await writeFile(
      path.join(source, "ani-resolver.provider.json"),
      JSON.stringify({
        schemaVersion: "ani-resolver.provider.v1",
        id: "expected-id",
        version: "1.0.0",
        entry: "index.js",
      }),
    );
    await writeFile(path.join(source, "index.js"), "export default () => {};");
    let disposed = false;
    const manager = new ProviderManager({
      home,
      moduleLoader: async () => ({
        default: (context: {
          providers: { add(provider: Provider): void };
          effect(execute: () => () => void): void;
        }) => {
          context.effect(() => () => {
            disposed = true;
          });
          context.providers.add({
            manifest: {
              id: "wrong-id",
              label: "Wrong ID",
              mediaTypes: ["anime"],
              capabilities: [],
              languages: ["en"],
              auth: "none",
              strengths: [],
              limitations: [],
            },
          });
        },
      }),
    });
    await manager.install(source, { trustLocal: true });

    await expect(manager.loadProviderHost()).rejects.toThrow("expected-id");
    expect(disposed).toBe(true);
  });

  it("installs a validated provider directory into managed storage", async () => {
    const home = await temporaryHome();
    const source = path.join(home, "fixture-source");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(source);
    await writeFile(
      path.join(source, "ani-resolver.provider.json"),
      JSON.stringify({
        schemaVersion: "ani-resolver.provider.v1",
        id: "fixture-local",
        version: "1.0.0",
        entry: "index.js",
      }),
    );
    await writeFile(
      path.join(source, "index.js"),
      `export default (context) => context.providers.add({
        manifest: {
          id: "fixture-local",
          label: "Fixture Local",
          mediaTypes: ["anime"],
          capabilities: ["work_search"],
          languages: ["en"],
          auth: "none",
          strengths: ["tests"],
          limitations: []
        }
      });`,
    );
    const loadedModules: string[] = [];
    const manager = new ProviderManager({
      home,
      moduleLoader: async (specifier) => {
        loadedModules.push(specifier);
        return {
          default: (context: { providers: { add(provider: Provider): void } }) =>
            context.providers.add({
              manifest: {
                id: "fixture-local",
                label: "Fixture Local",
                mediaTypes: ["anime"],
                capabilities: ["work_search"],
                languages: ["en"],
                auth: "none",
                strengths: ["tests"],
                limitations: [],
              },
            }),
        };
      },
    });

    await expect(manager.install(source)).rejects.toThrow("trustLocal");
    const result = await manager.install(source, { trustLocal: true });

    expect(result).toMatchObject({ provider: "fixture-local", status: "installed" });
    await expect(
      import("node:fs/promises").then(({ access }) =>
        access(path.join(home, "providers", "fixture-local", "index.js")),
      ),
    ).resolves.toBeUndefined();

    const listed = await manager.list();
    expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ id: "fixture-local" })]));
    const host = await manager.loadProviderHost();
    expect(host.providers().map((provider) => provider.manifest.id)).toContain("fixture-local");
    expect(loadedModules.every((specifier) => specifier.endsWith("/index.js"))).toBe(true);
    await host.dispose();
  });
});

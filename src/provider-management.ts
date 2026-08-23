import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { KeyringCredentialStore, type CredentialStore } from "./credentials.js";
import { ProviderHost, type ProviderPlugin } from "./provider-host.js";
import {
  BangumiArchiveProvider,
  bangumiArchiveManifest,
} from "./providers/bangumi-archive.js";
import { BangumiProvider } from "./providers/bangumi.js";
import { TmdbProvider } from "./providers/tmdb.js";
import type { ProviderManifest } from "./types.js";

const providerPackageManifestSchema = z.object({
  schemaVersion: z.literal("ani-resolver.provider.v1"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1),
  entry: z.string().min(1),
});

export type ProviderPackageManifest = z.infer<typeof providerPackageManifestSchema>;

export type ProviderLifecycleStatus = "ready" | "needs_init" | "unavailable";

export interface ProviderListItem extends ProviderManifest {
  installed: boolean;
  initialized: boolean;
  status: ProviderLifecycleStatus;
  distribution: "bundled" | "local";
  dataVersion?: string;
}

export interface ProviderInitOptions {
  archive?: string;
  token?: string;
}

export type ProviderInitResult =
  | {
      provider: string;
      status: "ready";
      details?: Record<string, unknown>;
    }
  | {
      provider: string;
      status: "needs_input";
      required: string[];
      acceptedOptions: string[];
    };

interface ProviderState {
  initialized: boolean;
  dataVersion?: string;
  indexPath?: string;
  archivePath?: string;
}

export interface ProviderManagerOptions {
  home?: string;
  credentials?: CredentialStore;
  moduleLoader?: ProviderModuleLoader;
}

export type ProviderModuleLoader = (
  specifier: string,
) => Promise<{ default?: unknown }>;

export class ProviderManager {
  readonly home: string;
  private readonly credentials: CredentialStore;
  private readonly moduleLoader: ProviderModuleLoader;
  private readonly bundled = [
    new BangumiProvider().manifest,
    new TmdbProvider().manifest,
    bangumiArchiveManifest,
  ];

  constructor(options: ProviderManagerOptions = {}) {
    this.home = path.resolve(
      options.home ?? process.env.ANI_RESOLVER_HOME ?? path.join(os.homedir(), ".ani-resolver"),
    );
    this.credentials = options.credentials ?? new KeyringCredentialStore();
    this.moduleLoader = options.moduleLoader ?? ((specifier) => import(specifier));
  }

  async list(): Promise<ProviderListItem[]> {
    const bundled = await Promise.all(
      this.bundled.map(async (manifest): Promise<ProviderListItem> => {
        const state = await this.readState(manifest.id);
        const initialized =
          manifest.id === "bangumi-archive"
            ? Boolean(await this.archiveIndexPath())
            : this.isInitialized(manifest.id, state);
        return {
          ...manifest,
          installed: true,
          initialized,
          status: initialized ? "ready" : "needs_init",
          distribution: "bundled",
          ...(state?.dataVersion ? { dataVersion: state.dataVersion } : {}),
        };
      }),
    );
    const host = new ProviderHost();
    try {
      await this.loadLocalProviders(host);
      const local = host.providers().map(
        (provider): ProviderListItem => ({
          ...provider.manifest,
          installed: true,
          initialized: true,
          status: "ready",
          distribution: "local",
        }),
      );
      return [...bundled, ...local];
    } finally {
      await host.dispose();
    }
  }

  async install(
    sourceOrId: string,
    options: { trustLocal?: boolean } = {},
  ): Promise<{ provider: string; status: "installed" | "already_installed" }> {
    const bundled = this.bundled.find((provider) => provider.id === sourceOrId);
    if (bundled) {
      await mkdir(this.providerDirectory(sourceOrId), { recursive: true });
      return { provider: sourceOrId, status: "already_installed" };
    }
    if (!options.trustLocal) {
      throw new Error("Installing a local provider executes code; pass trustLocal: true");
    }

    const source = path.resolve(sourceOrId);
    const manifestPath = path.join(source, "ani-resolver.provider.json");
    const manifest = validateProviderPackageManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    if (this.bundled.some((provider) => provider.id === manifest.id)) {
      throw new Error(`Local provider ID is reserved: ${manifest.id}`);
    }
    const entryPath = resolveProviderEntry(source, manifest.entry);
    await access(entryPath);

    const providersRoot = path.join(this.home, "providers");
    const destination = path.join(providersRoot, manifest.id);
    assertInside(providersRoot, destination);
    const staging = path.join(providersRoot, `.${manifest.id}-${process.pid}-${Date.now()}`);
    assertInside(providersRoot, staging);
    await mkdir(providersRoot, { recursive: true });
    try {
      await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    return { provider: manifest.id, status: "installed" };
  }

  async init(provider: string, options: ProviderInitOptions): Promise<ProviderInitResult> {
    if (!this.bundled.some((item) => item.id === provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    if (provider === "bangumi-archive") {
      if (!options.archive) {
        return {
          provider,
          status: "needs_input",
          required: ["archive"],
          acceptedOptions: ["--archive <dump.zip>"],
        };
      }
      const archivePath = path.resolve(options.archive);
      const source = await stat(archivePath);
      if (!source.isFile()) throw new Error(`Archive is not a file: ${archivePath}`);
      const dataDirectory = path.join(this.home, "data", provider);
      const indexPath = path.join(dataDirectory, "index.sqlite");
      await mkdir(dataDirectory, { recursive: true });
      const { buildBangumiArchiveIndex } = await import("./providers/bangumi-archive.js");
      const result = await buildBangumiArchiveIndex({ archive: archivePath, index: indexPath });
      const dataVersion = path.basename(archivePath);
      await this.writeState(provider, {
        initialized: true,
        dataVersion,
        indexPath,
        archivePath,
      });
      return { provider, status: "ready", details: { ...result } };
    }

    if (provider === "tmdb") {
      const token =
        options.token ??
        process.env.TMDB_ACCESS_TOKEN ??
        (await this.credentials.get("tmdb", "access-token"));
      if (!token) {
        return {
          provider,
          status: "needs_input",
          required: ["token"],
          acceptedOptions: ["--token <access-token>", "TMDB_ACCESS_TOKEN"],
        };
      }
      if (options.token || process.env.TMDB_ACCESS_TOKEN) {
        await this.credentials.set("tmdb", "access-token", token);
      }
    }

    await this.writeState(provider, { initialized: true });
    return { provider, status: "ready" };
  }

  async archiveIndexPath(): Promise<string | undefined> {
    const state = await this.readState("bangumi-archive");
    if (!this.isInitialized("bangumi-archive", state) || !state?.indexPath) return undefined;
    try {
      await access(state.indexPath);
      return state.indexPath;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async loadProviderHost(): Promise<ProviderHost> {
    const host = new ProviderHost();
    try {
      let token = process.env.TMDB_ACCESS_TOKEN;
      if (!token) {
        try {
          token = await this.credentials.get("tmdb", "access-token");
        } catch {
          token = undefined;
        }
      }
      const archiveIndex = await this.archiveIndexPath();
      await host.use((context) => {
        context.providers.add(new BangumiProvider());
        context.providers.add(new TmdbProvider({ ...(token ? { token } : {}) }));
        if (archiveIndex) {
          context.providers.add(new BangumiArchiveProvider({ indexPath: archiveIndex }));
        }
      });
      await this.loadLocalProviders(host);
      return host;
    } catch (error) {
      await host.dispose();
      throw error;
    }
  }

  private async loadLocalProviders(host: ProviderHost): Promise<void> {
    const providersRoot = path.join(this.home, "providers");
    let directories;
    try {
      directories = await readdir(providersRoot, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    for (const directory of directories
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const providerDirectory = path.join(providersRoot, directory.name);
      const manifestPath = path.join(providerDirectory, "ani-resolver.provider.json");
      let manifest: ProviderPackageManifest;
      try {
        manifest = validateProviderPackageManifest(JSON.parse(await readFile(manifestPath, "utf8")));
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
      if (this.bundled.some((provider) => provider.id === manifest.id)) {
        throw new Error(`Local provider ID is reserved: ${manifest.id}`);
      }
      if (directory.name !== manifest.id) {
        throw new Error(`Provider directory must match its manifest ID: ${manifest.id}`);
      }
      const entryPath = resolveProviderEntry(providerDirectory, manifest.entry);
      const module = await this.moduleLoader(pathToFileURL(entryPath).href);
      if (typeof module.default !== "function") {
        throw new Error(`Provider entry must default-export a Cordis plugin: ${manifest.id}`);
      }
      const before = new Set(host.providers().map((provider) => provider.manifest.id));
      await host.use(module.default as ProviderPlugin);
      const added = host.providers()
        .map((provider) => provider.manifest.id)
        .filter((id) => !before.has(id));
      if (added.length !== 1 || added[0] !== manifest.id) {
        throw new Error(`Provider plugin must register exactly its manifest ID: ${manifest.id}`);
      }
    }
  }

  private providerDirectory(provider: string): string {
    return path.join(this.home, "providers", provider);
  }

  private statePath(provider: string): string {
    return path.join(this.home, "state", `${provider}.json`);
  }

  private async readState(provider: string): Promise<ProviderState | undefined> {
    try {
      return JSON.parse(await readFile(this.statePath(provider), "utf8")) as ProviderState;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private isInitialized(provider: string, state: ProviderState | undefined): boolean {
    if (provider === "bangumi") return true;
    if (provider === "tmdb") return Boolean(state?.initialized || process.env.TMDB_ACCESS_TOKEN);
    return Boolean(state?.initialized && state.indexPath);
  }

  private async writeState(provider: string, state: ProviderState): Promise<void> {
    const statePath = this.statePath(provider);
    await mkdir(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rm(statePath, { force: true });
    await rename(temporary, statePath);
  }
}

export function validateProviderPackageManifest(value: unknown): ProviderPackageManifest {
  const manifest = providerPackageManifestSchema.parse(value);
  resolveProviderEntry(path.resolve("provider"), manifest.entry);
  return manifest;
}

function resolveProviderEntry(directory: string, entry: string): string {
  const normalized = entry.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(entry)) {
    throw new Error("entry must stay inside the provider directory");
  }
  const resolved = path.resolve(directory, normalized);
  assertInside(directory, resolved, "entry must stay inside the provider directory");
  return resolved;
}

function assertInside(parent: string, child: string, message = "path must stay inside managed storage"): void {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

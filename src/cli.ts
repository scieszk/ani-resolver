#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command, CommanderError, InvalidArgumentError } from "commander";

import { ImageResolver } from "./image-resolver.js";
import { parseContentInput } from "./input.js";
import { ProviderSelectionError } from "./provider-selection.js";
import { ProviderManager } from "./provider-management.js";
import { Resolver } from "./resolver.js";
import type { EntityType, ExternalId, Provider, ResolveResult } from "./types.js";

export interface CliOptions {
  providers?: Provider[];
  providerManager?: ProviderManager;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  startWebServer?: (options: WebCliOptions) => Promise<void>;
}

export interface WebCliOptions {
  host: string;
  port: number;
  maxStorageMb: number;
  stdout: NodeJS.WritableStream;
}

export function createCli(options: CliOptions = {}): Command {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const providerManager = options.providerManager ?? new ProviderManager();
  let hostPromise: ReturnType<ProviderManager["loadProviderHost"]> | undefined;
  const loadProviders = async (): Promise<Provider[]> => {
    if (options.providers) return options.providers;
    hostPromise ??= providerManager.loadProviderHost();
    return (await hostPromise).providers();
  };
  const loadResolver = async () => new Resolver(await loadProviders());
  const loadImageResolver = async () => new ImageResolver(await loadProviders());
  const program = new Command();

  program
    .name("ani-resolver")
    .description("Provider-based anime metadata resolution infrastructure")
    .version("0.1.0")
    .configureOutput({
      writeOut: (value) => stdout.write(value),
      writeErr: (value) => stderr.write(value),
      outputError: () => undefined,
    });

  program
    .command("parse")
    .description("Parse a title, release name, path, torrent, or magnet into content evidence")
    .argument("<input>")
    .option("--json", "Emit JSON")
    .option("--full-files", "Include every parsed file path")
    .action(async (input: string, commandOptions: { fullFiles?: boolean }) => {
      const evidence = await parseContentInput(input);
      writeJson(stdout, commandOptions.fullFiles ? evidence : compactEvidence(evidence));
    });

  const resolve = program.command("resolve").description("Return ranked metadata candidates");
  type ResolveCommandOptions = {
    top: number;
    providers?: string[];
    work?: ExternalId;
    fullFiles?: boolean;
  };
  const runResolve = async (
    entityType: EntityType,
    input: string,
    commandOptions: ResolveCommandOptions,
  ) => {
    const resolver = await loadResolver();
    const result = await resolver.resolve({
      entityType,
      input,
      limit: commandOptions.top,
      providers: commandOptions.providers ?? [],
      ...(commandOptions.work ? { work: commandOptions.work } : {}),
    });
    writeJson(stdout, commandOptions.fullFiles ? result : compactResolveResult(result));
  };
  resolve
    .command("work")
    .description("Resolve an anime work from text, release, path, torrent, or magnet evidence")
    .argument("<input>")
    .option("--top <number>", "Maximum candidates", parsePositiveInteger, 5)
    .option("--providers <ids>", "Comma-separated provider IDs or all (required)", parseList)
    .option("--json", "Emit JSON")
    .option("--full-files", "Include every parsed file path")
    .action((input: string, commandOptions: ResolveCommandOptions) =>
      runResolve("work", input, commandOptions),
    );
  resolve
    .command("character")
    .description("Resolve an anime character from a name or descriptive clues")
    .argument("<input>")
    .option("--top <number>", "Maximum candidates", parsePositiveInteger, 5)
    .option("--providers <ids>", "Comma-separated provider IDs or all (required)", parseList)
    .option("--work <external-id>", "Known work ID used as a character constraint", parseExternalId)
    .option("--json", "Emit JSON")
    .option("--full-files", "Include every parsed file path")
    .action((input: string, commandOptions: ResolveCommandOptions) =>
      runResolve("character", input, commandOptions),
    );
  resolve
    .command("image")
    .description("Identify an anime scene, image source, or character from an image")
    .argument("<input>", "Local JPEG/PNG path or HTTP(S) image URL")
    .option("--top <number>", "Maximum matches per provider", parsePositiveInteger, 5)
    .option(
      "--providers <ids>",
      "IDs or all; selected providers receive image data (required)",
      parseList,
    )
    .option("--json", "Emit JSON")
    .action(
      async (
        input: string,
        commandOptions: { top: number; providers?: string[] },
      ) => {
        const imageResolver = await loadImageResolver();
        writeJson(
          stdout,
          await imageResolver.resolve({
            input,
            limit: commandOptions.top,
            providers: commandOptions.providers ?? [],
          }),
        );
      },
    );

  const providerCommand = program.command("provider").description("Manage provider capabilities and data");
  addProviderList(providerCommand, stdout, options.providers, providerManager);
  providerCommand
    .command("install")
    .description("Install a trusted local provider package")
    .argument("<provider-or-path>")
    .option("--trust-local", "Allow executing provider code from a local directory")
    .option("--json", "Emit JSON")
    .action(async (providerOrPath: string, commandOptions: { trustLocal?: boolean }) => {
      writeJson(
        stdout,
        await providerManager.install(providerOrPath, {
          ...(commandOptions.trustLocal ? { trustLocal: true } : {}),
        }),
      );
    });
  providerCommand
    .command("init")
    .description("Configure provider credentials or local data")
    .argument("<provider>")
    .option("--archive <path>", "Bangumi Archive dump ZIP")
    .option("--token <token>", "Provider access token")
    .option("--api-key <key>", "Provider API key")
    .option("--json", "Emit JSON")
    .action(async (provider: string, commandOptions: { archive?: string; token?: string; apiKey?: string }) => {
      writeJson(
        stdout,
        await providerManager.init(provider, {
          ...(commandOptions.archive ? { archive: commandOptions.archive } : {}),
          ...(commandOptions.token ? { token: commandOptions.token } : {}),
          ...(commandOptions.apiKey ? { apiKey: commandOptions.apiKey } : {}),
        }),
      );
    });

  const legacyProviders = program.command("providers").description("Alias for provider inspection");
  addProviderList(legacyProviders, stdout, options.providers, providerManager);

  const entity = program.command("entity").description("Fetch a provider entity by external ID");
  entity
    .command("get")
    .argument("<entity-type>", "work or character", parseEntityType)
    .argument("<external-id>", "for example bangumi:400602 or tmdb:209867", parseExternalId)
    .option("--provider <id>", "Provider to use for a shared external ID namespace")
    .option("--json", "Emit JSON")
    .action(async (entityType: EntityType, id: ExternalId, commandOptions: { provider?: string }) => {
      const providers = await loadProviders();
      const provider = providerForId(providers, id, commandOptions.provider);
      if (!provider?.getEntity) throw new Error(`No provider can fetch ${id.source}:${id.id}`);
      writeJson(stdout, await provider.getEntity(id, entityType));
    });

  const work = program.command("work").description("Inspect resolved anime works");
  work
    .command("characters")
    .argument("<external-id>", "for example bangumi:400602", parseExternalId)
    .option("--provider <id>", "Provider to use for a shared external ID namespace")
    .option("--json", "Emit JSON")
    .action(async (id: ExternalId, commandOptions: { provider?: string }) => {
      const providers = await loadProviders();
      const provider = providerForId(providers, id, commandOptions.provider);
      if (!provider?.listWorkCharacters) {
        throw new Error(`No provider can list characters for ${id.source}:${id.id}`);
      }
      writeJson(stdout, await provider.listWorkCharacters(id));
    });

  program
    .command("web")
    .description("Run the local browser UI and history API")
    .option("--host <host>", "Listen address", "0.0.0.0")
    .option("--port <port>", "Listen port", parsePort, 4173)
    .option("--max-storage-mb <number>", "Attachment storage quota in MiB", parseStorageMb, 100)
    .action(
      async (commandOptions: { host: string; port: number; maxStorageMb: number }) => {
        const start =
          options.startWebServer ??
          (async (webOptions: WebCliOptions) => {
            const { startWebServer } = await import("./web/start.js");
            const handle = await startWebServer(webOptions);
            webOptions.stdout.write(`ani-resolver web listening on ${handle.url}\n`);
            const shutdown = async () => {
              await handle.close();
            };
            process.once("SIGINT", shutdown);
            process.once("SIGTERM", shutdown);
          });
        await start({ ...commandOptions, stdout });
      },
    );

  program.hook("postAction", async () => {
    if (hostPromise) await (await hostPromise).dispose();
  });

  return program;
}

export async function runCli(argv = process.argv, options: CliOptions = {}): Promise<number> {
  const stderr = options.stderr ?? process.stderr;
  const program = createCli(options).exitOverride();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === "commander.helpDisplayed" || error.code === "commander.version")
    ) {
      return 0;
    }
    writeJson(stderr, {
      schemaVersion: "ani-resolver.error.v1",
      error: {
        code:
          error instanceof ProviderSelectionError
            ? error.code
            : error instanceof CommanderError
              ? error.code
              : "runtime_error",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ProviderSelectionError ? { details: error.details } : {}),
      },
    });
    return error instanceof CommanderError ? error.exitCode : 1;
  }
}

function writeJson(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new InvalidArgumentError("must be an integer between 1 and 50");
  }
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new InvalidArgumentError("must be an integer between 1 and 65535");
  }
  return parsed;
}

function parseStorageMb(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_240) {
    throw new InvalidArgumentError("must be an integer between 1 and 10240");
  }
  return parsed;
}

function parseList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function parseEntityType(value: string): EntityType {
  if (value !== "work" && value !== "character") {
    throw new InvalidArgumentError("must be work or character");
  }
  return value;
}

export function parseExternalId(value: string): ExternalId {
  const [rawSource, id, ...rest] = value.trim().split(":");
  if (!rawSource || !id || rest.length > 0) {
    throw new InvalidArgumentError("must use source:id format");
  }
  if (rawSource === "tmdb-tv" || rawSource === "tmdb-movie") {
    return { source: "tmdb", id, mediaKind: rawSource === "tmdb-tv" ? "tv" : "movie" };
  }
  const source = rawSource === "bgm" ? "bangumi" : rawSource;
  return { source, id };
}

function addProviderList(
  command: Command,
  stdout: NodeJS.WritableStream,
  injectedProviders: Provider[] | undefined,
  providerManager: ProviderManager,
): void {
  command
    .command("list")
    .description("List provider capabilities, status, authentication, and limitations")
    .option("--json", "Emit JSON")
    .action(async () => {
      writeJson(stdout, {
        providers: injectedProviders
          ? injectedProviders.map((provider) => provider.manifest)
          : await providerManager.list(),
      });
    });
}

function providerForId(
  providers: Provider[],
  id: ExternalId,
  providerId?: string,
): Provider | undefined {
  if (providerId) {
    const provider = providers.find((candidate) => candidate.manifest.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider;
  }
  return (
    providers.find((provider) => provider.manifest.id === id.source) ??
    providers.find(
      (provider) => provider.manifest.id === "bangumi-archive" && id.source === "bangumi",
    )
  );
}

export function compactQueryFiles(files: string[]): {
  fileCount: number;
  files: string[];
  filesTruncated: boolean;
} {
  const limit = 8;
  return {
    fileCount: files.length,
    files: files.slice(0, limit),
    filesTruncated: files.length > limit,
  };
}

function compactEvidence<T extends { files: string[] }>(evidence: T): Omit<T, "files"> & {
  fileCount: number;
  files: string[];
  filesTruncated: boolean;
} {
  return { ...evidence, ...compactQueryFiles(evidence.files) };
}

function compactResolveResult(result: ResolveResult): ResolveResult & {
  query: ResolveResult["query"] & { fileCount: number; filesTruncated: boolean };
} {
  return {
    ...result,
    query: compactEvidence(result.query),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

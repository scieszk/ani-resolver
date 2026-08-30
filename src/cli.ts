#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { Command, CommanderError, InvalidArgumentError } from "commander";

import { writeCliJson, writeCliOutput } from "./cli-output.js";
import { ImageResolver } from "./image-resolver.js";
import { compactContentInventory, inspectContentInventory } from "./inventory.js";
import { EntityRelationsResolver } from "./entity-relations.js";
import { normalizeAppearance, parseAppearanceInput } from "./appearance.js";
import { parseContentInput } from "./input.js";
import { ProviderSelectionError } from "./provider-selection.js";
import { ProviderManager } from "./provider-management.js";
import { Resolver } from "./resolver.js";
import type {
  CharacterAppearance,
  EntityType,
  ExternalId,
  Provider,
  ResolveResult,
} from "./types.js";
import type { AddAttachmentInput, RunStore, StoredRunQuery } from "./web/run-store.js";

export interface CliOptions {
  providers?: Provider[];
  providerManager?: ProviderManager;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
  historyStore?: RunStore | false;
  startWebServer?: (options: WebCliOptions) => Promise<void>;
}

export interface WebCliOptions {
  host: string;
  port: number;
  maxStorageMb: number;
  stdout: NodeJS.WritableStream;
}

interface CharacterFlagOptions {
  name?: string;
  inputJson?: string;
  hairColor?: string[];
  eyeColor?: string[];
  hairStyle?: string[];
  gender?: string[];
  apparentAge?: string[];
  clothing?: string[];
  trait?: string[];
}

interface CharacterJsonInput {
  name?: string;
  providers?: string[];
  top?: number;
  work?: ExternalId;
  appearance?: Partial<CharacterAppearance>;
}

interface UnifiedQueryJsonInput extends CharacterJsonInput {
  target: "work" | "character" | "image";
  input: string;
}

const packageVersion = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
const disposeCliResources = Symbol("disposeCliResources");
type DisposableCliCommand = Command & {
  [disposeCliResources]: () => Promise<void>;
};

export function createCli(options: CliOptions = {}): Command {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdin = options.stdin ?? process.stdin;
  const providerManager = options.providerManager ?? new ProviderManager();
  let hostPromise: ReturnType<ProviderManager["loadProviderHost"]> | undefined;
  let ownedHistoryStore: RunStore | undefined;
  let disposalPromise: Promise<void> | undefined;
  const disposeResources = (): Promise<void> => {
    disposalPromise ??= (async () => {
      const host = hostPromise ? await hostPromise.catch(() => undefined) : undefined;
      await Promise.allSettled([
        host?.dispose(),
        ownedHistoryStore?.close(),
      ].filter((pending): pending is Promise<void> => pending !== undefined));
      ownedHistoryStore = undefined;
    })();
    return disposalPromise;
  };
  const getHistoryStore = async (): Promise<RunStore | undefined> => {
    if (options.historyStore === false) return undefined;
    if (options.historyStore) {
      await options.historyStore.open();
      return options.historyStore;
    }
    if (options.providers) return undefined;
    if (!ownedHistoryStore) {
      const { RunStore: DefaultRunStore } = await import("./web/run-store.js");
      const home = process.env.ANI_RESOLVER_HOME ?? path.join(os.homedir(), ".ani-resolver");
      const root = path.resolve(
        process.env.ANI_RESOLVER_WEB_DATA ?? path.join(home, "web"),
      );
      ownedHistoryStore = new DefaultRunStore({ root });
      await ownedHistoryStore.open();
    }
    return ownedHistoryStore;
  };
  const runWithHistory = async <T>(runOptions: {
    enabled: boolean;
    input: string;
    target: EntityType | "image";
    providers: string[];
    query?: StoredRunQuery;
    execute: () => Promise<T>;
  }): Promise<T> => {
    let store: RunStore | undefined;
    try {
      store = runOptions.enabled ? await getHistoryStore() : undefined;
    } catch {
      return runOptions.execute();
    }
    if (!store) return runOptions.execute();
    let run;
    try {
      run = await store.createRun({
        input: runOptions.input,
        requestedTarget: runOptions.target,
        resolvedTarget: runOptions.target,
        providers: runOptions.providers,
        ...(runOptions.query ? { query: runOptions.query } : {}),
      });
    } catch {
      return runOptions.execute();
    }
    try {
      const attachment = await readHistoryAttachment(runOptions.input, runOptions.target);
      if (attachment) await store.addAttachment(run.id, attachment);
    } catch {
      // Attachment history is best-effort and must not block resolution.
    }
    try {
      const result = await runOptions.execute();
      try {
        await store.completeRun(run.id, result, runOptions.target);
      } catch {
        // History persistence is ancillary to the resolution result.
      }
      try {
        await store.cleanup();
      } catch {
        // Automatic cleanup is also best-effort.
      }
      return result;
    } catch (error) {
      try {
        await store.failRun(run.id, error instanceof Error ? error.message : String(error));
      } catch {
        // Keep the original resolution error when history persistence also fails.
      }
      try {
        await store.cleanup();
      } catch {
        // Keep the original resolution error when cleanup also fails.
      }
      throw error;
    }
  };
  const loadProviders = async (): Promise<Provider[]> => {
    if (options.providers) return options.providers;
    hostPromise ??= providerManager.loadProviderHost();
    return (await hostPromise).providers();
  };
  const loadReadyProviders = async (
    requested: string[] | undefined,
    operation: "resolve.work" | "resolve.character" | "resolve.image" | "entity.relations",
  ): Promise<Provider[]> => {
    const providers = await loadProviders();
    if (options.providers || !requested?.length || requested.includes("all")) return providers;
    const loadedIds = new Set(providers.map((provider) => provider.manifest.id));
    const catalog = await providerManager.list();
    const providerStatuses = requested.flatMap((id) => {
      if (loadedIds.has(id)) return [];
      const known = catalog.find((item) => item.id === id);
      return known ? [{ id, status: known.status }] : [];
    });
    if (providerStatuses.length > 0) {
      const requiredCapabilities = operation === "resolve.work"
        ? ["work_search" as const]
        : operation === "resolve.character"
          ? ["character_search" as const]
          : operation === "entity.relations"
            ? ["entity_relations" as const]
            : ["anime_scene_lookup" as const, "reverse_image_lookup" as const, "character_image_lookup" as const];
      throw new ProviderSelectionError(
        "provider_not_ready",
        `Provider${providerStatuses.length === 1 ? "" : "s"} ${providerStatuses.map((item) => item.id).join(", ")} ${providerStatuses.length === 1 ? "is" : "are"} known but not ready. Run ani-resolver provider show <id> --json and provider init <id> --json.`,
        {
          operation,
          providers: providerStatuses.map((item) => item.id),
          requiredCapabilities,
          compatibleProviders: providers.map((provider) => provider.manifest.id),
          providerStatuses,
        },
      );
    }
    return providers;
  };
  const loadResolver = async (requested: string[] | undefined, entityType: EntityType) =>
    new Resolver(await loadReadyProviders(requested, `resolve.${entityType}`));
  const loadImageResolver = async (requested: string[] | undefined) =>
    new ImageResolver(await loadReadyProviders(requested, "resolve.image"));
  const loadEntityRelationsResolver = async (requested: string[] | undefined) =>
    new EntityRelationsResolver(await loadReadyProviders(requested, "entity.relations"));
  const program = new Command();

  program
    .name("ani-resolver")
    .description("Provider-based anime metadata resolution infrastructure")
    .version(packageVersion)
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
    .action(async (input: string, commandOptions: { fullFiles?: boolean; json?: boolean }) => {
      const evidence = await parseContentInput(input);
      writeCliOutput(stdout, commandOptions.fullFiles ? evidence : compactEvidence(evidence), commandOptions);
    });

  program
    .command("inventory")
    .description("Inspect and group local or torrent files without moving them")
    .argument("<input>", "Directory, file, torrent, or magnet")
    .option("--json", "Emit JSON")
    .option("--full-files", "Include every file in episode and unassigned groups")
    .action(async (input: string, commandOptions: { fullFiles?: boolean; json?: boolean }) => {
      const inventory = await inspectContentInventory(input);
      writeCliOutput(
        stdout,
        commandOptions.fullFiles ? inventory : compactContentInventory(inventory),
        commandOptions,
      );
    });

  const resolve = program.command("resolve").description("Return ranked metadata candidates");
  type ResolveCommandOptions = {
    top?: number;
    providers?: string[];
    work?: ExternalId;
    fullFiles?: boolean;
    history?: boolean;
    json?: boolean;
  };
  const runResolve = async (
    entityType: EntityType,
    input: string,
    commandOptions: ResolveCommandOptions,
    appearance?: Partial<CharacterAppearance>,
  ) => {
    const providers = commandOptions.providers ?? [];
    const result = await runWithHistory({
      enabled: commandOptions.history !== false,
      input,
      target: entityType,
      providers,
      query: {
        ...(commandOptions.work ? { work: commandOptions.work } : {}),
        ...(appearance ? { appearance: normalizeAppearance(appearance) } : {}),
      },
      execute: async () => {
        const resolver = await loadResolver(commandOptions.providers, entityType);
        return resolver.resolve({
          entityType,
          input,
          limit: commandOptions.top ?? 5,
          providers,
          ...(commandOptions.work ? { work: commandOptions.work } : {}),
          ...(appearance ? { appearance } : {}),
        });
      },
    });
    writeCliOutput(
      stdout,
      commandOptions.fullFiles ? result : compactResolveResult(result),
      commandOptions,
    );
  };
  resolve
    .command("work")
    .description("Resolve an anime work from text, release, path, torrent, or magnet evidence")
    .argument("<input>")
    .option("--top <number>", "Maximum candidates", parsePositiveInteger, 5)
    .option("--providers <ids>", "Comma-separated provider IDs or all (required)", parseList)
    .option("--json", "Emit JSON")
    .option("--full-files", "Include every parsed file path")
    .option("--no-history", "Do not save this resolution to shared history")
    .action((input: string, commandOptions: ResolveCommandOptions) =>
      runResolve("work", input, commandOptions),
    );

  program
    .command("query")
    .description("Run a typed resolution request from JSON")
    .option("--input-json <path>", "Read the request from a JSON file or - for stdin", "-")
    .option("--json", "Emit JSON")
    .option("--full-files", "Include every parsed file path")
    .option("--no-history", "Do not save this resolution to shared history")
    .action(async (
      commandOptions: { inputJson: string; fullFiles?: boolean; history?: boolean; json?: boolean },
    ) => {
      const request = await readUnifiedQueryJson(commandOptions.inputJson, stdin);
      if (request.target === "image") {
        const providers = request.providers ?? [];
        const result = await runWithHistory({
          enabled: commandOptions.history !== false,
          input: request.input,
          target: "image",
          providers,
          execute: async () => {
            const imageResolver = await loadImageResolver(request.providers);
            return imageResolver.resolve({
              input: request.input,
              limit: request.top ?? 5,
              providers,
            });
          },
        });
        writeCliOutput(stdout, result, commandOptions);
        return;
      }
      await runResolve(
        request.target,
        request.input,
        {
          top: request.top ?? 5,
          ...(request.providers ? { providers: request.providers } : {}),
          ...(request.work ? { work: request.work } : {}),
          ...(commandOptions.fullFiles ? { fullFiles: true } : {}),
          ...(commandOptions.history === false ? { history: false } : {}),
          ...(commandOptions.json ? { json: true } : {}),
        },
        request.appearance,
      );
    });
  resolve
    .command("character")
    .description("Resolve an anime character from a name and structured conditions")
    .argument("[input]", "Literal character name (kept for CLI compatibility)")
    .option("--name <name>", "Literal character name")
    .option("--top <number>", "Maximum candidates", parsePositiveInteger)
    .option("--providers <ids>", "Comma-separated provider IDs or all (required)", parseList)
    .option("--work <external-id>", "Known work ID used as a character constraint", parseExternalId)
    .option("--hair-color <value>", "Hair color tag; repeatable or comma-separated", collectValues)
    .option("--eye-color <value>", "Eye color tag; repeatable or comma-separated", collectValues)
    .option("--hair-style <value>", "Hair style tag; repeatable or comma-separated", collectValues)
    .option("--gender <value>", "Gender tag; repeatable or comma-separated", collectValues)
    .option("--apparent-age <value>", "Apparent age tag; repeatable or comma-separated", collectValues)
    .option("--clothing <value>", "Clothing tag; repeatable or comma-separated", collectValues)
    .option("--trait <value>", "Trait tag; repeatable or comma-separated", collectValues)
    .option("--input-json <path>", "Read a structured request from a JSON file or - for stdin")
    .option("--json", "Emit JSON")
    .option("--full-files", "Include every parsed file path")
    .option("--no-history", "Do not save this resolution to shared history")
    .action(async (
      input: string | undefined,
      commandOptions: ResolveCommandOptions & CharacterFlagOptions,
    ) => {
      const json = commandOptions.inputJson
        ? await readCharacterJson(commandOptions.inputJson, stdin)
        : {};
      if (input && commandOptions.name) {
        throw new Error("Pass the character name either positionally or with --name, not both");
      }
      const flagAppearance: Partial<CharacterAppearance> = {
        ...(commandOptions.hairColor ? { hairColors: commandOptions.hairColor } : {}),
        ...(commandOptions.eyeColor ? { eyeColors: commandOptions.eyeColor } : {}),
        ...(commandOptions.hairStyle ? { hairStyles: commandOptions.hairStyle } : {}),
        ...(commandOptions.gender ? { genders: commandOptions.gender } : {}),
        ...(commandOptions.apparentAge ? { apparentAges: commandOptions.apparentAge } : {}),
        ...(commandOptions.clothing ? { clothing: commandOptions.clothing } : {}),
        ...(commandOptions.trait ? { traits: commandOptions.trait } : {}),
      };
      const appearance = mergeAppearance(json.appearance, flagAppearance);
      await runResolve(
        "character",
        commandOptions.name ?? input ?? json.name ?? "",
        {
          ...commandOptions,
          top: commandOptions.top ?? json.top ?? 5,
          ...((commandOptions.providers ?? json.providers)
            ? { providers: commandOptions.providers ?? json.providers }
            : {}),
          ...((commandOptions.work ?? json.work)
            ? { work: commandOptions.work ?? json.work }
            : {}),
        },
        appearance,
      );
    });
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
    .option("--no-history", "Do not save this resolution to shared history")
    .action(
      async (
        input: string,
        commandOptions: { top: number; providers?: string[]; history?: boolean; json?: boolean },
      ) => {
        const providers = commandOptions.providers ?? [];
        const result = await runWithHistory({
          enabled: commandOptions.history !== false,
          input,
          target: "image",
          providers,
          execute: async () => {
            const imageResolver = await loadImageResolver(commandOptions.providers);
            return imageResolver.resolve({
              input,
              limit: commandOptions.top,
              providers,
            });
          },
        });
        writeCliOutput(stdout, result, commandOptions);
      },
    );

  const providerCommand = program.command("provider").description("Manage provider capabilities and data");
  addProviderList(providerCommand, stdout, options.providers, providerManager);
  providerCommand
    .command("show")
    .description("Show one provider's capabilities and lifecycle status")
    .argument("<provider>")
    .option("--json", "Emit JSON")
    .action(async (provider: string, commandOptions: { json?: boolean }) => {
      const item = (await loadProviderCatalog(options.providers, providerManager))
        .find((candidate) => candidate.id === provider);
      if (!item) throw new Error(`Unknown provider: ${provider}`);
      writeCliOutput(stdout, { provider: item }, commandOptions);
    });
  providerCommand
    .command("install")
    .description("Install a trusted local provider package")
    .argument("<provider-or-path>")
    .option("--trust-local", "Allow executing provider code from a local directory")
    .option("--json", "Emit JSON")
    .action(async (
      providerOrPath: string,
      commandOptions: { trustLocal?: boolean; json?: boolean },
    ) => {
      writeCliOutput(
        stdout,
        await providerManager.install(providerOrPath, {
          ...(commandOptions.trustLocal ? { trustLocal: true } : {}),
        }),
        commandOptions,
      );
    });
  providerCommand
    .command("init")
    .description("Configure provider credentials or local data")
    .argument("<provider>")
    .option("--archive <path>", "Bangumi Archive dump ZIP")
    .option("--token <token>", "Provider access token (visible in process arguments)")
    .option("--api-key <key>", "Provider API key (visible in process arguments)")
    .option("--token-stdin", "Read the provider access token from stdin")
    .option("--api-key-stdin", "Read the provider API key from stdin")
    .option("--json", "Emit JSON")
    .action(async (
      provider: string,
      commandOptions: {
        archive?: string;
        token?: string;
        apiKey?: string;
        tokenStdin?: boolean;
        apiKeyStdin?: boolean;
        json?: boolean;
      },
    ) => {
      if (commandOptions.token && commandOptions.tokenStdin) {
        throw new Error("Pass the provider token either as --token or --token-stdin, not both");
      }
      if (commandOptions.apiKey && commandOptions.apiKeyStdin) {
        throw new Error("Pass the provider API key either as --api-key or --api-key-stdin, not both");
      }
      if (commandOptions.tokenStdin && commandOptions.apiKeyStdin) {
        throw new Error("Only one credential can be read from stdin per provider init command");
      }
      const stdinCredential = commandOptions.tokenStdin || commandOptions.apiKeyStdin
        ? await readSecret(stdin)
        : undefined;
      const token = commandOptions.token ?? (commandOptions.tokenStdin ? stdinCredential : undefined);
      const apiKey = commandOptions.apiKey ?? (commandOptions.apiKeyStdin ? stdinCredential : undefined);
      writeCliOutput(
        stdout,
        await providerManager.init(provider, {
          ...(commandOptions.archive ? { archive: commandOptions.archive } : {}),
          ...(token ? { token } : {}),
          ...(apiKey ? { apiKey } : {}),
        }),
        commandOptions,
      );
    });

  const legacyProviders = program.command("providers").description("Alias for provider inspection");
  addProviderList(legacyProviders, stdout, options.providers, providerManager);

  const history = program.command("history").description("Inspect shared CLI and web resolution history");
  history
    .command("list")
    .description("List saved resolution runs")
    .option("--query <text>", "Search inputs and stored JSON")
    .option("--limit <number>", "Maximum runs", parsePositiveInteger, 50)
    .option("--offset <number>", "Runs to skip", parseNonNegativeInteger, 0)
    .option("--json", "Emit JSON")
    .action(async (
      commandOptions: { query?: string; limit: number; offset: number; json?: boolean },
    ) => {
      const store = await requireHistoryStore(getHistoryStore);
      writeCliOutput(
        stdout,
        await store.listRuns({
          ...(commandOptions.query ? { query: commandOptions.query } : {}),
          limit: commandOptions.limit,
          offset: commandOptions.offset,
        }),
        commandOptions,
      );
    });
  history
    .command("get")
    .description("Get one saved resolution run")
    .argument("<id>")
    .option("--json", "Emit JSON")
    .action(async (id: string, commandOptions: { json?: boolean }) => {
      const store = await requireHistoryStore(getHistoryStore);
      const run = await store.getRun(id);
      if (!run) throw new Error(`History run not found: ${id}`);
      writeCliOutput(stdout, { run }, commandOptions);
    });
  history
    .command("delete")
    .description("Delete one saved run and its managed attachments")
    .argument("<id>")
    .option("--json", "Emit JSON")
    .action(async (id: string, commandOptions: { json?: boolean }) => {
      const store = await requireHistoryStore(getHistoryStore);
      writeCliOutput(stdout, { deleted: await store.deleteRun(id), id }, commandOptions);
    });
  history
    .command("cleanup")
    .description("Apply configured history and attachment limits")
    .option("--json", "Emit JSON")
    .action(async (commandOptions: { json?: boolean }) => {
      const store = await requireHistoryStore(getHistoryStore);
      writeCliOutput(stdout, await store.cleanup(), commandOptions);
    });

  const entity = program.command("entity").description("Fetch a provider entity by external ID");
  entity
    .command("get")
    .argument("<entity-type>", "work or character", parseEntityType)
    .argument("<external-id>", "for example bangumi:400602 or tmdb:209867", parseExternalId)
    .option("--provider <id>", "Provider to use for a shared external ID namespace")
    .option("--json", "Emit JSON")
    .action(async (
      entityType: EntityType,
      id: ExternalId,
      commandOptions: { provider?: string; json?: boolean },
    ) => {
      const providers = await loadProviders();
      const provider = providerForId(providers, id, commandOptions.provider);
      if (!provider?.getEntity) throw new Error(`No provider can fetch ${id.source}:${id.id}`);
      writeCliOutput(stdout, await provider.getEntity(id, entityType), commandOptions);
    });
  entity
    .command("relations")
    .description("List related works, characters, and people from selected providers")
    .argument("<entity-type>", "work or character", parseEntityType)
    .argument("<external-ids...>", "one or more source:id values")
    .option("--providers <ids>", "Comma-separated provider IDs or all (required)", parseList)
    .option("--json", "Emit JSON")
    .action(async (
      entityType: EntityType,
      externalIdValues: string[],
      commandOptions: { providers?: string[]; json?: boolean },
    ) => {
      const externalIds = externalIdValues.map(parseExternalId);
      const resolver = await loadEntityRelationsResolver(commandOptions.providers);
      writeCliOutput(
        stdout,
        await resolver.resolve({
          entityType,
          externalIds,
          providers: commandOptions.providers ?? [],
        }),
        commandOptions,
      );
    });

  const work = program.command("work").description("Inspect resolved anime works");
  work
    .command("characters")
    .argument("<external-id>", "for example bangumi:400602", parseExternalId)
    .option("--provider <id>", "Provider to use for a shared external ID namespace")
    .option("--json", "Emit JSON")
    .action(async (
      id: ExternalId,
      commandOptions: { provider?: string; json?: boolean },
    ) => {
      const providers = await loadProviders();
      const provider = providerForId(providers, id, commandOptions.provider);
      if (!provider?.listWorkCharacters) {
        throw new Error(`No provider can list characters for ${id.source}:${id.id}`);
      }
      writeCliOutput(stdout, await provider.listWorkCharacters(id), commandOptions);
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

  (program as DisposableCliCommand)[disposeCliResources] = disposeResources;
  program.hook("postAction", disposeResources);

  return program;
}

export async function runCli(argv = process.argv, options: CliOptions = {}): Promise<number> {
  const stderr = options.stderr ?? process.stderr;
  const program = createCli(options).exitOverride() as DisposableCliCommand;
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
    writeCliJson(stderr, {
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
  } finally {
    await program[disposeCliResources]();
  }
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

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return parsed;
}

function parseList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...new Set([...previous, ...parseList(value)])];
}

function mergeAppearance(
  base: Partial<CharacterAppearance> | undefined,
  additions: Partial<CharacterAppearance>,
): CharacterAppearance {
  const normalized = normalizeAppearance(base);
  for (const field of Object.keys(normalized) as Array<keyof CharacterAppearance>) {
    normalized[field] = [
      ...new Set([...normalized[field], ...(additions[field] ?? [])]),
    ];
  }
  return normalized;
}

async function readCharacterJson(
  source: string,
  stdin: NodeJS.ReadableStream,
): Promise<CharacterJsonInput> {
  const raw = source === "-"
    ? await readStream(stdin)
    : await readFile(path.resolve(source), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid character query JSON from ${source}`);
  }
  if (!isRecord(value)) throw new Error("Character query JSON must be an object");
  const top = value.top === undefined ? undefined : Number(value.top);
  if (top !== undefined && (!Number.isInteger(top) || top < 1 || top > 50)) {
    throw new Error("Character query JSON top must be an integer between 1 and 50");
  }
  const providers = parseJsonProviders(value.providers, "Character query JSON");
  const work = parseJsonExternalId(value.work);
  const appearance = value.appearance === undefined
    ? undefined
    : parseAppearanceInput(value.appearance);
  return {
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(providers ? { providers } : {}),
    ...(top !== undefined ? { top } : {}),
    ...(work ? { work } : {}),
    ...(appearance ? { appearance } : {}),
  };
}

async function readUnifiedQueryJson(
  source: string,
  stdin: NodeJS.ReadableStream,
): Promise<UnifiedQueryJsonInput> {
  const raw = source === "-"
    ? await readStream(stdin)
    : await readFile(path.resolve(source), "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid query JSON from ${source}`);
  }
  if (!isRecord(value)) throw new Error("Query JSON must be an object");
  if (value.target !== "work" && value.target !== "character" && value.target !== "image") {
    throw new Error("Query JSON target must be work, character, or image");
  }
  if (value.target !== "character") {
    for (const field of ["name", "work", "appearance"] as const) {
      if (value[field] !== undefined) {
        throw new Error(`Query JSON ${field} is only valid for character queries`);
      }
    }
  }
  const character = await parseCharacterJsonValue(value);
  const inputValue = typeof value.input === "string" ? value.input.trim() : "";
  const input = inputValue || character.name || "";
  if (!input && value.target !== "character") {
    throw new Error(`Query JSON input is required for ${value.target}`);
  }
  if (value.target === "character" && !input && !character.work && !character.appearance) {
    throw new Error("Character query requires input, work, or appearance");
  }
  return {
    target: value.target,
    input,
    ...character,
  };
}

async function parseCharacterJsonValue(value: Record<string, unknown>): Promise<CharacterJsonInput> {
  const top = value.top === undefined ? undefined : Number(value.top);
  if (top !== undefined && (!Number.isInteger(top) || top < 1 || top > 50)) {
    throw new Error("Query JSON top must be an integer between 1 and 50");
  }
  const providers = parseJsonProviders(value.providers, "Query JSON");
  const work = parseJsonExternalId(value.work);
  const appearance = value.appearance === undefined
    ? undefined
    : parseAppearanceInput(value.appearance);
  return {
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(providers ? { providers } : {}),
    ...(top !== undefined ? { top } : {}),
    ...(work ? { work } : {}),
    ...(appearance ? { appearance } : {}),
  };
}

function parseJsonProviders(value: unknown, context: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return parseList(value);
  if (!Array.isArray(value)) {
    throw new Error(`${context} providers must be a string or string array`);
  }
  if (value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${context} providers must contain only non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function parseJsonExternalId(value: unknown): ExternalId | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return parseExternalId(value);
  if (
    !isRecord(value) ||
    typeof value.source !== "string" ||
    typeof value.id !== "string"
  ) {
    throw new Error("Character query JSON work must use source:id or an external ID object");
  }
  const mediaKind = typeof value.mediaKind === "string" && isMediaKind(value.mediaKind)
    ? value.mediaKind
    : undefined;
  return {
    source: value.source,
    id: value.id,
    ...(mediaKind ? { mediaKind } : {}),
  };
}

function isMediaKind(value: string): value is NonNullable<ExternalId["mediaKind"]> {
  return value === "tv" || value === "movie" || value === "ova" || value === "web" || value === "unknown";
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let value = "";
  for await (const chunk of stream as NodeJS.ReadableStream & AsyncIterable<Buffer | string>) {
    value += chunk.toString();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    .option("--ready", "Only list providers that are ready")
    .option("--capability <id>", "Require a capability; repeatable or comma-separated", collectValues)
    .option("--json", "Emit JSON")
    .action(async (
      commandOptions: { ready?: boolean; capability?: string[]; json?: boolean },
    ) => {
      const providers = (await loadProviderCatalog(injectedProviders, providerManager))
        .filter((provider) => !commandOptions.ready || provider.status === "ready")
        .filter((provider) =>
          !commandOptions.capability?.length ||
          commandOptions.capability.every((capability) =>
            provider.capabilities.includes(capability as never)
          )
        );
      writeCliOutput(stdout, { providers }, commandOptions);
    });
}

async function loadProviderCatalog(
  injectedProviders: Provider[] | undefined,
  providerManager: ProviderManager,
) {
  if (!injectedProviders) return providerManager.list();
  return injectedProviders.map((provider) => ({
    ...provider.manifest,
    installed: true,
    initialized: true,
    status: "ready" as const,
    distribution: "bundled" as const,
  }));
}

async function readSecret(stdin: NodeJS.ReadableStream): Promise<string> {
  const secret = (await readStream(stdin)).trim();
  if (!secret) throw new Error("Credential read from stdin must not be empty");
  if (secret.length > 16_384) throw new Error("Credential read from stdin is too long");
  return secret;
}

const MAX_HISTORY_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function readHistoryAttachment(
  input: string,
  target: EntityType | "image",
): Promise<AddAttachmentInput | undefined> {
  const source = path.resolve(input);
  const extension = path.extname(source).toLowerCase();
  const kind = target === "image" && [".jpg", ".jpeg", ".png"].includes(extension)
    ? "image"
    : target === "work" && extension === ".torrent"
      ? "torrent"
      : undefined;
  if (!kind) return undefined;
  let metadata;
  try {
    metadata = await stat(source);
  } catch {
    return undefined;
  }
  if (!metadata.isFile() || metadata.size > MAX_HISTORY_ATTACHMENT_BYTES) return undefined;
  return {
    fileName: path.basename(source),
    mimeType: kind === "torrent"
      ? "application/x-bittorrent"
      : extension === ".png"
        ? "image/png"
        : "image/jpeg",
    kind,
    data: await readFile(source),
  };
}

async function requireHistoryStore(
  load: () => Promise<RunStore | undefined>,
): Promise<RunStore> {
  const store = await load();
  if (!store) throw new Error("History is disabled for this CLI instance");
  return store;
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

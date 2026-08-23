#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command, CommanderError, InvalidArgumentError } from "commander";

import { parseContentInput } from "./input.js";
import { createDefaultProviders } from "./providers/index.js";
import { Resolver } from "./resolver.js";
import type { EntityType, ExternalId, Provider } from "./types.js";

export interface CliOptions {
  providers?: Provider[];
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export function createCli(options: CliOptions = {}): Command {
  const providers = options.providers ?? createDefaultProviders();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const resolver = new Resolver(providers);
  const program = new Command();

  program
    .name("ani-resolver")
    .description("Resolve anime works and characters into ranked, sourced identities")
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
    .action(async (input: string) => writeJson(stdout, await parseContentInput(input)));

  const resolve = program.command("resolve").description("Return ranked identity candidates");
  for (const entityType of ["work", "character"] as const) {
    resolve
      .command(entityType)
      .argument("<input>")
      .option("--top <number>", "Maximum candidates", parsePositiveInteger, 5)
      .option("--providers <ids>", "Comma-separated provider IDs", parseList)
      .option("--work <external-id>", "Known work ID for character resolution", parseExternalId)
      .option("--json", "Emit JSON")
      .action(
        async (
          input: string,
          commandOptions: { top: number; providers?: string[]; work?: ExternalId },
        ) => {
          writeJson(
            stdout,
            await resolver.resolve({
              entityType,
              input,
              limit: commandOptions.top,
              ...(commandOptions.providers ? { providers: commandOptions.providers } : {}),
              ...(commandOptions.work ? { work: commandOptions.work } : {}),
            }),
          );
        },
      );
  }

  const providerCommand = program.command("providers").description("Inspect provider capabilities");
  providerCommand
    .command("list")
    .option("--json", "Emit JSON")
    .action(() => writeJson(stdout, { providers: resolver.listProviders() }));

  const entity = program.command("entity").description("Fetch a provider entity by external ID");
  entity
    .command("get")
    .argument("<entity-type>", "work or character", parseEntityType)
    .argument("<external-id>", "for example bangumi:400602 or tmdb:209867", parseExternalId)
    .option("--json", "Emit JSON")
    .action(async (entityType: EntityType, id: ExternalId) => {
      const provider = providerForId(providers, id);
      if (!provider?.getEntity) throw new Error(`No provider can fetch ${id.source}:${id.id}`);
      writeJson(stdout, await provider.getEntity(id, entityType));
    });

  const work = program.command("work").description("Inspect resolved anime works");
  work
    .command("characters")
    .argument("<external-id>", "for example bangumi:400602", parseExternalId)
    .option("--json", "Emit JSON")
    .action(async (id: ExternalId) => {
      const provider = providerForId(providers, id);
      if (!provider?.listWorkCharacters) {
        throw new Error(`No provider can list characters for ${id.source}:${id.id}`);
      }
      writeJson(stdout, await provider.listWorkCharacters(id));
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
        code: error instanceof CommanderError ? error.code : "runtime_error",
        message: error instanceof Error ? error.message : String(error),
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

function providerForId(providers: Provider[], id: ExternalId): Provider | undefined {
  return providers.find((provider) => provider.manifest.id === id.source);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

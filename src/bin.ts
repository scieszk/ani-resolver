#!/usr/bin/env node

import { runtimeVersionError } from "./runtime-version.js";

async function main(): Promise<void> {
  const runtimeError = runtimeVersionError(process.versions.node);
  if (runtimeError) {
    process.stderr.write(`${JSON.stringify(runtimeError)}\n`);
    process.exitCode = 1;
    return;
  }
  const { runCli } = await import("./cli.js");
  process.exitCode = await runCli();
}

void main();

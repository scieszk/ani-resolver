# Multimodal Image Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class image resolution to ani-resolver through trace.moe, SauceNAO, and AnimeTrace, expose it to AstrBot, and deploy it without building a local visual index.

**Architecture:** Image lookup is a separate typed provider capability because scene matches, reverse-source matches, and character matches are not interchangeable. A shared image input layer accepts a local JPEG/PNG or an HTTP(S) URL, providers return source-native ranking signals in a normalized envelope, and the CLI preserves per-provider results instead of inventing a cross-provider probability. Existing text work and character resolution stays unchanged.

**Tech Stack:** TypeScript 7, Node.js 24 fetch/FormData, Zod, Vitest, Python unittest, trace.moe API, SauceNAO API, AnimeTrace API, AstrBot.

---

### Task 1: Image Input and Provider Contracts

**Files:**
- Create: `src/image-input.ts`
- Modify: `src/types.ts`
- Create: `test/image-input.test.ts`

- [ ] **Step 1: Write failing image input tests**

Cover an existing JPEG/PNG path, an HTTP(S) URL, a missing file, a directory, an unsupported extension, and URL redaction in public output. Assert that provider-facing input retains the usable URL/path while emitted evidence contains no URL credentials or query string.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/image-input.test.ts`

Expected: FAIL because `src/image-input.ts` and image provider types do not exist.

- [ ] **Step 3: Add typed image contracts and parser**

Add `anime_scene_lookup`, `reverse_image_lookup`, and `character_image_lookup` capabilities. Define `ImageQuery`, `ImageMatch`, `ImageProviderRun`, `ImageResolveRequest`, and `ImageResolveResult`, plus optional `Provider.searchImage`. Implement `parseImageInput()` for local JPEG/PNG files and HTTP(S) URLs, including bounded file-size metadata and a redacted public display value.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- test/image-input.test.ts`

Expected: all image input tests pass.

### Task 2: Image Resolver Orchestration

**Files:**
- Create: `src/image-resolver.ts`
- Create: `test/image-resolver.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing orchestration tests**

Use injected providers to assert capability-based default selection, explicit provider selection, unknown-provider errors, isolated timeout/failure statuses, top-N truncation per provider, and stable `ani-resolver.image.v1` output.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/image-resolver.test.ts`

Expected: FAIL because `ImageResolver` does not exist.

- [ ] **Step 3: Implement minimal image orchestration**

Parse the input once, invoke only providers with `searchImage`, preserve each provider's ordered matches and native `similarity`, `rank`, and confidence flags, summarize failed runs, and never calculate a shared probability across providers.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- test/image-resolver.test.ts`

Expected: all image resolver tests pass.

### Task 3: trace.moe Scene Provider

**Files:**
- Create: `src/providers/trace-moe.ts`
- Create: `test/image-providers.test.ts`
- Modify: `src/providers/index.ts`

- [ ] **Step 1: Write failing trace.moe fixture tests**

Assert URL and binary upload requests, optional `x-trace-key`, Zod validation, AniList external IDs, episode/time range, preview image/video, similarity preservation, empty results, rate limits, and malformed upstream responses.

- [ ] **Step 2: Run the focused provider test and verify RED**

Run: `npm test -- test/image-providers.test.ts -t trace.moe`

Expected: FAIL because `TraceMoeProvider` does not exist.

- [ ] **Step 3: Implement the trace.moe adapter**

Call `https://api.trace.moe/search`, request AniList metadata, upload local bytes without shelling out, and return `anime_scene` matches containing AniList IDs, titles, episode, `from`, `to`, `at`, preview URLs, and the upstream similarity value.

- [ ] **Step 4: Run the focused provider test and verify GREEN**

Run the same focused test and expect all trace.moe cases to pass.

### Task 4: SauceNAO and AnimeTrace Providers

**Files:**
- Create: `src/providers/saucenao.ts`
- Create: `src/providers/animetrace.ts`
- Modify: `test/image-providers.test.ts`
- Modify: `src/providers/index.ts`

- [ ] **Step 1: Write failing fixture tests for both providers**

For SauceNAO, assert API-key authentication, URL/file form submission, source database metadata, source URLs, creator/title fields, external IDs, and similarity preservation. For AnimeTrace, assert URL/file form submission, multiple detected boxes, ordered character candidates, work names, `not_confident`, AI-image detection, and dynamic default-model behavior without a hard-coded model ID.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- test/image-providers.test.ts -t "SauceNAO|AnimeTrace"`

Expected: FAIL because both providers are missing.

- [ ] **Step 3: Implement both adapters**

Use `https://saucenao.com/search.php` with JSON output and a configured key. Use `https://api.animetrace.com/v1/search` without forcing a model, map each detected character candidate independently, and preserve provider warnings rather than deriving a probability.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused test and expect all SauceNAO and AnimeTrace cases to pass.

### Task 5: Provider Lifecycle and Credentials

**Files:**
- Modify: `src/provider-management.ts`
- Modify: `test/provider-management.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Expect trace.moe and AnimeTrace to be bundled and ready without credentials, SauceNAO to report `needs_init`, `provider init saucenao --api-key` to store the key, optional trace.moe keys to be stored, and all ready providers to load through the Cordis host.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/provider-management.test.ts`

Expected: new lifecycle assertions fail.

- [ ] **Step 3: Register and configure image providers**

Add all three manifests to the provider catalog, load credentials from the keyring or `SAUCENAO_API_KEY` / `TRACE_MOE_API_KEY`, inject them into providers, and keep missing SauceNAO authentication visible without blocking unrelated image providers.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused test and expect all lifecycle tests to pass.

### Task 6: CLI and AstrBot Tool Surface

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`
- Modify: `integrations/astrbot/astrbot_plugin_ani_resolver/runner.py`
- Modify: `integrations/astrbot/astrbot_plugin_ani_resolver/main.py`
- Modify: `integrations/astrbot/astrbot_plugin_ani_resolver/metadata.yaml`
- Modify: `integrations/astrbot/tests/test_plugin.py`

- [ ] **Step 1: Write failing CLI and AstrBot tests**

Expect `ani-resolver resolve image <path-or-url> --providers ... --top ... --json`, validate that the image input remains one argv element, reject malformed provider lists, register `ani_resolver_resolve_image`, and keep structured error JSON.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- test/cli.test.ts` and `python -m unittest discover -s integrations/astrbot/tests -v`.

Expected: the new command and AstrBot tool assertions fail.

- [ ] **Step 3: Expose image lookup**

Add the CLI subcommand without changing text resolve behavior. Add an AstrBot-native tool accepting a local path or HTTP(S) image URL plus top/provider arguments, invoke the fixed executable with an argv array, and increment the plugin patch version.

- [ ] **Step 4: Run tests and verify GREEN**

Run both focused commands and expect all tests to pass.

### Task 7: Skill, Documentation, Live Verification, and Deployment

**Files:**
- Modify: `skills/resolve-anime-content/SKILL.md`
- Modify: `skills/resolve-anime-content/references/cli.md`
- Modify: `integrations/astrbot/astrbot_plugin_ani_resolver/skills/resolve-anime-content/SKILL.md`
- Modify: `README.md`
- Deploy tracked files to `/srv/ani-resolver/app` and the AstrBot plugin copy on the existing host.

- [ ] **Step 1: Update agent routing guidance**

Teach the skill to route animation frames to trace.moe, source/artist questions to SauceNAO, and character-in-image questions to AnimeTrace. Require agents to disclose image upload, inspect several candidates, preserve native ranking semantics, and feed returned titles/AniList IDs into existing work resolution when enrichment is useful.

- [ ] **Step 2: Run complete local verification**

Run `npm run check`, `npm test`, `npm run build`, and `python -m unittest discover -s integrations/astrbot/tests -v`. Expect zero failures.

- [ ] **Step 3: Run live provider smoke tests**

Use a public anime frame or local test image to verify trace.moe and AnimeTrace. Verify SauceNAO when a configured key is available; otherwise confirm the provider reports `auth_required` while the other providers still return independently.

- [ ] **Step 4: Commit, push, and deploy**

Commit only scoped files, push `main`, pull on the existing AstrBot host, build with `/srv/ani-resolver/runtime/bin/node`, copy the plugin into persistent AstrBot storage, and restart only the AstrBot service needed to load the updated tool.

- [ ] **Step 5: Verify AstrBot and notify through Feishu**

Confirm the image tool is registered, provider listing reports the expected lifecycle states, a container-level image lookup returns structured JSON, and AstrBot logs contain no plugin errors. Send the completion summary to the most recently active Feishu private conversation.

# Character Appearance Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add normalized character-appearance search through bundled Wikidata and AniList providers, enrich existing Bangumi candidates, and deploy the capability to AstrBot.

**Architecture:** A source-neutral appearance vocabulary parses user and provider text into canonical facts and scores overlap. Wikidata supplies structured global appearance search and cross-source character IDs; AniList supplies work/character descriptions and cast enumeration. Existing provider interfaces and AstrBot tools stay stable.

**Tech Stack:** TypeScript 7, Node.js 24 fetch, Zod, Vitest, Wikidata SPARQL/MediaWiki APIs, AniList GraphQL, Python unittest for AstrBot integration.

---

### Task 1: Appearance Vocabulary

**Files:**
- Create: `src/appearance.ts`
- Modify: `src/types.ts`
- Create: `test/appearance.test.ts`

- [ ] **Step 1: Write failing parser and scorer tests**

Test Chinese and English aliases, canonical arrays, matched/missing facts, and a zero score for unrelated candidates.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/appearance.test.ts`

Expected: FAIL because `src/appearance.ts` does not exist.

- [ ] **Step 3: Implement the minimal vocabulary and scorer**

Export `parseAppearanceText(text)`, `scoreAppearanceMatch(query, candidate)`, and the `CharacterAppearance` types. Match only fixed aliases and deduplicate canonical values.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- test/appearance.test.ts`

Expected: all appearance tests pass.

### Task 2: Wikidata Provider

**Files:**
- Create: `src/providers/wikidata.ts`
- Create: `test/wikidata-provider.test.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing provider contract tests**

Use injected fetch responses to assert fixed-QID SPARQL generation, QID validation, normalized appearance facts, and Bangumi/AniList/AniDB/ACDB external IDs.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/wikidata-provider.test.ts`

Expected: FAIL because `WikidataProvider` is missing.

- [ ] **Step 3: Implement appearance and name search**

Use `requestJson`, a fixed trait-to-QID map, bounded SPARQL limits, `wbsearchentities` for plain names, and `wbgetentities`/SPARQL enrichment for details. Return `facts.appearance`, descriptions, images, sitelink popularity, work names, and external IDs.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- test/wikidata-provider.test.ts`

Expected: all Wikidata tests pass.

### Task 3: AniList Provider

**Files:**
- Create: `src/providers/anilist.ts`
- Create: `test/anilist-provider.test.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing GraphQL mapping tests**

Assert work IDs/titles, character profile facts, work-scoped cast ranking, description sanitization, and unsupported foreign IDs.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/anilist-provider.test.ts`

Expected: FAIL because `AniListProvider` is missing.

- [ ] **Step 3: Implement the provider**

Post bounded GraphQL operations through `requestJson`, map works and characters into existing candidate types, and use the shared appearance parser/scorer for character ranking.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- test/anilist-provider.test.ts`

Expected: all AniList tests pass.

### Task 4: Lifecycle and Bangumi Enrichment

**Files:**
- Modify: `src/provider-management.ts`
- Modify: `src/providers/bangumi.ts`
- Modify: `src/providers/bangumi-archive.ts`
- Modify: `test/provider-management.test.ts`
- Modify: `test/providers.test.ts`
- Modify: `test/archive-provider.test.ts`

- [ ] **Step 1: Write failing lifecycle and enrichment tests**

Expect AniList and Wikidata to be bundled/ready without initialization, both to load in the host, Bangumi facts to include normalized appearance, and work-scoped archive results to rank trait matches.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- test/provider-management.test.ts test/providers.test.ts test/archive-provider.test.ts`

Expected: new assertions fail against current behavior.

- [ ] **Step 3: Register providers and enrich candidates**

Treat bundled `auth: none` network providers as ready, register both providers, add the new capability to relevant manifests, and score Bangumi candidates through the shared appearance module.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused command and expect all tests to pass.

### Task 5: CLI and AstrBot Agent Surface

**Files:**
- Modify: `integrations/astrbot/astrbot_plugin_ani_resolver/runner.py`
- Modify: `integrations/astrbot/astrbot_plugin_ani_resolver/main.py`
- Modify: `integrations/astrbot/tests/test_plugin.py`
- Modify: `skills/resolve-anime-content/SKILL.md`
- Modify: `integrations/astrbot/astrbot_plugin_ani_resolver/skills/resolve-anime-content/SKILL.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing external-ID and routing tests**

Expect AstrBot to accept `anilist:154587` and `wikidata:Q104144455`, reject malformed IDs, and mention structured appearance routing in both skills.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m unittest discover -s integrations/astrbot/tests -v`

Expected: new validation and skill assertions fail.

- [ ] **Step 3: Update validation and guidance**

Keep tools unchanged, widen only validated ID syntax, and teach agents to inspect provider capabilities and use Wikidata IDs as bridges into Bangumi/AniList details.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same Python command and expect all tests to pass.

### Task 6: Verification, Release, and Deployment

**Files:**
- Modify only generated `dist/` locally during build; it remains ignored.
- Deploy tracked files to `/srv/ani-resolver/app` and the AstrBot plugin copy on the existing VM.

- [ ] **Step 1: Run complete local verification**

Run `npm run check`, `npm test`, `npm run build`, and the AstrBot Python tests. Expect zero failures.

- [ ] **Step 2: Run live provider smoke tests**

Verify provider list reports five ready providers and appearance search returns structured facts and multiple candidates. Treat live upstream outages as explicit provider statuses, not silent success.

- [ ] **Step 3: Commit and push**

Commit only scoped source, tests, docs, and skill updates, then push the current branch.

- [ ] **Step 4: Deploy without changing the host Node runtime**

Pull the pushed commit, build with `/srv/ani-resolver/runtime/bin/node`, copy the AstrBot plugin, recreate only the AstrBot service when necessary, and preserve the read-only mount and credential permissions.

- [ ] **Step 5: Verify AstrBot end to end and notify through Feishu**

Assert six registered tools, five ready providers, a successful container-level appearance query, no plugin errors, then send the concise completion message to the most recently active Lark private conversation.


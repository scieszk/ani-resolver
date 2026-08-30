# ani-resolver

`ani-resolver` is provider-based infrastructure for anime metadata resolution. Its TypeScript library and CLI turn titles, release names, paths, torrent files, magnets, structured character conditions, and images into ranked identity or source candidates with evidence and stable JSON.

It returns data for callers to use. It does not search torrent sites, download content, rename files, move files, or delete files.

## Requirements

- Node.js 24 or newer
- A descriptive project User-Agent for Bangumi, supplied by the built-in provider
- `TMDB_ACCESS_TOKEN`, `TMDB_API_KEY`, or a credential stored by `provider init tmdb` for TMDB requests
- `SAUCENAO_API_KEY` or a credential stored by `provider init saucenao` for SauceNAO requests

When the network requires a proxy, start Node with `NODE_USE_ENV_PROXY=1` and set `HTTPS_PROXY` to the user's proxy URL. A provider connection failure does not mean the title has no matches.

## Install

```bash
npm ci
npm run build
npm link
```

## CLI

```bash
ani-resolver provider list
ani-resolver provider list --ready --capability work_search --json
ani-resolver provider show bangumi-archive --json
ani-resolver provider init bangumi-archive --archive /path/to/dump.zip --json
printf '%s' "$TMDB_ACCESS_TOKEN" | ani-resolver provider init tmdb --token-stdin --json
printf '%s' "$SAUCENAO_API_KEY" | ani-resolver provider init saucenao --api-key-stdin --json
ani-resolver parse "[VCB-Studio] Sousou no Frieren [01][1080p].mkv" --json
ani-resolver inventory /media/downloads/Dungeon-Meshi --json
ani-resolver inventory ./Dungeon-Meshi.torrent --full-files --json
ani-resolver resolve work "葬送的芙莉莲 (2023)" --providers bangumi,anilist --top 5 --json
ani-resolver resolve character --name "艾拉" --providers bangumi --top 5 --json
ani-resolver resolve character --hair-color white --hair-style twintails --gender female --trait expressionless --providers wikidata,bangumi-archive --top 5 --json
ani-resolver resolve character --name "艾拉" --work anilist:154587 --providers anilist --top 5 --json
ani-resolver resolve character --input-json ./character-query.json --json
ani-resolver resolve image ./frame.jpg --providers trace-moe --top 5 --json
ani-resolver resolve image https://example.com/artwork.jpg --providers saucenao --top 5 --json
ani-resolver resolve image ./character.png --providers animetrace --top 5 --json
ani-resolver entity get work bangumi:400602 --json
ani-resolver entity get character wikidata:Q104144455 --json
ani-resolver entity get work tmdb-tv:209867 --json
ani-resolver entity relations work bangumi:400602 anilist:154587 --providers bangumi,anilist --json
ani-resolver work characters bangumi:400602 --provider bangumi-archive --json
ani-resolver history list --query "Dungeon Meshi" --json
```

AI callers can use one typed stdin entry point instead of selecting a command shape themselves:

```bash
printf '%s\n' '{"target":"work","input":"Dungeon Meshi","providers":["bangumi","anilist"],"top":5}' \
  | ani-resolver query --input-json - --json
```

`query` accepts `work`, `character`, and `image` targets. Character-only fields such as `work`, `name`, and `appearance` are rejected on other targets instead of being silently ignored.

## Local Web Console

The same package includes a React browser UI and HTTP API for running queries, inspecting typed results, saving candidate favorites, viewing provider traces, and searching run history:

```bash
npm run build
ani-resolver web --host 0.0.0.0 --port 4173 --max-storage-mb 100
```

Open `http://<machine-ip>:4173/` from another device on the LAN. The web console has no browser access token or login layer; bind it only to a trusted network. Provider credentials stay in the server process and are never returned by the API.

CLI and Web resolutions share the same history database. Each run records its explicit target, structured query, selected providers, ranked result, provider status, and timing. Use `--no-history` for an ephemeral resolve, or inspect and manage records with `history list|get|delete|cleanup`. Favorites store independent candidate snapshots, so deleting a run does not delete its saved candidates. JPEG, PNG, and torrent attachments are copied into managed storage. Deleting a run removes its stored files, and automatic cleanup purges the oldest attachment bodies when the configurable quota is exceeded while retaining the run metadata. The defaults are 500 runs and 100 MiB of stored attachments.

For local-only access, bind to loopback instead:

```bash
ani-resolver web --host 127.0.0.1 --port 4173
```

`tmdb-tv:<id>` and `tmdb-movie:<id>` preserve TMDB's separate TV and movie namespaces. Existing path tags such as `[tmdbid=262929]` and `{tmdb-262929}` are recognized, with media kind inferred when the path contains useful TV or movie evidence.

Successful commands print concise human-readable output by default. Pass `--json` for compact, stable machine output. Errors always emit `ani-resolver.error.v1` JSON on stderr and use a nonzero exit code. `resolve` keeps multiple candidates unless unambiguous explicit work IDs identify one candidate; duplicate IDs from the same source remain separate possibilities. Scores are deterministic match scores, not statistical probabilities.

Resolution results include an `outcome`: `matched` means usable candidates exist, `no_match` means selected providers completed but found none, `partial` means results or completed providers coexist with failures, and `unavailable` means no provider completed. Callers should never interpret `partial` or `unavailable` as a confirmed no-match.

Every `resolve work`, `resolve character`, and `resolve image` command requires an explicit `--providers` selection. Use comma-separated IDs, or pass `--providers all` to intentionally run every loaded provider compatible with that operation. `all` cannot be combined with named providers. Unknown or statically incompatible providers fail before any provider request and return a structured error such as `unknown_provider` or `unsupported_provider_capability`.

Character queries are intentionally structured. The CLI treats `--name` as a literal name and accepts repeatable tags through `--hair-color`, `--eye-color`, `--hair-style`, `--gender`, `--apparent-age`, `--clothing`, and `--trait`. It does not derive those fields from a prose clue. Agents and other callers can translate user language into these flags or provide a JSON request through `--input-json <path>`; use `--input-json -` for stdin. Providers may still normalize their own source descriptions into candidate facts for matching.

`inventory` recursively reads a directory, file, torrent, or magnet without modifying it. It classifies files, groups episode video/subtitle/audio companions, preserves relative paths, reports extras that could not be assigned, and counts nested symbolic links it intentionally skipped. Compact output bounds per-group paths for AI use; add `--full-files` only when generating a complete source-to-destination plan. `parse` and `resolve` still report compact evidence when a full inventory is unnecessary.

A typical organization workflow is: inventory the downloaded content, resolve the work to several sourced candidates, verify the accepted entity and relations, then let the surrounding AI or file tool propose a complete source-to-destination mapping. Ani Resolver itself never renames, moves, overwrites, or deletes files.

Magnet parsing uses the full input in memory, but emitted evidence removes tracker and web-seed parameters that may contain private passkeys. Provider calls time out after 15 seconds by default so one stalled source cannot block the complete result.

Image resolution emits `ani-resolver.image.v1`. It keeps scene, source, and character matches distinct and preserves upstream `similarity`, its declared `similarityScale`, result order, and low-confidence flags rather than manufacturing one cross-provider probability. AnimeTrace candidates are ranked within each detected person box, not globally across people. Local inputs accept JPEG and PNG files up to 20 MiB. Image providers receive the selected file or URL, so callers should disclose the third-party upload and select only the providers needed for the request.

## Providers

| Provider | Work search | Character search | Image lookup | Work characters | Authentication |
| --- | --- | --- | --- | --- | --- |
| Bangumi API | yes | yes | no | yes | optional |
| TMDB | yes | no | no | no | required |
| AniList | yes | yes | no | yes | none |
| Wikidata | no | yes | no | yes | none |
| Bangumi Archive | yes | yes | no | yes | none |
| trace.moe | no | no | anime scene, episode, timestamp | no | optional |
| SauceNAO | no | no | original source and creator | no | required |
| AnimeTrace | no | no | anime/Galgame character | no | none |

Run `ani-resolver provider list --json` for machine-readable capabilities, lifecycle status, strengths, limitations, languages, attribution, and authentication requirements. Filter with `--ready` and repeatable `--capability`; inspect setup with `provider show <id>`. Provider code can be bundled while provider data still reports `needs_init`. Prefer `--token-stdin` and `--api-key-stdin` for credentials because direct secret flags may be visible in process arguments.

Bangumi Archive is indexed locally rather than queried from the ZIP. Download a dump ZIP from the [Bangumi Archive releases](https://github.com/bangumi/Archive/releases), then initialize it:

```bash
ani-resolver provider init bangumi-archive --archive /path/to/dump.zip --json
ani-resolver resolve work "Dungeon Meshi" --providers bangumi-archive --json
ani-resolver resolve character --name "玛露希尔" --work bangumi:395378 --providers bangumi-archive --json
ani-resolver resolve character --hair-color white --hair-style twintails --providers bangumi-archive --json
```

Initialization streams the dump into an anime-only SQLite FTS5 index. It retains related character text, normalized appearance tags, and work relations, but it cannot recover traits absent from Archive text. Re-run `provider init bangumi-archive` after upgrading an older index that predates structured appearance search.

Wikidata can search structured hair color, eye color, hairstyle, gender, and clothing statements and return cross-source character IDs. AniList adds profile text and work cast data. Coverage is uneven, so the CLI returns several candidates plus `facts.appearance`, matched/missing evidence, and isolated provider statuses. Callers decide how to clarify or act on uncertain results.

`--work` is a real constraint, not a hint. Bangumi can filter characters with a Bangumi work ID; a TMDB work ID is reported as unsupported rather than silently falling back to global character search. Resolve or map the work to a Bangumi ID first when needed.

## Provider Extension

Providers implement small capability methods instead of one universal upstream API:

```ts
import type { Provider, ProviderManifest, ResolveQuery } from "ani-resolver";

export class ExampleProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "example",
    label: "Example",
    mediaTypes: ["anime"],
    capabilities: ["character_search"],
    languages: ["en"],
    auth: "none",
    strengths: ["structured character traits"],
    limitations: [],
  };

  async searchCharacters(_query: ResolveQuery) {
    return { provider: "example", status: "empty", items: [] };
  }
}
```

Register provider instances when constructing `Resolver`, or register them through `ProviderHost` for Cordis-managed lifecycle and disposal. Catalog, installation, initialization, credentials, and indexes remain ani-resolver responsibilities; Cordis Loader and HMR are not used. Provider failures are isolated and surfaced in `providerRuns`.

A local provider directory uses a small package manifest:

```json
{
  "schemaVersion": "ani-resolver.provider.v1",
  "id": "example",
  "version": "1.0.0",
  "entry": "index.js"
}
```

Its entry point default-exports a Cordis plugin that registers exactly that ID:

```js
import { ExampleProvider } from "./provider.js";

export default (context) => {
  context.providers.add(new ExampleProvider());
};
```

Local provider code runs with the user's Node.js permissions, so installation requires explicit trust:

```bash
ani-resolver provider install ./example-provider --trust-local --json
```

## Development

```bash
npm run check
npm test
npm run build
```

Tests use recorded fixtures and injected `fetch`; normal test runs do not call live APIs.

## Data Sources

- [Bangumi API](https://bangumi.github.io/api/)
- [Bangumi Archive](https://github.com/bangumi/Archive)
- [TMDB API](https://developer.themoviedb.org/)
- [AniList GraphQL API](https://docs.anilist.co/)
- [Wikidata](https://www.wikidata.org/)
- [trace.moe API](https://github.com/soruly/trace.moe-api)
- [SauceNAO](https://saucenao.com/)
- [AnimeTrace API](https://www.animetrace.com/api-docs/)

Provider data remains subject to its upstream terms and attribution requirements. This repository does not redistribute upstream datasets or images.

## Experimental Integrations

The bundled `resolve-anime-content` Skill is an experimental example of using the CLI from an AI agent. It selects providers, inspects candidates, and keeps conversation and file operations outside the resolver. The Skill is not required to use the library or CLI.

### AstrBot

The experimental AstrBot plugin exposes nine constrained LLM tools for provider inspection, parsing, read-only inventory, work/character/image resolution, entity lookup and relations, and work-character listing. Image and torrent tools can use files from the current or replied AstrBot message when their explicit input is empty. It also bundles an AstrBot-native `resolve-anime-content` Skill that orchestrates those tools without depending on Codex or HAPI.

The plugin lives at `integrations/astrbot/astrbot_plugin_ani_resolver`. Mount the installed ani-resolver directory into the AstrBot container at the same path, read-only, then copy the plugin into AstrBot's persistent `data/plugins` directory:

```yaml
services:
  astrbot:
    volumes:
      - /srv/ani-resolver:/srv/ani-resolver:ro
```

The integration invokes the fixed `/srv/ani-resolver/bin/ani-resolver` executable with an argv array. It does not pass model input through a shell.

# ani-resolver

`ani-resolver` is provider-based infrastructure for anime metadata resolution. Its TypeScript library and CLI turn titles, release names, paths, torrent files, magnets, character clues, and images into ranked identity or source candidates with evidence and stable JSON.

It returns data for callers to use. It does not search torrent sites, download content, rename files, move files, or delete files.

## Requirements

- Node.js 24 or newer
- A descriptive project User-Agent for Bangumi, supplied by the built-in provider
- `TMDB_ACCESS_TOKEN`, `TMDB_API_KEY`, or a credential stored by `provider init tmdb` for TMDB requests
- `SAUCENAO_API_KEY` or a credential stored by `provider init saucenao` for SauceNAO requests

When the network requires a proxy, start Node with `NODE_USE_ENV_PROXY=1` and set `HTTPS_PROXY` to the user's proxy URL. A provider connection failure does not mean the title has no matches.

## Install

```bash
npm install
npm run build
npm link
```

## CLI

```bash
ani-resolver provider list --json
ani-resolver provider init bangumi-archive --archive /path/to/dump.zip --json
ani-resolver provider init tmdb --token "$TMDB_ACCESS_TOKEN" --json
ani-resolver provider init tmdb --api-key "$TMDB_API_KEY" --json
ani-resolver provider init saucenao --api-key "$SAUCENAO_API_KEY" --json
ani-resolver provider init trace-moe --api-key "$TRACE_MOE_API_KEY" --json
ani-resolver parse "[VCB-Studio] Sousou no Frieren [01][1080p].mkv" --json
ani-resolver resolve work "葬送的芙莉莲 (2023)" --providers bangumi,anilist --top 5 --json
ani-resolver resolve character "艾拉" --providers bangumi --top 5 --json
ani-resolver resolve character "女主 白发 双马尾 前期没什么表情" --providers wikidata,anilist,bangumi --top 5 --json
ani-resolver resolve character "白发 双马尾" --work anilist:154587 --providers anilist --top 5 --json
ani-resolver resolve image ./frame.jpg --providers trace-moe --top 5 --json
ani-resolver resolve image https://example.com/artwork.jpg --providers saucenao --top 5 --json
ani-resolver resolve image ./character.png --providers animetrace --top 5 --json
ani-resolver entity get work bangumi:400602 --json
ani-resolver entity get character wikidata:Q104144455 --json
ani-resolver entity get work tmdb-tv:209867 --json
ani-resolver work characters bangumi:400602 --provider bangumi-archive --json
```

`tmdb-tv:<id>` and `tmdb-movie:<id>` preserve TMDB's separate TV and movie namespaces. Existing path tags such as `[tmdbid=262929]` and `{tmdb-262929}` are recognized, with media kind inferred when the path contains useful TV or movie evidence.

Successful commands emit JSON on stdout. Errors emit `ani-resolver.error.v1` JSON on stderr and use a nonzero exit code. `resolve` keeps multiple candidates unless unambiguous explicit work IDs identify one candidate; duplicate IDs from the same source remain separate possibilities. Scores are deterministic match scores, not statistical probabilities.

Every `resolve work`, `resolve character`, and `resolve image` command requires an explicit `--providers` selection. Use comma-separated IDs, or pass `--providers all` to intentionally run every loaded provider compatible with that operation. `all` cannot be combined with named providers. Unknown or statically incompatible providers fail before any provider request and return a structured error such as `unknown_provider` or `unsupported_provider_capability`.

Torrent and directory evidence reports `fileCount` plus up to eight representative paths by default. Add `--full-files` to `parse` or `resolve` only when every path is needed.

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

Run `ani-resolver provider list --json` for machine-readable capabilities, lifecycle status, strengths, limitations, languages, attribution, and authentication requirements. Provider code can be bundled while provider data still reports `needs_init`.

Bangumi Archive is indexed locally rather than queried from the ZIP. Download a dump ZIP from the [Bangumi Archive releases](https://github.com/bangumi/Archive/releases), then initialize it:

```bash
ani-resolver provider init bangumi-archive --archive /path/to/dump.zip --json
ani-resolver resolve work "Dungeon Meshi" --providers bangumi-archive --json
ani-resolver resolve character "精灵" --work bangumi:395378 --providers bangumi-archive --json
```

Initialization streams the dump into an anime-only SQLite FTS5 index. It retains related character text and work relations, but it cannot infer appearance traits absent from Archive text.

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

The experimental AstrBot plugin exposes seven constrained LLM tools for provider inspection, parsing, work, character, and image resolution, entity lookup, and work-character listing. It also bundles an AstrBot-native `resolve-anime-content` Skill that orchestrates those tools without depending on Codex or HAPI.

The plugin lives at `integrations/astrbot/astrbot_plugin_ani_resolver`. Mount the installed ani-resolver directory into the AstrBot container at the same path, read-only, then copy the plugin into AstrBot's persistent `data/plugins` directory:

```yaml
services:
  astrbot:
    volumes:
      - /srv/ani-resolver:/srv/ani-resolver:ro
```

The integration invokes the fixed `/srv/ani-resolver/bin/ani-resolver` executable with an argv array. It does not pass model input through a shell.

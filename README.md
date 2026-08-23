# ani-resolver

`ani-resolver` turns anime titles, release names, paths, torrent files, magnets, and character clues into ranked identity candidates with source evidence. It returns data; it does not download, rename, move, or delete files.

The project has two deliberately separate layers:

- The Node.js/TypeScript CLI parses input, queries providers, merges identities, and emits stable JSON.
- The bundled Skill teaches an AI agent to select providers, inspect several candidates, ask follow-up questions when needed, and hand the accepted identity to the user's own download or organization workflow.

## Requirements

- Node.js 24 or newer
- A descriptive project User-Agent for Bangumi, supplied by the built-in provider
- `TMDB_ACCESS_TOKEN` for TMDB search and detail requests

When the network requires a proxy, start Node with `NODE_USE_ENV_PROXY=1` and set `HTTPS_PROXY` to the user's proxy URL. A provider connection failure does not mean the title has no matches.

## Install

```bash
npm install
npm run build
npm link
```

## CLI

```bash
ani-resolver providers list --json
ani-resolver parse "[VCB-Studio] Sousou no Frieren [01][1080p].mkv" --json
ani-resolver resolve work "葬送的芙莉莲 (2023)" --top 5 --json
ani-resolver resolve character "艾拉" --providers bangumi --top 5 --json
ani-resolver resolve character "白发 双马尾" --work bangumi:400602 --top 5 --json
ani-resolver entity get work bangumi:400602 --json
ani-resolver entity get work tmdb-tv:209867 --json
ani-resolver work characters bangumi:400602 --json
```

`tmdb-tv:<id>` and `tmdb-movie:<id>` preserve TMDB's separate TV and movie namespaces. Existing path tags such as `[tmdbid=262929]` and `{tmdb-262929}` are recognized, with media kind inferred when the path contains useful TV or movie evidence.

Successful commands emit JSON on stdout. Errors emit `ani-resolver.error.v1` JSON on stderr and use a nonzero exit code. `resolve` keeps multiple candidates unless unambiguous explicit work IDs identify one candidate; duplicate IDs from the same source remain separate possibilities. Scores are deterministic match scores, not statistical probabilities.

Magnet parsing uses the full input in memory, but emitted evidence removes tracker and web-seed parameters that may contain private passkeys. Provider calls time out after 15 seconds by default so one stalled source cannot block the complete result.

## Providers

| Provider | Work search | Work detail | Character search | Work characters | Authentication |
| --- | --- | --- | --- | --- | --- |
| Bangumi API | yes | yes | yes | yes | optional |
| TMDB | yes | yes | no | no | required |

Run `ani-resolver providers list --json` for machine-readable capabilities, strengths, limitations, languages, attribution, and authentication requirements.

Bangumi character search is strongest for names and indexed text. A broad description such as "white hair, twin tails, expressionless early in the story" may be weak or ambiguous until a structured trait provider is added. The CLI reports what each source actually returned; the Skill owns clarification and conversational decisions.

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

Register provider instances when constructing `Resolver`, or add them to `createDefaultProviders` for CLI-wide availability. Provider failures are isolated and surfaced in `providerRuns`.

## Development

```bash
npm run check
npm test
npm run build
```

Tests use recorded fixtures and injected `fetch`; normal test runs do not call live APIs.

## Data Sources

- [Bangumi API](https://bangumi.github.io/api/)
- [TMDB API](https://developer.themoviedb.org/)

Provider data remains subject to its upstream terms and attribution requirements. This repository does not redistribute upstream datasets or images.

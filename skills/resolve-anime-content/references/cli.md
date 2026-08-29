# CLI Reference

## Setup

Use Node.js 24 or newer. With a local checkout:

```powershell
npm install
npm run build
node .\dist\cli.js provider list --json
```

Use `ani-resolver` instead of `node .\dist\cli.js` after `npm link` or package installation.

Set `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY`, then run `ani-resolver provider init tmdb --json` to save it in the OS credential store. SauceNAO requires `SAUCENAO_API_KEY` or `provider init saucenao --api-key`; `TRACE_MOE_API_KEY` is optional. `BANGUMI_ACCESS_TOKEN` is optional for public reads.

Node 24 can use an environment proxy when started with both settings:

```powershell
$env:NODE_USE_ENV_PROXY = "1"
$env:HTTPS_PROXY = "http://127.0.0.1:10809"
```

Use the user's actual proxy URL. A `providerRuns` entry with `status: unavailable` and a connection error is evidence to inspect network or proxy configuration, not evidence that no matching anime exists.

Provider calls have a 15-second default timeout. Magnet output omits tracker and web-seed parameters so private passkeys are not copied into logs or agent context.

## Commands

```text
ani-resolver provider list --json
ani-resolver provider install <catalog-provider> --json
ani-resolver provider install <local-directory> --trust-local --json
ani-resolver provider init tmdb --token <access-token> --json
ani-resolver provider init tmdb --api-key <api-key> --json
ani-resolver provider init saucenao --api-key <api-key> --json
ani-resolver provider init trace-moe --api-key <optional-api-key> --json
ani-resolver provider init bangumi-archive --archive <dump.zip> --json
ani-resolver parse <text-or-path-or-magnet> --json
ani-resolver resolve work <input> --top 5 --providers bangumi,tmdb --json
ani-resolver resolve character <input> --top 5 --providers wikidata,anilist,bangumi --json
ani-resolver resolve character <clue> --work bangumi:400602 --top 5 --json
ani-resolver resolve character "white hair twintails" --providers wikidata --top 5 --json
ani-resolver resolve image <frame.jpg> --providers trace-moe --top 5 --json
ani-resolver resolve image <artwork-url> --providers saucenao --top 5 --json
ani-resolver resolve image <character.png> --providers animetrace --top 5 --json
ani-resolver entity get work bangumi:400602 --provider bangumi-archive --json
ani-resolver entity get character bangumi:12080 --json
ani-resolver entity get character anilist:176754 --json
ani-resolver entity get character wikidata:Q104144455 --json
ani-resolver entity get work tmdb-tv:209867 --json
ani-resolver work characters bangumi:400602 --provider bangumi-archive --json
ani-resolver work characters anilist:154587 --provider anilist --json
```

Use `tmdb-tv:<id>` or `tmdb-movie:<id>` for details because TMDB has separate numeric namespaces. `bgm:<id>` is accepted as an alias for `bangumi:<id>`.

Bangumi API and Bangumi Archive share the `bangumi:<id>` namespace. Use `--provider bangumi-archive` on `entity get` or `work characters` when the local source is intended.

`provider init --json` never opens an interactive prompt. Missing setup values return `status: needs_input`, `required`, and `acceptedOptions`. Bangumi Archive initialization streams the dump ZIP into a local SQLite FTS5 index; the ZIP is not used as a query-time database.

## Resolve Output

- `query`: parsed input evidence and entity type.
- `query.fileCount`, `query.files`, and `query.filesTruncated`: compact file evidence; add `--full-files` when every path is required.
- `query.work`: the preserved work constraint for character resolution, when supplied.
- `candidates`: ranked normalized identities.
- `candidates[].score`: deterministic, uncalibrated match score.
- `candidates[].externalIds`: sourced identifiers, including TMDB when available.
- `candidates[].facts`: normalized provider facts; fields vary by provider.
- `candidates[].evidence`: why the candidate was returned and weighted.
- `candidates[].conflicts`: incompatible source assertions retained for review.
- `candidates[].sources`: providers represented in the merged candidate.
- `providerRuns`: one concise status per selected provider, including `itemCount`, errors, auth requirements, and elapsed time.

`facts.appearance` contains normalized traits when a provider exposes structured statements or useful profile text. Wikidata is the primary structured appearance source; AniList, Bangumi, and Bangumi Archive derive only the traits present in their text. Inspect `appearance_match` evidence and treat `missing` as absent evidence rather than a contradiction.

Successful commands write JSON to stdout. Errors write `ani-resolver.error.v1` JSON to stderr and return a nonzero exit code. An unknown provider is an error; `empty` means selected providers ran successfully but found no candidates.

## Image Output

- `schemaVersion`: `ani-resolver.image.v1`.
- `query`: redacted image evidence. URL credentials, query parameters, and fragments are omitted from output but retained for the provider request.
- `matches`: ordered provider-native results. `matchType` is `anime_scene`, `source`, or `character`.
- `matches[].similarity`: the provider's unchanged numeric similarity value.
- `matches[].similarityScale`: declares the native scale, such as `unit_interval` for trace.moe or `percent` for SauceNAO. Do not compare or combine values across providers.
- `matches[].facts`: scene timing and previews, source/creator metadata, or character boxes and work titles.
- AnimeTrace `rank` applies within each `facts.boxIndex`; different detected people are independent groups.
- `matches[].externalIds`: sourced IDs such as AniList, MAL, or Pixiv when the upstream result supplies them.
- `providerRuns`: isolated provider lifecycle and request status.

Local image input currently accepts JPEG and PNG files up to 20 MiB. Image providers receive the selected image or URL; disclose that third-party upload before invoking them. Agent workflows should pass an explicit provider selection rather than broadcasting an image by default.

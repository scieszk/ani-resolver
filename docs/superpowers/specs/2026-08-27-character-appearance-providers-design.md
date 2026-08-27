# Character Appearance Providers Design

## Goal

Add useful character-appearance lookup without embedding an AI model in the CLI. A query such as `女主 白发 双马尾 前期没什么表情` should produce several evidence-backed character candidates, normalized appearance facts, source IDs, and deterministic scores that an external agent can inspect and disambiguate.

## Source Decision

The first implementation uses two new bundled providers:

- **Wikidata** is the primary global appearance provider. It exposes structured hair color (`P1884`), eye color (`P1340`), hairstyle (`P8839`), gender (`P21`), clothing (`P3828`), work relations (`P1441`), and character identifiers for Bangumi (`P6296`), AniList (`P11736`), AniDB (`P5648`), and Anime Characters Database (`P7013`). Its structured data is CC0 and the public API does not require credentials.
- **AniList** supplies anime title matching, character descriptions, images, gender/age/blood type, and characters associated with a known AniList work. Its text is secondary evidence rather than a substitute for structured appearance data.

Anime Characters Database is not called directly in this phase. Its visual search is strong, but its documented robot API does not expose the visual filters and unattended requests are currently browser-challenged. AniDB is deferred because its official API requires a registered client, heavy caching, and strict request pacing.

## Normalized Appearance Model

`CharacterAppearance` is source-neutral and stored under `facts.appearance`:

```ts
interface CharacterAppearance {
  hairColors: string[];
  eyeColors: string[];
  hairStyles: string[];
  genders: string[];
  apparentAges: string[];
  clothing: string[];
  traits: string[];
}
```

The vocabulary maps common Chinese, Japanese, and English phrases to canonical English tokens. Initial coverage includes common anime hair and eye colors, twintails, ponytail, long/short hair, female/male, child/teen/adult, common clothing clues, and expressionless/stoic traits. Unrecognized prose remains available in source descriptions; the CLI does not invent a trait.

`parseAppearanceText` extracts normalized facts from either a user query or provider text. `scoreAppearanceMatch` compares query facts with candidate facts and returns a deterministic 0-1 coverage score plus matched and missing traits. Providers use that score as one ranking signal and expose matching evidence.

## Provider Behavior

### Wikidata

- Appearance queries become parameterized SPARQL built only from a fixed vocabulary of property and item IDs.
- At least one recognized structured trait is required for appearance SPARQL. Plain names use `wbsearchentities` followed by entity enrichment.
- Results include `wikidata:Q...` and available Bangumi/AniList/AniDB/ACDB character IDs.
- `facts.appearance` contains labels normalized back to the canonical vocabulary; raw Wikidata IDs remain in evidence.
- A Wikidata work ID can constrain results through `P1441`.
- Requests use a project User-Agent, bounded limits, and the existing HTTP timeout/status handling.

### AniList

- Work search returns AniList and MAL work IDs.
- Character name search returns AniList character IDs and descriptive facts.
- A known AniList work lists its character cast, then ranks characters against normalized appearance clues extracted from descriptions and profile fields.
- HTML in descriptions is reduced to plain text before matching and output.

### Existing Bangumi Providers

Bangumi API and Bangumi Archive candidates gain normalized `facts.appearance` extracted from existing summaries and infobox data. Work-scoped archive searches rank the full cast against appearance facts instead of requiring every clue token to appear in the FTS row. No archive rebuild is required for this enrichment.

## Agent Surface

Add `character_appearance_search` to provider capabilities. `provider list` remains the discovery mechanism. The generic and AstrBot skills instruct the agent to prefer Wikidata for global structured appearance clues, then use returned Bangumi/AniList IDs to fetch details or enumerate a known work cast.

AstrBot's external-ID validation accepts `anilist:<number>` and `wikidata:Q<number>` in addition to existing IDs. The six native AstrBot tools remain unchanged.

## Failure Handling

Each provider reports its own `ProviderRun` status. A Wikidata rate limit or AniList outage does not suppress candidates from other providers. Queries with no recognized appearance traits fall back to provider name/text search. The resolver continues returning multiple candidates and does not label deterministic scores as probabilities.

## Verification

- Unit tests cover multilingual trait normalization, score coverage, SPARQL safety, Wikidata result mapping, AniList GraphQL mapping, provider lifecycle, Bangumi enrichment, and AstrBot external IDs.
- Live smoke tests query `女主 白发 双马尾 前期没什么表情` and verify structured facts plus cross-source IDs without asserting one universally correct character.
- Deployment verification checks five ready providers, six registered AstrBot tools, read-only CLI mounting, and a real AstrBot-container query.


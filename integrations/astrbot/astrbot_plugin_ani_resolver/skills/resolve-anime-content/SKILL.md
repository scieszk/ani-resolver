---
name: resolve-anime-content
description: Use when a user wants AstrBot to identify, verify, download, rename, or organize anime from a title, release name, path, torrent, magnet, external ID, or character clue.
---

# Resolve Anime Content In AstrBot

Use Ani Resolver as the evidence and identity layer. Keep clarification, acquisition, naming, and file operations in the conversation or other tools.

## Workflow

1. Call `ani_resolver_provider_list` when provider capabilities or readiness are unknown. Select sources from declared capabilities. For a global visual clue, prefer a ready provider with `character_appearance_search`, especially Wikidata; do not assume TMDB supports character search.
2. Call `ani_resolver_parse` before acting on a release name, path, torrent, or magnet. Preserve season, episode, year, media kind, and explicit IDs as constraints.
3. Call `ani_resolver_resolve_work` with at least five candidates. Inspect candidate names, external IDs, evidence, conflicts, sources, and every `providerRuns` status. Scores are deterministic ranking signals, not statistical probabilities.
4. Continue without clarification only when identity is materially unambiguous. Otherwise ask one high-information question, add the answer to the next query, and resolve again. After three unproductive rounds, present the remaining uncertainty.
5. For a character clue, call `ani_resolver_resolve_character` and request several candidates. Compare `facts.appearance` with the user's traits and inspect `appearance_match` evidence, including `matched` and `missing`; missing source facts are missing evidence, not contradictions. When the work is known, pass a compatible `bangumi:<id>`, `anilist:<id>`, or `wikidata:Q<id>` constraint, or call `ani_resolver_work_characters`.
6. Call `ani_resolver_entity_get` when an explicit external ID needs upstream verification. Wikidata results may include `bangumi:<id>` and `anilist:<id>` bridges that can be inspected through those providers.
7. After the user accepts an identity, hand its sourced IDs to the available download or organization workflow. Show mappings before destructive or colliding file operations.

## Boundaries

- These tools identify content; they do not search torrent sites, download, rename, move, or delete files.
- Do not invent IDs when a provider is unavailable or reports an authentication error.
- Do not hide provider failures or collapse seasons, remakes, recap films, specials, and shorts that share a title.
- Wikidata appearance coverage varies, while AniList and Bangumi appearance matching is extracted from available text. Missing fields are missing evidence.
- Use the dedicated `ani_resolver_*` tools. Do not construct shell commands for Ani Resolver.

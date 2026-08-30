---
name: resolve-anime-content
description: Use when a user wants AstrBot to identify, verify, download, rename, or organize anime from a title, release name, path, torrent, magnet, external ID, character clue, or image.
---

# Resolve Anime Content In AstrBot

Use Ani Resolver as the evidence and identity layer. Keep clarification, acquisition, naming, and file operations in the conversation or other tools.

## Workflow

1. Call `ani_resolver_provider_list` when provider capabilities or readiness are unknown. Every resolve tool requires a non-empty `providers` value; select sources from declared capabilities, or use `all` only when querying every compatible source is intentional. For a global visual clue, prefer a ready provider with `character_appearance_search`, especially Wikidata; do not assume TMDB supports character search.
2. For an image, tell the user when it will be uploaded to a third-party provider, then call `ani_resolver_resolve_image` with a non-empty `providers` value. Leave `input` empty to use the current or replied message image, or pass an explicit HTTP(S) URL; never invent or pass a server-local path. Route an anime screenshot or episode/timestamp question to `anime_scene_lookup` (trace.moe), an original-source or creator question to `reverse_image_lookup` (SauceNAO), and a character-in-image question to `character_image_lookup` (AnimeTrace). Call several providers when the intent is genuinely mixed.
3. Treat image `similarity`, `similarityScale`, candidate order, and `notConfident` as provider-native signals, not one shared probability. AnimeTrace `rank` applies within one detected `boxIndex`, not across different people. Inspect multiple matches. Feed a returned `anilist:<id>`, work title, or character/work pair into the text tools when cross-source enrichment is useful.
4. Call `ani_resolver_inventory` for a downloaded directory, file set, or torrent before organizing it. Leave `input` empty to use a torrent attached to the current or replied message. Treat its season/episode groups, companion subtitles and audio, extras, and relative paths as a read-only manifest. Keep `full_files` false for discovery and request all paths only when building a concrete mapping. Use `ani_resolver_parse` when only release evidence is needed; it supports the same attached-torrent fallback.
5. Call `ani_resolver_resolve_work` with at least five candidates. Inspect `outcome` first: `matched` has usable results, `no_match` means selected providers completed without a match, `partial` combines evidence with failures, and `unavailable` means no provider completed. Never treat `partial` or `unavailable` as a confident no-match. Inspect candidate names, external IDs, evidence, conflicts, sources, and every `providerRuns` status.
6. Continue without clarification only when identity is materially unambiguous. Otherwise ask one high-information question, add the answer to the next query, and resolve again. After three unproductive rounds, present the remaining uncertainty.
7. For a character clue, extract only details the user actually stated into the structured `name`, `hair_colors`, `eye_colors`, `hair_styles`, `genders`, `apparent_ages`, `clothing`, and `traits` fields of `ani_resolver_resolve_character`; never put the prose description into `name`. Use normalized English tags such as `white`, `twintails`, `female`, and `expressionless`, and request several candidates. Compare `facts.appearance` with the user's traits and inspect `appearance_match` evidence, including `matched` and `missing`; missing source facts are missing evidence, not contradictions. When the work is known, pass a compatible `bangumi:<id>`, `anilist:<id>`, or `wikidata:Q<id>` constraint, or call `ani_resolver_work_characters`.
8. Call `ani_resolver_entity_get` when an explicit external ID needs upstream verification. After identity is accepted, call `ani_resolver_entity_relations` with all known IDs and compatible providers to merge related works, characters, and people. Wikidata results may include `bangumi:<id>` and `anilist:<id>` bridges that can be inspected through those providers.
9. Combine an accepted identity with the inventory and destination conventions. Produce a complete source-to-destination mapping, flag collisions and unassigned extras, and show it before another tool renames, moves, overwrites, or deletes files.

## Boundaries

- These tools identify content; they do not search torrent sites, download, rename, move, or delete files.
- `ani_resolver_inventory` is read-only; filesystem changes belong to another authorized tool.
- Do not invent IDs when a provider is unavailable or reports an authentication error.
- Do not hide that trace.moe, SauceNAO, and AnimeTrace send the selected image to their service.
- Do not hide provider failures or collapse seasons, remakes, recap films, specials, and shorts that share a title.
- Wikidata appearance coverage varies, while AniList and Bangumi appearance matching is extracted from available text. Missing fields are missing evidence.
- Use the dedicated `ani_resolver_*` tools. Do not construct shell commands for Ani Resolver.

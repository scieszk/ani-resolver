---
name: resolve-anime-content
description: Use when a user wants to identify, verify, download, rename, or organize anime from a title, release name, path, torrent, magnet, external ID, character clue, or image.
---

# Resolve Anime Content

## Overview

Use `ani-resolver` as the evidence and identity layer. Let the CLI parse inputs, query providers, and rank candidates; keep conversation, clarification, acquisition, naming, and file operations in the agent workflow.

Read [references/cli.md](references/cli.md) when command syntax, environment setup, or output fields are needed.

Respect authorization already present in the conversation. If the user has approved installing or selecting a compatible runtime, do not ask again; use an existing Node.js 24 runtime when one is available before proposing an installation.

## Workflow

1. Run `ani-resolver provider list --json` when available providers are unknown. Every resolve command requires an explicit `--providers` selection; choose providers whose declared capabilities and lifecycle status fit the request, or use `all` only when querying every compatible source is intentional. For a global visual clue, prefer a ready provider with `character_appearance_search`, especially Wikidata. Do not assume every provider supports characters or TMDB IDs. When a useful provider reports `needs_init`, explain the required setup instead of pretending it ran.
2. For an image, disclose that the selected file will be sent to a third-party provider, then use `resolve image` with an explicit `--providers` selection. Route an anime screenshot or episode/timestamp question to `anime_scene_lookup` (trace.moe), an original-source or creator question to `reverse_image_lookup` (SauceNAO), and a character-in-image question to `character_image_lookup` (AnimeTrace). Run more than one only when the intent is mixed or the first result is insufficient.
3. Keep image `similarity`, `similarityScale`, candidate order, and `notConfident` in their provider-native meaning; never combine them into one probability. AnimeTrace `rank` is a candidate rank within one detected `boxIndex`, not a global ranking across people. Inspect several matches. Feed returned `anilist:<id>`, work titles, or character/work pairs into work or character resolution when cross-source IDs and details are useful.
4. For a downloaded directory, file set, or torrent, run `inventory --json` before organizing it. Use its season/episode groups, companion subtitles and audio, extras, and relative paths as the file manifest. The command is read-only. Keep compact output for discovery and use `--full-files` only when every path is needed for a concrete mapping. Use `parse` for a single release name, path, or magnet when a full inventory is unnecessary.
5. Resolve a work with at least the top five candidates. Keep Bangumi and TMDB IDs when returned. Treat `score` as an uncalibrated match score, not a probability.
6. Inspect `outcome` before candidates: `matched` has usable results, `no_match` means selected providers completed without a match, `partial` means evidence and provider failures coexist, and `unavailable` means no provider completed. Never turn `partial` or `unavailable` into a confident no-match. Inspect every leading candidate, its evidence, conflicts, source coverage, and `providerRuns`.
7. Continue without clarification only when the identity is materially unambiguous. For explicit IDs, use `entity get` for upstream verification and `entity relations` to enrich an accepted work or character with related works, characters, and people.
8. When uncertain, compare candidates yourself and ask one concrete, high-information question at a time. Add the answer to the next query and resolve again. Allow "I do not remember"; after three unproductive rounds, present the remaining candidates and uncertainty instead of forcing a choice.
9. For a character name or clue, extract only explicit details into `--name`, `--hair-color`, `--eye-color`, `--hair-style`, `--gender`, `--apparent-age`, `--clothing`, and `--trait`; do not pass the original prose as a pseudo-search query. Use character-capable providers and return several candidates. Compare `facts.appearance` and `appearance_match` evidence, including `matched` and `missing`, against the user's wording. Prefer Wikidata or an initialized `bangumi-archive` for global structured appearance conditions. When a work is known, pass a compatible `--work <id>` or inspect `work characters`. Follow returned `bangumi:<id>` and `anilist:<id>` bridges when more detail is useful. The CLI does not extract natural language or generate follow-up questions.
10. After identity is accepted, combine the inventory with the user's downloader, naming rules, and destination conventions. Produce a complete source-to-destination mapping, flag collisions and unassigned extras, and show it before any filesystem tool renames, moves, overwrites, or deletes files.

## Boundaries

- Do not claim the CLI searches torrents or downloads content. Use another available tool for acquisition.
- Do not claim `inventory` changes files. File operations belong to the surrounding agent workflow and require an explicit reviewed mapping.
- Do not hide that trace.moe, SauceNAO, and AnimeTrace upload or fetch the selected image through their service.
- Do not invent a TMDB ID when TMDB is unavailable; report `auth_required` and continue with sourced IDs that were actually returned.
- Do not treat TMDB cast credits as anime character records.
- Do not drop an unsupported `--work` constraint. Resolve or map it to an ID accepted by a character-capable provider.
- Do not silently collapse seasons, remakes, recap films, specials, and web shorts that share a title.
- Do not claim AniList, Bangumi, or Archive contains structured appearance traits when a match only came from free text. Treat missing source text or Wikidata fields as missing evidence.
- Do not require another confirmation after the user has already authorized a clear, reversible step; ask when identity, source selection, naming, overwrite, or deletion remains materially ambiguous.

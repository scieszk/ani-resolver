import { AniListProvider } from "./anilist.js";
import { AnimeTraceProvider } from "./animetrace.js";
import { BangumiProvider } from "./bangumi.js";
import { SauceNaoProvider } from "./saucenao.js";
import { TmdbProvider } from "./tmdb.js";
import { TraceMoeProvider } from "./trace-moe.js";
import { WikidataProvider } from "./wikidata.js";

export { AniListProvider } from "./anilist.js";
export { AnimeTraceProvider } from "./animetrace.js";
export { BangumiArchiveProvider, bangumiArchiveManifest } from "./bangumi-archive.js";
export { BangumiProvider } from "./bangumi.js";
export { SauceNaoProvider } from "./saucenao.js";
export { TmdbProvider } from "./tmdb.js";
export { TraceMoeProvider } from "./trace-moe.js";
export { WikidataProvider } from "./wikidata.js";

export function createDefaultProviders() {
  return [
    new BangumiProvider(),
    new TmdbProvider(),
    new AniListProvider(),
    new WikidataProvider(),
    new TraceMoeProvider(),
    new SauceNaoProvider(),
    new AnimeTraceProvider(),
  ];
}

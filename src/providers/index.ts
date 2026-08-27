import { AniListProvider } from "./anilist.js";
import { BangumiProvider } from "./bangumi.js";
import { TmdbProvider } from "./tmdb.js";
import { WikidataProvider } from "./wikidata.js";

export { AniListProvider } from "./anilist.js";
export { BangumiArchiveProvider, bangumiArchiveManifest } from "./bangumi-archive.js";
export { BangumiProvider } from "./bangumi.js";
export { TmdbProvider } from "./tmdb.js";
export { WikidataProvider } from "./wikidata.js";

export function createDefaultProviders() {
  return [new BangumiProvider(), new TmdbProvider(), new AniListProvider(), new WikidataProvider()];
}

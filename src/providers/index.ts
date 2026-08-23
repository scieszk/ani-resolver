import { BangumiProvider } from "./bangumi.js";
import { TmdbProvider } from "./tmdb.js";

export { BangumiArchiveProvider, bangumiArchiveManifest } from "./bangumi-archive.js";
export { BangumiProvider } from "./bangumi.js";
export { TmdbProvider } from "./tmdb.js";

export function createDefaultProviders() {
  return [new BangumiProvider(), new TmdbProvider()];
}

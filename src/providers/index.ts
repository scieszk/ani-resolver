import { BangumiProvider } from "./bangumi.js";
import { TmdbProvider } from "./tmdb.js";

export { BangumiProvider } from "./bangumi.js";
export { TmdbProvider } from "./tmdb.js";

export function createDefaultProviders() {
  return [new BangumiProvider(), new TmdbProvider()];
}

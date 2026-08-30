import type { ProviderRelatedEntity, ProviderRunSummary } from "../types.js";

export interface FavoriteContext {
  works: ProviderRelatedEntity[];
  characters: ProviderRelatedEntity[];
  people: ProviderRelatedEntity[];
  providerRuns: ProviderRunSummary[];
  refreshedAt: string;
}

export function emptyFavoriteContext(): FavoriteContext {
  return {
    works: [],
    characters: [],
    people: [],
    providerRuns: [],
    refreshedAt: new Date().toISOString(),
  };
}

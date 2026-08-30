export { parseContentInput } from "./input.js";
export {
  CHARACTER_APPEARANCE_OPTIONS,
  emptyAppearance,
  expandAppearanceValues,
  hasAppearanceFacts,
  normalizeAppearance,
  parseAppearanceInput,
  parseAppearanceText,
  scoreAppearanceMatch,
} from "./appearance.js";
export type { AppearanceField } from "./appearance.js";
export { KeyringCredentialStore } from "./credentials.js";
export { parseImageInput, publicImageEvidence } from "./image-input.js";
export { ImageResolver } from "./image-resolver.js";
export { ProviderHost, ProviderRegistryService } from "./provider-host.js";
export { ProviderManager, validateProviderPackageManifest } from "./provider-management.js";
export {
  ProviderSelectionError,
  selectProvidersForOperation,
} from "./provider-selection.js";
export { Resolver, normalizeName } from "./resolver.js";
export {
  BangumiArchiveProvider,
  bangumiArchiveManifest,
  buildBangumiArchiveIndex,
} from "./providers/bangumi-archive.js";
export {
  AnimeTraceProvider,
  BangumiProvider,
  AniListProvider,
  SauceNaoProvider,
  TmdbProvider,
  TraceMoeProvider,
  WikidataProvider,
  createDefaultProviders,
} from "./providers/index.js";
export type { CredentialStore } from "./credentials.js";
export type { ProviderContext, ProviderPlugin } from "./provider-host.js";
export type {
  ProviderInitOptions,
  ProviderInitResult,
  ProviderLifecycleStatus,
  ProviderListItem,
  ProviderManagerOptions,
  ProviderModuleLoader,
  ProviderPackageManifest,
} from "./provider-management.js";
export type {
  ProviderOperation,
  ProviderSelectionErrorCode,
  ProviderSelectionErrorDetails,
} from "./provider-selection.js";
export type * from "./types.js";

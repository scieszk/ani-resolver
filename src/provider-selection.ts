import type { Provider, ProviderCapability } from "./types.js";

export type ProviderOperation =
  | "resolve.work"
  | "resolve.character"
  | "resolve.image"
  | "entity.relations";

export type ProviderSelectionErrorCode =
  | "missing_provider_selection"
  | "invalid_provider_selection"
  | "unknown_provider"
  | "provider_not_ready"
  | "unsupported_provider_capability";

export interface ProviderSelectionErrorDetails {
  operation: ProviderOperation;
  providers: string[];
  requiredCapabilities: ProviderCapability[];
  compatibleProviders: string[];
  providerStatuses?: Array<{ id: string; status: string }>;
}

export class ProviderSelectionError extends Error {
  readonly name = "ProviderSelectionError";

  constructor(
    readonly code: ProviderSelectionErrorCode,
    message: string,
    readonly details: ProviderSelectionErrorDetails,
  ) {
    super(message);
  }
}

const operationCapabilities: Record<ProviderOperation, ProviderCapability[]> = {
  "resolve.work": ["work_search"],
  "resolve.character": ["character_search"],
  "resolve.image": [
    "anime_scene_lookup",
    "reverse_image_lookup",
    "character_image_lookup",
  ],
  "entity.relations": ["entity_relations"],
};

const operationLabels: Record<ProviderOperation, string> = {
  "resolve.work": "work search",
  "resolve.character": "character search",
  "resolve.image": "image lookup",
  "entity.relations": "entity relation lookup",
};

export function selectProvidersForOperation(
  providers: Iterable<Provider>,
  ids: string[] | undefined,
  operation: ProviderOperation,
): Provider[] {
  const available = [...providers];
  const requiredCapabilities = operationCapabilities[operation];
  const operationLabel = operationLabels[operation];
  const compatible = available.filter((provider) => supportsOperation(provider, operation));
  const compatibleProviders = compatible.map((provider) => provider.manifest.id);
  const selectedIds = [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))];
  const details = (selected: string[]): ProviderSelectionErrorDetails => ({
    operation,
    providers: selected,
    requiredCapabilities,
    compatibleProviders,
  });

  if (selectedIds.length === 0) {
    throw new ProviderSelectionError(
      "missing_provider_selection",
      `Provider selection is required for ${operationLabel}. Pass --providers <ids> or --providers all.`,
      details([]),
    );
  }

  if (selectedIds.includes("all")) {
    if (selectedIds.length > 1) {
      throw new ProviderSelectionError(
        "invalid_provider_selection",
        "Provider selector 'all' cannot be combined with named providers.",
        details(selectedIds),
      );
    }
    if (compatible.length === 0) {
      throw new ProviderSelectionError(
        "unsupported_provider_capability",
        `No loaded provider supports ${operationLabel}. Run ani-resolver provider list --json to inspect capabilities.`,
        details(["all"]),
      );
    }
    return compatible;
  }

  const byId = new Map(available.map((provider) => [provider.manifest.id, provider]));
  const unknown = selectedIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new ProviderSelectionError(
      "unknown_provider",
      `Unknown provider${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Run ani-resolver provider list --json to inspect available providers.`,
      details(unknown),
    );
  }

  const incompatible = selectedIds.filter((id) => !supportsOperation(byId.get(id)!, operation));
  if (incompatible.length > 0) {
    const subject = incompatible.length === 1 ? "Provider" : "Providers";
    const verb = incompatible.length === 1 ? "does" : "do";
    throw new ProviderSelectionError(
      "unsupported_provider_capability",
      `${subject} ${incompatible.join(", ")} ${verb} not support ${operationLabel}. Compatible providers: ${compatibleProviders.join(", ") || "none"}.`,
      details(incompatible),
    );
  }

  return selectedIds.map((id) => byId.get(id)!);
}

function supportsOperation(provider: Provider, operation: ProviderOperation): boolean {
  const capabilities = provider.manifest.capabilities;
  if (operation === "resolve.work") {
    return capabilities.includes("work_search") && Boolean(provider.searchWorks);
  }
  if (operation === "resolve.character") {
    return capabilities.includes("character_search") && Boolean(provider.searchCharacters);
  }
  if (operation === "entity.relations") {
    return capabilities.includes("entity_relations") && Boolean(provider.listEntityRelations);
  }
  return (
    operationCapabilities[operation].some((capability) => capabilities.includes(capability)) &&
    Boolean(provider.searchImage)
  );
}

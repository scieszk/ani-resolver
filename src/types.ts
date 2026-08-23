export type EntityType = "work" | "character";
export type MediaType = "anime";
export type MediaKind = "tv" | "movie" | "ova" | "web" | "unknown";
export type ProviderCapability =
  | "work_search"
  | "work_detail"
  | "character_search"
  | "character_detail"
  | "work_characters"
  | "id_mapping"
  | "episodes";
export type ProviderStatus =
  | "ok"
  | "empty"
  | "unsupported"
  | "rate_limited"
  | "auth_required"
  | "unavailable"
  | "invalid_response"
  | "policy_blocked";

export interface ExternalId {
  source: string;
  id: string;
  mediaKind?: MediaKind;
}

export interface SourceEvidence {
  provider: string;
  kind: string;
  value: unknown;
  weight: number;
}

export interface Conflict {
  field: string;
  values: unknown[];
  providers: string[];
}

export interface ProviderManifest {
  id: string;
  label: string;
  mediaTypes: MediaType[];
  capabilities: ProviderCapability[];
  languages: string[];
  auth: "none" | "optional" | "required";
  strengths: string[];
  limitations: string[];
  homepage?: string;
  attribution?: string;
}

export interface ResolveQuery {
  entityType: EntityType;
  text: string;
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  mediaKind?: MediaKind;
  work?: ExternalId;
  limit: number;
}

export interface ProviderCandidate {
  entityType: EntityType;
  provider: string;
  providerId: string;
  names: string[];
  externalIds: ExternalId[];
  mediaKind?: MediaKind;
  year?: number;
  providerScore: number;
  facts: Record<string, unknown>;
  evidence: SourceEvidence[];
}

export interface ProviderRun<T = ProviderCandidate> {
  provider: string;
  status: ProviderStatus;
  items: T[];
  message?: string;
  elapsedMs?: number;
}

export interface ProviderRunSummary {
  provider: string;
  status: ProviderStatus;
  itemCount: number;
  message?: string;
  elapsedMs?: number;
}

export interface Provider {
  readonly manifest: ProviderManifest;
  searchWorks?(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>>;
  searchCharacters?(query: ResolveQuery): Promise<ProviderRun<ProviderCandidate>>;
  getEntity?(id: ExternalId, entityType: EntityType): Promise<ProviderRun<ProviderCandidate>>;
  listWorkCharacters?(work: ExternalId): Promise<ProviderRun<ProviderCandidate>>;
}

export interface ContentEvidence {
  kind: "text" | "release_name" | "path" | "torrent" | "magnet";
  raw: string;
  display: string;
  title: string;
  year: number | undefined;
  season: number | undefined;
  episode: number | undefined;
  mediaKind: MediaKind | undefined;
  externalIds: ExternalId[];
  files: string[];
}

export interface ResolveRequest {
  entityType: EntityType;
  input: string;
  limit?: number;
  providers?: string[];
  work?: ExternalId;
}

export interface ResolvedCandidate {
  key: string;
  entityType: EntityType;
  score: number;
  names: string[];
  externalIds: ExternalId[];
  mediaKind?: MediaKind;
  year?: number;
  facts: Record<string, unknown>;
  evidence: SourceEvidence[];
  conflicts: Conflict[];
  sources: string[];
}

export interface ResolveResult {
  schemaVersion: "ani-resolver.resolve.v1";
  query: ContentEvidence & { entityType: EntityType; work?: ExternalId };
  candidates: ResolvedCandidate[];
  providerRuns: ProviderRunSummary[];
}

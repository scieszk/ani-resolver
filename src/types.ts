export type EntityType = "work" | "character";
export type MediaType = "anime";
export type MediaKind = "tv" | "movie" | "ova" | "web" | "unknown";
export type ProviderCapability =
  | "work_search"
  | "work_detail"
  | "character_search"
  | "character_appearance_search"
  | "character_detail"
  | "work_characters"
  | "entity_relations"
  | "id_mapping"
  | "episodes"
  | "anime_scene_lookup"
  | "reverse_image_lookup"
  | "character_image_lookup";
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

export interface CharacterAppearance {
  hairColors: string[];
  eyeColors: string[];
  hairStyles: string[];
  genders: string[];
  apparentAges: string[];
  clothing: string[];
  traits: string[];
}

export interface AppearanceMatch {
  score: number;
  matched: string[];
  missing: string[];
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
  appearance?: CharacterAppearance;
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

export type RelatedEntityType = EntityType | "person";

export interface ProviderRelatedEntity {
  entityType: RelatedEntityType;
  provider: string;
  providerId: string;
  names: string[];
  externalIds: ExternalId[];
  image?: string;
  mediaKind?: MediaKind;
  year?: number;
  relation?: string;
  facts: Record<string, unknown>;
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
  searchImage?(query: ImageQuery): Promise<ProviderRun<ImageMatch>>;
  getEntity?(id: ExternalId, entityType: EntityType): Promise<ProviderRun<ProviderCandidate>>;
  listWorkCharacters?(work: ExternalId): Promise<ProviderRun<ProviderCandidate>>;
  listEntityRelations?(
    id: ExternalId,
    entityType: EntityType,
  ): Promise<ProviderRun<ProviderRelatedEntity>>;
}

export type ImageMatchType = "anime_scene" | "source" | "character";
export type ImageSimilarityScale = "unit_interval" | "percent";

export interface ImageMatchEvidence {
  provider: string;
  kind: string;
  value: unknown;
}

export interface ProviderImageInput {
  kind: "file" | "url";
  source: string;
  display: string;
  fileName?: string;
  mimeType?: "image/jpeg" | "image/png";
  size?: number;
}

export interface ImageEvidence {
  kind: ProviderImageInput["kind"];
  display: string;
  mimeType?: ProviderImageInput["mimeType"];
  size?: number;
}

export interface ImageQuery {
  input: ProviderImageInput;
  limit: number;
}

export interface ImageMatch {
  provider: string;
  providerId: string;
  matchType: ImageMatchType;
  rank: number;
  similarity?: number;
  similarityScale?: ImageSimilarityScale;
  names: string[];
  externalIds: ExternalId[];
  facts: Record<string, unknown>;
  evidence: ImageMatchEvidence[];
}

export interface ImageResolveRequest {
  input: string;
  limit?: number;
  providers: string[];
}

export interface ImageResolveResult {
  schemaVersion: "ani-resolver.image.v1";
  query: ImageEvidence;
  matches: ImageMatch[];
  providerRuns: ProviderRunSummary[];
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
  appearance?: Partial<CharacterAppearance>;
  limit?: number;
  providers: string[];
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
  query: ContentEvidence & {
    entityType: EntityType;
    work?: ExternalId;
    appearance?: CharacterAppearance;
  };
  candidates: ResolvedCandidate[];
  providerRuns: ProviderRunSummary[];
}

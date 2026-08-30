export type WebRunTarget = "auto" | "work" | "character" | "image";
export type WebResolvedTarget = Exclude<WebRunTarget, "auto">;

export interface WebExternalId {
  source: string;
  id: string;
  mediaKind?: "tv" | "movie" | "ova" | "web" | "unknown";
}

export interface WebCharacterAppearance {
  hairColors: string[];
  eyeColors: string[];
  hairStyles: string[];
  genders: string[];
  apparentAges: string[];
  clothing: string[];
  traits: string[];
}

export interface WebRunQuery {
  appearance?: WebCharacterAppearance;
  work?: WebExternalId;
}

export interface WebAttachment {
  id: string;
  runId: string;
  fileName: string;
  mimeType: string;
  kind: "image" | "torrent";
  size: number;
  stored: boolean;
  createdAt: string;
  purgedAt?: string;
}

export interface WebRun {
  id: string;
  input: string;
  requestedTarget: WebRunTarget;
  resolvedTarget: WebResolvedTarget;
  status: "pending" | "completed" | "failed";
  providers: string[];
  query?: WebRunQuery;
  result?: unknown;
  error?: string;
  attachments: WebAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface WebFavorite {
  id: string;
  entityKey: string;
  entityType: string;
  title: string;
  image?: string;
  candidate: unknown;
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebProvider {
  id: string;
  label: string;
  mediaTypes: string[];
  capabilities: string[];
  languages: string[];
  auth: "none" | "optional" | "required";
  strengths: string[];
  limitations: string[];
  homepage?: string;
  attribution?: string;
  installed: boolean;
  initialized: boolean;
  status: "ready" | "needs_init" | "unavailable";
  distribution: "bundled" | "local";
  dataVersion?: string;
}

export interface StorageStats {
  bytesUsed: number;
  maxBytes: number;
  storedAttachments: number;
  totalAttachments: number;
  runs: number;
}

export interface CleanupStats extends StorageStats {
  purgedAttachments: number;
  deletedRuns: number;
  bytesFreed: number;
}

export interface CreateWebRunInput {
  input: string;
  target: WebResolvedTarget;
  providers: string[];
  attachments: File[];
  appearance?: WebCharacterAppearance;
  work?: WebExternalId;
}

export interface AniResolverApi {
  listRuns(query?: string): Promise<{ items: WebRun[]; total: number }>;
  getRun(id: string): Promise<WebRun | null>;
  createRun(input: CreateWebRunInput): Promise<WebRun>;
  deleteRun(id: string): Promise<void>;
  listFavorites(query?: string, entityType?: string): Promise<{ items: WebFavorite[]; total: number }>;
  saveFavorite(runId: string, candidateKey: string): Promise<WebFavorite>;
  deleteFavorite(id: string): Promise<void>;
  listProviders(): Promise<{ items: WebProvider[] }>;
  getStorage(): Promise<StorageStats>;
  cleanupStorage(): Promise<CleanupStats>;
}

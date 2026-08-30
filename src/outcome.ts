import type { ProviderRunSummary, ResolutionOutcome } from "./types.js";

const COMPLETED_STATUSES = new Set(["ok", "empty"]);

export function deriveResolutionOutcome(
  itemCount: number,
  providerRuns: ProviderRunSummary[],
): ResolutionOutcome {
  if (providerRuns.length === 0) return itemCount > 0 ? "matched" : "no_match";

  const completed = providerRuns.filter((run) => COMPLETED_STATUSES.has(run.status)).length;
  const incomplete = providerRuns.length - completed;

  if (itemCount > 0) return incomplete > 0 ? "partial" : "matched";
  if (completed === 0) return "unavailable";
  return incomplete > 0 ? "partial" : "no_match";
}

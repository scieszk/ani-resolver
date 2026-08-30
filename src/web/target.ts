export type RunTarget = "auto" | "work" | "character" | "image";
export type ResolvedRunTarget = Exclude<RunTarget, "auto">;
export type AttachmentKind = "image" | "torrent";

export interface ResolutionAttachment {
  kind: AttachmentKind;
  path: string;
}

export interface TargetInput {
  input: string;
  attachments: ResolutionAttachment[];
}

const characterClues =
  /(?:角色|人物|女主|男主|发色|髮色|白发|白髮|双马尾|雙馬尾|眼睛|瞳色|服装|服裝|表情|性格|character|heroine|protagonist|hair|eyes|outfit)/iu;
const releaseClues =
  /(?:\[[^\]]+\]|\b(?:1080p|2160p|hevc|avc|x26[45]|bdrip|webrip|web-dl|s\d{1,2}|e\d{1,3})\b|magnet:\?xt=|\.torrent$)/iu;

export function inferRunTarget(input: TargetInput): ResolvedRunTarget {
  if (input.attachments.some((attachment) => attachment.kind === "image")) return "image";
  if (input.attachments.some((attachment) => attachment.kind === "torrent")) return "work";
  if (characterClues.test(input.input)) return "character";
  if (releaseClues.test(input.input)) return "work";
  return "work";
}

export function selectResolutionInput(options: TargetInput & { target: ResolvedRunTarget }): string {
  const preferredKind = options.target === "image" ? "image" : options.target === "work" ? "torrent" : undefined;
  if (preferredKind) {
    const attachment = options.attachments.find((item) => item.kind === preferredKind);
    if (attachment) return attachment.path;
  }
  if (options.input.trim()) return options.input.trim();
  return "";
}

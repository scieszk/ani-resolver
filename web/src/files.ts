const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TORRENT_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 4;

export interface AttachmentLike {
  name: string;
  type: string;
  size: number;
}

export interface RejectedAttachment {
  name: string;
  reason: string;
}

export function validateAttachments<T extends AttachmentLike>(files: T[]): {
  accepted: T[];
  rejected: RejectedAttachment[];
} {
  const accepted: T[] = [];
  const rejected: RejectedAttachment[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    const torrent =
      file.type === "application/x-bittorrent" || file.name.toLowerCase().endsWith(".torrent");
    const image = file.type === "image/jpeg" || file.type === "image/png";
    if (!torrent && !image) {
      rejected.push({
        name: file.name,
        reason: "Only JPEG, PNG, and torrent files are supported",
      });
      continue;
    }
    const limit = torrent ? MAX_TORRENT_BYTES : MAX_IMAGE_BYTES;
    if (file.size > limit) {
      rejected.push({
        name: file.name,
        reason: torrent ? "Torrent files are limited to 2 MiB" : "Images are limited to 20 MiB",
      });
      continue;
    }
    accepted.push(file);
  }
  if (files.length > MAX_FILES) {
    for (const file of files.slice(MAX_FILES)) {
      rejected.push({ name: file.name, reason: "A run accepts up to 4 attachments" });
    }
  }
  return { accepted, rejected };
}

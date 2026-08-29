import { readFile } from "node:fs/promises";

import { z } from "zod";

import { providerUploadFileName } from "../image-input.js";
import type {
  ImageMatch,
  ImageQuery,
  Provider,
  ProviderManifest,
  ProviderRun,
} from "../types.js";
import { requestJson } from "./http.js";

const characterSchema = z.object({ work: z.string(), character: z.string() }).passthrough();
const boxSchema = z
  .object({
    box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    box_id: z.string(),
    not_confident: z.boolean(),
    character: z.array(characterSchema),
  })
  .passthrough();
const responseSchema = z
  .object({
    code: z.number().int(),
    message: z.string().optional(),
    ai: z.boolean().optional(),
    trace_id: z.string().optional(),
    data: z.array(boxSchema),
  })
  .passthrough();
const errorResponseSchema = z
  .object({ code: z.number().int(), message: z.string().optional() })
  .passthrough();

const SUCCESS_CODES = new Set([0, 200, 17720]);
const RATE_LIMIT_CODES = new Set([17728]);
const UNAVAILABLE_CODES = new Set([17702, 17704, 17706, 17707, 17722, 17731]);
const USER_AGENT = "ani-resolver/0.1.0 (https://github.com/scieszk/ani-resolver)";

export interface AnimeTraceProviderOptions {
  fetcher?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
}

export class AnimeTraceProvider implements Provider {
  readonly manifest: ProviderManifest = {
    id: "animetrace",
    label: "AnimeTrace",
    mediaTypes: ["anime"],
    capabilities: ["character_image_lookup"],
    languages: ["ja", "zh", "en"],
    auth: "none",
    strengths: ["Anime and Galgame character recognition", "Multiple character boxes", "Ranked character candidates"],
    limitations: ["Uploads the query image", "Character names and work titles are not stable external IDs"],
    homepage: "https://www.animetrace.com/",
    attribution: "Character recognition by AnimeTrace",
  };

  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(options: AnimeTraceProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.animetrace.com/v1/search";
    this.userAgent = options.userAgent ?? USER_AGENT;
  }

  async searchImage(query: ImageQuery): Promise<ProviderRun<ImageMatch>> {
    const form = new FormData();
    form.set("is_multi", "1");
    form.set("ai_detect", "1");
    if (query.input.kind === "url") {
      form.set("url", query.input.source);
    } else {
      const bytes = new Uint8Array(await readFile(query.input.source));
      form.set(
        "file",
        new Blob([bytes], { type: query.input.mimeType ?? "application/octet-stream" }),
        providerUploadFileName(query.input),
      );
    }

    const response = await requestJson(this.manifest.id, this.fetcher, this.baseUrl, {
      method: "POST",
      headers: { accept: "application/json", "user-agent": this.userAgent },
      body: form,
    });
    if (!response.ok) {
      const errorResponse = errorResponseSchema.safeParse(response.data);
      return errorResponse.success
        ? failedRun(this.manifest.id, errorResponse.data.code, errorResponse.data.message)
        : { ...response.run, items: [] };
    }
    const parsed = responseSchema.safeParse(response.data);
    if (!parsed.success) return invalidResponse(this.manifest.id, parsed.error.message);
    if (!SUCCESS_CODES.has(parsed.data.code)) {
      return failedRun(this.manifest.id, parsed.data.code, parsed.data.message);
    }

    const items: ImageMatch[] = [];
    for (let candidateIndex = 0; items.length < query.limit; candidateIndex += 1) {
      let foundCandidate = false;
      for (const [boxIndex, box] of parsed.data.data.entries()) {
        const character = box.character[candidateIndex];
        if (!character) continue;
        foundCandidate = true;
        items.push({
          provider: this.manifest.id,
          providerId: `${box.box_id}:${candidateIndex + 1}`,
          matchType: "character",
          rank: candidateIndex + 1,
          names: [character.character],
          externalIds: [],
          facts: {
            work: character.work,
            box: box.box,
            boxId: box.box_id,
            boxIndex: boxIndex + 1,
            candidateRank: candidateIndex + 1,
            notConfident: box.not_confident,
            aiGenerated: parsed.data.ai ?? null,
            traceId: parsed.data.trace_id ?? null,
          },
          evidence: [
            {
              provider: this.manifest.id,
              kind: "provider_rank",
              value: {
                boxIndex: boxIndex + 1,
                candidateRank: candidateIndex + 1,
                notConfident: box.not_confident,
              },
            },
          ],
        });
        if (items.length >= query.limit) break;
      }
      if (!foundCandidate) break;
    }
    return { provider: this.manifest.id, status: items.length ? "ok" : "empty", items };
  }
}

function invalidResponse(provider: string, message: string): ProviderRun<ImageMatch> {
  return { provider, status: "invalid_response", items: [], message };
}

function failedRun(
  provider: string,
  code: number,
  message = `AnimeTrace status ${code}`,
): ProviderRun<ImageMatch> {
  const status = RATE_LIMIT_CODES.has(code)
    ? "rate_limited"
    : UNAVAILABLE_CODES.has(code)
      ? "unavailable"
      : "invalid_response";
  return { provider, status, items: [], message };
}

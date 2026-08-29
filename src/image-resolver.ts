import { parseImageInput, publicImageEvidence } from "./image-input.js";
import { selectProvidersForOperation } from "./provider-selection.js";
import type {
  ImageMatch,
  ImageQuery,
  ImageResolveRequest,
  ImageResolveResult,
  Provider,
  ProviderRun,
} from "./types.js";

export class ImageResolver {
  private readonly providers: Map<string, Provider>;
  private readonly providerTimeoutMs: number;

  constructor(providers: Provider[], options: { providerTimeoutMs?: number } = {}) {
    const duplicate = providers.find(
      (provider, index) =>
        providers.findIndex((candidate) => candidate.manifest.id === provider.manifest.id) !== index,
    );
    if (duplicate) throw new Error(`Duplicate provider ID: ${duplicate.manifest.id}`);
    this.providers = new Map(providers.map((provider) => [provider.manifest.id, provider]));
    this.providerTimeoutMs = Math.max(1, options.providerTimeoutMs ?? 15_000);
  }

  async resolve(request: ImageResolveRequest): Promise<ImageResolveResult> {
    const providers = selectProvidersForOperation(
      this.providers.values(),
      request.providers,
      "resolve.image",
    );
    const input = await parseImageInput(request.input);
    const limit = Math.max(1, Math.min(request.limit ?? 5, 50));
    const query: ImageQuery = { input, limit };
    const runs = await Promise.all(
      providers.map((provider) => runProvider(provider, query, this.providerTimeoutMs)),
    );
    const publicRuns = runs.map((run) => redactRunMessage(run, input));

    return {
      schemaVersion: "ani-resolver.image.v1",
      query: publicImageEvidence(input),
      matches: publicRuns.flatMap((run) => run.items),
      providerRuns: publicRuns.map((run) => ({
        provider: run.provider,
        status: run.status,
        itemCount: run.items.length,
        ...(run.message ? { message: run.message } : {}),
        ...(run.elapsedMs !== undefined ? { elapsedMs: run.elapsedMs } : {}),
      })),
    };
  }
}

function redactRunMessage<T>(run: ProviderRun<T>, input: ImageQuery["input"]): ProviderRun<T> {
  if (!run.message || !input.source) return run;
  return {
    ...run,
    message: run.message.split(input.source).join(input.display),
  };
}

async function runProvider(
  provider: Provider,
  query: ImageQuery,
  timeoutMs: number,
): Promise<ProviderRun<ImageMatch>> {
  const started = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!provider.searchImage) {
      return {
        provider: provider.manifest.id,
        status: "unsupported",
        items: [],
        message: "image lookup is not supported",
        elapsedMs: Date.now() - started,
      };
    }
    const run = await Promise.race([
      provider.searchImage(query),
      new Promise<ProviderRun<ImageMatch>>((resolve) => {
        timeout = setTimeout(
          () =>
            resolve({
              provider: provider.manifest.id,
              status: "unavailable",
              items: [],
              message: `Timed out after ${timeoutMs}ms`,
            }),
          timeoutMs,
        );
      }),
    ]);
    return {
      ...run,
      items: run.items.slice(0, query.limit),
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      provider: provider.manifest.id,
      status: "unavailable",
      items: [],
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

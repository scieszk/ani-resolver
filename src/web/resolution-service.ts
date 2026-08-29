import { ImageResolver } from "../image-resolver.js";
import { ProviderManager, type ProviderListItem } from "../provider-management.js";
import { Resolver } from "../resolver.js";
import type { Provider } from "../types.js";
import type { ResolutionRequest, ResolutionService } from "./server.js";
import { inferRunTarget, selectResolutionInput } from "./target.js";

export interface DefaultResolutionServiceOptions {
  providerManager?: ProviderManager;
  providers?: Provider[];
  limit?: number;
}

export class DefaultResolutionService implements ResolutionService {
  private readonly providerManager: ProviderManager;
  private readonly injectedProviders: Provider[] | undefined;
  private readonly limit: number;
  private loadedProviders: Promise<Provider[]> | undefined;
  private disposeProviders: (() => Promise<void>) | undefined;

  constructor(options: DefaultResolutionServiceOptions = {}) {
    this.providerManager = options.providerManager ?? new ProviderManager();
    this.injectedProviders = options.providers;
    this.limit = options.limit ?? 5;
  }

  async listProviders(): Promise<ProviderListItem[]> {
    if (!this.injectedProviders) return this.providerManager.list();
    return this.injectedProviders.map((provider) => ({
      ...provider.manifest,
      installed: true,
      initialized: true,
      status: "ready",
      distribution: "bundled",
    }));
  }

  async resolve(request: ResolutionRequest): Promise<{
    resolvedTarget: "work" | "character" | "image";
    result: unknown;
  }> {
    const attachments = request.attachments
      .filter((attachment) => attachment.stored && attachment.path)
      .map((attachment) => ({ kind: attachment.kind, path: attachment.path! }));
    const resolvedTarget =
      request.target === "auto"
        ? inferRunTarget({ input: request.input, attachments })
        : request.target;
    const input = selectResolutionInput({ input: request.input, target: resolvedTarget, attachments });
    if (!input) throw new Error("No compatible input is available for this resolution target");
    const providers = await this.providers();
    if (resolvedTarget === "image") {
      return {
        resolvedTarget,
        result: await new ImageResolver(providers).resolve({
          input,
          limit: this.limit,
          providers: request.providers,
        }),
      };
    }
    return {
      resolvedTarget,
      result: await new Resolver(providers).resolve({
        entityType: resolvedTarget,
        input,
        limit: this.limit,
        providers: request.providers,
      }),
    };
  }

  async close(): Promise<void> {
    await this.disposeProviders?.();
    this.loadedProviders = undefined;
    this.disposeProviders = undefined;
  }

  private providers(): Promise<Provider[]> {
    if (this.injectedProviders) return Promise.resolve(this.injectedProviders);
    this.loadedProviders ??= this.providerManager.loadProviderHost().then((host) => {
      this.disposeProviders = () => host.dispose();
      return host.providers();
    });
    return this.loadedProviders;
  }
}

import * as CordisRuntime from "cordis";

import type { Provider } from "./types.js";

interface CordisFiber {
  dispose(): Promise<void>;
}

export interface ProviderContext {
  providers: ProviderRegistryService;
  effect(execute: () => (() => unknown) | Promise<() => unknown>): unknown;
}

export type ProviderPlugin = (context: ProviderContext) => unknown;

interface CordisContextRuntime {
  plugin(plugin: (context: ProviderContext) => unknown): CordisFiber & PromiseLike<CordisFiber>;
}

const Cordis = CordisRuntime as unknown as {
  Context: new () => CordisContextRuntime;
  Service: new (context: CordisContextRuntime, name: string) => object;
};

export class ProviderRegistryService extends Cordis.Service {
  private readonly items = new Map<string, Provider>();

  constructor(context: CordisContextRuntime) {
    super(context, "providers");
  }

  add(provider: Provider): void {
    if (this.items.has(provider.manifest.id)) {
      throw new Error(`Provider is already registered: ${provider.manifest.id}`);
    }
    this.items.set(provider.manifest.id, provider);
  }

  list(): Provider[] {
    return [...this.items.values()];
  }

  clear(): void {
    this.items.clear();
  }
}

export class ProviderHost {
  private readonly context = new Cordis.Context();
  private readonly registry = new ProviderRegistryService(this.context);
  private readonly fibers: CordisFiber[] = [];
  private disposed = false;

  async use(plugin: ProviderPlugin): Promise<void> {
    if (this.disposed) throw new Error("ProviderHost is already disposed");
    const fiber = await this.context.plugin(plugin);
    this.fibers.push(fiber);
  }

  providers(): Provider[] {
    return this.registry.list();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled(this.fibers.splice(0).reverse().map((fiber) => fiber.dispose()));
    this.registry.clear();
  }
}

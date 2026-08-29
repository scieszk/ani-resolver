import os from "node:os";
import path from "node:path";

import { ProviderManager } from "../provider-management.js";
import { DefaultResolutionService } from "./resolution-service.js";
import { RunStore } from "./run-store.js";
import { createWebApp } from "./server.js";

export interface StartWebServerOptions {
  host?: string;
  port?: number;
  maxStorageMb?: number;
  maxRuns?: number;
  dataDirectory?: string;
  staticRoot?: string;
  providerManager?: ProviderManager;
}

export interface WebServerHandle {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startWebServer(
  options: StartWebServerOptions = {},
): Promise<WebServerHandle> {
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 4173;
  const home = process.env.ANI_RESOLVER_HOME ?? path.join(os.homedir(), ".ani-resolver");
  const root = path.resolve(
    options.dataDirectory ?? process.env.ANI_RESOLVER_WEB_DATA ?? path.join(home, "web"),
  );
  const store = new RunStore({
    root,
    maxAttachmentBytes: (options.maxStorageMb ?? 100) * 1024 * 1024,
    ...(options.maxRuns ? { maxRuns: options.maxRuns } : {}),
  });
  const service = new DefaultResolutionService({
    providerManager: options.providerManager ?? new ProviderManager({ home }),
  });
  await store.open();
  const app = await createWebApp({
    store,
    service,
    ...(options.staticRoot ? { staticRoot: options.staticRoot } : {}),
  });
  try {
    await app.listen({ host, port });
  } catch (error) {
    await service.close();
    await store.close();
    throw error;
  }

  let closed = false;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await service.close();
      await store.close();
    },
  };
}

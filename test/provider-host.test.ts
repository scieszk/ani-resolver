import { describe, expect, it } from "vitest";

import { ProviderHost } from "../src/provider-host.js";
import type { Provider } from "../src/types.js";

const fixtureProvider: Provider = {
  manifest: {
    id: "fixture-host",
    label: "Fixture Host",
    mediaTypes: ["anime"],
    capabilities: ["work_search"],
    languages: ["en"],
    auth: "none",
    strengths: ["tests"],
    limitations: [],
  },
};

describe("ProviderHost", () => {
  it("registers providers through Cordis and disposes their lifecycle", async () => {
    const host = new ProviderHost();
    let disposed = false;

    await host.use((context) => {
      context.providers.add(fixtureProvider);
      context.effect(() => () => {
        disposed = true;
      });
    });

    expect(host.providers()).toEqual([fixtureProvider]);

    await host.dispose();
    expect(disposed).toBe(true);
    expect(host.providers()).toEqual([]);
  });
});

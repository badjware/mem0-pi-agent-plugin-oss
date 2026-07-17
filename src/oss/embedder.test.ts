import { describe, it, expect, vi } from "vitest";
import { resolveOssEmbedder } from "./embedder.ts";

function makeRegistry(models: any[], auth: any = { ok: true, apiKey: "k" }) {
  return {
    getAll: vi.fn(() => models),
    getApiKeyAndHeaders: vi.fn(async () => auth),
  };
}

describe("resolveOssEmbedder", () => {
  it("returns null when the model is unset", async () => {
    const registry = makeRegistry([]);
    expect(await resolveOssEmbedder(undefined, registry)).toBeNull();
  });

  it("requires provider/model syntax", async () => {
    const registry = makeRegistry([]);
    await expect(resolveOssEmbedder("text-embedding-3-small", registry)).rejects.toThrow(
      /provider\/model/,
    );
  });

  it("rejects a missing provider or model in the identifier", async () => {
    const registry = makeRegistry([]);
    await expect(resolveOssEmbedder("/text-embedding-3-small", registry)).rejects.toThrow(
      /provider\/model/,
    );
    await expect(resolveOssEmbedder("openai/", registry)).rejects.toThrow(/provider\/model/);
  });

  it("throws when the provider is not registered", async () => {
    const registry = makeRegistry([]);
    await expect(resolveOssEmbedder("openai/text-embedding-3-small", registry)).rejects.toThrow(
      /not registered/,
    );
  });

  it("throws when the provider has an unsupported api", async () => {
    const registry = makeRegistry([{ provider: "anthropic", api: "anthropic-messages" }]);
    await expect(resolveOssEmbedder("anthropic/some-model", registry)).rejects.toThrow(
      /unsupported embedder api/,
    );
  });

  it("throws when credentials are unavailable", async () => {
    const registry = makeRegistry(
      [{ provider: "openai", api: "openai-completions" }],
      { ok: false, error: "no key configured" },
    );
    await expect(resolveOssEmbedder("openai/text-embedding-3-small", registry)).rejects.toThrow(
      /credentials.*no key/,
    );
  });

  it("maps openai-completions to mem0 openai with apiKey and baseURL", async () => {
    const registry = makeRegistry([
      {
        provider: "openai",
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
      },
    ]);
    const out = await resolveOssEmbedder("openai/text-embedding-3-small", registry);
    expect(out).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
      config: {
        model: "text-embedding-3-small",
        apiKey: "k",
        baseURL: "https://api.openai.com/v1",
      },
    });
  });

  it("maps ollama to mem0 ollama with url only, no apiKey", async () => {
    const registry = makeRegistry([
      {
        provider: "ollama",
        api: "openai-completions",
        baseUrl: "http://localhost:11434",
      },
    ]);
    const out = await resolveOssEmbedder("ollama/nomic-embed-text", registry);
    expect(out).toEqual({
      provider: "ollama",
      model: "nomic-embed-text",
      config: {
        model: "nomic-embed-text",
        url: "http://localhost:11434",
      },
    });
  });

  it("maps a custom provider named ollama even without api openai-completions", async () => {
    const registry = makeRegistry([{ provider: "ollama", api: "google-generative-ai" }]);
    const out = await resolveOssEmbedder("ollama/nomic-embed-text", registry);
    expect(out?.provider).toBe("ollama");
    expect(out?.config.url).toBeUndefined();
  });

  it("does not forward apiKey for ollama even if credentials are present", async () => {
    const registry = makeRegistry(
      [{ provider: "ollama", api: "openai-completions" }],
      { ok: true, apiKey: "should-not-appear" },
    );
    const out = await resolveOssEmbedder("ollama/nomic-embed-text", registry);
    expect(out?.config.apiKey).toBeUndefined();
  });
});

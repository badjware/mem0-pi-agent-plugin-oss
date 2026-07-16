import { describe, it, expect, vi } from "vitest";
import { resolveOssLlm } from "./model.ts";

function makeRegistry(model: any, auth: any = { ok: true, apiKey: "k" }) {
  return {
    find: vi.fn(() => model),
    getApiKeyAndHeaders: vi.fn(async () => auth),
  };
}

describe("resolveOssLlm", () => {
  it("rejects identifiers without a slash", async () => {
    const registry = makeRegistry(null);
    await expect(resolveOssLlm("bare-model", registry)).rejects.toThrow(
      /provider\/model/,
    );
  });

  it("rejects models that are not in the registry", async () => {
    const registry = { find: vi.fn(() => undefined), getApiKeyAndHeaders: vi.fn() };
    await expect(resolveOssLlm("ollama/x", registry as any)).rejects.toThrow(
      /not registered/,
    );
  });

  it("maps ollama provider to mem0 ollama with url and baseURL", async () => {
    const registry = makeRegistry({
      provider: "ollama",
      api: "openai-completions",
      baseUrl: "http://localhost:11434",
    });
    const out = await resolveOssLlm("ollama/qwen3.5:4b", registry);
    expect(out.provider).toBe("ollama");
    expect(out.config.model).toBe("qwen3.5:4b");
    expect(out.config.baseURL).toBe("http://localhost:11434");
    expect(out.config.url).toBe("http://localhost:11434");
  });

  it("maps openai-completions api to mem0 openai", async () => {
    const registry = makeRegistry({
      provider: "lmstudio",
      api: "openai-completions",
      baseUrl: "http://localhost:1234/v1",
    });
    const out = await resolveOssLlm("lmstudio/hermes-3", registry);
    expect(out.provider).toBe("openai");
    expect(out.config.model).toBe("hermes-3");
    expect(out.config.baseURL).toBe("http://localhost:1234/v1");
    expect(out.config.url).toBeUndefined();
  });

  it("maps anthropic-messages api to mem0 anthropic", async () => {
    const registry = makeRegistry({
      provider: "anthropic",
      api: "anthropic-messages",
    });
    const out = await resolveOssLlm("anthropic/claude-3-5-sonnet", registry);
    expect(out.provider).toBe("anthropic");
    expect(out.config.model).toBe("claude-3-5-sonnet");
    expect(out.config.apiKey).toBe("k");
  });

  it("rejects unsupported apis", async () => {
    const registry = makeRegistry({
      provider: "google",
      api: "google-generative-ai",
    });
    await expect(
      resolveOssLlm("google/gemini-2.5-flash", registry),
    ).rejects.toThrow(/unsupported model api/);
  });

  it("rejects when credentials are unavailable", async () => {
    const registry = makeRegistry(
      { provider: "anthropic", api: "anthropic-messages" },
      { ok: false, error: "no key configured" },
    );
    await expect(
      resolveOssLlm("anthropic/claude-3-5-sonnet", registry),
    ).rejects.toThrow(/credentials.*no key/);
  });
});

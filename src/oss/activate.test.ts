import { describe, it, expect, vi, beforeEach } from "vitest";

const paths = {
  memoriesDir: "/fake/memories",
  vectorDbPath: "/fake/memories/mem0-vectors.db",
  historyDbPath: "/fake/memories/mem0-history.db",
  fastembedCacheDir: "/fake/memories/fastembed-cache",
  embedderMetadataPath: "/fake/memories/mem0-embedder.json",
};

vi.mock("./paths.ts", () => ({
  resolveStoragePaths: vi.fn(() => paths),
}));

vi.mock("./model.ts", () => ({
  resolveOssLlm: vi.fn(async () => ({ provider: "ollama", config: { model: "qwen3.5:4b" } })),
}));

const resolveOssEmbedder = vi.fn();
vi.mock("./embedder.ts", () => ({
  resolveOssEmbedder: (...args: any[]) => resolveOssEmbedder(...args),
}));

const readMetadata = vi.fn();
const writeMetadata = vi.fn();
const compareMetadata = vi.fn();
vi.mock("./embedder-metadata.ts", () => ({
  readMetadata: (...args: any[]) => readMetadata(...args),
  writeMetadata: (...args: any[]) => writeMetadata(...args),
  compareMetadata: (...args: any[]) => compareMetadata(...args),
}));

const memoryCtor = vi.fn();
const embedderCreate = vi.fn();
vi.mock("mem0ai/oss", () => ({
  Memory: class {
    constructor(config: any) {
      memoryCtor(config);
    }
  },
  LLMFactory: { create: vi.fn(() => ({})) },
  EmbedderFactory: { create: (...args: any[]) => embedderCreate(...args) },
}));

vi.mock("fastembed", () => ({
  FlagEmbedding: {
    init: vi.fn(async () => ({
      embed: async function* (_texts: string[]) {
        yield [[0.1, 0.2, 0.3]];
      },
    })),
  },
}));

import { activateRuntime } from "./activate.ts";

const baseConfig: any = {
  oss: { llm: { model: "ollama/qwen3.5:4b" } },
};

describe("activateRuntime embedder wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readMetadata.mockReturnValue(null);
    compareMetadata.mockReturnValue({ ok: true });
  });

  it("uses the fastembed shim when resolveOssEmbedder returns null", async () => {
    resolveOssEmbedder.mockResolvedValue(null);

    await activateRuntime(baseConfig, {} as any);

    expect(memoryCtor).toHaveBeenCalledTimes(1);
    const config = memoryCtor.mock.calls[0][0];
    expect(config.embedder.provider).toBe("langchain");
    expect(config.vectorStore.config.dimension).toBe(384);
    expect(embedderCreate).not.toHaveBeenCalled();
    expect(writeMetadata).toHaveBeenCalledWith(paths.embedderMetadataPath, {
      provider: "fastembed",
      model: "fast-bge-small-en-v1.5",
      dimension: 384,
    });
  });

  it("hands mem0 the native embedder config and probes the dimension on first activation", async () => {
    resolveOssEmbedder.mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      config: { model: "text-embedding-3-small", apiKey: "k" },
    });
    embedderCreate.mockReturnValue({ embed: vi.fn(async () => [1, 2, 3, 4]) });

    await activateRuntime(baseConfig, {} as any);

    expect(embedderCreate).toHaveBeenCalledWith("openai", { model: "text-embedding-3-small", apiKey: "k" });
    const config = memoryCtor.mock.calls[0][0];
    expect(config.embedder).toEqual({
      provider: "openai",
      config: { model: "text-embedding-3-small", apiKey: "k" },
    });
    expect(config.vectorStore.config.dimension).toBe(4);
    expect(writeMetadata).toHaveBeenCalledWith(paths.embedderMetadataPath, {
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 4,
    });
  });

  it("reuses the cached dimension and skips the probe when metadata already exists", async () => {
    resolveOssEmbedder.mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      config: { model: "text-embedding-3-small", apiKey: "k" },
    });
    readMetadata.mockReturnValue({ provider: "openai", model: "text-embedding-3-small", dimension: 4 });

    await activateRuntime(baseConfig, {} as any);

    expect(embedderCreate).not.toHaveBeenCalled();
    expect(writeMetadata).not.toHaveBeenCalled();
    expect(compareMetadata).toHaveBeenCalledWith(
      { provider: "openai", model: "text-embedding-3-small", dimension: 4 },
      { provider: "openai", model: "text-embedding-3-small", dimension: 4 },
    );
    expect(memoryCtor).toHaveBeenCalledTimes(1);
  });

  it("throws with the compareMetadata reason on a mismatch, without falling back to fastembed", async () => {
    resolveOssEmbedder.mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      config: { model: "text-embedding-3-small", apiKey: "k" },
    });
    readMetadata.mockReturnValue({ provider: "ollama", model: "nomic-embed-text", dimension: 768 });
    compareMetadata.mockReturnValue({
      ok: false,
      reason: "embedder configuration changed; run /mem0-reindex to re-embed existing memories",
    });

    await expect(activateRuntime(baseConfig, {} as any)).rejects.toThrow(/mem0-reindex/);
    expect(memoryCtor).not.toHaveBeenCalled();
  });

  it("propagates resolveOssEmbedder failures (unknown provider, unsupported api, missing credentials)", async () => {
    resolveOssEmbedder.mockRejectedValue(new Error("embedder provider \"foo\" is not registered"));

    await expect(activateRuntime(baseConfig, {} as any)).rejects.toThrow(/not registered/);
    expect(memoryCtor).not.toHaveBeenCalled();
  });

  it("surfaces probe failures as a hard error", async () => {
    resolveOssEmbedder.mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      config: { model: "text-embedding-3-small", apiKey: "k" },
    });
    embedderCreate.mockReturnValue({
      embed: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });

    await expect(activateRuntime(baseConfig, {} as any)).rejects.toThrow(/connection refused/);
    expect(memoryCtor).not.toHaveBeenCalled();
  });
});

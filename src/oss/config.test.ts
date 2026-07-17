import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";

vi.mock("node:fs");

const ENV_KEYS = ["MEM0_OSS_EMBEDDER_MODEL", "MEM0_OSS_LLM_MODEL"];

function mockFileConfig(content: unknown | null) {
  vi.mocked(fs.existsSync).mockReturnValue(content !== null);
  if (content !== null) {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(content) as any);
  }
}

describe("loadConfig embedder handling", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  it("leaves oss.embedder unset when nothing is configured", async () => {
    mockFileConfig(null);
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.embedder).toBeUndefined();
  });

  it("reads the provider/model embedder identifier from the file config", async () => {
    mockFileConfig({ oss: { embedder: { model: "openai/text-embedding-3-small" } } });
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.embedder).toEqual({ model: "openai/text-embedding-3-small" });
  });

  it("treats an empty-string embedder model as unset", async () => {
    mockFileConfig({ oss: { embedder: { model: "" } } });
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.embedder).toBeUndefined();
  });

  it("treats a null embedder model as unset", async () => {
    mockFileConfig({ oss: { embedder: { model: null } } });
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.embedder).toBeUndefined();
  });

  it("MEM0_OSS_EMBEDDER_MODEL overrides the file config", async () => {
    mockFileConfig({ oss: { embedder: { model: "openai/text-embedding-3-small" } } });
    process.env.MEM0_OSS_EMBEDDER_MODEL = "ollama/nomic-embed-text";
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.embedder).toEqual({ model: "ollama/nomic-embed-text" });
  });

  it("an empty-string env override falls back to the file config", async () => {
    mockFileConfig({ oss: { embedder: { model: "openai/text-embedding-3-small" } } });
    process.env.MEM0_OSS_EMBEDDER_MODEL = "";
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.embedder?.model).toBe("openai/text-embedding-3-small");
  });

  it("the environment can set the embedder block with no file config", async () => {
    mockFileConfig(null);
    process.env.MEM0_OSS_EMBEDDER_MODEL = "ollama/nomic-embed-text";
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.embedder).toEqual({ model: "ollama/nomic-embed-text" });
  });

  it("preserves oss.llm.model when only the embedder is overridden", async () => {
    mockFileConfig({ oss: { llm: { model: "ollama/qwen3.5:4b" } } });
    process.env.MEM0_OSS_EMBEDDER_MODEL = "ollama/nomic-embed-text";
    const { loadConfig } = await import("./config.ts");
    const config = loadConfig();
    expect(config.oss?.llm?.model).toBe("ollama/qwen3.5:4b");
    expect(config.oss?.embedder?.model).toBe("ollama/nomic-embed-text");
  });
});

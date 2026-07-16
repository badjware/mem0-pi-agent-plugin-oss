import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { loadConfig } from "../src/oss/config.ts";

vi.mock("node:fs");

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, HOME: "/home/testuser" };
    delete process.env.MEM0_USER_ID;
    delete process.env.MEM0_OSS_LLM_MODEL;
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig();
    expect(config.userId).toBe("");
    expect(config.autoCapture).toBe(true);
    expect(config.defaultScope).toBe("project");
    expect(config.oss).toBeUndefined();
  });

  it("reads config file and merges with defaults", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ userId: "file-user", oss: { llm: { model: "ollama/qwen3.5:4b" } } }),
    );
    const config = loadConfig();
    expect(config.userId).toBe("file-user");
    expect(config.dream.enabled).toBe(true);
    expect(config.dream.minHours).toBe(24);
    expect(config.oss?.llm.model).toBe("ollama/qwen3.5:4b");
  });

  it("MEM0_OSS_LLM_MODEL env var overrides config file", () => {
    process.env.MEM0_OSS_LLM_MODEL = "ollama/env-model";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ oss: { llm: { model: "ollama/file-model" } } }),
    );
    const config = loadConfig();
    expect(config.oss?.llm.model).toBe("ollama/env-model");
  });

  it("MEM0_USER_ID env var overrides config file userId", () => {
    process.env.MEM0_USER_ID = "env-user";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ userId: "file-user" }),
    );
    expect(loadConfig().userId).toBe("env-user");
  });

  it("swallows corrupted JSON and returns defaults", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{not valid json");
    const config = loadConfig();
    expect(config.autoCapture).toBe(true);
  });
});

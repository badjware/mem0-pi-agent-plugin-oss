import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readMetadata, writeMetadata, compareMetadata, type EmbedderMetadata } from "./embedder-metadata.ts";

describe("readMetadata / writeMetadata (tmp-dir round trip)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when the file is missing", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embedder-metadata-"));
    const p = path.join(tmpDir, "mem0-embedder.json");
    expect(readMetadata(p)).toBeNull();
  });

  it("round-trips a written metadata file", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embedder-metadata-"));
    const p = path.join(tmpDir, "mem0-embedder.json");
    const metadata: EmbedderMetadata = { provider: "openai", model: "text-embedding-3-small", dimension: 1536 };
    writeMetadata(p, metadata);
    expect(readMetadata(p)).toEqual(metadata);
  });

  it("overwrites existing content on subsequent writes", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embedder-metadata-"));
    const p = path.join(tmpDir, "mem0-embedder.json");
    writeMetadata(p, { provider: "fastembed", model: "fast-bge-small-en-v1.5", dimension: 384 });
    const updated: EmbedderMetadata = { provider: "ollama", model: "nomic-embed-text", dimension: 768 };
    writeMetadata(p, updated);
    expect(readMetadata(p)).toEqual(updated);
  });

  it("throws an actionable error on malformed JSON", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embedder-metadata-"));
    const p = path.join(tmpDir, "mem0-embedder.json");
    fs.writeFileSync(p, "{ not valid json", "utf8");
    expect(() => readMetadata(p)).toThrow(/malformed JSON/);
    expect(() => readMetadata(p)).toThrow(/mem0-reindex/);
  });

  it("re-throws non-ENOENT filesystem errors from readFileSync", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embedder-metadata-"));
    const dirAsFile = path.join(tmpDir, "a-directory");
    fs.mkdirSync(dirAsFile);
    expect(() => readMetadata(dirAsFile)).toThrow();
  });
});

describe("compareMetadata", () => {
  const base: EmbedderMetadata = { provider: "openai", model: "text-embedding-3-small", dimension: 1536 };

  it("returns ok: true when all fields match", () => {
    expect(compareMetadata(base, { ...base })).toEqual({ ok: true });
  });

  it("detects a provider mismatch", () => {
    const result = compareMetadata(base, { ...base, provider: "ollama" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/provider/);
      expect(result.reason).toMatch(/\/mem0-reindex/);
    }
  });

  it("detects a model mismatch", () => {
    const result = compareMetadata(base, { ...base, model: "text-embedding-3-large" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/model/);
      expect(result.reason).toMatch(/\/mem0-reindex/);
    }
  });

  it("detects a dimension mismatch", () => {
    const result = compareMetadata(base, { ...base, dimension: 3072 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/dimension/);
      expect(result.reason).toMatch(/\/mem0-reindex/);
    }
  });

  it("reports all mismatched fields when several differ", () => {
    const result = compareMetadata(base, { provider: "ollama", model: "nomic-embed-text", dimension: 768 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/provider/);
      expect(result.reason).toMatch(/model/);
      expect(result.reason).toMatch(/dimension/);
    }
  });
});

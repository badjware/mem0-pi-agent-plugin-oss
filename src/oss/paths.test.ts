import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expandHome, resolveStoragePaths } from "./paths.ts";

vi.mock("node:fs");

describe("expandHome", () => {
  const home = os.homedir();

  afterEach(() => vi.restoreAllMocks());

  it("returns homedir for a bare ~", () => {
    expect(expandHome("~")).toBe(home);
  });

  it("expands ~/foo to homedir/foo", () => {
    expect(expandHome("~/foo/bar")).toBe(path.join(home, "foo", "bar"));
  });

  it("resolves relative paths to absolute", () => {
    expect(path.isAbsolute(expandHome("./x"))).toBe(true);
  });

  it("leaves absolute paths untouched", () => {
    expect(expandHome("/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("resolveStoragePaths", () => {
  it("returns absolute paths under ~/.pi/agent/memories and creates the directory", () => {
    const mkdir = vi.mocked(fs.mkdirSync).mockImplementation(() => "" as any);
    const paths = resolveStoragePaths();
    expect(paths.memoriesDir).toBe(path.join(os.homedir(), ".pi", "agent", "memories"));
    expect(paths.vectorDbPath).toBe(path.join(paths.memoriesDir, "mem0-vectors.db"));
    expect(paths.historyDbPath).toBe(path.join(paths.memoriesDir, "mem0-history.db"));
    expect(paths.fastembedCacheDir).toBe(path.join(paths.memoriesDir, "fastembed-cache"));
    expect(paths.embedderMetadataPath).toBe(path.join(paths.memoriesDir, "mem0-embedder.json"));
    expect(mkdir).toHaveBeenCalledWith(paths.memoriesDir, { recursive: true });
  });
});

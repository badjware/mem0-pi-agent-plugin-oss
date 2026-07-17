import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Expand a leading `~` and resolve to an absolute path. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export interface ResolvedStoragePaths {
  memoriesDir: string;
  vectorDbPath: string;
  historyDbPath: string;
  fastembedCacheDir: string;
  embedderMetadataPath: string;
}

/**
 * Compute the on-disk paths for mem0's SQLite-backed vector store and history
 * store. Creates the parent directory eagerly so mem0's own init errors are
 * unambiguous rather than cwd-dependent.
 */
export function resolveStoragePaths(): ResolvedStoragePaths {
  const memoriesDir = expandHome("~/.pi/agent/memories");
  fs.mkdirSync(memoriesDir, { recursive: true });
  return {
    memoriesDir,
    vectorDbPath: path.join(memoriesDir, "mem0-vectors.db"),
    historyDbPath: path.join(memoriesDir, "mem0-history.db"),
    fastembedCacheDir: path.join(memoriesDir, "fastembed-cache"),
    embedderMetadataPath: path.join(memoriesDir, "mem0-embedder.json"),
  };
}

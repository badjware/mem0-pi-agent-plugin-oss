import * as fs from "node:fs";

/**
 * Identity of the embedder currently backing the vector store, persisted
 * alongside it so a later activation can detect a mismatch (e.g. switching
 * from fastembed to an external provider) before writing incompatible
 * vectors into the same database.
 */
export interface EmbedderMetadata {
  provider: string;
  model: string;
  dimension: number;
}

/**
 * Read the embedder metadata file. Returns null when the file does not
 * exist, which the caller treats as "first activation". Throws on malformed
 * JSON, since a corrupt file is not something we can recover from silently.
 */
export function readMetadata(path: string): EmbedderMetadata | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }

  try {
    return JSON.parse(raw) as EmbedderMetadata;
  } catch {
    throw new Error(
      `embedder metadata file at "${path}" is malformed JSON; delete it and run /mem0-reindex to regenerate it`,
    );
  }
}

/** Write the embedder metadata file, overwriting any existing content. */
export function writeMetadata(path: string, metadata: EmbedderMetadata): void {
  fs.writeFileSync(path, JSON.stringify(metadata, null, 2) + "\n", "utf8");
}

export type MetadataComparison = { ok: true } | { ok: false; reason: string };

/**
 * Compare the persisted embedder metadata against the currently resolved
 * embedder. Any field mismatch means the vector store was built with a
 * different embedder and must be reindexed before it can be trusted.
 */
export function compareMetadata(
  existing: EmbedderMetadata,
  current: EmbedderMetadata,
): MetadataComparison {
  const mismatches: string[] = [];
  if (existing.provider !== current.provider) {
    mismatches.push(`provider changed from "${existing.provider}" to "${current.provider}"`);
  }
  if (existing.model !== current.model) {
    mismatches.push(`model changed from "${existing.model}" to "${current.model}"`);
  }
  if (existing.dimension !== current.dimension) {
    mismatches.push(`dimension changed from ${existing.dimension} to ${current.dimension}`);
  }

  if (mismatches.length === 0) return { ok: true };

  return {
    ok: false,
    reason: `embedder configuration changed (${mismatches.join(", ")}); run /mem0-reindex to re-embed existing memories with the new embedder`,
  };
}

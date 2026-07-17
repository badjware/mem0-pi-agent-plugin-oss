import type { Mem0Config } from "../types.ts";
import { OssMemoryClientAdapter } from "./client.ts";
import { resolveOssLlm } from "./model.ts";
import { resolveOssEmbedder } from "./embedder.ts";
import { resolveStoragePaths } from "./paths.ts";
import { readMetadata, writeMetadata, compareMetadata, type EmbedderMetadata } from "./embedder-metadata.ts";

const FASTEMBED_DIMS = 384;
const FASTEMBED_MODEL = "fast-bge-small-en-v1.5";

/**
 * Build the mem0ai/oss Memory instance and wrap it in the plugin adapter,
 * without touching the embedder metadata file. Shared by `activateRuntime()`
 * (which compares against cached metadata and may throw on mismatch) and the
 * `/mem0-reindex` command (which bypasses the check entirely and always
 * measures a fresh dimension, since the whole point of reindexing is that the
 * cached dimension may no longer be trustworthy).
 */
async function buildRuntime(
  config: Mem0Config,
  modelRegistry: any,
  paths: ReturnType<typeof resolveStoragePaths>,
  existingMetadata: EmbedderMetadata | null,
): Promise<{
  client: OssMemoryClientAdapter;
  identity: { provider: string; model: string };
  dimension: number;
}> {
  const modelId = config.oss?.llm?.model;
  if (!modelId) {
    throw new Error(
      'oss.llm.model is not set in ~/.pi/agent/mem0-oss-config.json (or MEM0_OSS_LLM_MODEL); mem0 needs an explicit extraction model like "ollama/qwen3.5:4b"',
    );
  }

  const llm = await resolveOssLlm(modelId, modelRegistry);

  const oss = await import("mem0ai/oss");
  const { Memory, LLMFactory, EmbedderFactory } = oss as any;

  const resolvedEmbedder = await resolveOssEmbedder(
    config.oss?.embedder?.model,
    modelRegistry,
  );

  let embedderBlock: { provider: string; config: Record<string, unknown> };
  let currentIdentity: { provider: string; model: string };
  let dimension: number;

  if (resolvedEmbedder === null) {
    // mem0's built-in FastEmbedEmbedder doesn't forward a cacheDir to
    // fastembed's FlagEmbedding.init(), which then defaults to `./local_cache`
    // relative to cwd. Init fastembed ourselves with an explicit cacheDir under
    // ~/.pi and hand mem0 a Langchain-shaped embedder wrapper.
    const { FlagEmbedding } = (await import("fastembed")) as any;
    const flagEmbedding = await FlagEmbedding.init({
      model: FASTEMBED_MODEL,
      cacheDir: paths.fastembedCacheDir,
    });
    const embedOne = async (text: string): Promise<number[]> => {
      const normalized = text.replace(/\n/g, " ");
      for await (const batch of flagEmbedding.embed([normalized])) {
        const v = batch[0];
        if (v !== undefined) return Array.from(v);
      }
      throw new Error("FastEmbed embed() returned no embeddings");
    };
    const fastembedLangchainShim = {
      embedQuery: embedOne,
      embedDocuments: async (texts: string[]) => Promise.all(texts.map(embedOne)),
    };

    embedderBlock = { provider: "langchain", config: { model: fastembedLangchainShim } };
    currentIdentity = { provider: "fastembed", model: FASTEMBED_MODEL };
    dimension = FASTEMBED_DIMS;
  } else {
    embedderBlock = { provider: resolvedEmbedder.provider, config: resolvedEmbedder.config };
    currentIdentity = { provider: resolvedEmbedder.provider, model: resolvedEmbedder.model };

    if (existingMetadata) {
      // Dimension is deterministic for a given provider/model; trust the
      // cached value instead of re-probing on every activation.
      dimension = existingMetadata.dimension;
    } else {
      const probeEmbedder = EmbedderFactory.create(resolvedEmbedder.provider, resolvedEmbedder.config);
      try {
        const probeVector = await probeEmbedder.embed("probe");
        dimension = probeVector.length;
      } catch (err) {
        throw new Error(
          `failed to determine embedder dimension via probe embed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const currentIdentityWithDimension: EmbedderMetadata = { ...currentIdentity, dimension };
  if (existingMetadata) {
    const comparison = compareMetadata(existingMetadata, currentIdentityWithDimension);
    if (!comparison.ok) throw new Error(comparison.reason);
  }

  const ossConfig = {
    embedder: embedderBlock,
    vectorStore: {
      provider: "memory",
      config: {
        dbPath: paths.vectorDbPath,
        dimension,
      },
    },
    historyDbPath: paths.historyDbPath,
    historyStore: {
      provider: "sqlite",
      config: { historyDbPath: paths.historyDbPath },
    },
    llm,
  };

  const memory = new Memory(ossConfig);
  const llmClient = LLMFactory.create(llm.provider, llm.config);
  const client = new OssMemoryClientAdapter(memory, llmClient);
  return { client, identity: currentIdentity, dimension };
}

/**
 * Build the mem0ai/oss Memory instance and wrap it in the plugin adapter.
 * Throws with a human-readable reason on any failure so the caller can put the
 * runtime in `inactive` state and surface the reason via `ctx.ui.notify`.
 */
export async function activateRuntime(
  config: Mem0Config,
  modelRegistry: any,
): Promise<{ client: OssMemoryClientAdapter }> {
  const paths = resolveStoragePaths();
  const existingMetadata = readMetadata(paths.embedderMetadataPath);

  const { client, identity, dimension } = await buildRuntime(config, modelRegistry, paths, existingMetadata);

  if (!existingMetadata) {
    writeMetadata(paths.embedderMetadataPath, { ...identity, dimension });
  }

  return { client };
}

/**
 * Build a fresh runtime from the current config, bypassing the embedder
 * metadata comparison entirely. Used by `/mem0-reindex` so it can construct a
 * working client even when the runtime is currently deactivated because of a
 * metadata mismatch. Always probes the dimension fresh (passes
 * `existingMetadata: null` to `buildRuntime`) rather than trusting any cached
 * value, since the embedder may have changed.
 */
export async function buildRuntimeForReindex(
  config: Mem0Config,
  modelRegistry: any,
): Promise<{ client: OssMemoryClientAdapter; metadata: EmbedderMetadata }> {
  const paths = resolveStoragePaths();
  const { client, identity, dimension } = await buildRuntime(config, modelRegistry, paths, null);
  return { client, metadata: { ...identity, dimension } };
}

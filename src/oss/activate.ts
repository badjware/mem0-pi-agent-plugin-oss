import type { Mem0Config } from "../types.ts";
import { OssMemoryClientAdapter } from "./client.ts";
import { resolveOssLlm } from "./model.ts";
import { resolveStoragePaths } from "./paths.ts";

const EMBEDDING_DIMS = 384;

/**
 * Build the mem0ai/oss Memory instance and wrap it in the plugin adapter.
 * Throws with a human-readable reason on any failure so the caller can put the
 * runtime in `inactive` state and surface the reason via `ctx.ui.notify`.
 */
export async function activateRuntime(
  config: Mem0Config,
  modelRegistry: any,
): Promise<{ client: OssMemoryClientAdapter }> {
  const modelId = config.oss?.llm?.model;
  if (!modelId) {
    throw new Error(
      'oss.llm.model is not set in ~/.pi/agent/mem0-oss-config.json (or MEM0_OSS_LLM_MODEL); mem0 needs an explicit extraction model like "ollama/qwen3.5:4b"',
    );
  }

  const llm = await resolveOssLlm(modelId, modelRegistry);
  const paths = resolveStoragePaths();

  const oss = await import("mem0ai/oss");
  const { Memory, LLMFactory } = oss as any;

  // mem0's built-in FastEmbedEmbedder doesn't forward a cacheDir to
  // fastembed's FlagEmbedding.init(), which then defaults to `./local_cache`
  // relative to cwd. Init fastembed ourselves with an explicit cacheDir under
  // ~/.pi and hand mem0 a Langchain-shaped embedder wrapper.
  const { FlagEmbedding } = (await import("fastembed")) as any;
  const flagEmbedding = await FlagEmbedding.init({
    model: "fast-bge-small-en-v1.5",
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

  // TODO: embedder and vector store are deliberately hardcoded for now (see
  // PLAN.md phases 4-5). If either becomes configurable later, add an explicit
  // reindex/migration flow — changing embedder or vector store on an existing
  // DB will produce garbage results.
  const ossConfig = {
    embedder: {
      provider: "langchain",
      config: { model: fastembedLangchainShim },
    },
    vectorStore: {
      provider: "memory",
      config: {
        dbPath: paths.vectorDbPath,
        dimension: EMBEDDING_DIMS,
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
  return { client };
}

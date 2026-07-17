/**
 * Resolve pi's oss.embedder.model config into a mem0ai/oss embedder config
 * block. Returns null when unset, which signals the caller to fall back to
 * the hardcoded fastembed default.
 */
export interface ResolvedOssEmbedder {
  provider: string;
  config: {
    model: string;
    apiKey?: string;
    baseURL?: string;
    url?: string;
  };
  model: string;
}

interface ModelRegistryLike {
  getAll(): any[];
  getApiKeyAndHeaders(model: any): Promise<
    | { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }
    | { ok: false; error: string }
  >;
}

function mapEmbedderProvider(model: any): { provider: string } | { error: string } {
  if (model.provider === "ollama") return { provider: "ollama" };
  switch (model.api) {
    case "openai-completions":
      return { provider: "openai" };
    default:
      return {
        error: `unsupported embedder api "${model.api}" for provider "${model.provider}"; only ollama and openai-completions are supported`,
      };
  }
}

export async function resolveOssEmbedder(
  modelId: string | undefined,
  registry: ModelRegistryLike,
): Promise<ResolvedOssEmbedder | null> {
  if (!modelId) return null;

  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    throw new Error(
      `oss.embedder.model must use "provider/model" syntax, got "${modelId}"`,
    );
  }
  const provider = modelId.slice(0, slash);
  const model = modelId.slice(slash + 1);
  const found = registry.getAll().find((m) => m.provider === provider);
  if (!found) {
    throw new Error(
      `embedder provider "${provider}" is not registered in pi's model registry`,
    );
  }

  const mapped = mapEmbedderProvider(found);
  if ("error" in mapped) throw new Error(mapped.error);

  const auth = await registry.getApiKeyAndHeaders(found);
  if (!auth.ok) {
    throw new Error(
      `credentials for embedder provider "${provider}" are unavailable: ${auth.error}`,
    );
  }

  const baseUrl: string | undefined = found.baseUrl;
  const config: ResolvedOssEmbedder["config"] = { model };
  if (mapped.provider === "ollama") {
    if (baseUrl) config.url = baseUrl;
  } else {
    if (auth.apiKey) config.apiKey = auth.apiKey;
    if (baseUrl) config.baseURL = baseUrl;
  }

  return { provider: mapped.provider, config, model };
}

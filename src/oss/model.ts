/**
 * Resolve a pi model identifier (e.g. "ollama/qwen3.5:4b") into a mem0ai/oss
 * LLM config block. Auth headers/env returned by getApiKeyAndHeaders() are
 * ignored in this first version; only apiKey and baseUrl are forwarded.
 */
export interface ResolvedOssLlm {
  provider: string;
  config: {
    model: string;
    apiKey?: string;
    baseURL?: string;
    url?: string;
  };
}

interface ModelRegistryLike {
  find(provider: string, id: string): any | undefined;
  getApiKeyAndHeaders(model: any): Promise<
    | { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }
    | { ok: false; error: string }
  >;
}

function mapProvider(model: any): { provider: string } | { error: string } {
  if (model.provider === "ollama") return { provider: "ollama" };
  switch (model.api) {
    case "openai-completions":
      return { provider: "openai" };
    case "anthropic-messages":
      return { provider: "anthropic" };
    default:
      return {
        error: `unsupported model api "${model.api}" for provider "${model.provider}"; only ollama, openai-completions, and anthropic-messages are supported`,
      };
  }
}

export async function resolveOssLlm(
  modelId: string,
  registry: ModelRegistryLike,
): Promise<ResolvedOssLlm> {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    throw new Error(
      `oss.llm.model must use "provider/model" syntax, got "${modelId}"`,
    );
  }
  const provider = modelId.slice(0, slash);
  const id = modelId.slice(slash + 1);

  const model = registry.find(provider, id);
  if (!model) {
    throw new Error(`model "${modelId}" is not registered in pi's model registry`);
  }

  const mapped = mapProvider(model);
  if ("error" in mapped) throw new Error(mapped.error);

  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(`credentials for "${modelId}" are unavailable: ${auth.error}`);
  }

  const baseUrl: string | undefined = model.baseUrl;
  const config: ResolvedOssLlm["config"] = { model: id };
  if (auth.apiKey) config.apiKey = auth.apiKey;
  if (baseUrl) {
    config.baseURL = baseUrl;
    if (mapped.provider === "ollama") config.url = baseUrl;
  }

  return { provider: mapped.provider, config };
}

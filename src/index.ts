export type {
  Scope,
  Mem0Config,
  OssBlock,
  DreamConfig,
  ScopeContext,
  CustomCategory,
} from "./types.ts";
export { DEFAULT_CUSTOM_CATEGORIES } from "./types.ts";

export { loadConfig, CONFIG_DIR, CONFIG_PATH } from "./oss/config.ts";

export { registerMemoryTool, buildToolExecute } from "./memory/tools.ts";
export { detectAppId, detectRunId, resolveSearchFilters, resolveAddParams } from "./memory/scoping.ts";
export { formatAge, formatMemoryCompact, formatMemoryList, groupByCategory } from "./memory/formatting.ts";

export { setupAutoCapture, extractConversation } from "./capture/index.ts";

export {
  incrementSessionCount,
  checkCheapGates,
  checkMemoryGate,
  acquireDreamLock,
  releaseDreamLock,
  recordDreamCompletion,
} from "./dream/index.ts";
export { DREAM_PROTOCOL } from "./dream/prompt.ts";

export { MEMORY_POLICY } from "./prompt.ts";

export { registerCommands } from "./commands.ts";

export { OssMemoryClientAdapter } from "./oss/client.ts";
export { RuntimeHolder, makeLazyClient } from "./oss/runtime.ts";
export { Prefetch } from "./oss/prefetch.ts";
export { resolveOssLlm } from "./oss/model.ts";
export { classifyMemories } from "./oss/classify.ts";
export { resolveStoragePaths, expandHome } from "./oss/paths.ts";
export { activateRuntime } from "./oss/activate.ts";

export { default as mem0Extension } from "./entry.ts";

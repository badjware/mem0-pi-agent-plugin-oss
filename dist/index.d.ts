import { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import MemoryClient from 'mem0ai';
export { default as mem0Extension } from './entry.js';

type Scope = "project" | "session" | "global";
interface DreamConfig {
    enabled: boolean;
    auto: boolean;
    minHours: number;
    minSessions: number;
    minMemories: number;
}
interface OssBlock {
    llm: {
        model: string;
    };
    embedder?: {
        model?: string;
    };
}
interface Mem0Config {
    userId: string;
    autoCapture: boolean;
    defaultScope: Scope;
    contextInjection: boolean;
    searchThreshold: number;
    dream: DreamConfig;
    /** OSS runtime config; required for the runtime to activate. */
    oss?: OssBlock;
}
interface ScopeContext {
    userId: string;
    appId: string;
    runId: string;
}
interface CustomCategory {
    [key: string]: string;
}
declare const DEFAULT_CUSTOM_CATEGORIES: CustomCategory[];

declare const CONFIG_DIR: string;
declare const CONFIG_PATH: string;
/**
 * Load the OSS plugin config from ~/.pi/agent/mem0-oss-config.json, merged with
 * defaults. Malformed JSON is swallowed and defaults are used, matching upstream
 * behavior. Missing `oss.llm.model` is not caught here; runtime activation is
 * what fails fast when the model cannot be resolved.
 */
declare function loadConfig(): Mem0Config;

interface ToolParams {
    action: "search" | "add" | "get_all" | "update" | "delete" | "delete_all";
    query?: string;
    content?: string;
    memory_id?: string;
    scope?: Scope;
}
declare function buildToolExecute(mem0: MemoryClient, scopeCtx: ScopeContext, defaultScope: Scope): (params: ToolParams, signal?: AbortSignal) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    details: {
        matchCount: number;
        eventId?: undefined;
        status?: undefined;
        totalCount?: undefined;
        memoryId?: undefined;
    };
} | {
    content: {
        type: "text";
        text: string;
    }[];
    details: {
        eventId: string | null;
        status: string | null;
        matchCount?: undefined;
        totalCount?: undefined;
        memoryId?: undefined;
    };
} | {
    content: {
        type: "text";
        text: string;
    }[];
    details: {
        totalCount: number;
        matchCount?: undefined;
        eventId?: undefined;
        status?: undefined;
        memoryId?: undefined;
    };
} | {
    content: {
        type: "text";
        text: string;
    }[];
    details: {
        memoryId: string;
        matchCount?: undefined;
        eventId?: undefined;
        status?: undefined;
        totalCount?: undefined;
    };
} | {
    content: {
        type: "text";
        text: string;
    }[];
    details: {
        matchCount?: undefined;
        eventId?: undefined;
        status?: undefined;
        totalCount?: undefined;
        memoryId?: undefined;
    };
}>;
declare function registerMemoryTool(pi: ExtensionAPI, mem0: MemoryClient, config: Mem0Config, getScopeCtx: () => ScopeContext): void;

declare function detectAppId(cwd: string): string;
declare function detectRunId(sessionFile: string | undefined): string;
declare function resolveSearchFilters(scope: Scope, ctx: ScopeContext): Record<string, string>;
declare function resolveAddParams(scope: Scope, ctx: ScopeContext): Record<string, string>;

interface MemoryLike {
    id: string;
    memory?: string;
    categories?: string[];
    createdAt?: Date | string;
}
declare function formatAge(date: Date | string): string;
declare function formatMemoryCompact(mem: MemoryLike): string;
declare function formatMemoryList(memories: MemoryLike[]): string;
declare function groupByCategory(memories: MemoryLike[]): Map<string, MemoryLike[]>;

/** Minimal shape of a mem0ai/oss LLM used for classification. */
interface ClassifierLlm {
    generateResponse(messages: Array<{
        role: string;
        content: string;
    }>, response_format?: {
        type: string;
    }): Promise<any>;
}
interface MemoryToClassify {
    id: string;
    text: string;
}
/**
 * Best-effort classification of newly-added memories against a category
 * taxonomy. One LLM call, returning a map from memory id to category names.
 * Never throws; on parse or model failure, returns {} so callers can skip
 * updates and leave memories uncategorized.
 */
declare function classifyMemories(llm: ClassifierLlm, items: MemoryToClassify[], taxonomy: CustomCategory[]): Promise<Record<string, string[]>>;

/**
 * Minimal mem0ai/oss Memory surface used by this plugin. Typed loosely so we
 * do not couple the adapter to a specific version of the OSS SDK.
 */
interface OssMemoryLike {
    add(messages: any, options: any): Promise<{
        results: any[];
    }>;
    search(query: string, options?: any): Promise<{
        results: any[];
    }>;
    getAll(options?: any): Promise<{
        results: any[];
    }>;
    get(memoryId: string): Promise<any>;
    update(memoryId: string, patch: any): Promise<any>;
    delete(memoryId: string): Promise<{
        message: string;
    }>;
    deleteAll(options?: any): Promise<{
        message: string;
    }>;
}
declare class OssMemoryClientAdapter {
    private readonly mem0;
    private readonly llm;
    constructor(mem0: OssMemoryLike, llm: ClassifierLlm);
    add(messages: any, options?: any): Promise<any[]>;
    search(query: string, options?: any): Promise<{
        results: any[];
    }>;
    getAll(options?: any): Promise<{
        results: any[];
    }>;
    get(memoryId: string): Promise<any>;
    update(memoryId: string, patch: any): Promise<any>;
    delete(memoryId: string): Promise<{
        message: string;
    }>;
    deleteAll(options?: any): Promise<{
        message: string;
    }>;
}

interface OssRuntime {
    client: OssMemoryClientAdapter;
}
/**
 * Lazy holder for the OSS runtime. The extension factory registers tools,
 * commands, and hooks unconditionally against a proxy backed by this holder;
 * the actual runtime is constructed on session_start once ctx.modelRegistry is
 * available and can retry on later session_start events.
 */
declare class RuntimeHolder {
    private state;
    setActive(runtime: OssRuntime): void;
    setInactive(reason: string): void;
    isActive(): boolean;
    reason(): string | null;
    require(): OssRuntime;
}
/**
 * Build a MemoryClient-shaped proxy that routes each call through the holder.
 * Keeps upstream call sites unchanged: `mem0.search(...)` still works, but if
 * the runtime is inactive, the promise rejects with a clear reason.
 */
declare function makeLazyClient(holder: RuntimeHolder): any;

interface MessageLike {
    role: string;
    content?: unknown;
}
declare function extractConversation(messages: MessageLike[]): Array<{
    role: "user" | "assistant";
    content: string;
}>;
declare function setupAutoCapture(pi: ExtensionAPI, mem0: MemoryClient, config: Mem0Config, getScopeCtx: () => ScopeContext, holder: RuntimeHolder): void;

declare function incrementSessionCount(stateDir: string, sessionId: string): void;
declare function checkCheapGates(stateDir: string, config: Partial<DreamConfig>): {
    proceed: boolean;
    reason?: string;
};
declare function checkMemoryGate(memoryCount: number, config: Partial<DreamConfig>): {
    pass: boolean;
    reason?: string;
};
declare function acquireDreamLock(stateDir: string): boolean;
declare function releaseDreamLock(stateDir: string): void;
declare function recordDreamCompletion(stateDir: string): void;

declare const DREAM_PROTOCOL = "<mem0-dream>\nYou are running memory consolidation. Complete these steps using the mem0_memory tool:\n\n1. ORIENT \u2014 Call mem0_memory with action \"get_all\" to list all memories. Count by category. Note oldest/newest.\n\n2. GATHER TARGETS \u2014 Review each memory. Classify as:\n   - DELETE: sensitive information (API keys, passwords, tokens), expired/stale entries, noise, redundant operational details\n   - MERGE: near-duplicates (same fact stated differently). Keep the better-worded one, delete the other.\n   - REWRITE: vague, first-person, or poorly-categorized entries. Use mem0_memory \"add\" with improved text, then \"delete\" the old one.\n   - KEEP: everything else.\n   Skip any memory starting with \"[PINNED]\".\n\n3. CONSOLIDATE \u2014 Execute the changes:\n   - Delete stale/duplicate entries\n   - For merges: add the merged text, delete both originals\n   - For rewrites: add improved version, delete original\n\n4. REPORT \u2014 Summarize: how many reviewed, deleted, merged, rewritten, final count.\n\nQuality targets: zero sensitive data stored, zero duplicates, all entries are atomic (one fact each), 15-50 words each.\nAfter consolidation, respond to the user's message normally.\n</mem0-dream>";

declare const MEMORY_POLICY = "<mem0-memory-policy>\nYou have persistent semantic memory via the mem0_memory tool, powered by Mem0. Relevant memories may be auto-injected under <mem0-relevant-memories>, but that retrieval is shallow \u2014 treat it as a starting point, not the full picture.\n\nBe proactive about retrieval:\n- Search memory BEFORE answering whenever the request could depend on the user's past work, preferences, decisions, environment, or anything they told you earlier \u2014 don't wait to be asked.\n- Check memory before asking the user something they may have already told you.\n- For multi-part, comparative, or \"how did we\u2026\" questions, run SEVERAL searches with different phrasings and combine the results. One search is rarely enough \u2014 keep going until you have what you need (multi-hop).\n\nBe proactive about saving:\n- Save important facts, preferences, goals, decisions, lessons learned, identity, relationships, and routines the user shares.\n\nScope (do not change unless explicitly asked):\n- \"project\" (default): memories for this project \u2014 use for all normal queries\n- \"session\": memories from this session only\n- \"global\": all memories across projects \u2014 ONLY when the user explicitly asks for cross-project search\n\nMemory persists across sessions and devices via Mem0's cloud.\n</mem0-memory-policy>";

declare function registerCommands(pi: ExtensionAPI, mem0: MemoryClient, config: Mem0Config, getScopeCtx: () => ScopeContext, holder: RuntimeHolder): void;

/**
 * Two-phase prefetch: `queue()` kicks off the fetch on `input` while the user
 * is still assembling the turn, `consume()` races the in-flight promise against
 * a timeout on `before_agent_start`. Slow local embedding/search degrades to
 * "no recall this turn" instead of blocking the turn.
 */
declare class Prefetch<T> {
    private pending;
    queue(fn: () => Promise<T>): void;
    consume(timeoutMs: number, fallback: T): Promise<T>;
}

/**
 * Resolve a pi model identifier (e.g. "ollama/qwen3.5:4b") into a mem0ai/oss
 * LLM config block. Auth headers/env returned by getApiKeyAndHeaders() are
 * ignored in this first version; only apiKey and baseUrl are forwarded.
 */
interface ResolvedOssLlm {
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
    getApiKeyAndHeaders(model: any): Promise<{
        ok: true;
        apiKey?: string;
        headers?: Record<string, string>;
        env?: Record<string, string>;
    } | {
        ok: false;
        error: string;
    }>;
}
declare function resolveOssLlm(modelId: string, registry: ModelRegistryLike): Promise<ResolvedOssLlm>;

/** Expand a leading `~` and resolve to an absolute path. */
declare function expandHome(p: string): string;
interface ResolvedStoragePaths {
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
declare function resolveStoragePaths(): ResolvedStoragePaths;

/**
 * Build the mem0ai/oss Memory instance and wrap it in the plugin adapter.
 * Throws with a human-readable reason on any failure so the caller can put the
 * runtime in `inactive` state and surface the reason via `ctx.ui.notify`.
 */
declare function activateRuntime(config: Mem0Config, modelRegistry: any): Promise<{
    client: OssMemoryClientAdapter;
}>;

export { CONFIG_DIR, CONFIG_PATH, type CustomCategory, DEFAULT_CUSTOM_CATEGORIES, DREAM_PROTOCOL, type DreamConfig, MEMORY_POLICY, type Mem0Config, type OssBlock, OssMemoryClientAdapter, Prefetch, RuntimeHolder, type Scope, type ScopeContext, acquireDreamLock, activateRuntime, buildToolExecute, checkCheapGates, checkMemoryGate, classifyMemories, detectAppId, detectRunId, expandHome, extractConversation, formatAge, formatMemoryCompact, formatMemoryList, groupByCategory, incrementSessionCount, loadConfig, makeLazyClient, recordDreamCompletion, registerCommands, registerMemoryTool, releaseDreamLock, resolveAddParams, resolveOssLlm, resolveSearchFilters, resolveStoragePaths, setupAutoCapture };

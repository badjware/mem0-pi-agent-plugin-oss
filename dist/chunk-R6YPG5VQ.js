// src/oss/config.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
var AGENT_ROOT = path.join(os.homedir(), ".pi", "agent");
var CONFIG_DIR = AGENT_ROOT;
var CONFIG_PATH = path.join(AGENT_ROOT, "mem0-oss-config.json");
var DEFAULT_DREAM = {
  enabled: true,
  auto: true,
  minHours: 24,
  minSessions: 5,
  minMemories: 20
};
var DEFAULT_CONFIG = {
  userId: "",
  autoCapture: true,
  defaultScope: "project",
  contextInjection: true,
  searchThreshold: 0.3,
  dream: DEFAULT_DREAM
};
function normalizeStr(value) {
  if (typeof value !== "string" || value === "") return void 0;
  return value;
}
function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      fileConfig = JSON.parse(raw);
    } catch {
    }
  }
  const dream = {
    ...DEFAULT_DREAM,
    ...fileConfig.dream ?? {}
  };
  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    dream
  };
  if (process.env.MEM0_USER_ID) {
    config.userId = process.env.MEM0_USER_ID;
  }
  if (process.env.MEM0_OSS_LLM_MODEL) {
    config.oss = {
      ...config.oss ?? {},
      llm: { model: process.env.MEM0_OSS_LLM_MODEL }
    };
  }
  const embedderModel = normalizeStr(process.env.MEM0_OSS_EMBEDDER_MODEL) ?? normalizeStr(fileConfig.oss?.embedder?.model);
  if (embedderModel !== void 0) {
    config.oss = {
      ...config.oss ?? {},
      embedder: { model: embedderModel }
    };
  } else if (config.oss?.embedder) {
    const { embedder, ...rest } = config.oss;
    config.oss = rest;
  }
  return config;
}

// src/memory/scoping.ts
import * as path2 from "path";
import * as crypto from "crypto";
import { execFileSync } from "child_process";
function detectAppId(cwd) {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      timeout: 3e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return path2.basename(root);
  } catch {
    return path2.basename(cwd);
  }
}
function detectRunId(sessionFile) {
  if (!sessionFile) return "unknown";
  return crypto.createHash("sha256").update(sessionFile).digest("hex").slice(0, 12);
}
function resolveSearchFilters(scope, ctx) {
  switch (scope) {
    case "project":
      return { user_id: ctx.userId, app_id: ctx.appId };
    case "session":
      return { user_id: ctx.userId, app_id: ctx.appId, run_id: ctx.runId };
    case "global":
      return { user_id: ctx.userId, app_id: "*" };
  }
}
function resolveAddParams(scope, ctx) {
  switch (scope) {
    case "project":
      return { userId: ctx.userId, appId: ctx.appId };
    case "session":
      return { userId: ctx.userId, appId: ctx.appId, runId: ctx.runId };
    case "global":
      return { userId: ctx.userId };
  }
}

// src/memory/formatting.ts
function formatAge(date) {
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 6e4);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function formatMemoryCompact(mem) {
  const cat = mem.categories?.[0] ?? "uncategorized";
  const age = mem.createdAt ? ` (${formatAge(mem.createdAt)})` : "";
  return `[${cat}] ${mem.memory ?? "(empty)"}${age} [mem0:${mem.id}]`;
}
function formatMemoryList(memories) {
  if (memories.length === 0) return "No memories found.";
  return memories.map((m, i) => `${i + 1}. ${formatMemoryCompact(m)}`).join("\n");
}
function groupByCategory(memories) {
  const groups = /* @__PURE__ */ new Map();
  for (const m of memories) {
    const cat = m.categories?.[0] ?? "uncategorized";
    const list = groups.get(cat) ?? [];
    list.push(m);
    groups.set(cat, list);
  }
  return groups;
}

// src/memory/tools.ts
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

// src/types.ts
var DEFAULT_CUSTOM_CATEGORIES = [
  { identity: "Personal details, background, and self-descriptions" },
  { preferences: "Likes, dislikes, habits, and preferred ways of doing things" },
  { goals: "Objectives, aspirations, and targets the user is working toward" },
  { projects: "Ongoing work, initiatives, and areas of focus" },
  { decisions: "Choices made, rationale, and trade-offs considered" },
  { technical: "Technical knowledge, tools, configurations, and environment details" },
  { relationships: "People, teams, organizations, and their roles" },
  { routines: "Recurring patterns, workflows, schedules, and processes" },
  { lessons: "Insights learned, mistakes to avoid, and best practices discovered" },
  { work: "Professional context, role, responsibilities, and work environment" }
];

// src/oss/constants.ts
var UNBOUNDED_TOP_K = 1e6;
var FASTEMBED_PROVIDER = "fastembed";
var FASTEMBED_MODEL = "fast-bge-small-en-v1.5";
var FASTEMBED_DIMENSION = 384;

// src/memory/tools.ts
var MAX_OUTPUT_LINES = 200;
var MAX_OUTPUT_BYTES = 5e4;
function truncateOutput(text) {
  const lines = text.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES && text.length <= MAX_OUTPUT_BYTES) {
    return text;
  }
  const kept = lines.slice(0, MAX_OUTPUT_LINES);
  let result = kept.join("\n");
  if (result.length > MAX_OUTPUT_BYTES) {
    result = result.slice(0, MAX_OUTPUT_BYTES);
  }
  const dropped = lines.length - kept.length;
  if (dropped > 0 || text.length > MAX_OUTPUT_BYTES) {
    result += `

[Output truncated: showing ${kept.length} of ${lines.length} lines]`;
  }
  return result;
}
function buildToolExecute(mem0, scopeCtx, defaultScope) {
  return async (params, signal) => {
    const scope = params.scope ?? defaultScope;
    switch (params.action) {
      case "search": {
        if (signal?.aborted) throw new Error("Cancelled");
        if (!params.query) throw new Error("query is required for search");
        const filters = resolveSearchFilters(scope, scopeCtx);
        const result = await mem0.search(params.query, { filters });
        const memories = result.results ?? [];
        return {
          content: [{ type: "text", text: truncateOutput(formatMemoryList(memories)) }],
          details: { matchCount: memories.length }
        };
      }
      case "add": {
        if (signal?.aborted) throw new Error("Cancelled");
        if (!params.content) throw new Error("content is required for add");
        const addParams = resolveAddParams(scope, scopeCtx);
        const result = await mem0.add(
          [{ role: "user", content: params.content }],
          { ...addParams, customCategories: DEFAULT_CUSTOM_CATEGORIES }
        );
        const res = result;
        const msg = res.message ?? "Memory stored.";
        return {
          content: [{ type: "text", text: msg }],
          details: { eventId: res.eventId ?? null, status: res.status ?? null }
        };
      }
      case "get_all": {
        if (signal?.aborted) throw new Error("Cancelled");
        const filters = resolveSearchFilters(scope, scopeCtx);
        const options = { filters, topK: UNBOUNDED_TOP_K };
        const result = await mem0.getAll(options);
        const memories = result.results ?? [];
        return {
          content: [{ type: "text", text: truncateOutput(formatMemoryList(memories)) }],
          details: { totalCount: result.count ?? memories.length }
        };
      }
      case "update": {
        if (signal?.aborted) throw new Error("Cancelled");
        if (!params.memory_id) throw new Error("memory_id is required for update");
        if (!params.content) throw new Error("content is required for update");
        const updateResult = await mem0.update(params.memory_id, { text: params.content });
        const res = updateResult;
        return {
          content: [{ type: "text", text: res.status ?? "Memory updated." }],
          details: { memoryId: params.memory_id }
        };
      }
      case "delete": {
        if (signal?.aborted) throw new Error("Cancelled");
        if (!params.memory_id) throw new Error("memory_id is required for delete");
        const result = await mem0.delete(params.memory_id);
        return {
          content: [{ type: "text", text: result.message ?? "Memory deleted." }],
          details: {}
        };
      }
      case "delete_all": {
        if (signal?.aborted) throw new Error("Cancelled");
        const delParams = resolveAddParams(scope, scopeCtx);
        const result = await mem0.deleteAll(delParams);
        return {
          content: [{ type: "text", text: result.message ?? "All memories deleted." }],
          details: {}
        };
      }
    }
  };
}
function registerMemoryTool(pi, mem0, config, getScopeCtx) {
  pi.registerTool({
    name: "mem0_memory",
    label: "Mem0 Memory",
    description: 'Search, add, update, and manage persistent semantic memories powered by Mem0. Memories persist across sessions and devices. Use action "search" proactively -- before answering anything that may depend on what the user told you earlier -- and run multiple searches with different phrasings for multi-part questions. Output is truncated to 200 lines / 50KB.',
    promptSnippet: "Semantic memory search and storage via Mem0",
    promptGuidelines: [
      `Use mem0_memory with action "search" proactively whenever the request may depend on the user's past work, preferences, decisions, or environment -- not only when they explicitly mention the past`,
      "For multi-part or comparative questions, run several searches with different phrasings and combine the results before answering -- one search is rarely enough",
      'Use mem0_memory with action "add" to save important facts, preferences, goals, decisions, or lessons the user shares',
      'Use mem0_memory with action "update" to modify an existing memory \u2014 requires memory_id and content. Preserves the memory ID',
      'Always use the default project scope unless the user EXPLICITLY asks to search across all projects \u2014 only then use scope "global"',
      "Do NOT pass scope at all for normal queries \u2014 omitting it uses the project default automatically"
    ],
    parameters: Type.Object({
      action: StringEnum(
        [
          "search",
          "add",
          "get_all",
          "update",
          "delete",
          "delete_all"
        ],
        {
          description: `Memory operation to run: "search" (semantic recall -- use proactively before answering; run several with different phrasings for multi-part questions), "add" (save a new fact/preference/decision), "get_all" (list everything in scope, no query needed), "update" (replace an existing memory's text by id), "delete" (remove one memory by id), "delete_all" (wipe every memory in the scope -- destructive, only on explicit request).`
        }
      ),
      query: Type.Optional(
        Type.String({
          description: 'Search text -- required for action "search". Use a focused noun-phrase; for multi-part questions run several searches with different phrasings.'
        })
      ),
      content: Type.Optional(
        Type.String({
          description: 'Memory text -- required for action "add" (the fact to store) and "update" (the replacement text).'
        })
      ),
      memory_id: Type.Optional(
        Type.String({
          description: `Target memory's ID -- required for "update" and "delete". Use an ID returned by a prior "search" or "get_all".`
        })
      ),
      scope: Type.Optional(
        StringEnum(["project", "session", "global"], {
          description: 'Where to read/write: "project" (default -- this repo), "session" (this run only), or "global" (across ALL projects; only when the user explicitly wants cross-project recall). Omit for normal queries.'
        })
      )
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const scopeCtx = getScopeCtx();
      const exec = buildToolExecute(mem0, scopeCtx, config.defaultScope);
      return await exec(params, signal);
    }
  });
}

// src/dream/prompt.ts
var DREAM_PROTOCOL = `<mem0-dream>
You are running memory consolidation. Complete these steps using the mem0_memory tool:

1. ORIENT \u2014 Call mem0_memory with action "get_all" to list all memories. Count by category. Note oldest/newest.

2. GATHER TARGETS \u2014 Review each memory. Classify as:
   - DELETE: sensitive information (API keys, passwords, tokens), expired/stale entries, noise, redundant operational details
   - MERGE: near-duplicates (same fact stated differently). Keep the better-worded one, delete the other.
   - REWRITE: vague, first-person, or poorly-categorized entries. Use mem0_memory "add" with improved text, then "delete" the old one.
   - KEEP: everything else.
   Skip any memory starting with "[PINNED]".

3. CONSOLIDATE \u2014 Execute the changes:
   - Delete stale/duplicate entries
   - For merges: add the merged text, delete both originals
   - For rewrites: add improved version, delete original

4. REPORT \u2014 Summarize: how many reviewed, deleted, merged, rewritten, final count.

Quality targets: zero sensitive data stored, zero duplicates, all entries are atomic (one fact each), 15-50 words each.
After consolidation, respond to the user's message normally.
</mem0-dream>`;

// src/dream/index.ts
import * as fs2 from "fs";
import * as path3 from "path";
var LOCK_STALE_MS = 60 * 60 * 1e3;
var DEFAULTS = {
  enabled: true,
  auto: true,
  minHours: 24,
  minSessions: 5,
  minMemories: 20
};
function statePath(stateDir) {
  return path3.join(stateDir, "mem0-dream-state.json");
}
function lockPath(stateDir) {
  return path3.join(stateDir, "mem0-dream.lock");
}
function ensureDir(dir) {
  try {
    fs2.mkdirSync(dir, { recursive: true });
  } catch {
  }
}
function readState(stateDir) {
  try {
    const raw = fs2.readFileSync(statePath(stateDir), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastConsolidatedAt: 0, sessionsSince: 0, lastSessionId: null };
  }
}
function writeState(stateDir, state) {
  ensureDir(stateDir);
  fs2.writeFileSync(statePath(stateDir), JSON.stringify(state, null, 2));
}
function incrementSessionCount(stateDir, sessionId) {
  const state = readState(stateDir);
  if (state.lastSessionId !== sessionId) {
    state.sessionsSince++;
    state.lastSessionId = sessionId;
    writeState(stateDir, state);
  }
}
function checkCheapGates(stateDir, config) {
  const minHours = config.minHours ?? DEFAULTS.minHours;
  const minSessions = config.minSessions ?? DEFAULTS.minSessions;
  const state = readState(stateDir);
  const hoursSince = (Date.now() - state.lastConsolidatedAt) / 36e5;
  if (hoursSince < minHours) {
    return { proceed: false, reason: `time: ${hoursSince.toFixed(1)}h < ${minHours}h` };
  }
  if (state.sessionsSince < minSessions) {
    return { proceed: false, reason: `sessions: ${state.sessionsSince} < ${minSessions}` };
  }
  return { proceed: true };
}
function checkMemoryGate(memoryCount, config) {
  const minMemories = config.minMemories ?? DEFAULTS.minMemories;
  if (memoryCount < minMemories) {
    return { pass: false, reason: `memories: ${memoryCount} < ${minMemories}` };
  }
  return { pass: true };
}
function acquireDreamLock(stateDir) {
  ensureDir(stateDir);
  const lp = lockPath(stateDir);
  try {
    const raw = fs2.readFileSync(lp, "utf-8");
    const lock2 = JSON.parse(raw);
    if (Date.now() - lock2.startedAt < LOCK_STALE_MS) {
      return false;
    }
    try {
      fs2.unlinkSync(lp);
    } catch {
    }
  } catch {
  }
  const lock = { pid: process.pid, startedAt: Date.now() };
  try {
    fs2.writeFileSync(lp, JSON.stringify(lock), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
function releaseDreamLock(stateDir) {
  try {
    fs2.unlinkSync(lockPath(stateDir));
  } catch {
  }
}
function recordDreamCompletion(stateDir) {
  const state = readState(stateDir);
  state.lastConsolidatedAt = Date.now();
  state.sessionsSince = 0;
  state.lastSessionId = null;
  writeState(stateDir, state);
}

// src/oss/classify.ts
function taxonomyToPrompt(taxonomy) {
  return taxonomy.map((entry) => {
    const [name, description] = Object.entries(entry)[0] ?? ["", ""];
    return `- ${name}: ${description}`;
  }).join("\n");
}
function buildPrompt(items, taxonomy) {
  const taxonomyText = taxonomyToPrompt(taxonomy);
  const memoriesText = items.map((m) => `id: ${m.id}
text: ${m.text}`).join("\n---\n");
  return [
    "Classify each memory below into zero or more of these categories.",
    "Only use category names from the taxonomy exactly as listed. If none fit, return an empty array for that memory.",
    "",
    "TAXONOMY:",
    taxonomyText,
    "",
    "MEMORIES:",
    memoriesText,
    "",
    'Return strict JSON: {"assignments": {"<memoryId>": ["<category>", ...], ...}}. Include every memory id, even ones with an empty array.'
  ].join("\n");
}
function extractContent(response) {
  if (typeof response === "string") return response;
  if (response?.content && typeof response.content === "string") return response.content;
  return "";
}
function parseAssignments(raw, allowed) {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  try {
    const parsed = JSON.parse(text);
    const assignments = parsed?.assignments ?? parsed;
    if (!assignments || typeof assignments !== "object") return {};
    const out = {};
    for (const [id, cats] of Object.entries(assignments)) {
      if (!Array.isArray(cats)) continue;
      const filtered = cats.filter(
        (c) => typeof c === "string" && allowed.has(c)
      );
      out[id] = filtered;
    }
    return out;
  } catch {
    return {};
  }
}
async function classifyMemories(llm, items, taxonomy) {
  if (items.length === 0 || taxonomy.length === 0) return {};
  const allowed = new Set(
    taxonomy.flatMap((entry) => Object.keys(entry))
  );
  const prompt = buildPrompt(items, taxonomy);
  try {
    const response = await llm.generateResponse(
      [
        {
          role: "system",
          content: "You are a strict JSON classifier. Respond with JSON only, no prose."
        },
        { role: "user", content: prompt }
      ],
      { type: "json_object" }
    );
    return parseAssignments(extractContent(response), allowed);
  } catch {
    return {};
  }
}

// src/oss/client.ts
function liftCategories(mem) {
  const cats = mem?.metadata?.categories;
  if (Array.isArray(cats) && !mem.categories) {
    mem.categories = cats;
  }
  return mem;
}
function translateEntityOptions(options) {
  if (!options) return options;
  const out = { ...options };
  if ("appId" in out) {
    if (out.appId && out.appId !== "*") out.agentId = out.appId;
    delete out.appId;
  }
  if (out.filters) {
    const filters = { ...out.filters };
    if ("app_id" in filters) {
      if (filters.app_id && filters.app_id !== "*") filters.agent_id = filters.app_id;
      delete filters.app_id;
    }
    out.filters = filters;
  }
  return out;
}
var OssMemoryClientAdapter = class {
  constructor(mem0, llm) {
    this.mem0 = mem0;
    this.llm = llm;
  }
  mem0;
  llm;
  async add(messages, options = {}) {
    const { customCategories, ...rest } = options;
    const translated = translateEntityOptions(rest);
    const { results } = await this.mem0.add(messages, translated);
    const newItems = results.filter((r) => r?.metadata?.event === "ADD");
    if (customCategories && customCategories.length > 0 && newItems.length > 0) {
      const assignments = await classifyMemories(
        this.llm,
        newItems.map((r) => ({ id: r.id, text: r.memory })),
        customCategories
      );
      await Promise.allSettled(
        newItems.filter((r) => assignments[r.id]?.length).map(
          (r) => this.mem0.update(r.id, { metadata: { categories: assignments[r.id] } })
        )
      );
      for (const r of newItems) {
        const cats = assignments[r.id];
        if (cats?.length) {
          r.categories = cats;
          r.metadata = { ...r.metadata ?? {}, categories: cats };
        }
      }
    }
    return results;
  }
  async search(query, options) {
    const translated = translateEntityOptions(options);
    const res = await this.mem0.search(query, translated);
    return { results: (res.results ?? []).map(liftCategories) };
  }
  async getAll(options) {
    const translated = translateEntityOptions(options);
    const res = await this.mem0.getAll(translated);
    return { results: (res.results ?? []).map(liftCategories) };
  }
  async get(memoryId) {
    const mem = await this.mem0.get(memoryId);
    return mem ? liftCategories(mem) : mem;
  }
  async update(memoryId, patch) {
    return this.mem0.update(memoryId, patch);
  }
  async delete(memoryId) {
    return this.mem0.delete(memoryId);
  }
  async deleteAll(options) {
    return this.mem0.deleteAll(translateEntityOptions(options));
  }
};

// src/oss/model.ts
function mapProvider(model) {
  if (model.provider === "ollama") return { provider: "ollama" };
  switch (model.api) {
    case "openai-completions":
      return { provider: "openai" };
    case "anthropic-messages":
      return { provider: "anthropic" };
    default:
      return {
        error: `unsupported model api "${model.api}" for provider "${model.provider}"; only ollama, openai-completions, and anthropic-messages are supported`
      };
  }
}
async function resolveOssLlm(modelId, registry) {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    throw new Error(
      `oss.llm.model must use "provider/model" syntax, got "${modelId}"`
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
  const baseUrl = model.baseUrl;
  const config = { model: id };
  if (auth.apiKey) config.apiKey = auth.apiKey;
  if (baseUrl) {
    config.baseURL = baseUrl;
    if (mapped.provider === "ollama") config.url = baseUrl;
  }
  return { provider: mapped.provider, config };
}

// src/oss/embedder.ts
function mapEmbedderProvider(model) {
  if (model.provider === "ollama") return { provider: "ollama" };
  switch (model.api) {
    case "openai-completions":
      return { provider: "openai" };
    default:
      return {
        error: `unsupported embedder api "${model.api}" for provider "${model.provider}"; only ollama and openai-completions are supported`
      };
  }
}
async function resolveOssEmbedder(modelId, registry) {
  if (!modelId) return null;
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    throw new Error(
      `oss.embedder.model must use "provider/model" syntax, got "${modelId}"`
    );
  }
  const provider = modelId.slice(0, slash);
  const model = modelId.slice(slash + 1);
  const found = registry.getAll().find((m) => m.provider === provider);
  if (!found) {
    throw new Error(
      `embedder provider "${provider}" is not registered in pi's model registry`
    );
  }
  const mapped = mapEmbedderProvider(found);
  if ("error" in mapped) throw new Error(mapped.error);
  const auth = await registry.getApiKeyAndHeaders(found);
  if (!auth.ok) {
    throw new Error(
      `credentials for embedder provider "${provider}" are unavailable: ${auth.error}`
    );
  }
  const baseUrl = found.baseUrl;
  const config = { model };
  if (mapped.provider === "ollama") {
    if (baseUrl) config.url = baseUrl;
  } else {
    if (auth.apiKey) config.apiKey = auth.apiKey;
    if (baseUrl) config.baseURL = baseUrl;
  }
  return { provider: mapped.provider, config, model };
}

// src/oss/paths.ts
import * as fs3 from "fs";
import * as os2 from "os";
import * as path4 from "path";
function expandHome(p) {
  if (p === "~") return os2.homedir();
  if (p.startsWith("~/")) return path4.join(os2.homedir(), p.slice(2));
  return path4.resolve(p);
}
function resolveStoragePaths() {
  const memoriesDir = expandHome("~/.pi/agent/memories");
  fs3.mkdirSync(memoriesDir, { recursive: true });
  return {
    memoriesDir,
    vectorDbPath: path4.join(memoriesDir, "mem0-vectors.db"),
    historyDbPath: path4.join(memoriesDir, "mem0-history.db"),
    fastembedCacheDir: path4.join(memoriesDir, "fastembed-cache"),
    embedderMetadataPath: path4.join(memoriesDir, "mem0-embedder.json")
  };
}

// src/oss/embedder-metadata.ts
import * as fs4 from "fs";
function readMetadata(path5) {
  let raw;
  try {
    raw = fs4.readFileSync(path5, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `embedder metadata file at "${path5}" is malformed JSON; delete it and run /mem0-reindex to regenerate it`
    );
  }
}
function writeMetadata(path5, metadata) {
  fs4.writeFileSync(path5, JSON.stringify(metadata, null, 2) + "\n", "utf8");
}
function compareMetadata(existing, current) {
  const mismatches = [];
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
    reason: `embedder configuration changed (${mismatches.join(", ")}); run /mem0-reindex to re-embed existing memories with the new embedder`
  };
}

// src/oss/activate.ts
async function buildRuntime(config, modelRegistry, paths, existingMetadata) {
  const modelId = config.oss?.llm?.model;
  if (!modelId) {
    throw new Error(
      'oss.llm.model is not set in ~/.pi/agent/mem0-oss-config.json (or MEM0_OSS_LLM_MODEL); mem0 needs an explicit extraction model like "ollama/qwen3.5:4b"'
    );
  }
  const llm = await resolveOssLlm(modelId, modelRegistry);
  const oss = await import("mem0ai/oss");
  const { Memory, LLMFactory, EmbedderFactory } = oss;
  const resolvedEmbedder = await resolveOssEmbedder(
    config.oss?.embedder?.model,
    modelRegistry
  );
  let embedderBlock;
  let currentIdentity;
  let dimension;
  if (resolvedEmbedder === null) {
    const { FlagEmbedding } = await import("fastembed");
    const flagEmbedding = await FlagEmbedding.init({
      model: FASTEMBED_MODEL,
      cacheDir: paths.fastembedCacheDir
    });
    const embedOne = async (text) => {
      const normalized = text.replace(/\n/g, " ");
      for await (const batch of flagEmbedding.embed([normalized])) {
        const v = batch[0];
        if (v !== void 0) return Array.from(v);
      }
      throw new Error("FastEmbed embed() returned no embeddings");
    };
    const fastembedLangchainShim = {
      embedQuery: embedOne,
      embedDocuments: async (texts) => Promise.all(texts.map(embedOne))
    };
    embedderBlock = { provider: "langchain", config: { model: fastembedLangchainShim } };
    currentIdentity = { provider: FASTEMBED_PROVIDER, model: FASTEMBED_MODEL };
    dimension = FASTEMBED_DIMENSION;
  } else {
    embedderBlock = { provider: resolvedEmbedder.provider, config: resolvedEmbedder.config };
    currentIdentity = { provider: resolvedEmbedder.provider, model: resolvedEmbedder.model };
    if (existingMetadata) {
      dimension = existingMetadata.dimension;
    } else {
      const probeEmbedder = EmbedderFactory.create(resolvedEmbedder.provider, resolvedEmbedder.config);
      try {
        const probeVector = await probeEmbedder.embed("probe");
        dimension = probeVector.length;
      } catch (err) {
        throw new Error(
          `failed to determine embedder dimension via probe embed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  const currentIdentityWithDimension = { ...currentIdentity, dimension };
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
        dimension
      }
    },
    historyDbPath: paths.historyDbPath,
    historyStore: {
      provider: "sqlite",
      config: { historyDbPath: paths.historyDbPath }
    },
    llm
  };
  const memory = new Memory(ossConfig);
  const llmClient = LLMFactory.create(llm.provider, llm.config);
  const client = new OssMemoryClientAdapter(memory, llmClient);
  return { client, identity: currentIdentity, dimension };
}
async function activateRuntime(config, modelRegistry) {
  const paths = resolveStoragePaths();
  const existingMetadata = readMetadata(paths.embedderMetadataPath);
  const { client, identity, dimension } = await buildRuntime(config, modelRegistry, paths, existingMetadata);
  if (!existingMetadata) {
    writeMetadata(paths.embedderMetadataPath, { ...identity, dimension });
  }
  return { client };
}
async function buildRuntimeForReindex(config, modelRegistry) {
  const paths = resolveStoragePaths();
  const { client, identity, dimension } = await buildRuntime(config, modelRegistry, paths, null);
  return { client, metadata: { ...identity, dimension } };
}

// src/commands.ts
var SEARCH_TOP_K = 10;
function registerCommands(pi, mem0, config, getScopeCtx, holder) {
  const sendFeedback = (customType, content) => {
    pi.sendMessage({ customType, content, display: true });
  };
  const requireActive = (ctx) => {
    if (holder.isActive()) return true;
    ctx.ui.notify(`[mem0] runtime inactive: ${holder.reason()}`, "error");
    return false;
  };
  const pluralize = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const searchMemories = async (query, scope) => {
    const filters = resolveSearchFilters(scope, getScopeCtx());
    const result = await mem0.search(query, {
      filters,
      threshold: config.searchThreshold,
      topK: SEARCH_TOP_K,
      rerank: true
    });
    return result.results ?? [];
  };
  pi.registerCommand("mem0-remember", {
    description: "Store a memory verbatim (no inference)",
    handler: async (args, ctx) => {
      const text = args?.trim();
      if (!text) {
        ctx.ui.notify("Usage: /mem0-remember <text>", "warning");
        return;
      }
      if (!requireActive(ctx)) return;
      const addParams = resolveAddParams(config.defaultScope, getScopeCtx());
      const result = await mem0.add(
        [{ role: "user", content: text }],
        { ...addParams, customCategories: DEFAULT_CUSTOM_CATEGORIES, infer: false }
      );
      const storedItems = (Array.isArray(result) ? result : []).map((m) => m.memory).filter((m) => Boolean(m));
      const items = storedItems.length > 0 ? storedItems : [text];
      sendFeedback(
        "mem0-remember",
        [`**Stored to ${config.defaultScope} memory**`, ...items.map((m) => `- ${m}`)].join("\n")
      );
    }
  });
  pi.registerCommand("mem0-forget", {
    description: "Delete memories matching a natural language query",
    handler: async (args, ctx) => {
      const query = args?.trim();
      if (!query) {
        ctx.ui.notify("Usage: /mem0-forget <query>", "warning");
        return;
      }
      if (!requireActive(ctx)) return;
      const memories = await searchMemories(query, config.defaultScope);
      if (memories.length === 0) {
        sendFeedback("mem0-forget", `**No matches for "${query}"** \u2014 nothing to forget.`);
        return;
      }
      const forgotten = (mem) => {
        sendFeedback(
          "mem0-forget",
          [`**Forgotten from ${config.defaultScope} memory**`, `- ${formatMemoryCompact(mem)}`].join("\n")
        );
      };
      if (memories.length === 1) {
        const target2 = memories[0];
        const confirmed = await ctx.ui.confirm("Delete this memory?", formatMemoryCompact(target2));
        if (!confirmed) {
          sendFeedback("mem0-forget", "**Cancelled** \u2014 no memories deleted.");
          return;
        }
        await mem0.delete(target2.id);
        forgotten(target2);
        return;
      }
      const labels = memories.map((m) => formatMemoryCompact(m));
      const selected = await ctx.ui.select(
        `Found ${pluralize(memories.length, "match", "matches")} for "${query}" \u2014 which should I delete?`,
        labels
      );
      if (!selected) {
        sendFeedback("mem0-forget", "**Cancelled** \u2014 no memories deleted.");
        return;
      }
      const idx = labels.indexOf(selected);
      if (idx < 0) return;
      const target = memories[idx];
      await mem0.delete(target.id);
      forgotten(target);
    }
  });
  pi.registerCommand("mem0-search", {
    description: "Semantic search across memories",
    handler: async (args, ctx) => {
      const query = args?.trim();
      if (!query) {
        ctx.ui.notify("Usage: /mem0-search <query>", "warning");
        return;
      }
      if (!requireActive(ctx)) return;
      const memories = await searchMemories(query, config.defaultScope);
      if (memories.length === 0) {
        sendFeedback("mem0-search", `**No matches for "${query}"** \xB7 ${config.defaultScope} scope`);
        return;
      }
      sendFeedback(
        "mem0-search",
        [
          `**${pluralize(memories.length, "match", "matches")} for "${query}"** \xB7 ${config.defaultScope} scope`,
          "",
          formatMemoryList(memories)
        ].join("\n")
      );
    }
  });
  pi.registerCommand("mem0-tour", {
    description: "Browse all memories grouped by category",
    handler: async (args, ctx) => {
      const raw = args?.trim().toLowerCase();
      const validScopes = ["project", "session", "global"];
      if (raw && !validScopes.includes(raw)) {
        ctx.ui.notify(`Invalid scope "${raw}". Must be one of: ${validScopes.join(", ")}`, "warning");
        return;
      }
      if (!requireActive(ctx)) return;
      const scope = raw || config.defaultScope;
      const filters = resolveSearchFilters(scope, getScopeCtx());
      const options = { filters, topK: UNBOUNDED_TOP_K };
      const result = await mem0.getAll(options);
      const memories = result.results ?? [];
      if (memories.length === 0) {
        sendFeedback("mem0-tour", `**No memories in ${scope} scope yet** \u2014 store one with \`/mem0-remember\`.`);
        return;
      }
      const groups = groupByCategory(memories);
      const lines = [
        `**Memory tour** \xB7 ${pluralize(memories.length, "memory", "memories")} \xB7 ${scope} scope`,
        ""
      ];
      for (const [category, items] of groups) {
        lines.push(`### ${category} (${items.length})`);
        for (const m of items) {
          lines.push(`- ${formatMemoryCompact(m)}`);
        }
        lines.push("");
      }
      sendFeedback("mem0-tour", lines.join("\n"));
    }
  });
  pi.registerCommand("mem0-dream", {
    description: "Consolidate memories \u2014 merge duplicates, prune stale entries, resolve contradictions",
    handler: async (_args, ctx) => {
      if (!requireActive(ctx)) return;
      if (!acquireDreamLock(CONFIG_DIR)) {
        ctx.ui.notify("A dream consolidation is already in progress.", "warning");
        return;
      }
      pi.sendMessage({ customType: "mem0-dream", content: DREAM_PROTOCOL, display: false }, { triggerTurn: true });
      sendFeedback(
        "mem0-dream",
        "**Dreaming** \u2014 reviewing your memories to merge duplicates, resolve contradictions, and prune stale entries. I'll report what changed."
      );
    }
  });
  pi.registerCommand("mem0-pin", {
    description: "Pin a memory to protect it from dream pruning",
    handler: async (args, ctx) => {
      const query = args?.trim();
      if (!query) {
        ctx.ui.notify("Usage: /mem0-pin <query>", "warning");
        return;
      }
      if (!requireActive(ctx)) return;
      const memories = await searchMemories(query, config.defaultScope);
      if (memories.length === 0) {
        sendFeedback("mem0-pin", `**No matches for "${query}"** \u2014 nothing to pin.`);
        return;
      }
      const pinned = (mem) => {
        sendFeedback(
          "mem0-pin",
          ["**Pinned** \u2014 protected from dream pruning", `- ${formatMemoryCompact(mem)}`].join("\n")
        );
      };
      const alreadyPinned = (mem) => {
        sendFeedback("mem0-pin", ["**Already pinned**", `- ${formatMemoryCompact(mem)}`].join("\n"));
      };
      if (memories.length === 1) {
        const target2 = memories[0];
        const text = target2.memory ?? "";
        if (text.startsWith("[PINNED]")) {
          alreadyPinned(target2);
          return;
        }
        const confirmed = await ctx.ui.confirm("Pin this memory?", formatMemoryCompact(target2));
        if (!confirmed) {
          sendFeedback("mem0-pin", "**Cancelled** \u2014 nothing was pinned.");
          return;
        }
        await mem0.update(target2.id, { text: `[PINNED] ${text}` });
        pinned(target2);
        return;
      }
      const labels = memories.map((m) => formatMemoryCompact(m));
      const selected = await ctx.ui.select(
        `Found ${pluralize(memories.length, "match", "matches")} for "${query}" \u2014 which should I pin?`,
        labels
      );
      if (!selected) {
        sendFeedback("mem0-pin", "**Cancelled** \u2014 nothing was pinned.");
        return;
      }
      const idx = labels.indexOf(selected);
      if (idx < 0) return;
      const target = memories[idx];
      const selectedText = target.memory ?? "";
      if (selectedText.startsWith("[PINNED]")) {
        alreadyPinned(target);
        return;
      }
      await mem0.update(target.id, { text: `[PINNED] ${selectedText}` });
      pinned(target);
    }
  });
  pi.registerCommand("mem0-scope", {
    description: "Change default memory scope for this session (project, session, global)",
    handler: async (args, ctx) => {
      const scope = args?.trim().toLowerCase();
      const valid = ["project", "session", "global"];
      if (!scope) {
        sendFeedback(
          "mem0-scope",
          [
            `**Current scope: ${config.defaultScope}**`,
            `New memories save to the **${config.defaultScope}** pool. Switch with \`/mem0-scope <${valid.join(" | ")}>\`.`
          ].join("\n")
        );
        return;
      }
      if (!valid.includes(scope)) {
        ctx.ui.notify(`Invalid scope "${scope}". Must be one of: ${valid.join(", ")}`, "warning");
        return;
      }
      config.defaultScope = scope;
      sendFeedback(
        "mem0-scope",
        [
          `**Scope changed to ${scope}**`,
          `New memories now save to the **${scope}** pool for this session.`
        ].join("\n")
      );
    }
  });
  pi.registerCommand("mem0-reindex", {
    description: "Re-embed all memories with the currently configured embedder (needed after an embedder swap)",
    handler: async (_args, ctx) => {
      let runtime;
      try {
        runtime = await buildRuntimeForReindex(config, ctx.modelRegistry);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`[mem0] reindex failed to build runtime: ${reason}`, "error");
        return;
      }
      const { client, metadata } = runtime;
      let memories;
      try {
        memories = (await client.getAll({
          filters: { user_id: getScopeCtx().userId },
          topK: UNBOUNDED_TOP_K
        })).results;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`[mem0] reindex failed to list memories: ${reason}`, "error");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Reindex all memories?",
        `This re-embeds ${pluralize(memories.length, "memory", "memories")} with ${metadata.provider}/${metadata.model}. It cannot be undone.`
      );
      if (!confirmed) {
        sendFeedback("mem0-reindex", "**Cancelled** \u2014 no memories were reindexed.");
        return;
      }
      const total = memories.length;
      const barWidth = 30;
      const renderProgress = (done) => {
        const filled = total === 0 ? barWidth : Math.round(done / total * barWidth);
        const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);
        const pct = total === 0 ? 100 : Math.round(done / total * 100);
        ctx.ui.setWidget?.("mem0-reindex-progress", [
          `Reindexing memories: [${bar}] ${done}/${total} (${pct}%)`
        ]);
      };
      const updateEvery = Math.max(1, Math.floor(total / 100));
      renderProgress(0);
      try {
        for (let i = 0; i < total; i++) {
          const mem = memories[i];
          try {
            if (mem.memory == null) {
              throw new Error(`memory ${mem.id} has no text (missing 'memory' field)`);
            }
            await client.update(mem.id, { text: mem.memory });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(
              `[mem0] reindex failed on memory ${mem.id} (${i + 1}/${total}): ${reason}`,
              "error"
            );
            return;
          }
          if ((i + 1) % updateEvery === 0 || i === total - 1) {
            renderProgress(i + 1);
          }
        }
      } finally {
        ctx.ui.setWidget?.("mem0-reindex-progress", void 0);
      }
      const paths = resolveStoragePaths();
      writeMetadata(paths.embedderMetadataPath, metadata);
      holder.setActive({ client });
      sendFeedback(
        "mem0-reindex",
        [
          `**Reindex complete** \u2014 ${pluralize(memories.length, "memory", "memories")} re-embedded`,
          `- Embedder: ${metadata.provider} / ${metadata.model} (dimension ${metadata.dimension})`
        ].join("\n")
      );
    }
  });
  pi.registerCommand("mem0-status", {
    description: "Show runtime health, identity, project, and memory count",
    handler: async (_args, _ctx) => {
      const scopeCtx = getScopeCtx();
      const active = holder.isActive();
      const inactiveReason = holder.reason();
      let count = null;
      if (active) {
        try {
          const options = {
            filters: resolveSearchFilters("project", scopeCtx),
            topK: UNBOUNDED_TOP_K
          };
          const result = await mem0.getAll(options);
          count = result.count ?? (result.results ?? []).length;
        } catch {
        }
      }
      const lines = [
        "**Mem0 status**",
        "",
        `- Runtime: ${active ? "active" : `inactive (${inactiveReason})`}`,
        `- LLM model: ${config.oss?.llm?.model ?? "(not set)"}`,
        `- Embedder model: ${config.oss?.embedder?.model ?? `${FASTEMBED_PROVIDER}/${FASTEMBED_MODEL}`}`,
        `- User: ${scopeCtx.userId}`,
        `- Project: ${scopeCtx.appId}`,
        `- Session: ${scopeCtx.runId}`,
        `- Default scope: ${config.defaultScope}`,
        `- Search relevance threshold: ${config.searchThreshold}`,
        `- Project memories: ${count ?? "unknown (runtime inactive)"}`,
        `- Auto-capture: ${config.autoCapture ? "on" : "off"}`,
        `- Dream: ${config.dream.enabled ? "enabled" : "disabled"}`
      ];
      sendFeedback("mem0-status", lines.join("\n"));
    }
  });
}

// src/capture/index.ts
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text);
    return texts.length > 0 ? texts.join("\n") : null;
  }
  return null;
}
function extractConversation(messages) {
  const result = [];
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = extractText(msg.content);
    if (!text) continue;
    result.push({ role: msg.role, content: text });
  }
  return result;
}
function setupAutoCapture(pi, mem0, config, getScopeCtx, holder) {
  if (!config.autoCapture) return;
  pi.on("agent_end", (event) => {
    if (!holder.isActive()) return;
    const messages = event.messages ?? [];
    const conversation = extractConversation(messages);
    if (conversation.length === 0) return;
    const scopeCtx = getScopeCtx();
    const addParams = resolveAddParams("project", scopeCtx);
    mem0.add(conversation, {
      ...addParams,
      customCategories: DEFAULT_CUSTOM_CATEGORIES
    }).catch((err) => {
      console.error("[mem0] auto-capture failed:", err);
    });
  });
}

// src/prompt.ts
var MEMORY_POLICY = `<mem0-memory-policy>
You have persistent semantic memory via the mem0_memory tool, powered by Mem0. Relevant memories may be auto-injected under <mem0-relevant-memories>, but that retrieval is shallow \u2014 treat it as a starting point, not the full picture.

Be proactive about retrieval:
- Search memory BEFORE answering whenever the request could depend on the user's past work, preferences, decisions, environment, or anything they told you earlier \u2014 don't wait to be asked.
- Check memory before asking the user something they may have already told you.
- For multi-part, comparative, or "how did we\u2026" questions, run SEVERAL searches with different phrasings and combine the results. One search is rarely enough \u2014 keep going until you have what you need (multi-hop).

Be proactive about saving:
- Save important facts, preferences, goals, decisions, lessons learned, identity, relationships, and routines the user shares.

Scope (do not change unless explicitly asked):
- "project" (default): memories for this project \u2014 use for all normal queries
- "session": memories from this session only
- "global": all memories across projects \u2014 ONLY when the user explicitly asks for cross-project search

Memory persists across sessions and devices via Mem0's cloud.
</mem0-memory-policy>`;

// src/oss/runtime.ts
var RuntimeHolder = class {
  state = { kind: "inactive", reason: "runtime has not been initialized yet" };
  setActive(runtime) {
    this.state = { kind: "active", runtime };
  }
  setInactive(reason) {
    this.state = { kind: "inactive", reason };
  }
  isActive() {
    return this.state.kind === "active";
  }
  reason() {
    return this.state.kind === "inactive" ? this.state.reason : null;
  }
  require() {
    if (this.state.kind !== "active") {
      throw new Error(`mem0 is not active: ${this.state.reason}`);
    }
    return this.state.runtime;
  }
};
var CLIENT_METHODS = [
  "add",
  "search",
  "getAll",
  "get",
  "update",
  "delete",
  "deleteAll"
];
function makeLazyClient(holder) {
  const out = {};
  for (const method of CLIENT_METHODS) {
    out[method] = (...args) => holder.require().client[method](...args);
  }
  return out;
}

// src/oss/prefetch.ts
var Prefetch = class {
  pending = null;
  queue(fn) {
    this.pending = fn().catch(() => null);
  }
  async consume(timeoutMs, fallback) {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return fallback;
    let timer;
    const timeout = new Promise((resolve2) => {
      timer = setTimeout(() => resolve2(fallback), timeoutMs);
    });
    try {
      const result = await Promise.race([
        pending.then((v) => v == null ? fallback : v),
        timeout
      ]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
};

// src/entry.ts
import * as os3 from "os";
var RECALL_TIMEOUT_MS = 1500;
function resolveUserId(configUserId) {
  if (configUserId) return configUserId;
  if (process.env.USER) return process.env.USER;
  if (process.env.USERNAME) return process.env.USERNAME;
  try {
    return os3.userInfo().username;
  } catch {
    return "default";
  }
}
function formatRecallContext(enabled, memories) {
  if (!enabled) return "";
  const list = memories;
  if (list.length === 0) return "";
  return `<mem0-relevant-memories>
Retrieved automatically for the current request. This is a shallow first pass \u2014 search mem0_memory for more if you need it.
${formatMemoryList(list)}
</mem0-relevant-memories>`;
}
function mem0Extension(pi) {
  const config = loadConfig();
  const holder = new RuntimeHolder();
  const mem0 = makeLazyClient(holder);
  const scopeCtx = {
    userId: resolveUserId(config.userId),
    appId: "",
    runId: "unknown"
  };
  function getScopeCtx() {
    return scopeCtx;
  }
  registerMemoryTool(pi, mem0, config, getScopeCtx);
  registerCommands(pi, mem0, config, getScopeCtx, holder);
  setupAutoCapture(pi, mem0, config, getScopeCtx, holder);
  const recallPrefetch = new Prefetch();
  pi.on("input", async (event) => {
    if (!config.contextInjection || !holder.isActive()) return;
    const prompt = event.text?.trim?.() ?? "";
    if (!prompt) return;
    recallPrefetch.queue(async () => {
      const res = await mem0.search(prompt, {
        filters: resolveSearchFilters("project", scopeCtx),
        threshold: config.searchThreshold
      });
      return res.results ?? [];
    });
  });
  pi.on("session_start", async (_event, ctx) => {
    scopeCtx.appId = detectAppId(ctx.cwd);
    const sessionFile = ctx.sessionManager?.getSessionFile?.();
    scopeCtx.runId = detectRunId(sessionFile);
    if (config.userId) scopeCtx.userId = config.userId;
    try {
      const runtime = await activateRuntime(config, ctx.modelRegistry);
      holder.setActive(runtime);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      holder.setInactive(reason);
      ctx.ui.notify(`[mem0] runtime inactive: ${reason}`, "error");
      return;
    }
    if (config.dream.enabled) {
      incrementSessionCount(CONFIG_DIR, scopeCtx.runId);
    }
  });
  let dreamTriggered = false;
  let dreamChecked = false;
  pi.on("before_agent_start", async (event, _ctx) => {
    let extra = MEMORY_POLICY;
    if (holder.isActive()) {
      const memories = await recallPrefetch.consume(RECALL_TIMEOUT_MS, []);
      const recall = formatRecallContext(config.contextInjection, memories);
      if (recall) extra += "\n\n" + recall;
    }
    if (holder.isActive() && config.dream.enabled && config.dream.auto && !dreamTriggered && !dreamChecked) {
      const gates = checkCheapGates(CONFIG_DIR, config.dream);
      if (gates.proceed) {
        try {
          const filters = resolveSearchFilters("project", scopeCtx);
          const options = {
            filters,
            topK: UNBOUNDED_TOP_K
          };
          const result = await mem0.getAll(options);
          const count = result.count ?? (result.results ?? []).length;
          dreamChecked = true;
          const memGate = checkMemoryGate(count, config.dream);
          if (memGate.pass && acquireDreamLock(CONFIG_DIR)) {
            dreamTriggered = true;
            extra += "\n\n" + DREAM_PROTOCOL;
          }
        } catch {
        }
      }
    }
    return {
      systemPrompt: (event.systemPrompt ?? "") + "\n\n" + extra
    };
  });
  pi.on("agent_end", async (event) => {
    if (!dreamTriggered) return;
    const messages = event.messages ?? [];
    const hadWriteAction = messages.some((m) => {
      if (m.role !== "assistant") return false;
      const content = Array.isArray(m.content) ? m.content : [];
      return content.some(
        (block) => block.type === "tool_use" && block.name === "mem0_memory" && ["add", "delete", "delete_all"].includes(block.input?.action)
      );
    });
    if (hadWriteAction) {
      recordDreamCompletion(CONFIG_DIR);
    }
    releaseDreamLock(CONFIG_DIR);
    dreamTriggered = false;
  });
  pi.on("session_shutdown", async () => {
    if (dreamTriggered) {
      releaseDreamLock(CONFIG_DIR);
      dreamTriggered = false;
    }
  });
}

export {
  CONFIG_DIR,
  CONFIG_PATH,
  loadConfig,
  detectAppId,
  detectRunId,
  resolveSearchFilters,
  resolveAddParams,
  formatAge,
  formatMemoryCompact,
  formatMemoryList,
  groupByCategory,
  DEFAULT_CUSTOM_CATEGORIES,
  buildToolExecute,
  registerMemoryTool,
  DREAM_PROTOCOL,
  incrementSessionCount,
  checkCheapGates,
  checkMemoryGate,
  acquireDreamLock,
  releaseDreamLock,
  recordDreamCompletion,
  classifyMemories,
  OssMemoryClientAdapter,
  resolveOssLlm,
  expandHome,
  resolveStoragePaths,
  activateRuntime,
  registerCommands,
  extractConversation,
  setupAutoCapture,
  MEMORY_POLICY,
  RuntimeHolder,
  makeLazyClient,
  Prefetch,
  resolveUserId,
  formatRecallContext,
  mem0Extension
};
//# sourceMappingURL=chunk-R6YPG5VQ.js.map
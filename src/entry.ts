import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, CONFIG_DIR } from "./oss/config.ts";
import { detectAppId, detectRunId, resolveSearchFilters } from "./memory/scoping.ts";
import { formatMemoryList } from "./memory/formatting.ts";
import { registerMemoryTool } from "./memory/tools.ts";
import { registerCommands } from "./commands.ts";
import { setupAutoCapture } from "./capture/index.ts";
import { MEMORY_POLICY } from "./prompt.ts";
import { DREAM_PROTOCOL } from "./dream/prompt.ts";
import {
  incrementSessionCount,
  checkCheapGates,
  checkMemoryGate,
  acquireDreamLock,
  releaseDreamLock,
  recordDreamCompletion,
} from "./dream/index.ts";
import { RuntimeHolder, makeLazyClient } from "./oss/runtime.ts";
import { activateRuntime } from "./oss/activate.ts";
import { Prefetch } from "./oss/prefetch.ts";
import * as os from "node:os";
import type { ScopeContext } from "./types.ts";

const RECALL_TIMEOUT_MS = 1500;

export function resolveUserId(configUserId: string): string {
  if (configUserId) return configUserId;
  if (process.env.USER) return process.env.USER;
  if (process.env.USERNAME) return process.env.USERNAME;
  try { return os.userInfo().username; } catch { return "default"; }
}

/**
 * Build the auto-recall context block for a turn from a prefetched search
 * result. Best-effort — returns "" when disabled, the prompt is blank, or
 * nothing matches; must never block the turn.
 */
export function formatRecallContext(
  enabled: boolean,
  memories: unknown[],
): string {
  if (!enabled) return "";
  const list = memories as Parameters<typeof formatMemoryList>[0];
  if (list.length === 0) return "";
  return `<mem0-relevant-memories>\nRetrieved automatically for the current request. This is a shallow first pass — search mem0_memory for more if you need it.\n${formatMemoryList(list)}\n</mem0-relevant-memories>`;
}

export default function mem0Extension(pi: ExtensionAPI): void {
  const config = loadConfig();

  const holder = new RuntimeHolder();
  const mem0 = makeLazyClient(holder);

  const scopeCtx: ScopeContext = {
    userId: resolveUserId(config.userId),
    appId: "",
    runId: "unknown",
  };

  function getScopeCtx(): ScopeContext {
    return scopeCtx;
  }

  // Registration uses the lazy client. When the runtime is inactive, calls
  // reject with a clear reason; commands guard on holder.isActive() and the
  // tool surfaces the reason as a tool error.
  registerMemoryTool(pi, mem0, config, getScopeCtx);
  registerCommands(pi, mem0, config, getScopeCtx, holder);
  setupAutoCapture(pi, mem0, config, getScopeCtx, holder);

  const recallPrefetch = new Prefetch<any[]>();

  // ── input: kick off recall search early so we can race it later ──────
  pi.on("input", async (event) => {
    if (!config.contextInjection || !holder.isActive()) return;
    const prompt = event.text?.trim?.() ?? "";
    if (!prompt) return;
    recallPrefetch.queue(async () => {
      const res = await mem0.search(prompt, {
        filters: resolveSearchFilters("project", scopeCtx),
        threshold: config.searchThreshold,
      });
      return res.results ?? [];
    });
  });

  // ── session_start: detect project + session, construct OSS runtime ───
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

  // ── before_agent_start: append memory policy + auto-dream trigger ───
  let dreamTriggered = false;
  let dreamChecked = false;

  pi.on("before_agent_start", async (event, _ctx) => {
    let extra = MEMORY_POLICY;

    if (holder.isActive()) {
      const memories = await recallPrefetch.consume(RECALL_TIMEOUT_MS, []);
      const recall = formatRecallContext(config.contextInjection, memories);
      if (recall) extra += "\n\n" + recall;
    }

    if (
      holder.isActive() &&
      config.dream.enabled &&
      config.dream.auto &&
      !dreamTriggered &&
      !dreamChecked
    ) {
      const gates = checkCheapGates(CONFIG_DIR, config.dream);
      if (gates.proceed) {
        try {
          const filters = resolveSearchFilters("project", scopeCtx);
          const result = await mem0.getAll({ filters });
          const count = result.count ?? (result.results ?? []).length;
          dreamChecked = true;
          const memGate = checkMemoryGate(count, config.dream);

          if (memGate.pass && acquireDreamLock(CONFIG_DIR)) {
            dreamTriggered = true;
            extra += "\n\n" + DREAM_PROTOCOL;
          }
        } catch {
          // Transient error — retry next turn
        }
      }
    }

    return {
      systemPrompt: (event.systemPrompt ?? "") + "\n\n" + extra,
    };
  });

  // ── agent_end: dream completion check ───────────────────────────────
  pi.on("agent_end", async (event) => {
    if (!dreamTriggered) return;

    const messages = event.messages ?? [];
    const hadWriteAction = messages.some((m) => {
      if (m.role !== "assistant") return false;
      const content = Array.isArray(m.content) ? m.content : [];
      return content.some(
        (block: any) =>
          block.type === "tool_use" &&
          block.name === "mem0_memory" &&
          ["add", "delete", "delete_all"].includes(block.input?.action),
      );
    });

    if (hadWriteAction) {
      recordDreamCompletion(CONFIG_DIR);
    }

    releaseDreamLock(CONFIG_DIR);
    dreamTriggered = false;
  });

  // ── session_shutdown: release dream lock if still held ──────────────
  pi.on("session_shutdown", async () => {
    if (dreamTriggered) {
      releaseDreamLock(CONFIG_DIR);
      dreamTriggered = false;
    }
  });
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerCommands } from "./commands.ts";
import type { Mem0Config, ScopeContext } from "./types.ts";
import { RuntimeHolder } from "./oss/runtime.ts";

vi.mock("./dream/index.ts", () => ({
  acquireDreamLock: vi.fn(() => true),
}));

vi.mock("./dream/prompt.ts", () => ({
  DREAM_PROTOCOL: "dream protocol text",
}));

const buildRuntimeForReindex = vi.fn();
vi.mock("./oss/activate.ts", () => ({
  buildRuntimeForReindex: (...args: any[]) => buildRuntimeForReindex(...args),
}));

const reindexPaths = { embedderMetadataPath: "/fake/memories/mem0-embedder.json" };
vi.mock("./oss/paths.ts", () => ({
  resolveStoragePaths: vi.fn(() => reindexPaths),
}));

const writeMetadata = vi.fn();
vi.mock("./oss/embedder-metadata.ts", () => ({
  writeMetadata: (...args: any[]) => writeMetadata(...args),
}));

function makeMem0() {
  return {
    search: vi.fn(),
    delete: vi.fn(),
    add: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(),
    update: vi.fn(),
  } as any;
}

function makePi() {
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  return {
    registerCommand: vi.fn((name: string, opts: any) => {
      commands.set(name, opts);
    }),
    sendMessage: vi.fn(),
    _commands: commands,
    _invoke: (name: string, args: string, ctx: any) => commands.get(name)!.handler(args, ctx),
  };
}

function makeCtx(confirmResult = true) {
  return {
    hasUI: true,
    modelRegistry: {} as any,
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(async () => confirmResult),
      select: vi.fn(),
      input: vi.fn(),
    },
  };
}

const defaultConfig: Mem0Config = {
  userId: "test-user",
  autoCapture: false,
  defaultScope: "project",
  contextInjection: false,
  searchThreshold: 0.3,
  dream: { enabled: false, auto: false, minHours: 24, minSessions: 5, minMemories: 20 },
  oss: { llm: { model: "ollama/qwen3.5:4b" } },
};

function activeHolder() {
  const h = new RuntimeHolder();
  h.setActive({ client: {} as any });
  return h;
}

const scopeCtx: ScopeContext = { userId: "test-user", appId: "test-app", runId: "test-run" };

describe("registerCommands", () => {
  let pi: ReturnType<typeof makePi>;
  let mem0: ReturnType<typeof makeMem0>;

  beforeEach(() => {
    pi = makePi();
    mem0 = makeMem0();
    defaultConfig.defaultScope = "project";
    registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, activeHolder());
  });

  it("registers all expected commands", () => {
    const names = [...pi._commands.keys()];
    expect(names).toContain("mem0-remember");
    expect(names).toContain("mem0-forget");
    expect(names).toContain("mem0-search");
    expect(names).toContain("mem0-tour");
    expect(names).toContain("mem0-dream");
    expect(names).toContain("mem0-pin");
    expect(names).toContain("mem0-scope");
    expect(names).toContain("mem0-status");
    expect(names).toContain("mem0-reindex");
  });

  describe("/mem0-forget", () => {
    it("shows warning when no query provided", async () => {
      const ctx = makeCtx();
      await pi._invoke("mem0-forget", "", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /mem0-forget <query>", "warning");
      expect(mem0.search).not.toHaveBeenCalled();
    });

    it("sends a visible message naming the query when no memories match", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({ results: [] });
      await pi._invoke("mem0-forget", "old preference", ctx);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-forget",
          content: expect.stringContaining('No matches for "old preference"'),
          display: true,
        }),
      );
    });

    it("asks for confirmation before deleting a single match", async () => {
      const ctx = makeCtx(true);
      mem0.search.mockResolvedValue({ results: [{ id: "abc-123", memory: "test mem" }] });
      mem0.delete.mockResolvedValue({ message: "Deleted" });

      await pi._invoke("mem0-forget", "test", ctx);

      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Delete this memory?",
        expect.stringContaining("test mem"),
      );
      expect(mem0.delete).toHaveBeenCalledWith("abc-123");
    });

    it("sends a visible confirmation showing what was forgotten", async () => {
      const ctx = makeCtx(true);
      mem0.search.mockResolvedValue({ results: [{ id: "abc-123", memory: "test mem" }] });
      mem0.delete.mockResolvedValue({ message: "Deleted" });

      await pi._invoke("mem0-forget", "test", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-forget",
          content: expect.stringContaining("Forgotten"),
          display: true,
        }),
      );
    });

    it("does not delete when user cancels confirmation", async () => {
      const ctx = makeCtx(false);
      mem0.search.mockResolvedValue({ results: [{ id: "abc-123", memory: "test mem" }] });

      await pi._invoke("mem0-forget", "test", ctx);

      expect(ctx.ui.confirm).toHaveBeenCalled();
      expect(mem0.delete).not.toHaveBeenCalled();
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Cancelled"), display: true }),
      );
    });

    it("uses select UI for multiple matches and deletes chosen memory", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({
        results: [
          { id: "id-1", memory: "mem one" },
          { id: "id-2", memory: "mem two" },
        ],
      });
      mem0.delete.mockResolvedValue({ message: "Deleted" });
      ctx.ui.select = vi.fn(async (_title: string, options: string[]) => options[1]);

      await pi._invoke("mem0-forget", "test", ctx);

      expect(ctx.ui.select).toHaveBeenCalledWith(
        expect.stringContaining("which should I delete"),
        expect.arrayContaining([
          expect.stringContaining("mem one"),
          expect.stringContaining("mem two"),
        ]),
      );
      expect(mem0.delete).toHaveBeenCalledWith("id-2");
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-forget",
          content: expect.stringContaining("Forgotten"),
          display: true,
        }),
      );
    });

    it("does not delete when user cancels select", async () => {
      const ctx = makeCtx();
      ctx.ui.select = vi.fn(async () => undefined);
      mem0.search.mockResolvedValue({
        results: [
          { id: "id-1", memory: "mem one" },
          { id: "id-2", memory: "mem two" },
        ],
      });

      await pi._invoke("mem0-forget", "test", ctx);

      expect(mem0.delete).not.toHaveBeenCalled();
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Cancelled"), display: true }),
      );
    });
  });

  describe("/mem0-pin", () => {
    it("uses update to pin in-place, preserving memory ID", async () => {
      const ctx = makeCtx(true);
      mem0.search.mockResolvedValue({ results: [{ id: "abc-123", memory: "important fact" }] });
      mem0.update.mockResolvedValue([]);

      await pi._invoke("mem0-pin", "important", ctx);

      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Pin this memory?",
        expect.stringContaining("important fact"),
      );
      expect(mem0.update).toHaveBeenCalledWith("abc-123", { text: "[PINNED] important fact" });
      expect(mem0.add).not.toHaveBeenCalled();
      expect(mem0.delete).not.toHaveBeenCalled();
    });

    it("sends a visible confirmation after pinning", async () => {
      const ctx = makeCtx(true);
      mem0.search.mockResolvedValue({ results: [{ id: "abc-123", memory: "important fact" }] });
      mem0.update.mockResolvedValue([]);

      await pi._invoke("mem0-pin", "important", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-pin",
          content: expect.stringContaining("Pinned"),
          display: true,
        }),
      );
    });

    it("does not pin when user cancels", async () => {
      const ctx = makeCtx(false);
      mem0.search.mockResolvedValue({ results: [{ id: "abc-123", memory: "fact" }] });

      await pi._invoke("mem0-pin", "fact", ctx);

      expect(mem0.update).not.toHaveBeenCalled();
    });

    it("skips already-pinned memories with a visible message", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({ results: [{ id: "abc-123", memory: "[PINNED] fact" }] });

      await pi._invoke("mem0-pin", "fact", ctx);

      expect(ctx.ui.confirm).not.toHaveBeenCalled();
      expect(mem0.add).not.toHaveBeenCalled();
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Already pinned"), display: true }),
      );
    });

    it("uses select UI for multiple matches and pins chosen memory", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({
        results: [
          { id: "id-1", memory: "fact one" },
          { id: "id-2", memory: "fact two" },
        ],
      });
      mem0.update.mockResolvedValue([]);
      ctx.ui.select = vi.fn(async (_title: string, options: string[]) => options[1]);

      await pi._invoke("mem0-pin", "fact", ctx);

      expect(ctx.ui.select).toHaveBeenCalledWith(
        expect.stringContaining("which should I pin"),
        expect.arrayContaining([
          expect.stringContaining("fact one"),
          expect.stringContaining("fact two"),
        ]),
      );
      expect(mem0.update).toHaveBeenCalledWith("id-2", { text: "[PINNED] fact two" });
    });

    it("does not pin when user cancels select", async () => {
      const ctx = makeCtx();
      ctx.ui.select = vi.fn(async () => undefined);
      mem0.search.mockResolvedValue({
        results: [
          { id: "id-1", memory: "fact one" },
          { id: "id-2", memory: "fact two" },
        ],
      });

      await pi._invoke("mem0-pin", "fact", ctx);

      expect(mem0.update).not.toHaveBeenCalled();
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Cancelled"), display: true }),
      );
    });
  });

  describe("/mem0-search", () => {
    it("performs server-side semantic search with a relevance threshold", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({ results: [{ id: "id-1", memory: "result" }] });

      await pi._invoke("mem0-search", "my preferences", ctx);

      expect(mem0.search).toHaveBeenCalledWith(
        "my preferences",
        expect.objectContaining({ threshold: 0.3, topK: 10, rerank: true }),
      );
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "mem0-search" }),
      );
    });

    it("uses semantic search even for hex-looking strings", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({ results: [] });

      await pi._invoke("mem0-search", "abcd1234", ctx);

      expect(mem0.search).toHaveBeenCalledWith("abcd1234", expect.any(Object));
      expect(mem0.getAll).not.toHaveBeenCalled();
      expect(mem0.get).not.toHaveBeenCalled();
    });

    it("shows a no-matches message naming the query", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({ results: [] });

      await pi._invoke("mem0-search", "nonexistent", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("No matches") }),
      );
    });

    it("shows a result count header when there are matches", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({
        results: [
          { id: "id-1", memory: "one" },
          { id: "id-2", memory: "two" },
        ],
      });

      await pi._invoke("mem0-search", "stuff", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("2 matches") }),
      );
    });

    it("shows all results the API returns (relevance gating is server-side)", async () => {
      const ctx = makeCtx();
      mem0.search.mockResolvedValue({
        results: [
          { id: "id-1", memory: "first match", score: 0.62 },
          { id: "id-2", memory: "second match", score: 0.31 },
        ],
      });

      await pi._invoke("mem0-search", "stuff", ctx);

      const call = pi.sendMessage.mock.calls.find(([m]: any[]) => m.customType === "mem0-search");
      expect(call?.[0].content).toContain("first match");
      expect(call?.[0].content).toContain("second match");
      expect(call?.[0].content).toContain("2 matches");
    });
  });

  describe("/mem0-remember", () => {
    it("stores a memory verbatim", async () => {
      const ctx = makeCtx();
      mem0.add.mockResolvedValue({ message: "Memory stored." });

      await pi._invoke("mem0-remember", "I prefer dark mode", ctx);

      expect(mem0.add).toHaveBeenCalledWith(
        [{ role: "user", content: "I prefer dark mode" }],
        expect.objectContaining({ infer: false }),
      );
    });

    it("shows the stored text in a visible confirmation (infer:false status response)", async () => {
      const ctx = makeCtx();
      mem0.add.mockResolvedValue({ message: "Memories stored successfully" });

      await pi._invoke("mem0-remember", "I prefer dark mode", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-remember",
          content: expect.stringContaining("I prefer dark mode"),
          display: true,
        }),
      );
    });

    it("lists memory objects returned by the API when present", async () => {
      const ctx = makeCtx();
      mem0.add.mockResolvedValue([{ id: "m1", memory: "Uses dark mode", event: "ADD" }]);

      await pi._invoke("mem0-remember", "I prefer dark mode", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-remember",
          content: expect.stringContaining("Uses dark mode"),
          display: true,
        }),
      );
    });

    it("shows warning when no text provided", async () => {
      const ctx = makeCtx();
      await pi._invoke("mem0-remember", "  ", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /mem0-remember <text>", "warning");
    });
  });

  describe("/mem0-scope", () => {
    it("sends a visible message showing the current scope when no arg is given", async () => {
      const ctx = makeCtx();
      await pi._invoke("mem0-scope", "", ctx);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-scope",
          content: expect.stringContaining("Current scope:"),
          display: true,
        }),
      );
    });

    it("sends a visible confirmation after changing scope", async () => {
      const ctx = makeCtx();
      await pi._invoke("mem0-scope", "global", ctx);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-scope",
          content: expect.stringContaining("Scope changed to global"),
          display: true,
        }),
      );
    });

    it("warns on an invalid scope", async () => {
      const ctx = makeCtx();
      await pi._invoke("mem0-scope", "bogus", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining('Invalid scope "bogus"'),
        "warning",
      );
    });
  });

  describe("/mem0-tour", () => {
    it("shows an empty-state message when there are no memories", async () => {
      const ctx = makeCtx();
      mem0.getAll.mockResolvedValue({ results: [] });

      await pi._invoke("mem0-tour", "", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-tour",
          content: expect.stringContaining("No memories"),
          display: true,
        }),
      );
    });

    it("groups memories by category with a count header", async () => {
      const ctx = makeCtx();
      mem0.getAll.mockResolvedValue({
        results: [
          { id: "id-1", memory: "likes tea", categories: ["preferences"] },
          { id: "id-2", memory: "uses vim", categories: ["technical"] },
        ],
      });

      await pi._invoke("mem0-tour", "", ctx);

      expect(mem0.getAll).toHaveBeenCalledWith({
        filters: { user_id: "test-user", app_id: "test-app" },
        topK: 1_000_000,
      });
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-tour",
          content: expect.stringContaining("Memory tour"),
          display: true,
        }),
      );
    });
  });

  describe("/mem0-status", () => {
    it("shows the configured embedder model", async () => {
      const ctx = makeCtx();
      const config: Mem0Config = {
        ...defaultConfig,
        oss: {
          llm: defaultConfig.oss!.llm,
          embedder: { model: "databricks/text-embedding-3-small" },
        },
      };
      mem0.getAll.mockResolvedValue({ results: [] });
      pi = makePi();
      registerCommands(pi as any, mem0, config, () => scopeCtx, activeHolder());

      await pi._invoke("mem0-status", "", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-status",
          content: expect.stringContaining("Embedder model: databricks/text-embedding-3-small"),
          display: true,
        }),
      );
    });

    it("shows the fastembed default when no external embedder is configured", async () => {
      const ctx = makeCtx();
      mem0.getAll.mockResolvedValue({ results: [] });

      await pi._invoke("mem0-status", "", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Embedder model: fastembed/fast-bge-small-en-v1.5"),
        }),
      );
    });

    it("requests all project memories for the count", async () => {
      const ctx = makeCtx();
      mem0.getAll.mockResolvedValue({ results: [] });

      await pi._invoke("mem0-status", "", ctx);

      expect(mem0.getAll).toHaveBeenCalledWith({
        filters: { user_id: "test-user", app_id: "test-app" },
        topK: 1_000_000,
      });
    });
  });

  describe("/mem0-reindex", () => {
    beforeEach(() => {
      buildRuntimeForReindex.mockReset();
      writeMetadata.mockReset();
    });

    it("reindexes memories, writes metadata, and hot-swaps the holder on the happy path", async () => {
      const ctx = makeCtx(true);
      const client = {
        getAll: vi.fn(async () => ({
          results: [
            { id: "id-1", memory: "likes tea" },
            { id: "id-2", memory: "uses vim" },
            { id: "id-3", memory: "prefers dark mode" },
          ],
        })),
        update: vi.fn(async () => ({})),
      };
      const metadata = { provider: "openai", model: "text-embedding-3-small", dimension: 4 };
      buildRuntimeForReindex.mockResolvedValue({ client, metadata });
      const holder = activeHolder();
      const setActiveSpy = vi.spyOn(holder, "setActive");
      pi = makePi();
      registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, holder);

      await pi._invoke("mem0-reindex", "", ctx);

      expect(ctx.ui.confirm).toHaveBeenCalled();
      expect(client.getAll).toHaveBeenCalledTimes(1);
      expect(client.update).toHaveBeenCalledTimes(3);
      expect(client.update).toHaveBeenNthCalledWith(1, "id-1", { text: "likes tea" });
      expect(client.update).toHaveBeenNthCalledWith(2, "id-2", { text: "uses vim" });
      expect(client.update).toHaveBeenNthCalledWith(3, "id-3", { text: "prefers dark mode" });
      expect(writeMetadata).toHaveBeenCalledWith(reindexPaths.embedderMetadataPath, metadata);
      expect(setActiveSpy).toHaveBeenCalledWith({ client });
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "mem0-reindex", content: expect.stringContaining("Reindex complete") }),
      );
    });

    it("cancels without updating when the user declines confirmation", async () => {
      const ctx = makeCtx(false);
      const client = {
        getAll: vi.fn(async () => ({ results: [{ id: "id-1", memory: "likes tea" }] })),
        update: vi.fn(async () => ({})),
      };
      buildRuntimeForReindex.mockResolvedValue({
        client,
        metadata: { provider: "openai", model: "text-embedding-3-small", dimension: 4 },
      });
      const holder = activeHolder();
      const setActiveSpy = vi.spyOn(holder, "setActive");
      pi = makePi();
      registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, holder);

      await pi._invoke("mem0-reindex", "", ctx);

      expect(client.update).not.toHaveBeenCalled();
      expect(writeMetadata).not.toHaveBeenCalled();
      expect(setActiveSpy).not.toHaveBeenCalled();
    });

    it("still shows the confirmation prompt when there are no memories", async () => {
      const ctx = makeCtx(true);
      const client = {
        getAll: vi.fn(async () => ({ results: [] })),
        update: vi.fn(async () => ({})),
      };
      const metadata = { provider: "openai", model: "text-embedding-3-small", dimension: 4 };
      buildRuntimeForReindex.mockResolvedValue({ client, metadata });
      const holder = activeHolder();
      pi = makePi();
      registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, holder);

      await pi._invoke("mem0-reindex", "", ctx);

      expect(ctx.ui.confirm).toHaveBeenCalled();
      expect(writeMetadata).toHaveBeenCalledWith(reindexPaths.embedderMetadataPath, metadata);
    });

    it("notifies and aborts when getAll fails", async () => {
      const ctx = makeCtx(true);
      const client = {
        getAll: vi.fn(async () => {
          throw new Error("connection refused");
        }),
        update: vi.fn(async () => ({})),
      };
      buildRuntimeForReindex.mockResolvedValue({
        client,
        metadata: { provider: "openai", model: "text-embedding-3-small", dimension: 4 },
      });
      const holder = activeHolder();
      pi = makePi();
      registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, holder);

      await pi._invoke("mem0-reindex", "", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("connection refused"), "error");
      expect(ctx.ui.confirm).not.toHaveBeenCalled();
      expect(writeMetadata).not.toHaveBeenCalled();
    });

    it("aborts without writing metadata when a memory is missing its text", async () => {
      const ctx = makeCtx(true);
      const client = {
        getAll: vi.fn(async () => ({ results: [{ id: "id-1", memory: undefined }] })),
        update: vi.fn(async () => ({})),
      };
      buildRuntimeForReindex.mockResolvedValue({
        client,
        metadata: { provider: "openai", model: "text-embedding-3-small", dimension: 4 },
      });
      const holder = activeHolder();
      pi = makePi();
      registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, holder);

      await pi._invoke("mem0-reindex", "", ctx);

      expect(client.update).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("id-1"), "error");
      expect(writeMetadata).not.toHaveBeenCalled();
    });

    it("runs from a mismatch-deactivated holder and still succeeds", async () => {
      const ctx = makeCtx(true);
      const client = {
        getAll: vi.fn(async () => ({ results: [{ id: "id-1", memory: "likes tea" }] })),
        update: vi.fn(async () => ({})),
      };
      const metadata = { provider: "openai", model: "text-embedding-3-small", dimension: 4 };
      buildRuntimeForReindex.mockResolvedValue({ client, metadata });
      const holder = new RuntimeHolder();
      holder.setInactive("embedder configuration changed; run /mem0-reindex");
      pi = makePi();
      registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, holder);

      await pi._invoke("mem0-reindex", "", ctx);

      expect(client.update).toHaveBeenCalledTimes(1);
      expect(holder.isActive()).toBe(true);
    });

    it("notifies and aborts without writing metadata when a memory update fails", async () => {
      const ctx = makeCtx(true);
      const client = {
        getAll: vi.fn(async () => ({
          results: [
            { id: "id-1", memory: "likes tea" },
            { id: "id-2", memory: "uses vim" },
          ],
        })),
        update: vi.fn(async (id: string) => {
          if (id === "id-2") throw new Error("connection refused");
        }),
      };
      buildRuntimeForReindex.mockResolvedValue({
        client,
        metadata: { provider: "openai", model: "text-embedding-3-small", dimension: 4 },
      });
      const holder = activeHolder();
      const setActiveSpy = vi.spyOn(holder, "setActive");
      pi = makePi();
      registerCommands(pi as any, mem0, defaultConfig, () => scopeCtx, holder);

      await pi._invoke("mem0-reindex", "", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("id-2"), "error");
      expect(writeMetadata).not.toHaveBeenCalled();
      expect(setActiveSpy).not.toHaveBeenCalled();
    });
  });

  describe("/mem0-dream", () => {
    it("feeds the protocol to the agent and shows a clean status line", async () => {
      const ctx = makeCtx();

      await pi._invoke("mem0-dream", "", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "mem0-dream", display: false }),
        expect.objectContaining({ triggerTurn: true }),
      );
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "mem0-dream",
          content: expect.stringContaining("Dreaming"),
          display: true,
        }),
      );
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import { OssMemoryClientAdapter } from "./client.ts";

function makeMem0(overrides: Partial<any> = {}) {
  return {
    add: vi.fn(async () => ({ results: [] })),
    search: vi.fn(async () => ({ results: [] })),
    getAll: vi.fn(async () => ({ results: [] })),
    get: vi.fn(async () => null),
    update: vi.fn(async () => ({ message: "updated" })),
    delete: vi.fn(async () => ({ message: "deleted" })),
    deleteAll: vi.fn(async () => ({ message: "deleted-all" })),
    ...overrides,
  };
}

const llm = { generateResponse: vi.fn(async () => ({ content: "{}" })) };

describe("OssMemoryClientAdapter", () => {
  it("translates appId to agentId on add", async () => {
    const mem0 = makeMem0();
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    await adapter.add([{ role: "user", content: "hi" }], {
      userId: "u",
      appId: "proj",
    });
    const opts = mem0.add.mock.calls[0][1];
    expect(opts.agentId).toBe("proj");
    expect(opts.appId).toBeUndefined();
  });

  it("drops appId when it is the global wildcard", async () => {
    const mem0 = makeMem0();
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    await adapter.add([{ role: "user", content: "hi" }], {
      userId: "u",
      appId: "*",
    });
    const opts = mem0.add.mock.calls[0][1];
    expect(opts.agentId).toBeUndefined();
    expect(opts.appId).toBeUndefined();
  });

  it("translates filters.app_id to filters.agent_id on search", async () => {
    const mem0 = makeMem0();
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    await adapter.search("q", { filters: { user_id: "u", app_id: "proj" } });
    const filters = mem0.search.mock.calls[0][1].filters;
    expect(filters.agent_id).toBe("proj");
    expect(filters.app_id).toBeUndefined();
    expect(filters.user_id).toBe("u");
  });

  it("drops filters.app_id when it is the global wildcard", async () => {
    const mem0 = makeMem0();
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    await adapter.getAll({ filters: { user_id: "u", app_id: "*" } });
    const filters = mem0.getAll.mock.calls[0][0].filters;
    expect(filters.agent_id).toBeUndefined();
    expect(filters.app_id).toBeUndefined();
    expect(filters.user_id).toBe("u");
  });

  it("forwards threshold and topK on search", async () => {
    const mem0 = makeMem0();
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    await adapter.search("q", {
      filters: { user_id: "u" },
      threshold: 0.5,
      topK: 8,
    });
    const opts = mem0.search.mock.calls[0][1];
    expect(opts.threshold).toBe(0.5);
    expect(opts.topK).toBe(8);
  });

  it("lifts metadata.categories to top-level on search results", async () => {
    const mem0 = makeMem0({
      search: vi.fn(async () => ({
        results: [
          { id: "a", memory: "m", metadata: { categories: ["preferences"] } },
        ],
      })),
    });
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    const { results } = await adapter.search("q");
    expect(results[0].categories).toEqual(["preferences"]);
  });

  it("returns add results as a plain array to match cloud MemoryClient", async () => {
    const mem0 = makeMem0({
      add: vi.fn(async () => ({
        results: [{ id: "a", memory: "m", metadata: { event: "ADD" } }],
      })),
    });
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    const result = await adapter.add([{ role: "user", content: "hi" }], {
      userId: "u",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe("a");
  });

  it("classifies newly-added memories and updates their metadata", async () => {
    const mem0 = makeMem0({
      add: vi.fn(async () => ({
        results: [
          { id: "a", memory: "User likes pnpm", metadata: { event: "ADD" } },
          { id: "b", memory: "existing", metadata: { event: "UPDATE" } },
        ],
      })),
    });
    const classifier = {
      generateResponse: vi.fn(async () => ({
        content: JSON.stringify({ assignments: { a: ["preferences"] } }),
      })),
    };
    const adapter = new OssMemoryClientAdapter(mem0 as any, classifier);
    const result = await adapter.add(
      [{ role: "user", content: "I love pnpm" }],
      {
        userId: "u",
        customCategories: [
          { preferences: "Likes, dislikes, habits" },
          { identity: "Personal details" },
        ],
      },
    );
    expect(classifier.generateResponse).toHaveBeenCalledOnce();
    expect(mem0.update).toHaveBeenCalledWith("a", {
      metadata: { categories: ["preferences"] },
    });
    // Only ADD items get categorized; UPDATE items are left alone.
    expect(mem0.update).toHaveBeenCalledTimes(1);
    expect(result[0].categories).toEqual(["preferences"]);
  });

  it("skips classification when customCategories is not provided", async () => {
    const mem0 = makeMem0({
      add: vi.fn(async () => ({
        results: [{ id: "a", memory: "m", metadata: { event: "ADD" } }],
      })),
    });
    const classifier = { generateResponse: vi.fn() };
    const adapter = new OssMemoryClientAdapter(mem0 as any, classifier);
    await adapter.add([{ role: "user", content: "hi" }], { userId: "u" });
    expect(classifier.generateResponse).not.toHaveBeenCalled();
    expect(mem0.update).not.toHaveBeenCalled();
  });

  it("leaves memories uncategorized when the classifier returns invalid JSON", async () => {
    const mem0 = makeMem0({
      add: vi.fn(async () => ({
        results: [{ id: "a", memory: "m", metadata: { event: "ADD" } }],
      })),
    });
    const classifier = {
      generateResponse: vi.fn(async () => ({ content: "not-json" })),
    };
    const adapter = new OssMemoryClientAdapter(mem0 as any, classifier);
    const result = await adapter.add([{ role: "user", content: "hi" }], {
      userId: "u",
      customCategories: [{ preferences: "..." }],
    });
    expect(mem0.update).not.toHaveBeenCalled();
    expect(result[0].categories).toBeUndefined();
  });

  it("forwards deleteAll after translating entity params", async () => {
    const mem0 = makeMem0();
    const adapter = new OssMemoryClientAdapter(mem0 as any, llm);
    await adapter.deleteAll({ userId: "u", appId: "proj" });
    expect(mem0.deleteAll).toHaveBeenCalledWith({ userId: "u", agentId: "proj" });
  });
});

import { describe, it, expect, vi } from "vitest";
import { buildToolExecute, formatToolCall } from "../src/memory/tools.ts";
import type { ScopeContext } from "../src/types.ts";

const mockMem0 = {
  search: vi.fn(),
  add: vi.fn(),
  getAll: vi.fn(),
  delete: vi.fn(),
  deleteAll: vi.fn(),
};

const scopeCtx: ScopeContext = {
  userId: "testuser",
  appId: "testproject",
  runId: "session123",
};

describe("formatToolCall", () => {
  it("renders the supplied tool name and explicitly named arguments", () => {
    expect(formatToolCall("mem0_memory", {
      action: "search",
      query: "Pi UI tool arguments",
      scope: "global",
    })).toBe('mem0_memory action=search query="Pi UI tool arguments" scope="global"');
  });

  it("uses JSON quoting for argument values", () => {
    expect(formatToolCall("example", {
      content: "User prefers\nconcise replies",
      count: 2,
    })).toBe('example content="User prefers\\nconcise replies" count=2');
  });

  it("omits arguments that were not supplied", () => {
    expect(formatToolCall("example", { action: "get_all", scope: undefined }))
      .toBe("example action=get_all");
  });
});

describe("buildToolExecute", () => {
  const execute = buildToolExecute(mockMem0 as any, scopeCtx, "project");

  it("search calls mem0.search with correct filters", async () => {
    mockMem0.search.mockResolvedValue({ results: [] });
    await execute({ action: "search", query: "dark mode" });
    expect(mockMem0.search).toHaveBeenCalledWith("dark mode", {
      filters: { user_id: "testuser", app_id: "testproject" },
    });
  });

  it("get_all requests every memory in scope", async () => {
    mockMem0.getAll.mockResolvedValue({ results: [] });
    await execute({ action: "get_all" });
    expect(mockMem0.getAll).toHaveBeenCalledWith({
      filters: { user_id: "testuser", app_id: "testproject" },
      topK: 1_000_000,
    });
  });

  it("add calls mem0.add with customCategories and entity params", async () => {
    mockMem0.add.mockResolvedValue([{ id: "new-id", memory: "test" }]);
    await execute({ action: "add", content: "User likes tabs" });
    const call = mockMem0.add.mock.calls[0];
    expect(call[0]).toEqual([{ role: "user", content: "User likes tabs" }]);
    expect(call[1].userId).toBe("testuser");
    expect(call[1].appId).toBe("testproject");
    expect(call[1].customCategories).toBeDefined();
    expect(call[1].customCategories.length).toBe(10);
  });

  it("search with scope=global filters by user_id with app_id wildcard", async () => {
    mockMem0.search.mockResolvedValue({ results: [] });
    await execute({ action: "search", query: "preferences", scope: "global" });
    expect(mockMem0.search).toHaveBeenCalledWith("preferences", {
      filters: { user_id: "testuser", app_id: "*" },
    });
  });

  it("delete calls mem0.delete with full memory_id", async () => {
    mockMem0.delete.mockResolvedValue({ message: "deleted" });
    await execute({ action: "delete", memory_id: "abc12345-6789-0abc-def0-123456789abc" });
    expect(mockMem0.delete).toHaveBeenCalledWith("abc12345-6789-0abc-def0-123456789abc");
  });

  it("delete passes memory_id directly to mem0.delete", async () => {
    const fullId = "956e3d68-b420-4e07-a4e3-3019e7cebe6f";
    mockMem0.delete.mockResolvedValue({ message: "deleted" });
    await execute({ action: "delete", memory_id: fullId });
    expect(mockMem0.delete).toHaveBeenCalledWith(fullId);
  });
});

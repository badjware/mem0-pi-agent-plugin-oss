import { describe, it, expect, afterEach } from "vitest";
import { resolveUserId, formatRecallContext } from "./entry.ts";
import { Prefetch } from "./oss/prefetch.ts";

describe("resolveUserId", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns config userId when set", () => {
    expect(resolveUserId("config-user")).toBe("config-user");
  });

  it("falls back to USER env var", () => {
    process.env.USER = "env-user";
    delete process.env.USERNAME;
    expect(resolveUserId("")).toBe("env-user");
  });

  it("falls back to USERNAME env var on Windows", () => {
    delete process.env.USER;
    process.env.USERNAME = "win-user";
    expect(resolveUserId("")).toBe("win-user");
  });

  it("falls back to os.userInfo() when env vars are missing", () => {
    delete process.env.USER;
    delete process.env.USERNAME;
    const result = resolveUserId("");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatRecallContext", () => {
  const memories = [
    { id: "m1", memory: "User prefers pnpm over npm", categories: ["preferences"] },
  ];

  it("returns empty when disabled", () => {
    expect(formatRecallContext(false, memories)).toBe("");
  });

  it("returns empty when no memories match", () => {
    expect(formatRecallContext(true, [])).toBe("");
  });

  it("injects recalled memory text when enabled and matches exist", () => {
    const out = formatRecallContext(true, memories);
    expect(out).toContain("User prefers pnpm over npm");
    expect(out).toContain("mem0-relevant-memories");
  });
});

describe("Prefetch", () => {
  it("returns fallback when nothing was queued", async () => {
    const p = new Prefetch<number[]>();
    expect(await p.consume(50, [])).toEqual([]);
  });

  it("returns the resolved value when the fetch beats the timeout", async () => {
    const p = new Prefetch<number[]>();
    p.queue(async () => [1, 2, 3]);
    expect(await p.consume(100, [])).toEqual([1, 2, 3]);
  });

  it("returns fallback when the fetch is slower than the timeout", async () => {
    const p = new Prefetch<number[]>();
    p.queue(
      () => new Promise<number[]>((resolve) => setTimeout(() => resolve([9]), 50)),
    );
    expect(await p.consume(5, [])).toEqual([]);
  });

  it("returns fallback when the fetch rejects", async () => {
    const p = new Prefetch<number[]>();
    p.queue(async () => {
      throw new Error("boom");
    });
    expect(await p.consume(50, [])).toEqual([]);
  });

  it("consume clears the pending promise so a second call falls back", async () => {
    const p = new Prefetch<number[]>();
    p.queue(async () => [1]);
    await p.consume(50, []);
    expect(await p.consume(50, [])).toEqual([]);
  });
});

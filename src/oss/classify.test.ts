import { describe, it, expect, vi } from "vitest";
import { classifyMemories } from "./classify.ts";

const taxonomy = [
  { preferences: "Likes, dislikes, habits" },
  { identity: "Personal details" },
];

describe("classifyMemories", () => {
  it("returns {} for empty inputs", async () => {
    const llm = { generateResponse: vi.fn() };
    expect(await classifyMemories(llm, [], taxonomy)).toEqual({});
    expect(
      await classifyMemories(llm, [{ id: "a", text: "x" }], []),
    ).toEqual({});
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  it("parses valid JSON assignments and keeps only known categories", async () => {
    const llm = {
      generateResponse: vi.fn(async () => ({
        content: JSON.stringify({
          assignments: {
            a: ["preferences", "bogus"],
            b: ["identity"],
          },
        }),
      })),
    };
    const out = await classifyMemories(
      llm,
      [
        { id: "a", text: "..." },
        { id: "b", text: "..." },
      ],
      taxonomy,
    );
    expect(out).toEqual({ a: ["preferences"], b: ["identity"] });
  });

  it("strips markdown code fences before parsing", async () => {
    const llm = {
      generateResponse: vi.fn(async () => ({
        content: "```json\n" + JSON.stringify({ assignments: { a: ["identity"] } }) + "\n```",
      })),
    };
    const out = await classifyMemories(llm, [{ id: "a", text: "x" }], taxonomy);
    expect(out).toEqual({ a: ["identity"] });
  });

  it("returns {} on malformed output", async () => {
    const llm = {
      generateResponse: vi.fn(async () => ({ content: "not json" })),
    };
    const out = await classifyMemories(llm, [{ id: "a", text: "x" }], taxonomy);
    expect(out).toEqual({});
  });

  it("returns {} when the LLM call throws", async () => {
    const llm = {
      generateResponse: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const out = await classifyMemories(llm, [{ id: "a", text: "x" }], taxonomy);
    expect(out).toEqual({});
  });
});

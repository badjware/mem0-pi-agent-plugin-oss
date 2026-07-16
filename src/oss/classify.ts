import type { CustomCategory } from "../types.ts";

/** Minimal shape of a mem0ai/oss LLM used for classification. */
export interface ClassifierLlm {
  generateResponse(
    messages: Array<{ role: string; content: string }>,
    response_format?: { type: string },
  ): Promise<any>;
}

export interface MemoryToClassify {
  id: string;
  text: string;
}

function taxonomyToPrompt(taxonomy: CustomCategory[]): string {
  return taxonomy
    .map((entry) => {
      const [name, description] = Object.entries(entry)[0] ?? ["", ""];
      return `- ${name}: ${description}`;
    })
    .join("\n");
}

function buildPrompt(
  items: MemoryToClassify[],
  taxonomy: CustomCategory[],
): string {
  const taxonomyText = taxonomyToPrompt(taxonomy);
  const memoriesText = items
    .map((m) => `id: ${m.id}\ntext: ${m.text}`)
    .join("\n---\n");
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
    'Return strict JSON: {"assignments": {"<memoryId>": ["<category>", ...], ...}}. Include every memory id, even ones with an empty array.',
  ].join("\n");
}

function extractContent(response: any): string {
  if (typeof response === "string") return response;
  if (response?.content && typeof response.content === "string") return response.content;
  return "";
}

function parseAssignments(
  raw: string,
  allowed: Set<string>,
): Record<string, string[]> {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  try {
    const parsed = JSON.parse(text);
    const assignments = parsed?.assignments ?? parsed;
    if (!assignments || typeof assignments !== "object") return {};
    const out: Record<string, string[]> = {};
    for (const [id, cats] of Object.entries(assignments)) {
      if (!Array.isArray(cats)) continue;
      const filtered = cats.filter(
        (c): c is string => typeof c === "string" && allowed.has(c),
      );
      out[id] = filtered;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Best-effort classification of newly-added memories against a category
 * taxonomy. One LLM call, returning a map from memory id to category names.
 * Never throws; on parse or model failure, returns {} so callers can skip
 * updates and leave memories uncategorized.
 */
export async function classifyMemories(
  llm: ClassifierLlm,
  items: MemoryToClassify[],
  taxonomy: CustomCategory[],
): Promise<Record<string, string[]>> {
  if (items.length === 0 || taxonomy.length === 0) return {};

  const allowed = new Set(
    taxonomy.flatMap((entry) => Object.keys(entry)),
  );
  const prompt = buildPrompt(items, taxonomy);

  try {
    const response = await llm.generateResponse(
      [
        {
          role: "system",
          content:
            "You are a strict JSON classifier. Respond with JSON only, no prose.",
        },
        { role: "user", content: prompt },
      ],
      { type: "json_object" },
    );
    return parseAssignments(extractContent(response), allowed);
  } catch {
    return {};
  }
}

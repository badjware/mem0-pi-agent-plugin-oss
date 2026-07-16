import type { CustomCategory } from "../types.ts";
import type { ClassifierLlm } from "./classify.ts";
import { classifyMemories } from "./classify.ts";

/**
 * Minimal mem0ai/oss Memory surface used by this plugin. Typed loosely so we
 * do not couple the adapter to a specific version of the OSS SDK.
 */
export interface OssMemoryLike {
  add(messages: any, options: any): Promise<{ results: any[] }>;
  search(query: string, options?: any): Promise<{ results: any[] }>;
  getAll(options?: any): Promise<{ results: any[] }>;
  get(memoryId: string): Promise<any>;
  update(memoryId: string, patch: any): Promise<any>;
  delete(memoryId: string): Promise<{ message: string }>;
  deleteAll(options?: any): Promise<{ message: string }>;
}

/** Lift `metadata.categories` onto a memory result as top-level `categories`,
 *  matching the shape callers expect from the cloud MemoryClient. */
function liftCategories<T extends { metadata?: any; categories?: any }>(mem: T): T {
  const cats = mem?.metadata?.categories;
  if (Array.isArray(cats) && !mem.categories) {
    (mem as any).categories = cats;
  }
  return mem;
}

/** Translate call-site scope params (appId, app_id) into the entity keys
 *  mem0ai/oss understands (agentId, agent_id). Global scope uses "*" as a
 *  wildcard sentinel; drop it so the filter matches all agents for the user. */
function translateEntityOptions(options: any): any {
  if (!options) return options;
  const out: any = { ...options };
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

export class OssMemoryClientAdapter {
  constructor(
    private readonly mem0: OssMemoryLike,
    private readonly llm: ClassifierLlm,
  ) {}

  async add(messages: any, options: any = {}): Promise<any[]> {
    const { customCategories, ...rest } = options as {
      customCategories?: CustomCategory[];
    } & Record<string, any>;
    const translated = translateEntityOptions(rest);
    const { results } = await this.mem0.add(messages, translated);

    const newItems = results.filter((r: any) => r?.metadata?.event === "ADD");
    if (customCategories && customCategories.length > 0 && newItems.length > 0) {
      const assignments = await classifyMemories(
        this.llm,
        newItems.map((r: any) => ({ id: r.id, text: r.memory })),
        customCategories,
      );
      // NB: only fresh ADDs are classified. If mem0 rewrites an existing
      // memory with new info its previous categories survive; acceptable for
      // a first cut.
      await Promise.allSettled(
        newItems
          .filter((r: any) => assignments[r.id]?.length)
          .map((r: any) =>
            this.mem0.update(r.id, { metadata: { categories: assignments[r.id] } }),
          ),
      );
      for (const r of newItems) {
        const cats = assignments[r.id];
        if (cats?.length) {
          r.categories = cats;
          r.metadata = { ...(r.metadata ?? {}), categories: cats };
        }
      }
    }

    // Cloud MemoryClient returns an array from add(); mirror that so upstream
    // call sites (Array.isArray(result)) keep working.
    return results;
  }

  async search(query: string, options?: any): Promise<{ results: any[] }> {
    const translated = translateEntityOptions(options);
    const res = await this.mem0.search(query, translated);
    return { results: (res.results ?? []).map(liftCategories) };
  }

  async getAll(options?: any): Promise<{ results: any[] }> {
    const translated = translateEntityOptions(options);
    const res = await this.mem0.getAll(translated);
    return { results: (res.results ?? []).map(liftCategories) };
  }

  async get(memoryId: string): Promise<any> {
    const mem = await this.mem0.get(memoryId);
    return mem ? liftCategories(mem) : mem;
  }

  async update(memoryId: string, patch: any): Promise<any> {
    return this.mem0.update(memoryId, patch);
  }

  async delete(memoryId: string): Promise<{ message: string }> {
    return this.mem0.delete(memoryId);
  }

  async deleteAll(options?: any): Promise<{ message: string }> {
    return this.mem0.deleteAll(translateEntityOptions(options));
  }
}

import type { OssMemoryClientAdapter } from "./client.ts";

export interface OssRuntime {
  client: OssMemoryClientAdapter;
}

type State =
  | { kind: "active"; runtime: OssRuntime }
  | { kind: "inactive"; reason: string };

/**
 * Lazy holder for the OSS runtime. The extension factory registers tools,
 * commands, and hooks unconditionally against a proxy backed by this holder;
 * the actual runtime is constructed on session_start once ctx.modelRegistry is
 * available and can retry on later session_start events.
 */
export class RuntimeHolder {
  private state: State = { kind: "inactive", reason: "runtime has not been initialized yet" };

  setActive(runtime: OssRuntime): void {
    this.state = { kind: "active", runtime };
  }

  setInactive(reason: string): void {
    this.state = { kind: "inactive", reason };
  }

  isActive(): boolean {
    return this.state.kind === "active";
  }

  reason(): string | null {
    return this.state.kind === "inactive" ? this.state.reason : null;
  }

  require(): OssRuntime {
    if (this.state.kind !== "active") {
      throw new Error(`mem0 is not active: ${this.state.reason}`);
    }
    return this.state.runtime;
  }
}

const CLIENT_METHODS = [
  "add",
  "search",
  "getAll",
  "get",
  "update",
  "delete",
  "deleteAll",
] as const;

/**
 * Build a MemoryClient-shaped proxy that routes each call through the holder.
 * Keeps upstream call sites unchanged: `mem0.search(...)` still works, but if
 * the runtime is inactive, the promise rejects with a clear reason.
 */
export function makeLazyClient(holder: RuntimeHolder): any {
  const out: any = {};
  for (const method of CLIENT_METHODS) {
    out[method] = (...args: any[]) =>
      (holder.require().client as any)[method](...args);
  }
  return out;
}

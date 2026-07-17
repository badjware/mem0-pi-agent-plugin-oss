import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Mem0Config, DreamConfig } from "../types.ts";

const AGENT_ROOT = path.join(os.homedir(), ".pi", "agent");
export const CONFIG_DIR = AGENT_ROOT;
export const CONFIG_PATH = path.join(AGENT_ROOT, "mem0-oss-config.json");

const DEFAULT_DREAM: DreamConfig = {
  enabled: true,
  auto: true,
  minHours: 24,
  minSessions: 5,
  minMemories: 20,
};

const DEFAULT_CONFIG: Mem0Config = {
  userId: "",
  autoCapture: true,
  defaultScope: "project",
  contextInjection: true,
  searchThreshold: 0.3,
  dream: DEFAULT_DREAM,
};

/** Empty string and null both count as "unset", matching the file-config JSON round-trip. */
function normalizeStr(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return value;
}

/**
 * Load the OSS plugin config from ~/.pi/agent/mem0-oss-config.json, merged with
 * defaults. Malformed JSON is swallowed and defaults are used, matching upstream
 * behavior. Missing `oss.llm.model` is not caught here; runtime activation is
 * what fails fast when the model cannot be resolved.
 */
export function loadConfig(): Mem0Config {
  let fileConfig: Partial<Mem0Config> = {};

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      fileConfig = JSON.parse(raw);
    } catch {
      // Corrupted config — use defaults
    }
  }

  const dream: DreamConfig = {
    ...DEFAULT_DREAM,
    ...(fileConfig.dream ?? {}),
  };

  const config: Mem0Config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    dream,
  };

  if (process.env.MEM0_USER_ID) {
    config.userId = process.env.MEM0_USER_ID;
  }
  if (process.env.MEM0_OSS_LLM_MODEL) {
    config.oss = {
      ...(config.oss ?? {}),
      llm: { model: process.env.MEM0_OSS_LLM_MODEL },
    };
  }

  const embedderModel =
    normalizeStr(process.env.MEM0_OSS_EMBEDDER_MODEL) ??
    normalizeStr(fileConfig.oss?.embedder?.model);

  if (embedderModel !== undefined) {
    config.oss = {
      ...(config.oss ?? {}),
      embedder: { model: embedderModel },
    } as Mem0Config["oss"];
  } else if (config.oss?.embedder) {
    const { embedder, ...rest } = config.oss;
    config.oss = rest as Mem0Config["oss"];
  }

  return config;
}

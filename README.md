# @badjware/mem0-pi-agent-plugin-oss

Persistent semantic memory for [Pi Agent](https://pi.dev), backed by [mem0ai/oss](https://github.com/mem0ai/mem0) and local SQLite. Local-only fork of `@mem0/pi-agent-plugin` with the cloud client and plugin telemetry removed.

## Differences from upstream `@mem0/pi-agent-plugin`

- **No cloud dependency.** Storage is entirely local: mem0ai/oss's built-in SQLite-backed `memory` vector store plus a SQLite history store under `~/.pi/agent/memories/`.
- **No plugin telemetry.** `src/telemetry.ts` and every capture call site were deleted.

See `PATCH_NOTES.md` for the full divergence.

## Features

- **Automatic memory capture** — learns from every conversation (both user and assistant messages)
- **Semantic search** — find memories by meaning, not just keywords
- **Scoped memory** — project, session, or global scope
- **Monorepo-aware** — uses git root for project detection, consistent app_id across subdirectories
- **Dream consolidation** — merges duplicates, resolves contradictions, prunes stale entries
- **Confirmation dialogs** — destructive commands ask before acting
- **8 slash commands** — essential memory management from the command line
- **Agent tool** — `mem0_memory` tool lets the agent search and store memories autonomously

## Setup

### 1. Install

```bash
pi install git:github.com/badjware/mem0-pi-agent-plugin-oss
```

### 2. Register a local LLM in pi

The plugin uses pi's model registry to find the extraction LLM's credentials and base URL, so the model must already be registered in pi. Follow the instructions in [pi's docs](https://pi.dev/docs/latest/models#model-configuration) to register a LLM provider (e.g., `ollama`, `vllm`, `lmstudio`, etc.) and note the desired `provider/model` identifier.

### 3. Configure

Create `~/.pi/agent/mem0-oss-config.json`:

```json
{
  "oss": {
    "llm": { "model": "ollama/qwen3.5:4b" }
  },
  "userId": "your-username",
  "autoCapture": true,
  "defaultScope": "project",
  "searchThreshold": 0.2,
  "dream": {
    "enabled": true,
    "auto": true,
    "minHours": 24,
    "minSessions": 5,
    "minMemories": 20
  }
}
```

`oss.llm.model` is required. It must be a `provider/model` identifier already registered in pi. Only `ollama`, `openai-completions`-style providers (LM Studio, vLLM, ...), and `anthropic-messages` providers are supported. `MEM0_OSS_LLM_MODEL` overrides the config file, and `MEM0_USER_ID` overrides `userId`.

Embedder and vector store are not configuratble for now. (fastembed `fast-bge-small-en-v1.5`, mem0's `memory` vector store with SQLite `dbPath`).

Categories are preserved via one extra LLM call per capture against the same `oss.llm.model`, using the same `DEFAULT_CUSTOM_CATEGORIES` taxonomy as upstream.

`searchThreshold` (default `0.3`) is the minimum similarity score (0–1) a memory must reach to count as a match for `/mem0-search`, `/mem0-forget`, and `/mem0-pin`. It is passed to the mem0 search API, so a query with no sufficiently similar memory reports no match instead of returning the closest unrelated memories. Raise it to be stricter; lower it if relevant results are missed.

## Commands

| Command | Description |
|---------|-------------|
| `/mem0-remember <text>` | Store a memory verbatim (no inference) |
| `/mem0-forget <query>` | Search and delete memories (with confirmation) |
| `/mem0-search <query>` | Semantic search across memories |
| `/mem0-tour [scope]` | Browse all memories grouped by category |
| `/mem0-dream` | Consolidate — merge duplicates, prune stale, resolve contradictions |
| `/mem0-pin <query>` | Pin a memory to protect from dream pruning (preserves ID) |
| `/mem0-scope <scope>` | Change default scope for this session |
| `/mem0-status` | Runtime health (active/inactive + reason), identity, and memory count |

## Skills

The plugin includes 8 skills that guide the agent on how to use each capability:

| Skill | Purpose |
|-------|---------|
| `context-loader` | Pre-fetch relevant memories at session start |
| `remember` | Store facts with category classification |
| `search` | Quick semantic search with compact results |
| `forget` | Delete memories with confirmation |
| `dream` | Memory consolidation workflow |
| `tour` | Full memory walkthrough by category |
| `pin` | Protect critical memories from pruning |
| `status` | Health check and diagnostics |

## Memory Scopes

| Scope | Filters | Use case |
|-------|---------|----------|
| `project` | user + app_id (git root) | Default. Project-specific knowledge |
| `session` | user + app_id + run_id | Ephemeral, session-only context |
| `global` | user only | All memories across all your projects |

Project scoping uses `git rev-parse --show-toplevel` to detect the repository root, so all subdirectories within a monorepo share the same memory pool.

## Memory Categories

Memories are automatically classified into 10 general-purpose categories:

| Category | Description |
|----------|-------------|
| `identity` | Personal details, background, self-descriptions |
| `preferences` | Likes, dislikes, habits, preferred approaches |
| `goals` | Objectives, aspirations, targets |
| `projects` | Ongoing work, initiatives, areas of focus |
| `decisions` | Choices made, rationale, trade-offs |
| `technical` | Technical knowledge, tools, configurations |
| `relationships` | People, teams, organizations |
| `routines` | Recurring patterns, workflows, schedules |
| `lessons` | Insights learned, mistakes to avoid |
| `work` | Professional context, role, responsibilities |

## Architecture

```
pi-agent-plugin/
├── src/
│   ├── entry.ts          # Extension entry point
│   ├── index.ts          # Barrel exports
│   ├── commands.ts       # 8 slash commands
│   ├── prompt.ts         # System prompt injection (MEMORY_POLICY)
│   ├── types.ts          # Shared interfaces and categories
│   ├── telemetry.ts      # PostHog telemetry (batched, PII-safe)
│   ├── config/           # Config loading (~/.pi/agent/mem0-config.json)
│   ├── memory/           # Tool registration, scoping (git root), formatting
│   ├── capture/          # Auto-capture from conversations (user + assistant)
│   └── dream/            # Consolidation state, gating, locking, prompts
├── skills/               # 8 SKILL.md files for Pi Agent
├── tests/                # Vitest unit tests
└── dist/                 # Built output (ESM + DTS)
```

## Development

```bash
pnpm install          # Install dependencies
pnpm run typecheck    # Type check
pnpm run test         # Run tests
pnpm run build        # Build (ESM + declarations)
```

## License

[Apache-2.0](LICENSE)

# Agent guide

This repository is a fork of `mem0ai/mem0`, subtree `integrations/pi-agent-plugin`
(published upstream as `@mem0/pi-agent-plugin`). It is repackaged as
`@badjware/mem0-pi-agent-plugin-oss` and diverges from upstream in two ways:

1. The cloud `MemoryClient` (`api.mem0.ai`) is removed and replaced with an embedded
   `mem0ai/oss` `Memory` instance. There is no mode switch; the cloud path is gone.
2. Plugin telemetry (PostHog) is removed entirely.

Everything else is kept as close to upstream as possible so `git rebase` on new
upstream releases stays cheap.

## Fork discipline (read before editing)

The fork is designed as a thin diff. When making changes, follow these rules so
future rebases do not fight the patch:

- **New logic lives under `src/oss/`.** OSS adapters, runtime holder, config
  loader, model registry mapping, classification helper, prefetch, and their
  tests are all fork-only files. Upstream files should not grow new
  fork-specific logic; they should call into `src/oss/`.
- **Edit upstream files only at narrow seams.** Import swaps and single call-site
  substitutions are fine. Do not reformat, resort imports, or opportunistically
  clean up untouched regions. Match upstream Prettier/eslint output byte-for-byte
  in unchanged blocks.
- **Keep upstream identifiers, exports, and signatures stable.** Do not rename
  `Mem0Config`, `registerMemoryTool`, `buildToolExecute`, or the exported entry
  factory. When a signature must change (e.g. dropping `telemetryCtx`), keep
  the remaining parameter order intact.
- **Wrap, don't rewrite, at call sites.** The `OssMemoryClientAdapter` exposes
  the exact subset of the cloud `MemoryClient` method surface the plugin uses
  (`add`, `search`, `getAll`, `get`, `update`, `delete`, `deleteAll`) with
  matching signatures and result shapes (including lifting
  `metadata.categories` back onto items as top-level `categories`). Upstream
  call sites in `capture/`, `commands.ts`, `memory/tools.ts`, `dream/`,
  `formatting.ts`, and `entry.ts` see roughly the same object as before.
- **`PATCH_NOTES.md` is the source of truth for the fork surface.** Every
  upstream file this fork edits or deletes is listed there with a one-line
  rationale. Update it whenever you touch an upstream file, add a fork-only
  file, or delete an upstream file.

## What actually changed vs upstream

See `PATCH_NOTES.md` for the authoritative file-by-file list, and
`CHANGELOG.md` for user-visible behavior changes. Summary of edited upstream
files and why:

- `package.json` — renamed to `@badjware/mem0-pi-agent-plugin-oss`; pinned
  `mem0ai@^3.1.0` (required for FastEmbed embedder); added `fastembed` and
  `better-sqlite3` runtime deps; dropped upstream repo/directory metadata.
- `src/types.ts` — removed `apiKey` field, added optional `oss?: OssBlock` block
  (`llm.model` required, `embedder?: { provider?, model? }` optional).
- `src/entry.ts` — swapped cloud `MemoryClient` construction for a `RuntimeHolder`
  and lazy client proxy; runtime is constructed on `session_start` from
  `ctx.modelRegistry` (not in the factory, because model resolution needs the
  session); added `Prefetch`-based recall timeout guard; removed telemetry calls.
- `src/commands.ts` — accepts a `RuntimeHolder`, guards every command with
  `requireActive(ctx)`; `/mem0-status` reports the inactive reason; added
  `/mem0-reindex` (re-embeds all memories via `buildRuntimeForReindex`, confirms
  before running, writes the embedder metadata file, hot-swaps the holder via
  `RuntimeHolder.setActive()`); telemetry calls removed.
- `src/capture/index.ts` — accepts a `RuntimeHolder`, skips auto-capture when
  inactive; telemetry calls removed.
- `src/memory/tools.ts` — telemetry calls removed only. No structural changes.
- `src/index.ts` — removed telemetry export; added OSS module exports.
- `src/commands.test.ts`, `src/entry.test.ts` — updated to match the runtime
  holder plumbing and Prefetch.

Deleted upstream files: `src/telemetry.ts`, `src/telemetry.test.ts`,
`tests/telemetry.test.ts`, `src/config/index.ts` (replaced by
`src/oss/config.ts`), `tests/config.test.ts` (rewritten as `src/oss/*.test.ts`).

Fork-only files (all under `src/oss/` plus root-level docs): `config.ts`,
`model.ts`, `embedder.ts`, `embedder-metadata.ts`, `paths.ts`, `classify.ts`,
`client.ts`, `runtime.ts`, `activate.ts`, `prefetch.ts`, matching `*.test.ts`,
plus `PATCH_NOTES.md`, `CHANGELOG.md`, `NOTICE`.

## Rebasing on upstream

Upstream is not configured as a git remote (the fork was seeded via
`git subtree split`). The upstream commit this fork was seeded from is
recorded in `PATCH_NOTES.md`:

- Upstream repo HEAD at fork time: `ccbe5861a138c7583e01bb3a3aa6168e52526a23`
- Extracted subtree tip: `99f70e4a21da6d04091c13792d7065b3b5d59793`

To rebase on a newer upstream:

1. Clone (or update) upstream in a sibling directory. Keep it around for future
   re-syncs.
   ```
   git clone https://github.com/mem0ai/mem0.git ../upstream-mem0
   # or, if it already exists:
   git -C ../upstream-mem0 fetch origin
   ```
2. Split the plugin subdirectory out of upstream into a linear branch:
   ```
   git -C ../upstream-mem0 checkout main
   git -C ../upstream-mem0 pull
   git -C ../upstream-mem0 subtree split -P integrations/pi-agent-plugin -b extracted
   ```
3. In this repo, rebase the fork on top of the new extracted tip:
   ```
   git fetch ../upstream-mem0 extracted:upstream-extracted
   git rebase upstream-extracted
   ```
   Alternatively, `git pull --rebase ../upstream-mem0 extracted` works.
4. Resolve conflicts. Expected conflict surface is exactly the files listed in
   `PATCH_NOTES.md` under "Edited upstream files". If a conflict appears in a
   file not listed there, either the fork accidentally grew, or upstream renamed
   something. Fix the fork side, not upstream's; then update `PATCH_NOTES.md`.
5. Re-run the grep guards (see below) and the test suite.
6. Update `PATCH_NOTES.md` with the new upstream commit SHA and subtree tip, and
   add a `CHANGELOG.md` entry if user-visible behavior changed.

Conflict-resolution rules of thumb:

- If upstream restructures a call site that used to call `mem0.<method>(...)`,
  update the surrounding code minimally and keep calling through the adapter.
  Do not reintroduce `MemoryClient` or `mem0ai"` (bare cloud import).
- If upstream re-adds telemetry (`captureEvent`, `captureToolEvent`,
  `captureCommandEvent`, `telemetry.ts`), drop it again the same way the initial
  fork did: delete the call and its import; do not restructure surrounding code.
- If upstream changes call-site field names (`appId` vs `agentId`,
  `app_id` vs `agent_id`, cloud vs OSS response shapes), prefer updating
  `OssMemoryClientAdapter.translateEntityOptions()` and the result-lifting
  logic in `src/oss/client.ts` rather than editing upstream files.
- `formatting.ts` reads `mem.categories` at the top level; the adapter lifts
  `metadata.categories` onto results specifically to keep that file unedited.
  Preserve that arrangement.

## Post-rebase grep guards

After a rebase, run these to confirm the fork invariants still hold:

```
rg -n 'posthog|telemetry|analytics|captureEvent|captureToolEvent|captureCommandEvent'
rg -n 'MemoryClient|api\.mem0\.ai'
rg -n 'from "mem0ai"'      # the bare cloud SDK import; only 'mem0ai/oss' is allowed
```

All three should return no hits (aside from documentation references in this
file, `CHANGELOG.md`, and `PATCH_NOTES.md`).

## Local dev

- Package manager: `pnpm` (workspace declared in `pnpm-workspace.yaml`).
- Tests: `pnpm test` (vitest). New fork tests live next to their sources under
  `src/oss/*.test.ts`; upstream-style tests live under `tests/`.
- Build: `pnpm build` (tsup, config in `tsup.config.ts`).
- Runtime config file: `~/.pi/agent/mem0-oss-config.json`. Requires an explicit
  `oss.llm.model` in pi `provider/model` syntax (e.g. `ollama/qwen3.5:4b`).
  `MEM0_OSS_LLM_MODEL` env var overrides the config-file value. `MEM0_API_KEY`
  and the legacy `apiKey` config field are intentionally ignored.
- Persistence paths (mem0ai/oss built-in `memory` vector store, SQLite-backed):
  `~/.pi/agent/memories/mem0-vectors.db` and `~/.pi/agent/memories/mem0-history.db`.
- Embedder defaults to `fastembed` (`fast-bge-small-en-v1.5`, 384-dim). The
  model files are cached under `~/.pi/agent/memories/fastembed-cache/`; we
  init `fastembed`'s `FlagEmbedding` ourselves with an explicit `cacheDir` and
  hand mem0 a Langchain-shaped wrapper, because mem0's built-in
  `FastEmbedEmbedder` doesn't forward a `cacheDir` and otherwise defaults to
  `./local_cache` relative to cwd.
- Optional external embedder: set `oss.embedder.model` to a pi `provider/model`
  identifier in the config file (or `MEM0_OSS_EMBEDDER_MODEL`).
  `src/oss/embedder.ts` maps pi's model registry entries to mem0 embedder
  configs; only `ollama` and `openai-completions`-style providers are
  supported. When configured, the fastembed langchain shim is skipped and
  mem0's `EmbedderFactory` is used directly.
- Embedder identity is persisted to `~/.pi/agent/memories/mem0-embedder.json`
  (see `src/oss/embedder-metadata.ts`) alongside the vector store. On each
  activation, `activateRuntime()` compares the current resolved embedder
  (provider, model, dimension) against this file and refuses to activate on a
  mismatch. The user must run `/mem0-reindex` to re-embed existing memories with
  the new embedder. `buildRuntimeForReindex()` skips the comparison and always
  probes a fresh dimension. Dimension is probed once on first activation (or on
  reindex) and cached in the metadata file to avoid re-probing on every startup.
- No reranker is configured. `Memory` is constructed without a `reranker`
  field, so search returns results in raw vector-similarity order. The
  `rerank: true` option in `src/commands.ts` is a leftover from the cloud
  `MemoryClient` API and is silently ignored by mem0/oss.

## When in doubt

Prefer the option that touches fewer upstream lines, even if it is slightly less
clean in isolation. The rebase cost of an in-place edit is higher than the
maintenance cost of a small wrapper under `src/oss/`.

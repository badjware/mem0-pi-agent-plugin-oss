# Fork patch notes

This fork tracks `mem0ai/mem0`, subtree `integrations/pi-agent-plugin`.

- Upstream commit fork was seeded from: `ccbe5861a138c7583e01bb3a3aa6168e52526a23`
- Extracted subtree tip after `git subtree split`: `99f70e4a21da6d04091c13792d7065b3b5d59793`

Any file listed below is the fork's edit surface into upstream. Everything else lives under `src/oss/` (new files) so a rebase reviewer can audit the diff at a glance.

## Edited upstream files

- `package.json` — renamed to `@badjware/mem0-pi-agent-plugin-oss`; pin `mem0ai@^3.1.0`; add `fastembed`, `better-sqlite3`; drop upstream repo/directory metadata
- `src/types.ts` — remove `apiKey` field, add optional `oss?: OssBlock` block
- `src/entry.ts` — swap cloud `MemoryClient` construction for `RuntimeHolder` + lazy proxy; construct OSS runtime on `session_start` from `ctx.modelRegistry`; add Prefetch-based recall timeout guard; remove telemetry calls
- `src/commands.ts` — accept `RuntimeHolder`, guard every command with `requireActive(ctx)`; rewrite `/mem0-status` to report the inactive reason; remove telemetry calls
- `src/capture/index.ts` — accept `RuntimeHolder` and skip auto-capture when inactive; remove telemetry calls; drop `await` on `mem0.add` so local-LLM fact extraction runs in the background instead of blocking the next prompt
- `src/memory/tools.ts` — remove telemetry calls
- `src/index.ts` — remove telemetry export; add OSS module exports
- `src/commands.test.ts` — remove telemetry mock; add `RuntimeHolder`; drop `apiKey`
- `src/entry.test.ts` — replace `buildRecallContext` with `formatRecallContext`; add Prefetch coverage

## Deleted upstream files

- `src/telemetry.ts`
- `src/telemetry.test.ts`
- `tests/telemetry.test.ts`
- `src/config/index.ts` — replaced by `src/oss/config.ts`
- `tests/config.test.ts` — rewritten to test the OSS config surface

## New files (fork-only)

- `src/oss/config.ts` — loader for `~/.pi/agent/mem0-oss-config.json`, `MEM0_OSS_LLM_MODEL` env override
- `src/oss/model.ts` — pi model registry to mem0 LLM config mapping
- `src/oss/paths.ts` — SQLite path resolution with `~` expansion and dir creation
- `src/oss/classify.ts` — client-side category classifier
- `src/oss/client.ts` — `OssMemoryClientAdapter` wrapping mem0ai/oss `Memory`
- `src/oss/runtime.ts` — `RuntimeHolder` + lazy client proxy
- `src/oss/activate.ts` — runtime construction routine invoked from `session_start`
- `src/oss/prefetch.ts` — two-phase prefetch with timeout race
- `src/oss/*.test.ts` — coverage for the fork-specific modules
- `PATCH_NOTES.md`, `CHANGELOG.md`, `NOTICE`

## Notes for future rebases

- The adapter is the single point of translation between upstream call sites (which use `appId`, `app_id`, cloud response shapes) and mem0ai/oss (which uses `agentId`, `agent_id`, `{ results }`). If upstream changes call-site field names, prefer updating the adapter's `translateEntityOptions()` rather than touching upstream files.
- `formatting.ts` still reads `mem.categories`; the adapter lifts `metadata.categories` onto results specifically so this file does not need to change.

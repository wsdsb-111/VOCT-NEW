V9.3.9 补充合同：2／3 人时间摘要 5 篇、4+ 人 3 篇，第三人始终全场共享 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承、不扩大来源权限。Character Knowledge 独立于退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。用户本轮只交付代码、自动化验证和 GitHub 上传，不执行真实 CK3／付费 Provider／Soak 或 GitHub Release。

# Main Process Guidelines

These rules apply to editable src/app/main/ and its generated resources/app/out/main/ output, especially main.js, services, providers and IPC. Edit source and rebuild; do not edit generated output alone.

V9.3.9 player-memory and context-budget behavior is a candidate, not a release-completion claim; it retains V9.3.7 age/kinship contracts. Formal project/core and Electron App versions come from package metadata and final reports. VOTC Workshop Mod is 2.0.5. Provider User-Agent reads the App version from package.json via version.js. The history-memory UI label is `Legacy Summary`; protocol 3.0, summary storage 2.5 and Official Action 2.0.3 remain compatible. Memory4/Durable is retired from production.

Renamed summary folders consolidate only by numeric Owner ID, with counterpart files resolved by numeric ID. Summary listing and GameData paths delegate to MemoryStore; raw verified backups stay outside recall under baseDir/renamed-summary-folders. Preserve Campaign scopes, Legacy binding IDs, manual edits, Forget and tombstones. Old archive Sidecars remain byte-for-byte inert: do not scan, read or write them. Skip a rename merge if it would include any Sidecar; normal Legacy-only reads and writes continue. The Legacy forget ledger belongs in the existing index and commits or rolls back with the summary mutation. Directory creation/removal is recorded in the existing version 1 summary mutation journal for rollback.

## Scope and architecture

main.js is the shipped Electron composition root. Keep orchestration and dependency wiring there; make behavior changes in the smallest owning module. The current layout includes:

- actions/: Official VOTC 2.0.3 action registry, lifecycle, prompt/response handling, RunFile dispatch, ACK and effect confirmation. The retired self-developed action-system must not receive production runtime behavior.
- conversation/, summaries/ and memory-system/: turn lifecycle, finalization, Legacy summary catalog/store and recall, and third-person evidence. Do not restore Memory4/Durable extraction, recovery, recall or UI service injection.
- Pair Memory Index access stays Owner→Counterpart scoped. `getPairMemoryIndex` supports complete-set search/date filtering with page/pageSize/sort; `previewPairMemoryBackfill` must precede `applyPairMemoryBackfill`, and apply consumes its preview revision. Batch work is selected-Owner only and is applied per Pair so progress and partial outcomes remain visible. Without GameData, one trusted Campaign binding within the selected Pair or Owner scope permits explicitly confirmed local index backfill; unbound or ambiguous scopes remain read-only. Offline backfill never modifies Legacy source text, grants current-game knowledge, or accepts a client-supplied Campaign/path/authority flag.
- `openPairMemorySource` accepts a source key and expected source revision; the backend verifies both before returning current source text and the exact source-item pointer. Open that verified text in a modal and locate the validated item there. Never navigate from cached summary rows, date/line guesses, or a client-supplied filesystem path. A missing or changed source is stale and must be refreshed. Renderer person labels use actual names; unknown names display a clear unavailable-name message, with IDs restricted to internal use or folded diagnostics.
- worldline/, game-data/ and historical-system/: CK3 read-only Save/GameState, Current Runtime Truth, relation/kinship resolution, worldline/canon, historical Definition↔Runtime binding and temporal/freshness gates.
- letters/, providers/, ipc/, analytics/, runtime/, config/, app/, prompts/: their existing transport, provider, boundary and persistence responsibilities.

Do not reformat, rebundle or broadly refactor generated code. Preserve IPC names, persisted settings keys, Action signatures/IDs, analytics field names, prompt block IDs, worldline schemas, queue metadata and existing user-data formats.

## Action, truth and safety contracts

- V8.8.4: preserve game-side command deduplication, player-excluding NPC indices and explicit root binding. Gold/opinion verification consumes bounded command-local BEGIN-to-ACK snapshots, not later conversation balances. A generic ACK is receipt only, never confirmed effect success. Preserve stale-session zero-write quarantine and recovery backups.
- V8.8.5: queue TTL belongs to RunFileManager; ACK timeout starts at dispatch, not enqueue. Only a unique unambiguous payment amount may override model arguments. Opinion feedback remains provisional until CONFIRMED. Missing ages are unknown, never zero; extended kinship uses actual graph paths and birth/age seniority, with paternal uncles compared to the father rather than the child. Legacy English family rendering must not add Action participants or overwrite user scripts.
- Detect and validate action candidates deterministically before any model request. Distinguish completed narration from questions, commands, plans, hypothetical statements, failed attempts, memories and discussion.
- Preserve the action pipeline: deterministic pre-model gate, constrained candidate set, registered check(), structured model output, local validation and explicit execution result.
- CK3 is authoritative for state. Do not add optimistic local state updates for effects that have not been acknowledged. For gold transfer, a single RunFile's Effect, both sides' runtime gold and ACK must be reconciled; exact match alone becomes CONFIRMED, while mismatch/timeout stays a safe failure state.
- Run Command Queue recovery must fail closed: durable awaiting_ack precedes physical write; a write without ACK is STALLED, not replayable automatically; corrupt state, stale ACK and ambiguous carrier must not dispatch a duplicate effect.
- Worldline facts are read-only CK3 evidence. Current Runtime Truth is shared by in-scene participants, mentioned characters and Family Fact; canonical runtime gender wins and missing/conflicting gender remains neutral. Memory or historical identity must not override current runtime state.
- Historical Definition↔Runtime binding is one-to-one and evidence-gated. Ambiguous, incomplete or stale source must not resolve into Game Truth. Do not revive the retired V8.3 Shadow chain.
- Legacy Summary fixed history is player-anchored: complete Recent2, eligible official recollection and the complete legal player Pair ledger, frozen on first construction. L0 nominations read no third-person history; explicit historical relationship questions permit L1 (at most 16 matters per target, no source text). Explicit player historical clauses may combine up to 5 temporal summaries for 2/3 participants or 3 for 4+ participants and up to 3 third-person source summaries total across targets, each source revalidated by key and revision. Participant counts 2/3/4+ use 65%/70%/75% of the configured window with caps 80,000/84,000/96,000 Tokens, further limited by non-memory Prompt space, output reserve and actual Provider headroom. If complete sources do not fit, compact older conversation via the existing mechanism first; if still over budget, stop before transport and show needed, available and component budgets. Do not silently clip sources or omit legal ledger items. Inline context usage is dynamic to the configured window, scoped to conversation and responder, refreshed each turn, and resets with a new conversation; reject stale events and distinguish provisional estimates from actual usage for the most recent request. NPC-to-NPC directed writes remain legal without expanding fixed recall. Source/Forget/Campaign changes invalidate frozen context and must be checked again before transport/retry. Protocol 3.0/storage 2.5 remain; Sidecars stay inert and Year/Life utilities remain outside Runtime.
- V9.3.7 age and kinship evidence is source-bound to CK3. Calendar arithmetic is diagnostic only; UNKNOWN is not absence. Public otherParent must not grant Memory access. Current step-family requires complete public parents and fresh current marriage; explicit death, life conflicts, secrets and ambiguity fail closed. Do not infer past step-family from former spouses or automatically reconstruct historical marriage intervals.

## Prompt and provider rules

Stable Prompt blocks must precede volatile conversation data for provider cache prefixes. Any cache-anchor or block-ID change requires a version update and a note in README.md/the relevant phase record. Keep provider-specific schema and credentials isolated from Chat, Summary, Action and Letter contracts; never log secrets or complete user messages.

## Verification

For each behavior change, add/update the narrowest matching deterministic test and register it in scripts/test-manifest.js. Run:

~~~powershell
node scripts\test-release.js
node scripts\test-v7.10-official-action-system.js
node --check resources\app\out\main\main.js
node --check resources\app\out\main\provider-service.js
node --check resources\app\out\main\providers\index.js
node --check resources\app\out\main\ipc\register-ipc.js
node --check resources\app\out\main\worldline\world-presentation.js
node --check resources\app\out\renderer\world-memory-editor.js
node --check resources\app\out\renderer\worldline-player-presentation.js
git diff --check
~~~

Changes to IPC, settings, prompts, streaming, actions, summaries or worldline require a corresponding VOTC.exe manual smoke test. Verify relevant CK3 Save/debug.log/Provider behavior separately; static tests and isolated fixtures are not real-game or API end-to-end evidence.

Current implementation evidence is indexed by README.md, docs/README.md and `docs/current/v9/V9_3_9_IMPLEMENTATION_REPORT.md`. Record V9.3.9 local gates and real-game / Provider / Soak / remote CI by actual candidate evidence and SHA; preserve V9.3.7's synthetic Provider PARTIAL and `9caffe6` remote CI FAILED under that historical SHA.

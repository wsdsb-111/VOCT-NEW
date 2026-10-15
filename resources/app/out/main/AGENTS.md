# Main Process Guidelines

These rules apply to editable src/app/main/ and its generated resources/app/out/main/ output, especially main.js, services, providers and IPC. Edit source and rebuild; do not edit generated output alone.

Current project/core and Electron App package version is V9.3.4; VOTC Workshop Mod is 2.0.5. Provider User-Agent reads the App version from package.json via version.js. The current history-memory UI label is `Legacy Summary`; protocol 3.0, summary storage 2.5 and Official Action 2.0.3 remain compatible. Memory4/Durable is retired from production.

Renamed summary folders consolidate only by numeric Owner ID, with counterpart files resolved by numeric ID. Summary listing and GameData paths delegate to MemoryStore; raw verified backups stay outside recall under baseDir/renamed-summary-folders. Preserve Campaign scopes, Legacy binding IDs, manual edits, Forget and tombstones. Old archive Sidecars remain byte-for-byte inert: do not scan, read or write them. Skip a rename merge if it would include any Sidecar; normal Legacy-only reads and writes continue. The Legacy forget ledger belongs in the existing index and commits or rolls back with the summary mutation. Directory creation/removal is recorded in the existing version 1 summary mutation journal for rollback.

## Scope and architecture

main.js is the shipped Electron composition root. Keep orchestration and dependency wiring there; make behavior changes in the smallest owning module. The current layout includes:

- actions/: Official VOTC 2.0.3 action registry, lifecycle, prompt/response handling, RunFile dispatch, ACK and effect confirmation. action-system/ is retained as historical directory structure and must not receive new production runtime behavior.
- conversation/, summaries/ and memory-system/: turn lifecycle, finalization, Legacy summary catalog/store and recall, and third-person evidence. Do not restore Memory4/Durable extraction, recovery, recall or UI service injection.
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
- Legacy Summary recall keeps two recent summaries per direct counterpart, plus a separately eligible official summary. Dynamic Extra is 0–3 summaries per responding NPC per turn. Freeze the combined summary-input budget at session start: participant counts 2/3/4+ use context ratios 10%/12.5%/15% with caps 3600/4500/5400 Tokens respectively; use the lower of ratio and cap and retain Provider safety headroom. Preserve protocol 3.0 and storage 2.5 compatibility. Old archive Sidecars are inert and must keep their original bytes; Year/Life migration utilities stay outside Runtime.

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

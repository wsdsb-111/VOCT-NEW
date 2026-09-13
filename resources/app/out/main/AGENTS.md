# Main Process Guidelines

These rules apply to resources/app/out/main/, especially main.js, the service modules, providers and IPC registration.

## Scope and architecture

main.js is the shipped Electron composition root. Keep orchestration and dependency wiring there; make behavior changes in the smallest owning module. The current layout includes:

- actions/: Official VOTC 2.0.3 action registry, lifecycle, prompt/response handling, RunFile dispatch, ACK and effect confirmation. action-system/ is retained as historical directory structure and must not receive new production runtime behavior.
- conversation/, summaries/ and memory-system/: turn lifecycle, finalization, summary catalog/store, Memory Engine recall/consolidation and third-person evidence.
- worldline/, game-data/ and historical-system/: CK3 read-only Save/GameState, Current Runtime Truth, relation/kinship resolution, worldline/canon, historical Definition↔Runtime binding and temporal/freshness gates.
- letters/, providers/, ipc/, analytics/, runtime/, config/, app/, prompts/: their existing transport, provider, boundary and persistence responsibilities.

Do not reformat, rebundle or broadly refactor generated code. Preserve IPC names, persisted settings keys, Action signatures/IDs, analytics field names, prompt block IDs, worldline schemas, queue metadata and existing user-data formats.

## Action, truth and safety contracts

- V8.8.4: preserve game-side command deduplication, player-excluding NPC indices and explicit root binding. Gold/opinion verification consumes bounded command-local BEGIN-to-ACK snapshots, not later conversation balances. A generic ACK is receipt only, never confirmed effect success. Preserve stale-session zero-write quarantine and recovery backups.
- Detect and validate action candidates deterministically before any model request. Distinguish completed narration from questions, commands, plans, hypothetical statements, failed attempts, memories and discussion.
- Preserve the action pipeline: deterministic pre-model gate, constrained candidate set, registered check(), structured model output, local validation and explicit execution result.
- CK3 is authoritative for state. Do not add optimistic local state updates for effects that have not been acknowledged. For gold transfer, a single RunFile's Effect, both sides' runtime gold and ACK must be reconciled; exact match alone becomes CONFIRMED, while mismatch/timeout stays a safe failure state.
- Run Command Queue recovery must fail closed: durable awaiting_ack precedes physical write; a write without ACK is STALLED, not replayable automatically; corrupt state, stale ACK and ambiguous carrier must not dispatch a duplicate effect.
- Worldline facts are read-only CK3 evidence. Current Runtime Truth is shared by in-scene participants, mentioned characters and Family Fact; canonical runtime gender wins and missing/conflicting gender remains neutral. Memory or historical identity must not override current runtime state.
- Historical Definition↔Runtime binding is one-to-one and evidence-gated. Ambiguous, incomplete or stale source must not resolve into Game Truth. Do not revive the retired V8.3 Shadow chain.
- Memory Engine displays 2.6 while preserving the 2.5 storage contract. Treat summary files, folder layout, cache/revision keys and recall limits as compatibility surfaces.

## Prompt and provider rules

Stable Prompt blocks must precede volatile conversation data for provider cache prefixes. Any cache-anchor or block-ID change requires a version update and a note in README.md/the relevant phase record. Keep provider-specific schema and credentials isolated from Chat, Summary, Action and Letter contracts; never log secrets or complete user messages.

## Verification

For each behavior change, add/update the narrowest matching deterministic test and register it in scripts/test-manifest.js. Run:

~~~powershell
node scripts\test-release.js
node scripts\test-action-system.js
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

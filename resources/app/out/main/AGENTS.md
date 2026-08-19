# Main Process Guidelines

These rules apply to `resources/app/out/main/`, especially `main.js`.

## Scope and Editing

`main.js` is the shipped bundled Electron main process. Make targeted patches only; do not reformat, rebundle, or refactor unrelated generated code. Preserve IPC names, persisted settings keys, action IDs, analytics field names, and prompt-block IDs unless the requested change explicitly requires a migration.

## Action and Prompt Changes

Keep action detection deterministic before any model request. Explicitly distinguish completed narration from questions, commands, plans, hypothetical statements, failed attempts, memories, and discussion. When changing action candidates, Preserve the safety invariants of the action pipeline:
deterministic pre-model validation, constrained candidates, registered action checks,structured model output, and local validation.

The legacy gate → semantic shortlist chain may be replaced during the v6.5 refactor
when the new ActionEvent / Execution Parser / Semantic Resolver path is covered by
regression tests and retains compatibility or an explicit legacy fallback.

Place stable prompt content before volatile conversation data to protect provider cache prefixes. Any cache-anchor text change is a compatibility change: update its version and document the reason in `README.md`.

## Verification

For every behavior change, add or update a matching case in `scripts/test-action-system.js`. Run:

```powershell
node scripts\test-action-system.js
node --check resources\app\out\main\main.js
```

For changes to IPC, settings, prompts, or streaming, also launch `VOTC.exe` and test the affected flow manually.

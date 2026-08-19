# Standard Action Script Guidelines

These rules apply to shipped scripts in this directory.

## Action Contract

Each action must export a stable `signature`, localized `title`, `args`, `description`, `check`, and `run`. Keep signatures in lower camel case, for example `becomeLoversWith`; changing one breaks saved settings, action approvals, and analytics. Add `triggerCategories` only for registry-driven scene or state actions.

`check()` must return deterministic availability and valid target IDs. `run()` must validate required target and arguments before writing a CK3 effect. Use `runGameEffect` for game changes and keep the in-memory `gameData` update consistent with that effect.

## Safety and Semantics

Encode only the action the script claims to perform. Do not infer injury, death, consent, pregnancy, relationships, or other state changes as side effects of a scene action. Keep adult checks on intimate or romance-related behavior. Treat CK3 native conditions as authoritative when the game exposes them.

## Testing

When adding or changing a script, extend `scripts/test-action-system.js` with a valid invocation and relevant rejected input. Verify:

```powershell
node scripts\test-action-system.js
```

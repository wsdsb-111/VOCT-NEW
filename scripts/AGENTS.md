# Script and Test Guidelines

These rules apply to files in `scripts/`.

## Test Style

Use Node's built-in `assert` and deterministic test data. Keep cases independent of CK3 installation paths, live API providers, current dates, and `%APPDATA%` contents. Name cases with a short source sentence plus the expected trigger, semantic reason, or action ID.

For an action-gate change, cover four outcomes where applicable: completed narration, question or command, future or hypothetical statement, and failed attempt or retrospective discussion. For a new action script, cover a valid `check()`/`run()` path and at least one rejected boundary.

## Maintenance Scripts

Migration utilities must preserve source data until the replacement output has been validated. Do not silently delete user summaries, character data, logs, or settings. Print concise counts and actionable errors; never print API keys or complete message contents.

## Verification

Run the focused script first, then the action regression suite when action behavior is involved:

```powershell
node scripts\test-action-system.js
node --check resources\app\out\main\main.js
```

Before release, run `node scripts\test-release.js`. The direct release groups and nested action/follow-up checks are declared in `scripts\test-manifest.js`; every `test-*.js` file must be classified there.

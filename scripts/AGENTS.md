# Script and Test Guidelines

These rules apply to files in scripts/.

## Test organization

- Use Node's built-in assert and deterministic fixtures. Do not depend on a CK3 installation path, live Provider/API, current date, %APPDATA% contents, real save, log, summary or secret.
- scripts/test-manifest.js is the single inventory for direct and nested checks. Every test-*.js file must be classified there as a release check or historical archive; update the manifest when adding a test.
- The current candidate is V9.3.6 Player-centered Recall with the `Legacy Summary` label; formal package versions remain governed by package metadata and final reports. Workshop 2.0.5, protocol 3.0 and summary storage 2.5 remain. Memory4/Durable and Year/Life generation/rebuild are retired from production. Focused checks should cover the player-anchored Recent1/Official/Pair baseline, L0/L1/L2 permissions, formatted memory and full-request budgets, source invalidation, search/date filtering, preview/confirm/cancel, per-Pair batch progress/partial outcomes, read-only archives, and actual-name-only person labels. Build, deploy and verify parity before release checks. Do not hardcode an unsettled source mapping or final release-group count; use the V9.3.6 reports for current evidence and retain V9.3.5 and earlier results as history.
- The current production Action baseline is Official VOTC 2.0.3. The old self-developed Action Engine/AE/Action Mode tests remain historical unless the manifest explicitly marks a compatibility check; do not add new production behavior to an obsolete suite merely because its filename is old.
- Put V8.8.4/V8.8.5 incident, queue-vs-ACK timing, argument ambiguity, provisional feedback, missing age, extended kinship, Current Truth, Memory and UI contract cases in the narrowest matching focused script. Cover game-side deduplication and NPC indices excluding the player. Theme changes belong with test-v8.8-ui-style-backgrounds.js; update its assertions when the CSS/background/label contract changes.

For an action or state-transition change, cover the applicable positive, question/command, future or hypothetical, failed-attempt/retrospective, invalid-target and rejected-boundary outcomes. For a new action script, cover valid check()/run() behavior, target/argument binding, and the failure path. Do not treat a deliberately emitted negative-fixture error as a failed suite; judge the final assertion, exit code and release result.

## Maintenance scripts

Migration utilities must preserve source data until replacement output has been validated. Never silently delete user summaries, character data, logs, settings or queue state. Print concise counts and actionable errors; never print API keys or complete message contents. Scripts that inspect worldline data must preserve fail-closed behavior for bad schema, stale checkpoint, incomplete source, ambiguous identity and mismatched campaign/branch.

The historical Year/Life migration utility is quarantined under `scripts/archive/v933-year-life` and is available only through an explicit maintenance import. It is not a Runtime dependency and must not be executed as part of the V9.3.6 candidate. Keep old archive Sidecars inert; maintenance scripts must not scan, read, rewrite or normalize their bytes.

## Verification

Run the narrowest relevant test first, then the release gate:

~~~powershell
node scripts\runtime-dependencies.js
node scripts\build-runtime.js
node scripts\verify-runtime-build.js
node scripts\deploy-runtime-build.js
node scripts\verify-runtime-build.js --deployed
node scripts\test-v8.8-ui-style-backgrounds.js
node scripts\test-v7.10-official-action-system.js
node scripts\test-release.js
node --check resources\app\out\main\main.js
node --check resources\app\out\main\provider-service.js
node --check resources\app\out\main\providers\index.js
node --check resources\app\out\main\ipc\register-ipc.js
node --check resources\app\out\renderer\world-memory-editor.js
node --check resources\app\out\renderer\worldline-player-presentation.js
git diff --check
~~~

The release suite is the authoritative aggregate gate; the current inventory is reported by scripts/test-manifest.js and changes as V9 checks and independent-project extraction evolve. Static/script checks do not prove real CK3, Provider, packaged Electron, remote CI or long-running behavior, so reports must state those boundaries separately.

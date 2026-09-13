# Standard Action Script Guidelines

These rules apply to shipped scripts in this directory.

## Action contract

The current production baseline is the Official VOTC 2.0.3 Action System. Each standard action must export a stable signature, localized title, args, description, check, and run. Keep signatures in lower camel case; changing one can break saved approvals, settings, dispatch records and analytics. Add triggerCategories only when the registry contract requires it.

check() must return deterministic availability and valid target IDs. run() must validate the target and arguments again before dispatching a CK3 effect. Use the existing runGameEffect/RunFile path and command metadata; action scripts must not write directly to votc.txt, bypass the queue or invent a second transport.

## Safety and semantics

- Encode only the effect the action claims to perform. Do not infer injury, death, consent, pregnancy, relationship or other state changes as scene side effects.
- Treat CK3 native conditions and post-effect readback as authoritative. Do not optimistically mutate local current state; for gold and other confirmed effects, update the visible result only after the existing ACK/readback contract succeeds.
- Preserve participant/target binding, self-target and invalid-target guards. Keep adult checks on intimate or romance-related behavior.
- Keep action candidates constrained and deterministic before the model request; structured output and local validation remain required even when a provider supplies an action proposal.
- Never expose API keys, complete prompts/messages or private runtime data in action logs, diagnostics or test output.

## Testing

When adding or changing an action, extend the narrowest current focused test for the behavior (especially V8.8.3 lifecycle, argument binding and gold confirmation), register it in scripts/test-manifest.js, and include valid plus rejected inputs. The legacy test-action-system.js suite may still be useful as a compatibility regression, but its historical self-developed-engine cases are not a reason to reintroduce retired runtime behavior.

Verify:

~~~powershell
node scripts\test-action-system.js
node scripts\test-release.js
~~~

For action, queue, IPC or readback changes, also run the relevant syntax checks and perform a manual VOTC.exe + CK3 test. Static fixtures do not prove a real CK3 effect was executed.

V9.3.9 补充合同：2／3 人时间摘要 5 篇、4+ 人 3 篇，第三人始终全场共享 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承、不扩大来源权限。Character Knowledge 独立于退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。用户本轮只交付代码、自动化验证和 GitHub 上传，不执行真实 CK3／付费 Provider／Soak 或 GitHub Release。

# Standard Action Script Guidelines

These rules apply to editable standard scripts in src/app/default_userdata/actions/standard/ and their generated resources/app/default_userdata/actions/standard/ output. Edit source first, then build/deploy/verify; do not edit only the generated copy.

## Action contract

The current production baseline is the Official VOTC 2.0.3 Action System. Each standard action must export a stable signature, localized title, args, description, check, and run. Keep signatures in lower camel case; changing one can break saved approvals, settings, dispatch records and analytics. Add triggerCategories only when the registry contract requires it.

check() must return deterministic availability and valid target IDs. run() must validate the target and arguments again before dispatching a CK3 effect. Use the existing runGameEffect/RunFile path and command metadata; action scripts must not write directly to votc.txt, bypass the queue or invent a second transport.

V9.3.9 does not let a standard action expand memory authorization. Conversation recall remains player-anchored with complete Recent2, eligible official recollection and the complete legal player ledger; only explicit player historical clauses may add up to 5 temporal summaries for 2/3 participants or 3 for 4+ participants and up to 3 third-person summaries across all targets. The 2/3/4+ budget uses the configured-window 65%/70%/75% ratios and 80,000/84,000/96,000 Token caps, subject to actual Provider headroom and the pre-transport complete-source guard.

## Safety and semantics

- Encode only the effect the action claims to perform. Do not infer injury, death, consent, pregnancy, relationship or other state changes as scene side effects.
- Treat CK3 native conditions and post-effect readback as authoritative. Do not optimistically mutate local current state; for gold and other confirmed effects, update the visible result only after the existing ACK/readback contract succeeds.
- Preserve participant/target binding, self-target and invalid-target guards. Keep adult checks on intimate or romance-related behavior. V9.3.9 retains the V9.3.7 rule that unverified calendar arithmetic is not an authoritative age; unknown or conflicting age must not satisfy an adult gate.
- Keep action candidates constrained and deterministic before the model request; structured output and local validation remain required even when a provider supplies an action proposal.
- Never expose API keys, complete prompts/messages or private runtime data in action logs, diagnostics or test output.

## Testing

When adding or changing an action, extend the narrowest current focused test for the behavior (especially V8.8.3 lifecycle, argument binding and gold confirmation), register it in scripts/test-manifest.js, and include valid plus rejected inputs. The legacy test-action-system.js suite may still be useful as a compatibility regression, but its historical self-developed-engine cases are not a reason to reintroduce retired runtime behavior.

Verify:

~~~powershell
node scripts\test-v7.10-official-action-system.js
node scripts\test-release.js
~~~

For action, queue, IPC or readback changes, also run the relevant syntax checks and perform a manual VOTC.exe + CK3 test. Static fixtures do not prove a real CK3 effect was executed.

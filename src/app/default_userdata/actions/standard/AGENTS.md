V9.3.9.1 当前修复补充（优先于下方 V9.3.9 历史状态）：只管理当前对话的定向人物披露；姓名、头衔、称号等仅按当前对话的合法披露记录，公开发言逐一记录给实际在场听众，私语仅指定人物，候场／缺席不追溯获知。外貌／身体沿用现有白名单，称号公开；当前可靠公开父母子女及亲兄弟姐妹（含公开半亲）可免披露互知特质，继亲及未暴露私生亲属关系不授权。撤下 Worldline 认知服务生产接线，不扫描全体人物；保留原生定向 knownSecrets、手动状态与发送前复核，不恢复 Memory4。V9.3.9 摘要召回／冻结／预算及关系来源合同保持。年龄仅移除稳定资料中过期年龄，真实“年龄 +1”仍 NOT_CONFIRMED。详见 docs/current/v9/V9_3_9_1_IMPLEMENTATION_REPORT.md 与 docs/current/v9/V9_3_9_1_HANDOFF.md。原停止时不连接 GitHub／远端 CI 的要求保留为历史记录；用户本轮已额外授权拉取 GitHub 并修复分支失败 CI，此为授权状态，不代表修复或 CI 已完成。真实 CK3、付费 Provider、Soak 与 GitHub Release 仍未执行。

V9.3.9 摘要补充合同：2／3 人时间摘要上限 5 篇、4+ 人 3 篇，第三人摘要全场共享最多 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承且不扩大来源权限。Character Knowledge 独立于已退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。

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

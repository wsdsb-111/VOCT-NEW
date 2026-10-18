<<<<<<< Updated upstream
=======
V9.3.9.1 当前修复补充（优先于下方 V9.3.9 历史状态）：只管理当前对话的定向人物披露；公开发言逐一记录给实际在场听众，私语仅指定人物，候场／缺席不继承。外貌身体沿现有白名单，称号公开；当前可靠公开父母子女及亲兄弟姐妹（含公开半亲）可免披露互知特质，未暴露私生亲属关系不适用。撤下 Worldline 认知服务生产接线，不扫描全体人物；保留原生定向 knownSecrets、手动状态与发送前复核，不恢复 Memory4。V9.3.9 摘要召回／冻结／预算及关系来源实现保持。年龄只移除稳定资料中过期年龄，原实机 +1 缺证据仍 NOT_CONFIRMED。当前报告为 docs/current/v9/V9_3_9_1_IMPLEMENTATION_REPORT.md。本轮按用户要求不连接 GitHub／远端 CI，不执行真实 CK3／付费 Provider／Soak／Release；下方 GitHub 上传说明只属于历史批次。

V9.3.9 补充合同：2／3 人时间摘要 5 篇、4+ 人 3 篇，第三人始终全场共享 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承、不扩大来源权限。Character Knowledge 独立于退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。用户本轮只交付代码、自动化验证和 GitHub 上传，不执行真实 CK3／付费 Provider／Soak 或 GitHub Release。

>>>>>>> Stashed changes
# Standard Action Script Guidelines

These rules apply to editable standard scripts in src/app/default_userdata/actions/standard/ and their generated resources/app/default_userdata/actions/standard/ output. Edit source first, then build/deploy/verify; do not edit only the generated copy.

## Action contract

The current production baseline is the Official VOTC 2.0.3 Action System. Each standard action must export a stable signature, localized title, args, description, check, and run. Keep signatures in lower camel case; changing one can break saved approvals, settings, dispatch records and analytics. Add triggerCategories only when the registry contract requires it.

check() must return deterministic availability and valid target IDs. run() must validate the target and arguments again before dispatching a CK3 effect. Use the existing runGameEffect/RunFile path and command metadata; action scripts must not write directly to votc.txt, bypass the queue or invent a second transport.

## Safety and semantics

- Encode only the effect the action claims to perform. Do not infer injury, death, consent, pregnancy, relationship or other state changes as scene side effects.
- Treat CK3 native conditions and post-effect readback as authoritative. Do not optimistically mutate local current state; for gold and other confirmed effects, update the visible result only after the existing ACK/readback contract succeeds.
- Preserve participant/target binding, self-target and invalid-target guards. Keep adult checks on intimate or romance-related behavior. Under V9.3.7, unverified calendar arithmetic is not an authoritative age; unknown or conflicting age must not satisfy an adult gate.
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

<<<<<<< Updated upstream
> 当前候选为 V9.3.7，沿用 V9.3.6 玩家中心记忆合同。当前版本及后续收口报告由根 README.md 和 docs/README.md 索引；V9.3.6.3 旧档兼容合同继续有效。otherParent 不扩大 Memory 权限，未验证的日历年龄仅作诊断。CK3／Provider／Soak／远端 CI 分开签署，远端失败不得写成未执行或 PASS。
=======
V9.3.9.1 当前修复补充（优先于下方 V9.3.9 历史状态）：只管理当前对话的定向人物披露；公开发言逐一记录给实际在场听众，私语仅指定人物，候场／缺席不继承。外貌身体沿现有白名单，称号公开；当前可靠公开父母子女及亲兄弟姐妹（含公开半亲）可免披露互知特质，未暴露私生亲属关系不适用。撤下 Worldline 认知服务生产接线，不扫描全体人物；保留原生定向 knownSecrets、手动状态与发送前复核，不恢复 Memory4。V9.3.9 摘要召回／冻结／预算及关系来源实现保持。年龄只移除稳定资料中过期年龄，原实机 +1 缺证据仍 NOT_CONFIRMED。当前报告为 docs/current/v9/V9_3_9_1_IMPLEMENTATION_REPORT.md。本轮按用户要求不连接 GitHub／远端 CI，不执行真实 CK3／付费 Provider／Soak／Release；下方 GitHub 上传说明只属于历史批次。

V9.3.9 补充合同：2／3 人时间摘要 5 篇、4+ 人 3 篇，第三人始终全场共享 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承、不扩大来源权限。Character Knowledge 独立于退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。用户本轮只交付代码、自动化验证和 GitHub 上传，不执行真实 CK3／付费 Provider／Soak 或 GitHub Release。

> 当前候选为 V9.3.9，沿用 V9.3.7 年龄／亲属事实与 V9.3.6.3 旧档兼容合同。玩家固定历史为完整 Recent2、合法官方追忆和完整合法玩家关系事项簿；明确玩家历史分句可并用双人／三人最多 5 篇、4+ 人最多 3 篇时间摘要和跨目标共享最多 3 篇第三人历史。2／3／4+ 人预算为 65%／70%／75% 和 80,000／84,000／96,000 Token 上限，实际受 Provider 当前余量限制。超限时先压缩较旧对话；完整来源仍放不下则 transport 前暂停，并展示所需、可用和分项预算。上下文提示按配置窗口动态、逐对话和逐回应者隔离、逐轮更新，并区分估算与最近请求实际用量。当前版本和报告由 README.md 与 docs/README.md 索引；V9.3.7 `9caffe6` 远端失败保留为历史证据。
>>>>>>> Stashed changes

# Script and Test Guidelines

These rules apply to files in scripts/.

## Test organization

- Use Node's built-in assert and deterministic fixtures. Do not depend on a CK3 installation path, live Provider/API, current date, %APPDATA% contents, real save, log, summary or secret.
- scripts/test-manifest.js is the single inventory for direct and nested checks. Every test-*.js file must be classified there as a release check or historical archive; update the manifest when adding a test.
- The current candidate is V9.3.7 age/kinship with V9.3.6 Player-centered Recall with the `Legacy Summary` label; formal package versions remain governed by package metadata and final reports. Workshop 2.0.5, protocol 3.0 and summary storage 2.5 remain. Memory4/Durable and Year/Life generation/rebuild are retired from production. Focused checks should cover the player-anchored Recent1/Official/Pair baseline, L0/L1/L2 permissions, formatted memory and full-request budgets, source invalidation, search/date filtering, preview/confirm/cancel, per-Pair batch progress/partial outcomes, read-only archives, and actual-name-only person labels. Build, deploy and verify parity before release checks. Do not hardcode an unsettled source mapping or final release-group count; use the V9.3.7 follow-up report for the current run and keep earlier batch evidence separate and retain V9.3.5 and earlier results as history.
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

V9.3.7 checks cover authoritative age, public parent source binding, half/step siblings, UNKNOWN versus absence, death/life conflicts, Campaign/snapshot mismatch, and unchanged Memory permissions. Keep failures visible; do not loosen thresholds, skip historical counterexamples or label an unrun paid Provider/CK3/Soak gate PASS. Record a failed remote CI as FAILED for that SHA until a new exact-SHA run passes.

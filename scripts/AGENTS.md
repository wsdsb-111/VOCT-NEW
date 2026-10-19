V9.3.9.2 当前补充（优先于下方历史合同）：脱敏前从可信当前资料派生两两长幼及双向亲属称谓后再投影，未知／冲突不猜大小；公开直亲互知姓名、官职和特质，私生子（含 legitimized_bastard）与父母、继亲及堂表亲不因该关系获白名单。上下文条保留本场各 NPC 最新请求，以最大单次占用显示场内固定配置窗口的最紧余量，跨轮保留、换场重置。人物认知动态修订不参与无关记忆前缀身份，发送前认知／来源／Forget 复核不变。用户明确要求本轮仅跑修复相关测试，不跑全量发布门禁；旧 CI 不能冒充本版 PASS。实施与验证见 docs/current/v9/V9_3_9_2_IMPLEMENTATION_REPORT.md。

V9.3.9.1 当前修复补充（优先于下方 V9.3.9 历史状态）：只管理当前对话的定向人物披露；姓名、头衔、称号等仅按当前对话的合法披露记录，公开发言逐一记录给实际在场听众，私语仅指定人物，候场／缺席不追溯获知。外貌／身体沿用现有白名单，称号公开；当前可靠公开父母子女及亲兄弟姐妹（含公开半亲）可免披露互知特质，继亲及未暴露私生亲属关系不授权。撤下 Worldline 认知服务生产接线，不扫描全体人物；保留原生定向 knownSecrets、手动状态与发送前复核，不恢复 Memory4。V9.3.9 摘要召回／冻结／预算及关系来源合同保持。年龄仅移除稳定资料中过期年龄，真实“年龄 +1”仍 NOT_CONFIRMED。详见 docs/current/v9/V9_3_9_1_IMPLEMENTATION_REPORT.md 与 docs/current/v9/V9_3_9_1_HANDOFF.md。原停止时不连接 GitHub／远端 CI 的要求保留为历史记录；用户本轮已额外授权拉取 GitHub 并修复分支失败 CI，此为授权状态，不代表修复或 CI 已完成。真实 CK3、付费 Provider、Soak 与 GitHub Release 仍未执行。

V9.3.9 摘要补充合同：2／3 人时间摘要上限 5 篇、4+ 人 3 篇，第三人摘要全场共享最多 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承且不扩大来源权限。Character Knowledge 独立于已退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。

> V9.3.9 摘要与兼容合同（V9.3.9.1 沿用），依据 V9.3.7 年龄／亲属事实与 V9.3.6.3 旧档兼容合同。玩家固定历史为完整 Recent2、合法官方追忆和完整合法玩家关系事项簿；明确玩家历史分句可并用双人／三人最多 5 篇、4+ 人最多 3 篇时间摘要和跨目标共享最多 3 篇第三人历史。2／3／4+ 人预算为 65%／70%／75% 和 80,000／84,000／96,000 Token 上限，实际受 Provider 当前余量限制。超限时先压缩较旧对话；完整来源仍放不下则 transport 前暂停，并展示所需、可用和分项预算。上下文提示按配置窗口动态、逐对话和逐回应者隔离、逐轮更新，并区分估算与最近请求实际用量。当前版本和报告由 README.md 与 docs/README.md 索引；V9.3.7 `9caffe6` 远端失败保留为历史证据。

# Script and Test Guidelines

These rules apply to files in scripts/.

## Test organization

- Use Node's built-in assert and deterministic fixtures. Do not depend on a CK3 installation path, live Provider/API, current date, %APPDATA% contents, real save, log, summary or secret.
- scripts/test-manifest.js is the single inventory for direct and nested checks. Every test-*.js file must be classified there as a release check or historical archive; update the manifest when adding a test.
- The current candidate is V9.3.9 Player-centered Recall and context usage with the `Legacy Summary` label; formal package versions remain governed by package metadata and final reports. Workshop 2.0.5, protocol 3.0 and summary storage 2.5 remain. Memory4/Durable and Year/Life generation/rebuild are retired from production. Focused checks should cover complete Recent2/Official/player-ledger input, L0/L1 permissions, explicit-clause time5 (2/3 participants) or time3 (4+) and global third3 shared across targets, formatted memory and full-request budget, no silent source/ledger omission, compact-then-pause behavior with needed/available/component evidence, current-window budget and Provider headroom, and conversation/responder-scoped context usage including per-turn refresh, new-conversation reset, stale-event rejection, estimates and last-request actual usage. Also retain source invalidation, search/date filtering, preview/confirm/cancel, per-Pair batch progress/partial outcomes, read-only archives and actual-name-only person labels. Build, deploy and verify parity before release checks. Do not hardcode an unsettled source mapping or final release-group count; append V9.3.9 results to its implementation report using actual output, and retain V9.3.7 and earlier evidence as history.
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

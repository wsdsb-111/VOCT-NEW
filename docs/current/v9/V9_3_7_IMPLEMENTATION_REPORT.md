# V9.3.7 实施报告

> 当前记录最终冻结源码候选的实施和阶段验证。完整发布门禁仍在运行；因此本报告不签署 Full Freeze。

状态：最终源码冻结。build/deploy 与 parity 通过，290 项映射，payload SHA `05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da`；Node 22 正式性能对照、Pair benchmark 和最终候选 Electron 双启动 smoke 11 组通过。完整 release regression **442/442 PASS**，清单为 442 release groups／127 archived entries。按用户要求停止后续测试；最终 wrapper 的额外 deployed-parity 阶段没有重跑，构建报告已有 deployed parity PASS。本轮代码未提交、未推送，本地工作区和已部署 058 候选保留。合成生产 Prompt 的 Provider 复核为 **PARTIAL**；真实 CK3、游戏内 Provider、Soak 和远端 CI 尚未验收，不签署 Full Freeze。需求见[施工方案](V9_3_7_IMPLEMENTATION_PLAN.md)，核验边界见[验证报告](V9_3_7_VERIFICATION_REPORT.md)，CK3 步骤见[实机清单](V9_3_7_REAL_GAME_CHECKLIST.md)。

## 范围与事实来源

V9.3.7 在 V9.3.6.3 基线上增加可信年龄与扩展亲属事实：同父异母、同母异父、当前继父母及继兄弟姐妹。原 Owner／Target／Pair、Campaign、Forget、Source Revision 和 Token 预算合同保持；`otherParent` 不进入 Legacy Memory 图或授权，不新增 Memory 读取或模型提取请求。

| 事实 | 实现与边界 |
|---|---|
| 年龄 | 有来源的 CK3 当前年龄优先；未验证 Gregorian 推算、缺失或冲突来源均保持 UNKNOWN。年龄只从新日志字段取得，旧日志不猜测，须由 CK3 重新导出。 |
| 双亲与半兄弟姐妹 | `otherParent` 仅在导出端确认 `this == child.mother` 或 `this == child.father` 时标为 `PUBLIC_LEGAL_PARENT`；其他情况为 `UNKNOWN`。来源绑定后构造 parent→child 与 sibling 事实；秘密、未知、来源缺失或歧义不进入 NPC 家庭事实。 |
| 当前继亲 | 要求来源绑定的当前公开婚姻与完整公开双亲资料。相关父母、raw spouse 或 canonical spouse 明确 DEAD 或生命状态冲突时拒绝 CURRENT；状态缺失时仅接受新鲜、来源绑定的 `CURRENT_MARRIAGE`，不假定存活。Workshop 导出对父母增加 `is_alive=yes` 守卫。 |
| 历史继亲 | 保留带日期、来源明确且已获授权的 Legacy 记录，沿用 Owner／Campaign／Forget 权限。不从前配偶推断过去继亲，不新增 Memory 读取。严格 typed STEP 仅保持读取兼容；CK3 没有可证实的历史婚姻区间 producer，不自动重建。 |
| 未知 | 未知表示没有足够证据，不能回答“没有”，也不能补造父母生死、婚史或当事人不知情的原因。当前游戏资料未确认不等于过去关系不存在。 |

Workshop 导出在 `parents` 相对人物字段加入 `GetAge`、代词和守卫后的公开父母标记；`kids`／`siblings` 加入 `GetAge` 并保留原代词字段。新增当前婚姻和完整公开双亲约束的继亲行。只在 CK3 加载更新脚本并重新导出后这些字段才可用；本轮尚未完成该真实游戏 Gate。

## 验证结果

- 最终源码 build/deploy/parity PASS：290 mappings，payload `05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da`。证据 `.build/v937-final-build.log`、`.build/v937-build-report.json`。
- 当前年龄、公开父母、source binding、secret／unknown、多人口歧义、regenerate 与继亲反例的独立 QA 已通过。旧代码红测保留于 `.build/v937-red-age-baseline.log`、`.build/v937-red-parent-baseline.log`；它们记录生日猜龄和 source-binding metadata 丢失会违反新断言。
- Node 22 正式性能测试每臂 20 次 warm-up、30 次采样，通过。普通家庭事实构建 P95 baseline `0.3732 ms`、candidate `0.3233 ms`；普通 Prompt `2857→2857` tokens；母亲查询家庭块变化 `-79`，step 查询 `-7`。固定回归阈值为 10%；子毫秒结果容易抖动，不外推为普遍提速。证据 `.build/v937-perf-comparison.json`。
- Pair benchmark PASS：22 cells／484 calls、0 gate failures、`completed=true`；复用历史命名的当前源码 harness。计时仅覆盖合成 fixture 的 Pair retrieval。5 个核心 Pair retrieval 源哈希与 retained baseline 一致；证据 `.build/v937-pair-benchmark-raw.json`、`.build/v937-pair-benchmark.log`。
- 最终候选隔离 Electron 双启动 smoke PASS：11 groups，应用版本显示 9.3.7，network attempts 0、Provider calls 0，两个进程正常关闭。证据 `.build/v937-full-ui-visual-smoke-LdVnLy/offline-native/smoke-evidence.json`、`integrated-qa.json`。这不是 CK3 或真实游戏对话验收。
- 正式性能扩展曾出现失败样本，P95 `0.3382→0.4358 ms` 且 step query token delta 不匹配；失败记录 `.build/v937-perf-expanded-first-failure.json` 保留。后续同阈值正式比较通过。
- 完整 release 期间曾发现 `v8.12-temporal-archive` 的生日推算年龄断言与新“未验证年龄保持未知”合同不符；测试期望已修正，年龄专项通过。最终 release 日志 `.build/v937-release-final-candidate.log` 已以 442/442 groups PASS 结束。

## Provider 复核与费用边界

DeepSeek 对合成生产 Prompt 累计调用 26 次，本轮复核已结束且未发送真实用户内容。最终 Prompt hash 对照 `.build/v937-provider-final-parity.json` 为 18 条一致、8 条旧阶段 superseded（通过记录保留，但不声称旧阶段整体 Prompt 与最终构建一致）。18 条一致记录包括原始 8 条、来源链修复后 3 条、最终当前继父母／同母异父 3 条、未知与历史关系 4 条。

最后未知场景的 3 次复核中，两次明确表示不知道，但仍补入无来源的知情背景，literal 判定 PASS；一次回答“不便与外人细说”，未编造身份或断言关系不存在，literal FAIL 保留，人工复核标记 `ABSTAINED_WITHOUT_IDENTITY`。带日期的 Legacy 历史继亲样例通过。修复前的错误继兄弟 lineage 与“没有继母”回答均保留为 `MODEL_ANSWER_MISMATCH`。总体状态 `PARTIAL_UNKNOWN_EXPLICIT_2_OF_3_ONE_ABSTENTION_PRIOR_FAILURES_RETAINED`；不是 26/26 全通过，也不是 CK3 实机 Provider 验收。

基于原生 usage、按较高费率保守估算的累计费用上界为 `$0.09998208`，不是服务商账单。预算上限 `$1`；历史最高风险敞口 `$0.983796`，低于预算。已完成请求未用的预留额已释放，当前费用／风险敞口为 `$0.09998208`；逐次预留之和不能当作实际成本。[DeepSeek 官方价目表](https://api-docs.deepseek.com/quick_start/pricing/)。

## 尚未签署的 Gate

| Gate | 状态 | 说明 |
|---|---|---|
| 完整 release regression | PASS | `.build/v937-release-final-candidate.log`；442/442 groups |
| 真实 CK3／存档 | NOT_RUN | 尚未加载 Workshop 脚本、重导出新字段或用真实存档核对年龄／亲属语义 |
| 游戏内真实 Provider | NOT_RUN | 26 次是合成生产 Prompt，不等同于 CK3 场景对话 |
| Soak／远端 CI | NOT_RUN | 分别执行并单独签署 |

不新增 Memory 读取、不推导历史婚姻、不把 UNKNOWN 写成否定关系。完整 release regression 已 PASS；用户要求停止后续测试，因此额外 wrapper parity 阶段未重跑，build/deploy parity 已通过。本轮代码未提交、未推送，本地工作区及已部署 058 候选保留。CK3、游戏内 Provider、Soak 与远端 CI 仍未签署，不宣称 Full Freeze。

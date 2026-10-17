# V9.3.7 验证报告

> 最终源码候选的 build/deploy、专项验证、Pair benchmark、性能对照、隔离 Electron smoke 与完整 release regression 已有结果。本报告不签署 Full Freeze。

状态：build/deploy/parity **PASS**（290 mappings，payload `05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da`）；Node 22 正式性能、22-cell Pair benchmark、11-group Electron smoke 与完整 release regression **PASS**（442/442，442 release groups／127 archived entries）。用户要求停止后续测试；最终 wrapper 的额外 deployed-parity 阶段未重跑，构建报告已有 deployed parity PASS。合成生产 Prompt Provider 复核为 **PARTIAL**；真实 CK3／游戏内 Provider、Soak、远端 CI 尚未执行。详见[实施报告](V9_3_7_IMPLEMENTATION_REPORT.md)与[实机清单](V9_3_7_REAL_GAME_CHECKLIST.md)。

## 基线

- 起始 HEAD：`2d1ecd920c57af575504d61c826289d100da89a1`；起始 payload：`8a706fd7ab2cfb507c0f8ae52c437758c3fb42c98d950febcf56862b57e82a10`。
- 最终源码冻结后构建与部署一致：290 mappings，payload `05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da`。证据 `.build/v937-final-build.log`、`.build/v937-build-report.json`。
- 完整 release 证据 `.build/v937-release-final-candidate.log` 最终为 **PASS (442 groups)**；清单为 442 release groups、127 archived entries。旧 release 尝试和被修正测试的记录保留，不与最终 run 混算。

## 验证矩阵

| Gate | 通过标准 | 状态 | 证据／限制 |
|---|---|---|---|
| 年龄来源与未知 | 有可信 CK3 当前年龄时优先使用；只有未验证日期推算、来源缺失或冲突时保持 UNKNOWN | PASS（专项） | 年龄专项通过；CK3 实际加载与重新导出仍 NOT_RUN。旧实现会从生日猜出 16 岁，红测 `.build/v937-red-age-baseline.log` 保留 |
| 双亲、otherParent 与图边界 | `PUBLIC_LEGAL_PARENT` 有来源绑定；UNKNOWN／秘密关系不进入 NPC 视图或 Memory 授权 | PASS（专项） | 生产 LogParser→GameData→Graph→Prompt、来源绑定与独立 QA 通过；旧 parser 丢 source metadata 的红测 `.build/v937-red-parent-baseline.log` 保留 |
| 同父异母／同母异父 | 依据已确认父母交集区分关系；歧义、未知和缺来源 fail-closed | PASS（独立 QA） | 当前最终源码独立 QA 通过；实机 CK3 关系覆盖仍 NOT_RUN |
| 当前继亲与生命状态 | 当前婚姻及公开双亲资料来源完整；明确 DEAD／生命冲突拒绝 CURRENT；生命状态缺失需新鲜 source-bound `CURRENT_MARRIAGE` | PASS（独立 QA） | DEAD 父亲仍有旧 spouse row 的反例及最新未知边界 QA 通过；真实 CK3 exporter 语义仍 NOT_RUN |
| 未知事实表达 | 未知不可回答“没有”，也不可补造父母生死、婚史或人物不知情原因 | PASS（Runtime QA）；Provider PARTIAL | 独立 QA 通过；最终 3 例中 2 例明确不知道但附加无来源知情背景，1 例回避作答且无身份／存在性编造。literal FAIL 保留，详见 Provider 部分 |
| 历史继亲与 Memory 权限 | 保留有日期、明确来源、已授权的 Legacy；不从前配偶推断，不新增 Memory 读取 | PASS（合同／QA）；CK3 历史来源 NOT_RUN | 严格 typed STEP 只保留读取兼容；无可证实的 CK3 历史婚姻区间 producer，不自动重建 |
| 普通 Prompt 与性能 | 每臂 20 warm-up／30 samples；P95 回归不超过 10%，Prompt 与事实块变化核对 | PASS | P95 baseline `0.3732 ms`、candidate `0.3233 ms`；普通 Prompt `2857→2857`；母亲 query delta `-79`、step query `-7`。不外推为普遍提速；`.build/v937-perf-comparison.json` |
| Pair 检索 benchmark | 当前核心 Pair retrieval benchmark 完成且无 gate failure | PASS | 22 cells／484 calls，0 failures，`completed=true`；复用历史命名的现行 harness；5 个核心检索文件 hash 与 retained baseline 一致。`.build/v937-pair-benchmark-raw.json`、`.build/v937-pair-benchmark.log` |
| 最终 build/deploy/parity | 最终源码映射及部署资源一致 | PASS | 290 mappings，payload `05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da`；`.build/v937-final-build.log`、`.build/v937-build-report.json` |
| 完整 release regression | 最新冻结源码完整发布门禁通过且记录实际数量 | PASS | `.build/v937-release-final-candidate.log`；442/442 groups，manifest 442 release groups／127 archived entries |
| 隔离 Electron native smoke | 最终候选双启动、UI/IPC smoke 无意外网络或 Provider 调用并正常关闭 | PASS | 11 groups；网络／Provider calls 0，进程已关闭；`.build/v937-full-ui-visual-smoke-LdVnLy/offline-native/smoke-evidence.json`、`integrated-qa.json` |
| 合成 DeepSeek Provider 复核 | 最终 Prompt hash 对照、回答语义与未知边界分开记录 | PARTIAL | 26 calls；18 个 Prompt hash 与最终 payload 一致、8 个旧阶段 superseded。未知修后 3 例有 2 个明确不知道但补叙背景、1 个回避回答；literal FAIL 和两例旧 `MODEL_ANSWER_MISMATCH` 保留。状态 `PARTIAL_UNKNOWN_EXPLICIT_2_OF_3_ONE_ABSTENTION_PRIOR_FAILURES_RETAINED`；`.build/v937-provider-final-parity.json` |
| CK3 实际加载与存档 | 新日志字段可由真实 CK3 导出，事实与可见关系覆盖正确 | NOT_RUN | 旧日志缺字段继续 UNKNOWN；须加载 Workshop 脚本并重新导出 |
| 游戏内 Provider、Soak、远端 CI | 各自按独立 Gate 验收 | NOT_RUN | 合成生产 Prompt 调用不等同于真实 CK3 对话 |

## 外部脚本限制

Workshop 导出字段中，`parents` 的索引 5／6／7 分别为 `GetAge`、代词与受 `this == child.mother/father` 守卫的公开合法父母标记；`kids`／`siblings` 新增 `GetAge` 并保留原有代词。当前继亲行受 `is_alive=yes` 和完整公开双亲资料限制。新字段只有在 CK3 重新加载脚本并重新导出后出现；旧日志继续 UNKNOWN。Workshop 没有可证实的历史婚姻期间来源，不能自动重建过去继亲事实。

## 保留的失败与修正证据

- 首轮扩展性能失败仍保留在 `.build/v937-perf-expanded-first-failure.json`；后续固定 10% 阈值的正式对照通过。
- 完整 release 曾暴露 `v8.12-temporal-archive` 生日-only 年龄 45 断言与“未验证年龄应未知”规则不兼容；测试期望已修正，年龄专项通过，最终 release 随后 442/442 groups PASS。
- Provider 修正前的错 lineage 与“没有继母”回答仍记 `MODEL_ANSWER_MISMATCH`；最终未知样例 literal FAIL 也保留，不以修后 abstain 覆盖历史错误。

完整 release regression 已 442/442 PASS。用户要求停止后续测试，因此未重跑最终 wrapper 的额外 deployed-parity 阶段；最终 build report 内 deployed parity 已 PASS。CK3、游戏内 Provider、Soak 与远端 CI 均未签署，当前不是 Full Freeze。

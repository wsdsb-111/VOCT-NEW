# VOTC 文档索引

本目录集中保存 VOTC 的架构说明、版本设计、实施报告和阶段记录。根目录的 [README.md](../README.md) 只负责项目简介、安装运行和当前基线；根目录的 [CHANGELOG.md](../CHANGELOG.md) 负责版本顺序，详细内容按下面的分类维护。

## 推荐阅读顺序

1. [项目 README](../README.md)：运行环境、配置方式和当前版本基线。
2. [CHANGELOG.md](../CHANGELOG.md)：按版本查看变更入口和对应的详细文档。
3. [V8阶段开发记录.md](V8阶段开发记录.md)：V8 Dynamic Historical Worldline System 的连续开发、冻结边界与验收记录。
4. [v8.4 GameState 能力勘探报告](v8.4-gamestate-capability-report.md)：CK3 Save 容器、Gamestate、人物/头衔/战争字段和停止边界。
5. [v8.4 性能基准](v8.4-gamestate-performance-benchmark.md)：指定 `autosave_1.ck3` 的读取、扫描、Query、索引和内存检查点。
6. [v8.4 Historical Definition ID 报告](v8.4-historical-definition-id-report.md)：历史源定义键、Runtime ID、`character_lookup` 与当前不确定性。
7. [v8.4 Mod 历史人物源报告](v8.4-modded-historical-character-source-report.md)：当前 active playset、岳飞/辛弃疾源文件和同名候选。
8. [v8.4 Historical ID UI/Debug 报告](v8.4-historical-id-ui-source-report.md)：CK3 `GetHistoryId`、debug.log 与 VOTC probe 边界。
9. [v8.4 Luna 实机 Date/History ID 验证](v8.4-live-date-historyid-validation.md)：CK3 运行时日期、岳飞 Historical ID 和普通角色空值对照。
10. [v8.4 Luna + Terra S0/S1 差分报告](v8.4-s0-s1-checkpoint-diff-report.md)：人物、Title、War、死亡、出生和历史人物 checkpoint 差分。
11. [v8.4 Luna + Terra 年度 Delta 对账矩阵](v8.4-annual-delta-reconciliation-matrix.md)：已确认项、部分可重建项与 Supplemental 边界。
12. [v8.4 Terra Definition Override 验证](v8.4-definition-override-validation.md)：当前 active playset 的重复源、Gamestate 证据和保守覆盖结论。
13. [v8.4 Sol 最终冻结审查](v8.4-final-freeze-readiness-review.md)：Test 1–6 最终 Gate、P0 阻断项和可冻结架构结论。
14. [v8.4 Terra 世界线运行时实施](v8.4-terra-worldline-runtime-implementation-report.md)：Save Reader、Worker、Checkpoint、Delta、IPC 和默认关闭的世界知识 Prompt 基础。
15. [v8.4 Luna 世界线前端实施](v8.4-luna-worldline-frontend-implementation-report.md)：世界线页面、检查点展示、Supplemental 编辑器和 Terra IPC 接入。
16. [v8.4.1 Luna UI 实施报告](v8.4.1-luna-ui-implementation-report.md)：Localization 证据展示、语义化世界概览、长字段和复制入口。
17. [v8.4.1 Terra Query/Freshness 实施报告](v8.4.1-terra-query-freshness-implementation-report.md)：中文实体分析、Localization 反查、as-of 与 STALE Prompt Gate。
18. [v8.4.1 Luna Prompt Diagnostics 实施报告](v8.4.1-luna-prompt-diagnostics-implementation-report.md)：只读 Query / World Recall 诊断、Token 分块、Cache Hit 与裁剪项。
19. [v8.4.1 Sol-3 Prompt Source Boundary Review](v8.4.1-sol-3-prompt-source-boundary-review.md)：中文 Live 日期兼容、Checkpoint as-of 与 Prompt 来源优先级审查。
20. [README_摘要系统.md](README_摘要系统.md)：Memory Engine 2.5 的存储、冻结召回、Turn Recall、写入和生命周期规则。
21. [V7阶段优化记录.md](V7阶段优化记录.md)：V7/V7.x 的连续开发记录。
22. [V6阶段优化记录.md](V6阶段优化记录.md)：V6/V6.x 的动作系统与基础设施记录。
23. 需要核对具体方案时，再阅读版本设计文档和实施报告。

## 文档分类

### 架构与运行规则

- [V8阶段开发记录.md](V8阶段开发记录.md)：V8.0 起的 Historical Baseline、Temporal Gate 与后续世界线阶段记录。
- [v8.4-gamestate-capability-report.md](v8.4-gamestate-capability-report.md)：V8.4 CK3 Save/GameState 前置勘探总览；仅报告能力，不代表正式 V8.4 已实现。
- [v8.4-ck3-save-container-report.md](v8.4-ck3-save-container-report.md)：`SAV0100` 容器、metadata、Gamestate 提取和存档轮换观察。
- [v8.4-gamestate-schema-notes.md](v8.4-gamestate-schema-notes.md)：顶层 section、Character、Title、War 和历史人物解析字段笔记。
- [v8.4-gamestate-adapter-index-proposal.md](v8.4-gamestate-adapter-index-proposal.md)：后续 adapter、worker、normalized snapshot 和 bounded index 提案。
- [v8.4-live-probe-delta-hook-feasibility.md](v8.4-live-probe-delta-hook-feasibility.md)：Workshop debug probe、live date 和 delta hook 可行性。
- [v8.4-historical-definition-id-report.md](v8.4-historical-definition-id-report.md)：Definition ID、Historical ID 与 Runtime ID 的证据和稳定性边界。
- [v8.4-definition-runtime-mapping-report.md](v8.4-definition-runtime-mapping-report.md)：`character_lookup` 精确映射、控制组和全 Gamestate 数字反向搜索。
- [v8.4-modded-historical-character-source-report.md](v8.4-modded-historical-character-source-report.md)：当前启用 Mod 的历史人物源和同名冲突。
- [v8.4-historical-id-ui-source-report.md](v8.4-historical-id-ui-source-report.md)：CK3 UI/Debug getter、日志和 VOTC 临时 probe 可行性。
- [v8.4-historical-definition-catalog-proposal.md](v8.4-historical-definition-catalog-proposal.md)：只读 Definition Catalog 原型与正式 adapter 前置 Gate。
- [v8.4-live-date-historyid-validation.md](v8.4-live-date-historyid-validation.md)：Luna 实机 Live Date、Historical ID 和闭环证据。
- [v8.4-s0-s1-checkpoint-diff-report.md](v8.4-s0-s1-checkpoint-diff-report.md)：Luna + Terra S0/S1 人物、Title 与 War checkpoint 差分。
- [v8.4-annual-delta-reconciliation-matrix.md](v8.4-annual-delta-reconciliation-matrix.md)：Luna + Terra 年度 Delta 对账矩阵。
- [v8.4-definition-override-validation.md](v8.4-definition-override-validation.md)：Terra 重复 Definition ID、active playset 与覆盖结论。
- [v8.4-final-freeze-readiness-review.md](v8.4-final-freeze-readiness-review.md)：Sol 对 Test 1–6 的最终 Gate、冻结边界与补证路径。
- [v8.4-luna-worldline-frontend-implementation-report.md](v8.4-luna-worldline-frontend-implementation-report.md)：V8.4 Luna 世界线前端、Supplemental 编辑器和 Terra IPC 边界。
- [v8.4-terra-worldline-runtime-implementation-report.md](v8.4-terra-worldline-runtime-implementation-report.md)：V8.4 Terra Save Reader、Worker、Checkpoint、Delta、IPC 与 Prompt 基础的已实现行为和 Gate。
- [v8.4-sol-implementation-freeze-review.md](v8.4-sol-implementation-freeze-review.md)：V8.4 Sol P0/P1 审计、真实 autosave Service Gate、前端自动发现/状态事件管线及 Full Freeze 未放行项。
- [v8.4.1-terra-phase-a-implementation-report.md](v8.4.1-terra-phase-a-implementation-report.md)：V8.4.1 Terra Phase A 的 source revision race 防护、Political Context Resolver 与 Sol-1 交接边界。
- [v8.4.1-sol-1-p0-correctness-review.md](v8.4.1-sol-1-p0-correctness-review.md)：V8.4.1 Sol-1 对 source race、政治证据链、UNKNOWN 与 identity 边界的独立 P0 Gate。
- [v8.4.1-terra-localization-implementation-report.md](v8.4.1-terra-localization-implementation-report.md)：V8.4.1 Terra-3 的 CK3/启用 Mod 本地化 Resolver、来源冲突保留与 identity/display 合同。
- [v8.4.1-luna-ui-implementation-report.md](v8.4.1-luna-ui-implementation-report.md)：V8.4.1 Luna-1/2/3 的本地化证据展示、语义化世界概览、长字段和复制入口。
- [v8.4.1-terra-query-freshness-implementation-report.md](v8.4.1-terra-query-freshness-implementation-report.md)：V8.4.1 Terra-4/5 的中文实体分析、Localization 反查、Checkpoint as-of 和 STALE Prompt Gate。
- [v8.4.1-luna-prompt-diagnostics-implementation-report.md](v8.4.1-luna-prompt-diagnostics-implementation-report.md)：V8.4.1 Luna-6 的只读 Prompt / World Recall 诊断、Token 分块、Cache Hit 与裁剪项。
- [v8.4.1-sol-3-prompt-source-boundary-review.md](v8.4.1-sol-3-prompt-source-boundary-review.md)：V8.4.1 Sol-3 的中文 Live 日期兼容、Checkpoint as-of、来源优先级与 fail-closed Prompt Gate。
- [VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md](VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md)：V8.1 存档身份协议、session 降级、Worldline schema、原子持久化和 Shadow 集成合同。
- [v8.1-campaign-identity-worldline-store-implementation-report.md](v8.1-campaign-identity-worldline-store-implementation-report.md)：V8.0 P0/P1 审计、V8.1 应用与 Workshop 实施、自动化验证和实机边界。
- [v8.3.1-historical-figure-dashboard-implementation-report.md](v8.3.1-historical-figure-dashboard-implementation-report.md)：V8.3.1 实机诊断 Snapshot、Overlay Dashboard、append-only Ground Truth 与冻结边界。
- [v8.3-historical-figure-resolver-implementation-report.md](v8.3-historical-figure-resolver-implementation-report.md)：V8.3 人物匹配数据、Canonical 输入、精确名称门禁、身份评分、Shadow 集成与人工 Gate 边界。
- [v8.3-prerequisite-fixes-implementation-report.md](v8.3-prerequisite-fixes-implementation-report.md)：V8.3 前置 EOL、GameData 状态归属和 Shadow metadata 加固，以及仍需 CK3 实机完成的 Gate。
- [v8.0-historical-baseline-2.0-implementation-report.md](v8.0-historical-baseline-2.0-implementation-report.md)：V8.0 结构化历史基线、兼容适配、shadow Temporal Gate、Prompt/cache 等价和发布验证边界。
- [VOTC_v7.8_main.js第一轮模块化拆分实施记录.md](VOTC_v7.8_main.js第一轮模块化拆分实施记录.md)：Pre-V8 组合根、游戏数据、Prompt、摘要、信件和运行服务拆分边界及验证结果。
- [VOTC_v7.7_main.js架构拆分与迁移清单.md](VOTC_v7.7_main.js架构拆分与迁移清单.md)：V7.7 Provider Service、Provider 与 IPC 分阶段拆分范围、依赖边界和验证清单。
- [README_摘要系统.md](README_摘要系统.md)：Memory Engine 2.5 和人物目录视角摘要系统。
- [V7阶段优化记录.md](V7阶段优化记录.md)：V7.0 至当前 V7.x 的功能、修复和验收边界。
- [V6阶段优化记录.md](V6阶段优化记录.md)：V6.2 至 V6.9.1 的动作系统、缓存和架构记录。

### 版本设计与实施报告

- [v8.4-gamestate-performance-benchmark.md](v8.4-gamestate-performance-benchmark.md)：指定存档的只读性能勘探基准；不是发布 SLA。
- [v8.4-gamestate-capability-report.md](v8.4-gamestate-capability-report.md)
- [v8.4-ck3-save-container-report.md](v8.4-ck3-save-container-report.md)
- [v8.4-gamestate-schema-notes.md](v8.4-gamestate-schema-notes.md)
- [v8.4-gamestate-adapter-index-proposal.md](v8.4-gamestate-adapter-index-proposal.md)
- [v8.4-live-probe-delta-hook-feasibility.md](v8.4-live-probe-delta-hook-feasibility.md)
- [v8.4-historical-definition-id-report.md](v8.4-historical-definition-id-report.md)
- [v8.4-definition-runtime-mapping-report.md](v8.4-definition-runtime-mapping-report.md)
- [v8.4-modded-historical-character-source-report.md](v8.4-modded-historical-character-source-report.md)
- [v8.4-historical-id-ui-source-report.md](v8.4-historical-id-ui-source-report.md)
- [v8.4-historical-definition-catalog-proposal.md](v8.4-historical-definition-catalog-proposal.md)
- [v8.4-live-date-historyid-validation.md](v8.4-live-date-historyid-validation.md)
- [v8.4-s0-s1-checkpoint-diff-report.md](v8.4-s0-s1-checkpoint-diff-report.md)
- [v8.4-annual-delta-reconciliation-matrix.md](v8.4-annual-delta-reconciliation-matrix.md)
- [v8.4-definition-override-validation.md](v8.4-definition-override-validation.md)
- [v8.4-final-freeze-readiness-review.md](v8.4-final-freeze-readiness-review.md)
- [v8.4-luna-worldline-frontend-implementation-report.md](v8.4-luna-worldline-frontend-implementation-report.md)
- [v8.4-terra-worldline-runtime-implementation-report.md](v8.4-terra-worldline-runtime-implementation-report.md)
- [v8.4-sol-implementation-freeze-review.md](v8.4-sol-implementation-freeze-review.md)
- [v8.4.1-terra-phase-a-implementation-report.md](v8.4.1-terra-phase-a-implementation-report.md)
- [v8.4.1-sol-1-p0-correctness-review.md](v8.4.1-sol-1-p0-correctness-review.md)
- [v8.4.1-terra-localization-implementation-report.md](v8.4.1-terra-localization-implementation-report.md)
- [VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md](VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md)
- [v8.1-campaign-identity-worldline-store-implementation-report.md](v8.1-campaign-identity-worldline-store-implementation-report.md)
- [v8.3.1-historical-figure-dashboard-implementation-report.md](v8.3.1-historical-figure-dashboard-implementation-report.md)
- [v8.3-historical-figure-resolver-implementation-report.md](v8.3-historical-figure-resolver-implementation-report.md)
- [v8.3-prerequisite-fixes-implementation-report.md](v8.3-prerequisite-fixes-implementation-report.md)
- [v8.0-historical-baseline-2.0-implementation-report.md](v8.0-historical-baseline-2.0-implementation-report.md)：V8.0 Historical Baseline 2.0 实施、测试与实机 smoke 边界。
- [v7.10-official-action-letter-recovery-implementation-report.md](v7.10-official-action-letter-recovery-implementation-report.md)：V7.10-RC1 至 RC6 Final Rev.3 Candidate 官方 Action 迁移、启动 ACK Reconciliation、崩溃安全 dispatch、BLOCKED/STALLED 恢复、只读 debug.log、路径/Tail 事务、Date Producer Recovery、Canonical Relative Profile、统一 Kinship Resolver、Artifact Diagnostic 3.0 与验证边界。
- [upstream/votc-2.0.3-action-manifest.md](upstream/votc-2.0.3-action-manifest.md)：官方 Action Kernel Blob SHA、适配路径和语义边界。
- [upstream/votc-2.0.3-letter-manifest.md](upstream/votc-2.0.3-letter-manifest.md)：官方 Letter Kernel Blob SHA、Delivery Effect 与可靠性外层边界。
- [Third-Party Notices](../THIRD_PARTY_NOTICES.md)：上游出处、GPL-3.0-only 声明与 VOCT-NEW 适配范围。
- [v7.9.3-action-engine-4.0-implementation-report.md](v7.9.3-action-engine-4.0-implementation-report.md)
- [VOTC_v7.9.3_Action_Engine_4.0正式实施规格书.md](VOTC_v7.9.3_Action_Engine_4.0正式实施规格书.md)
- [VOCT-NEW_v7.9.3_AE4_最终实机前修复清单_含Injury裁定.md](VOCT-NEW_v7.9.3_AE4_最终实机前修复清单_含Injury裁定.md)：Phase 7 前最终裁定与 Hard Gate。
- [VOCT-NEW_V7.9.3_AE4_实机前修复清单.md](VOCT-NEW_V7.9.3_AE4_实机前修复清单.md)：已由最终清单修正 Injury 方向的历史文件。
- [AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md](AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md)
- [v7.9.2-final-stable-implementation-report.md](v7.9.2-final-stable-implementation-report.md)
- [VOTC_v7.9.2_Social_Consequence_Engine_设计规格.md](VOTC_v7.9.2_Social_Consequence_Engine_设计规格.md)
- [VOTC_v7.9.1_生产稳定性修复实施记录.md](VOTC_v7.9.1_生产稳定性修复实施记录.md)
- [VOTC_v7.9_Action_Engine_3.0实施记录.md](VOTC_v7.9_Action_Engine_3.0实施记录.md)
- [VOTC_v7.8.2_V7最终收尾修复实施记录.md](VOTC_v7.8.2_V7最终收尾修复实施记录.md)
- [VOTC_v7.8.3_Memory_Engine_2.5实施记录.md](VOTC_v7.8.3_Memory_Engine_2.5实施记录.md)
- [VOTC_v7.8.1_暂时离场与Prompt修复实施记录.md](VOTC_v7.8.1_暂时离场与Prompt修复实施记录.md)
- [VOTC_v7.8_main.js第一轮模块化拆分实施记录.md](VOTC_v7.8_main.js第一轮模块化拆分实施记录.md)
- [VOTC_v7.7.4_稳定性与基础设施实施记录.md](VOTC_v7.7.4_稳定性与基础设施实施记录.md)
- [VOTC_v7.7.3_Memory_Engine_2.4实施记录.md](VOTC_v7.7.3_Memory_Engine_2.4实施记录.md)
- [VOTC_v7.7.2_候场加入与主动离场实施记录.md](VOTC_v7.7.2_候场加入与主动离场实施记录.md)
- [VOTC_v7.7.1_Memory_Engine_2.3实施记录.md](VOTC_v7.7.1_Memory_Engine_2.3实施记录.md)
- [VOTC_v7.7_main.js架构拆分与迁移清单.md](VOTC_v7.7_main.js架构拆分与迁移清单.md)
- [VOTC_v7.2_人物目录定向召回与P0收口设计方案.md](VOTC_v7.2_人物目录定向召回与P0收口设计方案.md)
- [VOTC_v7.3_动态称谓身份与死亡记忆生命周期.md](VOTC_v7.3_动态称谓身份与死亡记忆生命周期.md)
- [v6.6.1-implementation-report.md](v6.6.1-implementation-report.md)

### 历史更新与 UI 资源

- [v6.1_中文化更新说明.md](v6.1_中文化更新说明.md)：早期中文化更新记录，作为历史资料保留。
- [UI_ASSET_PROMPTS_2.0.3.md](UI_ASSET_PROMPTS_2.0.3.md)：外挂 UI 主题和素材提示词。

## 维护规则

- 新版本先在根目录 [CHANGELOG.md](../CHANGELOG.md) 增加一行入口，再把详细内容写入对应的阶段记录或设计/实施文档。
- 已发布版本的设计文档保留原文；发现实现与方案不一致时，在对应实施报告或阶段记录中追加修订说明，不覆盖历史结论。
- 文档只描述仓库中的真实文件和已验证行为，不为缺失的源码、模板或构建流程创建占位链接。
- 文档文件名使用 `VOTC_vX.Y_主题.md`、`vX.Y-implementation-report.md` 或已有阶段记录名称，避免继续在根目录新增版本散文档。

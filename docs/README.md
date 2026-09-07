# VOTC 文档索引

本目录集中保存 VOTC 的架构说明、版本设计、实施报告和阶段记录。根目录的 [README.md](../README.md) 只负责项目简介、安装运行和当前基线；根目录的 [CHANGELOG.md](../CHANGELOG.md) 负责版本顺序，详细内容按下面的分类维护。

## 推荐阅读顺序

V8.6.2 当前版本入口：[Sol 实施与最终审查](v8.6.2-sol-implementation-and-final-review.md)。Subjective World 输出、第三人 Grounding、Kinship、Death/Temporal 与缓存/Token 边界已完成，38 个专项和 187 组发布门禁通过；真实 CK3、Provider、Production A/B 与 Electron UI Gate 未执行，`V8.6.2 FREEZE = PENDING MANUAL GATES`。

当前事故入口：[V8.5.1 摘要 P0 / 多人入场 P2 修复报告](v8.5.1-summary-incident-review.md)：摘要链路审计、长会话恢复、参与者隔离与入场延迟。

V8.5.2 当前施工入口：[Sol Stage 5 UI / DTO 边界审查](v8.5.2-sol-ui-boundary-review.md)；新旧 DTO 聚合矛盾、来源优先级和 Renderer 降级 raw 泄漏已修复，逐实体 UI 与 50 条边界保持通过，完整发布回归为 120/120。下一步 Astra Stage 6 最终集成与实机 Gate；`INTERNAL FREEZE = NOT READY`。

V8.5.1 历史基线：[Sol 最终审查与修复](v8.5.1-sol-final-review.md)，保留当时 109 组自动回归、15 人真实存档定义召回及未验收边界。

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
20. [v8.4.1 Hotfix Luna 实施报告](v8.4.1-hotfix-luna-implementation-report.md)：Token Breakdown 专用渲染、总和校验和 Resolver 诊断区域。
21. [v8.4.1 Hotfix Terra 实施报告](v8.4.1-hotfix-terra-implementation-report.md)：中文 Localization 回退、扫描状态、Historical Alias→Runtime 闭环与真实 Checkpoint Gate。
22. [v8.4.1 Hotfix Sol 最终审查](v8.4.1-hotfix-sol-final-review.md)：真实六查询矩阵、Alias/Source/UI 边界和最终自动化 Gate。
23. [v8.4.2 Luna UI 前置层实施报告](v8.4.2-luna-ui-implementation-report.md)：身份候选与 Game Truth 隔离、历史定义绑定语义、年度 Delta actor/来源展示和 Checkpoint-only 新鲜度。
24. [V8.4.2 Run Command 生命周期热修实施报告](v8.4.2-run-command-lifecycle-hotfix-implementation-report.md)：Conversation Close 世代/TTL、Run Command Queue v3、启动恢复、carrier 隔离和 ACK 超时安全边界。
25. [V8.5 Luna 玩家语义展示层实施报告](v8.5-luna-player-semantic-ui-implementation-report.md)：默认玩家视图、语义映射和高级诊断。
26. [V8.5 Terra Retrieval 2.0 实施报告](v8.5-terra-retrieval-implementation-report.md)：确定性 Query Planner、Retriever/Ranker、DTO、缓存 revision 与 Prompt token 预算。
27. [V8.5.1 Terra Historical Definition Index 实施报告](v8.5.1-historical-definition-index-terra-implementation-report.md)：后台通用姓名索引、身份门禁、coverage 与 100 条确定性矩阵。
28. [V8.5.1 Luna 历史人物诊断可读性实施报告](v8.5.1-luna-historical-diagnostic-ui-implementation-report.md)：玩家摘要、可读判定依据、来源完整性/索引未命中状态和开发者追踪分层。
29. [V8.5.2 Terra Runtime Identity 实施报告](v8.5.2-terra-runtime-identity-implementation-report.md)：Runtime-native、世界线差异、复姓/长姓名来源和 Mapping 安全显示。
30. [V8.5.2 Sol 后端正确性独立审查](v8.5.2-sol-correctness-review.md)：False Resolution 矩阵、DTO/IPC 边界、截断与 coverage 安全修复。
31. [V8.5.2 Luna 玩家语义与世界线差异 UI](v8.5.2-luna-ui-implementation-report.md)：逐实体身份、差异面板、Mapping 玩家层和多分辨率/主题视觉回归边界。
32. [V8.5.2 Sol UI / DTO 边界独立审查](v8.5.2-sol-ui-boundary-review.md)：additive/legacy 摘要一致性、SOURCE_INCOMPLETE 优先级、A/B/C 层泄漏和有界渲染复核。
33. [README_摘要系统.md](README_摘要系统.md)：Memory Engine 2.6 可见标签、2.5 存储合同、冻结召回、Turn Recall、第三人证据与生命周期规则。
34. [V7阶段优化记录.md](V7阶段优化记录.md)：V7/V7.x 的连续阶段记录。
35. [V6阶段优化记录.md](V6阶段优化记录.md)：V6.2 至当前 V6.x 的动作系统和基础设施记录。
36. 需要核对具体方案时，再阅读版本设计文档和实施报告。

## 文档分类

最新阶段：[V8.6.2 Sol 实施与最终审查](v8.6.2-sol-implementation-and-final-review.md)；代码施工与 187 组发布门禁通过，CK3、Provider、Production A/B 和 Electron UI 人工 Gate 尚未执行，当前冻结状态为 `PENDING MANUAL GATES`。

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
- [v8.4.1-hotfix-luna-implementation-report.md](v8.4.1-hotfix-luna-implementation-report.md)：V8.4.1 Hotfix Luna-H1/H2 的 Token Breakdown 与 Resolver 诊断 UI 实施边界。
- [v8.4.1-hotfix-terra-implementation-report.md](v8.4.1-hotfix-terra-implementation-report.md)：V8.4.1 Hotfix Terra-H1/H5 的 Localization 回退、Historical Alias Bridge 和真实 Checkpoint 查询结果。
- [v8.4.1-hotfix-sol-final-review.md](v8.4.1-hotfix-sol-final-review.md)：V8.4.1 Hotfix Sol-H1/H4 的真实查询矩阵、身份/来源边界与 Prompt UI 自动化审查。
- [v8.4.2-luna-ui-implementation-report.md](v8.4.2-luna-ui-implementation-report.md)：V8.4.2 Luna 前置 UI 的身份歧义隔离、Definition Binding 语义、年度 Delta 和 Freshness 展示。
- [v8.4.2-terra-p0-implementation-report.md](v8.4.2-terra-p0-implementation-report.md)：V8.4.2 Terra 的身份解析、War parser、Delta provenance 与 CJK Prompt 安全边界。
- [v8.4.2-sol-final-review.md](v8.4.2-sol-final-review.md)：V8.4.2 Sol 的 P0/P1 审计、真实 1156→1157 存档 Historical/War Gate 与实现冻结结论。
- [v8.4.2-run-command-lifecycle-hotfix-implementation-report.md](v8.4.2-run-command-lifecycle-hotfix-implementation-report.md)：V8.4.2 P0 的 Conversation Close 生命周期、Run Command Queue v3、carrier 恢复和确定性回归。
- [v8.5-luna-player-semantic-ui-implementation-report.md](v8.5-luna-player-semantic-ui-implementation-report.md)：V8.5 Luna 玩家语义展示层、默认 UI 内部字段隔离和高级诊断保留。
- [v8.5-terra-retrieval-implementation-report.md](v8.5-terra-retrieval-implementation-report.md)：V8.5 Terra 的确定性 Query Planner、Retriever/Ranker、DTO、缓存 revision 和 token 预算边界。
- [v8.5-sol-internal-review.md](v8.5-sol-internal-review.md)：V8.5 Sol 白屏根因、分页/后台本地化修复、正确性回归和未完成的实机预冻结 Gate。
- [v8.5.1-historical-definition-index-terra-implementation-report.md](v8.5.1-historical-definition-index-terra-implementation-report.md)：V8.5.1 Terra 通用 Historical Definition Index、Worker、绑定安全门禁和 fixture 矩阵。
- [v8.5.2-terra-runtime-identity-implementation-report.md](v8.5.2-terra-runtime-identity-implementation-report.md)：V8.5.2 Terra Runtime-native、Domain DTO、世界线差异、全名来源和历史映射显示边界。
- [v8.5.2-sol-correctness-review.md](v8.5.2-sol-correctness-review.md)：V8.5.2 Sol Stage 3 后端正确性、False Resolution、DTO/IPC 与来源优先级审查。
- [v8.5.2-luna-ui-implementation-report.md](v8.5.2-luna-ui-implementation-report.md)：V8.5.2 Luna Stage 4 玩家语义、Worldline Difference、多实体诊断和 A/B/C 层 UI 边界。
- [v8.5.2-sol-ui-boundary-review.md](v8.5.2-sol-ui-boundary-review.md)：V8.5.2 Sol Stage 5 additive/legacy DTO 一致性、来源优先级、降级安全和 A/B/C 泄漏审查。
- [v8.6-astra-transition-contract.md](v8.6-astra-transition-contract.md)：V8.6 角色知识、字段级事实、共享检索/主观缓存、Secret/Presence 与兼容切换合同。
- [v8.6-sol-stage-1-safety-review.md](v8.6-sol-stage-1-safety-review.md)：V8.6 给名身份 P0、历史来源 variant P1、Character Knowledge 与 Secret 安全合同。
- [v8.6-terra-stage-2-implementation-report.md](v8.6-terra-stage-2-implementation-report.md)：可信完整姓名、Runtime reverse index、Worker 恢复和 Base Game Discovery 2.0。
- [v8.6-terra-stage-3-subjective-world-report.md](v8.6-terra-stage-3-subjective-world-report.md)：共享候选、Scope、定向 Memory、主观 View 与 Prompt Phase A 边界。
- [v8.6-sol-stage-4-safety-review.md](v8.6-sol-stage-4-safety-review.md)：共享/主观缓存隔离、Secret/DTO 脱敏、逐事实 Scope、Prompt 入口审计与 Luna 安全交接合同。
- [v8.6-luna-stage-5-implementation-report.md](v8.6-luna-stage-5-implementation-report.md)：安全 Subjective DTO IPC、回应角色选择、单角色/A-B 诊断 UI、Secret 计数脱敏和 Sol Stage 6 交接边界。
- [v8.6-sol-final-correctness-review.md](v8.6-sol-final-correctness-review.md)：Stage 6 复审、字段公开范围、结构化 Temporal Gate、真实 PromptBuilder 唯一注入及剩余实机 Gate。
- [v8.6-terra-production-subjective-prompt-report.md](v8.6-terra-production-subjective-prompt-report.md)：字段级公开范围、Historical Phase B 与生产 Subjective Prompt 实施及 Sol 复审边界。
- [v8.6.1-sol-stage-1-compatibility-contract.md](v8.6.1-sol-stage-1-compatibility-contract.md)：V8.6.1 Prompt 调序、Global Headroom、Memory 冻结、事实优先级、Secret 与失败隔离合同。
- [v8.6.1-terra-stage-2-3-implementation-report.md](v8.6.1-terra-stage-2-3-implementation-report.md)：V8.6.1 Prompt / Budget、Realm / Observation 与 Scoped Supplemental 实施和边界。
- [v8.6.1-sol-stage-4-safety-review.md](v8.6.1-sol-stage-4-safety-review.md)：V8.6.1 Memory-first Context、Secret/Scoped Supplemental、事实仲裁、确定性与指标独立审查。
- [v8.6.2-sol-implementation-and-final-review.md](v8.6.2-sol-implementation-and-final-review.md)：V8.6.2 Subjective 输出、第三人证据、亲属/死亡/时间事实、发布门禁与人工验收边界。
- [VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md](VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md)：V8.1 存档身份协议、session 降级、Worldline schema、原子持久化和 Shadow 集成合同。
- [v8.1-campaign-identity-worldline-store-implementation-report.md](v8.1-campaign-identity-worldline-store-implementation-report.md)：V8.0 P0/P1 审计、V8.1 应用与 Workshop 实施、自动化验证和实机边界。
- [v8.3.1-historical-figure-dashboard-implementation-report.md](v8.3.1-historical-figure-dashboard-implementation-report.md)：V8.3.1 实机诊断 Snapshot、Overlay Dashboard、append-only Ground Truth 与冻结边界。
- [v8.3-historical-figure-resolver-implementation-report.md](v8.3-historical-figure-resolver-implementation-report.md)：V8.3 人物匹配数据、Canonical 输入、精确名称门禁、身份评分、Shadow 集成与人工 Gate 边界。
- [v8.3-prerequisite-fixes-implementation-report.md](v8.3-prerequisite-fixes-implementation-report.md)：V8.3 前置 EOL、GameData 状态归属和 Shadow metadata 加固，以及仍需 CK3 实机完成的 Gate。
- [v8.0-historical-baseline-2.0-implementation-report.md](v8.0-historical-baseline-2.0-implementation-report.md)：V8.0 结构化历史基线、兼容适配、shadow Temporal Gate、Prompt/cache 等价和发布验证边界。
- [VOTC_v7.8_main.js第一轮模块化拆分实施记录.md](VOTC_v7.8_main.js第一轮模块化拆分实施记录.md)：Pre-V8 组合根、游戏数据、Prompt、摘要、信件和运行服务拆分边界及验证结果。
- [VOTC_v7.7_main.js架构拆分与迁移清单.md](VOTC_v7.7_main.js架构拆分与迁移清单.md)：V7.7 Provider Service、Provider 与 IPC 分阶段拆分范围、依赖边界和验证清单。
- [README_摘要系统.md](README_摘要系统.md)：Memory Engine 2.6 可见标签、2.5 数据合同和人物目录视角摘要系统。
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

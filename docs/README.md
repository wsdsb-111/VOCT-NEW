# VOTC 文档索引

本目录集中保存 VOTC 的架构说明、版本设计、实施报告和阶段记录。根目录的 [README.md](../README.md) 只负责项目简介、安装运行和当前基线；根目录的 [CHANGELOG.md](../CHANGELOG.md) 负责版本顺序，详细内容按下面的分类维护。

## 推荐阅读顺序

1. [项目 README](../README.md)：运行环境、配置方式和当前版本基线。
2. [CHANGELOG.md](../CHANGELOG.md)：按版本查看变更入口和对应的详细文档。
3. [V8阶段开发记录.md](V8阶段开发记录.md)：V8 Dynamic Historical Worldline System 的连续开发、冻结边界与验收记录。
4. [v8.4 GameState 能力勘探报告](v8.4-gamestate-capability-report.md)：CK3 Save 容器、Gamestate、人物/头衔/战争字段和停止边界。
5. [v8.4 性能基准](v8.4-gamestate-performance-benchmark.md)：指定 `autosave_1.ck3` 的读取、扫描、Query、索引和内存检查点。
6. [README_摘要系统.md](README_摘要系统.md)：Memory Engine 2.5 的存储、冻结召回、Turn Recall、写入和生命周期规则。
7. [V7阶段优化记录.md](V7阶段优化记录.md)：V7/V7.x 的连续开发记录。
8. [V6阶段优化记录.md](V6阶段优化记录.md)：V6/V6.x 的动作系统与基础设施记录。
9. 需要核对具体方案时，再阅读版本设计文档和实施报告。

## 文档分类

### 架构与运行规则

- [V8阶段开发记录.md](V8阶段开发记录.md)：V8.0 起的 Historical Baseline、Temporal Gate 与后续世界线阶段记录。
- [v8.4-gamestate-capability-report.md](v8.4-gamestate-capability-report.md)：V8.4 CK3 Save/GameState 前置勘探总览；仅报告能力，不代表正式 V8.4 已实现。
- [v8.4-ck3-save-container-report.md](v8.4-ck3-save-container-report.md)：`SAV0100` 容器、metadata、Gamestate 提取和存档轮换观察。
- [v8.4-gamestate-schema-notes.md](v8.4-gamestate-schema-notes.md)：顶层 section、Character、Title、War 和历史人物解析字段笔记。
- [v8.4-gamestate-adapter-index-proposal.md](v8.4-gamestate-adapter-index-proposal.md)：后续 adapter、worker、normalized snapshot 和 bounded index 提案。
- [v8.4-live-probe-delta-hook-feasibility.md](v8.4-live-probe-delta-hook-feasibility.md)：Workshop debug probe、live date 和 delta hook 可行性。
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

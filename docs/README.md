# VOTC 文档索引

本目录集中保存 VOTC 的架构说明、版本设计、实施报告和阶段记录。根目录的 [README.md](../README.md) 只负责项目简介、安装运行和当前基线；根目录的 [CHANGELOG.md](../CHANGELOG.md) 负责版本顺序，详细内容按下面的分类维护。

## 推荐阅读顺序

1. [项目 README](../README.md)：运行环境、配置方式和当前版本基线。
2. [CHANGELOG.md](../CHANGELOG.md)：按版本查看变更入口和对应的详细文档。
3. [README_摘要系统.md](README_摘要系统.md)：Memory Engine 2.5 的存储、冻结召回、Turn Recall、写入和生命周期规则。
4. [V7阶段优化记录.md](V7阶段优化记录.md)：V7/V7.x 的连续开发记录。
5. [V6阶段优化记录.md](V6阶段优化记录.md)：V6/V6.x 的动作系统与基础设施记录。
6. 需要核对具体方案时，再阅读版本设计文档和实施报告。

## 文档分类

### 架构与运行规则

- [VOTC_v7.8_main.js第一轮模块化拆分实施记录.md](VOTC_v7.8_main.js第一轮模块化拆分实施记录.md)：Pre-V8 组合根、游戏数据、Prompt、摘要、信件和运行服务拆分边界及验证结果。
- [VOTC_v7.7_main.js架构拆分与迁移清单.md](VOTC_v7.7_main.js架构拆分与迁移清单.md)：V7.7 Provider Service、Provider 与 IPC 分阶段拆分范围、依赖边界和验证清单。
- [README_摘要系统.md](README_摘要系统.md)：Memory Engine 2.5 和人物目录视角摘要系统。
- [V7阶段优化记录.md](V7阶段优化记录.md)：V7.0 至当前 V7.x 的功能、修复和验收边界。
- [V6阶段优化记录.md](V6阶段优化记录.md)：V6.2 至 V6.9.1 的动作系统、缓存和架构记录。

### 版本设计与实施报告

- [v7.10-official-action-letter-recovery-implementation-report.md](v7.10-official-action-letter-recovery-implementation-report.md)：V7.10-RC1 至 RC3 Consolidated 官方 Action 迁移、DeepSeek Full Schema 本地保留与传输去重、Action Token 诊断、Letter 日期/投递恢复、Diagnostic 2.2、Sol 契约对照与验证边界。
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

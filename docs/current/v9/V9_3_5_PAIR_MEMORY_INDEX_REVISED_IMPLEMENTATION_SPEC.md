<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.3 版本册](../../versions/v9/V9.3.md#source-bfacc2c0ebff)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-v935-完整开发施工文档修订版"></a>
- [VOCT V9.3.5 完整开发施工文档（修订版）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--voct-v935-完整开发施工文档修订版)
<a id="0-一页执行摘要"></a>
- [0. 一页执行摘要](../../versions/v9/V9.3.md#source-bfacc2c0ebff--0-一页执行摘要)
<a id="01-产品定义"></a>
- [0.1 产品定义](../../versions/v9/V9.3.md#source-bfacc2c0ebff--01-产品定义)
<a id="02-必须不变的硬约束"></a>
- [0.2 必须不变的硬约束](../../versions/v9/V9.3.md#source-bfacc2c0ebff--02-必须不变的硬约束)
<a id="03-研发成功的判定"></a>
- [0.3 研发成功的判定](../../versions/v9/V9.3.md#source-bfacc2c0ebff--03-研发成功的判定)
<a id="1-v934-代码基线与实现落点"></a>
- [1. V9.3.4 代码基线与实现落点](../../versions/v9/V9.3.md#source-bfacc2c0ebff--1-v934-代码基线与实现落点)
<a id="2-记忆架构三种内容一条检索链"></a>
- [2. 记忆架构：三种内容，一条检索链](../../versions/v9/V9.3.md#source-bfacc2c0ebff--2-记忆架构三种内容一条检索链)
<a id="21-内容分工"></a>
- [2.1 内容分工](../../versions/v9/V9.3.md#source-bfacc2c0ebff--21-内容分工)
<a id="22-不要退化回-durable"></a>
- [2.2 不要退化回 Durable](../../versions/v9/V9.3.md#source-bfacc2c0ebff--22-不要退化回-durable)
<a id="3-有向数据模型索引身份与来源证据"></a>
- [3. 有向数据模型、索引身份与来源证据](../../versions/v9/V9.3.md#source-bfacc2c0ebff--3-有向数据模型索引身份与来源证据)
<a id="31-owner-关系主键"></a>
- [3.1 Owner 关系主键](../../versions/v9/V9.3.md#source-bfacc2c0ebff--31-owner-关系主键)
<a id="32-index-item-示例拟新增字段"></a>
- [3.2 Index item 示例（*拟新增字段*）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--32-index-item-示例拟新增字段)
<a id="33-sourcesummarykey-是两级检索的核心"></a>
- [3.3 **sourceSummaryKey 是两级检索的核心**](../../versions/v9/V9.3.md#source-bfacc2c0ebff--33-sourcesummarykey-是两级检索的核心)
<a id="34-存储策略"></a>
- [3.4 存储策略](../../versions/v9/V9.3.md#source-bfacc2c0ebff--34-存储策略)
<a id="4-本地事项解析只复制重要事项不第二次总结"></a>
- [4. 本地事项解析：只复制重要事项，不第二次总结](../../versions/v9/V9.3.md#source-bfacc2c0ebff--4-本地事项解析只复制重要事项不第二次总结)
<a id="41-唯一合法内容来源"></a>
- [4.1 唯一合法内容来源](../../versions/v9/V9.3.md#source-bfacc2c0ebff--41-唯一合法内容来源)
<a id="42-解析的必要规则"></a>
- [4.2 解析的必要规则](../../versions/v9/V9.3.md#source-bfacc2c0ebff--42-解析的必要规则)
<a id="43-解析和索引文本"></a>
- [4.3 解析和索引文本](../../versions/v9/V9.3.md#source-bfacc2c0ebff--43-解析和索引文本)
<a id="5-新增核心两级检索-pair-index--legacy-source-recall"></a>
- [5. **新增核心：两级检索 Pair Index → Legacy Source Recall**](../../versions/v9/V9.3.md#source-bfacc2c0ebff--5-新增核心两级检索-pair-index--legacy-source-recall)
<a id="51-目标场景"></a>
- [5.1 目标场景](../../versions/v9/V9.3.md#source-bfacc2c0ebff--51-目标场景)
<a id="52-检索调度器建议-pair-memory-source-retrievaljs"></a>
- [5.2 检索调度器（建议 `pair-memory-source-retrieval.js`）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--52-检索调度器建议-pair-memory-source-retrievaljs)
<a id="53-第一层轻量索引检索"></a>
- [5.3 第一层：轻量索引检索](../../versions/v9/V9.3.md#source-bfacc2c0ebff--53-第一层轻量索引检索)
<a id="54-第二层精确回查历史原文"></a>
- [5.4 第二层：精确回查历史原文](../../versions/v9/V9.3.md#source-bfacc2c0ebff--54-第二层精确回查历史原文)
<a id="55-回退流程绝对不能删"></a>
- [5.5 回退流程（绝对不能删）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--55-回退流程绝对不能删)
<a id="56-性能预期与可证伪指标"></a>
- [5.6 性能预期与可证伪指标](../../versions/v9/V9.3.md#source-bfacc2c0ebff--56-性能预期与可证伪指标)
<a id="6-每轮-promptrecent1--事项--按需原摘要"></a>
- [6. 每轮 Prompt：Recent1 + 事项 + 按需原摘要](../../versions/v9/V9.3.md#source-bfacc2c0ebff--6-每轮-promptrecent1--事项--按需原摘要)
<a id="61-召回优先顺序"></a>
- [6.1 召回优先顺序](../../versions/v9/V9.3.md#source-bfacc2c0ebff--61-召回优先顺序)
<a id="62-统一预算"></a>
- [6.2 统一预算](../../versions/v9/V9.3.md#source-bfacc2c0ebff--62-统一预算)
<a id="63-冻结-prompt-前缀和切换对象"></a>
- [6.3 冻结 Prompt 前缀和切换对象](../../versions/v9/V9.3.md#source-bfacc2c0ebff--63-冻结-prompt-前缀和切换对象)
<a id="7-多人场景npcnpc-与-npc玩家平权"></a>
- [7. 多人场景：NPC↔NPC 与 NPC↔玩家平权](../../versions/v9/V9.3.md#source-bfacc2c0ebff--7-多人场景npcnpc-与-npc玩家平权)
<a id="71-例子"></a>
- [7.1 例子](../../versions/v9/V9.3.md#source-bfacc2c0ebff--71-例子)
<a id="72-主交谈对象识别不新发模型请求"></a>
- [7.2 主交谈对象识别（不新发模型请求）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--72-主交谈对象识别不新发模型请求)
<a id="73-group-witnessed-不等于-direct-pair"></a>
- [7.3 Group Witnessed 不等于 Direct Pair](../../versions/v9/V9.3.md#source-bfacc2c0ebff--73-group-witnessed-不等于-direct-pair)
<a id="8-摘要-ui一键生成历史目录和原文跳转"></a>
- [8. 摘要 UI：一键生成、历史目录和原文跳转](../../versions/v9/V9.3.md#source-bfacc2c0ebff--8-摘要-ui一键生成历史目录和原文跳转)
<a id="81-三个入口"></a>
- [8.1 三个入口](../../versions/v9/V9.3.md#source-bfacc2c0ebff--81-三个入口)
<a id="82-preview--confirm--apply"></a>
- [8.2 Preview → Confirm → Apply](../../versions/v9/V9.3.md#source-bfacc2c0ebff--82-preview--confirm--apply)
<a id="83-旧摘要迁移与历史归档"></a>
- [8.3 旧摘要迁移与历史归档](../../versions/v9/V9.3.md#source-bfacc2c0ebff--83-旧摘要迁移与历史归档)
<a id="84-新增-ipc-合同建议"></a>
- [8.4 新增 IPC 合同（建议）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--84-新增-ipc-合同建议)
<a id="85-ui-显示草案非真实截图"></a>
- [8.5 UI 显示草案（非真实截图）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--85-ui-显示草案非真实截图)
<a id="9-新摘要自动派生事务一致性与编辑删除"></a>
- [9. 新摘要自动派生、事务一致性与编辑删除](../../versions/v9/V9.3.md#source-bfacc2c0ebff--9-新摘要自动派生事务一致性与编辑删除)
<a id="91-更新时机"></a>
- [9.1 更新时机](../../versions/v9/V9.3.md#source-bfacc2c0ebff--91-更新时机)
<a id="92-读时校验防止陈旧索引"></a>
- [9.2 读时校验防止陈旧索引](../../versions/v9/V9.3.md#source-bfacc2c0ebff--92-读时校验防止陈旧索引)
<a id="93-手工改长期事项怎么办"></a>
- [9.3 手工改长期事项怎么办？](../../versions/v9/V9.3.md#source-bfacc2c0ebff--93-手工改长期事项怎么办)
<a id="10-信件专项修复-p1收信人-legacy-缺失"></a>
- [10. 信件专项修复 P1：收信人 Legacy 缺失](../../versions/v9/V9.3.md#source-bfacc2c0ebff--10-信件专项修复-p1收信人-legacy-缺失)
<a id="101-问题现状与两级检索是独立-gate"></a>
- [10.1 问题现状（与两级检索是独立 Gate）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--101-问题现状与两级检索是独立-gate)
<a id="102-诊断与修复要求"></a>
- [10.2 诊断与修复要求](../../versions/v9/V9.3.md#source-bfacc2c0ebff--102-诊断与修复要求)
<a id="103-归档-ui--trace"></a>
- [10.3 归档 UI / Trace](../../versions/v9/V9.3.md#source-bfacc2c0ebff--103-归档-ui--trace)
<a id="11-施工步骤与严格-gate"></a>
- [11. 施工步骤与严格 Gate](../../versions/v9/V9.3.md#source-bfacc2c0ebff--11-施工步骤与严格-gate)
<a id="phase-0--基线身份性能基准"></a>
- [Phase 0 — 基线、身份、性能基准](../../versions/v9/V9.3.md#source-bfacc2c0ebff--phase-0--基线身份性能基准)
<a id="phase-1--parser--有向索引--source-pointer"></a>
- [Phase 1 — Parser + 有向索引 + Source Pointer](../../versions/v9/V9.3.md#source-bfacc2c0ebff--phase-1--parser--有向索引--source-pointer)
<a id="phase-2--两级检索引擎本次新增核心-gate"></a>
- [Phase 2 — **两级检索引擎**（本次新增核心 Gate）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--phase-2--两级检索引擎本次新增核心-gate)
<a id="phase-3--ui-目录旧摘要批量回填"></a>
- [Phase 3 — UI 目录＋旧摘要批量回填](../../versions/v9/V9.3.md#source-bfacc2c0ebff--phase-3--ui-目录旧摘要批量回填)
<a id="phase-4--recent1--多人-npc-关系路由--预算"></a>
- [Phase 4 — Recent1 + 多人 NPC 关系路由 + 预算](../../versions/v9/V9.3.md#source-bfacc2c0ebff--phase-4--recent1--多人-npc-关系路由--预算)
<a id="phase-5--信件-legacy-摘要修复"></a>
- [Phase 5 — 信件 Legacy 摘要修复](../../versions/v9/V9.3.md#source-bfacc2c0ebff--phase-5--信件-legacy-摘要修复)
<a id="phase-6--发布与实机"></a>
- [Phase 6 — 发布与实机](../../versions/v9/V9.3.md#source-bfacc2c0ebff--phase-6--发布与实机)
<a id="12-自动化验收矩阵必须纳入-release-manifest"></a>
- [12. 自动化验收矩阵（必须纳入 release manifest）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--12-自动化验收矩阵必须纳入-release-manifest)
<a id="13-推荐实机测试脚本"></a>
- [13. 推荐实机测试脚本](../../versions/v9/V9.3.md#source-bfacc2c0ebff--13-推荐实机测试脚本)
<a id="14-交付物冻结条件与禁止事项"></a>
- [14. 交付物、冻结条件与禁止事项](../../versions/v9/V9.3.md#source-bfacc2c0ebff--14-交付物冻结条件与禁止事项)
<a id="15-codex-desktop-施工指令可直接复制"></a>
- [15. Codex Desktop 施工指令（可直接复制）](../../versions/v9/V9.3.md#source-bfacc2c0ebff--15-codex-desktop-施工指令可直接复制)
<a id="最终设计原则"></a>
- [最终设计原则](../../versions/v9/V9.3.md#source-bfacc2c0ebff--最终设计原则)

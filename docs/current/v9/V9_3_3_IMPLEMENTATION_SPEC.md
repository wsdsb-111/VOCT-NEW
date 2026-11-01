<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.3 版本册](../../versions/v9/V9.3.md#source-439769ecd339)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="votc--voct-v933-施工规格重要记忆覆盖legacydurable-可观测性与-yearlife-完全退役"></a>
- [VOTC / VOCT V9.3.3 施工规格：重要记忆覆盖、Legacy–Durable 可观测性与 Year/Life 完全退役](../../versions/v9/V9.3.md#source-439769ecd339--votc--voct-v933-施工规格重要记忆覆盖legacydurable-可观测性与-yearlife-完全退役)
<a id="0-决策摘要"></a>
- [0. 决策摘要](../../versions/v9/V9.3.md#source-439769ecd339--0-决策摘要)
<a id="01-v932-已确认基线不得错误归因于本版本"></a>
- [0.1 V9.3.2 已确认基线（不得错误归因于本版本）](../../versions/v9/V9.3.md#source-439769ecd339--01-v932-已确认基线不得错误归因于本版本)
<a id="1-不可突破的边界和非目标"></a>
- [1. 不可突破的边界和非目标](../../versions/v9/V9.3.md#source-439769ecd339--1-不可突破的边界和非目标)
<a id="2-现有源码定位与影响清单"></a>
- [2. 现有源码定位与影响清单](../../versions/v9/V9.3.md#source-439769ecd339--2-现有源码定位与影响清单)
<a id="3-a-包durable-重要性筛选与整场覆盖"></a>
- [3. A 包：Durable 重要性筛选与整场覆盖](../../versions/v9/V9.3.md#source-439769ecd339--3-a-包durable-重要性筛选与整场覆盖)
<a id="31-要解决的问题"></a>
- [3.1 要解决的问题](../../versions/v9/V9.3.md#source-439769ecd339--31-要解决的问题)
<a id="32-提议算法global-evidence-planner纯本地零额外模型调用"></a>
- [3.2 提议算法：Global Evidence Planner（纯本地，零额外模型调用）](../../versions/v9/V9.3.md#source-439769ecd339--32-提议算法global-evidence-planner纯本地零额外模型调用)
<a id="step-a--全量本地浏览不调用模型"></a>
- [Step A — 全量本地浏览（不调用模型）](../../versions/v9/V9.3.md#source-439769ecd339--step-a--全量本地浏览不调用模型)
<a id="step-b--按来源时间轴均衡分桶"></a>
- [Step B — 按来源时间轴均衡分桶](../../versions/v9/V9.3.md#source-439769ecd339--step-b--按来源时间轴均衡分桶)
<a id="step-c--少量模型指导不新增预审调用"></a>
- [Step C — 少量模型指导，不新增预审调用](../../versions/v9/V9.3.md#source-439769ecd339--step-c--少量模型指导不新增预审调用)
<a id="step-d--配额与-coverage-的诚实语义"></a>
- [Step D — 配额与 Coverage 的诚实语义](../../versions/v9/V9.3.md#source-439769ecd339--step-d--配额与-coverage-的诚实语义)
<a id="33-实现防线不要为了优先级破坏-v932-成果"></a>
- [3.3 实现防线：不要为了优先级破坏 V9.3.2 成果](../../versions/v9/V9.3.md#source-439769ecd339--33-实现防线不要为了优先级破坏-v932-成果)
<a id="34-质量验收样例至少放进-golden-fixtures"></a>
- [3.4 质量验收样例（至少放进 Golden fixtures）](../../versions/v9/V9.3.md#source-439769ecd339--34-质量验收样例至少放进-golden-fixtures)
<a id="4-b-包legacydurable-来源关联与覆盖证明"></a>
- [4. B 包：Legacy–Durable 来源关联与覆盖证明](../../versions/v9/V9.3.md#source-439769ecd339--4-b-包legacydurable-来源关联与覆盖证明)
<a id="41-正确的关系模型"></a>
- [4.1 正确的关系模型](../../versions/v9/V9.3.md#source-439769ecd339--41-正确的关系模型)
<a id="42-proof-of-coverage-关联器服务端只读"></a>
- [4.2 Proof-of-coverage 关联器（服务端只读）](../../versions/v9/V9.3.md#source-439769ecd339--42-proof-of-coverage-关联器服务端只读)
<a id="43-推荐-coverage-dto供-codex-进一步落地不强制新增-schema-版本"></a>
- [4.3 推荐 Coverage DTO（供 Codex 进一步落地，不强制新增 Schema 版本）](../../versions/v9/V9.3.md#source-439769ecd339--43-推荐-coverage-dto供-codex-进一步落地不强制新增-schema-版本)
<a id="44-ui-设计复用现有-memory4manager"></a>
- [4.4 UI 设计：复用现有 `Memory4Manager`](../../versions/v9/V9.3.md#source-439769ecd339--44-ui-设计复用现有-memory4manager)
<a id="45-ui--ipc-集成方案"></a>
- [4.5 UI / IPC 集成方案](../../versions/v9/V9.3.md#source-439769ecd339--45-ui--ipc-集成方案)
<a id="5-c-包yearlife-从代码ui磁盘完全退役"></a>
- [5. C 包：Year/Life 从代码、UI、磁盘完全退役](../../versions/v9/V9.3.md#source-439769ecd339--5-c-包yearlife-从代码ui磁盘完全退役)
<a id="51-清除目标"></a>
- [5.1 清除目标](../../versions/v9/V9.3.md#source-439769ecd339--51-清除目标)
<a id="52-具体代码清理顺序不要先删文件"></a>
- [5.2 具体代码清理顺序（不要先删文件）](../../versions/v9/V9.3.md#source-439769ecd339--52-具体代码清理顺序不要先删文件)
<a id="53-真正删除已有磁盘文件一次性安全迁移"></a>
- [5.3 真正删除已有磁盘文件：一次性安全迁移](../../versions/v9/V9.3.md#source-439769ecd339--53-真正删除已有磁盘文件一次性安全迁移)
<a id="6-durablelegacy-ui-指标的判读合同"></a>
- [6. Durable–Legacy UI 指标的判读合同](../../versions/v9/V9.3.md#source-439769ecd339--6-durablelegacy-ui-指标的判读合同)
<a id="不同状态下-ui-文案要求"></a>
- [不同状态下 UI 文案要求](../../versions/v9/V9.3.md#source-439769ecd339--不同状态下-ui-文案要求)
<a id="7-施工顺序与-gate不准大爆炸式一次修改"></a>
- [7. 施工顺序与 Gate（不准大爆炸式一次修改）](../../versions/v9/V9.3.md#source-439769ecd339--7-施工顺序与-gate不准大爆炸式一次修改)
<a id="phase-0--基线与引用冻结"></a>
- [Phase 0 — 基线与引用冻结](../../versions/v9/V9.3.md#source-439769ecd339--phase-0--基线与引用冻结)
<a id="phase-1--来源规划与追踪先可测试后接生产"></a>
- [Phase 1 — 来源规划与追踪（先可测试，后接生产）](../../versions/v9/V9.3.md#source-439769ecd339--phase-1--来源规划与追踪先可测试后接生产)
<a id="phase-2--legacydurable-coverage-服务与-ui"></a>
- [Phase 2 — Legacy–Durable Coverage 服务与 UI](../../versions/v9/V9.3.md#source-439769ecd339--phase-2--legacydurable-coverage-服务与-ui)
<a id="phase-3--yearlife-依赖解耦与删除"></a>
- [Phase 3 — Year/Life 依赖解耦与删除](../../versions/v9/V9.3.md#source-439769ecd339--phase-3--yearlife-依赖解耦与删除)
<a id="phase-4--全量发布与实机验收"></a>
- [Phase 4 — 全量发布与实机验收](../../versions/v9/V9.3.md#source-439769ecd339--phase-4--全量发布与实机验收)
<a id="8-验收门禁必须逐项满足"></a>
- [8. 验收门禁（必须逐项满足）](../../versions/v9/V9.3.md#source-439769ecd339--8-验收门禁必须逐项满足)
<a id="g1--事实质量与筛选"></a>
- [G1 — 事实质量与筛选](../../versions/v9/V9.3.md#source-439769ecd339--g1--事实质量与筛选)
<a id="g2--provenancelegacy-与可观测性"></a>
- [G2 — Provenance、Legacy 与可观测性](../../versions/v9/V9.3.md#source-439769ecd339--g2--provenancelegacy-与可观测性)
<a id="g3--yearlife-物理退役"></a>
- [G3 — Year/Life 物理退役](../../versions/v9/V9.3.md#source-439769ecd339--g3--yearlife-物理退役)
<a id="g4--发布质量"></a>
- [G4 — 发布质量](../../versions/v9/V9.3.md#source-439769ecd339--g4--发布质量)
<a id="9-不要实施的省事方案"></a>
- [9. 不要实施的“省事方案”](../../versions/v9/V9.3.md#source-439769ecd339--9-不要实施的省事方案)
<a id="10-建议的最终交付清单"></a>
- [10. 建议的最终交付清单](../../versions/v9/V9.3.md#source-439769ecd339--10-建议的最终交付清单)
<a id="11-提供给-codex-的执行指令"></a>
- [11. 提供给 Codex 的执行指令](../../versions/v9/V9.3.md#source-439769ecd339--11-提供给-codex-的执行指令)
<a id="参考源码固定到审查基线"></a>
- [参考源码（固定到审查基线）](../../versions/v9/V9.3.md#source-439769ecd339--参考源码固定到审查基线)

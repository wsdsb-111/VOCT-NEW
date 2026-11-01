<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.2 版本册](../../versions/v9/V9.2.md#source-d0bdf1e56219)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-v922--memory4-durable-缓存异常请求倍增与诊断可信度修复施工文档"></a>
- [VOCT V9.2.2 — Memory4 Durable 缓存异常、请求倍增与诊断可信度修复施工文档](../../versions/v9/V9.2.md#source-d0bdf1e56219--voct-v922--memory4-durable-缓存异常请求倍增与诊断可信度修复施工文档)
<a id="0-执行摘要与最重要的判断"></a>
- [0. 执行摘要与最重要的判断](../../versions/v9/V9.2.md#source-d0bdf1e56219--0-执行摘要与最重要的判断)
<a id="1-实机事件记录及可确认事实"></a>
- [1. 实机事件记录及可确认事实](../../versions/v9/V9.2.md#source-d0bdf1e56219--1-实机事件记录及可确认事实)
<a id="11-当前窗口用户-2026-10-12-三人对话截图"></a>
- [1.1 当前窗口（用户 2026-10-12 三人对话截图）](../../versions/v9/V9.2.md#source-d0bdf1e56219--11-当前窗口用户-2026-10-12-三人对话截图)
<a id="12-截图中两类诊断互相重叠不可相加"></a>
- [1.2 截图中两类诊断（互相重叠，不可相加）](../../versions/v9/V9.2.md#source-d0bdf1e56219--12-截图中两类诊断互相重叠不可相加)
<a id="13-已确认的代码事实"></a>
- [1.3 已确认的代码事实](../../versions/v9/V9.2.md#source-d0bdf1e56219--13-已确认的代码事实)
<a id="14-未证实的假设及排查优先级"></a>
- [1.4 未证实的假设及排查优先级](../../versions/v9/V9.2.md#source-d0bdf1e56219--14-未证实的假设及排查优先级)
<a id="2-v9-路线边界范围与非范围"></a>
- [2. V9 路线边界、范围与非范围](../../versions/v9/V9.2.md#source-d0bdf1e56219--2-v9-路线边界范围与非范围)
<a id="21-当前-v9-路线的阶段合同"></a>
- [2.1 当前 V9 路线的阶段合同](../../versions/v9/V9.2.md#source-d0bdf1e56219--21-当前-v9-路线的阶段合同)
<a id="22-本版允许改动"></a>
- [2.2 本版允许改动](../../versions/v9/V9.2.md#source-d0bdf1e56219--22-本版允许改动)
<a id="23-明确禁止"></a>
- [2.3 明确禁止](../../versions/v9/V9.2.md#source-d0bdf1e56219--23-明确禁止)
<a id="3-p-级问题清单本版开工状态"></a>
- [3. P 级问题清单（本版开工状态）](../../versions/v9/V9.2.md#source-d0bdf1e56219--3-p-级问题清单本版开工状态)
<a id="4-总体设计可追踪的-durable-request-lineage"></a>
- [4. 总体设计：可追踪的 Durable Request Lineage](../../versions/v9/V9.2.md#source-d0bdf1e56219--4-总体设计可追踪的-durable-request-lineage)
<a id="41-不改变业务内容的观测链"></a>
- [4.1 不改变业务内容的观测链](../../versions/v9/V9.2.md#source-d0bdf1e56219--41-不改变业务内容的观测链)
<a id="42-关联-id-设计只用于观测不发给模型"></a>
- [4.2 关联 ID 设计（只用于观测，不发给模型）](../../versions/v9/V9.2.md#source-d0bdf1e56219--42-关联-id-设计只用于观测不发给模型)
<a id="43-推荐的内部-dto设计示例非仓库现有接口"></a>
- [4.3 推荐的内部 DTO（设计示例，非仓库现有接口）](../../versions/v9/V9.2.md#source-d0bdf1e56219--43-推荐的内部-dto设计示例非仓库现有接口)
<a id="44-数据收集失效策略"></a>
- [4.4 数据收集失效策略](../../versions/v9/V9.2.md#source-d0bdf1e56219--44-数据收集失效策略)
<a id="5-wp-00--冻结基线备份确认本次窗口"></a>
- [5. WP-00 — 冻结基线、备份、确认本次窗口](../../versions/v9/V9.2.md#source-d0bdf1e56219--5-wp-00--冻结基线备份确认本次窗口)
<a id="施工步骤"></a>
- [施工步骤](../../versions/v9/V9.2.md#source-d0bdf1e56219--施工步骤)
<a id="6-wp-01--durable-单次请求可观测性最高优先级"></a>
- [6. WP-01 — Durable 单次请求可观测性（最高优先级）](../../versions/v9/V9.2.md#source-d0bdf1e56219--6-wp-01--durable-单次请求可观测性最高优先级)
<a id="61-必须埋点的实际入口"></a>
- [6.1 必须埋点的实际入口](../../versions/v9/V9.2.md#source-d0bdf1e56219--61-必须埋点的实际入口)
<a id="62-一次-api-调用的状态模型"></a>
- [6.2 一次 API 调用的状态模型](../../versions/v9/V9.2.md#source-d0bdf1e56219--62-一次-api-调用的状态模型)
<a id="63-实机与离线验收"></a>
- [6.3 实机与离线验收](../../versions/v9/V9.2.md#source-d0bdf1e56219--63-实机与离线验收)
<a id="7-wp-02--修复跨-owner-诊断串线及断点误解"></a>
- [7. WP-02 — 修复跨 Owner 诊断串线及断点误解](../../versions/v9/V9.2.md#source-d0bdf1e56219--7-wp-02--修复跨-owner-诊断串线及断点误解)
<a id="71-已知问题"></a>
- [7.1 已知问题](../../versions/v9/V9.2.md#source-d0bdf1e56219--71-已知问题)
<a id="72-最小修复要求"></a>
- [7.2 最小修复要求](../../versions/v9/V9.2.md#source-d0bdf1e56219--72-最小修复要求)
<a id="73-反例"></a>
- [7.3 反例](../../versions/v9/V9.2.md#source-d0bdf1e56219--73-反例)
<a id="8-wp-03--finalization-的请求倍增与截断重试评估"></a>
- [8. WP-03 — Finalization 的请求倍增与截断重试评估](../../versions/v9/V9.2.md#source-d0bdf1e56219--8-wp-03--finalization-的请求倍增与截断重试评估)
<a id="81-先测量再动代码"></a>
- [8.1 先测量、再动代码](../../versions/v9/V9.2.md#source-d0bdf1e56219--81-先测量再动代码)
<a id="82-诊断指标"></a>
- [8.2 诊断指标](../../versions/v9/V9.2.md#source-d0bdf1e56219--82-诊断指标)
<a id="83-何时允许最小修改分块策略"></a>
- [8.3 何时允许最小修改分块策略](../../versions/v9/V9.2.md#source-d0bdf1e56219--83-何时允许最小修改分块策略)
<a id="84-目标口径"></a>
- [8.4 目标口径](../../versions/v9/V9.2.md#source-d0bdf1e56219--84-目标口径)
<a id="9-wp-04--forget-到真实-provider-传输前的并发安全补测"></a>
- [9. WP-04 — Forget 到真实 Provider 传输前的并发安全补测](../../versions/v9/V9.2.md#source-d0bdf1e56219--9-wp-04--forget-到真实-provider-传输前的并发安全补测)
<a id="91-时间窗"></a>
- [9.1 时间窗](../../versions/v9/V9.2.md#source-d0bdf1e56219--91-时间窗)
<a id="92-实施约束"></a>
- [9.2 实施约束](../../versions/v9/V9.2.md#source-d0bdf1e56219--92-实施约束)
<a id="93-必须通过的故障注入"></a>
- [9.3 必须通过的故障注入](../../versions/v9/V9.2.md#source-d0bdf1e56219--93-必须通过的故障注入)
<a id="10-wp-05--coldwarm-及同-owner-可比缓存-ab-实验"></a>
- [10. WP-05 — Cold/Warm 及同 Owner 可比缓存 A/B 实验](../../versions/v9/V9.2.md#source-d0bdf1e56219--10-wp-05--coldwarm-及同-owner-可比缓存-ab-实验)
<a id="101-需要解决的实验混杂"></a>
- [10.1 需要解决的实验混杂](../../versions/v9/V9.2.md#source-d0bdf1e56219--101-需要解决的实验混杂)
<a id="102-实验队列仅合成合法证据"></a>
- [10.2 实验队列（仅合成合法证据）](../../versions/v9/V9.2.md#source-d0bdf1e56219--102-实验队列仅合成合法证据)
<a id="103-控制变量"></a>
- [10.3 控制变量](../../versions/v9/V9.2.md#source-d0bdf1e56219--103-控制变量)
<a id="104-主要指标"></a>
- [10.4 主要指标](../../versions/v9/V9.2.md#source-d0bdf1e56219--104-主要指标)
<a id="105-成功定义"></a>
- [10.5 成功定义](../../versions/v9/V9.2.md#source-d0bdf1e56219--105-成功定义)
<a id="11-wp-06--质量权限恢复与回归-gate"></a>
- [11. WP-06 — 质量、权限、恢复与回归 Gate](../../versions/v9/V9.2.md#source-d0bdf1e56219--11-wp-06--质量权限恢复与回归-gate)
<a id="111-memory4-合同不可削弱"></a>
- [11.1 Memory4 合同不可削弱](../../versions/v9/V9.2.md#source-d0bdf1e56219--111-memory4-合同不可削弱)
<a id="112-回归用例矩阵"></a>
- [11.2 回归用例矩阵](../../versions/v9/V9.2.md#source-d0bdf1e56219--112-回归用例矩阵)
<a id="113-完整执行链在仓库根目录"></a>
- [11.3 完整执行链（在仓库根目录）](../../versions/v9/V9.2.md#source-d0bdf1e56219--113-完整执行链在仓库根目录)
<a id="12-wp-07--施工提交与验收顺序"></a>
- [12. WP-07 — 施工提交与验收顺序](../../versions/v9/V9.2.md#source-d0bdf1e56219--12-wp-07--施工提交与验收顺序)
<a id="13-版本策略与正式发布-gate"></a>
- [13. 版本策略与正式发布 Gate](../../versions/v9/V9.2.md#source-d0bdf1e56219--13-版本策略与正式发布-gate)
<a id="131-版本号"></a>
- [13.1 版本号](../../versions/v9/V9.2.md#source-d0bdf1e56219--131-版本号)
<a id="132-exit-gate"></a>
- [13.2 Exit Gate](../../versions/v9/V9.2.md#source-d0bdf1e56219--132-exit-gate)
<a id="14-回滚与紧急处置"></a>
- [14. 回滚与紧急处置](../../versions/v9/V9.2.md#source-d0bdf1e56219--14-回滚与紧急处置)
<a id="141-触发条件"></a>
- [14.1 触发条件](../../versions/v9/V9.2.md#source-d0bdf1e56219--141-触发条件)
<a id="142-操作原则"></a>
- [14.2 操作原则](../../versions/v9/V9.2.md#source-d0bdf1e56219--142-操作原则)
<a id="15-v93--v94-移交条款"></a>
- [15. V9.3 / V9.4 移交条款](../../versions/v9/V9.2.md#source-d0bdf1e56219--15-v93--v94-移交条款)
<a id="16-codex-施工约束可直接复制到任务提示词"></a>
- [16. Codex 施工约束（可直接复制到任务提示词）](../../versions/v9/V9.2.md#source-d0bdf1e56219--16-codex-施工约束可直接复制到任务提示词)
<a id="必须交付的文件建议名称"></a>
- [必须交付的文件（建议名称）](../../versions/v9/V9.2.md#source-d0bdf1e56219--必须交付的文件建议名称)
<a id="17-最终施工目标核查表"></a>
- [17. 最终施工目标核查表](../../versions/v9/V9.2.md#source-d0bdf1e56219--17-最终施工目标核查表)

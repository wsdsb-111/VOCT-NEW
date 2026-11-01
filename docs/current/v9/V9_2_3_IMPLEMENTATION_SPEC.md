<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.2 版本册](../../versions/v9/V9.2.md#source-9987b8177cc2)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-v923-详细设计与施工方案"></a>
- [VOCT V9.2.3 详细设计与施工方案](../../versions/v9/V9.2.md#source-9987b8177cc2--voct-v923-详细设计与施工方案)
<a id="memory4-lifeyear-自动生成退役--glm-缓存异常根因调查与最小修复"></a>
- [Memory4 Life/Year 自动生成退役 × GLM 缓存异常根因调查与最小修复](../../versions/v9/V9.2.md#source-9987b8177cc2--memory4-lifeyear-自动生成退役--glm-缓存异常根因调查与最小修复)
<a id="0-执行摘要与决策"></a>
- [0. 执行摘要与决策](../../versions/v9/V9.2.md#source-9987b8177cc2--0-执行摘要与决策)
<a id="01-验收逻辑"></a>
- [0.1 验收逻辑](../../versions/v9/V9.2.md#source-9987b8177cc2--01-验收逻辑)
<a id="1-已有证据与准确的问题边界"></a>
- [1. 已有证据与准确的问题边界](../../versions/v9/V9.2.md#source-9987b8177cc2--1-已有证据与准确的问题边界)
<a id="11-用户实机数据不混用窗口"></a>
- [1.1 用户实机数据（不混用窗口）](../../versions/v9/V9.2.md#source-9987b8177cc2--11-用户实机数据不混用窗口)
<a id="12-源码已确认的-yearlife-机制"></a>
- [1.2 源码已确认的 Year/Life 机制](../../versions/v9/V9.2.md#source-9987b8177cc2--12-源码已确认的-yearlife-机制)
<a id="13-v921--v922-glm-对照不能预先认定回归"></a>
- [1.3 V9.2.1 → V9.2.2 GLM 对照：不能预先认定回归](../../versions/v9/V9.2.md#source-9987b8177cc2--13-v921--v922-glm-对照不能预先认定回归)
<a id="2-缺陷登记施工前未自动宣称修好"></a>
- [2. 缺陷登记（施工前，未自动宣称修好）](../../versions/v9/V9.2.md#source-9987b8177cc2--2-缺陷登记施工前未自动宣称修好)
<a id="3-v923-范围约束与不可变合同"></a>
- [3. V9.2.3 范围约束与不可变合同](../../versions/v9/V9.2.md#source-9987b8177cc2--3-v923-范围约束与不可变合同)
<a id="31-in-scope"></a>
- [3.1 In Scope](../../versions/v9/V9.2.md#source-9987b8177cc2--31-in-scope)
<a id="32-out-of-scope"></a>
- [3.2 Out of Scope](../../versions/v9/V9.2.md#source-9987b8177cc2--32-out-of-scope)
<a id="33-不变式任何违反直接阻断"></a>
- [3.3 不变式（任何违反直接阻断）](../../versions/v9/V9.2.md#source-9987b8177cc2--33-不变式任何违反直接阻断)
<a id="4-目标架构"></a>
- [4. 目标架构](../../versions/v9/V9.2.md#source-9987b8177cc2--4-目标架构)
<a id="41-退役前"></a>
- [4.1 退役前](../../versions/v9/V9.2.md#source-9987b8177cc2--41-退役前)
<a id="42-退役后"></a>
- [4.2 退役后](../../versions/v9/V9.2.md#source-9987b8177cc2--42-退役后)
<a id="43-默认策略"></a>
- [4.3 默认策略](../../versions/v9/V9.2.md#source-9987b8177cc2--43-默认策略)
<a id="5-wp-00冻结基线成本证据与止损"></a>
- [5. WP-00：冻结基线、成本证据与止损](../../versions/v9/V9.2.md#source-9987b8177cc2--5-wp-00冻结基线成本证据与止损)
<a id="目标"></a>
- [目标](../../versions/v9/V9.2.md#source-9987b8177cc2--目标)
<a id="步骤"></a>
- [步骤](../../versions/v9/V9.2.md#source-9987b8177cc2--步骤)
<a id="6-wp-01统一-yearlife-llm-生成退役策略最高优先级"></a>
- [6. WP-01：统一 Year/Life LLM 生成退役策略（最高优先级）](../../versions/v9/V9.2.md#source-9987b8177cc2--6-wp-01统一-yearlife-llm-生成退役策略最高优先级)
<a id="文件"></a>
- [文件](../../versions/v9/V9.2.md#source-9987b8177cc2--文件)
<a id="施工要求"></a>
- [施工要求](../../versions/v9/V9.2.md#source-9987b8177cc2--施工要求)
<a id="wp-01-正反例"></a>
- [WP-01 正反例](../../versions/v9/V9.2.md#source-9987b8177cc2--wp-01-正反例)
<a id="7-wp-02derivedrecovery-状态机解耦修复失败空转"></a>
- [7. WP-02：Derived/Recovery 状态机解耦，修复失败空转](../../versions/v9/V9.2.md#source-9987b8177cc2--7-wp-02derivedrecovery-状态机解耦修复失败空转)
<a id="需要覆盖的全部入口"></a>
- [需要覆盖的全部入口](../../versions/v9/V9.2.md#source-9987b8177cc2--需要覆盖的全部入口)
<a id="必须明确区分的持久化状态"></a>
- [必须明确区分的持久化状态](../../versions/v9/V9.2.md#source-9987b8177cc2--必须明确区分的持久化状态)
<a id="建议兼容标识"></a>
- [建议兼容标识](../../versions/v9/V9.2.md#source-9987b8177cc2--建议兼容标识)
<a id="事务与删除限制"></a>
- [事务与删除限制](../../versions/v9/V9.2.md#source-9987b8177cc2--事务与删除限制)
<a id="退出验收"></a>
- [退出验收](../../versions/v9/V9.2.md#source-9987b8177cc2--退出验收)
<a id="8-wp-03只读兼容时间召回与-npc-成本质量验证"></a>
- [8. WP-03：只读兼容、时间召回与 NPC 成本/质量验证](../../versions/v9/V9.2.md#source-9987b8177cc2--8-wp-03只读兼容时间召回与-npc-成本质量验证)
<a id="81-既有检索保持原样"></a>
- [8.1 既有检索保持原样](../../versions/v9/V9.2.md#source-9987b8177cc2--81-既有检索保持原样)
<a id="82-旧文件与-npc-视图"></a>
- [8.2 旧文件与 NPC 视图](../../versions/v9/V9.2.md#source-9987b8177cc2--82-旧文件与-npc-视图)
<a id="83-历史记忆-ab离线实机"></a>
- [8.3 历史记忆 A/B（离线＋实机）](../../versions/v9/V9.2.md#source-9987b8177cc2--83-历史记忆-ab离线实机)
<a id="9-wp-04glm-v921--v922-差异证伪先不改-prompt"></a>
- [9. WP-04：GLM V9.2.1 → V9.2.2 差异证伪，先不改 Prompt](../../versions/v9/V9.2.md#source-9987b8177cc2--9-wp-04glm-v921--v922-差异证伪先不改-prompt)
<a id="91-已知对照先写入报告"></a>
- [9.1 已知对照（先写入报告）](../../versions/v9/V9.2.md#source-9987b8177cc2--91-已知对照先写入报告)
<a id="92-准备三个隔离实验基线"></a>
- [9.2 准备三个隔离实验基线](../../versions/v9/V9.2.md#source-9987b8177cc2--92-准备三个隔离实验基线)
<a id="93-受控根因假设及验证证据"></a>
- [9.3 受控根因假设及验证证据](../../versions/v9/V9.2.md#source-9987b8177cc2--93-受控根因假设及验证证据)
<a id="94-关键异常复现对象"></a>
- [9.4 关键异常复现对象](../../versions/v9/V9.2.md#source-9987b8177cc2--94-关键异常复现对象)
<a id="10-wp-05glm-原生长上下文实验费用受控"></a>
- [10. WP-05：GLM 原生长上下文实验（费用受控）](../../versions/v9/V9.2.md#source-9987b8177cc2--10-wp-05glm-原生长上下文实验费用受控)
<a id="101-控制条件"></a>
- [10.1 控制条件](../../versions/v9/V9.2.md#source-9987b8177cc2--101-控制条件)
<a id="102-最小矩阵"></a>
- [10.2 最小矩阵](../../versions/v9/V9.2.md#source-9987b8177cc2--102-最小矩阵)
<a id="103-记录字段脱敏白名单"></a>
- [10.3 记录字段（脱敏白名单）](../../versions/v9/V9.2.md#source-9987b8177cc2--103-记录字段脱敏白名单)
<a id="104-判断规则"></a>
- [10.4 判断规则](../../versions/v9/V9.2.md#source-9987b8177cc2--104-判断规则)
<a id="11-wp-06有证据才做-glm-最小修复"></a>
- [11. WP-06：有证据才做 GLM 最小修复](../../versions/v9/V9.2.md#source-9987b8177cc2--11-wp-06有证据才做-glm-最小修复)
<a id="修复路径-a确证是应用层-bug"></a>
- [修复路径 A：确证是应用层 bug](../../versions/v9/V9.2.md#source-9987b8177cc2--修复路径-a确证是应用层-bug)
<a id="修复路径-b应用请求逐字节稳定glm-仍零命中"></a>
- [修复路径 B：应用请求逐字节稳定，GLM 仍零命中](../../versions/v9/V9.2.md#source-9987b8177cc2--修复路径-b应用请求逐字节稳定glm-仍零命中)
<a id="12-wp-07测试矩阵与故障注入"></a>
- [12. WP-07：测试矩阵与故障注入](../../versions/v9/V9.2.md#source-9987b8177cc2--12-wp-07测试矩阵与故障注入)
<a id="121-yearlife-零成本合同全部必须-pass"></a>
- [12.1 Year/Life 零成本合同（全部必须 PASS）](../../versions/v9/V9.2.md#source-9987b8177cc2--121-yearlife-零成本合同全部必须-pass)
<a id="122-glm统计互操作测试"></a>
- [12.2 GLM/统计/互操作测试](../../versions/v9/V9.2.md#source-9987b8177cc2--122-glm统计互操作测试)
<a id="123-成本防回归测试"></a>
- [12.3 成本防回归测试](../../versions/v9/V9.2.md#source-9987b8177cc2--123-成本防回归测试)
<a id="13-wp-08诊断数据成本仪表盘与验收文档"></a>
- [13. WP-08：诊断数据、成本仪表盘与验收文档](../../versions/v9/V9.2.md#source-9987b8177cc2--13-wp-08诊断数据成本仪表盘与验收文档)
<a id="131-报表必须清楚分离"></a>
- [13.1 报表必须清楚分离](../../versions/v9/V9.2.md#source-9987b8177cc2--131-报表必须清楚分离)
<a id="132-诊断记录建议"></a>
- [13.2 诊断记录建议](../../versions/v9/V9.2.md#source-9987b8177cc2--132-诊断记录建议)
<a id="133-必交付文件"></a>
- [13.3 必交付文件](../../versions/v9/V9.2.md#source-9987b8177cc2--133-必交付文件)
<a id="14-wp-09施工提交顺序命令与回滚"></a>
- [14. WP-09：施工提交顺序、命令与回滚](../../versions/v9/V9.2.md#source-9987b8177cc2--14-wp-09施工提交顺序命令与回滚)
<a id="141-实施验证命令以仓库脚本为准"></a>
- [14.1 实施/验证命令（以仓库脚本为准）](../../versions/v9/V9.2.md#source-9987b8177cc2--141-实施验证命令以仓库脚本为准)
<a id="142-回滚原则"></a>
- [14.2 回滚原则](../../versions/v9/V9.2.md#source-9987b8177cc2--142-回滚原则)
<a id="15-最终发布-gate逐项签署"></a>
- [15. 最终发布 Gate（逐项签署）](../../versions/v9/V9.2.md#source-9987b8177cc2--15-最终发布-gate逐项签署)
<a id="151-硬性监控数值"></a>
- [15.1 硬性监控数值](../../versions/v9/V9.2.md#source-9987b8177cc2--151-硬性监控数值)
<a id="16-v93--v94-移交边界"></a>
- [16. V9.3 / V9.4 移交边界](../../versions/v9/V9.2.md#source-9987b8177cc2--16-v93--v94-移交边界)
<a id="17-codex-交接执行说明"></a>
- [17. Codex 交接执行说明](../../versions/v9/V9.2.md#source-9987b8177cc2--17-codex-交接执行说明)
<a id="源码参照github"></a>
- [源码参照（GitHub）](../../versions/v9/V9.2.md#source-9987b8177cc2--源码参照github)

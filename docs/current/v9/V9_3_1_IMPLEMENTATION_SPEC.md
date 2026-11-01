<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.3 版本册](../../versions/v9/V9.3.md#source-63e929adb546)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-v931--provider-usage-与-action-诊断修复专项"></a>
- [VOCT V9.3.1 — Provider Usage 与 Action 诊断修复专项](../../versions/v9/V9.3.md#source-63e929adb546--voct-v931--provider-usage-与-action-诊断修复专项)
<a id="0-执行摘要与工程决策"></a>
- [0. 执行摘要与工程决策](../../versions/v9/V9.3.md#source-63e929adb546--0-执行摘要与工程决策)
<a id="本阶段不可破坏的事实"></a>
- [本阶段不可破坏的事实](../../versions/v9/V9.3.md#source-63e929adb546--本阶段不可破坏的事实)
<a id="1-基线核查与问题复现依据"></a>
- [1. 基线核查与问题复现依据](../../versions/v9/V9.3.md#source-63e929adb546--1-基线核查与问题复现依据)
<a id="11-最新已检查的仓库位置"></a>
- [1.1 最新已检查的仓库位置](../../versions/v9/V9.3.md#source-63e929adb546--11-最新已检查的仓库位置)
<a id="12-gemini-问题最小反例"></a>
- [1.2 Gemini 问题最小反例](../../versions/v9/V9.3.md#source-63e929adb546--12-gemini-问题最小反例)
<a id="13-action-问题最小反例"></a>
- [1.3 Action 问题最小反例](../../versions/v9/V9.3.md#source-63e929adb546--13-action-问题最小反例)
<a id="2-施工目标验收口径与退出标准"></a>
- [2. 施工目标、验收口径与退出标准](../../versions/v9/V9.3.md#source-63e929adb546--2-施工目标验收口径与退出标准)
<a id="21-功能验收目标"></a>
- [2.1 功能验收目标](../../versions/v9/V9.3.md#source-63e929adb546--21-功能验收目标)
<a id="22-非目标明确禁止"></a>
- [2.2 非目标（明确禁止）](../../versions/v9/V9.3.md#source-63e929adb546--22-非目标明确禁止)
<a id="3-总体实现设计"></a>
- [3. 总体实现设计](../../versions/v9/V9.3.md#source-63e929adb546--3-总体实现设计)
<a id="31-数据合同约束"></a>
- [3.1 数据合同约束](../../versions/v9/V9.3.md#source-63e929adb546--31-数据合同约束)
<a id="4-工作包-wp-00冻结基线与-red-测试"></a>
- [4. 工作包 WP-00：冻结基线与 RED 测试](../../versions/v9/V9.3.md#source-63e929adb546--4-工作包-wp-00冻结基线与-red-测试)
<a id="5-工作包-wp-01gemini-adapter-无损安全投影p1-核心"></a>
- [5. 工作包 WP-01：Gemini Adapter 无损安全投影（P1 核心）](../../versions/v9/V9.3.md#source-63e929adb546--5-工作包-wp-01gemini-adapter-无损安全投影p1-核心)
<a id="51-提取一个共用的-gemini-usage-mapper"></a>
- [5.1 提取一个共用的 Gemini Usage Mapper](../../versions/v9/V9.3.md#source-63e929adb546--51-提取一个共用的-gemini-usage-mapper)
<a id="52-行为级断言"></a>
- [5.2 行为级断言](../../versions/v9/V9.3.md#source-63e929adb546--52-行为级断言)
<a id="6-工作包-wp-02统一-usage-正确处理-gemini-多组成分p1-核心"></a>
- [6. 工作包 WP-02：统一 Usage 正确处理 Gemini 多组成分（P1 核心）](../../versions/v9/V9.3.md#source-63e929adb546--6-工作包-wp-02统一-usage-正确处理-gemini-多组成分p1-核心)
<a id="61-normalizer-设计要求"></a>
- [6.1 Normalizer 设计要求](../../versions/v9/V9.3.md#source-63e929adb546--61-normalizer-设计要求)
<a id="62-合成表驱动测试必须全部通过"></a>
- [6.2 合成表驱动测试（必须全部通过）](../../versions/v9/V9.3.md#source-63e929adb546--62-合成表驱动测试必须全部通过)
<a id="63-流水线端到端验证"></a>
- [6.3 流水线端到端验证](../../versions/v9/V9.3.md#source-63e929adb546--63-流水线端到端验证)
<a id="7-工作包-wp-03action-分发诊断的最小语义修复p2"></a>
- [7. 工作包 WP-03：Action 分发诊断的最小语义修复（P2）](../../versions/v9/V9.3.md#source-63e929adb546--7-工作包-wp-03action-分发诊断的最小语义修复p2)
<a id="71-明确四个不同的事实"></a>
- [7.1 明确四个不同的事实](../../versions/v9/V9.3.md#source-63e929adb546--71-明确四个不同的事实)
<a id="72-最小修改策略"></a>
- [7.2 最小修改策略](../../versions/v9/V9.3.md#source-63e929adb546--72-最小修改策略)
<a id="73-action-回归矩阵"></a>
- [7.3 Action 回归矩阵](../../versions/v9/V9.3.md#source-63e929adb546--73-action-回归矩阵)
<a id="8-工作包-wp-04合成安全验证与横向-provider-保真"></a>
- [8. 工作包 WP-04：合成安全验证与横向 Provider 保真](../../versions/v9/V9.3.md#source-63e929adb546--8-工作包-wp-04合成安全验证与横向-provider-保真)
<a id="9-工作包-wp-05构建发布与实际-ck3-验收"></a>
- [9. 工作包 WP-05：构建、发布与实际 CK3 验收](../../versions/v9/V9.3.md#source-63e929adb546--9-工作包-wp-05构建发布与实际-ck3-验收)
<a id="91-推荐施工提交划分"></a>
- [9.1 推荐施工提交划分](../../versions/v9/V9.3.md#source-63e929adb546--91-推荐施工提交划分)
<a id="92-统一测试命令以仓库脚本及平台环境为准"></a>
- [9.2 统一测试命令（以仓库脚本及平台环境为准）](../../versions/v9/V9.3.md#source-63e929adb546--92-统一测试命令以仓库脚本及平台环境为准)
<a id="93-实机-gate需用户执行未执行前保持-not_verified"></a>
- [9.3 实机 Gate（需用户执行，未执行前保持 NOT_VERIFIED）](../../versions/v9/V9.3.md#source-63e929adb546--93-实机-gate需用户执行未执行前保持-not_verified)
<a id="94-费用控制"></a>
- [9.4 费用控制](../../versions/v9/V9.3.md#source-63e929adb546--94-费用控制)
<a id="10-工作包-wp-06验证报告问题台账版本与冻结"></a>
- [10. 工作包 WP-06：验证报告、问题台账、版本与冻结](../../versions/v9/V9.3.md#source-63e929adb546--10-工作包-wp-06验证报告问题台账版本与冻结)
<a id="101-必需交付"></a>
- [10.1 必需交付](../../versions/v9/V9.3.md#source-63e929adb546--101-必需交付)
<a id="102-发布判定"></a>
- [10.2 发布判定](../../versions/v9/V9.3.md#source-63e929adb546--102-发布判定)
<a id="103-问题台账实施前均未关闭"></a>
- [10.3 问题台账（实施前均未关闭）](../../versions/v9/V9.3.md#source-63e929adb546--103-问题台账实施前均未关闭)
<a id="11-风险回滚禁止项"></a>
- [11. 风险、回滚、禁止项](../../versions/v9/V9.3.md#source-63e929adb546--11-风险回滚禁止项)
<a id="12-codex-直接执行指令"></a>
- [12. Codex 直接执行指令](../../versions/v9/V9.3.md#source-63e929adb546--12-codex-直接执行指令)
<a id="13-最终成功定义"></a>
- [13. 最终成功定义](../../versions/v9/V9.3.md#source-63e929adb546--13-最终成功定义)

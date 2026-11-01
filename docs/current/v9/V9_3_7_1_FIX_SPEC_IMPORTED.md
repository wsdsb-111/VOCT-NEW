<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.3 版本册](../../versions/v9/V9.3.md#source-3056b4256bd0)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="v9371-原修复方案导入留档"></a>
- [V9.3.7.1 原修复方案（导入留档）](../../versions/v9/V9.3.md#source-3056b4256bd0--v9371-原修复方案导入留档)
<a id="voct-v9371-修复施工文档"></a>
- [VOCT V9.3.7.1 修复施工文档](../../versions/v9/V9.3.md#source-3056b4256bd0--voct-v9371-修复施工文档)
<a id="0-版本目标与边界"></a>
- [0. 版本目标与边界](../../versions/v9/V9.3.md#source-3056b4256bd0--0-版本目标与边界)
<a id="01-本版必须完成"></a>
- [0.1 本版必须完成](../../versions/v9/V9.3.md#source-3056b4256bd0--01-本版必须完成)
<a id="02-必须保留的-v937-成果"></a>
- [0.2 必须保留的 V9.3.7 成果](../../versions/v9/V9.3.md#source-3056b4256bd0--02-必须保留的-v937-成果)
<a id="03-明确禁止"></a>
- [0.3 明确禁止](../../versions/v9/V9.3.md#source-3056b4256bd0--03-明确禁止)
<a id="1-当前基线与实机状态"></a>
- [1. 当前基线与实机状态](../../versions/v9/V9.3.md#source-3056b4256bd0--1-当前基线与实机状态)
<a id="11-已知代码基线"></a>
- [1.1 已知代码基线](../../versions/v9/V9.3.md#source-3056b4256bd0--11-已知代码基线)
<a id="12-最新实机反馈"></a>
- [1.2 最新实机反馈](../../versions/v9/V9.3.md#source-3056b4256bd0--12-最新实机反馈)
<a id="2-p-级问题清单与修复要求"></a>
- [2. P 级问题清单与修复要求](../../versions/v9/V9.3.md#source-3056b4256bd0--2-p-级问题清单与修复要求)
<a id="p1-01currentdirectparentfilter-对未知来源存在-fail-open"></a>
- [P1-01：`currentDirectParentFilter()` 对未知来源存在 fail-open](../../versions/v9/V9.3.md#source-3056b4256bd0--p1-01currentdirectparentfilter-对未知来源存在-fail-open)
<a id="p1-02children-与-relationtype-child-建边路径绕过父母过滤"></a>
- [P1-02：`children` 与 `relationType: "child"` 建边路径绕过父母过滤](../../versions/v9/V9.3.md#source-3056b4256bd0--p1-02children-与-relationtype-child-建边路径绕过父母过滤)
<a id="p1-03unknown-otherparent-不得进入关系图或家庭事实推断"></a>
- [P1-03：`UNKNOWN otherParent` 不得进入关系图或家庭事实推断](../../versions/v9/V9.3.md#source-3056b4256bd0--p1-03unknown-otherparent-不得进入关系图或家庭事实推断)
<a id="p1-04ck3-相对人物导出补丁必须确认真实生效"></a>
- [P1-04：CK3 相对人物导出补丁必须确认真实生效](../../versions/v9/V9.3.md#source-3056b4256bd0--p1-04ck3-相对人物导出补丁必须确认真实生效)
<a id="p1-05继亲识别成功但关系标签错误地指向亲生父母"></a>
- [P1-05：继亲识别成功，但关系标签错误地指向亲生父母](../../versions/v9/V9.3.md#source-3056b4256bd0--p1-05继亲识别成功但关系标签错误地指向亲生父母)
<a id="p1-06实机年龄仍出现-实际年龄--1"></a>
- [P1-06：实机年龄仍出现 `实际年龄 + 1`](../../versions/v9/V9.3.md#source-3056b4256bd0--p1-06实机年龄仍出现-实际年龄--1)
<a id="61-必须采集的分层证据"></a>
- [6.1 必须采集的分层证据](../../versions/v9/V9.3.md#source-3056b4256bd0--61-必须采集的分层证据)
<a id="62-根因分类与对应修复"></a>
- [6.2 根因分类与对应修复](../../versions/v9/V9.3.md#source-3056b4256bd0--62-根因分类与对应修复)
<a id="63-年龄修复约束"></a>
- [6.3 年龄修复约束](../../versions/v9/V9.3.md#source-3056b4256bd0--63-年龄修复约束)
<a id="p1-07恢复摘要--个人摘要--人物认知"></a>
- [P1-07：恢复「摘要 → 个人摘要 → 人物认知」](../../versions/v9/V9.3.md#source-3056b4256bd0--p1-07恢复摘要--个人摘要--人物认知)
<a id="71-ui-要求"></a>
- [7.1 UI 要求](../../versions/v9/V9.3.md#source-3056b4256bd0--71-ui-要求)
<a id="72-数据与架构要求"></a>
- [7.2 数据与架构要求](../../versions/v9/V9.3.md#source-3056b4256bd0--72-数据与架构要求)
<a id="73-与对话-prompt-的边界"></a>
- [7.3 与对话 Prompt 的边界](../../versions/v9/V9.3.md#source-3056b4256bd0--73-与对话-prompt-的边界)
<a id="3-p2-问题与测试缺口"></a>
- [3. P2 问题与测试缺口](../../versions/v9/V9.3.md#source-3056b4256bd0--3-p2-问题与测试缺口)
<a id="p2-01旧日志兼容测试必须经过生产-createlogparser-路径"></a>
- [P2-01：旧日志兼容测试必须经过生产 `createLogParser()` 路径](../../versions/v9/V9.3.md#source-3056b4256bd0--p2-01旧日志兼容测试必须经过生产-createlogparser-路径)
<a id="p2-02亲属关系双向冲突与缓存回归"></a>
- [P2-02：亲属关系双向冲突与缓存回归](../../versions/v9/V9.3.md#source-3056b4256bd0--p2-02亲属关系双向冲突与缓存回归)
<a id="4-远程-github-actions--ci-失败分析与修复"></a>
- [4. 远程 GitHub Actions / CI 失败分析与修复](../../versions/v9/V9.3.md#source-3056b4256bd0--4-远程-github-actions--ci-失败分析与修复)
<a id="41-已确认的失败记录"></a>
- [4.1 已确认的失败记录](../../versions/v9/V9.3.md#source-3056b4256bd0--41-已确认的失败记录)
<a id="42-已定位的直接原因"></a>
- [4.2 已定位的直接原因](../../versions/v9/V9.3.md#source-3056b4256bd0--42-已定位的直接原因)
<a id="43-ci-修复要求"></a>
- [4.3 CI 修复要求](../../versions/v9/V9.3.md#source-3056b4256bd0--43-ci-修复要求)
<a id="5-施工阶段与建议顺序"></a>
- [5. 施工阶段与建议顺序](../../versions/v9/V9.3.md#source-3056b4256bd0--5-施工阶段与建议顺序)
<a id="6-必须新增或补强的测试矩阵"></a>
- [6. 必须新增或补强的测试矩阵](../../versions/v9/V9.3.md#source-3056b4256bd0--6-必须新增或补强的测试矩阵)
<a id="61-亲属图来源与公开性"></a>
- [6.1 亲属图来源与公开性](../../versions/v9/V9.3.md#source-3056b4256bd0--61-亲属图来源与公开性)
<a id="62-继亲正妻与庶子女"></a>
- [6.2 继亲、正妻与庶子女](../../versions/v9/V9.3.md#source-3056b4256bd0--62-继亲正妻与庶子女)
<a id="63-年龄-1"></a>
- [6.3 年龄 `+1`](../../versions/v9/V9.3.md#source-3056b4256bd0--63-年龄-1)
<a id="64-人物认知-ui-与数据"></a>
- [6.4 人物认知 UI 与数据](../../versions/v9/V9.3.md#source-3056b4256bd0--64-人物认知-ui-与数据)
<a id="65-旧日志与发布门禁"></a>
- [6.5 旧日志与发布门禁](../../versions/v9/V9.3.md#source-3056b4256bd0--65-旧日志与发布门禁)
<a id="7-真实-ck3-验收清单"></a>
- [7. 真实 CK3 验收清单](../../versions/v9/V9.3.md#source-3056b4256bd0--7-真实-ck3-验收清单)
<a id="8-发布验收标准"></a>
- [8. 发布验收标准](../../versions/v9/V9.3.md#source-3056b4256bd0--8-发布验收标准)
<a id="9-关键参考"></a>
- [9. 关键参考](../../versions/v9/V9.3.md#source-3056b4256bd0--9-关键参考)

<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V7.9 版本册](versions/v7/V7.9.md#source-c4d0797c5c94)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="ae4-spec-errata-001self-target-目标约束冲突修正"></a>
- [AE4 Spec Errata-001：Self-Target 目标约束冲突修正](versions/v7/V7.9.md#source-c4d0797c5c94--ae4-spec-errata-001self-target-目标约束冲突修正)
<a id="1-问题定义"></a>
- [1. 问题定义](versions/v7/V7.9.md#source-c4d0797c5c94--1-问题定义)
<a id="2-修正结论"></a>
- [2. 修正结论](versions/v7/V7.9.md#source-c4d0797c5c94--2-修正结论)
<a id="21-删除全局-source--target-不变量"></a>
- [2.1 删除全局 `source != target` 不变量](versions/v7/V7.9.md#source-c4d0797c5c94--21-删除全局-source--target-不变量)
<a id="22-引入-targetpolicy"></a>
- [2.2 引入 `targetPolicy`](versions/v7/V7.9.md#source-c4d0797c5c94--22-引入-targetpolicy)
<a id="3-safe-default"></a>
- [3. Safe Default](versions/v7/V7.9.md#source-c4d0797c5c94--3-safe-default)
<a id="4-p0-动作-metadata-修正"></a>
- [4. P0 动作 Metadata 修正](versions/v7/V7.9.md#source-c4d0797c5c94--4-p0-动作-metadata-修正)
<a id="5-禁止使用-action-名称硬编码例外"></a>
- [5. 禁止使用 Action 名称硬编码例外](versions/v7/V7.9.md#source-c4d0797c5c94--5-禁止使用-action-名称硬编码例外)
<a id="6-shared-pipeline-一致性要求"></a>
- [6. Shared Pipeline 一致性要求](versions/v7/V7.9.md#source-c4d0797c5c94--6-shared-pipeline-一致性要求)
<a id="7-availableactioncatalog-修正"></a>
- [7. AvailableActionCatalog 修正](versions/v7/V7.9.md#source-c4d0797c5c94--7-availableactioncatalog-修正)
<a id="other_only"></a>
- [`other_only`](versions/v7/V7.9.md#source-c4d0797c5c94--other_only)
<a id="self_only"></a>
- [`self_only`](versions/v7/V7.9.md#source-c4d0797c5c94--self_only)
<a id="self_or_other"></a>
- [`self_or_other`](versions/v7/V7.9.md#source-c4d0797c5c94--self_or_other)
<a id="none"></a>
- [`none`](versions/v7/V7.9.md#source-c4d0797c5c94--none)
<a id="8-selector-输入要求"></a>
- [8. Selector 输入要求](versions/v7/V7.9.md#source-c4d0797c5c94--8-selector-输入要求)
<a id="9-validator-修正"></a>
- [9. Validator 修正](versions/v7/V7.9.md#source-c4d0797c5c94--9-validator-修正)
<a id="10-participant--reference-binding-修正"></a>
- [10. Participant / Reference Binding 修正](versions/v7/V7.9.md#source-c4d0797c5c94--10-participant--reference-binding-修正)
<a id="11-actioncheck-一致性"></a>
- [11. Action.check() 一致性](versions/v7/V7.9.md#source-c4d0797c5c94--11-actioncheck-一致性)
<a id="12-executor-要求"></a>
- [12. Executor 要求](versions/v7/V7.9.md#source-c4d0797c5c94--12-executor-要求)
<a id="13-p0-回归测试"></a>
- [13. P0 回归测试](versions/v7/V7.9.md#source-c4d0797c5c94--13-p0-回归测试)
<a id="131-self-target-必须通过"></a>
- [13.1 Self-target 必须通过](versions/v7/V7.9.md#source-c4d0797c5c94--131-self-target-必须通过)
<a id="132-默认禁止-self-target"></a>
- [13.2 默认禁止 self-target](versions/v7/V7.9.md#source-c4d0797c5c94--132-默认禁止-self-target)
<a id="133-非自身目标不受影响"></a>
- [13.3 非自身目标不受影响](versions/v7/V7.9.md#source-c4d0797c5c94--133-非自身目标不受影响)
<a id="14-selector-recall-回归样例"></a>
- [14. Selector Recall 回归样例](versions/v7/V7.9.md#source-c4d0797c5c94--14-selector-recall-回归样例)
<a id="setemotion"></a>
- [setEmotion](versions/v7/V7.9.md#source-c4d0797c5c94--setemotion)
<a id="isundressed"></a>
- [isUndressed](versions/v7/V7.9.md#source-c4d0797c5c94--isundressed)
<a id="payment"></a>
- [payment](versions/v7/V7.9.md#source-c4d0797c5c94--payment)
<a id="15-规格正式替换文本"></a>
- [15. 规格正式替换文本](versions/v7/V7.9.md#source-c4d0797c5c94--15-规格正式替换文本)
<a id="16-z1-architecture-freeze-影响"></a>
- [16. Z1 Architecture Freeze 影响](versions/v7/V7.9.md#source-c4d0797c5c94--16-z1-architecture-freeze-影响)
<a id="17-实施优先级"></a>
- [17. 实施优先级](versions/v7/V7.9.md#source-c4d0797c5c94--17-实施优先级)
<a id="p0--必须在-ae4-phase-1-前完成"></a>
- [P0 — 必须在 AE4 Phase 1 前完成](versions/v7/V7.9.md#source-c4d0797c5c94--p0--必须在-ae4-phase-1-前完成)
<a id="18-codex-实施要求"></a>
- [18. Codex 实施要求](versions/v7/V7.9.md#source-c4d0797c5c94--18-codex-实施要求)
<a id="19-验收标准"></a>
- [19. 验收标准](versions/v7/V7.9.md#source-c4d0797c5c94--19-验收标准)
<a id="20-最终架构原则"></a>
- [20. 最终架构原则](versions/v7/V7.9.md#source-c4d0797c5c94--20-最终架构原则)

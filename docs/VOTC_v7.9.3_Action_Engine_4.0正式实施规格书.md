<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V7.9 版本册](versions/v7/V7.9.md#source-bded76663a56)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-new-v793--action-engine-40-正式实施规格书"></a>
- [VOCT-NEW V7.9.3 — Action Engine 4.0 正式实施规格书](versions/v7/V7.9.md#source-bded76663a56--voct-new-v793--action-engine-40-正式实施规格书)
<a id="0-文档目的"></a>
- [0. 文档目的](versions/v7/V7.9.md#source-bded76663a56--0-文档目的)
<a id="1-ae30-失败结论与-ae40-设计目标"></a>
- [1. AE3.0 失败结论与 AE4.0 设计目标](versions/v7/V7.9.md#source-bded76663a56--1-ae30-失败结论与-ae40-设计目标)
<a id="11-ae30-实机问题结论"></a>
- [1.1 AE3.0 实机问题结论](versions/v7/V7.9.md#source-bded76663a56--11-ae30-实机问题结论)
<a id="12-ae40-核心原则"></a>
- [1.2 AE4.0 核心原则](versions/v7/V7.9.md#source-bded76663a56--12-ae40-核心原则)
<a id="2-已冻结架构决策"></a>
- [2. 已冻结架构决策](versions/v7/V7.9.md#source-bded76663a56--2-已冻结架构决策)
<a id="3-最终运行模式"></a>
- [3. 最终运行模式](versions/v7/V7.9.md#source-bded76663a56--3-最终运行模式)
<a id="4-engine-router-与-legacy-rollback"></a>
- [4. Engine Router 与 Legacy Rollback](versions/v7/V7.9.md#source-bded76663a56--4-engine-router-与-legacy-rollback)
<a id="41-顶层原则"></a>
- [4.1 顶层原则](versions/v7/V7.9.md#source-bded76663a56--41-顶层原则)
<a id="42-ae3-定位"></a>
- [4.2 AE3 定位](versions/v7/V7.9.md#source-bded76663a56--42-ae3-定位)
<a id="5-推荐目录结构"></a>
- [5. 推荐目录结构](versions/v7/V7.9.md#source-bded76663a56--5-推荐目录结构)
<a id="6-precision-40"></a>
- [6. Precision 4.0](versions/v7/V7.9.md#source-bded76663a56--6-precision-40)
<a id="61-最终调用链"></a>
- [6.1 最终调用链](versions/v7/V7.9.md#source-bded76663a56--61-最终调用链)
<a id="62-precision-主链禁止组件"></a>
- [6.2 Precision 主链禁止组件](versions/v7/V7.9.md#source-bded76663a56--62-precision-主链禁止组件)
<a id="63-precision-调用频率"></a>
- [6.3 Precision 调用频率](versions/v7/V7.9.md#source-bded76663a56--63-precision-调用频率)
<a id="7-p2-precision-context"></a>
- [7. P2 Precision Context](versions/v7/V7.9.md#source-bded76663a56--7-p2-precision-context)
<a id="8-c2-available-action-catalog"></a>
- [8. C2 Available Action Catalog](versions/v7/V7.9.md#source-bded76663a56--8-c2-available-action-catalog)
<a id="81-selector-前允许的-availability-check"></a>
- [8.1 Selector 前允许的 Availability Check](versions/v7/V7.9.md#source-bded76663a56--81-selector-前允许的-availability-check)
<a id="82-selector-前禁止的检查"></a>
- [8.2 Selector 前禁止的检查](versions/v7/V7.9.md#source-bded76663a56--82-selector-前禁止的检查)
<a id="83-t2-下的实现"></a>
- [8.3 T2 下的实现](versions/v7/V7.9.md#source-bded76663a56--83-t2-下的实现)
<a id="9-t2-cache-架构"></a>
- [9. T2 Cache 架构](versions/v7/V7.9.md#source-bded76663a56--9-t2-cache-架构)
<a id="91-stable-prefix"></a>
- [9.1 Stable Prefix](versions/v7/V7.9.md#source-bded76663a56--91-stable-prefix)
<a id="92-dynamic-tail"></a>
- [9.2 Dynamic Tail](versions/v7/V7.9.md#source-bded76663a56--92-dynamic-tail)
<a id="93-cache-telemetry"></a>
- [9.3 Cache Telemetry](versions/v7/V7.9.md#source-bded76663a56--93-cache-telemetry)
<a id="10-q2-structured-output"></a>
- [10. Q2 Structured Output](versions/v7/V7.9.md#source-bded76663a56--10-q2-structured-output)
<a id="101-confidence"></a>
- [10.1 Confidence](versions/v7/V7.9.md#source-bded76663a56--101-confidence)
<a id="102-evidence"></a>
- [10.2 Evidence](versions/v7/V7.9.md#source-bded76663a56--102-evidence)
<a id="11-action-selection-rules"></a>
- [11. Action Selection Rules](versions/v7/V7.9.md#source-bded76663a56--11-action-selection-rules)
<a id="12-k2-explicit-consent-pending"></a>
- [12. K2 Explicit Consent Pending](versions/v7/V7.9.md#source-bded76663a56--12-k2-explicit-consent-pending)
<a id="121-pending-仅用于需要-consent-的-action"></a>
- [12.1 Pending 仅用于需要 Consent 的 Action](versions/v7/V7.9.md#source-bded76663a56--121-pending-仅用于需要-consent-的-action)
<a id="122-pending-数据结构"></a>
- [12.2 Pending 数据结构](versions/v7/V7.9.md#source-bded76663a56--122-pending-数据结构)
<a id="123-pending-生命周期"></a>
- [12.3 Pending 生命周期](versions/v7/V7.9.md#source-bded76663a56--123-pending-生命周期)
<a id="124-pending-必须-mode-independent"></a>
- [12.4 Pending 必须 Mode-independent](versions/v7/V7.9.md#source-bded76663a56--124-pending-必须-mode-independent)
<a id="13-shared-validation-pipeline"></a>
- [13. Shared Validation Pipeline](versions/v7/V7.9.md#source-bded76663a56--13-shared-validation-pipeline)
<a id="14-actionproposalvalidator"></a>
- [14. ActionProposalValidator](versions/v7/V7.9.md#source-bded76663a56--14-actionproposalvalidator)
<a id="15-b3-actionbatchplanner"></a>
- [15. B3 ActionBatchPlanner](versions/v7/V7.9.md#source-bded76663a56--15-b3-actionbatchplanner)
<a id="151-默认行为"></a>
- [15.1 默认行为](versions/v7/V7.9.md#source-bded76663a56--151-默认行为)
<a id="152-明确依赖"></a>
- [15.2 明确依赖](versions/v7/V7.9.md#source-bded76663a56--152-明确依赖)
<a id="153-batchplanner-职责"></a>
- [15.3 BatchPlanner 职责](versions/v7/V7.9.md#source-bded76663a56--153-batchplanner-职责)
<a id="154-conflict"></a>
- [15.4 Conflict](versions/v7/V7.9.md#source-bded76663a56--154-conflict)
<a id="16-v2-action-metadata"></a>
- [16. V2 Action Metadata](versions/v7/V7.9.md#source-bded76663a56--16-v2-action-metadata)
<a id="17-performance-40"></a>
- [17. Performance 4.0](versions/v7/V7.9.md#source-bded76663a56--17-performance-40)
<a id="171-最终调用链"></a>
- [17.1 最终调用链](versions/v7/V7.9.md#source-bded76663a56--171-最终调用链)
<a id="18-l2-fast-resolver"></a>
- [18. L2 Fast Resolver](versions/v7/V7.9.md#source-bded76663a56--18-l2-fast-resolver)
<a id="181-hit-标准"></a>
- [18.1 HIT 标准](versions/v7/V7.9.md#source-bded76663a56--181-hit-标准)
<a id="182-executionformguard"></a>
- [18.2 ExecutionFormGuard](versions/v7/V7.9.md#source-bded76663a56--182-executionformguard)
<a id="183-relationship-本地规则"></a>
- [18.3 Relationship 本地规则](versions/v7/V7.9.md#source-bded76663a56--183-relationship-本地规则)
<a id="19-fallbackhintdetector"></a>
- [19. FallbackHintDetector](versions/v7/V7.9.md#source-bded76663a56--19-fallbackhintdetector)
<a id="20-compact-action-selector"></a>
- [20. Compact Action Selector](versions/v7/V7.9.md#source-bded76663a56--20-compact-action-selector)
<a id="21-social--opinion"></a>
- [21. Social / Opinion](versions/v7/V7.9.md#source-bded76663a56--21-social--opinion)
<a id="211-precision-direct-social"></a>
- [21.1 Precision Direct Social](versions/v7/V7.9.md#source-bded76663a56--211-precision-direct-social)
<a id="212-performance-direct-social"></a>
- [21.2 Performance Direct Social](versions/v7/V7.9.md#source-bded76663a56--212-performance-direct-social)
<a id="213-derived-social"></a>
- [21.3 Derived Social](versions/v7/V7.9.md#source-bded76663a56--213-derived-social)
<a id="22-o2-opinion-delta"></a>
- [22. O2 Opinion Delta](versions/v7/V7.9.md#source-bded76663a56--22-o2-opinion-delta)
<a id="23-d2-cause-aware-social-dedupe"></a>
- [23. D2 Cause-aware Social Dedupe](versions/v7/V7.9.md#source-bded76663a56--23-d2-cause-aware-social-dedupe)
<a id="24-e2-error-policy"></a>
- [24. E2 Error Policy](versions/v7/V7.9.md#source-bded76663a56--24-e2-error-policy)
<a id="241-transport-retry"></a>
- [24.1 Transport Retry](versions/v7/V7.9.md#source-bded76663a56--241-transport-retry)
<a id="242-structured-output-failure"></a>
- [24.2 Structured Output Failure](versions/v7/V7.9.md#source-bded76663a56--242-structured-output-failure)
<a id="243-invalid-action"></a>
- [24.3 Invalid Action](versions/v7/V7.9.md#source-bded76663a56--243-invalid-action)
<a id="244-target"></a>
- [24.4 Target](versions/v7/V7.9.md#source-bded76663a56--244-target)
<a id="245-arguments"></a>
- [24.5 Arguments](versions/v7/V7.9.md#source-bded76663a56--245-arguments)
<a id="246-pending"></a>
- [24.6 Pending](versions/v7/V7.9.md#source-bded76663a56--246-pending)
<a id="247-executor"></a>
- [24.7 Executor](versions/v7/V7.9.md#source-bded76663a56--247-executor)
<a id="25-m2-analytics"></a>
- [25. M2 Analytics](versions/v7/V7.9.md#source-bded76663a56--25-m2-analytics)
<a id="251-runtime-funnel"></a>
- [25.1 Runtime Funnel](versions/v7/V7.9.md#source-bded76663a56--251-runtime-funnel)
<a id="252-关键指标"></a>
- [25.2 关键指标](versions/v7/V7.9.md#source-bded76663a56--252-关键指标)
<a id="26-ground-truth-benchmark"></a>
- [26. Ground Truth Benchmark](versions/v7/V7.9.md#source-bded76663a56--26-ground-truth-benchmark)
<a id="27-p0-benchmark-actions"></a>
- [27. P0 Benchmark Actions](versions/v7/V7.9.md#source-bded76663a56--27-p0-benchmark-actions)
<a id="28-hard-release-metrics"></a>
- [28. Hard Release Metrics](versions/v7/V7.9.md#source-bded76663a56--28-hard-release-metrics)
<a id="precision"></a>
- [Precision](versions/v7/V7.9.md#source-bded76663a56--precision)
<a id="performance"></a>
- [Performance](versions/v7/V7.9.md#source-bded76663a56--performance)
<a id="29-p0-stop-the-line-blockers"></a>
- [29. P0 Stop-the-Line Blockers](versions/v7/V7.9.md#source-bded76663a56--29-p0-stop-the-line-blockers)
<a id="30-i2-七阶段实施计划"></a>
- [30. I2 七阶段实施计划](versions/v7/V7.9.md#source-bded76663a56--30-i2-七阶段实施计划)
<a id="phase-1--ae4-skeleton"></a>
- [Phase 1 — AE4 Skeleton](versions/v7/V7.9.md#source-bded76663a56--phase-1--ae4-skeleton)
<a id="gate"></a>
- [Gate](versions/v7/V7.9.md#source-bded76663a56--gate)
<a id="phase-2--shared-proposal--execution-pipeline"></a>
- [Phase 2 — Shared Proposal → Execution Pipeline](versions/v7/V7.9.md#source-bded76663a56--phase-2--shared-proposal--execution-pipeline)
<a id="gate-1"></a>
- [Gate](versions/v7/V7.9.md#source-bded76663a56--gate-1)
<a id="phase-3--precision-40"></a>
- [Phase 3 — Precision 4.0](versions/v7/V7.9.md#source-bded76663a56--phase-3--precision-40)
<a id="gate-2"></a>
- [Gate](versions/v7/V7.9.md#source-bded76663a56--gate-2)
<a id="phase-4--pending--consent"></a>
- [Phase 4 — Pending / Consent](versions/v7/V7.9.md#source-bded76663a56--phase-4--pending--consent)
<a id="gate-3"></a>
- [Gate](versions/v7/V7.9.md#source-bded76663a56--gate-3)
<a id="phase-5--performance-40"></a>
- [Phase 5 — Performance 4.0](versions/v7/V7.9.md#source-bded76663a56--phase-5--performance-40)
<a id="gate-4"></a>
- [Gate](versions/v7/V7.9.md#source-bded76663a56--gate-4)
<a id="phase-6--social--opinion"></a>
- [Phase 6 — Social / Opinion](versions/v7/V7.9.md#source-bded76663a56--phase-6--social--opinion)
<a id="gate-5"></a>
- [Gate](versions/v7/V7.9.md#source-bded76663a56--gate-5)
<a id="phase-7--full-benchmark--real-ck3-acceptance"></a>
- [Phase 7 — Full Benchmark + Real CK3 Acceptance](versions/v7/V7.9.md#source-bded76663a56--phase-7--full-benchmark--real-ck3-acceptance)
<a id="31-codex-实施约束"></a>
- [31. Codex 实施约束](versions/v7/V7.9.md#source-bded76663a56--31-codex-实施约束)
<a id="32-架构冻结后的修改规则"></a>
- [32. 架构冻结后的修改规则](versions/v7/V7.9.md#source-bded76663a56--32-架构冻结后的修改规则)
<a id="允许修改"></a>
- [允许修改](versions/v7/V7.9.md#source-bded76663a56--允许修改)
<a id="禁止随意修改"></a>
- [禁止随意修改](versions/v7/V7.9.md#source-bded76663a56--禁止随意修改)
<a id="33-最终架构摘要"></a>
- [33. 最终架构摘要](versions/v7/V7.9.md#source-bded76663a56--33-最终架构摘要)
<a id="34-v793-最终目标"></a>
- [34. V7.9.3 最终目标](versions/v7/V7.9.md#source-bded76663a56--34-v793-最终目标)

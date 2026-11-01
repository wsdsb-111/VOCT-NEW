<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.3 版本册](../../versions/v9/V9.3.md#source-39beb7bf63e7)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-v93--provider-platform-详细设计与施工方案"></a>
- [VOCT V9.3 — Provider Platform 详细设计与施工方案](../../versions/v9/V9.3.md#source-39beb7bf63e7--voct-v93--provider-platform-详细设计与施工方案)
<a id="0-一页执行摘要"></a>
- [0. 一页执行摘要](../../versions/v9/V9.3.md#source-39beb7bf63e7--0-一页执行摘要)
<a id="01-本阶段要解决的问题"></a>
- [0.1 本阶段要解决的问题](../../versions/v9/V9.3.md#source-39beb7bf63e7--01-本阶段要解决的问题)
<a id="02-v923-基线不可回归"></a>
- [0.2 V9.2.3 基线——不可回归](../../versions/v9/V9.3.md#source-39beb7bf63e7--02-v923-基线不可回归)
<a id="03-不做防止阶段偏离"></a>
- [0.3 不做（防止阶段偏离）](../../versions/v9/V9.3.md#source-39beb7bf63e7--03-不做防止阶段偏离)
<a id="1-核验过的项目现状及源文件地图"></a>
- [1. 核验过的项目现状及源文件地图](../../versions/v9/V9.3.md#source-39beb7bf63e7--1-核验过的项目现状及源文件地图)
<a id="11-权威源码与验证入口"></a>
- [1.1 权威源码与验证入口](../../versions/v9/V9.3.md#source-39beb7bf63e7--11-权威源码与验证入口)
<a id="12-当前不是空白工程"></a>
- [1.2 当前不是空白工程](../../versions/v9/V9.3.md#source-39beb7bf63e7--12-当前不是空白工程)
<a id="13-需重点验证的现有差异审查发现尚不等于已复现故障"></a>
- [1.3 需重点验证的现有差异（审查发现，尚不等于已复现故障）](../../versions/v9/V9.3.md#source-39beb7bf63e7--13-需重点验证的现有差异审查发现尚不等于已复现故障)
<a id="2-v93-架构与职责边界"></a>
- [2. V9.3 架构与职责边界](../../versions/v9/V9.3.md#source-39beb7bf63e7--2-v93-架构与职责边界)
<a id="21-目标依赖"></a>
- [2.1 目标依赖](../../versions/v9/V9.3.md#source-39beb7bf63e7--21-目标依赖)
<a id="22-迁移模式strangleradapter-first"></a>
- [2.2 迁移模式：Strangler/Adapter First](../../versions/v9/V9.3.md#source-39beb7bf63e7--22-迁移模式strangleradapter-first)
<a id="23-推荐新增模块建议路径不是已存在文件"></a>
- [2.3 推荐新增模块（建议路径，不是已存在文件）](../../versions/v9/V9.3.md#source-39beb7bf63e7--23-推荐新增模块建议路径不是已存在文件)
<a id="3-providercapability-合同wp-核心"></a>
- [3. ProviderCapability 合同（WP 核心）](../../versions/v9/V9.3.md#source-39beb7bf63e7--3-providercapability-合同wp-核心)
<a id="31-语义要求"></a>
- [3.1 语义要求](../../versions/v9/V9.3.md#source-39beb7bf63e7--31-语义要求)
<a id="32-建议-dto接口示例实施前以冻结测试定稿"></a>
- [3.2 建议 DTO（接口示例，实施前以冻结测试定稿）](../../versions/v9/V9.3.md#source-39beb7bf63e7--32-建议-dto接口示例实施前以冻结测试定稿)
<a id="33-capabilities-缓存键与失效"></a>
- [3.3 Capabilities 缓存键与失效](../../versions/v9/V9.3.md#source-39beb7bf63e7--33-capabilities-缓存键与失效)
<a id="34-七种-provider-能力审计表施工待填表模板"></a>
- [3.4 七种 Provider 能力审计表（施工待填表模板）](../../versions/v9/V9.3.md#source-39beb7bf63e7--34-七种-provider-能力审计表施工待填表模板)
<a id="4-统一-request--result--stream-合同"></a>
- [4. 统一 Request / Result / Stream 合同](../../versions/v9/V9.3.md#source-39beb7bf63e7--4-统一-request--result--stream-合同)
<a id="41-providerrequest"></a>
- [4.1 ProviderRequest](../../versions/v9/V9.3.md#source-39beb7bf63e7--41-providerrequest)
<a id="42-统一非流式-providerresult示例"></a>
- [4.2 统一非流式 ProviderResult（示例）](../../versions/v9/V9.3.md#source-39beb7bf63e7--42-统一非流式-providerresult示例)
<a id="43-stream-生命周期"></a>
- [4.3 Stream 生命周期](../../versions/v9/V9.3.md#source-39beb7bf63e7--43-stream-生命周期)
<a id="44-特殊流式场景"></a>
- [4.4 特殊流式场景](../../versions/v9/V9.3.md#source-39beb7bf63e7--44-特殊流式场景)
<a id="5-structured-output--action--summary-conformance"></a>
- [5. Structured Output / Action / Summary Conformance](../../versions/v9/V9.3.md#source-39beb7bf63e7--5-structured-output--action--summary-conformance)
<a id="51-明确交付模式"></a>
- [5.1 明确交付模式](../../versions/v9/V9.3.md#source-39beb7bf63e7--51-明确交付模式)
<a id="52-厂商差异不能抹平"></a>
- [5.2 厂商差异不能抹平](../../versions/v9/V9.3.md#source-39beb7bf63e7--52-厂商差异不能抹平)
<a id="53-schema-验证失败处理"></a>
- [5.3 Schema 验证失败处理](../../versions/v9/V9.3.md#source-39beb7bf63e7--53-schema-验证失败处理)
<a id="6-usage--reasoning--finishreason-的真实性"></a>
- [6. Usage / Reasoning / FinishReason 的真实性](../../versions/v9/V9.3.md#source-39beb7bf63e7--6-usage--reasoning--finishreason-的真实性)
<a id="61-usage-双通道"></a>
- [6.1 Usage 双通道](../../versions/v9/V9.3.md#source-39beb7bf63e7--61-usage-双通道)
<a id="62-required-usage-rules"></a>
- [6.2 Required Usage Rules](../../versions/v9/V9.3.md#source-39beb7bf63e7--62-required-usage-rules)
<a id="63-finishreason-归一化建议"></a>
- [6.3 FinishReason 归一化建议](../../versions/v9/V9.3.md#source-39beb7bf63e7--63-finishreason-归一化建议)
<a id="64-推理内容与隐私"></a>
- [6.4 推理内容与隐私](../../versions/v9/V9.3.md#source-39beb7bf63e7--64-推理内容与隐私)
<a id="7-取消超时重试与成本边界"></a>
- [7. 取消、超时、重试与成本边界](../../versions/v9/V9.3.md#source-39beb7bf63e7--7-取消超时重试与成本边界)
<a id="71-必须跨越完整生命周期的取消"></a>
- [7.1 必须跨越完整生命周期的取消](../../versions/v9/V9.3.md#source-39beb7bf63e7--71-必须跨越完整生命周期的取消)
<a id="72-timeout-分层"></a>
- [7.2 Timeout 分层](../../versions/v9/V9.3.md#source-39beb7bf63e7--72-timeout-分层)
<a id="73-retry-策略"></a>
- [7.3 Retry 策略](../../versions/v9/V9.3.md#source-39beb7bf63e7--73-retry-策略)
<a id="74-error-code-稳定-dto"></a>
- [7.4 Error Code 稳定 DTO](../../versions/v9/V9.3.md#source-39beb7bf63e7--74-error-code-稳定-dto)
<a id="8-施工工作包wp-00--wp-11"></a>
- [8. 施工工作包（WP-00 ～ WP-11）](../../versions/v9/V9.3.md#source-39beb7bf63e7--8-施工工作包wp-00--wp-11)
<a id="wp-00冻结-v923-基线和范围p0"></a>
- [WP-00：冻结 V9.2.3 基线和范围（P0）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-00冻结-v923-基线和范围p0)
<a id="wp-01provider-现状盘点与能力证据p1"></a>
- [WP-01：Provider 现状盘点与能力证据（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-01provider-现状盘点与能力证据p1)
<a id="wp-02capabilitiesregistry-合同p1"></a>
- [WP-02：Capabilities/Registry 合同（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-02capabilitiesregistry-合同p1)
<a id="wp-03统一-generation-result-与-finishreasonp1"></a>
- [WP-03：统一 Generation Result 与 FinishReason（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-03统一-generation-result-与-finishreasonp1)
<a id="wp-04usage--reasoning-provenancep1"></a>
- [WP-04：Usage / Reasoning Provenance（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-04usage--reasoning-provenancep1)
<a id="wp-05非流式--流式-conformancep1"></a>
- [WP-05：非流式 / 流式 Conformance（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-05非流式--流式-conformancep1)
<a id="wp-06structured-output-与严格本地验证p1"></a>
- [WP-06：Structured Output 与严格本地验证（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-06structured-output-与严格本地验证p1)
<a id="wp-07cancel--deadline--backoff--errorp1"></a>
- [WP-07：Cancel / Deadline / Backoff / Error（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-07cancel--deadline--backoff--errorp1)
<a id="wp-08七-provider-adapter-分批迁移p1"></a>
- [WP-08：七 Provider Adapter 分批迁移（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-08七-provider-adapter-分批迁移p1)
<a id="wp-09隐私诊断及成本上限p1p2"></a>
- [WP-09：隐私、诊断及成本上限（P1/P2）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-09隐私诊断及成本上限p1p2)
<a id="wp-10系统集成数据安全回归p0"></a>
- [WP-10：系统集成/数据安全回归（P0）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-10系统集成数据安全回归p0)
<a id="wp-11ci发布与-v94-handoffp1"></a>
- [WP-11：CI、发布与 V9.4 Handoff（P1）](../../versions/v9/V9.3.md#source-39beb7bf63e7--wp-11ci发布与-v94-handoffp1)
<a id="9-推荐-commit-分组适合-codex-desktop"></a>
- [9. 推荐 Commit 分组（适合 Codex Desktop）](../../versions/v9/V9.3.md#source-39beb7bf63e7--9-推荐-commit-分组适合-codex-desktop)
<a id="10-provider-conformance-测试矩阵"></a>
- [10. Provider Conformance 测试矩阵](../../versions/v9/V9.3.md#source-39beb7bf63e7--10-provider-conformance-测试矩阵)
<a id="101-基础功能每-provider可用模型"></a>
- [10.1 基础功能（每 Provider/可用模型）](../../versions/v9/V9.3.md#source-39beb7bf63e7--101-基础功能每-provider可用模型)
<a id="102-异常与成本跨-adapter按-route"></a>
- [10.2 异常与成本（跨 Adapter，按 route）](../../versions/v9/V9.3.md#source-39beb7bf63e7--102-异常与成本跨-adapter按-route)
<a id="103-既有回归必须复用"></a>
- [10.3 既有回归必须复用](../../versions/v9/V9.3.md#source-39beb7bf63e7--103-既有回归必须复用)
<a id="11-golden-fixturemock-server在线验收"></a>
- [11. Golden Fixture、Mock Server、在线验收](../../versions/v9/V9.3.md#source-39beb7bf63e7--11-golden-fixturemock-server在线验收)
<a id="111-golden-fixture"></a>
- [11.1 Golden Fixture](../../versions/v9/V9.3.md#source-39beb7bf63e7--111-golden-fixture)
<a id="112-mock-transport"></a>
- [11.2 Mock Transport](../../versions/v9/V9.3.md#source-39beb7bf63e7--112-mock-transport)
<a id="113-真实-api-对照原则"></a>
- [11.3 真实 API 对照原则](../../versions/v9/V9.3.md#source-39beb7bf63e7--113-真实-api-对照原则)
<a id="12-p-级风险与处置"></a>
- [12. P 级风险与处置](../../versions/v9/V9.3.md#source-39beb7bf63e7--12-p-级风险与处置)
<a id="13-发布-gate-与量化验收"></a>
- [13. 发布 Gate 与量化验收](../../versions/v9/V9.3.md#source-39beb7bf63e7--13-发布-gate-与量化验收)
<a id="g0版本与证据"></a>
- [G0：版本与证据](../../versions/v9/V9.3.md#source-39beb7bf63e7--g0版本与证据)
<a id="g1capabilities"></a>
- [G1：Capabilities](../../versions/v9/V9.3.md#source-39beb7bf63e7--g1capabilities)
<a id="g2resultusagereasoning"></a>
- [G2：Result/Usage/Reasoning](../../versions/v9/V9.3.md#source-39beb7bf63e7--g2resultusagereasoning)
<a id="g3structuredabortretry"></a>
- [G3：Structured/Abort/Retry](../../versions/v9/V9.3.md#source-39beb7bf63e7--g3structuredabortretry)
<a id="g4业务一致性"></a>
- [G4：业务一致性](../../versions/v9/V9.3.md#source-39beb7bf63e7--g4业务一致性)
<a id="g5构建ci"></a>
- [G5：构建/CI](../../versions/v9/V9.3.md#source-39beb7bf63e7--g5构建ci)
<a id="g6真实实机与支持范围"></a>
- [G6：真实实机与支持范围](../../versions/v9/V9.3.md#source-39beb7bf63e7--g6真实实机与支持范围)
<a id="g7冻结与移交"></a>
- [G7：冻结与移交](../../versions/v9/V9.3.md#source-39beb7bf63e7--g7冻结与移交)
<a id="14-回滚方案与失效处理"></a>
- [14. 回滚方案与失效处理](../../versions/v9/V9.3.md#source-39beb7bf63e7--14-回滚方案与失效处理)
<a id="15-提交给-codex-的执行指令"></a>
- [15. 提交给 Codex 的执行指令](../../versions/v9/V9.3.md#source-39beb7bf63e7--15-提交给-codex-的执行指令)
<a id="16-资料索引与事实边界"></a>
- [16. 资料索引与事实边界](../../versions/v9/V9.3.md#source-39beb7bf63e7--16-资料索引与事实边界)

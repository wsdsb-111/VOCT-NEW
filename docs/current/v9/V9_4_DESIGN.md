<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.4 版本册](../../versions/v9/V9.4.md#source-48186db0daf2)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-v94--promptplan--cache-详细设计开发文档"></a>
- [VOCT V9.4 — PromptPlan & Cache 详细设计开发文档](../../versions/v9/V9.4.md#source-48186db0daf2--voct-v94--promptplan--cache-详细设计开发文档)
<a id="0-执行决策与完成定义"></a>
- [0. 执行决策与完成定义](../../versions/v9/V9.4.md#source-48186db0daf2--0-执行决策与完成定义)
<a id="01-不在-v94-开发的内容"></a>
- [0.1 不在 V9.4 开发的内容](../../versions/v9/V9.4.md#source-48186db0daf2--01-不在-v94-开发的内容)
<a id="1-审查基线已经有的能力与缺口"></a>
- [1. 审查基线：已经有的能力与缺口](../../versions/v9/V9.4.md#source-48186db0daf2--1-审查基线已经有的能力与缺口)
<a id="11-当前审查尚未证明的内容"></a>
- [1.1 当前审查尚未证明的内容](../../versions/v9/V9.4.md#source-48186db0daf2--11-当前审查尚未证明的内容)
<a id="2-目标架构从来源事实到有效出站请求"></a>
- [2. 目标架构：从来源事实到有效出站请求](../../versions/v9/V9.4.md#source-48186db0daf2--2-目标架构从来源事实到有效出站请求)
<a id="21-不可破坏的执行顺序"></a>
- [2.1 不可破坏的执行顺序](../../versions/v9/V9.4.md#source-48186db0daf2--21-不可破坏的执行顺序)
<a id="3-promptplan-v9-数据合同"></a>
- [3. PromptPlan V9 数据合同](../../versions/v9/V9.4.md#source-48186db0daf2--3-promptplan-v9-数据合同)
<a id="31-顶层-plan"></a>
- [3.1 顶层 Plan](../../versions/v9/V9.4.md#source-48186db0daf2--31-顶层-plan)
<a id="32-单个语义块-promptblock"></a>
- [3.2 单个语义块 `PromptBlock`](../../versions/v9/V9.4.md#source-48186db0daf2--32-单个语义块-promptblock)
<a id="33-不变量"></a>
- [3.3 不变量](../../versions/v9/V9.4.md#source-48186db0daf2--33-不变量)
<a id="4-七类-prompt-语义块与生命周期规则"></a>
- [4. 七类 Prompt 语义块与生命周期规则](../../versions/v9/V9.4.md#source-48186db0daf2--4-七类-prompt-语义块与生命周期规则)
<a id="41-兼容规则"></a>
- [4.1 兼容规则](../../versions/v9/V9.4.md#source-48186db0daf2--41-兼容规则)
<a id="5-与既有-v9393-生产路径的兼容迁移"></a>
- [5. 与既有 V9.3.9.3 生产路径的兼容迁移](../../versions/v9/V9.4.md#source-48186db0daf2--5-与既有-v9393-生产路径的兼容迁移)
<a id="51-首先冻结原始行为"></a>
- [5.1 首先冻结原始行为](../../versions/v9/V9.4.md#source-48186db0daf2--51-首先冻结原始行为)
<a id="52-旧布局映射表"></a>
- [5.2 旧布局映射表](../../versions/v9/V9.4.md#source-48186db0daf2--52-旧布局映射表)
<a id="53-用户配置和数据零迁移"></a>
- [5.3 用户配置和数据零迁移](../../versions/v9/V9.4.md#source-48186db0daf2--53-用户配置和数据零迁移)
<a id="6-planbuilderlayoutpolicy-与-serializer-的边界"></a>
- [6. PlanBuilder、LayoutPolicy 与 Serializer 的边界](../../versions/v9/V9.4.md#source-48186db0daf2--6-planbuilderlayoutpolicy-与-serializer-的边界)
<a id="61-建议新建的主模块"></a>
- [6.1 建议新建的主模块](../../versions/v9/V9.4.md#source-48186db0daf2--61-建议新建的主模块)
<a id="62-输入输出接口建议"></a>
- [6.2 输入/输出接口建议](../../versions/v9/V9.4.md#source-48186db0daf2--62-输入输出接口建议)
<a id="63-serializer-必须是确定性纯函数"></a>
- [6.3 Serializer 必须是确定性纯函数](../../versions/v9/V9.4.md#source-48186db0daf2--63-serializer-必须是确定性纯函数)
<a id="64-全部请求类型的接入边界"></a>
- [6.4 全部请求类型的接入边界](../../versions/v9/V9.4.md#source-48186db0daf2--64-全部请求类型的接入边界)
<a id="7-稳定前缀设计与冻结语义"></a>
- [7. 稳定前缀设计与冻结语义](../../versions/v9/V9.4.md#source-48186db0daf2--7-稳定前缀设计与冻结语义)
<a id="71-三个不同的指纹"></a>
- [7.1 三个不同的指纹](../../versions/v9/V9.4.md#source-48186db0daf2--71-三个不同的指纹)
<a id="72-可复用前缀计算原则"></a>
- [7.2 “可复用前缀”计算原则](../../versions/v9/V9.4.md#source-48186db0daf2--72-可复用前缀计算原则)
<a id="73-版本化失效矩阵"></a>
- [7.3 版本化失效矩阵](../../versions/v9/V9.4.md#source-48186db0daf2--73-版本化失效矩阵)
<a id="74-成功后冻结保留-v939-语义"></a>
- [7.4 成功后冻结（保留 V9.3.9 语义）](../../versions/v9/V9.4.md#source-48186db0daf2--74-成功后冻结保留-v939-语义)
<a id="8-token-预算历史窗口与压缩策略"></a>
- [8. Token 预算、历史窗口与压缩策略](../../versions/v9/V9.4.md#source-48186db0daf2--8-token-预算历史窗口与压缩策略)
<a id="81-单一预算合同"></a>
- [8.1 单一预算合同](../../versions/v9/V9.4.md#source-48186db0daf2--81-单一预算合同)
<a id="82-预算字段分层"></a>
- [8.2 预算字段分层](../../versions/v9/V9.4.md#source-48186db0daf2--82-预算字段分层)
<a id="83-超额与退化策略"></a>
- [8.3 超额与退化策略](../../versions/v9/V9.4.md#source-48186db0daf2--83-超额与退化策略)
<a id="9-缓存诊断-v2原生事实与本地推断严格分开"></a>
- [9. 缓存诊断 V2：原生事实与本地推断严格分开](../../versions/v9/V9.4.md#source-48186db0daf2--9-缓存诊断-v2原生事实与本地推断严格分开)
<a id="91-设计目标"></a>
- [9.1 设计目标](../../versions/v9/V9.4.md#source-48186db0daf2--91-设计目标)
<a id="92-观测数据结构拟新增"></a>
- [9.2 观测数据结构（拟新增）](../../versions/v9/V9.4.md#source-48186db0daf2--92-观测数据结构拟新增)
<a id="93-四类缓存数据必须独立展示"></a>
- [9.3 四类缓存数据必须独立展示](../../versions/v9/V9.4.md#source-48186db0daf2--93-四类缓存数据必须独立展示)
<a id="94-修复首个未命中归因的表达问题"></a>
- [9.4 修复“首个未命中归因”的表达问题](../../versions/v9/V9.4.md#source-48186db0daf2--94-修复首个未命中归因的表达问题)
<a id="95-聚合规则"></a>
- [9.5 聚合规则](../../versions/v9/V9.4.md#source-48186db0daf2--95-聚合规则)
<a id="96-诊断入口与-ui-范围"></a>
- [9.6 诊断入口与 UI 范围](../../versions/v9/V9.4.md#source-48186db0daf2--96-诊断入口与-ui-范围)
<a id="10-安全隐私权限与并发保护"></a>
- [10. 安全、隐私、权限与并发保护](../../versions/v9/V9.4.md#source-48186db0daf2--10-安全隐私权限与并发保护)
<a id="101-核心权限红线出现任一即-p0"></a>
- [10.1 核心权限红线（出现任一即 P0）](../../versions/v9/V9.4.md#source-48186db0daf2--101-核心权限红线出现任一即-p0)
<a id="102-发送前复核与竞态处理"></a>
- [10.2 发送前复核与竞态处理](../../versions/v9/V9.4.md#source-48186db0daf2--102-发送前复核与竞态处理)
<a id="103-日志与诊断的安全标准"></a>
- [10.3 日志与诊断的安全标准](../../versions/v9/V9.4.md#source-48186db0daf2--103-日志与诊断的安全标准)
<a id="11-性能目标与真实-provider-ab-方案"></a>
- [11. 性能目标与真实 Provider A/B 方案](../../versions/v9/V9.4.md#source-48186db0daf2--11-性能目标与真实-provider-ab-方案)
<a id="111-离线性能"></a>
- [11.1 离线性能](../../versions/v9/V9.4.md#source-48186db0daf2--111-离线性能)
<a id="112-受控真实-provider-测试"></a>
- [11.2 受控真实 Provider 测试](../../versions/v9/V9.4.md#source-48186db0daf2--112-受控真实-provider-测试)
<a id="113-保守的收益判据"></a>
- [11.3 保守的收益判据](../../versions/v9/V9.4.md#source-48186db0daf2--113-保守的收益判据)
<a id="12-工作包与施工顺序同一个-v94-版本内完成"></a>
- [12. 工作包与施工顺序（**同一个 V9.4 版本内完成**）](../../versions/v9/V9.4.md#source-48186db0daf2--12-工作包与施工顺序同一个-v94-版本内完成)
<a id="wp-a冻结基线与风险清单"></a>
- [WP-A：冻结基线与风险清单](../../versions/v9/V9.4.md#source-48186db0daf2--wp-a冻结基线与风险清单)
<a id="wp-bpromptplan-合同和布局映射"></a>
- [WP-B：PromptPlan 合同和布局映射](../../versions/v9/V9.4.md#source-48186db0daf2--wp-bpromptplan-合同和布局映射)
<a id="wp-c最终-serializer--provider-接入--请求预算"></a>
- [WP-C：最终 Serializer / Provider 接入 / 请求预算](../../versions/v9/V9.4.md#source-48186db0daf2--wp-c最终-serializer--provider-接入--请求预算)
<a id="wp-d冻结前缀来源失效闭环"></a>
- [WP-D：冻结、前缀、来源失效闭环](../../versions/v9/V9.4.md#source-48186db0daf2--wp-d冻结前缀来源失效闭环)
<a id="wp-ecache-diagnostics-v2"></a>
- [WP-E：Cache Diagnostics V2](../../versions/v9/V9.4.md#source-48186db0daf2--wp-ecache-diagnostics-v2)
<a id="wp-f完整回归灰度开关真实安装验证文档收口"></a>
- [WP-F：完整回归、灰度开关、真实安装验证、文档收口](../../versions/v9/V9.4.md#source-48186db0daf2--wp-f完整回归灰度开关真实安装验证文档收口)
<a id="13-施工文件清单与改动边界"></a>
- [13. 施工文件清单与改动边界](../../versions/v9/V9.4.md#source-48186db0daf2--13-施工文件清单与改动边界)
<a id="14-测试矩阵与硬门槛"></a>
- [14. 测试矩阵与硬门槛](../../versions/v9/V9.4.md#source-48186db0daf2--14-测试矩阵与硬门槛)
<a id="141-必做专项建议对应独立测试脚本"></a>
- [14.1 必做专项（建议对应独立测试脚本）](../../versions/v9/V9.4.md#source-48186db0daf2--141-必做专项建议对应独立测试脚本)
<a id="142-golden-必备场景至少"></a>
- [14.2 Golden 必备场景（至少）](../../versions/v9/V9.4.md#source-48186db0daf2--142-golden-必备场景至少)
<a id="143-windows-发行-cold-start-gate新硬门槛"></a>
- [14.3 Windows 发行 Cold-start Gate（新硬门槛）](../../versions/v9/V9.4.md#source-48186db0daf2--143-windows-发行-cold-start-gate新硬门槛)
<a id="144-门禁分层与签署要求"></a>
- [14.4 门禁分层与签署要求](../../versions/v9/V9.4.md#source-48186db0daf2--144-门禁分层与签署要求)
<a id="15-回滚灾难恢复与发布安全"></a>
- [15. 回滚、灾难恢复与发布安全](../../versions/v9/V9.4.md#source-48186db0daf2--15-回滚灾难恢复与发布安全)
<a id="151-安全切换策略"></a>
- [15.1 安全切换策略](../../versions/v9/V9.4.md#source-48186db0daf2--151-安全切换策略)
<a id="152-灾难信号与立即响应"></a>
- [15.2 灾难信号与立即响应](../../versions/v9/V9.4.md#source-48186db0daf2--152-灾难信号与立即响应)
<a id="16-建议生成的施工交付物"></a>
- [16. 建议生成的施工交付物](../../versions/v9/V9.4.md#source-48186db0daf2--16-建议生成的施工交付物)
<a id="161-建议执行命令以施工时-head-为准"></a>
- [16.1 建议执行命令（以施工时 HEAD 为准）](../../versions/v9/V9.4.md#source-48186db0daf2--161-建议执行命令以施工时-head-为准)
<a id="17-给-codex-的最终执行约束"></a>
- [17. 给 Codex 的最终执行约束](../../versions/v9/V9.4.md#source-48186db0daf2--17-给-codex-的最终执行约束)
<a id="18-v94--v95-移交边界"></a>
- [18. V9.4 → V9.5 移交边界](../../versions/v9/V9.4.md#source-48186db0daf2--18-v94--v95-移交边界)
<a id="19-资料来源与证据边界"></a>
- [19. 资料来源与证据边界](../../versions/v9/V9.4.md#source-48186db0daf2--19-资料来源与证据边界)
<a id="191-用户已提供的路线基线"></a>
- [19.1 用户已提供的路线基线](../../versions/v9/V9.4.md#source-48186db0daf2--191-用户已提供的路线基线)
<a id="192-仓库审查入口2026-10-20"></a>
- [19.2 仓库审查入口（2026-10-20）](../../versions/v9/V9.4.md#source-48186db0daf2--192-仓库审查入口2026-10-20)
<a id="193-来源与建议的区分"></a>
- [19.3 来源与建议的区分](../../versions/v9/V9.4.md#source-48186db0daf2--193-来源与建议的区分)

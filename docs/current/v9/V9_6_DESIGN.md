<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V9.6 版本册](../../versions/v9/V9.6.md#source-13b6b164baaf)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="voct-v96-设计开发文档bridge-协议跨版本兼容与用户体验治理"></a>
- [VOCT V9.6 设计开发文档：Bridge 协议、跨版本兼容与用户体验治理](../../versions/v9/V9.6.md#source-13b6b164baaf--voct-v96-设计开发文档bridge-协议跨版本兼容与用户体验治理)
<a id="0-执行摘要与最终决策"></a>
- [0. 执行摘要与最终决策](../../versions/v9/V9.6.md#source-13b6b164baaf--0-执行摘要与最终决策)
<a id="01-已确定的架构决策"></a>
- [0.1 已确定的架构决策](../../versions/v9/V9.6.md#source-13b6b164baaf--01-已确定的架构决策)
<a id="02-对旧探索方案的覆盖"></a>
- [0.2 对旧探索方案的覆盖](../../versions/v9/V9.6.md#source-13b6b164baaf--02-对旧探索方案的覆盖)
<a id="1-目标范围与非目标"></a>
- [1. 目标、范围与非目标](../../versions/v9/V9.6.md#source-13b6b164baaf--1-目标范围与非目标)
<a id="11-完成后必须能回答的问题"></a>
- [1.1 完成后必须能回答的问题](../../versions/v9/V9.6.md#source-13b6b164baaf--11-完成后必须能回答的问题)
<a id="12-v96-范围"></a>
- [1.2 V9.6 范围](../../versions/v9/V9.6.md#source-13b6b164baaf--12-v96-范围)
<a id="13-明确不做"></a>
- [1.3 明确不做](../../versions/v9/V9.6.md#source-13b6b164baaf--13-明确不做)
<a id="2-当前技术基线"></a>
- [2. 当前技术基线](../../versions/v9/V9.6.md#source-13b6b164baaf--2-当前技术基线)
<a id="21-版本分层"></a>
- [2.1 版本分层](../../versions/v9/V9.6.md#source-13b6b164baaf--21-版本分层)
<a id="22-已确认的源码盘点"></a>
- [2.2 已确认的源码盘点](../../versions/v9/V9.6.md#source-13b6b164baaf--22-已确认的源码盘点)
<a id="23-当前通信链路"></a>
- [2.3 当前通信链路](../../versions/v9/V9.6.md#source-13b6b164baaf--23-当前通信链路)
<a id="24-必须保持的安全不变量"></a>
- [2.4 必须保持的安全不变量](../../versions/v9/V9.6.md#source-13b6b164baaf--24-必须保持的安全不变量)
<a id="3-目标架构与源码边界"></a>
- [3. 目标架构与源码边界](../../versions/v9/V9.6.md#source-13b6b164baaf--3-目标架构与源码边界)
<a id="31-目标目录"></a>
- [3.1 目标目录](../../versions/v9/V9.6.md#source-13b6b164baaf--31-目标目录)
<a id="32-源码和构建要求"></a>
- [3.2 源码和构建要求](../../versions/v9/V9.6.md#source-13b6b164baaf--32-源码和构建要求)
<a id="33-组件职责"></a>
- [3.3 组件职责](../../versions/v9/V9.6.md#source-13b6b164baaf--33-组件职责)
<a id="4-bridge-协议与-hello"></a>
- [4. Bridge 协议与 Hello](../../versions/v9/V9.6.md#source-13b6b164baaf--4-bridge-协议与-hello)
<a id="41-设计原则"></a>
- [4.1 设计原则](../../versions/v9/V9.6.md#source-13b6b164baaf--41-设计原则)
<a id="42-只读-hello"></a>
- [4.2 只读 Hello](../../versions/v9/V9.6.md#source-13b6b164baaf--42-只读-hello)
<a id="43-时序与会话绑定"></a>
- [4.3 时序与会话绑定](../../versions/v9/V9.6.md#source-13b6b164baaf--43-时序与会话绑定)
<a id="44-v96-暂不实现主动-probe"></a>
- [4.4 V9.6 暂不实现主动 Probe](../../versions/v9/V9.6.md#source-13b6b164baaf--44-v96-暂不实现主动-probe)
<a id="5-版本manifest-与能力协商"></a>
- [5. 版本、Manifest 与能力协商](../../versions/v9/V9.6.md#source-13b6b164baaf--5-版本manifest-与能力协商)
<a id="51-版本分层"></a>
- [5.1 版本分层](../../versions/v9/V9.6.md#source-13b6b164baaf--51-版本分层)
<a id="52-manifest-结构示例"></a>
- [5.2 Manifest 结构示例](../../versions/v9/V9.6.md#source-13b6b164baaf--52-manifest-结构示例)
<a id="53-能力清单"></a>
- [5.3 能力清单](../../versions/v9/V9.6.md#source-13b6b164baaf--53-能力清单)
<a id="54-兼容状态与判定规则"></a>
- [5.4 兼容状态与判定规则](../../versions/v9/V9.6.md#source-13b6b164baaf--54-兼容状态与判定规则)
<a id="6-runtime-与-ui-实现"></a>
- [6. Runtime 与 UI 实现](../../versions/v9/V9.6.md#source-13b6b164baaf--6-runtime-与-ui-实现)
<a id="61-bridge-compatibility-service"></a>
- [6.1 Bridge Compatibility Service](../../versions/v9/V9.6.md#source-13b6b164baaf--61-bridge-compatibility-service)
<a id="62-状态-dto-示例"></a>
- [6.2 状态 DTO 示例](../../versions/v9/V9.6.md#source-13b6b164baaf--62-状态-dto-示例)
<a id="63-与业务服务的边界"></a>
- [6.3 与业务服务的边界](../../versions/v9/V9.6.md#source-13b6b164baaf--63-与业务服务的边界)
<a id="64-解析器回归要求"></a>
- [6.4 解析器回归要求](../../versions/v9/V9.6.md#source-13b6b164baaf--64-解析器回归要求)
<a id="65-诊断与隐私"></a>
- [6.5 诊断与隐私](../../versions/v9/V9.6.md#source-13b6b164baaf--65-诊断与隐私)
<a id="7-用户体验与发布说明"></a>
- [7. 用户体验与发布说明](../../versions/v9/V9.6.md#source-13b6b164baaf--7-用户体验与发布说明)
<a id="71-诊断区必须显示"></a>
- [7.1 诊断区必须显示](../../versions/v9/V9.6.md#source-13b6b164baaf--71-诊断区必须显示)
<a id="72-文案原则"></a>
- [7.2 文案原则](../../versions/v9/V9.6.md#source-13b6b164baaf--72-文案原则)
<a id="73-一键诊断摘要"></a>
- [7.3 一键诊断摘要](../../versions/v9/V9.6.md#source-13b6b164baaf--73-一键诊断摘要)
<a id="74-workshop-与-github-的用户流程"></a>
- [7.4 Workshop 与 GitHub 的用户流程](../../versions/v9/V9.6.md#source-13b6b164baaf--74-workshop-与-github-的用户流程)
<a id="8-源码纳管与审计工具"></a>
- [8. 源码纳管与审计工具](../../versions/v9/V9.6.md#source-13b6b164baaf--8-源码纳管与审计工具)
<a id="81-导入流程"></a>
- [8.1 导入流程](../../versions/v9/V9.6.md#source-13b6b164baaf--81-导入流程)
<a id="82-可复现审计工具"></a>
- [8.2 可复现审计工具](../../versions/v9/V9.6.md#source-13b6b164baaf--82-可复现审计工具)
<a id="83-合同与测试资产"></a>
- [8.3 合同与测试资产](../../versions/v9/V9.6.md#source-13b6b164baaf--83-合同与测试资产)
<a id="9-测试设计与验收标准"></a>
- [9. 测试设计与验收标准](../../versions/v9/V9.6.md#source-13b6b164baaf--9-测试设计与验收标准)
<a id="91-证据等级"></a>
- [9.1 证据等级](../../versions/v9/V9.6.md#source-13b6b164baaf--91-证据等级)
<a id="92-t1--t6-测试矩阵"></a>
- [9.2 T1--T6 测试矩阵](../../versions/v9/V9.6.md#source-13b6b164baaf--92-t1--t6-测试矩阵)
<a id="10-分阶段施工计划"></a>
- [10. 分阶段施工计划](../../versions/v9/V9.6.md#source-13b6b164baaf--10-分阶段施工计划)
<a id="阶段-0基线与源码归属"></a>
- [阶段 0：基线与源码归属](../../versions/v9/V9.6.md#source-13b6b164baaf--阶段-0基线与源码归属)
<a id="阶段-1协议合同与-manifest"></a>
- [阶段 1：协议合同与 Manifest](../../versions/v9/V9.6.md#source-13b6b164baaf--阶段-1协议合同与-manifest)
<a id="阶段-2mod-最小改动"></a>
- [阶段 2：Mod 最小改动](../../versions/v9/V9.6.md#source-13b6b164baaf--阶段-2mod-最小改动)
<a id="阶段-3runtime-握手与状态服务"></a>
- [阶段 3：Runtime 握手与状态服务](../../versions/v9/V9.6.md#source-13b6b164baaf--阶段-3runtime-握手与状态服务)
<a id="阶段-4诊断-ui-与发布说明"></a>
- [阶段 4：诊断 UI 与发布说明](../../versions/v9/V9.6.md#source-13b6b164baaf--阶段-4诊断-ui-与发布说明)
<a id="阶段-5全量回归与发布"></a>
- [阶段 5：全量回归与发布](../../versions/v9/V9.6.md#source-13b6b164baaf--阶段-5全量回归与发布)
<a id="11-风险分级"></a>
- [11. 风险分级](../../versions/v9/V9.6.md#source-13b6b164baaf--11-风险分级)
<a id="12-兼容矩阵与独立发布"></a>
- [12. 兼容矩阵与独立发布](../../versions/v9/V9.6.md#source-13b6b164baaf--12-兼容矩阵与独立发布)
<a id="121-目标组合"></a>
- [12.1 目标组合](../../versions/v9/V9.6.md#source-13b6b164baaf--121-目标组合)
<a id="122-workshop-发布流程"></a>
- [12.2 Workshop 发布流程](../../versions/v9/V9.6.md#source-13b6b164baaf--122-workshop-发布流程)
<a id="123-runtime-发布流程"></a>
- [12.3 Runtime 发布流程](../../versions/v9/V9.6.md#source-13b6b164baaf--123-runtime-发布流程)
<a id="13-完成标准与交付物"></a>
- [13. 完成标准与交付物](../../versions/v9/V9.6.md#source-13b6b164baaf--13-完成标准与交付物)
<a id="14-最终结论"></a>
- [14. 最终结论](../../versions/v9/V9.6.md#source-13b6b164baaf--14-最终结论)

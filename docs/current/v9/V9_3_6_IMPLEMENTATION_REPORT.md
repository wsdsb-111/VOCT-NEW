# V9.3.6 实施报告

状态：V9.3.6 本地发布候选已实现并部署，完整 417 组回归通过。规格为 [详细施工合同](V9_3_6_DETAILED_IMPLEMENTATION_SPEC.md)，基线 `03dfc4efe2791b31f28f4a4d521d41a10b59f6b9`。真实 CK3、Provider、Soak 和远端 CI 单列，不能视为已验收。

## Phase 0：基线

开工时工作区干净，285 source／artifact／deployed 映射一致，V9.3.5 payload 为 `41acdd5896978b94a6d198fec45ef0052fd05eabfcbe34cd38f309ccd9d2a9a4`。本轮使用相同 payload 的既有隔离 Windows 副本跑完整发布回归，407／407 组通过；未以正在修改的工作区冒充基线。

五项实际模块负例见验证报告。前两类路由及事项上限为必现；Forget 缓存残留依赖调用方漏传活动会话；Official 重叠字段仅为条件性风险，正常 MemoryEngine 输出没有同时返回两份 Official。

## 实施边界

只调整读取、冻结前缀及预算；Legacy、Pair Index、Forget、信件和官方追忆来源保持。Durable／Memory4／Year／Life 和旧 Sidecar 仍退役或惰性保留。既有离线回填与文件夹 UI 不更换存储格式。阶段实现、最终 payload、提交和验收结果随实际证据补充。

## Phase 1：玩家锚点与查询身份

`pair-memory-routing.js` 分离可信玩家 Anchor、当前 speaker/query 和当前玩家消息授权。固定 Counterpart 只由真实玩家 ID 决定；当前 speaker 仍可为其他 NPC，不覆盖它的动态语义。Conversation 传入 turn manager 的实际 playerMessageId、turnEpoch、会话和场景；同一玩家轮次中多个 NPC 依次回复仍共享该玩家请求，过期消息和 NPC-only 文本不授予第三人权限。第三人分类器及有限追问合同先由独立专项覆盖，读取接入属于后续阶段。

## Phase 2：冻结玩家关系记忆

`player-centered-memory.js` 接入 MemoryEngine 的显式玩家中心读取入口；旧入口保留为单一配置回滚适配器。固定块分别为 Recent1、合法 Official、玩家事项簿及既有合法稳定记忆。Recent 按原始谈话 totalDays／日期与稳定来源排序，官方追忆只使用原合法会话来源。事项没有 16 条常驻上限，预算足时全量，拥挤时按整条、跨年份的确定性子集选择；记录可见、注入、遗漏和顺序摘要。长 Recent 保留非空叙事，并预留事项与官方槽位；不改磁盘原文。

普通、GLM、V813 均使用独立 `memory-player-ledger-frozen` 块。相同 source key＋revision 且全文已出现在实际 Recent 中的事项显示“详见近期摘要”；仍保留 item、日期和证据类型，截断处或仅相似事项不省略正文。Engine 快照与 V813 prefix 绑定来源修订、真实 Forget ledger、日期、Campaign、玩家／Owner、会话及政策配置；既有同 stat 内容保护保留。

## Phase 3：玩家驱动的分级历史检索

L0 不读第三人历史索引或原文；L1 每目标最多 16 条、零源原文；L2 经键和修订复验后最多 2 篇完整来源。只在 L2 索引无命中、损坏或合法来源过期时允许有界 Owner 内 Legacy 兜底。身份／Campaign／Forget 冲突不可用兜底规避。事件与谈话双时间轴沿用现有索引。

旧 Mentioned、EntityTarget、Temporal、TopicPatch、关闭旧 Memory3 标志后的兼容路径及 `past_summaries` 不再绕过授权；历史动态注释不回灌为下一轮正文。独立审查发现的同正文多人投影合并问题已修：玩家自己的 L0 历史只能读取 B→A 来源，不能因合并 metadata 误开 B→C。短合法来源完整回读；过大的 L2 原文整篇省略，明确 `BUDGET_OMITTED`，不伪造摘录或修改原文。

## Phase 4：统一输入预算与发送守卫

单一政策表保留旧值与新值。新表 2／3／4+ 人为 16%／18%／20%、4800／5600／6400 Token；首次参与人数冻结，中途加入不静默增加已有会话额度。Conversation 先完成当前事实与 Worldline，再用同一 PromptBuilder 的排除记忆模式计算完整非记忆成本；输出、协议与安全余量来自既有 Provider 预算规划器。记忆块的标题、日期、证据、角色消息开销均计入，最终消息再次校验。

Provider 根据实际消息跨度和指纹复算记忆成本；每次真实传输前同时复核完整请求预算与来源、会话、场景、当前回应身份。截断续写显式继承原 metadata 与来源 guard，并将 partial 和续写指令重新纳入总请求预算；Forget 后第二次传输被阻断。新增匿名白名单诊断用于持久化计数、预算及失效状态，不保存完整对话或秘密正文。

## 兼容与交付

Legacy、Pair Index、Forget、NPC→NPC 保存、信件、Official Action 和 Worldline 写入合同不改；不做真实数据迁移、付费调用或远端推送。Core／App／UI 统一 9.3.6，窗口和预览标签同步；Workshop、协议、存储和动作版本保持。[验证报告](V9_3_6_VERIFICATION_REPORT.md)记录最终门禁与 payload；[Token 对比](V9_3_6_TOKEN_AND_CACHE_COMPARISON.md)区分估算与实际用量；[兼容审计](V9_3_6_COMPATIBILITY_AND_RETIREMENT_AUDIT.md)说明回滚和保留边界。

最终 288 source／artifact／deployed 映射一致。候选 `5681d10` 从全新 Windows 检出完成六步，417／417 组回归、独立 QA 69 行为检查、隔离 Electron 窗口、合成完整备份／旧读政策回滚／新政策恢复均通过。payload 为 `293e3ba59be67dddd58c6d3bebfafd47c288fa04ae4892b1961e85b5676fa917`。本地阶段提交包含基线、可信路由、读取／预算实现、流式续写反例，以及最后的来源修订竞争累计读取额度修复；最后收口提交只更新报告。现为 release candidate，真实 CK3／Provider／Soak 和最终 push SHA 的 CI 未签署。

最终独立探针还覆盖来源在 L2 检索期间变化的竞争：修复前首次读取与 fallback 累计 4 次／3 个唯一 source，修复后全轮统一为最多 2 次，SOURCE_STALE 不再重置回退额度，累计计数可观测。完整门禁和备份／回滚均对该修订重新执行，未复用前轮 payload 结果。

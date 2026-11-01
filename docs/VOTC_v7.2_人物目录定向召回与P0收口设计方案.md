<!-- version-document-redirect:v1 -->
# 历史链接索引

本文原文已完整合并到 [V7.2 版本册](versions/v7/V7.2.md#source-ecad733cd009)。
此页仅兼容旧链接；请从版本目录阅读，历史结论未重新验收。

<a id="votc-v72-人物目录定向召回与-p0-收口设计方案"></a>
- [VOTC v7.2 人物目录定向召回与 P0 收口设计方案](versions/v7/V7.2.md#source-ecad733cd009--votc-v72-人物目录定向召回与-p0-收口设计方案)
<a id="一结论"></a>
- [一、结论](versions/v7/V7.2.md#source-ecad733cd009--一结论)
<a id="二目标记忆模型"></a>
- [二、目标记忆模型](versions/v7/V7.2.md#source-ecad733cd009--二目标记忆模型)
<a id="21-唯一数据所有权"></a>
- [2.1 唯一数据所有权](versions/v7/V7.2.md#source-ecad733cd009--21-唯一数据所有权)
<a id="22-直接参与者召回"></a>
- [2.2 直接参与者召回](versions/v7/V7.2.md#source-ecad733cd009--22-直接参与者召回)
<a id="23-场外人物召回"></a>
- [2.3 场外人物召回](versions/v7/V7.2.md#source-ecad733cd009--23-场外人物召回)
<a id="三召回数量与-token-预算"></a>
- [三、召回数量与 token 预算](versions/v7/V7.2.md#source-ecad733cd009--三召回数量与-token-预算)
<a id="31-推荐条数"></a>
- [3.1 推荐条数](versions/v7/V7.2.md#source-ecad733cd009--31-推荐条数)
<a id="一对一直接对话"></a>
- [一对一直接对话](versions/v7/V7.2.md#source-ecad733cd009--一对一直接对话)
<a id="三人及以上直接对话"></a>
- [三人及以上直接对话](versions/v7/V7.2.md#source-ecad733cd009--三人及以上直接对话)
<a id="场外人物"></a>
- [场外人物](versions/v7/V7.2.md#source-ecad733cd009--场外人物)
<a id="32-预算规则"></a>
- [3.2 预算规则](versions/v7/V7.2.md#source-ecad733cd009--32-预算规则)
<a id="四v72-召回架构"></a>
- [四、V7.2 召回架构](versions/v7/V7.2.md#source-ecad733cd009--四v72-召回架构)
<a id="41-每个回复者生成独立路由计划"></a>
- [4.1 每个回复者生成独立路由计划](versions/v7/V7.2.md#source-ecad733cd009--41-每个回复者生成独立路由计划)
<a id="42-memorystore-增加两条精确查询路径"></a>
- [4.2 MemoryStore 增加两条精确查询路径](versions/v7/V7.2.md#source-ecad733cd009--42-memorystore-增加两条精确查询路径)
<a id="43-memoryengine-分通道召回"></a>
- [4.3 MemoryEngine 分通道召回](versions/v7/V7.2.md#source-ecad733cd009--43-memoryengine-分通道召回)
<a id="44-全发言者人物提及检测"></a>
- [4.4 全发言者人物提及检测](versions/v7/V7.2.md#source-ecad733cd009--44-全发言者人物提及检测)
<a id="五摘要落盘模型"></a>
- [五、摘要落盘模型](versions/v7/V7.2.md#source-ecad733cd009--五摘要落盘模型)
<a id="51-多人会话的有向保存"></a>
- [5.1 多人会话的有向保存](versions/v7/V7.2.md#source-ecad733cd009--51-多人会话的有向保存)
<a id="52-连续会话终局协调器"></a>
- [5.2 连续会话终局协调器](versions/v7/V7.2.md#source-ecad733cd009--52-连续会话终局协调器)
<a id="六两个-p0-问题的当前审计"></a>
- [六、两个 P0 问题的当前审计](versions/v7/V7.2.md#source-ecad733cd009--六两个-p0-问题的当前审计)
<a id="61-p0-1v7-动态记忆启用后动作系统全部失灵"></a>
- [6.1 P0-1：V7 动态记忆启用后动作系统全部失灵](versions/v7/V7.2.md#source-ecad733cd009--61-p0-1v7-动态记忆启用后动作系统全部失灵)
<a id="62-p0-2与第一名-npc-对话后第二场会话不保存摘要"></a>
- [6.2 P0-2：与第一名 NPC 对话后，第二场会话不保存摘要](versions/v7/V7.2.md#source-ecad733cd009--62-p0-2与第一名-npc-对话后第二场会话不保存摘要)
<a id="七开发阶段"></a>
- [七、开发阶段](versions/v7/V7.2.md#source-ecad733cd009--七开发阶段)
<a id="阶段-0先建立问题复现与行为基线"></a>
- [阶段 0：先建立问题复现与行为基线](versions/v7/V7.2.md#source-ecad733cd009--阶段-0先建立问题复现与行为基线)
<a id="阶段-1实现人物目录精确路由"></a>
- [阶段 1：实现人物目录精确路由](versions/v7/V7.2.md#source-ecad733cd009--阶段-1实现人物目录精确路由)
<a id="阶段-2实现全发言者场外人物召回"></a>
- [阶段 2：实现全发言者场外人物召回](versions/v7/V7.2.md#source-ecad733cd009--阶段-2实现全发言者场外人物召回)
<a id="阶段-3关闭连续会话摘要-p0"></a>
- [阶段 3：关闭连续会话摘要 P0](versions/v7/V7.2.md#source-ecad733cd009--阶段-3关闭连续会话摘要-p0)
<a id="阶段-4关闭动作系统-p0"></a>
- [阶段 4：关闭动作系统 P0](versions/v7/V7.2.md#source-ecad733cd009--阶段-4关闭动作系统-p0)
<a id="阶段-5ui-与发布收口"></a>
- [阶段 5：UI 与发布收口](versions/v7/V7.2.md#source-ecad733cd009--阶段-5ui-与发布收口)
<a id="八验收标准"></a>
- [八、验收标准](versions/v7/V7.2.md#source-ecad733cd009--八验收标准)
<a id="81-记忆正确性"></a>
- [8.1 记忆正确性](versions/v7/V7.2.md#source-ecad733cd009--81-记忆正确性)
<a id="82-摘要可靠性"></a>
- [8.2 摘要可靠性](versions/v7/V7.2.md#source-ecad733cd009--82-摘要可靠性)
<a id="83-动作可靠性"></a>
- [8.3 动作可靠性](versions/v7/V7.2.md#source-ecad733cd009--83-动作可靠性)
<a id="84-发布检查"></a>
- [8.4 发布检查](versions/v7/V7.2.md#source-ecad733cd009--84-发布检查)
<a id="九兼容与非目标"></a>
- [九、兼容与非目标](versions/v7/V7.2.md#source-ecad733cd009--九兼容与非目标)
<a id="91-兼容策略"></a>
- [9.1 兼容策略](versions/v7/V7.2.md#source-ecad733cd009--91-兼容策略)
<a id="92-本版本不做"></a>
- [9.2 本版本不做](versions/v7/V7.2.md#source-ecad733cd009--92-本版本不做)
<a id="十最终交付定义"></a>
- [十、最终交付定义](versions/v7/V7.2.md#source-ecad733cd009--十最终交付定义)

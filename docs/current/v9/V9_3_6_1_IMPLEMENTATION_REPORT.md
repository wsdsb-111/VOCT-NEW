# V9.3.6.1 实施报告

状态：代码与专项已完成，完整候选验收进行中；基线代码 5681d10，报告收口 6c056c0。需求见[施工规格](V9_3_6_1_FIX_SPEC.md)。本地修复不重写真实用户数据，不调用付费 Provider，不推送远端。

## FIX-01 历史意图

将过去、当前／将来和有限追问分开分类；当前／将来分句不授予历史权限。独立的历史问题仍可召回，只从历史分句解析目标，并让同一分句驱动时间判断、索引相关性和合法fallback排序，避免同时授权提醒中的其他人物或污染过去问题的召回。追问必须绑定相同玩家、回应者、会话、场景和相邻轮次，始终为 L1。引用、否定、NPC 发言及身份歧义继续保持 L0。

## FIX-04 近期摘要去重

对实际渲染的 Recent 副本使用共享 parseImportantMatters，按来源键、修订、序号与完整条目精确核对。只有完整且边界明确的同一事项才能使用“详见近期摘要”；子串、截断尾项或不同序号保留事项正文，仍按整条预算选择。

## FIX-02 上下文设置

request-budget.js、Provider capability cache、Main schema、SettingsRepository、保存／设置 IPC、Provider 模型元数据和 Renderer ContextLengthField 同步支持 Auto／Custom。旧无 mode 的明确90K保留，Auto 未知使用8192，Custom受可信原生cap约束；严格整数验证贯穿UI、IPC与保存。独立QA发现的坏持久化Custom扩窗已修为 invalid_configuration_fallback；非法输入的原文字段保持可见，防止effect重置为看似合法值。范围、来源和兼容风险见[Context说明](V9_3_6_1_CONTEXT_COMPATIBILITY.md)。

## FIX-03 规模与运行诊断

完成5／30／100／300 Pair合成基准与7项安全回归，增加候选Pair／明确索引调用／cache命中诊断及匿名白名单投影。**逆索引和额外候选缓存按规格允许的路径延期**，未实现候选缩减或声称性能优化；300 Pair仍有明显阻塞开销。完整Owner扫描保留合法转述和来源／Forget复验，不以Top-N隐藏性能问题。见[测量报告](V9_3_6_1_PAIR_RETRIEVAL_BENCHMARK.md)。

## FIX-05 冻结语义

不改Conversation首次会话人数冻结实现。新对抗测试使用真实Conversation预算函数、MemoryEngine和PromptBuilder，验证2人4800后加入4人仍4800、新回应者自己的Owner→Player快照、来源修订失效、headroom降至1200及LENGTH续写重预算／发送前守卫。未扩大记忆硬上限，未引入每Responder升档规则。

## FIX-06 发布整理

五个专项登记到唯一test-manifest.js；清除旧QA“未登记”注释并升级Recent去重oracle。Core／App／UI／窗口和三主题预览统一9.3.6.1，版本标头断言同步。旧报告、存储格式、Prompt block ID与退役边界保持。

## 兼容边界

保留 Legacy Summary、协议 3.0、摘要存储 2.5、NPC→NPC 定向保存、Forget、Official Action、Worldline 和信件。Durable／Year／Life 不恢复，旧 Sidecar 保持惰性归档。记忆块 ID 不改；2／3／4+ 人 4800／5600／6400 上限及首次会话人数冻结不扩张。

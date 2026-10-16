# V9.3.6.3 实施报告

> 本文件保留此前 TwoP1 阶段的历史证据；2026-10-17 综合修复追加 AGE / RECALL / REGEN / OBS，当前结果见[综合实施报告](V9_3_6_3_INTEGRATED_IMPLEMENTATION_REPORT.md)和[综合验证报告](V9_3_6_3_INTEGRATED_VERIFICATION_REPORT.md)。下文数量与哈希仅属于原批次。


状态：本地候选施工、构建与验证完成，已部署；不代表Full Freeze。冻结基线代码 abb5f9ce086a1da850b4aba78a7e429ac0cf27ae、报告提交440251b5c4b0c710b67bff9ca93c277470c28cd9；基线payload0445d6388410f7519f4083c2bcdd8bed43dad3b4a24d1d4336f9823fab15b5e6。需求见[施工方案](V9_3_6_3_TWO_P1_FIX_PLAN.md)。

## INT-03：不依赖事件名称的历史回顾

pair-memory-routing.js 按分句识别时间连接词与回顾谓词，配合过去体貌、未来依赖、提醒和否定证据。政变、登基、审判等正常历史提问无需进入事件名白名单。只有合法历史分句明确索要经过、原话等细节才允许L2；历史关系和相邻追问保持L1。路由版本升为v9363-third-person-route-2，并使旧dynamic/historyBinding/namedTargetFocus/temporalFocus失效。人物、Owner、玩家、相邻轮次、场景和会话授权继续复用原合同。

## PERF-02：旧摘要局部保守候选

OwnerTargetCandidateDirectory 将可靠归属Pair但缺少来源元数据的记录标为局部不确定，把其全部Pair纳入候选；完整来源继续进行唯一别名匹配，直接目标始终保留。SCOPED_DEGRADED只有覆盖全部未知影响范围时才可使用；真正无法定位范围时UNSCOPED_LEGACY_SOURCE回退全量。所有Pair都不确定时保留全量候选，不以Top-N截断。

保留64项进程内LRU；不确定集合、来源元数据和路由范围进入指纹。实际权威仍为PairLedger：逐候选真实读取、权限/Forget/Campaign/日期检查、L2总尝试至多2次、最终scope重读和全Owner进入/退出内容核对。exhaustive-reference同样复用不可伪造的Owner read session，仍遍历全U、读取实际Pair并在退出时复验，不再对每个Pair重复全Ownerstat检查；本版A/B均采用该同版本参考路径。

独立QA额外复现非标准旧JSON同长度同mtime修改不能被Owner核对发现的问题。MemoryStore现将所有已经按既有路径读取的Owner JSON纳入来源快照与实际内容摘要检查；Owner内部允许旧文件名，Pair来源打开仍维持标准名及路径/链接限制。没有新增扫描目录或改变来源权限。

新增匿名诊断trustedCoveredScopeCount、uncertainScopedScopeCount、uncertainSourceCount、unscopedUnknownCount、ownerValidationMs；SCOPED_DEGRADED的全量fallback计数为0，使用独立原因枚举。不会持久化摘要正文、人物姓名、ID列表、路径或凭据。

## 保持的兼容合同

Legacy Summary协议3.0、存储2.5、Recent1/官方追忆/玩家事项簿固定基线、4800/5600/6400上限及首次人数冻结不变。事项是Legacy本地派生索引，不改写旧文件、不自动迁移或后台回填。姓名主标签、Official Action、Worldline、信件和NPC→NPC定向写入保持。Durable、Year/Life及旧Sidecar运行路径继续退役。

本轮仅合成数据，无真实APPDATA/CK3读写、付费Provider请求或远端推送。[验证](V9_3_6_3_VERIFICATION_REPORT.md)、[旧档兼容](V9_3_6_3_LEGACY_COMPATIBILITY.md)、[性能A/B](V9_3_6_3_PAIR_PERFORMANCE_AB.md)分别记录实际结果。

## 发送前旧源内容复验补充

C20用真实Engine确认：较新的非标准JSON成为玩家Recent1后，若文件恰在首次folder revision检查返回后被改写，原beforeSend仍valid=true。另用完整stat元数据保持的明确模拟检查时间戳无变化时的内容保护。原Windows常规改写可以被ctime检测，不把这种已被拒绝的情况误报成漏洞。

现在beforeSend重新取得Store可信WeakMap快照，核对其revision仍等于旧context；保留逐Pair内容检查，再核对全部Owner文件digest。变化/异常失效缓存并拒绝，新鲜快照恢复后可正常使用。该步骤只返回真实性布尔结果，不新召回、注入或授予权限，L0第三人read/resolve仍为0。发送前O(files)认证耗时不在retrievePairMemorySources基准和检索ownerValidationMs内，不把检索时延宣传成端到端发送时延。

## 最终本地结果

运行代码SHA：`6e06672d5bfd065f70ff9a0d68ace6efaf4f74be`。Core/App/UI为9.3.6.3，Workshop2.0.5、Official Action2.0.3、协议3.0、存储2.5保持。Node v22.23.3；全新Windows验证快照 2c1180718c17922eb3b13cf2a3613edf4269ff03，初始无.build，68项LFS资产逐个校验；标准六步全部退出0。实际289映射、payload 4a5a54504815a3482450d5e6d53c269c988759fe06619a8dc38bafbccea91673，source/artifact/deployed一致。唯一清单558个测试文件、430发布组、127历史项；430/430组通过。

S01–S20及未来依赖补充S21共21/21；旧档C01–C18及5项补充共23/23；同版本正式294格性能（8820个B样本）+unknown诊断，9116次调用。300 Pair常规warm P50 605.3–656.1ms、P95 633.5–691.5ms；1/5/10个旧Pair边界warm P95 497.5–597.5ms，建议门槛通过。全体不确定/allmention耗时另列，没有缩小合法候选。

隔离VOTC.exe双启动及实际Legacy事项簿/来源查看、真实姓名标签、来源字节保持和新事件路由通过；0/0/2原文数量、固定块稳定、1410/4800预算通过。GLM90K显式未验证默认、已有Auto重启保留、Custom1M与零输入警告继续通过；零Provider/外网请求。真实CK3、真实Provider、20–30轮联调、80–100轮Soak、远端CI均NOT_RUN。未改真实APPDATA、未迁移旧摘要、未推送。

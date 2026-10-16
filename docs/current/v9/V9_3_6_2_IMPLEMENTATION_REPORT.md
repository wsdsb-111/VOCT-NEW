# V9.3.6.2 实施报告

状态：本地发布候选已完成并部署；常规性能门槛、427／427发布组、独立QA及隔离Electron通过，不代表Full Freeze。起点 `fbe8cc3fc1abc45c6e41bb6ba16bc00e0dc46c54`，原 V9.3.6.1 运行 payload `6edf7432fdd2780be3418242f0bf218665ad5cd77a726220bbb76eef0bc4bbe9`。需求来自 [施工规格](V9_3_6_2_OPTIMIZATION_DEVELOPMENT_SPEC.md)。

## PERF-01：保守候选与权威复验

新增 `owner-target-candidate-directory.js`，仅在进程内保存有界 LRU 派生缓存。目录由 MemoryStore 可信 Owner 快照构造，直接目标 Pair 始终纳入；其他 Pair 的原始摘要或共享事项解析结果包含目标唯一别名时纳入。允许多选，不用 Top-N 截断候选。缺少来源覆盖、唯一别名或合法快照时，显式回退原全量扫描，不把目录缺项解释为无历史。

目录键包含 Owner、Campaign、快照修订、来源身份及内容、完整别名集、目标与 Pair 集、场景、日期和失效 epoch；确认写入、来源缓存失效和全量 invalidate 会清理目录。目录没有权力授予来源可见性，也不替代 PairLedger 对确认、Forget、Campaign、日期和来源修订的判断。

一次检索创建不可伪造的 Owner read session：进入时核对整个 Owner 的真实磁盘状态与内容；每个候选仍走实际 PairLedger.read，并读取、核对该 Pair 的来源内容；最终重读候选 scope 修订，再核对整个 Owner。全局或候选竞争失效则丢弃整轮结果。消除每个候选重复扫描全部 Owner 的平方开销；批量内容检查仍逐文件 lstat 前后、读取并比较摘要文件 digest，只将相同路径祖先检查合并为批次前后各一次。

同一版本保留内部 `PairLongTermLedger.setRetrievalMode()`：默认 `safe-candidate-directory`，可切换 `exhaustive-reference`，切换会失效 Store 快照。它不关闭权限或发送前验证，不新增玩家可见的危险开关。无持久化格式迁移。性能样本、首次未达标轮次、最终 A/B 和回滚证据见 [性能报告](V9_3_6_2_PAIR_PERFORMANCE_AB.md)。

## INT-01／02：历史分句与局部否定

支持“后来怎么样”“战争之后发生什么”“当年准备如何”等历史语义，同时保持当前安排、未来提醒、引述、NPC 发言及无可信玩家轮次为 L0。“别说废话”不再遮蔽后续合法历史问题；明确否定 C 后单独询问 D，只允许 D。否定谈论的角色与唯一别名同句时，也阻止旧人物焦点通过后续代词重新授权该角色。

目标、时间、相关性和合法 Legacy fallback 使用同一已授权历史分句。相邻追问仍需同 Owner、玩家、会话、场景和有效绑定，只能为 L1。L0 不建立第三人目录、不读第三人索引或原文；L1 每目标至多 16 条、零原文；L2 含失败和 fallback 的来源尝试总数至多 2。

## CFG-01／02、BUD-01：GLM 兼容与预算

Main 和 Renderer 的新 GLM 实例默认显式 Custom 90000，并清楚标为未经原生验证的兼容设置。已有 Auto 不被改写，未知原生能力时仍安全回退 8192；用户可显式选择 90K、保持 Auto 或 Custom。Custom 上界仍为 2000000，可信模型原生窗口可收紧有效值，不新增全局 90K 限制。

界面分别显示配置值、可信原生值、有效窗口、来源、空消息输入预算与输出预留。新增只读 `llm:getContextDiagnostics`／preload 接口给出当前实际能力和预算；统计仅保存白名单 mode/source/effectiveContextWindow，候选诊断仅保存计数、耗时、布尔、枚举与哈希。256 仍是合法配置值，但没有可用输入空间时显示警告，最终发送守卫即使面对零输入估算也拒绝发送。详见 [上下文兼容说明](V9_3_6_2_CONTEXT_COMPATIBILITY.md)。

## 保持的合同与交付边界

保留 Legacy Summary、协议 3.0、存储 2.5、NPC→NPC 定向事项、Forget、官方追忆、Official Action、Worldline 和信件。Durable／Year／Life 不恢复，Sidecar 不扫描、不读写。固定块 ID、首次会话人数冻结和 4800／5600／6400 记忆上限保持；扩展 Context 不放大记忆配额。

本轮不读取或修改真实 APPDATA／CK3 数据，不发付费 Provider 请求，不推送远端。自动化、隔离 Electron 与真实 CK3／Provider／Soak／CI 分开记录；最终 SHA、payload 和实际发布组数量见 [验证报告](V9_3_6_2_VERIFICATION_REPORT.md)。

## 最终本地结果

运行代码提交：CODE_SHA_PENDING。全新Windows验证快照 `bbbace1b0f88ce3e67cf8fc87f6c55cb323f08d5`（初始无.build，68个LFS资产逐个校验），Node v22.23.3 标准六步全部退出0。最终289映射，payload `0445d6388410f7519f4083c2bcdd8bed43dad3b4a24d1d4336f9823fab15b5e6`，source／artifact／deployed一致。清单555个test文件、427发布组、127历史项；五个新专项均登记，16／16历史矩阵、10组独立QA和32格实际构建次数审计通过。

正式候选1080个样本、24个常规性能格全部达标；300关系常规warm P50为359–506ms，P95为408–556ms，cold P95为517–582ms。所有关系提及目标时保留全300候选，最坏耗时单列，未以Top-N丢事项。GLM真实IPC、Auto重启保留与0／0／2来源限制均通过隔离窗口；本轮模型／外网调用0。真实CK3／Provider／Soak／远端CI仍NOT_RUN；未推送、未改真实用户数据。

# V9.3.4 Durable 退役实施报告

日期：2026-10-15。锁定基线 main `3c1c2162e63f587bf920c8670bc88f9c263ac0f1`；施工规格原件 SHA-256 `22d0aed35dc881ca4f991bb8869b06d52aa3e80950f90f1d916ad5a63a73ecc1`，仓内副本逐字节一致。

## 当前交付

Core、App、UI 为 **9.3.4**，可见记忆标签为 **Legacy Summary**。协议 3.0、摘要存储 2.5、Workshop 2.0.5、Official Action 2.0.3 与既有持久化 writer 保持。沿既有 Final Summary → Episode／Owner 摘要与 Legacy 事实索引保存，不增加模型提取器、Embedding、第二份摘要仓库或自动历史重算。Rolling Summary 保留。

## 生产入口切断

| 入口 | V9.3.4 处理 |
|---|---|
| main 初始化 | 不再实例化 Memory4 Coordinator／Store／Planner、配置 Durable trace 或恢复钩子 |
| Conversation 结束、启动恢复 | 只调用既有 Narrative finalization／recovery；不再传 requestDurable、不做 Legacy recompression |
| MemoryEngine 最终化 | Narrative 保存验证后独立完成；已提交 marker 的旧 Narrative snapshot 可收口，不等待 Durable |
| 历史召回 | 唯一生产路由为 Legacy；删除 memory4Packet、Detail fit、focus 与混合 history |
| Letter 接收及接受 | 删除 Sidecar 披露调用，保留原 binding、receipt、ACK 和 Effect 流；通用 LetterSummaryFinalization 保存双方 Legacy |
| SummariesManager | 编辑、删除、整理、导入和恢复不再依赖 Memory4 完成证明 |
| Renderer／IPC／Preload | 删除 Memory4 known/detail/coverage、扫描、重压缩与 CRUD namespace；独立 Legacy 正文、日期、重要事项、分页及官方追忆保留 |
| LLMManager | 三种 send 入口在选择 Provider、创建 control 及通用 guard 前硬拒绝 memory4_durable；通用 beforeSendGuard、配置复核、预算与显式重试保留 |

从 runtime 映射移除 **21** 个旧生产文件，加入 **3** 个通用模块，映射 **296 → 278**。Durable trace writer 移除；UsageAnalytics／MemoryTrace 的历史字段兼容不等于恢复 Durable 功能。

## Legacy 独立 Forget 与恢复

通用来源身份迁入 legacy-source-lineage.js，保持旧投影哈希算法及 m4p_ 标识兼容。Forget 账本为原 MemoryStore index 的可选 forgottenSummaryProjections 字段，沿原 version 1 summary mutation journal 原子提交与回滚。先核对 Owner、counterpart、Campaign、finalization、knownBy 及具体来源，再撤销知识、更新 Episode、删除可见行和失效所有传入活动会话缓存。不会因同 finalizationId 跨 Campaign 误改 Episode。已发送的 Provider 历史不能撤回；后续新请求不再引用已忘源。

信件在 Legacy 行已落盘、Memory／Episode 尚未提交时发生崩溃，编辑／删除可通过新 Letter job 的 payload、双方、日期、正文和身份精确证明来源；不能信任调用方伪造的 sourceLetterId。恢复重新核对账本，只为仍授权 Owner 写入知识及 Episode knownBy。三次真实持久化失败仍要求手动重试，防止无限自动写失败；已生成的 letter_summary 不重复请求，不重发 Effect。

旧 Legacy 行没有 perspectiveMemoryIds 时，编辑 f1 生成 canonical 不能阻止删除独立 f2。来源判定仅将明确不同 finalizationId 的来源排除；同 Owner 的未知 finalization 仍 fail-closed，其他 counterpart／Owner 的同名 finalization 不能充当当前来源证明。独立 native CRUD 夹具覆盖真实原子 writer 的正向操作及拒绝后逐字节回滚。

## 召回行为与本次修复

默认 v812MemoryEngine3Enabled 路由每个当前直接关系对象最多 **2 篇**最近 Legacy 摘要，本场冻结；另可有 **1 份**合法 CK3 官方追忆。每个响应 NPC 每轮动态 Extra 合计 **0–3 篇**，按 temporal → entity_target → mentioned → topic → important 选择，受授权、去重和预算限制。Legacy 重要事项事实仍使用既有稳定索引，不是新的 Durable 请求。显式追问原对话可按问题挑选相关原文摘录。

本轮额外修复：模糊“当时”不能吞掉明确场外人物检索；改为仅提供该人物授权摘要并保留各自日期、不臆断所问时段。未解析身份不走目标／动态召回或 query 重排；姓名匹配复用 MentionTracker 最长别名消歧，避免张三匹配张三丰。已知游戏日期时排除未来摘要。尚无直接对象时不冻结空摘要，正常会话的既有冻结合同保留。

固定与动态记忆共享本场预算：2／3／≥4 位活动人物分别为 contextLimit 的 10%／12.5%／15%，上限 3600／4500／5400 Token；Provider 总上下文安全余量再约束。65% 为固定 lane 分配，动态可使用固定实际选择后的剩余预算。旧 v812 开关关闭时的 2.x 兼容路由仍保留，不能把其旧三篇／重要项规则混报为默认 Recent2。

## 历史数据及维护边界

本轮不读取或修改真实 userdata，不删除、不转换、不重新生成任何历史 Sidecar、Year/Life 或 Legacy。旧 Memory4 数据标为审计意义上的 RETIRED_INERT，不向旧 index 写此标签。单 Owner 目录读取不探测 Sidecar；多改名目录的维护为避免破坏旧数据，仅对明确的 memory4 路径 assertNoLinks／existsSync，发现即跳过合并，Legacy 对话文件仍按 numeric ID 读取和写入；不扫描、不打开正文、不写入 Sidecar。

旧 Year/Life 显式维护命令所需 7 个模块隔离到 scripts/archive/v933-year-life，完全不进入 runtime build；原确认、备份、lock、事务保护仍保留，本轮不执行。未完成旧维护 lock 仍阻止 writer，不能借退役跳过数据一致性保护。ScopedJsonRepository 已无非 Durable 消费者，从运行构建删除。

## 验证范围

详见 [验证报告](V9_3_4_VERIFICATION_REPORT.md)、[变更清单](V9_3_4_CHANGED_FILES.md)、[脱敏审计](V9_3_4_RETIREMENT_AUDIT.json)。本轮全部离线；没有付费 API 支出，没有真实 CK3／Soak 验收，也不推送远端。

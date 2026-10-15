# VOCT / VOTC V9.3.4 施工规格：彻底退休 Durable，恢复 Legacy 摘要驱动的 NPC 历史记忆

> **性质**：待施工设计文档，不是已实现报告。  
> **仓库**：`wsdsb-111/VOCT-NEW`，`main`。  
> **锁定基线**：V9.3.3.1，`3c1c2162e63f587bf920c8670bc88f9c263ac0f1`。施工开始前必须检查最新 HEAD，若已变化先 diff，不得盲目覆盖。  
> **目标版本**：Core / App / UI **9.3.4**；Workshop Mod `2.0.5`、Official Action `2.0.3`、现有协议/摘要存储版本不因本任务自动升级。对于已退役 Memory4，不再把“Memory Engine 4.0”作为仍然在线的功能宣传；运行时与 UI 中的版本文案须真实标注 `Legacy Summary`。  
> **目标**：完全移除 Durable 对话事实抽取、后台重压缩、付费 Recovery、动态召回、UI 入口和生产写入；NPC 的**历史交谈记忆以原有 Legacy 摘要为唯一主来源**，恢复早期的叙事连贯性与可解释的 Token 成本。  
> **强制不变量**：不删除 Legacy、原始已提交 Episode、滚动摘要、重要事项、CK3 官方状态、有效的 Action 账本、信件、多人知情范围或 Forget。无用户授权不得删除旧 Durable JSON。  
> **施工顺序**：先阻断任何新 Durable 付费请求 → 恢复摘要召回与 Legacy 独立删除 → 物理解除 Durable 依赖及 UI → 全量验证 → 推送。  
> **范围约束**：本版本不是 V9.4 Context Architecture，也不借机重新设计整个 Summary/Provider/Action/Worldline。  

---

## 0. 决策摘要：这是架构退役，不是临时开关

**用户已作出架构取舍：Durable 成本和 RP 效果不符合预期，V9.3.4 正式终止 Durable。** 不提供“默认仍启用的 Memory4 Experimental”、不再优化 8 条配额、Planner 或 Durable 缓存；它们不应继续获得生产资源。

退役后正式记忆路径：

```text
CK3 对话（按实际在场/知情/耳语窗口采集）
    ├── 会话当前消息 + Rolling Summary（场内长对话连续性）
    └── Final Summary → Episode/Legacy 事实 → Owner/双人摘要目录
                                      ↓
                          已授权的 Legacy 摘要检索
             （直接关系冻结摘要 + 人物/主题/时间动态召回）
                                      ↓
                  NPC Prompt 中的历史交谈记忆
```

CK3 实时读取的**当前游戏状态**仍是游戏事实来源，而非替代性历史记忆数据库。已有 CK3 Official Recollection 是否继续作为既有独立只读信息，须保持升级前、早期 Legacy 路由的行为；不得把 Durable 中的知情证据反向输入 Legacy，亦不得为了“纯摘要”破坏角色实时基础数据读取。**在回答旧谈话“发生了什么”时，仅从 Legacy 与当前会话摘要获取历史交谈内容。**

**明确定义“彻底退休”**：

1. 对于任何已结束或新开始的会话，生产请求中 `requestType=memory4_durable` **始终为 0**。
2. 不再调用 Durable 分块、Checkpoint、恢复、Legacy 自动重压缩、手动重压缩、提取 Provider 或付费队列。
3. `Memory4RecallPlanner` 不参与任何 NPC Prompt，不做 Detail 覆盖 Legacy 的动态替代，不发出 Durable 引用。
4. 不再写入 Memory4 `entries/index/known-entities`，不再建立该模块的生产读上下文，也不扫描其历史归档用于对话。
5. 用户记忆 UI 不出现“详细长期记忆 / 来源覆盖 / Memory4重压缩 / Durable提取情况 / 8 条配额”；以可读摘要为中心。
6. Legacy 的编辑、撤销和删除能在**没有 Memory4 实例**的情况下安全完成；旧 Sidecar 不得使删除失败或重新出现已遗忘事实。
7. 旧 Durable 磁盘文件可保留为**惰性兼容归档**，但不能被启动扫描、读取、召回、自动迁移或写入；独立备份及按范围确认后才允许清除。

### 0.1 从实机反馈得到的事实与证据边界

- 最新截图的统计**跨越 V9.3.3 前后且没有重置**，不能用于计算 V9.3.3.1 单版本 Token 增量；但 `memory4_durable` 累计 **418 请求、3,169,377 Token** 证明历史成本不可忽视。
- `memory4_durable | unattributed | No block metadata` 是缺失归因信息，不代表相同次数的缓存真实失败；不要依截图反推模型生成质量。
- Legacy 页面 `0/5`、`0/14` 和“映射未知”是**来源对应关系未验证**，不是旧摘要正文丢失的证据；V9.3.4 不需再投入修复该 Coverage UI。
- `memory4-evidence-planner.js` 的 P0/P1/P2 只排序；`plannedSourceCount=fragments.length`、`locallyExcludedSourceCount=0`，不能视为真正消除所有低价值来源。
- 当前 `memory-engine.js` 的 `useMemory4` 分支会以 Memory4 Packet 取代动态 Extra；`memory4-recall-planner.js` 对经完整证明的 Legacy fact 可执行抑制。退役后应回到未启用 Memory4 的已有 Legacy 召回路线，并在实机证明没有新的信息缺口。

## 1. 保留 / 删除 / 隔离矩阵

| 系统/资源 | V9.3.4 处理 | 验收说明 |
|---|---|---|
| Legacy 双人可读摘要及“需要长期记住的事项” | **保留、作为主记忆** | 原始文字/日期/知情/Owner 路径和编辑保留 |
| Final Summary、Episode、Perspective Projection | **保留** | 摘要最终提交不再等待 Durable |
| Rolling Summary、场内历史、Prompt History | **保留** | 长对话稳定性不受退役影响 |
| Legacy Direct/Stable/Dynamic/Temporal/Turn Recall | **恢复/保留** | 动态 Extra 不再被 Memory4 Packet 覆盖；按原先预算与防重机制运行 |
| Summary 日期索引、历史事件时间线索 | **保留** | 不恢复已退役 Year/Life 文件生成 |
| Current CK3 GameData / Worldline 当前事实 | **保留** | 不把行动或历史猜测冒充真实 CK3 状态 |
| CK3 Official Recollection | **保留既有行为** | 如非摘要驱动对话内容，独立于 Durable，不能误删其读取 |
| Memory4 Durable 生成 / Planner / 8条配额 / 分块恢复 | **移除生产链** | 无调用、无注册、无付费 |
| Memory4 Detail 动态召回 / Legacy suppress | **移除生产链** | 不用 Durable 替代 Legacy 的叙事信息 |
| Legacy → Durable 自动/手动 Recompression | **完全停止并移除交互** | 关闭会话、召回及旧恢复不能触发它 |
| Memory4 认知、披露资料持久化与旧 Sidecar 派生 | **停止生产读写** | 已存在的旧值不注入 NPC；若当前 CK3 数据需要，走独立现有授权来源 |
| Memory4 UI（Detail、Coverage、Known、专有 IPC） | **从生产摘要 UI 移除** | 新版用 Legacy 摘要显示/编辑界面替代 |
| Legacy Forget / 删除 / 多角色撤销 | **保留并解耦** | 不能依赖 Memory4 Forget 成功作为唯一许可 |
| 历史 Durable 资料、旧 Recovery、遗忘墓碑 | **默认只读隔离/不访问** | 不自动删除；受控备份和单独清理 |
| Year/Life | **继续保持退役** | 不许回引 `memory4-derived`、`years/*.json` 或 `life.json` |
| Action、Provider、GLM、世界书、Three-Mod | **不变** | 不以本次退役修改业务合同 |

---

## 2. Phase 0 — 冻结、资产清点、基线复现（零付费）

1. 检查 `git status`、HEAD、workflow；保存 V9.3.3.1 `3c1c216...` 基线和 `443/443` 本地门禁、远端成功链接。
2. **仅本地离线**梳理这些入口的静态和运行时依赖：

```bash
rg -n -i 'memory4|durable|requestDurable|queueLegacyRecompression|recompressLegacy|recoverPending|finalizeCommitted|fitMemory4Context|memory4Packet|memory4RecallEnabled|disclosureProfiles|getMemory4' src/app scripts build resources/app/default_userdata
rg -n 'memory4_durable|memory-temporal-extra|memory4:get|memory4:mutate|memory4:forget|memory4:audit' src/app scripts
rg -n 'getLegacyCoverage|forgetSummaryProjection|forgetOwnerConversation|deleteSummary|sourceRevisionCurrent|knownBy|projectionLineage' src/app
```

3. 将命中分类：**Durable 专属**、**仍需 Legacy/知情/Forget 的共享基础**、**纯历史测试文档**、**Generated Runtime**。不得执行粗暴的 `rm -rf memory4*` 或 `sed` 全局替换。
4. 在隔离测试 profile 生成至少一条 Legacy 摘要、一个带 Durable 的旧存档及一个**Narrative 已成功而 Durable 仍待恢复**的快照，用于迁移和无费用验证；测试数据不得是用户真实隐私文本。
5. 先在旧版记录 3 个核心用例：普通双人回忆、跨年份事件回忆、他人不在场/耳语隔离。保存**被注入的 Legacy 摘要 ID 与可见内容摘要/哈希**、Prompt 区块来源、总估算 Token、LLM 请求分类，而非只保存最终 NPC 文本。
6. 在正式修改前编写“零 Durable 发送”失败复现：关闭对话 / 重启 / 手动恢复 / 点击 UI / 再次召回时，各路径当前可能产生 Durable 请求。避免通过只看 UI 计数而漏掉后台工作。

**Gate 0**：源代码依赖清单、可复现 fixture、日志计数、备份范围明确；无任何修改真实用户存档。

## 3. Phase 1 — 全路径断流：禁止生成、恢复与自动付费

### 3.1 会话终结与普通摘要提交

`src/app/main/conversation/conversation.js`：

- `createFinalSummary()`：完整移除 `requestDurable` Provider 回调；只保留 `requestSummary` (`final_summary`) 和现有摘要提交参数。
- `recoverPendingMemories()`：移除 `requestDurable` 回调；只调用原来的摘要恢复 (`memory_recovery`)。
- 保留离开对话的 Legacy 终结、角色列表、参与边界、摘要持久化和异常 Recovery。
- 加一条对主进程送出请求的**硬门禁**：即使误传 `requestType === "memory4_durable"` 也必须 fail-closed（抛内部不可发送错误，绝不调用网络）；不能静默返回假模型输出。门禁落在请求发出前的集中入口，生产路径应无此类型调用。

`src/app/main/memory-system/memory-engine.js`：

- `finalizeConversation()`：完成 Narrative 成功提交即完成最终化，删除 durable handoff 作为 Recovery 清理条件。
- `recoverFailedFinalization()`：已经完成 Narrative 的旧快照直接视为**叙事恢复成功**，不再等待 Durable；未完成 Narrative 的继续真实摘要 Recovery。
- `recoverPendingFinalizations()`：只扫描和运行原 Final Summary 恢复，不调用 `this.memory4.recoverPending()`。
- **切忌把待恢复的 Durable 记录写成** `NO_DURABLE_CONTENT`、`STORE`、`COMMITTED` 或伪造原 source proof。允许用单独的退休审计状态例如 `RETIRED_UNPROCESSED` **存放在独立审计/迁移清单**，不能写入旧 Memory4 canonical index。
- 旧 narrative recovery 快照的 cleanup 必须证据化：仅在 Narrative 已成功提交且其他必要持久化已确认时删除原 narrative recovery；旧 Durable recovery 和原有 Sidecar 仍保持隔离不触发重新付费。

### 3.2 后台入口与生命周期

- 检查 `getRecoveryStatus()`、自动恢复调度、Electron 启动和窗口恢复、手动点击恢复、延迟任务、`setImmediate` 和 `recompressLegacy()`；彻底去除 Durable 回调与 pending 队列。
- 移除 `conversation.js:retainDynamicSummaryRecall()` 中 `queueLegacyRecompression()` 调用；不得因“本轮成功注入了 Legacy 摘要”而再花钱提取。
- `getMemory4OwnerData`/`mutateMemory4` 中的重压缩按钮和 IPC 从生产入口撤下，不留“可点击但返回错误”的诱导功能。
- 不读取、执行或自动修正 V9.3.2/3.3 的 Durable recovery 文件。升级时仅生成脱敏数量/状态审计报告，禁止重复发送付费请求。

### 3.3 直接验证零请求

每个场景记录 `Provider outbound requestType`，而非只看“Token 统计刷新后为空”：

| 场景 | 必须出现 | 必须为 0 |
|---|---|---|
| 完整对话结束 | `final_summary`（按需） | `memory4_durable` |
| 正常重启有旧 Durable Recovery | 无自动付费 Durable | `memory4_durable` |
| 未完成 Narrative Recovery | `memory_recovery`（必要时） | `memory4_durable` |
| Legacy 历史召回 10 次 | `chat`（按需） | `memory4_durable` |
| 编辑/删除/导入旧摘要 | 原地合法操作 | `memory4_durable` |
| 访问任意摘要 UI | 只读 UI 数据 | `memory4_durable` |

**Gate 1（最高优先级）**：上述路径 Durable outbound = **0**；即使发现意外旧异步任务也不能发送。

---

## 4. Phase 2 — 恢复真正的 Legacy-only NPC 对话召回

### 4.1 复用已经存在的旧路由，严禁新造摘要仓库

核心：`src/app/main/memory-system/memory-engine.js:1777–1786, 1985–2052` 当前已有未启用 Memory4 时的 Legacy 路由；`src/app/main/conversation/conversation.js:829` 将 `memory4RecallEnabled` 写死为 `true`。

- 将生产 `useMemory4` 恒为 false，**更优做法是彻底移除该分支和参数**，使其只存在一个 Legacy route；不能停留在 UI 开关但后台仍加载 Memory4 的半退休状态。
- 删除 `memory4Packet`、`fitMemory4Context`、`pendingMemory4Focus`、`memory4Focus`、`memory4Recall.validateHistory` 和动态 Detail 选择；清理 Legacy/Memory4 混合缓存中的陈旧 state，不让它参与会话。
- 动态 Extra 恢复现有 `temporal → entity_target → mentioned → topic → important` 的 Legacy 候选来源；**不能**把 Memory4 分支结束时的 `extra=[]` 留下来。
- 当玩家直接问“你还记得我们上次谈的事吗”，恢复 `turnRecall.detectIntent` + `directRecallId` 的 query-prioritized 原始摘要摘录；不能只注入两条片段化 Durable 事实。
- **固定 Direct/Stable 摘要**：继续保留当前本场冻结机制、最近的双人摘要及 Legacy 重要事项。减少叙事信息损失的首要条件是有用的 Legacy 原文真正进入 Prompt，而不是仅仅留在硬盘。
- 时间类检索：复用 `summary-date-index.js`、`fuzzy-temporal-resolver.js` 和独立来源日期注记。Year/Life 磁盘派生保持退役，不从 Detail 中构造年度事实。
- 独立人物识别仍以 Owner/在场窗口/已授权 KnownBy 的 Legacy 证据为准，不读取 Memory4 的 `known-entities` 快照作为额外记忆。
- 保留既有 Token 安全预算、Provider 上下文限制及摘要防重复。**不能以“全文保留”为由把 100 篇摘要全部发进 Chat Prompt。**

### 4.2 叙事质量验收指标（不只看 PASS 数量）

使用同一模型、同一摘要素材及已知游戏状态，录制以下问题的 Prompt 历史记忆内容：

1. **关系语境**：“上次为什么会吵架？”需要对话背景与人物动机，而不只是“有争执”。
2. **承诺前因后果**：“当初你为什么答应帮我？”要有条件、谈判与角色态度。
3. **旧事件回忆**：“多年前谈起的战争结果与听闻是什么？”能分别表达见闻和事实。
4. **同一人物后续会话**：NPC 能延续身份和关系，不把缺少映射证明当成失忆。
5. **不同人物隔离**：NPC 不把自己缺席期间的耳语/私谈内容当作已知。
6. **多轮追问**：“那后来呢？”跟进同一 Legacy 记忆的内容与时间线。
7. **删后验证**：已撤销的旧摘要不得继续出现在任何固定摘要、缓存或重启后的动态召回。

必须在 Trace 显示**Legacy 摘要来源 ID、选中的直接/动态条数及被截取字数/Token、最终注入块**；仅凭模型主观输出评价不足以定位遗漏。

### 4.3 不允许的“回退”

- 不能关闭 Final Summary 或仅使用 Rolling Summary。
- 不能解除 Legacy `knownBy`、Campaign、Owner、在场/知情授权，以换取看似更好的召回。
- 不能恢复已退役的 Year/Life，不能把当前游戏事实替换成历史摘要里的旧事实。
- 不能增加额外的 LLM 对话总结 Agent 或 Embedding/RAG 服务以填补移除 Durable 后的空缺。

**Gate 2**：相同 Legacy 数据下，所有主要场景存在合法的相关摘要注入；无 Memory4 文本或索引被读取/注入；普通 RP 的上下文连贯性至少与关闭 Memory4 的已存在 Legacy 路由一致。

---

## 5. Phase 3 — 恢复 Legacy 编辑、Forget 与数据隔离（关键数据安全）

### 5.1 当前已确认的致命耦合

`memory-engine.js:340–388` 中 `forgetSummaryProjection()` 先调用 `this.memory4?.forgetSummaryProjection()`；如果不存在 Memory4，会产生 `SKIPPED`，随后的 fail-closed 校验会抛 `MEMORY4_FORGET_INCOMPLETE`。**因此绝不允许直接 `this.memory4=null` 然后宣布完成。**

### 5.2 新的唯一有效 Forget 路径

- Legacy 摘要删除只依赖原有 Legacy/ Episode / Owner knowledge/人物目录的**可证明来源边界**。
- 保留原先 `resolveSummaryProjection()`、按人物和双人片段校验的 `memoryIds`、`sourceMessageIds`、`finalizationId`、`knownBy` 过滤，禁止对话级过宽删除。
- 将原有 `forgetSummaryProjection()` 的 Legacy 撤销和 Episode 调整整理为**可回滚的事务**：先完成权限/归属/涉及文件验证，再提交撤销，异常恢复到前态。借鉴当前 `summaryMutation` 事务，不得简化为多次无回滚的 `unlink`。
- Memory4 Forget 不再作为操作先决条件，Legacy 删除也不得操作旧 Sidecar 数据。旧 Sidecar 永久**不接入生产读取/召回**，所以其保留不会让已忘内容“从 Durable 再回来”。
- 清理当前及其它活跃会话的 `responderRecallCache`、`direct/mentioned/stable/dynamicExtra`、`dynamicRecallHistory`、topic/temporal focus、持久化索引缓存。避免“摘要删了，但本次会话仍在注入已冻结内容”；已发送给 Provider 的历史不能撤回，要明示只保证后续新请求不引用。
- 双向人物删除不能越权：删除一方归档不意味着另一方仍合法保存的私人摘要被跨 Owner 删除。
- 既有手工编辑摘要后，后续检索应读取新 `revision`；拒绝写错 Owner/Campaign 和陈旧覆盖。
- 若老 Sidecar 的知情状态曾影响 UI，仅从原始 Legacy 授权和实时 CK3 状态推导可显示内容，不再显示“来源映射未验证”的 Memory4 专用标签。

### 5.3 旧数据的安全策略

- **默认保留惰性旧 Sidecar**：没有 Memory4 生产 reader、writer、scanner；可以在迁移审计中只统计文件数量/哈希，不打开其正文。
- 无须为已提交的 Durable 建立新的墓碑、迁移为 Legacy 或自动重提取，也**不能声称其内容已转存**。
- 不自动把已保存的 Durable 结构化事实复制入 Legacy。否则可能把旧的 rumored/pending/unknown 状态错误转化为叙事事实。
- 允许后续单独提供带范围预览、备份、显式确认、事务恢复的 **Legacy-independent Durable archive purge**；这是数据清理选项，不是 V9.3.4 运行门禁。
- 同样不自动触发原 Year/Life 迁移或清理；两项退役数据分别处理，绝不组合 `rm`。

**Gate 3**：Legacy CRUD + Forget 在完全不存在 Memory4 实例、原 Sidecar 目录被临时隐藏、Sidecar 损坏、Sidecar 文件存在但不可读四种环境均可安全运行；无越权读取、无已删除事实重新召回。

---

## 6. Phase 4 — 物理移除 Durable 专属生产代码与 UI

### 6.1 Main / IPC / Renderer

- 摘要管理页改成 **Legacy 摘要主视图**：人物/双人对象、日期、摘要正文、重要事项、编辑/删除/重读、合法的时间过滤、摘要分页；先复用原已存在 `legacyContent` 与旧摘要 UI，不要为退役另外重做一个记忆库。
- UI 不显示 `memory4-manager.js` 现有四页签中的 Memory4 `known`、`detail`、`coverage`；`official` 若仍为独立 CK3 功能，应在原旧摘要 UI 中保留或迁移，不得因为与 Memory4 同组件而被删掉。
- `memory4-manager.js`、`memory4-manager.css`、Renderer 事件绑定、`preload` 与 `register-ipc` 中的 `memory4:getCoverage/getEntry/getSources/getOwnerData/mutate/audit/forget` **应从生产注册中删除或完全解除暴露**，而非仅隐藏按钮但仍然保留可访问持久化接口。
- 删除来源 Coverage 的哈希表、当前 CAPPED/NO_DURABLE_CONTENT 文案、8 条配额显示、Legacy Recompression 按钮、Memory4 完整性扫描 UI 等。
- 若当前摘要页由 `Memory4Manager({legacyContent})` 承载，先把 Legacy 组件拆出并证明可独立运行，再清理原四页签容器，防止失去全部摘要操作能力。
- 清理用户可见的版本名称、诊断页能力说明和已废弃的 Durable 选项，不得误写“Memory Engine 4.0 仍在运行”。历史 `.md` 文档保留为审计资料。

### 6.2 删除依赖，不误删共享基础

涉及源码应精确审计：

- `src/app/main/memory-system/memory4-coordinator.js`（提取与 Legacy recompression）、`memory4-recall-planner.js`、`memory4-evidence-planner.js`、`memory4-coverage.js`、`memory4-store.js`、`memory4-contract.js`、`memory4-profile.js`、`memory4-disclosure.js`、`memory4-entity-context.js`、`memory4-relationship-readback.js`、`memory4-visibility.js`、`memory4-forget.js`、`memory4-legacy-bridge.js`、`memory4-orphan-audit.js`、`memory4-source-validity.js` 等，逐个检查**非 Durable 生产调用者**后再删除。
- `memory-engine.js`、`conversation.js`、`summaries-manager.js`、`register-ipc.js`、`preload.js`、`memory-store.js`、Prompts 与构建列表均可能引用 Memory4。先确保新的 Legacy-only 分支验证通过，再消除生产引用。
- `character-identity.js`、`perspective-projector.js`、`summary-date-index.js`、`finalization-visibility.js`、`memory-ranker.js`、`memory-extractor.js`、`rolling-summary-manager.js`、`scoped-json-repository.js` 是可能仍被 Legacy 使用的共享能力，**不能凭名称与 Memory4 同目录就删**。
- 如果某段知情/Forget 核验依赖 Memory4 Contract 或来源工具，应把其中真正通用的函数迁移到独立 Legacy 模块，**不得降低验证强度**；禁止为了通过旧测试设置无条件 `true`。
- 任何 `requestType=memory4_durable` 网络发送路径，除隔离的安全负测/历史文档外都必须消失；出站硬门禁作为防回归安全阀可以保留。
- 不要修改旧版 V9.3.3 历史报告声称“从未存在 Durable”，审计资料需要可追溯。

### 6.3 构建与版本

- `package.json`、`src/app/package.json`、`src/app/main/version.js`、渲染器版本文案/标题更新为 **9.3.4**；不重写二进制 Git 属性，保留 V9.3.3.1 已修正的 CRLF/二进制规则。
- 构建产物只能由源码构建产生，禁止单独改 `resources/app/out` 绕过 parity。
- 审查原来四段版本触发的 `electron-updater` 禁用保护，不得重新打开 fork 更新或另行发送网络请求。
- 最终生成 `V9_3_4_CHANGED_FILES.md`，区分删除的 Durable 专属文件与迁出的通用来源授权工具。

**Gate 4**：生产文件与打包 Electron 中不再有 Durable 功能入口、后台进程、Provider requestType 或 Sidecar writer；界面只展示合法 Legacy 摘要/独立保留的官方信息；源码/部署哈希与版本一致。

---

## 7. Phase 5 — 统一发布门禁、实际回归与成本验收

### 7.1 必需的自动化 Golden

新增 `scripts/test-v9.3.4-legacy-retirement.js`、`scripts/test-v9.3.4-legacy-recall.js`、`scripts/test-v9.3.4-legacy-forget.js`、`scripts/test-v9.3.4-no-durable-outbound.js`（具体按现有测试规范调整名称）。至少覆盖：

| 测试组 | 明确断言 |
|---|---|
| 出站归零 | 结束、恢复、重启、跳转摘要、两次手动操作、10 次召回后 `memory4_durable` 总请求数为 0 |
| 旧 pending Durable | Narrative 成功时不会因 Durable pending 卡住、要求重提取或清理错误的 Legacy recovery |
| 真正 Narrative 失败 | `memory_recovery` 仍可恢复并继续保存摘要 |
| 直接对话历史 | 用户追问往事能召回双人摘要关键原文，不仅是结构化 Detail |
| 叙事完整性 | 冲突、谈判条件、情感态度、时间、重要事项均在候选摘要中可见 |
| 多人隐私 | 未入场/已离开/私密耳语的内容不会进入无授权 Owner 的历史记忆 |
| 已遗忘内容 | 删除后当前轮后续请求、重启、换对话均无法再次召回该 Legacy 来源 |
| 老存档兼容 | 有旧 Sidecar / 损坏 Sidecar / 缺失 Sidecar 均能加载与保存新的 Legacy 摘要 |
| UI | 可浏览、展开、查看正文、编辑、删除、分页；Durable 专有页签、统计、按钮完全消失 |
| Year/Life | 旧派生仍不生成，年份/生平问句仅依靠 Legacy 日期索引回答 |
| Action/GLM | 不修改派发语义与 Provider outbound 黄金字节（明确版本字段除外） |
| Git Windows checkout | V9.3.3.1 `.ico`、PNG、OTF LFS/CRLF 合同仍 PASS |
| Run-time parity | source-build-deploy hashes、真实双 profile 打包 Electron 正常 |

现有 V9.3.2/3.3/3.3.1 专属于 Durable 的测试可能不再适用于生产。**不要偷偷删除或把失败标为 PASS**：逐条归档到历史测试或替换为“退休反向断言”，测试总数变化必须披露。保留 Legacy、Action、Provider、Worldline、UI 相关的完整有效回归。

### 7.2 场景实机测试（验收与发布测试分离）

1. **新对话**：与 NPC 谈判 20–30 轮，结束后查看 Legacy；重要事项存在，Durable 请求为 0。
2. **长对话**：80–100 轮，包含多次条件承诺、传闻、争论；结束后摘要完整、没有 Durable 批量请求。
3. **跨会话**：完全退出/重新进入 CK3，同两人重新对话；准确讲述原冲突原因及事件细节。
4. **跨年代**：询问以前谈过的战事/人物关系；合法 Legacy 时间索引起作用，Year/Life 无新文件。
5. **多人安全**：一名 NPC 未在场听到私谈；重新见面时不能知道旧秘密。
6. **删除**：删除一份旧 Legacy 后，刷新和重启不会再次注入该来源；同场对方仍合法持有的摘要不因一个 Owner 的删除而被越权清空。
7. **成本**：新建独立计数窗口，以相同模型/相同会话设计按 `chat/action/final_summary/memory_recovery/memory4_durable` 区分；最后一项必须严格为 0。

不要对旧累计统计直接作“节省 70%”等绝对结论。可记录 `Durable 归零`、`每完成一场对话的请求数与 Token`、`历史细节人工正确率`。

### 7.3 远端 CI

必须在**最终 main HEAD SHA**上确认 `Release Regression` 完整 `success`；Windows 清洁检出的首次部署与发布测试全部运行，不能仅接受本地 `PASS`。实际 CK3 验收必须另行记录，不得由合成数据冒充。

---

## 8. 数据迁移和版本边界（失败恢复设计）

- **默认不做 Durable → Legacy 转换**：这种转换会误把已知事实、传闻、未知状态、条件承诺当成确定剧情，且用户不接受额外 Token。
- 旧 Memory4 Sidecar 中 `entries`、索引、恢复、Forget 墓碑、`known-entities` 不再被生产扫描，也不再发生写入；默认保留原字节，并在迁移清单中标注 `RETIRED_INERT`，**这只是审计标签，不写入旧 index**。
- `legacy-summary` 原文与其 Campaign/Owner 绑定不变；升级时不为了取消 Durable 而重写或重新生成所有 Legacy。
- 若旧 `summaryMutation` 事务正在进行：先恢复或确认事务状态，再启动 Legacy-only writer；不能在数据不一致时以“Durable 已退休”为由跳过原有审计。
- 如想彻底清理 Durable 磁盘：未来单独的、需要玩家确认的清理命令；先 dry-run、SHA-256 清单、备份、范围确认、可中断恢复；默认 V9.3.4 不执行。
- 任何遗漏的旧 Durable hook 必须记录为**工程错误**，不能后台自愈并默默发送付费请求。

---

## 9. 不允许出现的“完成但假成功”

1. **只删除摘要 UI 页签，后台依然 `memory4_durable` 请求。**
2. **只把 `memory4RecallEnabled=false`，Final Summary 和 Recovery 仍然抽取 Durable。**
3. **只把 `memory4=null`，Legacy 的 Forget/删除因此失效。**
4. **依旧自动把 Legacy 转为 Durable，反过来用其 `complete` proof 抑制 Legacy 原文。**
5. **删掉原始 Episode / Owner summary / `summary-date-index` / 有效 `knownBy` 过滤或 CK3 官方读取。**
6. **把退休状态标成 `NO_DURABLE_CONTENT`，污染老存档可信提交证据。**
7. **用“Legacy 的完整对话”名义无预算地注入全部存档文本，造成普通聊天成本激增。**
8. **用禁用知情隔离来修复召回不够完整。**
9. **把旧 Year/Life 物理派生重新激活。**
10. **删除所有历史 Durable 文件以表示退休成功；退役成功的定义是生产无调用，而非破坏历史数据。**

---

## 10. 交付文档与验收输出

施工完成后必须提交：

- `docs/current/v9/V9_3_4_IMPLEMENTATION_REPORT.md`：每一条旧 Durable 生产入口的切断方式、留下的公用来源功能说明。
- `docs/current/v9/V9_3_4_VERIFICATION_REPORT.md`：自动化、原生 Electron、实机与 CI 单独报告，不能混同。
- `docs/current/v9/V9_3_4_CHANGED_FILES.md`：新增/修改/删除/归档一览，尤其说明为什么 Legacy UI/Forget 可以独立运行。
- `docs/current/v9/V9_3_4_RETIREMENT_AUDIT.json`：**仅脱敏计数、路径类别、SHA、测试结果、出站类型计数**；不提交真实人物摘要或用户记录正文。
- `CHANGELOG.md`、`README.md`、当前版本入口及必要的 AGENTS.md 更新，历史文档不覆写。

**最低验收证据字段**：`runtimeVersion`, `headSHA`, `releaseGroupsPassed`, `remoteCI`, `durableOutboundCount`, `durableRecoveryTriggeredCount`, `legacySummaryCommittedCount`, `legacyRecallInjectedIds`, `forgetRegressionPassed`, `sidecarWriteCount`, `oldSidecarIgnored`, `ck3ManualGate`。

**Gate 放行条件**：

```
G0 旧功能与边界清单                PASS
G1 Durable outbound / 自动恢复 = 0 PASS（阻断）
G2 Legacy 全流程召回              PASS（阻断）
G3 Legacy 编辑/Forget 独立安全     PASS（阻断）
G4 Durable 生产/UI 物理清理        PASS（阻断）
G5 本地回归和 Windows 打包         PASS（阻断）
G6 最终 main SHA GitHub CI          SUCCESS（发布门禁）
G7 CK3 实机记忆效果与成本          人工验收，缺失不得宣称 Full Freeze
```

---

## 11. 可直接交给 Codex 的执行指令

> 请按 `docs/current/v9/V9_3_4_DURABLE_RETIREMENT_IMPLEMENTATION_SPEC.md`（如文件置于项目中，按实际文件路径）实施 **V9.3.4 Durable 完全退役**。先验证 main 基线和测试存档，再依 G0→G7 顺序施工。核心目标是 **零 `memory4_durable` 付费调用、零 Durable 动态召回/重压缩/恢复、Legacy 摘要作为唯一历史交谈记忆**，并保留 Legacy Final Summary、Rolling Summary、多人知情隔离、旧摘要编辑与安全删除。特别注意 `memory-engine.js:forgetSummaryProjection` 目前依赖 Memory4 成功才能删除；必须先事务化解耦后再删除 Memory4。不得自动删除任何历史 Sidecar/Year/Life/Legacy 用户数据，不得假造旧完成证明、跳过失败测试或关闭 CI。严格源码→构建→部署 parity；本地测试不触发付费 Provider；生成实施、验证、退役审计和改动文件清单。不要自动推送到远端，等待用户核验。

---

### 参考源码（锁定基线）

- [Memory Engine：召回路由与 Durable 替换动态 Extra](https://github.com/wsdsb-111/VOCT-NEW/blob/3c1c2162e63f587bf920c8670bc88f9c263ac0f1/src/app/main/memory-system/memory-engine.js#L1777-L2052)
- [Memory Engine：Final Summary 之后的 Durable finalization](https://github.com/wsdsb-111/VOCT-NEW/blob/3c1c2162e63f587bf920c8670bc88f9c263ac0f1/src/app/main/memory-system/memory-engine.js#L1305-L1336)
- [Memory Engine：Legacy Forget 对 Durable 的依赖](https://github.com/wsdsb-111/VOCT-NEW/blob/3c1c2162e63f587bf920c8670bc88f9c263ac0f1/src/app/main/memory-system/memory-engine.js#L340-L437)
- [Conversation：Final Summary 与 Pending Recovery 的 Durable Provider 回调](https://github.com/wsdsb-111/VOCT-NEW/blob/3c1c2162e63f587bf920c8670bc88f9c263ac0f1/src/app/main/conversation/conversation.js#L2075-L2141)
- [Conversation：Legacy 召回触发后台 Recompression](https://github.com/wsdsb-111/VOCT-NEW/blob/3c1c2162e63f587bf920c8670bc88f9c263ac0f1/src/app/main/conversation/conversation.js#L1065-L1080)
- [Memory4 Recall：有条件抑制 Legacy 原文](https://github.com/wsdsb-111/VOCT-NEW/blob/3c1c2162e63f587bf920c8670bc88f9c263ac0f1/src/app/main/memory-system/memory4-recall-planner.js#L274-L302)

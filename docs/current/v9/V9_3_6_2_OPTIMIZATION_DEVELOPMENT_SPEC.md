# VOCT V9.3.6.2 优化与修复开发文档

> **交付类型**：可直接交给 Codex 的施工规范（`.md`）<br>
> **目标版本**：Core / App / UI `9.3.6.2`<br>
> **仓库**：[`wsdsb-111/VOCT-NEW`](https://github.com/wsdsb-111/VOCT-NEW)<br>
> **冻结基线**：V9.3.6.1 `fbe8cc3fc1abc45c6e41bb6ba16bc00e0dc46c54`；运行代码提交 `3e4118169e2b3a49ae2ea3139f77e0bfbc2d129d`<br>
> **文档状态**：**待实施，本文不代表代码已经完成、测试已经执行或实机已经验收**<br>
> **施工目标**：解决跨 Pair 历史召回的秒级乃至数十秒阻塞、GLM 新配置 Auto→8192 Token 的兼容性退化、历史意图漏召回及否定作用域误判；继续保持 V9.3.6 / V9.3.6.1 的权限和请求预算安全合同。

---

## 0. 版本定位与发布结论

本版是**有明确性能验收门槛的修复版本**，不是 V9.4 功能开发，不得用“测量与诊断已完成”替代跨 Pair 提速的实际交付。

| ID | 优先级 | 问题与目标 | 本版交付要求 |
|---|---|---|---|
| **PERF-01** | **P1，发布阻断** | 300 Pair 暖态历史检索约 41.7 秒 | 必须实现正确的候选缩减或等价优化，并满足性能门槛；不能再只补指标 |
| **CFG-01** | **P1，发布阻断** | 新 GLM 默认 Auto + 无可信窗口元数据 → 8192 Token | 恢复新配置可用的明确兼容默认；保留用户选择与有效窗口提示 |
| **INT-01** | **P1，发布阻断** | 历史查询被“后来 / 之后 / 准备”误判成 L0 | 修复历史与未来的时间语义边界，保证合法历史召回 |
| **INT-02** | **P1，发布阻断** | 否定词全消息扫描误伤后续合法问句 | 按分句限定否定范围，复测混合语句 |
| **CFG-02** | P2 | Auto 未知模型的回退状态和来源解释不清晰 | UI、IPC、Diagnostics 中保持可观察且不伪造能力 |
| **BUD-01** | P3 | `customContextLength=256` 可保存但几乎不能发送正常 Prompt | 加入实际可用余量校验和易懂提示 |
| **QA-01** | P1 | 缺少大规模跨 Pair、复杂语义与真实 Provider 边界证据 | 完成独立专项与既有全部 Release QA；真实性分层标记 |

**发布策略**：安全正确性与跨 Pair 可见性能是双重门禁，任何一项失败不得标记为 V9.3.6.2 已完成；如确实需要缩小范围，应修改版本目标和报告，而不能让测试结果迁就实现。

### 0.1 V9.3.6.1 基线的实际证据

其仓库报告给出的合成暖态中位耗时：

| Owner Pair 数 | warm P50 | warm P95 | 单次索引逻辑读取数 |
|---:|---:|---:|---:|
| 5 | 45.5 ms | 58.5 ms | 10 |
| 30 | 743.9 ms | 873.2 ms | 60 |
| 100 | 6,739.8 ms | 6,795.0 ms | 200 |
| 300 | 41,658.5 ms | 42,389.4 ms | 600 |

参考：[`V9_3_6_1_PAIR_RETRIEVAL_BENCHMARK.md`](https://github.com/wsdsb-111/VOCT-NEW/blob/fbe8cc3fc1abc45c6e41bb6ba16bc00e0dc46c54/docs/current/v9/V9_3_6_1_PAIR_RETRIEVAL_BENCHMARK.md)。**这些是 Windows / Node 合成数据，不是 CK3 实机。300 Pair 冷态仅一个样本，统计置信度不足；所有性能比较都必须记录新的样本量、环境和原始值。**

### 0.2 不可破坏的 V9.3.6 合同

- 每个回应 NPC 的固定记忆始终是 `Owner → trusted Player`，不能改为“最近发言者”。
- 只有当前可信玩家轮次才有权触发第三人历史；NPC/旁白/引用/同名歧义无权授权。
- **L0**：第三人历史索引与来源读取均为 0；**L1**：每目标最多 16 条事项，不读取来源全文；**L2**：**至多 2 次总 Source Resolve 尝试**（含失败、race、fallback）。
- 任何情况下不得读取反向私有视角，例如 `B→C` 可见不等于 `C→B` 可见，也不能读取 `D→C` 的外部 Owner 历史。
- Campaign、角色 ID、游戏日期、Forget、Source Key / Revision、确认状态、权限和时空有效性必须延续。
- Memory Budget 保留 2 / 3 / 4+ 人 `16% / 18% / 20%` 和 `4800 / 5600 / 6400` Token 硬顶，沿用 Conversation 首次人数冻结规则。
- Prompt 格式化、Provider `beforeSend`、重试、LENGTH continuation 继续检查完整请求预算、来源与记忆 span/fingerprint；不得因缓存或扩窗绕开。
- NPC→NPC 摘要合法写入、Recent1、官方追忆、Legacy、信件、官方行动及 Worldline 不变；Durable / Year / Life 生成保持退役。
- 未经明确授权，不改真实 `%APPDATA%`、CK3 存档、真实密钥，不产生付费推理调用，不自动推送远端。

---

## 1. PERF-01：跨 Pair 检索从全量扫描改为可证明完整的候选目录（P1）

### 1.1 精确定位当前阻塞路径

基线位置：

```text
src/app/main/memory-system/pair-memory-source-retrieval.js
  retrieveThirdPersonHistory()
  collectOwnerCounterpartIds()

src/app/main/memory-system/pair-long-term-ledger.js
  PairLongTermLedger.loadSnapshot()
  PairLongTermLedger.collectSources()
  PairLongTermLedger.read()
  PairLongTermLedger.invalidate()

src/app/main/memory-system/memory-store.js
  invalidateFolderSummaryCache()
  getFolderSummarySnapshotRevision()
  hasPairLedgerSourceChanges()
  hasPairLedgerSourceContentChanges()
```

当前 `retrieveThirdPersonHistory` 将直接目标 Pair 与 Owner 的其他全部 Pair 合并成 `scopes`，随后逐个 `pairLedger.read()`，最后为全部已读 Pair 再次执行修订复验。300 Pair 时，基准发生 600 次显式 read。**不能只去掉第二次复验**，否则可能把过期来源重新发给模型；也不能简单为 `scopes` 增加 Top-N 截断，因为 `B→D` 中涉及 C 的合法转述会丢失。

### 1.2 优化思路：Owner 级保守候选目录（非新的记忆权威）

基于当前 Owner 已加载的、经过现有契约筛选的 Summary Snapshot，建立一个**轻量、可撤回、仅用于候选筛选**的 `OwnerTargetCandidateDirectory`。它不是新的 Legacy、不是向量数据库，也不是新的事实存储。其目的只有一个：在查询目标 C 时，快速定位**可能**包含 C 的 Pair，而不是打开 B 的每个 Pair。

```text
当前：B 问 C 的历史
  → 收集 B 的全部 Pair（5 / 30 / 100 / 300 ...）
  → 每个 Pair.read() + 缓存/来源校验
  → 筛事项、排序、取 ≤16
  → 再次遍历所有已读 Pair 做来源修订核对

目标：B 问 C 的历史
  → 验证当前 Owner B / Campaign / Snapshot / 角色别名版本
  → 从 OwnerTargetCandidateDirectory 获取可能的 {B→C, B→D, ...}
  → **只对候选 Pair**调用现有 PairLedger.read()
  → 沿用原来的可见性、事项打分、来源 Key/Revision 核对
  → 只对已读取的候选 Scope 做第二次复验
  → Prompt beforeSend 仍做最终时效门禁
```

**目录只允许误收（false positive），不允许漏收（false negative）。** 即可能多扫描某个 Pair，但不能因为索引欠完整跳过合法的跨 Pair 转述。

### 1.3 从源快照建立安全的候选集

优先复用 `MemoryStore` 已拥有的 `ownerSnapshot` 和每条来源的 `provenance.pairLedgerSources`：

1. 枚举当前 Owner/Campaign 可见的来源；仅使用已验证 `folderOwnerId`、`knownBy`、`source.ownerId`、`source.counterpartId`、`ownerAuthorized`，且满足当前项目原有 Summary/Source 资格判断的来源。
2. **直接 Pair 永远纳入候选**：明确询问 C 时，无论有没有别名命中，都加入 `Owner B → C`（若该 Pair 作用域合法）。
3. **跨 Pair 的保守证据**：从同一 Owner 来源的 `rawSummary.content`，使用与既有事项抽取一致的 `parseImportantMatters()` 与别名规范化规则，计算“可能包含目标 C 事项”的 Counterpart 集合。可以用整段可信来源文本的别名命中作为**更宽的候选超集**，但不能仅使用 SearchTerm 命中、Top-N、语义相似度或只索引最热门人物作为唯一候选依据。
4. 必须证明原有 `isRetrievablePairLedgerItem()` 可见事项中，凡是旧算法凭别名匹配可检索的 Cross-Pair 事项，新目录均将其 Counterpart 纳入候选。对**旧 Legacy 无法解析、歧义别名、旧索引来源不全、暂时缺少原文或无法证明文本包含关系**，应标记覆盖不完整并回退安全旧路径，**不能当作空结果**。
5. 使用当前 `buildEntityProfileIndex()` 生成的**唯一别名集合**进行动态映射；同名未解析、别名变化、头衔变化及大小写/Unicode 规格化必须一致。不要仅靠同一字符串推断不同角色 ID。
6. 索引条目建议存 `counterpartId / ownerId / campaignToken / snapshotRevision / sourceIdentityFingerprint / aliasProfileFingerprint` 等最小元数据；避免持久化原文、玩家输入、密钥、姓名和其他敏感数据。
7. 首版可采用**进程内 Map + 有界 LRU**；如果为了启动时性能必须做持久化派生缓存，需单列迁移/完整性/损坏恢复验收，不得把未验证的磁盘目录作为真值。

**关键实现选择**：优先在 Owner 快照加载/失效事件中构造或更新目录，或在第一次查询时对**Owner Snapshot 做一次线性轻量预筛**，不得在目录构造过程中重放 300 次昂贵的 `PairLedger.read()`。这就是本版区别于“把全量扫描换一个名字”的核心要求。要用 profile 证明首轮构建的时间不重新变为 40 秒。

### 1.4 推荐接口（示意，命名可按架构调整）

```js
// 伪代码：仅代表合同，不可未经适配直接贴入生产。
OwnerTargetCandidateDirectory.getCandidateScopes({
  ownerId,
  campaignToken,
  targetCharacterIds,
  ownerSnapshot,
  snapshotRevision,
  profiles,
  currentGameDate,
  currentTotalDays
}) => {
  status: 'COMPLETE' | 'STALE' | 'UNAVAILABLE' | 'AMBIGUOUS',
  candidateCounterpartIds: number[], // DIRECT + 可能含目标的 CROSS
  coverage: 'CONSERVATIVE_SUPERSET',
  snapshotRevision,
  profileFingerprint,
  candidateCount,
  constructionMs,
  cacheHit
}
```

读取端建议拆成 `collectCandidateScopes()`、`readAndVerifyCandidateScopes()`、`rankCandidates()`，但**保持现有 scoring/order、每目标 Top16、L2 Resolve≤2、Budget 裁剪与 Forget 复验的行为不变**。直接 Pair 和 Cross-Pair 的优先级不能被优化改变。

目录发生 `STALE / UNAVAILABLE / AMBIGUOUS`：使用旧扫描路径；同时上报 fallback 原因、耗时和次数。安全回退可以慢，但**不能悄悄绕过性能验收**：若正常长档经常回退，PERF-01 仍判失败。

### 1.5 防止快路径跳过新变更：失效与双重验证

Owner 目录完整性不等于实时数据可见性，必须继续进行**权威验证**：

- 目录 Key 至少包含 `campaignToken + ownerId + ownerSnapshotRevision + aliasProfileFingerprint`；必要时加入本地 mutation epoch / index algorithm version。
- 对来源新增、修改、删除、离线事项确认、Summary 合并、更名、角色资料变化、Forget、Campaign/Scene 变更，以及任何调用 `PairLongTermLedger.invalidate(ownerIds)` 或 `MemoryStore.invalidateFolderSummaryCache(ownerIds)` 的路径，同步处理候选目录失效。`invalidate(null)` 必须全清。
- 初次筛选与最终格式化后均检查 Owner 级快照版本是否变化；命中的每个 Pair 仍通过原 `PairLedger.read()` 获得有效事项和 `sourceRevision`，在末尾只复验**该轮读过的 Candidate Scope**。如果全局版本或任一候选来源变化，**丢弃整次动态第三人结果并重试或拒绝**；不得拼接半旧半新的索引结果。
- `PairLedger.resolveSource()` 仍执行现有 Source Key/Revision、真实来源内容、相对路径和游戏日期核对。不得仅凭候选目录声称来源可信。
- 目录的“没有 C 候选”只有在 `coverage=COMPLETE`、当前快照仍有效、所有相关别名状态可证明覆盖的情况下才能意味着 Cross-Pair 无命中；否则 fallback，不得省略读取。
- 若来源竞争造成 L2 已尝试一次失败，然后进入其他候选或 Legacy fallback，**全链路累加**尝试次数，总数仍 ≤2。
- 防止同一 Owner 的不同 Campaign / 不同用户存档以及不同 Owner 互相复用目录。目录不可从 C 的 Owner 文件夹读取 B 不可见的事项。
- 最终 `beforeSend` 若检查到源已 Forget 或修订已变，必须拒绝发送；性能优化不得以暂存旧 Prompt 绕过检查。

### 1.6 消除热路径额外开销（在正确性证明之后）

- **一轮只装载一次 Owner Snapshot**，沿用 `PairLongTermLedger.ownerSnapshots` / `MemoryStore` 的可信快照，不在 300 个 Scope 中重复计算所有 Summary 元数据。
- 对同一个候选 Scope，读取与复验的两次操作仍保留语义；可在 `PairLongTermLedger` 中暴露安全的轻量 `validateScopeRevision` 接口，但必须验证其与 `read()` 的来源变更检测语义等价。**不允许直接比内存 cache 的 digest 来代替磁盘/Forget 检查。**
- 避免查询过程中为每个目标重复格式化 item 文本或计算同一 aliasSet；分组排序和 `Map` 复用应是纯局部优化。
- 已有索引构建、读取与 Source Resolve 采用受控缓存，不得跳过 file signature、scope 检验、Source 不稳定错误。
- 如首次启动构建仍明显阻塞，可以进一步进行分阶段增量构建与可取消任务，但**禁止**在构建未完成时将局部目录视为完整，或让用户对话收到缺失历史的“正常成功”响应。

### 1.7 性能验收：必须显著击穿原 41 秒瓶颈

在同一机器、相同 Node 版本、同一人工数据生成器、相同 L0/L1/L2 分布下，与 V9.3.6.1 基线 AB 测试；运行期间尽量避免并发构建。不能仅复用旧报告里的单次样本。

| 场景 | 本版初始**验收目标**（非已测结果） | 额外限制 |
|---|---|---|
| 5 Pair，warm | P95 ≤100 ms | 不得相对基线明显退化 |
| 30 Pair，warm | P95 ≤250 ms | CandidateScope 与实际读取同步大幅缩小 |
| 100 Pair，warm | P95 ≤500 ms | 若只提速无关对象缓存，仍须分析算法规模 |
| **300 Pair，warm** | **P50 ≤1,000 ms、P95 ≤2,000 ms** | 重点发布门禁；须记录命中/未命中/跨 Pair 转述三类 |
| 300 Pair，cold（含目录首次构建） | 优先 P95 ≤5,000 ms；**未达须阻断完成声明并继续优化** | 不能把预构建时间从统计中删掉 |
| L0 | 第三人 PairLedger.read 和 resolve 均 0 | 性能提高不可引入 L0 后台全量扫描 |
| L1 | Source Resolve 0 | 索引事项与基线集合等价 |
| L2 | 总 Resolve attempts ≤2 | 失败、race、fallback 全计入 |

以上是**工程目标，绝不是当前版本的实际表现或产品 SLA**。基准必须至少 20 组 warm、10 组 cold 样本（每规模；若硬件耗时不可承担，应在报告解释并禁止宣称可信 P95）；分别报告 P50/P95、CPU、wall、内存峰值、构建耗时、命中率、Candidate Pair 数、PairLedger.read 次数、索引重建次数。另测 Owner Pair 数增长时的耗时曲线，验证热点路径与“全部 Pair 数”脱钩。

若 300 Pair 只有零星涉及目标 C，期望读取数趋近于 `2 × (直接 Pair + 真正候选 Cross-Pair)`；**不得承诺永远 O(1)**：当所有 Pair 都合法提及 C 时，完整召回确实需要更多读取，应单列 worst-case 及体验降级策略。

### 1.8 对照证明与故障注入测试

对同一固定快照，基于旧的**全量算法**构造 reference oracle，对比：

- 每个目标最终可见候选事项集（含来源键、修订、日期、owner/counterpart）、排序与足量预算下的选择结果。
- Direct Pair、跨 Pair `B→D` 转述 C、同名但不同 ID、过去改名、称号别名、无唯一别名、只出现在 Legacy 的来源。
- 多 Campaign/多 Owner 强隔离；`C→B` / `D→C` 绝不可见。
- 源添加、正文编辑、摘要重排、删除、Forget、重新确认、离线导入、场景切换、当前日期回退/前进。
- 在目录构建后、候选读取后、L2 Resolve 中途、末尾 scope 复验前、Provider beforeSend 前分别注入修订/Forget 竞争。
- 目录损坏、目录为空但不完整、快照版本缺失、别名变化、单一 Pair.read 抛错、内存 cache 命中但来源已更新。
- 不改变 `sourceResolveAttemptCount` 上限；新快路径与慢路径在相同输入下行为等价。

**通过标准**：对合法可见事项不得漏召回，对不可见事项不得新增越权召回；不允许以近似相似度或缓存命中率作为完整性证明。

---

## 2. CFG-01：修复 GLM 新默认配置 Auto→8K 的体验回归（P1）

### 2.1 已确认的代码路径

```text
src/app/main/main.js
  DEFAULT_PROVIDER_CONFIGS.zhipu = { contextMode: 'auto', ... }

src/app/renderer/assets/index-Dn3qWlAB.js
  DEFAULT_PROVIDER_CONFIGS.zhipu = { contextMode: 'auto', ... }

src/app/main/providers/index.js
  ZhipuProvider.listModels() 仅返回 id/name；无可信 contextLength

src/app/main/providers/request-budget.js
  Auto + 未验证模型上下文 -> DEFAULT_CONTEXT_WINDOW = 8192
```

**影响范围必须分清**：此前已有 `customContextLength=90000` 的配置仍保持 Custom 90K；但**新建 GLM 默认配置**，以及已由 V9.3.6.1 保存为 `Auto` 的 GLM 配置，在未知可信 Provider 窗口时只能按 8192 预算。这个 fallback **不是 GLM 模型的真实原生上限**，不能用它说明模型仅支持 8K。

### 2.2 低风险默认修复：新 GLM 采用“显式 90K 兼容预设”

对**新创建的默认 Zhipu/GLM Provider**，推荐默认值：

```js
// 约定：显式兼容预设，不是全局硬上限、不是已验证原生上限。
{
  contextMode: 'custom',
  customContextLength: 90000,
  // 可选内部标记；须过滤掉不能当作请求参数发送的字段：
  contextSelectionOrigin: 'bundled_legacy_compatibility'
}
```

说明：

1. 这恢复旧版本曾提供的 90K 默认**配置意图**，不是认定所有 GLM 模型原生支持 90K，也不意味着任何请求必定成功。
2. 用户应能把 Custom 改为 128K / 256K / 1M（最多遵守 V9.3.6.1 的 2,000,000 合法配置范围），**不能重新产生全局 90K 上限**。
3. 对已获得可信模型原生能力的服务商，仍使用 `min(custom, verifiedNativeContext)`；未知时标记 `user_provided_unverified` 或 `legacy_compatibility_unverified`，不伪造 `provider_native`。
4. **其他 Provider** 继续按各自现有 Auto/Custom 策略，不因为修复 GLM 就全局默认 90K。
5. Main 与 Renderer 的 GLM 默认配置必须同步，IPC、保存层与 Provider 对象不应夹带 UI-only metadata 到实际模型请求参数中。

### 2.3 处理现有 V9.3.6.1 Auto GLM 配置（不可无声改写）

由于旧配置可能来自用户有意选择 Auto，**禁止仅凭 `contextMode==='auto'` 就把旧配置暗中改成 Custom 90K**。建议 UI 提供一次明确的兼容引导：

> 当前 GLM 未提供经验证的上下文窗口。Auto 按 8,192 Token 安全回退；此前常用兼容设置为 90,000 Token（未经原生验证）。你可以选择“使用 90K 兼容配置”、继续 Auto 8K，或自行输入 Custom。

- 提供 `使用 90K 兼容设置`（用户显式点击才保存）、`保持 Auto`、`自定义` 三个真实操作入口。
- 引导只在 GLM 且 Auto/未知原生窗口时出现，不反复每轮弹窗；可在配置页持续显示状态提醒。
- 不读取、重写历史真实用户配置以猜测意图；新实例的默认值在创建时明确赋予 Custom，老实例沿用其已有设置。
- 用户改选模型时，显示该模型当下的能力来源，提醒旧 90K 可能不是新模型的真实窗口。

### 2.4 能力探测长期方案（非上线前硬依赖）

- 可以检查智谱已有**模型列表/元数据接口**是否真的提供可验证 `context_length`，但不得把未知字段、第三方传闻或硬编码“所有 GLM 1M”当成 provider-native。
- 若拿到可信、与 modelId/endpoint 对应且数值有效的元数据，才允许 Auto 使用它；否则维持用户 Custom 或安全回退并解释原因。
- 禁止为了查询上下文窗口额外发起付费生成请求；列表查询也要服从现有超时、缓存和中止机制。
- 通过正式 `capabilityCacheKey()` 保证模型、Provider、端点和模式改变即失效，不复用旧模型能力。

### 2.5 Context 与 Output Reserve 的联合行为

- `effectiveContext = min(validCustom, trustedNativeCap)`（可信 native 存在时）；未知原生能力不得无声夸大“已确认”。
- `planRequestBudget()` 继续扣除 token 估算、安全余量、`max_tokens` 输出预留和协议开销。
- GLM 的 90K Custom 如果 Prompt 非记忆部分足够大，仍必须由发送前守卫限制。
- 继续保留 Model/Route-specific capability cache；不得因为设置 UI 写入 `modelNativeContext` 而被主进程信任。
- 复核 V9.2.1 / V9.2.3 的 GLM 缓存稳定前缀、思考模式、重试、流式 usage 和 continuation，**上下文修复不得改动缓存提示词布局**。

### 2.6 GLM 强制验收用例

| ID | 输入条件 | 预期 |
|---|---|---|
| GLM-01 | 全新 GLM 默认实例、无可信原生元数据 | 默认为 Custom 90K，标记未验证；不再悄然按 8192 生效 |
| GLM-02 | 旧保存 `customContextLength=90000`、无 contextMode | 继续 Custom 90K，不改旧数据 |
| GLM-03 | 已保存 Auto GLM，原生元数据未知 | 保留 Auto 8K 和醒目提示，提供用户显式 90K 切换 |
| GLM-04 | 用户主动点击“90K 兼容设置” | 真实 IPC 保存 Custom 90000，再读回仍为 Custom |
| GLM-05 | 用户设置 Custom 120000 / 1048576 | 只要数值合法，不再被旧 90K UI/IPC 截断 |
| GLM-06 | Custom 120000，可信原生 65536 | effective=65536，并解释原生限制 |
| GLM-07 | Model A→B，Provider/Endpoint 改变 | 重新解析能力，不误用前一模型窗口 |
| GLM-08 | Auto 未知 | 必须显示这是“保守 8K 回退”，不是模型原生上限 |
| GLM-09 | GLM 长 Prompt 在 8K 以上、90K 以内 | Custom 90K 下可通过本地预算检查（不代表真实模型调用成功） |
| GLM-10 | 超出有效上下文、重试或 LENGTH continuation | 最终发送前明确拒绝 |
| GLM-11 | GLM 真实接口（**另行授权**） | 按模型核实实际可用窗口，记录 4xx、usage、缓存及思考表现，不伪造测试 |

---

## 3. INT-01：历史语义漏召回修复（P1）

### 3.1 V9.3.6.1 的分类缺陷

`src/app/main/memory-system/pair-memory-routing.js` 当前：

- `HISTORICAL_PATTERN` 删除了 `后来`。
- `CURRENT_FUTURE_PATTERN` 把 `之后`、`准备` 无条件当作未来证据。
- `classifyTemporalIntent()` 在一个分句中先检查未来词，命中则丢弃整句，不考虑明确的过去锚点。

因此可能出现：

| 玩家原话 | 错误现象 | 正确目标 |
|---|---|---|
| 玛蒂尔达后来怎么样了？ | `NONE` / L0 | 过去事件 L1，若要经过再 L2 |
| 战争之后你和玛蒂尔达发生了什么？ | `CURRENT_FUTURE` / L0 | 过去事件 L1/L2 |
| 当年你准备如何攻城？ | `CURRENT_FUTURE` / L0 | 历史询问，合法召回 |
| 记得把信交给玛蒂尔达。 | L0 | **仍应保持** L0 |
| 接下来打算如何安排玛蒂尔达？ | L0 | **仍应保持** L0 |

### 3.2 禁止继续堆叠互斥正则

改为**先分句、再做时间锚点/语气/动词时态意图组合**的纯函数。推荐输出结构：

```ts
interface TemporalClauseResult {
  text: string;
  kind: 'PAST_HISTORY' | 'CURRENT_FUTURE' | 'FOLLOWUP' | 'DENIAL' | 'NEUTRAL';
  historicalEvidence: string[];
  futureEvidence: string[];
  denialScope: boolean;
  explicitHistoryQuestion: boolean;
  mayRequestSourceDetail: boolean;
}
```

中文无形态时态，不能靠一个词给整个句子贴绝对标签。判定需综合：

- **历史锚点**：`当年/以前/曾经/战争之后/离开宫廷以后/后来怎么样了/过去发生什么`；`之后` 与已经明确发生的历史事件结合时应识别为过去，不视为永远未来。
- **未来锚点**：`明天/下次/准备去/打算安排/接下来要/以后计划`；`准备` 只有在表达尚未执行的当前计划时才偏未来，`当年准备` 在明确历史事件和目标时属于历史。
- **问句所指的事件**：`发生了什么/当时做了什么/当时如何` 等提高历史证据强度，但只有授权目标角色、可信玩家轮次和源 scope 完整时才进入 L1/L2。
- **提醒命令**：`记得把/记得通知/记得去/记得告诉` 必须 L0，即使有目标 NPC。
- **省略追问**：`那后来呢？` 只有同 Owner、Player、Conversation、Scene、相邻 turn 的有效 `historyBinding` 才是 L1；没有绑定 L0，绝不能继承 L2 原文授权。
- **混合意图**：`记得通知 C。你们当年和 D 发生了什么？` 只用第二句的人物、时间和文本驱动第三人历史检索，C 不应被误收。
- **有历史和未来的同一句**：不要简单“未来词优先”；把可独立识别的历史从句保留，无法证明目标范围时保守 L0 并报告 `ambiguous_temporal_clause`。

**不改变最终授权器的安全门槛**：纯意图分类只是证据，必须再通过可信用户轮次、唯一目标 ID、Owner/Campaign/Forget/Source 复验才能授权第三人历史。

### 3.3 修复点

- `pair-memory-routing.js`：新时间分句分类、历史与未来语义组合；保留清晰的 reason code；不将 `后来` 作为无绑定“纯追问”万能授权。
- `player-centered-memory.js`：只以**获授权的历史从句**驱动 mentionTracker、TemporalResolver、Index relevance、Legacy fallback 排序与历史 Binding；对原本不涉及历史的当前指令不得越权扫描其目标。
- 与原有 `removeQuotedText()` 保持兼容；测试中文引号、嵌套引号、否定作用域和错别字；不要把引用里的历史词算成玩家明确请求。

---

## 4. INT-02：否定作用域由“全消息否决”改为“分句局部控制”（P1）

### 4.1 确认的危险表达式

基线 `isDenialOrCurrentOnly(text)` 使用：

```js
/(?:别|不要|不必|不用|无需|不想|暂时不).{0,12}(?:回忆|回想|提起|谈|讲|说|查|翻|问|了解).{0,14}(?:以前|过去|往事|历史|当年|旧事)?/u
```

末尾 `(?:以前|过去|...)` 是**可选**的，且函数在分句前对整段用户消息调用：即使只是 `别说废话`，也可能否决另一个分句中合法的历史询问。

### 4.2 行为规则

1. 把明确否定 `不要回忆 C 的过去` 限定于**其作用域内的历史目标 C**；不能自动跨过句号否定后面另一个 D 的查询。
2. `别说废话。你以前和玛蒂尔达关系怎么样？` → 后一句可以合法进入 L1。
3. `不要回忆玛蒂尔达。只谈今天的安排。` → 整体 L0。
4. `不要谈玛蒂尔达以前的事，但说说你当年和丁大人的关系。` → 只允许 D 的 L1；C 不能进入历史候选。
5. `不要回忆玛蒂尔达以前的事；不过请说说这件事当年怎么发生的` → 若目标指代不唯一、否定范围冲突，应保守 L0，不能猜测指向。
6. 纯引用否定、NPC 发言、无可信玩家轮次不能构成授权；历史合法性仍需要独立目标解析。

推荐拆成 `segmentClauses`、`detectDenialScope`、`evaluateHistoryClauses`，不得通过把否定正则简单删除来恢复召回。

### 4.3 历史意图专项验收矩阵

| ID | 输入 | 预期 |
|---|---|---|
| INT-01 | 玛蒂尔达后来怎么样了？ | 合法历史 L1 |
| INT-02 | 战争之后你和玛蒂尔达发生了什么？ | 合法历史 L1 或满足详细请求时 L2 |
| INT-03 | 当年你和玛蒂尔达准备如何攻城？ | 合法历史，权限一致 |
| INT-04 | 记得把信交给玛蒂尔达。 | L0，第三人 PairLedger.read = 0 |
| INT-05 | 接下来你准备怎么安排玛蒂尔达？ | L0 |
| INT-06 | 之后还要不要见玛蒂尔达？ | L0 |
| INT-07 | 别说废话。你以前和玛蒂尔达关系怎么样？ | L1，不被前句误伤 |
| INT-08 | 不要回忆玛蒂尔达。你当年和丁关系如何？ | 只允许丁，不允许玛蒂尔达 |
| INT-09 | 只谈现在，别提以前的事。 | L0 |
| INT-10 | 那后来呢？（合法相邻 Binding） | L1，只读绑定目标 |
| INT-11 | 那后来呢？（无 Binding／切场景／换 Player） | L0 |
| INT-12 | “你们在战争之后发生了什么？”这句话是什么意思？ | L0；引用不是授权 |
| INT-13 | 1090 年和 C 的具体争执经过是什么？ | L2，最多 2 个 Source Resolve |
| INT-14 | 我明天见 C。你过去与 D 有何交情？ | 只检索 D 的历史 |
| INT-15 | 同名 C / C'，目标无法唯一定位 | L0，不能猜测 |
| INT-16 | NPC 问 C 的历史，玩家没有请求 | L0 |

新增**真实 `MemoryEngine → PairLedger` 路径测试**，不仅检查 `classifyTemporalIntent` 返回值；需要断言 L0 第三人索引读取为 0，L1 无原文，L2 总 Source attempts ≤2，且混合语句检索结果只包含获授权目标。

---

## 5. CFG-02 / BUD-01：Context 配置与预算的小范围加固

### 5.1 不要误把 2M 输入范围当成已验证原生模型窗口

V9.3.6.1 `request-budget.js` 允许 `256–2,000,000` 的合法 Custom 整数；这里只是 UI/本地配置边界。

- 设置界面应区分 `Configured`（用户值）、`Verified Native`（可信提供商窗口）、`Effective`（实际采用）、`Unknown / Unverified`（未知），避免把 90K/1M 的自定义值标成模型承诺。
- 保留实际 `maxOutputTokens`、协议开销、安全余量及 Token 估算，**最终完整请求预算守卫**是准绳。
- Context 改变只改变允许输入的上限，**不得突破 Memory 4800/5600/6400**。
- GLM 未验证兼容 90K 并不代表无错误；出现服务商原生窗口错误时，展示清晰失败及修正入口，不要把 4xx 悄悄吞成 Memory 索引错误。

### 5.2 不可用低值的处理

`customContextLength=256` 虽通过范围校验，但预算至少要预留 256 Token 安全余量，加上输出和协议开销后输入空间趋近零。建议：

- 不必擅自改变底层合法区间（避免意外不兼容），但**保存时/设置页展示实时预算预估**。
- 若 `planRequestBudget()` 当前可用的 `effectiveInputBudget <= 0`，直接标记“此设置无法满足当前 Output Reserve 和协议开销”，阻止用户误以为配置可用。
- 在配置页建议提高 Custom 值或降低输出上限；不得通过绕过 `beforeSend` 解决。
- 补充非常小窗口、输出超额、非法 Custom、Auto 回退的专项。

---

## 6. 代码修改清单（以实际定位为准）

| 模块 | 文件 | 必做变更 |
|---|---|---|
| Pair 性能 | `src/app/main/memory-system/pair-memory-source-retrieval.js` | 全量 `scopes` 前加安全 CandidateDirectory；正常路径只 read/复验候选；旧算法保留为受监测的安全 fallback |
| Pair Index | `src/app/main/memory-system/pair-long-term-ledger.js` | 目录创建/失效挂钩、复用 Owner 快照、权威 Scope 检查；如需要增加安全轻量验证 API，补充等价性测试 |
| Summary Store | `src/app/main/memory-system/memory-store.js` | 将目录 invalidation 纳入现有 Owner summary cache、数据变更、Forget 等所有受影响路径；不修改真实数据格式 |
| 路由 | `src/app/main/memory-system/pair-memory-routing.js` | 分句时间意图与局部否定、历史问句合法性 |
| 玩家记忆 | `src/app/main/memory-system/player-centered-memory.js` | 历史从句统一用于目标识别、时间分析、索引检索及 fallback；Binding 合同不变 |
| GLM 默认 | `src/app/main/main.js` | 新 GLM 默认改为显式、未验证 90K 兼容 Custom；不能变成全局 cap |
| GLM 模型 | `src/app/main/providers/index.js` | 确保未获得可信长度时不伪装 native；可验证元数据按实际模型匹配 |
| Context policy | `src/app/main/providers/request-budget.js` | 保持 Mode 规则与守卫；只做必要状态/预算提示加固 |
| Provider 控制 | `src/app/main/provider-service.js` | 保证模型能力切换重算、缓存键及 beforeSend/续写不回归 |
| Config Store | `src/app/main/config/settings-repository.js` | 新实例与旧配置兼容，不无声迁移已有 Auto，Custom 验证一致 |
| Renderer | `src/app/renderer/assets/index-Dn3qWlAB.js`及实际源码入口 | GLM 兼容提示/用户选择、Auto/Custom/Effective 三态显示、无 90K max、无非法字段误保存 |
| IPC | `src/app/main/ipc/register-ipc.js` | 真实保存/读取与操作返回；严格输入校验，必要时新增用户显式切换动作 |
| QA | `scripts/test-manifest.js`及下列新增专项 | 完整 Release Gate，保证 source→artifact→deployed 一致 |

**注意**：仓库对 Renderer 有构建/产物映射合同，不得仅修改同名 `src/app/renderer/assets` 或直接改 `resources/app/out` 后宣称完成。必须依项目标准构建和部署流程自动同步。

### 6.1 新增专项文件建议

```text
scripts/test-v9.3.6.2-intent-semantics.js
scripts/test-v9.3.6.2-glm-context-compat.js
scripts/test-v9.3.6.2-owner-target-candidates.js
scripts/test-v9.3.6.2-pair-cache-invalidation.js
scripts/test-v9.3.6.2-pair-retrieval-ab.js
scripts/test-v9.3.6.2-provider-budget-regression.js
```

原有下列专项不得删除，需继续通过并酌情补强：

```text
scripts/test-v9.3.6.1-intent-boundary.js
scripts/test-v9.3.6.1-context-limit.js
scripts/test-v9.3.6.1-pair-retrieval-scale.js
scripts/test-v9.3.6.1-recent-dedup.js
scripts/test-v9.3.6.1-responder-budget.js
scripts/test-v9.3.6-independent-qa.js
```

---

## 7. 独立 QA、性能报告与发布门禁

### 7.1 分阶段施工：每一步先红后绿

1. **Freeze Baseline**：记录 `fbe8cc3` 起点、工作树状态、422/422 历史门禁、288 映射、旧 5/30/100/300 Pair 基准；禁止把旧通过数复制成新成绩。
2. **Red Fixtures**：先复现 GLM 新默认 8192、三类历史漏判、局部否定误伤、300 Pair 全量读取；保存复现输入与调用计数。
3. **CFG-01**：修 GLM 新默认及老 Auto 用户显式切换；完成 UI→IPC→Settings→LLMManager 端到端校验；不在真实 Provider 上发请求。
4. **INT-01/02**：分句意图及否定作用域；历史索引真实路径 red→green；复跑 V9.3.6.1 12 项及旧的路由专项。
5. **PERF-01 基础**：先完成候选目录的 *superset completeness* oracle、缓存 Key/epoch 和 invalidation，关闭/保留旧路径对照开关；不足覆盖不得使用快路径。
6. **PERF-01 提速**：替换正常历史检索的 Owner 全 Pair 扫描，确保 `pairLedger.read` 次数随候选数变化；跑数据竞争与 Source Resolve 总预算，测冷暖规模曲线。
7. **AB 与故障注入**：相同人工数据、相同输入、同机基准；对照可见事项全集、实际选择、来源、安全、Forget 行为；统计慢路径使用率。
8. **Provider/Memory/GLM 回归**：严格检验输出预留、1M Context 不放大 Memory cap、缓存与思考、重试和续写 `beforeSend`；不得新增付费 Provider 调用。
9. **完整 Release**：以当前实际 `test-manifest.js` 运行所有正式测试，不只运行新专项；所有 fixture 必须登记并由主测试命令覆盖。
10. **Source/Artifact/Deployed**：使用现有标准六步构建/验证/部署/回归，最终版本 Core/App/UI 为 9.3.6.2，记录**本次新**哈希、Manifest 数量及全部实际 PASS/FAIL。
11. **隔离 Electron**：使用一次性 APPDATA/LOCALAPPDATA/USERPROFILE，验证 GLM 设置提示、Custom 保存和历史检索；不能碰真实用户存档。
12. **真实 CK3 / Provider / Soak**：与离线 Gate 分开，仅在用户可用环境和授权后执行；如本次未运行必须 `NOT_RUN`，不能宣称 Full Freeze。

### 7.2 必须产出的诊断字段

所有持久化字段经原有匿名白名单，不包含历史原文、完整绝对路径、敏感游戏关系或 API Key。

```text
candidateDirectoryStatus    COMPLETE / STALE / UNAVAILABLE / AMBIGUOUS
candidateDirectoryCacheHit  boolean
candidateDirectoryBuildMs  number
candidatePairCount         number
ownerPairCount             number
candidateReductionRatio    number (仅分母>0)
actualIndexReadCount       number
scopeRevisionChecks        number
legacyScanFallbackCount    number
legacyScanFallbackReason   enum
indexLookupMs              number
sourceResolveAttemptCount  number
memoryLevel                L0 / L1 / L2
contextMode                auto / custom
contextWindowSource        provider_native / user_provided_unverified / safe_fallback / ...
effectiveContextWindow     number
```

不得为提高诊断详细程度而让日志包含 Summary 正文或密钥。

### 7.3 最低发布验收矩阵

| Gate | 发布必达条件 |
|---|---|
| **历史正确性** | 16 个新增语义反例通过；原有合法历史召回不漏；混合句不会把当前人物误注入历史 |
| **权限** | L0 零第三人索引 / Source；L1 ≤16 每目标且零 Source；L2 全链路 ≤2 次来源尝试 |
| **性能** | 300 Pair warm P50 ≤1s / P95 ≤2s，cold P95 优先 ≤5s，且报告明确构建成本与样本量；未达不得宣称 PERF-01 解决 |
| **候选完整性** | Reference oracle 等价；正常快路径 candidate scopes 为保守超集；无 Owner/Campaign 漏隔离 |
| **失效** | Source edit/delete、Forget、Campaign、场景日期、别名变化、重启、竞争均不发送陈旧事项 |
| **GLM** | 新默认不再无提示落入 Auto 8192；现有 Auto 不被无声篡改；Custom >90K 合法 |
| **预算** | Memory cap 不变，完整请求与 LENGTH continuation 的 beforeSend 仍有效 |
| **构建** | 新增脚本进入 Manifest；全部 Release Gate 通过；source/artifact/deployed 一致 |
| **真实性** | 合成、原生隔离窗口、真实 Provider、真实 CK3、20–30/80–100 turn Soak 分开标记 |

**特别规定**：只跑 5 Pair smoke 无法证明 PERF-01；不能将 300 Pair 的单次数据标注为可信 P95；不能把“Provider 请求数为 0 的隔离窗口”当作真实 Provider 长上下文验证。

---

## 8. 性能优化回滚策略（必须设计并验证）

1. 通过内部配置/Feature Flag 允许在**同一代码版本中**选择 `safe-candidate-directory`（默认候选）或 `exhaustive-reference`（对照/回退）。不能允许从 UI 随意关闭来源权限验证。
2. 目录失效或构建失败时回退到旧**正确**的全量检索；若频繁触发造成卡顿，记录 P1 故障并阻断发布或重新优化。
3. 若目录错误漏候选/误隔离/跨 Owner 可见性改变，立即停用快路径并恢复 V9.3.6.1 检索行为；不得仅放宽测试断言。
4. 新候选目录为**派生缓存**，可以清空重建；不删除任何 Legacy、Pair Index、Summary、官方追忆、Forget 标记或历史数据。
5. 保留 V9.3.6.1 原始构建与 deploy backup，回滚不得破坏 Source/Artifact/Deployed 的一致性。
6. 变更 GLM 默认时，不回写真实用户旧配置；用户已保存的 Custom/Auto 继续尊重；如果新默认出现 Provider 拒绝大窗口，可在 UI 切换为匹配该模型的 Custom/Auto，不以自动降级覆盖其原有选择。

---

## 9. 交付报告模板

Codex 施工结束必须新建并填写**真实数据**（不得预填成功）：

```text
docs/current/v9/V9_3_6_2_IMPLEMENTATION_REPORT.md
docs/current/v9/V9_3_6_2_VERIFICATION_REPORT.md
docs/current/v9/V9_3_6_2_PAIR_PERFORMANCE_AB.md
docs/current/v9/V9_3_6_2_CONTEXT_COMPATIBILITY.md
docs/current/v9/v9362-pair-ab-evidence.json
docs/current/v9/v9362-native-evidence.json
```

报告应包括：

- 起点/终点 SHA、涉及代码文件与改动解释、正式测试总数与全部退出码。
- 完整 AB 环境与数据分布、cold/warm 定义、样本量与原始数据、P50/P95、候选目录构建成本、读取次数和内存峰值。
- 有无旧全量扫描 fallback、触发次数和条件；若仍有 300 Pair 阻塞必须列为 P1 未解决。
- GLM 新默认/旧版 Custom/已有 Auto 三种真实 IPC 行为，Mode/Source/Effective 的界面证据。
- 意图新反例与旧反例同时通过、L0/L1/L2 来源读取数、Source race/Forget 的专项证据。
- 最新 source / artifact / deployed 一致性摘要、Core/App/UI 版本和新 payload 哈希。
- 合成、隔离 Electron、真实 CK3、真实 Provider、20–30 / 80–100 轮 Soak、远端 CI 各自 `PASS` / `FAIL` / `NOT_RUN`，**禁止沿用其他版本报告冒充本次实测**。

---

## 10. 完成定义与 Codex 施工指令

> **施工指令（可直接复制给 Codex）：**<br>
> 以 `wsdsb-111/VOCT-NEW` 主分支 V9.3.6.1 提交 `fbe8cc3fc1abc45c6e41bb6ba16bc00e0dc46c54` 为基线，实现 V9.3.6.2 的 PERF-01、CFG-01、INT-01、INT-02 和必要的 CFG-02/BUD-01。第一优先级是消除跨 Pair 300 Scope 全量扫描，使用由 Owner 已有可信快照构建的**保守候选目录**，保持实际 PairLedger.read 与 Source/Forget 修订核对为权威；目录不完整时不得假装没有历史。不能只加 Top-N 或删除第二次来源复验。第二优先级是恢复**新 GLM 默认显式 90K 兼容 Custom**（非全局上限、非伪造原生能力），已有 Auto 只能由用户主动切换。修复历史“后来/战争之后/当年准备”被误判 L0，以及“别说废话”作用域覆盖后续合法历史问句。所有新回归必须先红后绿，加入 test-manifest，跑完整构建、部署、Release 回归，并在同机 5/30/100/300 Pair 冷暖 AB 验证读取次数和时延。真实 CK3/Provider/Soak 未执行必须标 `NOT_RUN`。不得自动推送或改动真实用户数据。

**V9.3.6.2 的最关键成功条件不是“通过更多测试”，而是：在不牺牲任何合法历史记忆、权限和来源有效性的前提下，让 300 Pair 的历史召回从约 40 秒暖态下降到可交互的延迟；同时让 GLM 新配置不再无提示地由 90K 体验退化为 8K。**

**后续 V9.4 不应承担本版遗留的 P1 性能与兼容错误。**

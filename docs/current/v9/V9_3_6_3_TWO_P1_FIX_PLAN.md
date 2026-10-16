# VOCT V9.3.6.3 开发施工文档：历史语义漏召回与旧摘要检索降级修复

> **状态**：待实施的工程设计，不表示代码已改动、测试已通过或真实游戏已验收。
> **施工版本**：建议 `V9.3.6.3`（Core / App / UI）；若仓库已有其他版本规划，实施时以实际版本号统一替换。
> **仓库**：https://github.com/wsdsb-111/VOCT-NEW
> **冻结基线**：V9.3.6.2 运行代码 `abb5f9ce086a1da850b4aba78a7e429ac0cf27ae`，最终报告提交 `440251b5c4b0c710b67bff9ca93c277470c28cd9`。
> **施工方式**：小补丁、先红后绿、与 `exhaustive-reference` 完全对照；不引入新 Memory 子系统、不修改用户真实存档、不增加付费 Provider 调用。

## 0. 决策与阻断条件

| ID | 优先级 | 故障 | 完成定义 |
| --- | --- | --- | --- |
| `INT-03` | **P1** | `HISTORICAL_AFTER_PATTERN` 以事件白名单识别“X之后”，漏掉政变、登基、继承、审判等正常历史提问 | 使用时间与谓词组合识别历史问句；可信历史恢复 L1，明确要求原文细节才允许 L2；既有 L0 权限不退化 |
| `PERF-02` | **P1** | `OwnerTargetCandidateDirectory` 对任一旧摘要来源缺失直接返回 `SOURCE_COVERAGE_INCOMPLETE`，令全部 Pair 回退 `exhaustive-reference` | 改为按 Pair 粒度标记 `UNCERTAIN` 并局部纳入；只有无法证明全域覆盖时才完整回退；稀疏旧档仍显著少读 Pair，结果不漏项、不越权 |
| `QA-02` | **P1** | 旧档、混合摘要、日期/Forget/并发竞争缺少针对以上改动的完整矩阵 | 真实 MemoryEngine/PairLedger 测试 + 合成旧档对照 + 同机 A/B + 既有 427 组/更新后的全部 Release 测试 |

**不可让性能门槛凌驾正确性。** 在不可信条件下可以全量回退，也可以沿现有 fail-closed 路径拒绝当前轮检索；不可任意 Top-N 截断、不读取其他 Owner、不将空结果伪装成已证实的 `INDEX_MISS`。

## 1. 基线事实及根因

### 1.1 历史语义漏召回

基线 `src/app/main/memory-system/pair-memory-routing.js`：

- `HISTORICAL_AFTER_PATTERN` 仅识别 `战争|战事|围城|离开宫廷|离开|回到|出征|交战|会面|结盟|订约|婚礼|加冕` 等预置词后接 `以后/之后`。
- 例如“战争之后你和玛蒂尔达发生了什么”能进入历史路径，而“政变之后你和玛蒂尔达发生了什么”“登基之后你与她的关系如何”可能走 `NEUTRAL` → `L0`。
- `splitIntentClauses()` 已支持按标点及部分转折语切句；`classifyThirdPersonHistoryRequest()` 已有可信玩家轮次、否定对象、历史绑定、L0/L1/L2 检查。**本版复用这些边界，不重造权限体系。**

### 1.2 旧摘要导致全量扫描

基线 `src/app/main/memory-system/owner-target-candidate-directory.js`：

- 遍历 `ownerSnapshot` 时，只要单条历史 `memory.provenance.pairLedgerSources` 缺失/为空，立即返回 `UNAVAILABLE / SOURCE_COVERAGE_INCOMPLETE`。
- 任一 `source.rawSummary`、授权标志、签名、摘要 digest、来源路径或身份不满足要求，也直接返回相同状态。
- 如果 `counterpartIds` 中某个非目标 Pair 未被 `covered` 标记，也直接整轮降级。
- `pair-memory-source-retrieval.js` 对目录非 `COMPLETE` 采用 `allScopes`，所以一个旧摘要或非标准文件会让 300 Pair 全量复验。V9.3.6.2 的常规 300 Pair 已降至约 0.36–0.51s P50，但全量场景仍可慢至数秒以上，旧档体验可能显著恶化。
- `PairLongTermLedger.collectSources()` 实际以 `memory.provenance.pairLedgerSources` 为来源候选，再执行自身权限、身份、Campaign、Forget、日期、来源有效性等权威检查。因此**目录应保守推导“哪些 Pair 值得复验”，而不要求每个旧记录完美标准化。**

## 2. `INT-03`：结构化“过去事件之后”识别

### 2.1 新判定模型

将 `classifyIntentClause()` 中的“过去事件白名单”升级为**句内时间锚点 + 已发生/回顾谓词 + 当前/未来排除项**的组合识别。该组合只用于决定是否进入授权检查，不直接授予历史原文访问。

每个分句返回结构化元数据：

```js
{
  text,                       // 已去除引述的当前独立分句
  kind,                       // PAST_HISTORY / CURRENT_FUTURE / DENIAL / AMBIGUOUS / NEUTRAL
  historicalEvidence: [],     // PAST_EXPLICIT / EVENT_AFTER_RECALL / COMPLETED_ASPECT / FOLLOWUP ...
  futureEvidence: [],         // CURRENT_TIME / FUTURE_PLAN / REMINDER / FUTURE_DEPENDENCY ...
  denialScope,
  mayRequestSourceDetail      // 仅被明确、合法的历史分句设为 true
}
```

**推荐判定优先级**：

1. 已有的可信玩家轮次、人物唯一识别、Owner 和场景绑定是**最终授权前提**；NPC、旁白、引用本身不得作为直接授权信号。
2. 先拆分独立分句，识别局部否定、引述内容和明显的未来命令/提醒。
3. 明确历史时锚：`以前/过去/当年/那年/曾经/历史/回忆/后来/在X时/先前` 等，继续走历史分句，但仍需处理同句未来冲突。
4. 新增 `EVENT_AFTER_RECALL`：把 `X后/之后/以后/过后` 视作 **候选时间结构**，必须同时具有可验证的回顾式谓词，如 `发生了什么/发生过什么/怎么样了/关系如何/关系怎么样/关系如何变化/结果如何/有何影响/是否曾经/有没有见过/当时如何`，或动词的既成性语气 `了/过/已经`；不能单靠“之后”或单靠人名放行。
5. 新增 `FUTURE_DEPENDENCY` 排除：`等/待/如果/假如/明天/以后要/之后准备/之后计划/届时/接下来` 搭配将来行动；即使带事件名，也不得误判为历史。
6. 单分句既有未来又有历史且无可靠过去约束时，保持 `AMBIGUOUS → L0`；分开的明确历史分句不应受其他分句影响。
7. 对只有结构化回顾证据但**没有明确要求来源详情**的查询只开放 `L1`。`L2` 依旧必须是可信轮次、唯一角色、明确索要历史具体经过或原话，并遵守总来源次数 ≤2。

**注意**：`“政变之后”` 本身可能是已经发生、也可能是正在计划的未来事件；不能把 `任意名词 + 之后` 当作足够的过去证明。对于“政变之后你准备如何处理玛蒂尔达？”应默认当前/未来或歧义 L0；“当年政变之后你如何处理了玛蒂尔达？”则可以进入历史。

### 2.2 推荐可维护实现

不引入在线大模型分类、不读取 Summary 内容来反推玩家意图。把分句识别拆为小型纯函数：

```text
splitIntentClauses(text)
  -> strip/exclude quoted fragments (使用已有可信文本逻辑)
  -> detectClauseDenial(clause)
  -> detectExplicitPastAnchors(clause)
  -> detectEventAfterRecall(clause)          [新增：不依赖事件名称白名单]
  -> detectFutureDependency(clause)         [新增：条件/计划/指令]
  -> classifyIntentClause(clause)
  -> authorized historicalClauses only
  -> resolveHistoryDecision() / targetQuery / L0-L2 authority
```

`detectEventAfterRecall` 建议采用**分段语法**而非单条超长正则：

- 限定时间连接词前后的合理长度与标点边界，避免跨句匹配。
- 将 `X` 视为事件片段，至少带动作/事件性证据，而不是只要任何 1–2 个汉字。
- 对 `之后 + 回顾谓词`、`X了之后 + 回顾疑问` 赋历史证据；对 `等X之后 + 打算/安排/将/要` 赋未来证据。
- 对既成性、体貌助词的识别保持保守，避免“安排了之后你准备做什么”误触 L1。
- 事件白名单可作为提示或回归参考，但不能成为唯一召回路径。
- 具体语法与词元可以逐步扩充；不要求一次覆盖汉语的全部歧义。

`pair-memory-routing.js` 中版本化的 `ROUTE_SCHEMA_VERSION` 应随分类语义修改更新（如 `v9363-third-person-route-2`），避免旧意图指纹与新规则被错误视为同一结果。审查 `player-centered-memory.js` 的 `dynamicKey`、`historyBinding`、`namedTargetFocus`、`temporalFocus`，确保新旧判定之间不存在失效缓存复用。

### 2.3 必过语义矩阵（真实 Engine 级）

| 编号 | 玩家询问 | 期望 | 说明 |
| --- | --- | --- | --- |
| S01 | 政变之后你和玛蒂尔达发生了什么？ | 历史；可以是 L2（原详细规则） | 不再依赖“政变”是否进词表 |
| S02 | 登基之后你和玛蒂尔达关系如何？ | L1 | 回顾关系，非未来计划 |
| S03 | 审判以后你们有没有见过面？ | L1 | `过` 表示回顾；有合法目标时 |
| S04 | 继承争议结束之后，你们的关系发生过变化吗？ | L1（或依明示详情细化） | 既成事件和过去体貌 |
| S05 | 当年政变之后你是怎么处理玛蒂尔达的？ | L1/L2（依详情意图） | `当年` 明确过去 |
| S06 | 等政变结束之后，你准备怎么安排玛蒂尔达？ | L0 | 将来计划 |
| S07 | 政变之后要不要通知玛蒂尔达？ | L0 | 后续行动 |
| S08 | 记得政变之后把信给玛蒂尔达。 | L0 | 提醒/命令 |
| S09 | 不要回忆政变之后的事。 | L0 | 明确否定 |
| S10 | 别说废话。登基之后你和玛蒂尔达关系如何？ | L1 | 否定不跨句误伤 |
| S11 | 不谈玛蒂尔达。政变之后你和丁大人关系如何？ | 仅丁 L1 | 被否定对象不可注入 |
| S12 | “政变之后你和玛蒂尔达发生了什么？”是什么意思？ | L0 | 引述不等于历史授权 |
| S13 | NPC 说“政变之后你们怎样了？” | L0 | 无当前可信玩家历史请求 |
| S14 | 那后来呢？（有效相邻历史绑定） | L1 | 继续历史，无原文权限继承 |
| S15 | 那后来呢？（场景/人物/会话变化） | L0 | 绑定失效 |
| S16 | 政变之后怎么办？（无有效人物目标） | L0 | 人物目标不可推断 |
| S17 | 曾经的政变之后你和她如何相处？（唯一已验证指代） | L1 | 只允许已授权指代 |
| S18 | 现在你打算怎么处理与玛蒂尔达的旧事？ | L0 或 AMBIGUOUS | 不应把“旧事”直接转为来源授权 |
| S19 | 记得把信交给玛蒂尔达。你以前和丁大人关系如何？ | 仅丁 L1 | 混合消息只授权对应历史分句 |
| S20 | 战争之后你和玛蒂尔达发生了什么？ | 维持现有可接受等级 | 防止老用例回归 |

对可能的 L1/L2 区间，**施工时必须冻结一个明确且一致的业务预期**；不能把宽松断言长期保留在 Release 门禁。验证 `L0` 实际 `PairLedger.read()` 和 `resolveSource()` 调用为零、`L1` 来源读取为零、`L2` 含失败与 Legacy fallback 的 Source Resolve 总尝试 ≤2，并比较 `targetCharacterIds`、`query`、生成的相关性词、否定范围。

## 3. `PERF-02`：旧摘要局部保守候选 + 有限回退

### 3.1 正确性不变量

对于可信当前 Owner 快照，令 `U` 为 `collectOwnerCounterpartIds` 与目标直接 Pair 组成的全部旧版 scope。优化目录选出的 `C` 必须满足：

`C ⊇ {所有可能通过旧版 PairLedger 的权限/可见性/词项匹配而进入第三人候选的 scope}`。

`C` 只负责减少昂贵读取。对于 `C` 中的 scope 仍执行原有 `PairLongTermLedger.read()`、`resolveSource()`、Source Revision、Forget、Campaign、日期、确认、Owner、最终二次复验。目录不能新授予访问权限。

**不能使用以下“伪优化”**：丢弃 `UNKNOWN`、按固定最多 16 个 Pair 截断、用摘要正文的模糊相似度当唯一授权依据、跳过二次来源复验、混用其他 Owner 私有视角、后台自动改写旧摘要。

### 3.2 新覆盖状态：可信/疑似/全域未知

将 `getCandidateScopes()` 的“单一布尔 complete”改为 **每个 scope 的覆盖证明**：

| 状态 | 判定条件 | 行为 |
| --- | --- | --- |
| `PROVEN_COMPLETE` | Snapshot、Owner、Campaign、目标 alias、来源可枚举且来源形态可与 `PairLedger.collectSources()` 一致地判定 | 只在该 Pair 内有目标唯一别名匹配时纳入（直接目标始终纳入） |
| `UNCERTAIN_SCOPED` | 一条旧记录缺少 `pairLedgerSources`、`rawSummary`、摘要签名等，但可从当前可信 Owner 记录/来源元数据可靠地确定其可能影响的一个或几个 Pair | **把这些 Pair 全部加入候选**，交给权威 `PairLedger.read()` 处理，不放大到 Owner 全量 |
| `UNSCOPED_UNKNOWN` | 无法在可信快照内可靠确定缺失记录可归属哪些 Pair；或全域来源清单/目录身份不完整 | 使用 `exhaustive-reference`，必要时 fail-closed，绝不返回“已完整空匹配” |
| `STALE` | Owner 文件变化、快照失效、Forget、索引修订、角色或 Campaign 竞争 | 丢弃整轮结果；沿用 V9.3.6.2 的 fail-closed 合同，不让缓存继续注入 |

输出示例（只表达接口语义；不要求逐字采用）：

```js
{
  status: 'COMPLETE' | 'SCOPED_DEGRADED' | 'UNAVAILABLE' | 'STALE',
  coverage: 'CONSERVATIVE_SUPERSET' | 'INCOMPLETE',
  candidateCounterpartIds: [], // DIRECT ∪ aliasMatched ∪ uncertainScope
  uncertainCounterpartIds: [],
  uncertainSourceCount: 0,
  unscopedUnknownCount: 0,
  reason: 'NONE' | 'SCOPED_LEGACY_SOURCE' | 'UNSCOPED_LEGACY_SOURCE' | '...',
  ...
}
```

`SCOPED_DEGRADED` 在且仅在所有可能影响旧版索引的未知源都已**按 Pair 纳入**时被视为安全的完整候选超集。不能为了通过性能测试而给任何不完整目录伪造 `CONSERVATIVE_SUPERSET` 标记。

### 3.3 局部降级判定算法

**步骤 A：共用 Owner 和来源的权威输入**

- 从 `beginOwnerRead()` 已验证的 `ownerSnapshot` 出发，不从 UI 猜身份，不扫描玩家本来无权看的文件。
- `counterpartIds` 必须与旧版 `collectOwnerCounterpartIds()` 的 scope 宇宙相同；Direct Pair 永远在候选。
- 遍历每条有效 Owner/Campaign/knownBy 记忆时，联合以下字段做定位：`provenance.counterpartId`、`provenance.counterpartIds`、现有 `pairLedgerSources[*].counterpartId`。不得从不可信的正文人名推导新的 Pair 权限。
- `PairLedger` 对旧数据的授权和解码判断仍是权威。可以提取与 `collectSources()` 共用的轻量 `classifySourceEligibility()`，但不能未经独立回归就把其原有严格校验替换掉。

**步骤 B：记录分级**

1. 完整、可信且可索引的来源：继续按照现有 `normalizeAlias(raw.content)` 以及 `parseImportantMatters()` 提供的事项做候选超集匹配；保留已确认歧义 Legacy、合并投影、Fullwidth、同名不同 ID 和同一事实在不同 Pair 中的独立存在。
2. 某记录的来源数组缺失/为空，而该记录拥有可靠的候选 `counterpartId(s)`：将全部对应 scope 标为 `UNCERTAIN_SCOPED`。**不要对一个旧摘要立即返回全域 `UNAVAILABLE`。**
3. 来源条目存在但 `rawSummary`、fileSignature、fileDigest、sourceSummaryKey 等任一必要字段异常：若能可靠定位来源 `counterpartId`，将该 scope 标为 `UNCERTAIN_SCOPED`；若映射无法保证完整，则设置 `UNSCOPED_UNKNOWN`。
4. `counterpartIds` 存在，但在目录中没有完整 source coverage：相应 Pair 标为 `UNCERTAIN_SCOPED`，不影响其他 Pair。
5. 摘要经严格一致的 `PairLedger.collectSources()` 规则可证明**绝对不可能**生成可检索事项（例如已受权威规则排除的来源），才可视作明确不可索引。不能仅以文件名旧、内容短、日期未知或者 missing source metadata 推断无历史。
6. 所有局部未知项必须转换成**至少一个实际可读的 Owner scope**；存在一个无法覆盖的全域未知项，才使用 `UNSCOPED_UNKNOWN`。

**步骤 C：组装与复验**

```text
U = directScopes ∪ crossPairUniverse
C = directScopes ∪ aliasMatchedTrustedScopes ∪ uncertainScopedScopes

若 owner/session 不可信：STALE → 原有 fail-closed
否则若存在无法映射范围的未知源：UNAVAILABLE → U 全量 reference
否则：SCOPED_DEGRADED / COMPLETE → 仅对 C 做原 PairLedger.read
    → L1/L2 原有 item 排序与预算
    → L2 源读取总次数 ≤2
    → 所有候选 scope 二次 revision 验证
    → 整个 Owner 最终真实性验证
```

这里的“局部”意味着**按 Pair 回退，不是跳过异常摘要**。如果所有 300 个 Pair 均不确定，允许自然退化到 300 个候选；不得隐式截断为某个小数字。

### 3.4 与 V9.3.6.2 安全机制对接

需审查并保持：

- `OwnerTargetCandidateDirectory` 内部 64 项进程内 LRU 缓存；新增覆盖状态、局部疑似集合也加入缓存校验 fingerprint。键继续绑定 Owner、Campaign、完整 alias/target 集、scene/date、Owner 快照修订、source revision/digest 与 invalidation epoch。
- `PairLongTermLedger.invalidate()`、摘要新增/更改/删除、Forget、确认、缓存失效与 `setRetrievalMode()` 均能使候选状态失效；不要使某个 `UNCERTAIN_SCOPED` 在第二轮被无证据地“升级”为 `PROVEN_COMPLETE`。
- `PairLongTermLedger.beginOwnerRead()` 和 `validateOwnerRead()` 的 Owner 全域真实性校验必须保留；所选 Pair 的 `loadSnapshot()` 仍检查实际源内容。
- `PairLedger` 的只读 `read()`、原文 `resolveSource()` 及末尾 scope/Owner 验证不减少；除非单独证明替代检查等价且完成竞争测试，否则不要优化掉防篡改读取。
- 不因某个 Pair 解析失败而跨到反向 `C→B`、其它 `D→C` Owner 的私有历史；只使用 `B` 当前可信视角。
- 无新持久化格式迁移、不改存档、不自动修复玩家旧文件；仅在内存建立派生覆盖证明。

### 3.5 精准诊断（只存计数、原因，不含私密内容）

补充白名单字段：

```text
ownerPairCount
trustedCoveredScopeCount
uncertainScopedScopeCount
uncertainSourceCount
unscopedUnknownCount
candidatePairCount
candidateReductionRatio
candidateDirectoryStatus
candidateDirectoryCacheHit
legacyScanFallbackCount
legacyScanFallbackReason
actualIndexReadCount
scopeRevisionChecks
ownerValidationMs
indexLookupMs
sourceResolveMs
```

不要把原始 Summary、角色正文、姓名、绝对路径、API Key、来源全文写入遥测。诊断可以记录枚举值、匿名计数和来源摘要哈希。`SCOPED_DEGRADED` 不计为全量 fallback，单独展示“局部不确定”的数量与耗时。

## 4. QA：用旧档混合数据证明“不漏召回、不全量退化”

### 4.1 独立旧摘要夹具

测试需实际使用 `MemoryStore` + `PairLongTermLedger` + `retrievePairMemorySources`，而不是用一个 fake List 伪造读取。制作多个 Owner 私有视角的合成目录：

| 编号 | 文件/来源情况 | 期望 |
| --- | --- | --- |
| C01 | 300 Pair 完全新格式，目标仅在 1 Pair | 与 V9.3.6.2 常规性能一致 |
| C02 | 300 Pair 中恰有 1 条旧摘要 `pairLedgerSources=[]` 且可确定归属 Pair | 仅 Direct + 合法 alias Pair + 此不确定 Pair；无需全量 |
| C03 | 300 Pair 中 5 条旧摘要有各自明确归属 | 候选局部放大，结果与 exhaustive 一致 |
| C04 | `rawSummary=null` 但所属 Pair 确定 | 包含该 Pair；原 PairLedger 有权判定是否可读，不能当作整轮坏数据 |
| C05 | 遗失 digest/签名但能确定 Pair | 局部不确定并调用权威 scope 复验 |
| C06 | `counterpartIds` 列表有 scope 但来源覆盖缺失 | 相关 scope 局部不确定 |
| C07 | 真正无法确定归属的可信 Owner 源 | 明确 `UNSCOPED_UNKNOWN`，安全全量回退，不误报完整 |
| C08 | 文件损坏 / Owner Snapshot 不可信 | 现有 fail-closed 或 reference 行为，不能注入缓存历史 |
| C09 | 同一 finalization 多 Pair 合并投影 | 每个合法 Pair 独立保留，同 source key/revision 语义不变 |
| C10 | 已确认歧义的 Legacy 事项 | source/item 正常与 reference 相同 |
| C11 | Forget 前后、确认前后、日期跨界、Campaign 切换 | 旧快照失效；不可复活禁用来源 |
| C12 | 同名不同 ID、别名变化、场景/Responder 切换 | 不产生未授权跨 Pair 记忆 |
| C13 | 同长度/同 mtime 改写摘要；原文读取中竞争 | 丢弃整轮过期结果 |
| C14 | 安全模式→`exhaustive-reference`→安全模式 | 输出事项、顺序、来源修订和权限相同 |
| C15 | 旧档覆盖缺失出现在**非目标 Pair** | 不得因为无关旧摘要造成 300 Pair 全量读取 |
| C16 | 所有 Pair 均 UNCERTAIN | 不丢任何候选，允许慢路径 |
| C17 | 源文件路径含异常 symlink/junction | 沿现有 `assertNoLinks` 安全路径失败，不访问危险路径 |
| C18 | 一条旧记录带多个 `counterpartIds`，其中目标在某非主 Pair | 不得遗漏任何列出的可信 Pair |

旧版 `scripts/test-v9.3.6.2-candidate-directory-qa.js` 曾明确断言 `rawSummary=null` **必须全量回退**。本版应将它改成“已确定所属 Pair 时局部复验”红绿用例；保留真正 `UNSCOPED_UNKNOWN` 的全量回退用例，不能仅删除旧断言。

### 4.2 A/B 性能计划

使用 **同机、同 Node、同一批文件/目标/场景**对照：

- `safe-candidate-directory` V9.3.6.3（优化臂 B）；
- `exhaustive-reference` V9.3.6.3（正确性参考臂 A）；
- 可附 V9.3.6.2 的上一版本复现数据；不能把旧机器数字混进正式统计。

测试规模 5/30/100/300 Pair；混合旧摘要比例 0%、约 1%、约 5%、约 10%、50%、100%，分直接命中、稀疏转述、未命中与 allmention-worst；L0/L1/L2 分开采样。正式发布时每个性能格至少 10 cold + 20 warm 样本；旧版 reference 允许减少耗时样本，但**没有足够样本时不得报告可信 P95**。Cold / Warm 清楚区分“缓存/目录冷态”与“真实磁盘首次加载”。

**硬性正确性门槛：** A/B 每次比较实际 item 身份与顺序、文本 digest、source key/revision、目标 ID、来源尝试数、预算上限、fallback 原因；所有有效相同快照应得到一致合法结果。L0 第三人 read/resolve=0；L1 resolve=0；L2 总尝试≤2。

**建议性能验收目标（工程目标，不是既有结果）**：

| 场景 | 指标 | 目标 |
| --- | --- | --- |
| 300 Pair 常规全新格式 | warm P50 ≤1000ms、P95 ≤2000ms | 不退化 V9.3.6.2 |
| 300 Pair + ≤5 个可映射旧异常 Pair | warm P95 ≤2000ms | 消除“一坏全扫” |
| 300 Pair + ≤10 个可映射旧异常 Pair | warm P95 ≤2500ms | 保证典型混合旧档可用 |
| 300 Pair，确实 unscoped unknown | 正确触发全量或安全拒绝，耗时单列 | 不作虚假常规性能通过声明 |
| 300 Pair，全体都包含目标 / 全体不确定 | 性能、候选数独立报告 | 不允许牺牲召回结果换取指标 |

如 10%+ 旧摘要仍慢，须给出优化前后 read 数和触发原因；不能通过调高阈值掩盖。真实 CK3 验收时选择保存足够长的历史存档，连续触发不同 NPC、相同 NPC 多轮、三人和四人以上对话，记录 p50/p95、目录命中率、确切 fallback 分布与玩家可感知的停顿。

### 4.3 语义专项与原有回归

- 新增 `scripts/test-v9.3.6.3-intent-grammar.js`（名称建议）：先复现 S01/S02 漏召回，再验证 S01–S20 的最终冻结等级。
- 新增 `scripts/test-v9.3.6.3-legacy-scoped-coverage.js`：覆盖 C01–C18 的真实模块级一致性对照。
- 新增 `scripts/test-v9.3.6.3-mixed-archive-ab.js`：旧摘要比例 × Pair 数 × L1/L2 A/B 基准，写匿名原始 JSON。
- 原 `test-v9.3.6.1-*`、`test-v9.3.6.2-*`、V9.3.6 独立 QA 和全部 Release 门禁必须继续运行。因业务规则合理变更导致的断言调整，须保存旧版红例和新版本依据，不能只删用例。
- 同步 `src/app` 与 `resources/app/out` Main/Preload/Renderer，更新构建清单、版本号、哈希映射；验证打包/部署运行负载一致。

## 5. Codex 推荐施工顺序

1. **冻结 SHA、保存基线 A/B**：确认工作树和代码版本，运行既有专项；建立两份最小红例：“政变之后 L0”和“1 条 scoped legacy 触发 300 全量”。
2. **实现 INT-03**：只在语义边界模块修改判定、元信息和版本化缓存；先跑 20 个授权/拒绝用例，再真实 Engine 验证 L0/L1/L2。
3. **实现 PERF-02**：增加 scope 级覆盖状态与不确定桶；严格证明保守超集后才让 `SCOPED_DEGRADED` 使用优化目录。保持 `exhaustive-reference` 为权威测试基线。
4. **安全回归**：旧摘要格式、合并投影、Forget、Campaign、日期、同名、来源内容竞争和原文 2 次总上限。
5. **性能基准**：先做小样本定位，再单机独占正式 A/B；失败保留原日志，不把失败数据剔除后宣布通过。
6. **完整发布门禁**：Node 22、构建、验证、部署、部署验证、全部 Release；隔离 Electron 双启动及实际设置/记忆注入烟测。
7. **实机标记**：真实 CK3/Provider/长会话 Soak/远端 CI 若未执行必须明确 `NOT_RUN`，不得把合成通过写成 Full Freeze。

## 6. 回滚与观察

- 若 INT-03 引发历史误授权、跨角色泄露、历史详情过量开放：将结构化语义新分支回退到已验证的 V9.3.6.2 行为；保留 S01/S02 的失败诊断，不扩大权限尝试修复。
- 若局部目录出现不同于 `exhaustive-reference` 的事项、排序、目标 ID 或 Source Revision：立即使用已有内部 `setRetrievalMode('exhaustive-reference')`，并失效所有 Owner 目录缓存。此操作只是性能回滚，不应绕过其他权限或发送前校验。
- 若未知档案导致大量 scoped uncertainty：诊断 `uncertainScopedScopeCount` 和 fallback 原因；允许变慢而非丢记忆。后续再针对真实旧档分类优化。
- 出现源竞争、签名损坏、Forget 或 Campaign 冲突时，保持既有 fail-closed，禁止“为了不卡”跳过权威校验。

## 7. 验收报告必须含有的内容

1. 基线 SHA、新代码 SHA、Node/Windows/CK3 版本及运行 payload hash。
2. 语义矩阵 S01–S20 的输入、目标身份、预期/实际等级、索引/来源访问计数。
3. 旧档 C01–C18 的候选 Pair 数、uncertain scopes、全量 fallback 数和 A/B 输出一致性。
4. 新版 300 Pair 常规以及 1/5/10 个旧源异常场景的 warm P50/P95；实际原始样本数。
5. Owner/Target/Campaign/Forget/日期/复验安全证据，以及 L0=0、L1=0、L2≤2 的证明。
6. 全量 Release 测试组数和构建/部署文件数量，以**本版实际结果**为准，不预先声称 427/427 或任何新数字已通过。
7. 未运行的真实 CK3、真实 Provider、20–30 轮联调、80–100 轮 Soak、远端 CI 分别标记 `NOT_RUN`。

---

**最终交付原则**：玩家正常追问过去时应尽可能从合法的 NPC 历史中获得连续回答；少量旧格式摘要不应使全局检索突然变慢。两个目标都必须在不降低 Memory 权限、Source 真实性和 Forget 语义的前提下实现。

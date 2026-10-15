# VOCT V9.3.6 正式开发施工规格（详细版）

> **状态：待开发 / 施工合同，不代表代码已实现**
> **编写日期：2026-10-15**
> **版本：Core / App / UI V9.3.6**
> **仓库：** `wsdsb-111/VOCT-NEW`
> **审阅基线：** `main@03dfc4efe2791b31f28f4a4d521d41a10b59f6b9`（施工前必须重新核对 HEAD；如已变化，先比对差异再开工）
> **目标：** 重构固定关系记忆与场外第三人召回路由，上调有界记忆预算，保持 Legacy/官方追忆/Pair Index 的单一来源与历史可追溯性。
> **适用：** 交给 Codex Desktop 的开发规格；要求逐阶段改动、测试、review，不允许跳过失败门禁。

---

## 0. 执行摘要：本次版本到底改变什么

V9.3.5 已建立 `Legacy 定向摘要 → 确定性长期事项簿 → 原摘要来源指针 → 验源回查`。V9.3.6 **不重造存储系统**，而重新界定哪些记忆应该常驻，哪些只能被玩家明确询问历史时打开。

### 0.1 六项必须交付的功能

1. **玩家中心的固定关系记忆**：无论双人或多人对话，每位回应 NPC 的固定记忆默认只锚定 `NPC → 当前玩家`；不因最近发言者是另一 NPC 就改锚。
2. **固定的三部分历史前缀**：`该 NPC 对玩家最近 1 篇完整 Legacy + 该 NPC 合法官方追忆 + 该 NPC→玩家长期重要事项簿`。长期事项预算足够时全量注入，冻结于该 NPC 本场首次构造 Prompt 时。
3. **NPC→NPC 仍要写入但不自动读取**：多人会话依旧依法、按证据保存有方向的 B→C / C→B 原始摘要和事项索引；本场默认基础记忆不包含它们。
4. **场外/第三人分级检索**：玩家仅提起 C 名字不触发 C 历史档案；明确询问 C 过去时最多取 16 条相关事项；要求具体经过时在事项命中基础上精确回查 1–2 篇原始 Legacy。
5. **统一门禁彻底阻断旁路**：旧 mentioned/entity_target/temporal/Legacy fallback 不能绕过 `仅提名不召回第三人档案` 的规则；有明确历史意图时才能启动相应的 C 历史检索。
6. **增加受控 Token 预算**：在 Provider 的真实可用上下文、输出安全余量约束下提高 2/3/4+ 人记忆占比及硬上限，逐项记录新旧预算、实际注入、缓存、裁剪和成本。

### 0.2 非目标 / 红线

- 不恢复 Memory4 / Durable / Year/Life，不生成额外长期摘要、不进行新的模型记忆抽取、不新增第二次 LLM 检索请求。
- 不取消最近 1 篇 Legacy 原摘要：它承载人物的情绪、语气、动机、互动细节，不能用短事项簿完全替代。
- 不把所有历史原摘要默认注入，不把 NPC 两两组合全部当作多人默认固定记忆。
- 不删改 V9.3.5 的合法 Legacy 源、已生成事项簿、Source Key/Revision、Forget、离线回填、信件归档证据和官方行动链路。
- 不把第三人 16 条当成必须取满；不把「直接关系全部长期事项」理解成无预算上限。
- 不预先宣称省 Token、更高缓存命中、RP 更好；必须用同场景实测得出结论。

---

## 1. 基线核对：不要凭过去印象实施

### 1.1 当前真实记忆总预算

`src/app/main/conversation/conversation.js:getMemoryTokenBudget(contextLimit, participantIds)` 当前通过 `this.frozenMemoryBudget` 首次构造时冻结：

```js
const participantCount = new Set(participantIds.map(Number)).size;
const tier = Math.min(2, Math.max(0, participantCount - 2));
const ratio = 0.10 + tier * 0.025;
const tokens = Math.max(0, Math.min(3600 + tier * 900, Math.floor(contextLimit * ratio)));
```

| 参与人数 | V9.3.5 比例 | 硬上限 | 8192 窗口的比例预算 | 16384 窗口的比例预算 | 32768 窗口的比例预算 |
|:--|--:|--:|--:|--:|--:|
| 2 | 10% | 3,600 | 819 | 1,638 | 3,276 |
| 3 | 12.5% | 4,500 | 1,024 | 2,048 | 4,096 |
| 4+ | 15% | 5,400 | 1,228 | 2,457 | 4,915 |

> 表内是 `floor(contextWindow × ratio)`，尚未应用硬上限和其他 Prompt 安全余量；不是 Provider 的真实 billed input。你记得「一千多 Token」是因为对 8K/16K 上下文，比例往往先成为瓶颈。

### 1.2 当前关键实现事实（审核时已查源码）

- `memory-engine.js:1577–1636` 的 `selectRoutedMemories(..., mode="direct")` 默认每关系只取最近 1 篇；不应因重构重新引入最近 2 篇。
- `memory-engine.js:1787` 当前冻结池只有 `floor(budget×0.45)`；长期事项在 `pair-memory-source-retrieval.js` 中主要作为本轮动态项选入，而不是玩家关系全量、固定池。
- `pair-memory-routing.js` 现由最近发言者、收件人字段等决定 `counterpartIds`，无人确认时还可能使用在场集合前两人；这和新的固定玩家锚点合同冲突。
- `memory-engine.js:1881` 现将 direct、explicit、mentioned 混入同一个 `pairScopeIds`；即使只提到 C，也可能搜索 C 的事项。
- `pair-memory-source-retrieval.js` 现最多选择 12 条候选事项，正则 `needDetails` 决定是否打开最多 2 篇源摘要；其 `legacyFallbackUsed = !sources.length` 会把「事项命中但没有展开源」也视作需回退。
- `conversation.js:670–750` 有独立的第三人/显式对象提及识别；旧提及路径与旧 Legacy 动态 Extra 可以绕过新 L0 规则，必须一并审查。
- `prompt-builder.js:~699–750` 已有 V8.13/GLM 的 `prefixByResponder` 前缀布局；目前固定块使用 `officialRecollection`、`directMemory`、`stableMemory` 等字段，必须新增或复用**独立**的长期事项固定字段，禁止和 `temporalExtraText` 混装。
- 官方追忆读取/生成现由 `game-data.js` 和 `memory-engine.js` 的原生合法链路承担，本版不更改官方追忆事实来源。
- V9.3.5 `memory-store.js` 保留 `ownerId/counterpartId/Campaign/knownBy/Forget` 检查与 Pair Index 源验证；本版必须沿用，不得根据仅有人名文字跨 Owner 抓取。

### 1.3 施工前应冻结的基线证据

保存：HEAD SHA、工作区干净状态、当前 manifest 发布测试组数、当前 runtime build/deploy hash、旧预算测试、三种 Prompt 布局、普通提名 C 的实际 memory trace、明确问 C 往事的 trace、多人最近发言者路由、信件摘要状态。**报告中区分静态检查、本地合成测试、隔离 Electron、真实 CK3、Provider 账单。**

---

## 2. 总体架构：存储不动，重构读取

### 2.1 核心概念与有方向的关系

设 A 是玩家，B/C/D 是 NPC：

- `Owner`：即将生成回复的 NPC（例如 B）。
- `PlayerAnchor`：当前 Campaign 中可信的真实玩家 ID（例如 A），来自 GameData；不由客户端随意传入、不由正文猜测。
- `PairLedger(B→A)`：只属于 B 的、与 A 这段关系有关的长期事项，来源是 B 有权读取的 Legacy 投影。
- `PairLedger(B→C)`：只属于 B 的、与 C 有关的长期事项；多人交谈中持续保存，但默认基础记忆不召回。
- `DirectBaseline`：本场 B 固定使用的 `B→A` Recent1 + 官方追忆 + B→A 事项。
- `ThirdPersonRecall`：玩家确实询问 C 历史后，B 从自己有权获知的来源查询与 C 有关的事项和原文。

**玩家是否在场，与源摘要是否曾在多人场合产生，是两个不同维度。** 不因历史上 B/C 同时出现就推定私聊，也不因当前 C 也在场就自动注入 B→C 固定记忆。

### 2.2 常规双人对话架构

```text
玩家 A ↔ NPC B
          │
          ├─ FIXED（本场 B 首次 Prompt 构建时）
          │    ├─ RecentLegacy1(B→A)             最近 1 篇，保留叙事细节
          │    ├─ OfficialRecollection(B)         合法官方历史，有则读取
          │    └─ FullVisiblePairMatters(B→A)    预算允许尽可能全部，确定性排序
          │
          └─ DYNAMIC（本轮有明确需要才激活）
               ├─ 明确时间/事件 → Legacy 时间/事件召回
               └─ 明确问 C 过去 → B 关于 C 的索引 → 必要时精确原文
```

### 2.3 多人对话架构

```text
当前玩家 A + NPC B + NPC C + NPC D

B 的 FIXED = Recent1(B→A) + Official(B) + PairMatters(B→A)
C 的 FIXED = Recent1(C→A) + Official(C) + PairMatters(C→A)
D 的 FIXED = Recent1(D→A) + Official(D) + PairMatters(D→A)

不自动加载：B→C, C→B, B→D, D→C ...
但会话结束后：按照实际知情和来源证据，继续保存所有合法定向 Pair 投影。
当 A 明确问 B 关于 C：B 动态检索 B 有权读取的「C 历史」；C 不自动获知 B 的私人记录。
```

### 2.4 固定和动态块的明确边界

| 区域 | 内容 | 何时确定 | 是否每轮可变 | 能否触发查询 |
|---|---|---|---|---|
| `FROZEN_RECENT` | B→A 最近 1 篇完整 Legacy | B 首次发言前 | 来源失效前不变 | 否 |
| `FROZEN_OFFICIAL` | B 的合法官方追忆 | 同上 | 来源失效前不变 | 否 |
| `FROZEN_PLAYER_LEDGER` | B→A 合法事项（尽量全部） | 同上 | 来源失效前不变 | 否 |
| `DYNAMIC_THIRD_LEDGER` | B 关于 C 的最多 16 条相关事项 | 仅 L1/L2 | 是 | 意图门禁 |
| `DYNAMIC_THIRD_SOURCE` | 命中事项关联的 1–2 篇原始摘要 | 仅 L2 | 是 | 来源验真 |
| `DYNAMIC_TEMPORAL` | 玩家明确问过去时间、事件的历史原文 | 明确时间/事件检索 | 是 | 时间双轴门禁 |
| `EXISTING_WORLDLINE` | 世界线 / 实时游戏事实 | 按现有机制 | 按世界线合同 | 不得被本版覆盖 |

> 不应出现同一个 Legacy 源摘要同时被当作 Recent1、ThirdSource 和 TemporalExtra 三次注入；按稳定 source key 去重。

---

## 3. Fixed Baseline 详细合同

### 3.1 取源规则和优先级

构造 `baselineFor(owner=B, player=A, session)` 时：

1. 验证可信 Campaign、玩家 ID、B 的身份与已授权 Owner 目录；Campaign 不明不偷偷采用旧历史。
2. `RecentLegacy1(B→A)` 从 `loadDirectPairSummaries` 取得，按**原始对话时间**（`totalDays`/日期）和稳定源 ID 选最近有效一篇；排除官方追忆伪装为 Legacy、未来档案、已 Forget、错误 owner 投影和跨 Campaign。
3. `OfficialRecollection(B)` 沿用当前 `getOfficialRecollectionSummary(B, session)` 的合法返回值；无官方追忆则该槽为空，不自动生成替代文本。
4. `PairLedger(B→A)` 按 currentGameDate 可见事项获取，排除不确定未确认项目；原文无需 LLM 再提取；原存储不限条数。
5. 过滤与 Recent1 同源的重复文字：只去除**完全重复/可验证同源**的冗余展示，不把仅内容相似的历史事项误删除。可选择保留短条并标记“详见近期摘要”，但必须有 source key 核验。
6. 执行统一预算分配；记录各块实际格式化后 Token，而非只计正文；注入并冻结快照。

### 3.2 长期事项“全部召回”的准确含义

- **不设置 16 条上限**：16 条只属于第三人按需检索。
- 若 2 人对话 B→A 有 55 条合法事项，且均放得下：55 条都入固定前缀；不按当前 query 动态排序。
- 若有 450 条、内容太长：每条仍完整存储；本场冻结的固定块只收预算许可的确定性子集，其余可在玩家明确历史询问时按 Source 检索。
- 本场不因玩家提出“财富”话题就将固定事项重新排序为财富优先；话题相关性只能驱动额外动态检索，不影响固定前缀缓存。
- 日期格式要说明它是**谈话记录的日期**，与事项内容所描述的事件实际发生时间可能不同；承诺不得标记为已经履行。

### 3.3 裁剪算法：建议的可实现方式

在 Snapshot 创建时排序，而不是随每轮 query 重新评分。

**可验证优先级（完全本地，无模型）：**

1. 最高：仍存在合法来源的未完成承诺、明确待办、尚未解决的冲突、持续性关系事实（仅使用已经存储的 `open`/显式状态，不凭关键词擅自判断“未完成”）。
2. 然后：有合法重要性指标的事项、近期事项。
3. 再后：较早的事项，以稳定时间 + itemId 顺序；避免只保留最新十条导致整个早期关系史完全消失。建议保留跨年份的代表项而不是整年一刀切删除。
4. 同一来源的多个事项尽量成组、尊重先后；若源已入 Recent1，可考虑减少重复但不丢失同源独特事项。
5. 必须记录 `totalVisibleItems`, `injectedItems`, `omittedItems`, `omittedByBudget`, `orderDigest`。

**确定性样例伪代码（不是现成 API）：**

```ts
const visible = verifyOwnerCampaignForgetAndDate(allPairItems);
const ordered = stableSort(visible, byPersistedImportanceThenTimeThenItemId);
const chosen = fitWholeItemsWithinTokens(ordered, availableLedgerBudget, formatItem);
const frozenDisplayOrder = stableChronologicalSort(chosen); // 注入顺序固定
```

- 不推荐把事项截断成半句话，容易把否定、条件与承诺切掉；预算不足时舍弃整条并保留索引。
- 当 Recent1/Official 本身超额：沿用现有安全、可解释的截断策略并记录细节损失；**禁止静默清空固定三块或为了凑长期事项把 Recent1 整块删除**。

### 3.4 冻结快照结构（内部参考 Schema）

```ts
type FrozenPlayerMemorySnapshot = {
  schemaVersion: 1;
  snapshotId: string;                      // 内容 + 版本的稳定哈希
  campaignTokenHash: string;               // 不在日志暴露原 Token
  conversationId: string;
  responderId: number;                     // B
  playerAnchorId: number;                  // A
  configurationRevision: string;
  budgetPolicyRevision: string;
  frozenAtTurnEpoch: number;
  budgetTokens: number;
  sourceGuard: {
    folderSnapshotRevision: number;
    legacySourceKey?: string;
    legacySourceRevision?: string;
    pairIndexSourceRevision?: string;
    forgetRevision?: string;
    officialCaptureSessionId?: string;
    officialContentHash?: string;
  };
  recentLegacyText: string;
  officialRecollectionText: string;
  playerPairLedgerText: string;
  displayOrderDigest: string;
  itemCount: number;
  omittedCount: number;
  actualFormattedTokens: number;
};
```

说明：这只是接口提案，必须适配项目现有命名和真正可用的 revision；**不得凭空引入不存在的 `forgetRevision` 并假装它始终有效**。必要时使用现有 Store 的可验证快照修订和 Forget 访问校验，增加只读 revision 方法与相应测试。

### 3.5 冻结生命周期

| 时机 | 期望行为 |
|---|---|
| 本场 B 首次需要 Prompt | 建立 B→A Snapshot，输出稳定文本 |
| 本场第二轮至第 N 轮 | 复用同一 Snapshot 字节及顺序；动态记忆单独更新 |
| B 与 C 当场相互说话 | 只改变当前会话内容和动态 query，不改变 B→A Snapshot |
| B 临时离场又回来 | 如同一有效会话且来源未变，优先复用 B 快照；按在场/权限变化检查合法性 |
| 本场结束 / 新会话 | 清理快照，新会话重建并纳入新产生的事项 |
| 新摘要写入 / 编辑 / 删除 | 版本失效，重新验证需要更新的 Owner 快照 |
| Forget | **强制失效**：不能继续使用旧前缀，即便缓存有副本 |
| Campaign 切换 / 玩家变更 | 立即失效，不允许跨 Campaign 或玩家串档 |
| 游戏时间改变导致某项未来不可见 | 重新审查时间可见性；不得使用未来记录 |
| Provider 返回失败并重试同轮 | 不在重试中重排基础前缀；若源已失效，先阻断/重建再发送 |

**失效语义优先于缓存命中。** 传输前再验证 `Campaign/Owner/SourceRevision/Forget`；PromptBuilder 的旧 `prefixByResponder` 中若有缓存内容也必须一并移除。不能只刷新 MemoryEngine 的 cache 而遗留 PromptBuilder 的副本。

### 3.6 并发与提交协议

- `build → verify → freeze → send` 之间可能遇到源文件变化，必须在发送前做最终一致性校验；旧快照未获确认不发送。
- 同一 NPC 同一会话同时请求构造快照时，使用 single-flight/锁或等价逻辑，避免两次不同内容写入。
- 允许发送失败后不提交「本轮已召回」集合；避免失败导致下轮认为历史已经注入而永远跳过。
- 不得为冻结文本每轮重新做完整磁盘扫描；可通过现有 revision/signature 防陈旧策略缓存。不能牺牲 Forget 安全换性能。

---

## 4. 场外第三人 L0/L1/L2 意图路由（核心新功能）

### 4.1 只由玩家历史询问激活

B 正与玩家 A 对话，C 不在场（或虽在场但不是玩家锚点）。**“识别到 C”与“授权打开 B 关于 C 的历史”必须拆成两个判定。**

| 级别 | 输入样例 | 是否读取 C 事项 | 是否读取 C 原摘要 |
|---|---|---|---|
| L0：名字提及 | “玛蒂尔达来了。” | 否 | 否 |
| L0：普通实时问题 | “玛蒂尔达现在在哪儿？” | 否 | 否（只使用已授权的当前事实通道） |
| L0：引述 | “他说‘我记得玛蒂尔达’，你怎么看？”（讨论引述本身） | 否 | 否 |
| L0：否定历史请求 | “别回忆玛蒂尔达以前的事，只说今天的安排。” | 否 | 否 |
| L1：历史关系 | “你还记得玛蒂尔达吗？” | 是，≤16 | 否 |
| L1：概括过去 | “你以前和玛蒂尔达关系怎么样？” | 是，≤16 | 否 |
| L1：曾经认识 | “你以前认识 C 吗？” | 是，≤16 | 否 |
| L2：具体经过 | “当年你和玛蒂尔达为了税收发生过什么争执？” | 是，≤16 | 是，≤2 |
| L2：承诺原委 | “你们在1090年具体作过什么约定，为何后来没履行？” | 是，≤16 | 是，≤2 |
| L2：原话细节 | “玛蒂尔达当时究竟怎么说的？” | 是，≤16 | 是，≤2 |
| 歧义 | “那个人当年呢？”且无法唯一绑定 ID | 不扩权 | 不扩权；提示确认人物 |

**注意：** 单独提到“记得”不等于 L2；“你还记得 C 吗”应视 L1；询问原因、过程、细节、原话且有明确历史对象才升级 L2。对于中文自然语言，采用明确规则 + 对话指代状态，而不是只做 regex `needDetails`。

### 4.2 确定性路由输入输出合同

```ts
type ThirdPersonRecallDecision = {
  level: "L0" | "L1" | "L2";
  responderId: number;
  playerAnchorId: number;
  targetCharacterIds: number[];        // 已唯一消歧的 C/D...
  targetEvidence: "EXPLICIT_ID" | "UNIQUE_ALIAS" | "BOUND_FOLLOWUP" | "UNRESOLVED";
  historyIntent: "NONE" | "RELATIONSHIP" | "PAST_EVENT" | "DETAIL" | "TIME_FOCUSED";
  explicitSourceDetailRequested: boolean;
  denialDetected: boolean;
  reasonCode: string;
  queryFingerprint: string;
};
```

**信任边界**：这些字段是后端内部计算结果，不开放 IPC 让 UI 用 `level=L2` 任意注入，也不使用 LLM 输出的普通角色台词伪造玩家的明确请求。

### 4.3 路由判定顺序（强制）

1. 找出当前真正的玩家输入/可信玩家消息，过滤模型输出、NPC 发言、被引述对白、旁白；当前没有新玩家历史请求时，默认不开 C 历史。
2. 识别明确的否定或“只谈当下”，优先 L0。
3. 用现有 Alias/Entity ID 消歧人物；同名、代词含糊、跨场无绑定时不给 C 历史权限。
4. 判断是否真在询问「B 关于 C 的过去/关系/经历」，没有则 L0。
5. 若要的是历史存在性或概况，L1；若明确问事件细节、原因、过程、日期或原话，L2。
6. 一旦判定为 L1/L2，才创建 `targetCharacterId=C` 的查询计划，扫描 B 有权读取的历史范围；不能因 `mentionedIds` 非空就自动运行。
7. 玩家紧接着追问“那后来呢？”时，只能在同一场已明确消歧的历史 C 目标上做有限会话指代；不是每轮无条件保持 L2；话题切换/更换对象/来源失效后清除绑定。

### 4.4 强制穿透所有旧入口的门禁

不得只把 `pairMemory` 的 `counterpartIds` 删除后就自认 L0 成功；还要排查：

- `mentionedGroups` 和 `mentionedRecallCache` 中的 C 历史。
- `entityTargetGroups` / `explicitTargetIds` / `entityTargetCandidates` 中的 C 摘要。
- `rankedExtras`、`topicCandidates`、`importantCandidates`、`session_topic_anchor` 的 C 历史。
- `temporalIndex` 在仅提到人名时不能自行把 C 历史带进来。
- `turnRecall` / `thirdPartyEvidence` 等兼容路径，尤其当 V8.12 3.0 功能被关闭时，不应失守。
- PromptBuilder 的独立 `mentionedSnapshotText` / `entityTargetText` / `temporalExtraText` 等输出槽，不能仍含刚被路由拒绝的 C 档案。

**关键区分**：L0 不启动新的 C 历史检索，但 B→A 冻结近期摘要或 B→A 长期事项本来合法提到 C 的文字，可以照常保留；禁止的是“额外开启 C 档案”，不是抹除固定前缀内所有 C 字符。

### 4.5 L1：长期事项最多 16 条，默认零长篇原文

**第一优先级：** `PairLedger(owner=B,counterpart=C)`，直接记录 B 与 C 的合法互动。

**第二优先级：** B 的其他合法 Owner 关系事项中明确提到 C 的事项，例如 B→D 中 B 被 D 告知 C 的消息。跨关系扫描必须严格 `owner=B`，不能抓 `owner=C`。

- `maxItemsPerTarget = 16`，最多 16 条成功验证且有实际相关性的事项，少于 16 不得填充无关历史。
- 若玩家同时问 C/D，16 是**每目标候选上限**，最终仍共享一套动态预算并有总条数/Token 上限；不能让 5 个被提及人物各占 16 条而把 Prompt 撑爆。
- 不应要求每条事项文本都含“C”才命中：在 `B→C` 文件夹中 C 已由 scope 确认。例如事项只写“双方讨论税收改革”，也属于 B 关于 C 的历史；跨其他关系时必须有显式可信提及证据。
- 人物历史关系的泛问（“你们以前如何”）应保证有代表性的时间分布；不要全部按最近几条填满，忽略早年的重大转折。
- 排序建议：`scopeIdentity > 事件/主题词 > 明确历史时间 > 未解决事项 > 最近性 > 稳定来源ID`。缺少特定话题时，使用时间跨度代表项与重要性，而非一味按 query 全词交集。
- 强调每条事项是「当时记录」，承诺、打算、道听途说不等同既成事实；输出 `DIRECT_PAIR / GROUP_WITNESSED / UNDETERMINED` 证据类型。

### 4.6 L2：索引 → 精确原文的两级检索

1. 先执行 L1 的合法来源筛选、相关事项检索（≤16 条）。
2. 以事项 `sourceSummaryKey + sourceRevision` 汇总候选源摘要；同源多条事项只打开一次。
3. 按实际相关度、时间轴、本人关系证据选择最多 **2 篇**原始 Legacy；一般先 1 篇，第二篇只在补充不同重要细节时开启。
4. 打开源摘要前，调用现有 `PairLongTermLedger.resolveSource` 或等价的 `Source Key + Revision + Owner + Campaign + Forget + Date` 重新核验；不能只靠前端日期或文件名。
5. 完整原摘要经验证后与已选最近 1 篇或其他动态块去重；源正文占实际共享预算，而不是独立白送。
6. 如果来源被修改/删改/Forget，必须撤回源摘要；严重源身份冲突 fail-closed，不能回退到碰巧同名的他人摘要。
7. 只有 L2 且索引确实无命中或合法候选均失效时，才允许对 B 有权读的 Legacy 原摘要执行**有界**的时间/全文兜底；L0 不回退，L1 不擅自升级成全文。
8. 时间询问涉及事件发生年份与对话年份的不同轴，应复用现有双轴 Temporal Index，不可直接将事项 `conversationDate` 当作事件年份。

### 4.7 Fallback 必须建模为不同状态

将现有 `legacyFallbackUsed = !sources.length` 替换为至少以下状态（命名可按项目惯例）：

| 状态 | 含义 | 允许后续动作 |
|---|---|---|
| `NOT_REQUESTED` | L0 或无有效第三人询问 | 不打开 C 索引或 Legacy |
| `INDEX_HIT_ITEMS` | L1 已有有用事项，但不需要原摘要 | 不因为 `sources.length===0` 再去全文扫描 |
| `INDEX_HIT_SOURCE` | L2 已回查有权来源 | 去重后返回，必要时有限补充 |
| `INDEX_MISS` | L1/L2 无合格事项 | L1 仅报告无事项；L2 才允许受控 Legacy 兜底 |
| `SOURCE_STALE` | 来源修订/身份变更 | fail-closed，按情况 L2 有界回退，不能使用旧源 |
| `IDENTITY_AMBIGUOUS` | C 身份不唯一 | 不做跨人检索 |
| `BUDGET_OMITTED` | 候选存在但剩余 Token 不够 | 记录裁剪，不误报无历史 |
| `CAMPAIGN_UNBOUND` | 当前战役无法可信绑定 | 终止检索，不查其他战役 |

### 4.8 多人 C 在场但仍是“第三人档案”

“场外第三人”在这里本质是**非玩家锚点的历史档案**，不等于物理一定不在场。

- A+B+C 当场，B 与 C 正互相说话：不自动加载 B→C 长期档案。
- A 明确向 B 问 C 以前的事：可以按 L1/L2 查 B→C，即使 C 正站在旁边。
- C 自己说“B，你还记得当年吗？”：这是 NPC 发言，**不应单凭 NPC 台词触发此前用户明确限定的玩家驱动第三人长篇档案读取**；当前对话历史本身仍可使用。
- 以后若正式支持“玩家不在场的自主 NPC 对话”，再另行制定 NPC 驱动历史档案授权，不为未上线机制先堆复杂度。

---

## 5. 多人会话：玩家中心路由与保存合同

### 5.1 当前现场为 A(玩家)、B、C

| 回应 NPC | 最近摘要 | 官方追忆 | 固定长期事项 | 默认不召回 |
|---|---|---|---|---|
| B | B→A 最近 1 篇 | B 自己的合法官方追忆 | B→A 事项簿（预算允许全部） | B→C 事项和原摘要 |
| C | C→A 最近 1 篇 | C 自己的合法官方追忆 | C→A 事项簿（预算允许全部） | C→B 事项和原摘要 |

四人、五人同理。**固定关系的参与方永远是玩家 A 和当前回应 NPC，而不是最近发言的 NPC。**

### 5.2 当前对话与历史召回分开

本轮 C 发言对 B 的回复当然应可见，现有 PromptHistory 和角色在场窗口继续管理；这只是**当前会话内容**，不是授权读取 B→C 的多年历史档案。

`querySpeakerId` 可用于解析当前玩家真正要谁回答、检索动态时间/事件焦点；不得将其覆盖为 `playerAnchorId`，也不得以 NPC 发言自动重建 B 的固定关系快照。

### 5.3 NPC→NPC 资料继续保存

- 延续 V9.3.5 `saveCharactersSummaries` 的真实定向投影逻辑；不因读路径改为玩家中心而停写 B→C / C→B。
- 必须基于可验证的参与/在场/summarySegments/knownBy 证据；多人共同见证用 `GROUP_WITNESSED`，不能捏造双方私下承诺。
- 主观视角不能泄漏：B↔C 来源分别写入 B 和 C 自己的 Owner 文件；B 的来源不能被 C 冒用。
- 秘密、耳语、晚加入、早离场、Forget、Campaign 仍按现有规则过滤。
- 后续玩家明确问 B 关于 C 的历史，B→C 是第一优先索引来源；不要求过去的 B/C 私下对话真的曾发生。

### 5.4 不要依赖人物数组顺序

必须删除/绕开 `pair-memory-routing.js` 的「无人确认时在场集合前两人就是固定 Counterpart」语义。玩家中心锚点必须由真实 Player ID 单独决定；多人数组顺序仅影响 UI 展示，不得改变 NPC 基础记忆。

---

## 6. V9.3.6 Token 预算政策：建议值与实现公式

### 6.1 新建议参数（初版，需压测调整）

| 人数 | 旧比例/上限 | 新比例/上限 | 8192 窗口比例预算 | 16384 窗口比例预算 | 32768 窗口比例预算 |
|---|---|---|---:|---:|---:|
| 2 | 10% / 3600 | **16% / 4800** | 1,310 | 2,621 | 5,242→**4,800 上限** |
| 3 | 12.5% / 4500 | **18% / 5600** | 1,474 | 2,949 | 5,898→**5,600 上限** |
| 4+ | 15% / 5400 | **20% / 6400** | 1,638 | 3,276 | 6,553→**6,400 上限** |

以上只是比例与硬上限的 `min`，**仍未扣掉 Provider 安全余量**。这些参数应有单一常量配置和策略版本号、旧值可回滚，不要散布魔法数字在多个模块。

### 6.2 预算真实上限公式

```text
proportional = floor(contextWindow × participantRatio)
hardCap      = participantHardCap

nonMemoryInput = estimateTokens(与本记忆池无关的所有最终 Prompt 内容)
reservedOutput = Provider 本轮实际的 maxOutputTokens / 已确认的安全输出计划
safetyMargin  = max(固定安全下限, 与 Provider 实际能力相适配的余量)

providerHeadroom = max(0, contextWindow - nonMemoryInput - reservedOutput - safetyMargin)
memoryBudget = max(0, min(proportional, hardCap, providerHeadroom))
```

**注意循环依赖**：`nonMemoryInput` 需要通过 PromptBuilder 的无记忆 dry-run/可复用 token breakdown 计算；不允许为了求预算先发一次 Provider 请求，或构造 Prompt 时不计世界线、现有历史消息、Tool/Agent 或多模态开销。对不能可靠估算的 Provider 采用保守值与最终请求校验，不得让系统超窗。

### 6.3 为什么不能只改 3600/4500/5400 三个数字

当前 `memory-engine.js` 使用 `frozenBudget = floor(budget * 0.45)`，其固定 lanes 还细分 official/direct/stable。只增大 totalBudget 而不重新分配冻结池，可能出现新增预算都给了旧动态通道，玩家长期事项仍装不下的情况。**要重构 Frozen/Dynamic 分池及优先级，而非机械上调上限。**

### 6.4 建议的按优先级弹性分配

预算消费顺序（优先级，不是刚性百分比分配）：

1. **Recent1**：预留合理空间保留最近摘要主要叙事段落；允许安全截断，但必须可观测。
2. **Official**：保留合法官方追忆；如果没有就释放空间，不造空块。
3. **PlayerLedger**：将 B→A 的全部合法事项尽量装入，不设条数上限；超限确定性选取而不全文截断。
4. **Existing critical stable**：既有合法稳定记忆/世界线相关要求按现有契约保留，避免新方案把这部分直接吞掉。
5. **Dynamic reserve**：剩余空间分给第三人 16 条候选、1–2 篇原文、时间/场外额外摘要等；本轮没有明确历史询问就不用强行占位。

在预算偏紧、可能发生实质性历史追问的场景，可选**预留最小动态池**，但不得硬性抢走 Recent1 与 Official 的核心内容。要用 8K/16K/32K 实测选择合理策略；与用户体验和缓存稳定相冲突时应以稳定固定块为先。

### 6.5 格式化和最终计数

- 所有标题、日期、来源证据、角色名、指令性提示都要计入最终格式化后的 Token；不能只加 `entry.tokens` 就忽略拼接开销。
- 同一个区块在普通/GLM/V8.13 路径**最多注入一次**。
- 每次真正发送前比较 `renderedMemoryTokens ≤ memoryBudget` 且 `estimatedTotalRequestTokens + reservedOutput + safety ≤ contextWindow`。
- 预算不足时按预先确定的裁剪优先级逐块裁剪，不应进入“全部丢弃长期事项、再丢近期摘要”这种极端流程而没有诊断。
- 不在本版重新设计 Provider 的收费参数；性能报告要区分 `estimateTokens`、Provider billed input、cached input、output，不能用估算数字充当成本实测。

### 6.6 冻结预算的人数边界

本场首次建立预算时，人数计算为可信、去重的参与集合；不因后续某轮 NPC 暂时没说话就反复改比例。若确实有新 NPC 加入，**本版本默认不静默上调已有 NPC 的冻结预算**；新加入 NPC 的独立快照必须在当前受控预算政策下计算，并记录人数与来源。需要是否重冻整个会话应作为独立显式策略且保证 Prompt/cache 不跳变。

---

## 7. 精确代码落点与接口改造

### 7.1 `src/app/main/conversation/conversation.js`

**需要做：**

- 将可信 `playerAnchorId = gameData.playerID`（需验证有效）明确传给 MemoryEngine。`pairRoute.querySpeakerId` 只保留当前讲话/查询语义，不决定长期锚点。
- 改造 `getMemoryTokenBudget`：ratio/cap 政策表、受控策略版本、Provider 余量、真实 Prompt token breakdown；原冻结机制不可被改成每轮随人数/话题摇摆。
- 管理 `frozenBaselineByResponder` 或重用现有 `responderRecallCache` 的安全字段；会话首次建、每轮复用、源变更失效。
- 对 `getMemoryContextFor` 传入真正玩家历史消息以供 L0/L1/L2；不能把最后一个 NPC 消息冒充玩家请求。
- 保持 `turnEpoch`, `sceneRevision`, `campaignToken`, `currentGameDate`, `sourceFolderRevision` 等已有检验；发送前再做源版本和 Forget 核对。
- 记录每轮实际注入块、缓存、Token 与源验证结果，无正文隐私日志。

### 7.2 `src/app/main/memory-system/pair-memory-routing.js`

**建议拆为两个职责：**

```ts
resolveFrozenPlayerAnchor({ ownerId, trustedPlayerId, activeParticipantIds, campaignToken });
resolveCurrentQueryContext({ history, ownerId, trustedPlayerId, activeParticipantIds });
```

第一项只返回 `playerAnchorId` 或可信失败，不猜 NPC；第二项才返回 `querySpeakerId`, `query`, `addressedIds`, `directnessEvidence` 等动态上下文。保留外部兼容适配，不直接移除现有接口导致旧功能崩溃。

### 7.3 `src/app/main/memory-system/memory-engine.js`

建议**分两个纯阶段**：

```ts
baseline = getOrBuildFrozenPlayerBaseline({ ownerId, playerAnchorId, campaignToken, conversationId, budgetPlan, sourceSnapshot });
intent   = classifyThirdPersonHistoryRequest({ trustedPlayerTurn, resolvedTargets, conversationState });
dynamic  = retrieveDynamicHistory({ baseline, intent, temporalIntent, remainingBudget, ownerSnapshot });
result   = assembleOneMemoryContext(baseline, dynamic, tokenBudget);
```

- 固定 `directGroups` 只包含 Player Anchor；`selectRoutedMemories(mode="direct")` 取 1 篇 Recent，不许额外 `activePairRecent` 又补第二篇作本场默认记忆。
- 将 B→A 的事项读取改为 query-independent 的 **全部合法事项**，不是当前 `selected.slice(0,12)`；排序冻结。
- 将 C 的 item/source 召回改成条件激活的独立 lane；删除 direct/mentioned/explicit 一锅混合的默认检索含义。
- 保留非第三人时间与事件的 Legacy 双轴召回，但 L0 下不能因只提 C 名字启动 C 旧摘要。
- 解决 `needsLegacyFallback` 的误判（索引事项命中但 source 数为 0 并不意味着 miss）。
- 统一格式化后 Token 预算、同源去重、fallback metrics；响应结构尽量兼容现有 PromptBuilder、usageAnalytics、trace。

### 7.4 `src/app/main/memory-system/pair-memory-source-retrieval.js`

新入口应按**模式**执行，避免以当前 `needDetails` regex 通吃所有记忆：

| 模式（建议） | 授权查询源 | 项数 | 打开原摘要 |
|---|---|---:|---:|
| `PLAYER_BASELINE_LEDGER` | `B→A` 的全部合法事项 | 预算内无硬条数上限 | 不因查询打开 |
| `THIRD_PERSON_LEDGER` | `B→C` + B 的可信其他关系中 C 相关事项 | ≤16/目标 | 0 |
| `THIRD_PERSON_SOURCE_DETAIL` | 同上 + source pointers | ≤16/目标 | 1–2，验源 |
| `TIMELINE_SOURCE` | 保留现有双轴合法时间检索 | 由现有动态上限约束 | 有历史意图时 |

- 新增 `rankThirdPersonMatters`，确保 B→C 范围本身就提供 C 的身份相关性，不靠 item 文本出现 C 名字。
- 新增受限 `searchOwnerMattersMentioningEntity`，所有回查必须 Owner=B，不能通过 C 的目录偷看 C 的视角。
- 返回更精细的 `INDEX_HIT_ITEMS` / `INDEX_HIT_SOURCE` / `INDEX_MISS` / `SOURCE_STALE` / `BUDGET_OMITTED` 等指标；保留现有字段适配面。
- 按 Source Key + Revision 从 Store 读取原文；验证失败拒绝使用缓存的旧正文。

### 7.5 `src/app/main/memory-system/memory-store.js` 与 `pair-long-term-ledger.js`

- 优先复用 V9.3.5 索引（`pair-important-index/v1`），可新增 Owner 范围的只读查询/helper，**不建新模型提取、也不新建权威数据源**。
- 增加低开销的来源修订/Forget 验证路径供 Frozen Snapshot 使用。所有缓存边界包括 summary 同 stat 等长改写的既有负例，不放松 V9.3.5 的 source signature 防护。
- 其他关系中出现 C 的索引必须先确认 B 已知、文本确实对应 C 的可信别名/实体证据；同名冲突 fail-closed。
- `legacySource` 历史摘要指针仍按现有规则处理同日期、同文件、多条摘要，不得仅凭日期/数组位置当作稳定身份。
- 源摘要编辑、删除、Forget 后 Pair Index 与快照变更同步生效，旧版本无法在下一轮被重新注入。

### 7.6 `src/app/main/prompts/prompt-builder.js`

保证三类固定信息分别拥有稳定语义：

```text
[合法官方追忆]                 Official(B)
[最近一篇 B→A Legacy]        Recent1(B→A)
[与玩家的长期重要事项簿]       Ledger(B→A)
--- 固定前缀结束 ---
[本轮时间/事件/第三人动态召回]  Dynamic
```

实际模块顺序与项目全局系统提示位置可以遵守既有 CacheV2/V8.13 规范，但**同一 NPC 每轮固定部分相同且只写一次**。具体检查：

- `memoryContext.directStableText` 是否已包含 Official 而另一条 `officialRecollectionText` 又重复注入。
- 新 `playerLedgerFrozenText` 不能藏在 `temporalExtraText` 中，也不能在动态块重复渲染。
- `prefixByResponder` 仅按 responderId 缓存可能不足以处理 Campaign/会话/玩家/源 revision；要么更新 key，要么建立严格失效检查并清空旧 key。
- V8.13/GLM 之外的普通模板路径也必须注入相同语义的固定三块，不能仅在某家 Provider 生效。
- 任何敏感历史块仍是 NPC 内部上下文，不能把它作为所有在场者共同可读的系统公告。

### 7.7 `src/app/main/game-data/game-data.js` / Finalization / Letter

**以回归为主，原则上不大改：**

- 多人 summary 继续为所有合法方向生成 Legacy Pair 投影。
- 新生成摘要仍用现有 deterministic parser 更新 Pair Index。
- 继续保留 `DIRECT_PAIR/GROUP_WITNESSED/UNDETERMINED` 溯源区分；不造新的 AI 抽取。
- 信件发送者/接收者方向原摘要必须分别物理验证；不得把“送达/生成任务启动”当归档完成。
- 不触动 CK3 物理信件 Effect、宝物、弹窗等无关功能。

---

## 8. 状态机、示例与边界测试合同

### 8.1 直观对话例子

**例子 A：双人日常**

玩家 A：“宫廷里的情况如何？” NPC B：加载 `B→A Recent1 + B Official + B→A full visible ledger`。不额外打开任何 C 档案。玩家与 B 多轮交谈，固定部分文本字节不变。

**例子 B：只提名字**

玩家 A：“玛蒂尔达刚刚走了。” NPC B：历史档案 `B→C` 的索引读取与源读取计数应为 **0**；B 可以依据已存在于固定记忆中的相关事实作答，但不能后台偷偷打开 C 全部历史。

**例子 C：问历史关系**

玩家 A：“你还记得玛蒂尔达吗？你们以前是什么关系？” NPC B：L1，查 `B→C` 相关长期事项最多 16 条，不展开原文。事项中没有写 C 的名字也能因为 `counterpartId=C` 命中。

**例子 D：要求细节**

玩家 A：“1090 年你与玛蒂尔达为了税收到底争执了什么？她说了哪些理由？” NPC B：L2，选最多 16 条事项，按 `sourceSummaryKey+sourceRevision` 验证读取 1–2 篇与税收争执有关的原始 Legacy；未找到时受控回退。明确标注“摘要记载”，不能声称知道没有记录的逐字原话。

**例子 E：三人会议**

玩家 A、B、C 在场，C 最近一次发言对 B 提问。B 的固定历史仍是 B→A；B 当前会话历史仍可包含 C 的发言。玩家 A 明确问 B 关于 C 以前的约定时才可以动态开启 B→C。

**例子 F：间接听闻**

B 多年前从 D 处听到关于 C 的传闻，相关事项位于 B→D。玩家 A 明确问 B 是否听说过 C 的某件事：可从 B→D 中筛选 B 有权知道且确实提及 C 的事项，但提示是“从 D 处听闻”；不能读取 C→D 的私人视角。

### 8.2 边界案例矩阵（建议至少 48 个独立断言）

| ID | 场景 | 期待结果 / 阻断条件 |
|---|---|---|
| FR-01 | 双人玩家与 B | 固定 Rec1、Official、B→A ledger 都在正确位置 |
| FR-02 | Official 缺失 | 不伪造 Official，不影响 Recent1/ledger |
| FR-03 | Legacy 缺失 | 不把 B→C 摘要顶替 B→A |
| FR-04 | 同一 B 15 轮 | Frozen 的序列化文本完全相同 |
| FR-05 | B→A 有 30 条事项且预算足 | 30 条全进，不受 16 条限制 |
| FR-06 | B→A 有 100 条且预算足 | 全量合法注入，固定顺序 |
| FR-07 | B→A 有 500 条预算不足 | 选择部分完整事项；漏项数可观察；磁盘不丢 |
| FR-08 | 同日期多个来源 | 按稳定 source key，不按日期猜定位 |
| FR-09 | Future items | 不得提前召回未来摘要 |
| FR-10 | 事项为未兑现承诺 | 保留“承诺”语义，不改成已经兑现 |
| FR-11 | Session 结束/重开 | 新会话能读取新事项，旧快照不复用 |
| FR-12 | 当前会话 Forget | 老快照与 PromptBuilder prefix 同步清除 |
| FR-13 | 当前会话摘要编辑/删除 | 失效后不能重新输出旧事项 |
| FR-14 | Campaign 切换 | 全部对应快照清除，无跨战役数据 |
| FR-15 | 玩家/Owner ID 改变 | 固定锚点正确变化，不串 NPC |
| FR-16 | 同一 NPC 并发生成 | 不产生两个不一致 Frozen 版本 |
| FR-17 | Provider 失败重试 | 未成功发送不错误提交 seen；基础前缀不乱变 |
| FR-18 | 普通/GLM/V8.13 | 三块恰好各一次，动态不会混进固定前缀 |
| TP-01 | 仅说“C 来了” | L0；C 档案索引/源检索数均为 0 |
| TP-02 | “C 今天在哪” | L0；仅可查询合法当前游戏事实 |
| TP-03 | 仅引用“记得C” | L0；不能被引号中的词误触发 |
| TP-04 | 明确否定历史回忆 | L0 优先 |
| TP-05 | “你还记得 C 吗” | L1；≤16 事项、零源摘要 |
| TP-06 | “你们以前是什么关系” | L1；关系范围识别能召回没写 C 名字的事项 |
| TP-07 | “1090年你们具体争执什么” | L2；≤16事项、≤2源摘要 |
| TP-08 | 单一 C 只有 3 条匹配 | 只取 3 条，不凑满 16 |
| TP-09 | 多年 80 条 C 事项 | 跨年公平选取相关/重要事项，不只最新 16 |
| TP-10 | C/D 同时询问 | 各 ≤16 候选，共享最终预算/总量 |
| TP-11 | 目标人物同名 | 目标不能唯一确定时 fail-closed |
| TP-12 | “那他后来呢” | 只在已绑定 C 历史线程可安全沿用，否则拒绝扩权 |
| TP-13 | NPC 自己提 C | 不自动启动历史档案 |
| TP-14 | C 在场但非玩家 | 不自动常驻 B→C；玩家明确问历史才启动 |
| TP-15 | L1 索引事项命中无原摘要 | 不做 Legacy 全文 fallback |
| TP-16 | L2 索引未命中 | 可以受控查 B 的原始摘要兜底 |
| TP-17 | L2 来源 revision 过期 | 拒绝旧摘要；刷新/受控回退且不串人 |
| TP-18 | L0 旧 Mentioned 旁路 | 不得注入 C 历史摘要 |
| TP-19 | L0 旧 EntityTarget 旁路 | 不得注入 C 历史摘要 |
| TP-20 | L0 Temporal/TopicPatch 旁路 | 不得因单纯提名带入 C 历史 |
| TP-21 | B→D 记忆提到 C | B 有权知道才能命中；标识转述来源 |
| TP-22 | 查询 B，错误读取 C→B | 绝不允许 |
| TP-23 | 源被 Forget | 事项和原文双层均不能泄漏 |
| TP-24 | 长期事项索引损坏 | 不越权；L2 可合法兜底，L0 不能 |
| TP-25 | 事件年份≠谈话年份 | 双时间轴正确，不错判事件时间 |
| TP-26 | 只提名字后明确追问 | 仅追问那轮升级并动态召回，旧轮不预加载 |
| MP-01 | A+B+C 会话 B 回复 | 固定 B→A，不加载 B→C |
| MP-02 | A+B+C 会话 C 回复 | 固定 C→A，不加载 C→B |
| MP-03 | 最近发言者是 C | B 的 Frozen 锚点不改为 C |
| MP-04 | 参与者顺序重排 | 内容和锚点完全相同 |
| MP-05 | A+B+C+D | 每 NPC 各自玩家固定快照，互不复用 |
| MP-06 | B/C 共同见证事件 | 分别合法记录，不能谎称私聊 |
| MP-07 | 秘密/耳语/迟到/离场 | knownBy/在场视角正确隔离 |
| MP-08 | 后来 A 单独问 B→C 往事 | 可从保存的 B→C 中回查 |
| TK-01 | 8K/2人 | 不超窗，记录所有三块裁剪 |
| TK-02 | 16K/3人 | 实际 budget 对齐公式及 Provider 余量 |
| TK-03 | 32K/4+ | 硬上限生效，不能自动多倍增加 |
| TK-04 | 128K/4+ | 硬上限生效；动态额外仍有硬限 |
| TK-05 | 输出 reserve 很高 | 安全余量优先，记忆自动缩减 |
| TK-06 | 长历史/世界线占用大 | 无总 Prompt 超窗及后台重复请求 |
| TK-07 | 格式化标题/日期/证据 | 纳入最终 token 计算，实际超标阻断 |
| TK-08 | 16条 + 两篇原摘要 | 全部共享同一个总记忆预算 |
| TK-09 | 20–30 轮/80–100 轮 | Token、缓存、延迟、CPU/IO 和 RP 连贯性可比较 |
| TK-10 | 原版 vs 新版同场景 | 真实 Provider Usage 单独对比，不能用估算声称省钱 |

### 8.3 必须增加的“反例先失败”测试

- 第一条必需测试是：**只说 C 的名字，但旧 `mentioned`/`entity_target` 仍偷偷注入 C 原摘要**；修复前复现，修复后归零。
- 第二条必需测试是：C 最近发言让 B 的固定最近摘要变成 B→C；修复后无论发言次序都 B→A。
- 第三条必需测试是：B→A 有 40 条短事项，旧 `slice(0,12)` 丢掉大量合法事项；修复后预算足时收 40 条并冻结。
- 第四条必需测试是：Forget 后旧 `prefixByResponder` 还含已撤销事项；修复后绝不出现。
- 第五条必需测试是：同一个 Official 同时出现在 `officialRecollectionText` 与 `directStableText` 形成双重注入；修复后至少所有路径无重复。

---

## 9. 施工阶段 Gate（Codex 顺序执行，不得“全部完成”后才测试）

### Phase 0：基线冻结及负例（先决）

**工作项：**

1. 拉取本地 `main` 并核对 HEAD 与当前规格；若有新提交，出具差异说明，不直接覆盖。
2. 保存当前 V9.3.5 release manifest、运行时源/构建对应关系、407 组已知基线（实际数字以当时仓库为准）。
3. 加上本方案五个失败反例；捕获当前 2/3/4+ budget 与源码路径证据。
4. 标记真实 CK3/Provider 是否可用，无法连接则标 NOT_RUN 而非 PASS。

**Gate 0：** 反例可复现，基线回归通过，无无关源文件变更。

### Phase 1：固定玩家锚点与 Recent1

**工作项：**

1. 重构 Route 为固定玩家 Anchor 和动态 Query Speaker 两条不同通道。
2. 双人 B→A Recent1、多人 B→A/C→A 均正确；NPC 发言不改变锚点。
3. 确保旧默认最近摘要不重复；NPC→NPC 写入保持。

**Gate 1：** FR-01/03、MP-01～MP-08 PASS；有自动化证明 NPC→NPC 存储未退役。

### Phase 2：长期事项 Frozen Baseline 与缓存合同

**工作项：**

1. 建立可复用、跨轮文本不变的 B→A 事项快照，预算足时全量。
2. 协调 PromptBuilder 统一静态三块，兼容普通/GLM/V8.13。
3. 加入来源版本、Forget、Campaign、会话结束的失效与重建。
4. 纠正动态块对固定部分的重复注入。

**Gate 2：** FR-02、FR-04～FR-18 PASS；Forget/跨战役泄漏零容忍。

### Phase 3：L0/L1/L2 第三人门禁与 16 条召回

**工作项：**

1. 从可信玩家消息推断第三人历史意图，支持否定、引用、代词、同名歧义。
2. L0 统一阻断所有旧第三人历史旁路；保留合法固定基线及当前实时世界事实。
3. L1 优先 B→C，之后可信 B→其他关系跨文件事项；最多 16 条、零原文。
4. L2 从索引定位最相关 1–2 篇合法原摘要，源失效处理与有界兜底。
5. 事件时间与对话时间继续双轴处理；不同来源合并、去重。

**Gate 3：** TP-01～TP-26 全 PASS，特别是所有 L0 检索计数为零和 L1 绝无自动长篇原文。

### Phase 4：提高预算、最终 Prompt 校验、优化性能

**工作项：**

1. 配置并实现 16%/4800、18%/5600、20%/6400 初始参数，并保留可回滚旧表。
2. 根据无记忆 Prompt 消耗和输出 reserve 计算 Provider Headroom，按实际渲染文本重新计数。
3. 防止 `frozenBudget×0.45` 造成新额度不能进入长期事项。
4. 比较索引命中 L1 时不再无意义地进行旧全文排名；缓存 warm 性能、来源验真成本、CPU/IO 记录。

**Gate 4：** TK-01～TK-08 PASS；任何超窗、重复 Provider 调用、缓存权限问题阻断。

### Phase 5：全系统回归与发布候选

依次执行仓库现有的六步构建/测试流程（按最新脚本实际存在性执行，失败不得忽略）：

```powershell
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
```

- 同步 `src/app` 和实际发布 `resources/app/out` 的构建物，不手工盲改未生成版本，检验 manifest。
- 回归 V9.3.5 Pair Index、离线确认、SourceOpen、忘记、信件双向摘要、UI、官方追忆、世界线、CK3 Official Action。
- 检查失效和同 stat 等长改写、目录重命名 Sidecar 风险等既有保护；不要为性能删除安全验证。
- GitHub Actions Release Regression 必须绑定最终 push 的确切 SHA，不用旧 run 替代。

**Gate 5：** 本地/远端测试通过，差异报告完整；真实游戏未测时仍只能称 release candidate。

### Phase 6：真实 CK3/Provider 场景验收

至少测试：

1. 双人连续 20–30 轮，B 的长期关系细节、最近一篇对话的语气/动机连贯性。
2. 三人/四人会话轮流说话，B、C 默认只基于对玩家的固定记忆；场内 NPC 发言不偷加载多年 B→C 历史。
3. 玩家只提 C 名字、问 C 历史关系、问 C 具体旧事三个顺序场景，验证 L0→L1→L2 的来源 trace。
4. 10 年前的历史事件与会话日期错开，验证索引→原摘要的定位，以及无法找到时的安全回答。
5. 更新/Forget/更换战役后继续对话，确认旧历史绝不复活。
6. 信件真实接收、收信人摘要落盘、方向性、长期事项下一会话可见。
7. 至少一组 80–100 轮 Soak，记录历史准确度、Token/缓存/成本、无持续 RAM/IO 增长。

**Gate 6：** 真实环境按证据分别标 `PASS/FAIL/NOT_RUN`；不得把 407/407 合成测试当成 RP 质量通过。

---

## 10. 日志与验收指标（不得记录敏感正文）

### 10.1 结构化 trace 建议字段

```text
version=9.3.6
conversationIdHash / campaignHash / responderId / playerAnchorId
participantCount / contextWindow / maxOutputTokens / safetyMargin
memoryBudget / baselineBudgetUsed / dynamicBudgetUsed / providerHeadroom
recentLegacyCount / recentLegacyTruncated / officialRecollectionPresent
playerLedgerAvailableCount / playerLedgerInjectedCount / playerLedgerOmittedCount
frozenSnapshotIdHash / frozenSnapshotReuse / frozenInvalidationReason
thirdPersonIntentLevel / targetCount / targetIdentityAmbiguous
thirdPersonIndexHitCount / thirdPersonInjectedItems / thirdPersonSourceOpenedCount
thirdPersonLegacyFallbackStatus / sourceKeyRevisionRejectedCount
frozenTextTokenCount / dynamicTextTokenCount / finalMemoryTokenCount
providerInputTokens / providerCachedInputTokens / providerOutputTokens (仅 Provider 确实返回时)
```

只记录 ID、哈希、计数、代码状态；不得写入完整私密对话、秘密事件正文、收信内容、API Key、用户路径或本地存档。

### 10.2 最小度量比较

| 维度 | 如何测 | 通过/关注标准 |
|---|---|---|
| 普通提名 C 误召回率 | L0 测例 + 真实 trace | 新增第三人历史检索 **0** |
| L1 长期事项准确率 | Golden item/source 对照 | ≤16 且无无关凑数，无原摘要 |
| L2 来源定位 | Golden Source Key/Revision | 正确且无身份越权，至多两篇 |
| Recent1 连贯性 | 人工评估最近对话语气/动机复述 | 不显著退步于 V9.3.5 |
| 固定前缀字节稳定性 | 同一回应者同一会话多轮文本哈希 | 合法无变更时相同 |
| 官方追忆互补性 | 人工与自动化检查来源标签 | 无重复注入，不伪造历史事实 |
| 输入成本 | 相同模型、同场景的 Provider Usage | 客观记录变化；不是无条件下降 |
| 缓存 | cached input tokens 与前缀哈希 | 分 Provider 报告，不作跨家承诺 |
| 查询延迟 | index warm/cold P50/P95 + CPU/IO | 不明显恶化，任何恶化附原因 |
| 安全余量 | 最终完整 Prompt + output reserve | 各 context window 不溢出 |

---

## 11. 兼容性、迁移、回滚

### 11.1 数据与接口兼容

- `PairLedger` 仍使用 `Campaign + OwnerId + CounterpartId` 和原始 Summary 的合法 Source Key/Revision。**V9.3.6 主要修改读取策略，不需要全量重做旧索引。**
- V9.3.5 的“自动提取长期事项”UI、离线单 Pair/Owner 回填（唯一可信 Campaign 绑定）、批量取消、查看原文、分页检索保留。
- Legacy 摘要继续是唯一权威叙事文本，事项是派生索引与短记忆；修改事项不能替代修改来源。
- Forget、数据归属、官方追忆、信件归档恢复、旧 Memory4 Sidecar 惰性保留等边界不改。
- 索引结构如非改不可，应支持版本识别、旧索引惰性重建、非破坏性回滚；严禁以升级为由清空旧摘要或 Sidecar。

### 11.2 回滚策略

- 以明确单一配置/特性开关区分 `V9.3.6_player_centered_recall` 与旧召回策略；上线初期可快速回退读路径，但不能重新打开已退役 Durable。
- 旧版回滚只影响**读取和 Prompt 组装**，不得撤销写入到合法 Legacy/Pair Index 的数据。
- 升级途中出现 `SOURCE_STALE/CAMPAIGN_UNBOUND/FORGET`，优先安全停用该受影响块，而不是用任何可用的旧历史替代。
- 发布需提供一次完整的备份/回滚演练（无真实秘密数据导出到仓库）。

### 11.3 需要明确保留的老问题

本版不自动迁移 V9.3.4 以前旧 Memory4 Recovery 信件队列，也不凭空修复真实 CK3 投递链路的所有问题；这些必须在验证报告列为单独限制。不得把模拟信件测试通过说成真实 CK3 收信人摘要已通过。

---

## 12. Codex Desktop 专用执行指令

> 可以把下列文字直接粘贴给 Codex 执行。本规格为**施工目标**，不授权擅自删除 Legacy/Sidecar，也不授权未请求的远端推送。

```text
请阅读 V9_3_6_DETAILED_IMPLEMENTATION_SPEC.md，并以当前 VOCT 仓库真实 HEAD 为起点实施 V9.3.6。
先审查 AGENTS.md 与 docs/current/v9/V9_3_5_* 合同，核对最新 src/app 与 resources/app/out 的生成链路。

严守施工顺序：Phase 0 基线及失败反例 → 玩家中心固定锚点/Recent1 →
长期事项 Frozen Baseline → 场外第三人 L0/L1/L2 → Provider Headroom/Token 预算 →
全量回归 → 真实 CK3 验收建议。每阶段提交可复审的变更与对应测试；不要为赶进度跳 Gate。

核心规则：
1. 每 NPC 本场固定：与玩家最近 1 篇合法 Legacy + 合法官方追忆 + 预算内尽可能完整的 NPC→玩家长期事项。
2. 固定前缀首次构造冻结；Forget、来源编辑/删除、Campaign、玩家/Owner/权限变化时立即失效。
3. 多人会话 B/C/D 的默认固定记忆仍分别锚定玩家 A；NPC↔NPC 继续合法保存而非自动召回。
4. 只提 C 名字为 L0：C 历史事项、原摘要和旧旁路检索必须全关。
5. 明确问 C 历史为 L1：B 有权读的相关事项最多 16 条，无原摘要。
6. 具体历史细节为 L2：最多 16 条事项 + 1–2 篇经 Source Key/Revision 验证的 Legacy；仅 L2 在失效/未命中时允许受控兜底。
7. 记忆预算初始建议 2 人 16%/4800、3 人18%/5600、4+人20%/6400；再受 Provider 可用余量、输出预留和完整 Prompt 计数约束。
8. 保持原 Legacy/Pair Index/Forget/信件/CK3 Action/官方追忆/世界线/离线 UI 合同；不恢复 Durable/Year/Life/Memory4、不新增模型抽取。

必须执行真实的现有构建/发布测试，不可把源码文本匹配测试当行为测试；
报告里精确记录 HEAD、测试数、是否 push、GitHub Actions 的 final SHA、真实 CK3 是否 RUN。
最后给出 V9.3.6 实施报告、验证报告、兼容/退役审计以及实际 Token 对比结论（没有 Provider 数据则明确未测）。
```

---

## 13. 交付物清单与最终 Definition of Done

交付物：

1. 与实际 `main` 一致的 V9.3.6 source、runtime build、manifest 和可审查 commits。
2. `V9_3_6_IMPLEMENTATION_REPORT.md`：真实修改路径、接口契约与主要决策。
3. `V9_3_6_VERIFICATION_REPORT.md`：逐条 FR/TP/MP/TK 测试、回归数、环境与确切 SHA。
4. `V9_3_6_TOKEN_AND_CACHE_COMPARISON.md`：V9.3.5 与 V9.3.6 同场景的估算/Provider 真实用量、缓存命中和延迟。
5. `V9_3_6_COMPATIBILITY_AND_RETIREMENT_AUDIT.md`：Legacy/Pair/Forget/Letter/Sidecar/Durable 的兼容和退役核查。
6. 真实 CK3 实机验证表、失败样例和可复现的脱敏 trace；未完成项必须为 `NOT_RUN`。

**最终验收标准：**

> 日常对话中 B 稳定记住玩家 A 的近期细节、官方经历和跨年共同事项；仅提 C 名字不擅自打开 C 档案；玩家明确询问 C 的历史才激活相关事项并按需回查准确来源；三人/多人时 NPC 默认记忆仍以玩家为中心而 NPC↔NPC 历史照常归档；总 Prompt 永不突破 Provider 的保守安全上限且每项成本变化有证据可解释。

**版本冻结条件：** 所有安全、来源、意图路由、缓存和 Token 相关阻断项通过；远端 Release Regression 绑定最终 SHA 通过。真实 CK3/Provider 不可用时只能标“代码可候选”，不能声称已完成全部效果验收。

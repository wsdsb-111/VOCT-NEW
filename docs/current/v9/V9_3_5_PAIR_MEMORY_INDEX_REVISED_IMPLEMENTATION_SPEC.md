# VOCT V9.3.5 完整开发施工文档（修订版）

> **主题：定向双人长期事项簿 + 两级历史记忆检索 + 旧摘要一键回填 + NPC↔NPC 定向召回 + 信件 Legacy 摘要修复**  
> **基线：** `wsdsb-111/VOCT-NEW` / `main` / V9.3.4 / `941104063581f37de799065216ed422779460b8e`  
> **状态：** 实施规格 / 待施工。本文所有建议的新接口、新字段和新模块均不是当前仓库已经存在的功能。  
> **交付对象：** Codex Desktop，依阶段 Gate 施工。  
> **取代关系：** 本文**完整替代**旧版 `V9_3_5_PAIR_LONG_TERM_MEMORY_IMPLEMENTATION_SPEC.md`，后者仅作历史参考；禁止拆分理解而遗漏“两级检索”。

---

## 0. 一页执行摘要

### 0.1 产品定义

**VOCT V9.3.5 不开发新的 AI 长期记忆模型。** NPC 的真实叙事记忆仍来自现有 Legacy 摘要；从摘要的 `【需要长期记住的事项】` 段落，使用**纯本地、确定性的文本解析**生成有方向的长期事项索引：

`(Campaign, Owner A, Counterpart B) → [按日期保存的事项] → [具体源 Legacy 摘要指针]`

NPC 交谈时：

1. 获得**当前回应 NPC 自己**对**当前交谈对象**的最近 **1 篇**合法完整 Legacy 摘要。
2. 在该 NPC 自己可知的定向长期事项簿中本地检索当前话题、人物、日期和事件。
3. 对普通对话，只注入相关事项；对明确追忆某事件/日期/人物的对话，**用事项命中定位源摘要**，再按 Token 预算读取 1–2 篇最相关的历史完整 Legacy 摘要。
4. 若索引无命中、证据不足、旧摘要没有事项段落，则**保留旧版 Legacy 全文/时间/人物召回兜底**，不能因此丢失记忆。
5. 玩家可在摘要页通过 `自动提取长期事项` 按钮，对历史摘要执行 **预览 → 确认 → 回填/重建 → 可视化浏览 → 点事项跳回原摘要**。
6. NPC 与 NPC 的对话和 NPC 与玩家的对话采用相同路由，不混淆各自知情范围。
7. 修复真实 CK3 中“信件宝物/弹窗送达成功但收信人 Legacy 摘要未生成”的遗留问题，保持信件物理效果只执行一次。

**核心取舍：长期事项是一层轻量的检索目录，不是可以替代完整摘要的事实数据库。**

### 0.2 必须不变的硬约束

- 新增**记忆抽取/查找/索引 Provider 请求 = 0**。既有 Chat、Final Summary、Rolling Summary、Action 和真实需要的 `letter_summary` 请求不算新增记忆提取。
- Durable、Memory4 Detail、Legacy Recompression、Year、Life、8 条配额全部保持退役，不恢复生产读取/生成/恢复。
- Legacy 摘要原文是唯一事实来源，索引只读派生，可重建，绝不改变原摘要内容。
- A→B 与 B→A 两份不同的 Owner 视角；不得跨 Campaign、Owner、未获授权的人物、耳语、缺席窗口、Forget 混用。
- 保存到磁盘的所有合规事项不限制总条数；每轮 Prompt 注入必须遵守 V9.3.4 原有总记忆 Token 上限与 Provider 预留。
- `最近 1 篇` 的“完整”是**优先级和目标**；若超过模型安全预算，须按已有安全策略截断并在诊断显示，绝不可谎称一定完整。
- `按时间召回最多 3 篇`、`场外人物召回最多 3 篇` 是**各自的选取上限**，并非每轮强制新增 6 篇全文。

### 0.3 研发成功的判定

- 新旧合法摘要均可形成有来源指针的事项目录；批量重复回填不产生重复项。
- 1090 年“长命锁”事项可定位到唯一正确的 1090 年摘要；1090 年同日存在两场对话时不会误选。
- NPC 可通过目录迅速找往事；并能在需要具体细节时加载原摘要，而不是只依赖几行事项。
- 3–5 人多人对话，A 回 B 用 A→B；B 回 A 用 B→A；玩家仅在实际作为对象/相关话题时优先召回。
- 信件送达后收信人可见自己的 Legacy 摘要，归档成功和信件送达分别报告状态。
- 旧摘要编辑、删除、Forget、Campaign 切换后绝无失效索引继续注入。
- 发布测试、Windows CI 与真实 CK3 验收分别出具证据。

---

## 1. V9.3.4 代码基线与实现落点

| 已有能力 | 现有源码 | 施工方式 |
|---|---|---|
| 定向 Legacy 持久化 | `src/app/main/game-data/game-data.js`，`saveSummaryForDirectedPair()`、`saveCharactersSummaries()` | 从**已提交的 Owner→Counterpart 投影**派生索引，不改变 Final Summary 的模型请求 |
| Legacy 摘要恢复/编辑/删除 | `src/app/main/memory-system/memory-engine.js`、`memory-store.js`、`src/app/main/summaries/summaries-manager.js` | 原事务/Forget 为权威；索引不能绕过授权 |
| 双人/第三人/时间召回 | `memory-engine.js` 中 `retrieveForResponder()`、`selectRoutedMemories()`；`summary-date-index.js`、`turn-recall.js` | 增加索引候选路由并保持现有全文兜底 |
| 当前 Recent2 | `memory-engine.js` 的 direct group 选择、`directStableText` 和诊断文案 | 改 Recent1，别只改 UI 文本 |
| 摘要重要事项 UI 解析 | `src/app/renderer/summary-date-order.js:getSummaryImportantMatters()` | 抽成主进程可复用的确定性解析器，UI 与后端同一规则 |
| IPC 受信桥 | `src/app/main/ipc/register-ipc.js` / `src/app/preload/preload.js` | 仅开放有作用域验证的列表/预览/确认/定位，绝不暴露任意磁盘路径 |
| 信件送达/回执 | `src/app/main/letters/letter-manager.js` | 与摘要 COMPLETE 分开，保留 CK3 效果幂等 |
| 信件 Legacy 归档 | `src/app/main/memory-system/letter-summary-finalization.js`、`src/app/main/main.js` | 校验收信人和发信人**各自**的持久化证明与恢复 |
| 打包/测试 | `scripts/build-runtime.js`、`scripts/test-manifest.js`、`scripts/test-release.js` | 必须更新所有跟踪源码、构建映射、测试清单及版本字段 |

**前端注意：** 当前跟踪的 Renderer 入口是 `src/app/renderer/index.html` 及 `src/app/renderer/assets/index-*.js`，未确认存在独立 TSX 原工程。先定位实际源码与对应构建映射；不得假设不存在的文件，亦不得只修改 `resources/app/out` 而漏改 `src/app`。

**范围锁定：** 不顺手改写 Action、Prompt 全局角色规则、CK3 角色识别、游戏效果派发、Provider 路由及旧 Durable Sidecar；重要性抽取是对既有摘要的本地解析，不是新的 LLM 功能。

---

## 2. 记忆架构：三种内容，一条检索链

### 2.1 内容分工

| 层级 | 数据是什么 | 作用 | 权威性 |
|---|---|---|---|
| Legacy Source | 每场对话后 A→B 的原始叙事摘要 | 人物动机、过程、情绪、约定上下文、具体细节 | **唯一权威文本** |
| Pair Important Matters Ledger | 原始摘要中 `【需要长期记住的事项】` 每条正文 + 日期 + 来源指针 | 跨年记忆、人物事项目录、第一层快速检索 | 可重建派生索引，**不独立改写事实** |
| Legacy Source Recall | 用 Ledger 命中定位后按需读出的历史原摘要 | 第二层深度回忆 | 重新验证来源时权威 |

**主线流程：**

```text
CK3 可见对话
  ↓ 原有 Final Summary 模型请求（仍然只有这一次）
A→B / B→A / A→C …… 合法 Owner 投影摘要完成写盘
  ↓ 本地提取重要事项（0 模型请求）
定向 Pair Ledger（日期、人物、词项索引、sourceSummaryKey）
  ↓ 当前 NPC 说到人物/事件/日期：第一层索引检索
候选事项 + 经证据核验的源摘要 ID
  ↓ 当前轮确有历史详情需要，第二层有界 Source Lookup
最近 1 篇完整摘要 + 相关长期事项 + 1~2 篇相关历史 Legacy 原摘要
  ↓ 一次正常 Chat 请求
NPC 按自有知识回答
```

### 2.2 不要退化回 Durable

本方案不创建独立事实状态机，不替 NPC 判定承诺已履行、不生成“新的摘要的摘要”、不做跨 Owner 语义合并、不要求 AI 为索引匹配评分。

**保留原文限定词。** 比如“据说”“也许”“未曾”“如果北伐成功才……”不得本地去掉；当前 CK3 游戏数据仍决定现在发生了什么，Legacy 决定 NPC 曾经谈论/知道什么。来源记载的口头承诺不自动成为已经执行的游戏动作。

---

## 3. 有向数据模型、索引身份与来源证据

### 3.1 Owner 关系主键

```text
PairScope = { campaignToken, ownerId, counterpartId }
```

- 三者必须从受信游戏/原 Legacy 投影验证，不能接受 Renderer 传入的自由路径或任意 Campaign。
- `ownerId` 是当前记忆拥有者；`counterpartId` 是被归档的交流对象；两者为不同的 CK3 安全整数角色 ID。
- `A→B` 与 `B→A` **必须物理和逻辑分开**；无活动对象也不允许读其他人的文件夹当作兜底。
- `DIRECT_PAIR` 指有直接交谈证据；`GROUP_WITNESSED` 指同场合法见证；`UNDETERMINED` 指只能验证 Owner 定向来源。**三者不能因为源文件叫“与 B 的对话”就自动等价**。
- 未绑定战役的旧 Legacy 只能通过原有显式 Campaign 绑定流程纳入；默认不可进入当前 NPC 的可用索引。

### 3.2 Index item 示例（*拟新增字段*）

```json
{
  "schemaVersion": 1,
  "scope": { "campaignToken": "campaign-001", "ownerId": 77754, "counterpartId": 12345 },
  "itemId": "pairitem:<source-key-and-ordinal-hash>",
  "conversationDate": "1090.11.10",
  "conversationTotalDays": 100000,
  "text": "赵子绅将一枚东方长命锁赠予保罗，称其为生日礼物。",
  "source": {
    "sourceType": "LEGACY_DIRECTED_SUMMARY",
    "sourceSummaryKey": "summary-stable-key",
    "conversationId": "source-conversation-id",
    "finalizationId": "source-finalization-id",
    "projectionId": "source-projection-id",
    "relativeSummaryPath": "owner-folder/与赵子绅的对话.json",
    "recordLocator": "validated-record-key",
    "itemOrdinal": 2,
    "sourceRevision": "sha256-source-record"
  },
  "interactionEvidence": "GROUP_WITNESSED"
}
```

示例日期只是**对话归档日期**，不能冒充实际事件发生日期。若现有 `temporalRefs` 可验证被谈及事件的日期，另存受信 `eventDate` / 时间轴和证据，不推测补全。

### 3.3 **sourceSummaryKey 是两级检索的核心**

**严禁仅凭日期、正文近似相等或文件列表中的第 N 条直接回查原文**：同一天可能有不同谈话、角色改名可能改目录、摘要编辑可能变内容、旧文件排序可能变化。

推荐：

1. **新摘要：** 优先使用已验证的 `campaignToken + ownerId + counterpartId + projectionId/finalizationId` 形成稳定 Source Key；底层存在冲突时 fail-closed，不允许两条合法不同摘要撞键。
2. **旧摘要：** 若缺稳定来源标识，导入预览先建立**局部稳定绑定键**，由安全相对路径、记录在源文件中可证明的身份、原文摘要指纹和初次扫描快照生成；重建时依靠原始摘要身份和完整集合对账。对于无法唯一定位的旧记录，显示 `SOURCE_IDENTITY_AMBIGUOUS`，不能生成可注入的错误指针。
3. **源身份与内容版本分开。** Source Key 说明“是哪篇摘要”，Source Revision 说明“这篇摘要当前是什么版本”。修改正文/日期须变更 Revision、使缓存失效，但**不得因此把旧事项保留为额外历史**。
4. **Source Pointer 解析必须使用后端合法目录查找器**，不信任存储的路径字符串；必须检查 Campaign、Owner、Counterpart、当前合法来源以及 Forget。
5. 长期事项回查源摘要前**再次做身份与版本验证**；旧版本缺失/权限失效，返回 `SOURCE_UNAVAILABLE_OR_STALE`，不得显示/注入曾保存的缓存正文。
6. 同一来源有多条事项：指针复用同一个摘要；不重复读取同一篇原文，也不重复收费。

### 3.4 存储策略

- Pair Ledger 属于**衍生缓存**，建议保存在 `MemoryStore.baseDir/pair-important-index/v1/<campaignHash>/<ownerId>/<counterpartId>.json`（仅建议，具体采用现有受信路径工具）；不得放进现有关系摘要目录，以免被作为普通摘要数组读取。
- 附带 `schemaVersion`, `indexAlgorithmVersion`, `pairScope`, `sourceSetDigest`, `builtAt`, `items`, `sourceSummaries` 和诊断统计。
- **权威永远是 Legacy。** 缓存因内容/目录变化或版本不一致时，只能重新从合法源构建或降级到 Legacy 兜底，绝不能强行继续提供旧索引。
- 同一事项文字出现在两场不同的真实历史对话中可以保留两条，各有日期与来源；同一来源重复回填不得生成两条。
- 所有历史事项**不限存储条数**；分页/倒排索引是为了避免每轮扫描全部历史正文。

---

## 4. 本地事项解析：只复制重要事项，不第二次总结

建议新增纯函数模块 `src/app/main/memory-system/pair-important-matters.js`，并同步/复用 `src/app/renderer/summary-date-order.js:getSummaryImportantMatters()` 的 UI 规则。禁止两套正则产生不同解释。

### 4.1 唯一合法内容来源

读取 **Owner 自身合法定向 Legacy 摘要**中的标准标题：

```text
【需要长期记住的事项】
- 赵子绅将东方长命锁赠予保罗。
- 玛蒂尔达答应将长命锁登记在礼单上。
- 保罗允许赵子绅日后进入宫殿客房。
```

只提取标题到下一个 `【…】` 标题之间的项目。不因正文“很重要”便自行提取事实；无标题的旧摘要保留在 Legacy 原文检索兜底中。

### 4.2 解析的必要规则

- 支持明确 bullet：`-`、`•`、`*`、`1.`、`1)`、`（一）`；多行续写拼接为同一原文事项，保留人名、否定、时态、条件、引语。
- 标题允许明确限定的空白/换行差异，但不要通过模糊关键词猜测标题。
- 解析多段无编号文字时，如果无法证明边界，标记 `AMBIGUOUS_ITEM_BOUNDARY` 并交由预览；不可擅自拆成多个“确定的事实”。
- 明确 `无`、`无特别事项` 等**精确哨兵**对应零条；不能以“没有、不是”等普通中文词把真实重要事项整条过滤。
- JSON 错误、Official Recollection、源范围不可信、日期晚于当前可见时间、未获授权或已 Forget，分别记清楚跳过原因。
- 最多轻微规范空白、去项目符号；不得同义改写，不添补日期，不判定承诺是否完成，不区分真假传闻时随意改写。
- 摘要原本是多人会谈投影时，可记录 `GROUP_WITNESSED`；若不能证实直接互动，仅为 `UNDETERMINED`，仍保持合法 Owner 视角。
- **所有解析是内存/磁盘本地处理，没有任何网络/模型调用。**

### 4.3 解析和索引文本

- 事项正文存原文；为检索另建 `normalizedSearchText` / `searchTerms` 派生字段。
- 中文初始实现优先选**确定性的 Unicode 汉字连续二元/三元 n-gram + 明确词组字典**，英文数字按可复制的边界分词；中文人名、物品名、年份和专有名词通过源文本与既有角色别名辅助，不调用向量 Embedding 接口。
- 剔除匹配噪声时只剔除明显标点、空白等，不删除“没、不、未、如果、据说”等会改变意义的字词。
- 对长期事项的 0 命中必须标记 `INDEX_MISS`，而不是断言历史不存在；由第二层已有全文 Legacy 检索继续查找。

---

## 5. **新增核心：两级检索 Pair Index → Legacy Source Recall**

### 5.1 目标场景

当前 NPC 保罗听到：**“你还记得我当年送你的长命锁吗？”**

第一层不读取 150 篇历史正文，只搜索保罗 `Owner=保罗`、当前话题合法可读的 `Counterpart=赵子绅` 事项索引；命中 **1090.11.10 长命锁**，取得 `sourceSummaryKey`。

第二层若判断当前问题需要“谈话具体经过”，沿 `sourceSummaryKey` 安全打开**对应那一篇**完整 Legacy 摘要，保留礼物来历、人物反应、其他约定，加入当轮 Prompt。

**不多发一次 LLM 请求。索引检索和原文定位均本地执行。**

### 5.2 检索调度器（建议 `pair-memory-source-retrieval.js`）

```text
Input: responderOwner, currentParticipants, speaker/addressee, query,
       campaignToken, currentGameDate, frozenRecallState, tokenBudget

1. resolveResponderOwnerAndAuthorizedPairScopes()
2. normalizeQueryAndDetectIntent() // event / person / temporal / general
3. queryPairLedgerIndices()         // 第一层：本地事项检索
4. rankItemsAndCollectSourceKeys()  // 同源合并、按 scope 与时间排序
5. decideLegacySourceExpansion()    // 是否要原摘要细节
6. securelyResolveSourceKeys()      // 第二层：源指针校验 + 有界读
7. fallbackToLegacyRetrieval()      // 未命中或低可信时回退旧路径
8. selectWithinSharedTokenBudget()
9. createRecallDiagnostics()        // 不泄露未授权正文

Output: recent1Text, relevantItemText, sourceLegacyText, legacyFallbackText,
        sourceReferences, tokensByLane, activationReason
```

**明确：** 这是建议执行阶段和逻辑，不是让模型产生第二轮思考/Agent，也不是 V9.3.4 已有的现成函数。

### 5.3 第一层：轻量索引检索

- Scope 先过滤**当前回应者 Owner + 已验证 Campaign**，然后按当前实际交谈对象激活主要 A→B 关系；在问到场外人物时可在**同一个 Owner**的其他合法 Pair 索引中扩展。
- 综合查询原文与明确角色别名、事件日期、时间意图、本地字串/ngram 重叠、来源新旧排序进行确定性排序。精确事项关键词和明确日期应高于泛用近因。
- 对“还记得某事吗”这种历史细节追问允许源摘要回查；普通问候不必打开额外历史原文。
- 以 `sourceSummaryKey` 去重：命中 5 条都出自同一篇摘要，第二层也只拿这篇。
- 先取有界候选（建议事项 top 8–12，源候选 top 4，真正展开最多 1–2 篇）；**这些数字是本地检索上限，不是存储或模型配额**。所有上限都必须可测试且由最终预算进一步削减。
- 事项检索低分、同名多人/年份冲突、来源含糊时退回保守匹配，不把“相似词”伪造成准确回忆。

### 5.4 第二层：精确回查历史原文

- Source Key 通过现有 `MemoryStore` / 关系目录合法加载器解析，不直接 `fs.readFile()` 任意客户端路径。
- 校验：`Campaign + Owner + Counterpart + sourceSummaryKey + sourceRevision + 当前 Forget 状态 + 当前时间`；旧证据不足时不越权。
- 取出的应该是**被命中的完整 Legacy 摘要**（受 Token 预算约束）；原文的“事情发生经过、叙事、重要事项”同时保留，供 RP 使用。
- 默认不额外展开放大块原文；仅明确历史、具体人/物/约定、日期回忆或索引排序强命中时触发。
- 与 Recent1/Temporal/Mentioned 已选中的相同 Source Key 必须去重。同日两场对话不得合并；同一个 Owner 的不同 Counterpart 且实际上为同一 Finalization 的共享会谈，可在 Prompt 层做**同源去重**，但仍须各自校验授权。
- 精确命中旧摘要的来源无效时不得使用索引中缓存的全文替代；记录 `SOURCE_STALE` 并尝试传统 Legacy 安全召回。

### 5.5 回退流程（绝对不能删）

长期事项只是入口，不是唯一历史搜索手段。必须保留以下兜底：

1. 旧摘要无标准重要事项段落；
2. 重要事项段落漏写了被问到的细节；
3. 当前问题不是重要事项，而是“当时她怎么说”“房间里有哪些人”之类叙事细节；
4. 事项与问题词汇不匹配；
5. 来源索引未生成、版本不匹配或者临时重建失败；
6. 明确的历史年份、场外人物检索需要查原始摘要全文。

兜底继续走 V9.3.4 的 Legacy 时间索引、人物索引和原文检索；受**相同的 Owner/Campaign/knownBy/Forget/游戏日期**约束。若原路径也无合法候选，就让 NPC 表达记忆模糊，而不是根据低可信索引编造经历。

### 5.6 性能预期与可证伪指标

**这是结构性减少候选文本扫描/提高精准指向的设计，不预先宣称已经更快或更准确。**

测试必须记录：`indexLookupMs`、`sourceResolveMs`、`candidateSummaryCount`、`openedSummaryCount`、`legacyFallbackUsed`、`indexHitCount`、`sourceKeyValidationFailedCount`、`finalInjectedTokens`。

推荐建立事件真值 Golden 集，比较 V9.3.4 直接 Legacy 排名 与 V9.3.5 两级检索的 `Recall@1 / Recall@3`、错误来源命中、P95 本地时延和总体 Token。**不得因条目查询更快就声称最终模型回答必然更准确**，RP 质量需另行实机评价。

---

## 6. 每轮 Prompt：Recent1 + 事项 + 按需原摘要

### 6.1 召回优先顺序

1. 当轮正在交谈的 `Owner→Counterpart` **最近 1 篇原始叙事摘要**（高优先、可缓存）；官方合法追忆保留独立规则。
2. 当前话题最相关、来源有效的**长期重要事项**（纯条目，默认保持简洁）。
3. 有明确历史详情检索意图时，追加通过 Source Key 找到的**1–2 篇历史原摘要**。
4. 场外人物/时间/主题等其他 Legacy 召回补充；索引无效时直接使用旧查询链。

**尽量不把 Recent1 摘要里已经包含的同源事项再次逐条重复输入；必要的历史来源指向可以保留轻量引用，但不重复全文。**

### 6.2 统一预算

V9.3.4 的记忆总上限保持：

| 场景 | 总记忆预算（保持旧机制） |
|---|---|
| 2 人 | 模型上下文 10%，最多 3,600 Token |
| 3 人 | 模型上下文 12.5%，最多 4,500 Token |
| ≥4 人 | 模型上下文 15%，最多 5,400 Token |

**所有 Pair、Recent1、Ledger、历史原摘要、时间/场外人物召回共享当前回应者的同一记忆预算，并服从 Provider 安全余量。**不得按人数乘额度。

建议内部初始分配：Recent1 40% / Ledger 20% / 精确历史原摘要 25% / 其他 Legacy 15%，**仅是可回收、可自适应的优先权重**，不是单独硬额度。没有源回查需求时，相关额度应让给叙事摘要或其他必要历史，不浪费 Prompt。

- Source Recall 默认 **1 篇**，仅确实多个独立历史事件同时涉及当前问题且预算允许时用 **2 篇**。
- Mentioned / Entity Target 合法历史补充 **最多 3 篇**；Temporal 合法年份来源 **最多 3 篇**；两个通道各自限额，共同服从总预算和 Source Key 去重。
- 不能仅把 `extra.length>=3` 改为 `>=6`；需拆分候选桶与最终共享预算，避免时间内容挤掉场外人、或同一原摘要计数两次。
- 最近 1 篇过长时可安全截断，但 Trace 必须标记 `recentSummaryTruncated`；不允许为了形式上的 Recent1 把所有历史条目完全挤出。
- 多个事项同源时合并请求内的源引用，避免文本不断重复；不得对原始 Legacy 进行语义压缩或新 AI 摘要。

### 6.3 冻结 Prompt 前缀和切换对象

- Recent1 的稳定冻结状态继续遵守 V9.3.4 的首轮缓存机制；不可因每轮切换交谈对象频繁重建整份 Stable Prefix。
- 活动关系变化（A 回复 B → A 回复玩家）时，用**受预算约束的动态定向块**换入新 Pair 的最新摘要/事项；已冻结且相同来源的内容去重。
- 已经注入过一次的长期事项不能被错误当作永久“见过”而在后续必要对话中完全缺席；须以当前轮与稳定前缀实际承载为准。
- 启动新 Campaign、编辑/删除/Forget、人员加入/离开、Owner 切换后，失效相关缓存并重新做授权验证。

---

## 7. 多人场景：NPC↔NPC 与 NPC↔玩家平权

### 7.1 例子

当前现场：玩家 P（赵子绅）、NPC A（保罗）、NPC B（玛蒂尔达）。

| 轮次 | 当前回应者 Owner | 实际交谈对象 | 主要记忆 |
|---|---|---|---|
| A 回玩家问题 | A | P | A→P Recent1 + A→P 索引 |
| B 主动问 A | A（等 A 回复时） | B | A→B Recent1 + A→B 索引 |
| A 问 B、B 回答 | B | A | **B→A** Recent1 + B→A 索引 |
| A 被问及 B 的过去 | A | P，但话题涉及 B | A→P 基本背景 + A 自己可知的 A→B 事项/来源 |
| B 旁听未发言 | A | P | B 的关系背景最多小额相关召回，不加载完整 A→B |

**禁止**从 B→A 的私人记录填进 A 的 Prompt；禁止因为“多人同场”就推断 A 和 B 私下直接交谈过。

### 7.2 主交谈对象识别（不新发模型请求）

优先使用现有 NPC 队列、当前发言者、明确接收对象、已验证互动窗口的结构化证据；缺少单一目标时允许保守激活 1–2 个当前关系，不以文本里仅出现名字就断言收到秘密。

所有场内 NPC 之间保留带方向的 Pair Scope，但当前只为**正在发言/即将回应的 NPC**构建所需 Prompt，避免多人时一次性构建所有两两记忆包。

### 7.3 Group Witnessed 不等于 Direct Pair

- 若玩家当众宣布征税，A 与 B 都合法听到了，可以分别有来源明确的相应事项。
- 不能将其改写为“A 私下与 B 约定征税”，也不能因为某个 Counterpart 文件存在就断言二人直接商量过。
- 耳语、迟到、临时离场、恢复在场、多人分段知情等继续走既有 Finalization Presence / Projection 验证，不另造推断。
- 当前 A 已知道秘密不意味着 A 必然会公开；本层仅控制**A 能看到什么**，不能代替原有角色行为约束。

---

## 8. 摘要 UI：一键生成、历史目录和原文跳转

### 8.1 三个入口

**入口 A：某个 Owner→Counterpart 的摘要列表。** `自动提取长期事项`，若已建则 `重新扫描并更新长期事项簿`。

**入口 B：摘要总览 / 当前合法 Owner。** `批量生成长期事项簿`，可选择范围为当前活动 Campaign 中的合法 Owner/Pair，不得跨战役扫盘。

**入口 C：长期事项簿目录。** 单独显示**事项正文与日期**，可搜索事件、人物、物品和年月，点击 `查看原摘要`，跳转到**已验证的具体 Legacy 源记录**，自动展开/高亮相关事项。**不要用 `memory_xxx` / `folder_xxx` 哈希作为主视觉文案**。

### 8.2 Preview → Confirm → Apply

1. 先获取当前 Scope、当前战役、摘要合法绑定及来源版本；只读扫描。
2. 预览卡片列出：扫描摘要数、含“长期事项”标题数、候选事项数、预计新增/更新/保持、跳过总数及原因（未绑定 Campaign、无标题、无日期、已 Forget、标题歧义、源身份冲突等）。
3. 可展开每项原文和确切来源摘要（日期 + 两人角色 + 原始摘要短预览）；明确告知**零新增 AI 费用、不修改原始摘要**。
4. 用户确认后提交 `previewRevision`、Owner/Pair 范围；主进程重新计算来源集合 fingerprint，发现变化则返回 `PAIR_INDEX_PREVIEW_STALE`，不写入陈旧方案。
5. 按 Pair 原子、幂等写入，可取消后续批次且保留已成功 Pair；进度能展示 `completedPairs / totalPairs`，失败逐项说明。
6. 结果显示最终已归档事项数、未处理的摘要与版本变化；能点击进入 `长期事项簿` 和源摘要。

### 8.3 旧摘要迁移与历史归档

- 旧摘要第一次升级**不应静默批量扫描、写入、修改所有文件**。必须通过 UI 明确回填；活动 Pair 的正常只读检索允许用轻量的安全按需派生，但不应隐式全盘持久化。
- 尚无可信 Campaign 绑定的旧摘要只读预览，需通过旧系统已有的显式绑定确认流程；不可直接复用其他 Campaign 的同名角色 ID。
- 原始文本没有重要事项标题，索引可以是零条，原 Legacy 仍可被全文召回；不自动收费重生成摘要。
- 幂等：同一摘要回填十次计数不增长；源删除、修改、改日期后重新构建替换，绝不保留幽灵旧条目。
- 大量历史摘要扫码/建索引应按批次、异步 I/O、可取消和安全限速，不能堵塞 Electron 主线程/UI；显示真正的任务进度而非虚假百分比。

### 8.4 新增 IPC 合同（建议）

```text
conversation:getPairMemoryIndex({ownerId, counterpartId, cursor, limit, query?, sort?})
conversation:previewPairMemoryBackfill({ownerId, counterpartId?})
conversation:applyPairMemoryBackfill({ownerId, counterpartId?, previewRevision})
conversation:openPairMemorySource({ownerId, counterpartId, sourceSummaryKey, expectedSourceRevision})
```

- 主进程根据当前授权 Session 决定 Campaign、根目录和可访问的 Owner，不允许 Renderer 自行传路径、任意 Campaign Token 或未验证源记录。
- `openPairMemorySource` 返回合法摘要身份与显示所需的安全 locator，不能直接信任 `relativeSummaryPath`；UI 做定位时重新查版本与权限，校验失败给“来源已变化，请刷新索引”。
- 普通列表严格分页，默认例如 30、最大 50 条；批量导入支持进度，日志不保存私密正文全文。
- 旧“只读归档”可安全查看预览和来源，但不越过既有 Campaign 只读/写入门禁。

### 8.5 UI 显示草案（非真实截图）

```text
保罗 → 赵子绅                    长期重要事项簿
[搜索：人物/物品/事件/年份] [自动提取长期事项]

1090年11月10日  ·  东方长命锁
  赵子绅赠予保罗东方长命锁作为生日礼物。
  [查看原摘要]  [展开来源与证据]

1090年11月10日  ·  宫廷通行
  赵子绅获准进入宫殿客房；文书将由书省安排。
  [查看原摘要]  [展开来源与证据]

另有 128 条……   [下一页]
```

---

## 9. 新摘要自动派生、事务一致性与编辑删除

### 9.1 更新时机

```text
Final Summary 成功生成
  ↓ 现有 Perspective / Legacy 验证
A→B 摘要真实落盘、可读、有效
  ↓ 源版本识别与本地解析
Pair Ledger 索引原子写入或标记待重建
  ↓ 当前 Owner/Pair 的缓存失效
下轮可召回
```

- **先原摘要提交，后索引可用。** 不能在原文尚未落盘时让 NPC 使用事项。
- 若索引写入失败，Legacy 成功保存仍应保留；标记 `PAIR_INDEX_REBUILD_PENDING` 并禁用过期缓存，下次尝试安全重建/旧召回兜底。
- 重启/Recovery 重复处理同一 Finalization 不增加事项，不发生额外 Provider 请求。
- `updateSummary()`、`deleteSummary()`、`deleteCharacterSummaries()`、`forgetSummaryProjection()`、Owner 清理、Campaign 绑定、改名文件夹合并都必须影响索引有效性；建议 `MemoryStore.invalidatePairMemoryIndex(scope)` 为共同底层入口，不是靠 UI 刷新临时遮掩。
- 源摘要编辑后应以当前真实原文完全重建该来源的事项集合，**不按相似语义合并**，删除事项后不能再从旧 Cache 召回。
- 使用现有 Summary Mutation Journal 或单独原子索引写＋Source Revision 读时核验；故障注入下确保旧源永远不会因派生失败损坏。

### 9.2 读时校验防止陈旧索引

任何出现在 NPC Prompt 中的事项都必须来自**当前来源版本通过校验**的索引。性能可通过 Owner/Pair 版本戳或校验过的摘要目录 snapshot 加速，不能每轮 SHA-256 全盘重扫；如果无法证明缓存仍是最新，降级到 Legacy 安全召回。

### 9.3 手工改长期事项怎么办？

本版本仅允许**点击事项后跳回原 Legacy 摘要编辑**，由原文编辑生成新事项；不提供可以与源摘要脱钩的单条 Ledger 独立改写功能。此约束避免再次出现 Durable 时期的“记忆内容与摘要不一致”。

---

## 10. 信件专项修复 P1：收信人 Legacy 缺失

### 10.1 问题现状（与两级检索是独立 Gate）

真实 CK3 已验证信件宝物与事件弹窗正常，但收信人 Legacy 摘要缺失。V9.3.4 的 `letter-manager.js` 在 ACK 后可异步调用 `LetterSummaryFinalization`；`archiveCaptured: true` 仅意味着**归档任务已受理**，不代表归档已经成功完成。

`letter-summary-finalization.js` 现有环节：

```text
SUMMARY_COMPLETE（模型正文）
→ PROJECTION_COMPLETE（双向 Legacy 定向摘要写盘）
→ LEGACY_COMPLETE（Legacy MemoryStore 知情记忆写入）
→ MARKER_COMPLETE（最终 Episode/完成证明）
```

**信件 `DELIVERED` 与摘要 `COMPLETE` 必须分开表示。**

### 10.2 诊断与修复要求

1. 用实际信件异常日志、Recovery JSON 或精准合成数据复现，先判断 ACK、受理、模型、双向写入、身份授权、完成 marker、UI 缓存哪个环节出错；不能凭“宝物到了”断言已经写入摘要。
2. 将 `archiveCaptured` 明确命名/解释为 `archiveJobAccepted`；状态机区分 `DELIVERED`、`SUMMARY_PENDING`、`SUMMARY_COMPLETE`、`SUMMARY_RETRYABLE_FAILED`、`SUMMARY_MANUAL_BLOCKED`。旧外部 IPC 兼容需要显式适配。
3. 不以 `persistSummary()` 返回笼统成功充当“双向保存证明”；在完成前**分别读取并核验 Sender→Recipient、Recipient→Sender 两份摘要**，匹配 `campaignToken`、`finalizationId`、人物 ID、Letter ID、Source Revision 等身份，且在当前知情范围内合法可读。
4. 已成功的某方向摘要不可重复写，失败后恢复应只补缺失合法投影；已得到可信 `letter_summary` 文本时不能为修复文件 I/O 错误再花一次模型费用。
5. 发送者收到信件的时点、收信者实际收到的时点和信件接受回执必须正确；**收信确认前不得将信件内容归入收信人可知摘要**。
6. 已收信的归档失败不能再次投递 CK3 效果，更不能第二次创建宝物。旧 `LETTER_MEMORY_FINALIZATION` Recovery 若残留，只允许 dry-run/备份后受控迁移其 Legacy 部分，绝不复活 Durable。
7. 已执行 Forget 的一方不允许在 Recovery 时复活；另一方合法知情内容不应被错误撤销。
8. 只有源信件摘要本来就包含标准 `【需要长期记住的事项】` 才派生 Pair Index 项目；信件摘要无此段落时只保持 Legacy 正常可召回，**不因此增加额外 AI 抽取调用**。

### 10.3 归档 UI / Trace

显示 `CK3 送达`、`收信人 Legacy 归档`、`发信人 Legacy 归档` 的独立状态及错误码；失败后提供**只重试归档**操作，不重新触发信件效果。Trace 可记来源/投影 ID、校验与总耗时，不存私密全文。

---

## 11. 施工步骤与严格 Gate

### Phase 0 — 基线、身份、性能基准

- 固定基线 `9411040`，检查工作区与现有提交、发布测试清单实际组数，记录远端 CI 及干净构建；**不要猜测试数量**。
- 保存一个正常双人对话、一个至少三人的 NPC→NPC 对话、一个按年份回忆、一个信件未归档的测试存档/匿名复现素材。
- 核对原有总记忆预算、Recent2、动态额外最多 3、摘要 UI 被跟踪的真实文件位置。
- Gate：原版 Legacy 数据无修改，Player/NPC 权限路径正确，先产出差异检查表。

### Phase 1 — Parser + 有向索引 + Source Pointer

- 新增本地事项解析器和物理 Pair Scope 派生索引。
- 设计稳定来源身份、`sourceRevision`、源目录合法解析、异步缓存、Forget 与 Campaign 校验。
- Source Key 在同日多会话、旧无 ID 记录、角色改名、编辑等情况下有专门反例测试。
- Gate：原始摘要不变；模型调用数=0；新增、编辑、删除、崩溃重启均不会留幽灵条目。

### Phase 2 — **两级检索引擎**（本次新增核心 Gate）

- 第一层通过 Pair Index 根据当前事件/年份/人名快速检索；第二层根据 Source Key 精确检索关联的原 Legacy 摘要。
- 同源多事项只回查 1 篇；明确历史详情才展开；空索引或检索低分时回退原 Legacy 搜索。
- 加入查询 Trace、命中日志、SourceKey 权限/版本校验和 Token 预算；对照旧算法跑固定 Golden 集。
- Gate：长命锁例子直接定位正确日期的**正确具体摘要**，同日两场不会串档，问到非事项细节时旧全文兜底仍有效。

### Phase 3 — UI 目录＋旧摘要批量回填

- Renderer / IPC / Preload 增加预览、确认、可取消执行、索引列表、搜索和**查看对应原摘要**。
- 旧文件无 Campaign 绑定时安全只读，用户显式绑定才可注入；损坏文件部分跳过，显示原因。
- Gate：点击同一批次两次不增加条目，编辑/删除后立即刷新索引；分页 50+ 条及真实按钮交互通过。

### Phase 4 — Recent1 + 多人 NPC 关系路由 + 预算

- 固定 Recent2 改 Recent1，调整 MemoryEngine 的直接/动态召回缓存；绑定当前回应者 Owner 与实际交谈对象。
- Source Recall 与 Mentioned/Temporal 的选取上限各独立，统一 Token 预算；冻结前缀不因切换对象频繁重建。
- Gate：P+A+B 和 P+A+B+C 等案例 Owner 知情隔离、按对象切换、秘密/耳语/迟到、混合时间+场外人物检索全部通过。

### Phase 5 — 信件 Legacy 摘要修复

- 定位送达后摘要缺失的实际失败节点，完成双方投影验证、恢复幂等和旧任务只读审计；不动 CK3 宝物/弹窗行为。
- Gate：真实信件送达后 Sender、Recipient 的合法摘要均可查询，旧失败可只重试摘要，重启不重复生成宝物。

### Phase 6 — 发布与实机

- 专项＋全量回归、实际 Electron 打包和不同主题/档案冒烟、构建/部署 SHA 完整一致、Windows GitHub Actions `Release Regression=success`。
- 游戏实机验收：旧回填、三人 NPC↔NPC、历史两级定位、按年份/场外人名、Forget、信件收件者 Legacy。
- 报告必须区分：单测通过、Electron 通过、CK3 实机通过、远端 CI 通过。**任何一项没做不能写 PASS。**

---

## 12. 自动化验收矩阵（必须纳入 release manifest）

| ID | 测试 | PASS 标准 |
|---|---|---|
| PAR-01 | 标准标题 + 5 项 bullet + 跨行续写 | 5 项原文完整，条件/否定不丢 |
| PAR-02 | 无标题、明确空事项、畸形、歧义段落 | 跳过或预览待确认，不自动发模型 |
| IDX-01 | 同一摘要多次提交 / 回填 | 幂等，不增加重复事项 |
| IDX-02 | 相同日期两篇摘要、不同 Finalization | 两个独立 Source Key，能分别精准打开 |
| IDX-03 | 同文本两个 Owner、同名不同人物、战役重复 ID | 无跨 Owner / Campaign 关联 |
| IDX-04 | 编辑、删除、Forget、更新日期与改名文件夹 | 更新或撤销旧索引，不出现幽灵条目 |
| IDX-05 | 原摘要写盘成功而索引写盘失败 | Legacy 仍可用；索引 fail-closed / 重建 |
| IDX-06 | Source Revision 与缓存不一致 | 不读缓存正文，不跨越源权限 |
| RET-01 | 1090 年长命锁问答 | top 命中唯一源摘要并可注入完整细节 |
| RET-02 | 同日两次长命锁相关谈话 | 精确定位到正确对话，不以日期盲选 |
| RET-03 | 查询事项之外的叙事细节 | 原有 Legacy 全文召回兜底命中 |
| RET-04 | 5 条事项来自同一源 | 原摘要只打开一次、只注入一次 |
| RET-05 | 索引无命中、无事项标题、旧索引过期 | 自动退回合法旧检索，不直接返回空历史 |
| RET-06 | 2 人 / 3 人 / 4+ 人预算 | 总记忆 Token 不超过 V9.3.4 上限 |
| RET-07 | 本地检索阶段调用 provider mock | 额外 Provider 请求严格 0 |
| RET-08 | 150 篇 / 750 项索引性能对比 | 有 Recall@K、时延、候选量证据，不预设一定提高 |
| MUL-01 | A 回 B / B 回 A | A→B 与 B→A 严格分离，当前回应者正确 |
| MUL-02 | P+A+B 群聊、私语、迟到、离场 | 无错误知情或私谈推断 |
| MUL-03 | Mentioned=3 + Temporal=3 同轮 | 候选可独立入选，预算可裁剪且去重 |
| UI-01 | 单 Pair 预览/确认/重复点击 | 统计正确、无重复、拒绝 stale preview |
| UI-02 | 批量回填取消 / 文件损坏 | 部分成功可恢复、源不变、状态可解释 |
| UI-03 | “查看原摘要”点击与版本变化 | 正确跳到所指记录；过期拒绝且可刷新 |
| UI-04 | 50+ 项分页、关键词/日期过滤 | 页面内容真切换、不残留 Loading |
| LET-01 | 游戏收信和宝物正常 | 只触发一次原物理效果 |
| LET-02 | Sender/Recipient 各自 Legacy 摘要 | 真实写盘与可召回证明，不仅 archiveAccepted |
| LET-03 | Pending/Crash/Retry | 不重复模型已完成阶段、不复投 CK3 效果 |
| LET-04 | 旧信件 Recovery / Forget | 只处理合法 Legacy，未获知时不泄露 |
| REG-01 | Year/Life/Durable 退役保持 | 生产抽取/重试/召回请求仍为 0，旧 Sidecar 字节不变 |
| REG-02 | 编译/部署哈希、Electron、远端 Actions | 所有真正执行的 Gate 通过 |

**增加独立反例集**：同一 `messageId` 在不同会话复用；重要事项文字恰好重复；对话日期与事件发生日期不一致；旧摘要缺 `finalizationId`；两名 NPC 同时被提及但只有一名在场；源在预览后被编辑；玩家删除后 Recovery 晚到；从未送达的信件生成了回复但收信人仍不应知道。

---

## 13. 推荐实机测试脚本

1. **历史回填**：在摘要 UI 选择保罗→赵子绅，点击 `自动提取长期事项`，看到 1090 年摘要中的长命锁、宫廷通行、税务等项目及准确来源；确认后再点击一次，条数不增长。
2. **两级检索**：五年后对保罗提起“当年送你的长命锁”；Trace 先匹配事项，再沿 `sourceSummaryKey` 打开 1090 年具体摘要；回答含原始叙事细节，不只念一句索引。
3. **非事项兜底**：问“当时玛蒂尔达是什么语气、在场有谁”，即使索引未覆盖，也可通过旧 Legacy 召回找到被允许的原摘要。
4. **多 NPC 互动**：玩家+保罗+玛蒂尔达，A 向 B 说话、B 回复 A、玩家接话，查每轮 Owner/Pair Trace，确认不读对方私有索引。
5. **隐私边界**：秘密耳语、人物临时离场、第三人迟到与不同战役、同日多会话，不越权、不串档。
6. **编辑/删除**：改写长命锁原摘要、删除一条并 Forget，再问 NPC 原话；源索引及最终 Prompt 中旧内容消失。
7. **信件**：实际收信/宝物/弹窗成功后分别检查 Sender、Recipient Legacy 文件；重启与恢复只补摘要，宝物不再发一次。
8. **成本**：正式测试前新建独立统计窗口或清零统计，确认新索引/回填/两级检索新增模型请求为 0；正常 Final Summary 与 `letter_summary` 支出单列。
9. **性能/准确率**：在相同存档、相同提问下与 V9.3.4 比较记忆命中源、细节正确率、P95 本地时延与最终 Prompt Token；真实无法得到的指标标注 `NOT MEASURED`。

---

## 14. 交付物、冻结条件与禁止事项

Codex 提交前必须生成：

- `docs/current/v9/V9_3_5_IMPLEMENTATION_REPORT.md`：逐 Phase 代码改动、数据结构、版本/文件变更、零额外模型调用证据、信件修复根因。
- `docs/current/v9/V9_3_5_VERIFICATION_REPORT.md`：新测试 ID 的结果、工作流 SHA、Electron/CK3 结果、性能和记忆质量对照。
- `docs/current/v9/V9_3_5_INDEX_AND_SOURCE_CONTRACT.md`：Pair Scope、Source Key/Revision、读时权限、Forget、回填及源定位契约。
- UI 预览与历史回填可理解的状态/错误信息；拒绝陈旧源时不是静默显示无记忆。
- 源/构建/部署哈希、Git 提交清单及待人工验证的真实数据限制。

**阻断冻结的缺陷：** 额外模型抽取请求；索引跨 Owner/Campaign/知情边界泄露；已删除或已 Forget 的摘要被索引复活；`sourceSummaryKey` 回查错篇；重复投递信件/宝物；信件受理当成双方摘要已保存；改变原 Legacy 摘要正文；CI 失败却宣称发布成功。

**不属于本版目标：** 为提升命中率引入 Embedding API、Durable 事实状态、Year/Life、常驻 AI Agent、离线第二次模型重写或跨战役自动匹配。若实测本地关键词准确率不足，应优先优化确定性 n-gram / 索引排序与 Legacy 兜底，不扩大付费模型调用。

---

## 15. Codex Desktop 施工指令（可直接复制）

> **任务：** 以 `wsdsb-111/VOCT-NEW` V9.3.4 提交 `941104063581f37de799065216ed422779460b8e` 为设计基线，按《V9_3_5_PAIR_MEMORY_INDEX_REVISED_IMPLEMENTATION_SPEC.md》实现 V9.3.5。该文档完整取代上一版 V9.3.5 设计稿。开始先验证当前工作区 HEAD 与未提交改动，不得擅自覆盖工作。按 Phase 0–6 逐阶段施工，每阶段先跑独立测试、再推进；不明确的身份/权限/来源契约须先停止并提出证据。**核心是两级检索：Owner→Counterpart 的重要事项簿作为轻量索引，每条必须包含有效 Legacy Source Key 和 Revision；历史事件命中后按需要读取对应原摘要正文，再与 Recent1 及相关事项共同组成一次正常 Chat Prompt。索引无命中必须保留原 Legacy 全文、人物和时间召回兜底。** 旧摘要回填必须有 UI 的 preview/confirm 和“查看原摘要”定位；新摘要提交后自动同步，编辑/删除/Forget 时索引不能残留。NPC↔NPC、NPC↔玩家同一套 Owner 定向规则。信件只修复 ACK 后的收信者/发信者 Legacy 摘要与恢复，保持已成功的宝物/弹窗 Effect，不重复下发。所有长期事项提取、索引、检索均为本地计算，额外 Provider 请求严格 0；Durable/Year/Life 永不恢复。保持旧 Token 总预算与原始存档安全。最终提交完整源/构建验证、自动化测试、真实 Windows CI、Electron 冒烟和待实机验收清单，输出 Implementation / Verification / Source Contract 报告。无可靠证据不得宣称 Full Freeze。

---

## 最终设计原则

> **完整 Legacy 摘要保存人物经历；长期事项簿记录“哪些重要事发生在何时、在哪一篇摘要”；两级检索帮助 NPC 找到该摘要中的完整经过。**
>
> **只用已有摘要、只做本地索引、不再支付第二轮记忆提取费用。**

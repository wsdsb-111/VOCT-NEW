# VOCT V9.3.6.3 综合改进与修复施工文档

> **版本**：V9.3.6.3（Core / App / UI，具体版本常量按仓库实际规范同步）
> **文档性质**：Codex 可直接执行的开发规格 / 修复与验收规范，**尚未实施**
> **仓库**：https://github.com/wsdsb-111/VOCT-NEW
> **冻结基线**：V9.3.6.2 运行代码 `abb5f9ce086a1da850b4aba78a7e429ac0cf27ae`；报告收口 `440251b5c4b0c710b67bff9ca93c277470c28cd9`
> **来源**：将已有 `VOCT_V9.3.6.3_Two_P1_Fix_Plan.md` 的 INT-03 / PERF-02 合并，并吸收 2026-10-17 实机反馈中新增的年龄、场外人物时间召回和 Regenerate 不一致问题。
> **版本定位**：只修复稳定性、正确性与旧档体验；**不得开发 V9.4 新功能、不得重新设计 Memory 总架构。**

---

## 0. 执行摘要与优先级

V9.3.6.2 的最大成功是：真实 CK3 对话等待从此前约 30–50 秒降到使用者观察的约 1–2 秒，同时按时间召回历史摘要的多数场景已能工作。V9.3.6.3 必须**守住这条性能基准线**，修补“正确性与稳定性尾部案例”，而非退回全量读取。

| ID | 等级 | 实机症状 / 已知代码风险 | 本版必须交付 |
|---|---|---|---|
| **AGE-01** | **P1** | 问 NPC 子女年龄，回复持续比 CK3 实际年龄大 1；年龄计算存在两条 `/365.2425` 路径，并覆盖游戏原始年龄 | 当前 CK3 权威年龄优先、生日边界正确、全部亲属展示路径统一 |
| **RECALL-01** | **P1** | 场外第三人摘要错召回／未召回，特别是询问明确年份或“去年”时 | 统一可信意图、关系目标 ID、时间窗口与 Pair 事项选取；可定位失败阶段 |
| **REGEN-01** | **P1** | 首次回答与点击重新生成采用不同的 Memory 路径；`supersede()` 清空 `currentTurn` | 对原合法玩家消息重建当前授权锚；原轮与重生成记忆选择可比较，来源变化时安全拒绝或重新验证 |
| **INT-03** | **P1** | “政变／登基／审判之后”可能被判 L0；原事件名白名单覆盖不全 | 用受约束的结构化时间语义识别回顾，避免误授权未来计划 |
| **PERF-02** | **P1** | 一条可定位的旧格式 Summary 可能使 300 Pair 全量扫描 | Pair 局部保守不确定集合；无法定位时才安全全量回退或 fail closed |
| OBS-01 | P2 | 用户看到“没想起”却不知道是模型忽略还是系统未注入 | 加入分阶段、匿名、不泄露正文的召回与再生成比对诊断 |
| QA-03 | **P1** | 旧测试缺少“真实角色年龄、相对亲属、重生成、时间召回”的端到端组合 | 红绿用例、A/B 同源对照、全量发布门禁、真实 CK3 烟测 |

**发布阻断**：任一 P1 不能通过独立 QA、访问控制回归、内容源完整性或性能保底门槛，均不得宣布 V9.3.6.3 完成。不得用“模型第二次答对”当作检索通过证据。

### 0.1 源码已核对的可疑路径（不把推断冒充已复现根因）

- `src/app/main/worldline/character-age-service.js`：在有 `birthDateTotalDays` 和 `currentTotalDays` 时使用 `Math.floor((currentDays - birthDays)/365.2425)`，即使与当前 `character.age` 冲突仍返回推算值。
- `src/app/main/game-data/relationship-resolver.js`：`buildCanonicalProfiles()` 对年龄再次按 `/365.2425` 推算并写入 `profile.age`，可能丢失原始 CK3 数值的优先级。
- `src/app/main/worldline/character-temporal-facts.js`：现有 `computeAgeAtDate()` 已按年/月/日和当年生日比较计算年龄；其他年龄服务未统一使用它。
- `src/app/main/memory-system/fuzzy-temporal-resolver.js`：可解析 `去年`、`前年`、`三年前`、显式年月／时间窗口。
- `src/app/main/memory-system/pair-memory-routing.js`：第三人 `PAST_HISTORY` 授权未全面消费同一套时间意图；普通 `去年` 查询可能进入 L0。
- `src/app/main/memory-system/player-centered-memory.js`：`resolveTemporalFocus()` 产生的时间信息与 `retrievePairMemorySources()` 的第三人候选查询尚未形成一致的窗口契约。
- `src/app/main/memory-system/pair-memory-source-retrieval.js`：第三人事项目标排序主要考虑关键词、Direct/Cross Pair 与日期；需审查是否把时间窗口作为权威相关性约束。
- `src/app/main/conversation/conversation.js`：`regenerateMessage()` 先调用 `turnManager.supersede()`。
- `src/app/main/conversation/conversation-turn-manager.js`：`supersede()` 将 `currentTurn=null`，而 `getMemoryContextFor()` 要使用 `currentTurn.playerMessageId` 获得 trusted player turn。
- `src/app/main/memory-system/owner-target-candidate-directory.js`：任何可索引来源字段不完整可能返回 `SOURCE_COVERAGE_INCOMPLETE`，造成全域扫描。

这些是**代码审查事实／高风险路径**；某个实机案例究竟在哪一步出错，需要新增诊断与复现证明。

### 0.2 绝对不可破坏的不变量

1. 每位回应 NPC 的基础记忆继续以 `Owner → trusted Player` 为中心；第三人历史**只限当前回应 Owner 的合法已知历史**。不能读取反向 `C→B`、第三方 `D→C` 私有视角。
2. 只能由**当前可信玩家消息**授权第三人读取；NPC、自述、旁白、嵌套引用、先前消息、同名歧义、过期场景绑定不能授权。
3. **L0**：不读第三人 Pair 索引、Source；**L1**：索引事项，第三人每目标最多 16 项，不打开原摘要全文；**L2**：符合明确详细历史请求，整条回退链 **Source Resolve 总尝试最多 2 次**（含失败）。
4. Campaign、Owner、Runtime ID、死亡／日期时间、Forget、Source Key/Revision、确认状态、Source Scope、旧摘要来源校验必须保持。
5. Responder Memory Budget 仍使用现有会话冻结规则与提供商请求预算守卫；不改变 V9.3.6.2 已实现的候选加速、GLM 90K Custom 新默认、Auto/Custom 上下文设置。
6. Regenerate 不写新的玩家轮次、不制造第二次玩家发言、不解除合法性检查；不能因“重新生成”而访问首次无权访问的历史。
7. 保留汇总、动作、信件、官方追忆、Worldline 与游戏当前事实的层级隔离；不恢复 Durable/Year/Life 生成；不改真实 CK3 存档与旧 Summary 数据。
8. 不在开发 QA 中实际调用付费模型，不泄露用户密钥、私人 Summary 原文或绝对路径，不自动推送 GitHub；如实标注未完成的实机／Provider 验收。

---

## 1. AGE-01（P1）：所有当前人物年龄必须与 CK3 Game Truth 一致

### 1.1 现状与失配机制

当前 `resolveCharacterAge()` 在生日及 totalDays 存在时，偏好 `/365.2425` 的派生年龄，`raw` 冲突只用于 `conflict:true`，不阻止错误推算注入 Prompt。`relationship-resolver.js` 又会将派生数写回 `profile.age`，使后续事实模块难以区分“CK3 原始年龄”与“二次推算”。二人对话中问“你儿子今年多大”时，链路通常经过：

```text
CK3 导出的角色/亲属数据
  → GameData.characters / relationship-resolver.buildCanonicalProfiles()
  → KinshipGraph / family-entity-fact-bundle
  → character-age-service.resolveCharacterAge()
  → character-family-facts.buildFamilyFactBlock()
  → PromptBuilder 中的结构化家庭事实
  → 模型回答
```

**禁止仅在 Prompt 中写“年龄减一”**：这会破坏生日已过、历史日期、死亡时年龄、未知生日等正常场景。

### 1.2 统一年龄事实的来源规则

新增小型、无副作用的年龄决策契约（可在现有 `character-age-service.js` 实现，避免另立大框架）：

| 查询环境 | 优先来源 | 备用来源 | 禁止事项 |
|---|---|---|---|
| **当前在世人物**，CK3 本轮直接提供可信整数 `age` | `CK3_CURRENT_AGE` | 不需要 | 不得由 `/365.2425` 覆盖 |
| 当前在世人物，只有生日与当前游戏日期 | `BIRTH_CURRENT_CALENDAR`：按年月日是否过生日计算周岁 | 如仅有可信日序列且确定共用历法，可做一致的日期转换后计算 | 不得对天数除以平均年长后宣称精确周岁 |
| 当前在世人物，来自亲属边关系中的可信 CK3 年龄 | `CK3_LIVE_RELATIVE_AGE`（需与源证据 ID/来源绑定） | 生日推算 | 不能被低优先级摘要或推断覆盖 |
| **历史指定日期**的年龄 | 出生日期和目标历史日期；若出生日期缺失则年龄未知 | 如有明确“某日期存档年龄”可使用当时权威记录 | 不得把“现在年龄”直接代入历史日期 |
| 已故人物的去世年龄 | 可信 CK3 明确 `ageAtDeath`，否则出生／死亡日期按周年计算 | 时间数据不足时未知 | 不得把去世时年龄当成当前年龄 |
| 证据冲突或缺失 | 返回 `null`/带状态的结构化数据，诊断冲突 | 允许明确说明不能确定 | 不得臆测或任意 ±1 |

**注意**：“原始 `age`”须确认为最新合法 CK3 运行态观察，不是 Memory 文本、旧历史 Summary 中的某个年龄。当前角色和仅存在于亲属关系记录的离场人物，来源等级不同，必须保留出处；禁止一刀切认为任意 `profile.age` 就是 CK3 当前值。

### 1.3 最小数据结构和修改边界

建议在权威入口保留原始值，避免衍生 Profile 将其改写：

```js
{
  age: 17,                       // 对外展示的统一决议值
  ageSource: 'CK3_CURRENT_AGE',
  ck3CurrentAge: 17,             // 本轮可信 GameData 原始值；有则保存
  calculatedCalendarAge: 18,    // 仅诊断，不覆盖权威值
  conflict: true,
  asOfGameDate: '1190.5.2',
  sourceCharacterId: 12345
}
```

任务分解：

1. 在 `game-data/character.js`、`game-data/game-data.js` 检查 `Character.age` 的解析和数据时效；检查亲属列表是否有可靠的年龄字段（如果缺失不能杜撰）。
2. 在 `game-data/relationship-resolver.js` **先保留 canonical 原始 age 与证据**，再执行新年龄解析；不能先改写 `profile.age` 再把它当作“CK3 原值”使用。对于仅有关系边的离场人物，要依证据优先级判断是否可认定为直播年龄。
3. `worldline/character-age-service.js` 改为有明确来源优先级的唯一判定入口。优先纯函数 `computeAgeAtDate()`，如需 totalDays 只能做该存档历法下经验证的完整日期映射，不沿用不精确的 `/365.2425` 周岁近似。
4. `worldline/character-temporal-facts.js` 同时检查 `computeAgeAtDeath()` 的 `/365.2425` 分支；修为同一来源约束，避免死亡年龄独立多一岁。
5. `character-family-facts.js`、`family-entity-fact-bundle.js`、`relationship-current-truth.js`、`kinship-graph-cache.js` 的年龄显示/决策全部调用统一年龄契约，保留 `ageSource`，不得各自重算或互相覆盖。
6. 如发现 CK3 游戏内部“年龄”口径（包括生日当日、生卒日期、闰日）与公历日期不一致，以**可验证的 CK3 导出真实观察**为对齐标准；先写最小复现实验，不武断假设游戏使用公历或平均年长。
7. 增加 `AGE_SOURCE_CONFLICT` 匿名计数诊断，按 `characterIdHash`、来源、原值/推算值、当前日期区分；日志不得包含人物私密描述。

### 1.4 年龄专项必须通过的测试

| 编号 | 场景 | 必须结果 |
|---|---|---|
| A01 | CK3 当前年龄 17，生日推算 18 | 回答事实是 17，诊断冲突，不静默覆盖 |
| A02 | CK3 当前年龄 18，推算也是 18 | 无冲突，保持 18 |
| A03 | 生日的前一天、当天、后一天 | 周岁切换只在生日边界发生 |
| A04 | 无生日仅有 CK3 age | 正确使用 CK3 age |
| A05 | 没有 CK3 age，但有完整出生日期 | 采用已验证日历周岁，不出现 n+1 |
| A06 | 只有总日数且无法确认日期口径 | 安全未知或明确低置信来源，不伪装精确年龄 |
| A07 | 儿子、女儿、兄弟姐妹、配偶、离场亲属 | 所有 family fact 渲染一致，无双重计算 |
| A08 | 同名两个儿子，玩家只问“你儿子多大” | 不能随机选一人，需澄清或列出可证实者 |
| A09 | 生卒年月、已故亲属，死亡年龄 | 年龄不随游戏当前日期增长 |
| A10 | 闰年与 2 月 29 日出生的 CK3 角色 | 依经验证游戏日历规则测试边界 |
| A11 | 年龄从 17→18 的游戏跨年/生日更新 | 缓存正确失效，不沿用旧当前事实 |
| A12 | 当前生日不足以判定、Game Truth 与 Memory 冲突 | 不以 Memory 覆盖 CK3 权威年龄 |
| A13 | `relationship-resolver` 输出到 `family-entity-fact-bundle` | 来源标记与值保持不变，不二次推算 |
| A14 | 老存档中角色只有部分亲属资料 | 不输出伪造年龄、不把无证据关系当成确认关系 |

**验收标准**：用用户观察的真实问题“你儿子今年多大了？”建立可重复、包含其 GameData 源输入的隔离样本；修复后结构化 Prompt 中必须已经是 CK3 正确年龄，不能依赖生成模型偶然答对。

---

## 2. RECALL-01（P1）：第三人记忆的时间窗、人物与来源精确一致

### 2.1 故障要区分的四种情形

```text
可信玩家问句
  ① 授权判定：L0 还是 L1/L2？
  ② 目标解析：唯一人物 ID？“你儿子”能否经权威关系解析？
  ③ 时间选择：去年/1190年/三年前 → 哪个游戏日期区间？
  ④ 检索与注入：合法 Owner→Pair 来源是否匹配、排序、去重、预算、最终是否注入？
  ⑤ Provider 生成：模型是否依据已注入摘要回答？
```

不能把所有“没想起”都归结为生成质量。如果 ①–④ 任一步失败，调整模型温度也无法解决；如果 Prompt 已正确注入而文本不遵从，则是单独的生成可信度问题。

### 2.2 意图与时间解析使用同一个可信请求

在 `resolveHistoryDecision()`/`classifyTemporalIntent()` 之前明确绑定：`trustedPlayerTurn`、Owner、playerAnchor、conversationId、sceneRevision、turnEpoch、messageId；只从此来源解析待查询时间和人物语义。**不能用 NPC 对话或旧历史日志中的日期替代玩家时间锚点**。

建议建立纯数据 `AuthorizedHistoryQuery`（命名可调整）：

```js
{
  ownerId, playerAnchorId, trustedMessageId, conversationId, turnEpoch,
  targetCharacterIds: [300], targetResolution: 'EXPLICIT_ALIAS' | 'KINSHIP_UNIQUE',
  level: 'L1',
  temporal: {
    requested: true,
    mode: 'EXPLICIT_YEAR' | 'TARGET_DATE' | 'FUZZY_RECENCY' | 'NO_TIME',
    fromGameDate: '1190.1.1', toGameDate: '1190.12.31',
    fromTotalDays: 123, toTotalDays: 487,
    anchorGameDate: '1194.2.1', source: 'TRUSTED_PLAYER_QUERY'
  },
  intentFingerprint, targetResolutionRevision
}
```

此结构只承载检索筛选依据；不跳过 `classifyThirdPersonHistoryRequest()` 的 L0/L1/L2 授权，不直接打开任何摘要。对同一个问题不能在 Worldline 与 PairLedger 使用互不相干的“去年”解释。

建议把 `fuzzy-temporal-resolver` 的有效区间转为同一游戏日期语义，同时赋予明确的理由码，例如 `TIME_EXPRESSION_RECOGNIZED`, `HISTORICAL_INTENT_AUTHORIZED`, `HISTORICAL_INTENT_DENIED`, `TEMPORAL_WINDOW_MISMATCH`。**识别到“去年”不等于自动允许第三人私有记忆读取**；仍需有过去询问语义、唯一目标及可信玩家输入。

### 2.3 亲属称谓目标的安全解析

情境：“你儿子去年说过什么？”或者“你和你儿子三年前关系如何？”

1. 先通过当前 `anchored-relation-resolver` / `KinshipGraph` 在**回应 NPC 的视角**解析“你儿子”到唯一 Runtime ID；只认当前可信游戏关系，不通过 Memory 文本猜父子关系。
2. 若有两个或更多儿子、关系冲突、仅有姓名同音或游戏数据缺失，结果为 `TARGET_AMBIGUOUS/UNRESOLVED`，不得自动选最近一次被提过的人。
3. 若只问“你儿子多大”，属于当前 Game Truth 年龄事实，应走 AGE-01，不为此无故触发 L1/L2 历史检索。
4. 若明确问其过去经历，唯有可信玩家问句、唯一亲属目标、历史意图三者均满足，才将已解析 ID 作为 `resolvedTargets` 传入既有授权检查；禁用无证据的别名推断。
5. 对老旧 Summary 中的人名映射仍用现有 `OwnerTargetCandidateDirectory` 保守候选，**角色 ID 是授权身份，不允许以名称匹配替代身份**。

### 2.4 时间优先检索和 fallback 策略

- 将已授权 `temporal` 传入 `retrievePairMemorySources()`，作为目标 Pair 候选的**相关性筛选条件**，先于“越新越优先”的排序；仍以 `PairLongTermLedger` 的有效性过滤为权威。
- **明确年份/日期**：只选择 `conversationDate`/可验证历史时间字段位于所问范围内的事项；找不到时返回 `TIME_WINDOW_NO_MATCH`，不能拿最近一年的摘要“补位装作当年的话”。历史事实的“事件发生日”与“摘要成文日”不同，必须分别标注；如没有事件日期，只能表述“某日期的谈话提过此事”。
- **模糊时间（许多年前、前些年）**：首先命中 primaryWindow；只有玩家语义允许模糊搜索且主窗口无命中时才可尝试扩展 `expansionWindow`，记录 `TEMPORAL_EXPANSION_USED`，不能隐式跨期。
- **无指定时间**：保留 V9.3.6.2 常规分年/相关性排序，不对普通聊天注入额外筛选成本。
- 多人物时每个目标独立遵守 ≤16 条和预算；L2 仍遵守≤2来源尝试；时间过滤不能让不可信历史解禁。
- 对“你们五年前约定，后来真的做到了吗”这类询问，来源区分 **历史承诺** 和 **履行证据**：没有后续证据不得推断已履行。
- 如时间窗有结果但用户具体问题所需的 item 被预算挤掉，应返回 `RELEVANT_ITEM_BUDGET_OMITTED`，避免把“未注入”误写成“没有历史”。

### 2.5 防止缓存跨人物、跨时间污染

第三人动态查询缓存键至少包含：`ownerId`、playerAnchor、trusted message ID、turnEpoch、场景修订、目标 Runtime IDs、明确时间区间（含解析来源与 current game date）、query fingerprint、Source Revision、摘要覆盖 fingerprint、Forget epoch、Memory Budget/Provider headroom。若为 regenerate，见 REGEN-01 的“逻辑玩家轮次与物理生成轮次”分别建模。

**源快照有效性检查必须继续覆盖选中 Pair 和整个 Owner**；不能为追求 1–2 秒速度绕开 `beginOwnerRead()/validateOwnerRead()`。时间范围变更不得重用上一轮的 `dynamicKey`。

### 2.6 第三人时间召回专项用例

| 编号 | 问句与场景 | 期望 |
|---|---|---|
| T01 | “去年你和玛蒂尔达谈过什么？”有去年摘要 | L1；取去年记录，不是最近记录 |
| T02 | “三年前你和玛蒂尔达争论过什么？” | L1/L2 按明确细节规则；锁定三年前窗口 |
| T03 | “1190年你们谈的盐税？” | 命中 1190 年摘要，日期可追溯 |
| T04 | 明确 1190 年无内容，1192 年存在 | 明示无指定窗口证据；不得拿 1192 年冒充 |
| T05 | “前些年”主窗口无结果，扩展窗口有 | 只在允许扩展时召回并标识扩展 |
| T06 | A→B 当前玩家问 B 关于离场 C | 只使用 B Owner 的已知 Pair，不读 C→B 或 D→C |
| T07 | “你儿子去年说过什么？”且唯一儿子 ID 已确认 | 传入对应目标 ID；记忆授权正确 |
| T08 | 两个儿子且未指名 | 不擅自绑定；明确 `TARGET_AMBIGUOUS` |
| T09 | “你儿子现在几岁？” | 年龄 Game Truth；不触发第三人 L1/L2 |
| T10 | “去年之后你准备怎么安排玛蒂尔达？” | 不将未来计划误授权历史 |
| T11 | NPC 说起“去年玛蒂尔达……”但本轮玩家未问 | L0；NPC 发言不能触发第三人历史 |
| T12 | 源摘要日期在当前 CK3 日期之后 | 不得召回未来资料 |
| T13 | 同名不同 ID、父子身份已变、Campaign/scene 切换 | 权限和缓存均不串线 |
| T14 | 文件 Forget、编辑、确认/撤回、mtime 同值改写 | 已缓存结果失效，绝不复活删除来源 |
| T15 | 时间范围内有 20+ 条，预算不足 | 不破坏 ≤16、固定预算，诊断 `BUDGET_OMITTED` |
| T16 | `exhaustive-reference` 与目录优化使用同一时间窗 | 事项身份、排序、来源与选取结果一致 |
| T17 | 对话摘要日期与事件发生日期不同 | 来源标签正确，不能声称摘要成文日等于事件日 |
| T18 | 同一合法询问在上下文未变化下检索 3 次 | 候选与最终注入指纹一致；模型输出允许文字差异 |

---

## 3. REGEN-01（P1）：重新生成必须恢复可信玩家锚与检索一致性

### 3.1 已确认路径与正确的问题表述

`conversation.js::regenerateMessage(messageId)` 调用 `getTurnManager().supersede(...)`，后者在 `conversation-turn-manager.js` 中增加 epoch、终止当前响应、清空队列和 `currentTurn`。后续 `getMemoryContextFor()` 又从 `currentTurn.playerMessageId` 获取 `resolveActiveMemoryPairs()` 的可信玩家消息依据。**因此 regenerate 的授权上下文可能不同于首次生成**。

但玩家观察到“第一次乱答，点重新生成第二次准确”，**并不能反推第二次一定读到了摘要**。可能是第一次没检索、第二次从其他上下文推对、第二次采样偶然正确或首次/二次 Prompt 不同。必须用每次实际发送的 Prompt 指纹和 Memory 选取证据分辨。

### 3.2 推荐实现：逻辑玩家请求 vs 物理生成尝试

引入清晰分层：

```text
LogicalUserTurn (已经存在的真实用户消息)
  playerMessageId, speakerCharacterId, originalTurnIdentity,
  conversationId, sceneRevision, validated source message

GenerationAttempt (首次/点击重生/重试)
  attemptEpoch, attemptId, responderId, startAt, AbortController,
  logicalPlayerMessageId, regenerateOfMessageId,
  memoryQueryFingerprint, memorySelectionDigest, memoryInjectionDigest
```

在 `ConversationTurnManager` 新增**受约束的再生成入口**（例如 `startRegenerationTurn`）：

1. 找到被重新生成的 assistant 回复之前，最近一条**仍存在于当前对话、角色为 user、`speakerCharacterId===playerID`** 的合法玩家消息；**不得从被删掉的 assistant 或历史 NPC 消息获得授权**。
2. 校验该玩家消息确为此回应所属的未改变对话／场景／玩家锚，不能跨新一轮玩家提问或已经改动的 Campaign/Branch 承接旧身份。
3. **仍需**增加新的 `turnEpoch` 并取消旧响应，防止过期输出写回；但同时为当前物理尝试建立指向这条既有 `playerMessageId` 的可信 `currentTurn`，而不是留空。
4. 这个入口**不会新增 user message，不调用 `observeParticipants` 重复记账，不更新历史日序列、不提交 Seen，不触发摘要 Finalization**。
5. `resolveTrustedPlayerTurn()` 必须基于**本次校验通过的原玩家消息与新 attempt epoch** 重新生成可信证据；原先的场景绑定 / 第三人目标要再次合法解析，不得简单复制前一次 `historyBinding` 作为特权。
6. 处理多人轮次：当重生成的是较早 NPC 回复，切除后续 assistant 消息，但保留该轮先前已响应 NPC 的事实和排队语义；同一玩家消息下的多个回应者拥有独立 Owner、独立 Memory 缓存和授权。
7. “Regenerate 错误消息”与“发送新玩家消息”也应检查它们是否需要相同的安全重建，不能把 `startUserTurn` 对真实输入的责任挪给 retry 路径。

建议为每次生成跟踪 `logicalPlayerMessageId` 与 `attemptEpoch`：两者不等同。所有授权验证仍发生于**当前物理尝试**，逻辑消息只标明当前回复由哪条玩家消息触发。

### 3.3 同一来源下的首轮/重生成验收契约

对于同一 Owner、玩家问句、GameData、Campaign、Scene、摘要文件、预算、Provider 能力、历史截断与其他可观测上下文不变的两次生成：

- 可信玩家锚身份应相同，`turnEpoch/attemptId` 可以不同。
- 授权 `L0/L1/L2`、目标 ID、时间窗口及源集合/Source Revision 应一致。
- Memory 选取结果及**最终实际 Prompt 中的记忆块指纹**应一致（固定快照场景）。如果动态排序用 epoch 作缓存键，也应得到同样结果，不因缓存冷热不一致。
- 如某字段因新增 NPC 回复、摘要轮替、Source Revision、Forget 或游戏日期变化而合法改变，则明确记录 `SNAPSHOT_CHANGED`，不能声称“完全相同 Prompt”。
- **生成内容本身无须字面相同**：模型采样/非确定性可能造成措辞变化，验收的是权限、检索和注入一致。

### 3.4 截止发送的守卫与缓存提交

1. 沿用 `beforeSendGuard`、`validatePlayerMemoryContext`、`isResponseCurrent`；旧 attempt 取消后其 callback/stream 禁止写回、禁止提交 Seen 和旧 Memory。
2. 重生成在真实来源发生变化时安全重检，不能把旧 promptSnapshot 直接发出。
3. 用 `memorySelectionDigest`（源 key/revision、item ID、目标 ID、时间窗）与 `memoryInjectionDigest`（**真正渲染出的**记忆块 ID + 内容哈希 + Token 数）区分“选中了摘要却被预算挤掉”和“根本未选中”。
4. 不应将原始 NPC 对话、Summary 内容、私有角色姓名或游戏路径输出进常规遥测；局部开发可在用户主动导出的文件中包含最小对照并默认脱敏。
5. 建议将“首次与重生不一致”按三类状态报告：`AUTHORIZATION_CHANGED`、`SOURCE_CHANGED`、`PROMPT_INJECTION_CHANGED`；以上都不是简单的模型随机性。

### 3.5 Regenerate 红绿测试矩阵

| 编号 | 场景 | 期望 |
|---|---|---|
| R01 | 玩家询问 B 的第三人历史，首次生成后立即 Regenerate | 新 attempt 恢复原玩家 ID，L1/L2 与目标 ID 一致 |
| R02 | 首次回复上下文包含去年摘要，点击重生 | 同一时间窗、相同已注入来源指纹 |
| R03 | 在首次生成过程中点击重生 | 旧 response/stream aborted，不提交旧 Seen，不二次写 Finalization |
| R04 | A→B→C 多人轮同一玩家消息，重生 B 的回复 | 只重置 B 及后续需重生内容，不把 C 私有视角给 B |
| R05 | 玩家提新问句后尝试重生旧轮 | 拒绝沿用旧轮历史授权，或走明确受限的历史重演流程；不得读当前不合法来源 |
| R06 | Source/Forget/Campaign/Scene 在两次尝试间变化 | 旧缓存失效并重新授权或 fail closed |
| R07 | 无 preceding user 或玩家角色 ID 不匹配 | L0；不能凭 assistant 文本授权历史 |
| R08 | 相同 Source + 预算 + Prompt，连续 5 次重生 | `memorySelectionDigest`/`memoryInjectionDigest` 一致；生成文字可不同 |
| R09 | 摘要可选中但记忆预算不足 | 诊断显示 `BUDGET_OMITTED`，不得误认为 INDEX_MISS |
| R10 | 三人互相发言、NPC 引述玩家历史问题 | 不发生 NPC→玩家可信消息升权 |
| R11 | 玩家消息在历史滚动压缩后被删除／不可验证 | 不从压缩 Summary 伪造历史授权；显式失败或受控 L0 |
| R12 | 相同正文却不同角色 ID/会话 ID/Scene | 不复用原轮授权 |

---

## 4. INT-03（P1）：扩展历史语义但不扩大权限

### 4.1 不再依赖事件名称白名单

原 `HISTORICAL_AFTER_PATTERN` 只能覆盖战争、围城、婚礼、加冕等少数事件。需要拆成**时间锚 + 既成/回顾谓词 + 非未来排除**，只用于意图识别，再交给既有可信玩家和人物目标授权验证。

将识别组合拆成纯函数：

```text
当前玩家、去引号文本
 → splitIntentClauses()
 → detectClauseDenial()                 // 分句否定
 → detectExplicitPastAnchor()           // 曾经/当年/去年/三年前/1190年...
 → detectCompletedEventAfterRecall()    // 某事件之后+发生了什么/关系如何等
 → detectFutureDependency()             // 等...之后要/计划/准备/通知...
 → classifyIntentClause()
 → resolveHistoryDecision() 的权限和唯一目标检查
```

**关键约束**：`X之后` 本身既可指已经发生的事件，也可指计划中的事件，不能仅凭任意名词 + “之后”判为历史。`去年` 表明时间，但“去年之后你准备如何……”同时有未来行动含义，须进行句内语义判别；“当年政变之后你如何安排了玛蒂尔达”属于回顾。

- **明确历史且唯一目标**：通常 L1；明确索取原话、具体经过等且授权满足原条件才可 L2。
- **当前／未来计划、提醒命令、受否定对象、无目标、引用独立文本**：L0。
- **多分句**：合法历史分句与另一个未来/否定分句隔离；只授权目标范围内的历史问题，不能跨句合并成更高权限。
- 修改 `ROUTE_SCHEMA_VERSION`，失效先前语义缓存；不得绕开 `namedTargetFocus`/`historyBinding` 的会话和场景约束。

### 4.2 语义红绿矩阵（每个等级在施工前冻结，不能用宽松断言充数）

| ID | 询问 | 期望 |
|---|---|---|
| I01 | 政变之后你和玛蒂尔达发生了什么？ | L2（若现有 DETAIL_PATTERN 对“发生了什么”授权 L2），目标唯一 |
| I02 | 登基之后你和玛蒂尔达关系如何？ | L1 |
| I03 | 审判之后你们有没有再见面？（已有唯一有效绑定） | L1 |
| I04 | 继承纠纷结束以后，你们的关系有什么变化？ | L1 或经冻结详情契约 L2 |
| I05 | 当年政变后你如何处理了玛蒂尔达？ | 历史，不得 L0 |
| I06 | 等政变结束之后你准备怎么安排她？ | L0 |
| I07 | 政变之后要不要通知玛蒂尔达？ | L0 |
| I08 | 记得政变结束以后把信交给玛蒂尔达。 | L0 |
| I09 | 别回忆玛蒂尔达的往事。 | L0 |
| I10 | 别说废话。登基之后你们关系如何？ | 正常授权对应历史分句 |
| I11 | 不谈玛蒂尔达。去年你和丁大人谈了什么？ | 只给丁合法历史权限 |
| I12 | “政变之后你和玛蒂尔达发生了什么？”这句话是什么意思？ | L0 |
| I13 | NPC 发言含“去年／当年” | L0，不允许以 NPC 授权 |
| I14 | 那后来呢？有效同场景相邻玩家绑定 | 依原权限与目标绑定可 L1 |
| I15 | 那后来呢？绑定过期／场景已变 | L0 |
| I16 | 去年你和玛蒂尔达谈过什么？ | 历史 L1，且 T01 时间窗生效 |
| I17 | 三年前你们究竟争论了什么？（目标可唯一绑定） | 根据冻结详情规则 L2，不得跳错年 |
| I18 | 你儿子今年几岁？ | 不触发第三人历史；应走当前家庭事实 |
| I19 | 不谈玛蒂尔达；不过当年你和丁为何决裂？ | 仅丁历史，局部否定有效 |
| I20 | 战争之后你和玛蒂尔达发生了什么？ | 保留 V9.3.6.2 已通过用例 |

对于业务允许 L1/L2 的边界，**Codex 首先定义固定等级预期**，不能以 `[L1,L2]` 作为最终发布测试断言。

---

## 5. PERF-02（P1）：旧摘要按 Pair 局部保守回退

### 5.1 与旧版基线的差异

V9.3.6.2 的 `OwnerTargetCandidateDirectory.getCandidateScopes()` 在当前可信 Owner Snapshot 中发现 `pairLedgerSources=[]`、`rawSummary=null`、缺签名/digest 等情况时，可直接返回 `UNAVAILABLE/SOURCE_COVERAGE_INCOMPLETE`。`pair-memory-source-retrieval.js` 因而选 `allScopes` 全量扫描。一个局部旧数据异常就可能把 300 Pair 的低延迟优化抵消。

**本版的改动不是忽略旧摘要，而是把“局部不能证明为无关”变成“该 Pair 必须强制交权威读取器校验”。**

### 5.2 覆盖状态与唯一安全公式

令 `U = directPairScopes ∪ collectOwnerCounterpartIds(ownerSnapshot, ownerId, campaignToken)`，候选 `C` 必须是**所有可能提供合法事项的 scope 的超集**：

```text
C = DirectScopes ∪ AliasMatchedTrustedScopes ∪ UncertainScopedScopes
```

| 覆盖状态 | 条件 | 动作 |
|---|---|---|
| `PROVEN_COMPLETE` | 有可核验来源和完整 alias 信息，Pair 覆盖可证明 | 只有匹配时纳入，Direct Pair 始终纳入 |
| `UNCERTAIN_SCOPED` | 来源缺字段，但从可信 Owner 的 `counterpartId(s)` / `pairLedgerSources` **可证明**所属 Pair 集 | 对该 Pair 全纳入，后续仍做 `PairLongTermLedger.read()` 权威复验 |
| `UNSCOPED_UNKNOWN` | 缺来源的合法 Owner 记录无法可靠绑定任一 Pair，或目录的 scope universe 不完整 | 回退旧 `exhaustive-reference`；必要时 fail closed |
| `STALE` | Owner Snapshot、Forget、来源内容、Campaign、epoch 竞争 | 丢弃整轮结果，安全结束，不注入旧摘要 |

**关键逻辑**：只有覆盖证明成立的 `COMPLETE/SCOPED_DEGRADED` 才能走缩减候选。对缺失的 `rawSummary`，若 `source.counterpartId` 是可信且与 Owner scope 宇宙一致，则只把这一个 Pair 标记不确定。对一个记忆有多个可信 `counterpartIds`，必须**全部加入不确定范围**；不确定数据不能被解释为“不包含目标”。

伪代码：

```js
const candidate = new Set(directPairIds);
const uncertain = new Set();
let hasUnscopedUnknown = false;

for (const ownerMemory of ownerSnapshot) {
  if (!isOwnerCampaignKnownMemory(ownerMemory)) continue;
  const provenScopes = safelyDerivePairIdsFromTrustedProvenance(ownerMemory, universe);
  if (isCompleteProvableSource(ownerMemory)) {
    for (const scope of matchingAliasScopes(ownerMemory)) candidate.add(scope);
  } else if (provenScopes.complete && provenScopes.ids.length) {
    for (const scope of provenScopes.ids) uncertain.add(scope);
  } else {
    hasUnscopedUnknown = true;
  }
}
for (const scope of uncertain) candidate.add(scope);
if (hasUnscopedUnknown) return useExhaustiveReference();
return useConservativeCandidateSuperset(candidate);
```

上述是**设计示意**，不能直接替换既有校验。必须确认 `PairLedger.collectSources()` 可读的所有来源均被 `provenScopes` 覆盖，否则全域回退。不从正文姓名臆造可访问 Pair，不从 `C→B` 或其他 Owner 反向寻找缺失索引。

### 5.3 源校验、并发和缓存

- 只使用通过 `beginOwnerRead()` 的 Owner 快照；全局 Owner 完整性与结束 `validateOwnerRead()` 不变。
- Pair 内 `read()`、`resolveSource()`、确认、历史日期、Forget、revision、索引签名与 `beforeSend` 继续走权威路径。
- 目录缓存键延续 Owner、Campaign、alias/Target、Scene、Current Date、Source Identity Digest、epoch；新增 `uncertainCounterpartIds` 和 coverage 状态必须纳入 checksum。
- Snapshot 修改、文件新增/删除、同 mtime 同大小篡改、确认事项、Forget、角色 ID/别名变化、Campaign 转换要使缓存失效。
- 不为了性能消除验证，也不简单截断前 N 个 Pair；目录只负责缩减**不可能相关**的 scope。
- `SCOPED_DEGRADED` 属于完成证明的安全候选超集，不统计为全域 fallback；单独记录可定位不确定源个数。

### 5.4 旧摘要专项矩阵

| ID | 数据场景 | 期望 |
|---|---|---|
| C01 | 300 Pair，全部新格式 | 与 V9.3.6.2 同级性能和一致结果 |
| C02 | 300 Pair，一个可定位旧摘要缺 `pairLedgerSources` | 仅相关 Scope 局部复验，无 300 全量 |
| C03 | 300 Pair，5 个可定位旧源异常 | 候选仅局部增加，结果与 reference 一致 |
| C04 | `rawSummary=null` 但可信 Pair ID | 该 Pair 不确定，局部权威复验 |
| C05 | 缺 digest/signature，有合法 Pair | 局部复验，不提前当作确证空结果 |
| C06 | Pair universe 中某 Pair 来源覆盖不全 | 局部不确定，不影响其他 Pair |
| C07 | 旧数据缺乏可证 Scope 映射 | `UNSCOPED_UNKNOWN`，完整 reference 或安全终止 |
| C08 | Owner 快照本身失效／源文件竞争 | `SOURCE_STALE` fail closed |
| C09 | 相同 finalization 多 Pair 合并投影 | 所有独立有效 Pair 均保留 |
| C10 | 已确认歧义 Legacy item | 与 reference 完全一致 |
| C11 | Campaign/Forget/Confirm/日期边界 | 不越权，不复活禁用历史 |
| C12 | 同名不同 ID、别名变更、Responder 变化 | 不串 Owner，不误绑定 |
| C13 | 文件改写但 mtime/长度碰巧不变 | 基于真正 Source Revision 检出 |
| C14 | safe → exhaustive → safe 模式切换 | item IDs、source key、revision、顺序一致 |
| C15 | **无关非目标 Pair** 的单个旧摘要坏项 | 不应触发 300 全量 |
| C16 | 300 Pair 全部不确定 | 可自然全域退化，不得丢合法候选 |
| C17 | symlink/junction/非法来源路径 | 沿现有安全路径拒绝，不读不安全位置 |
| C18 | 同一个旧摘要关联多个可信 Pair | 所有相关 scopes 进入候选 |

**专项注意**：旧 `test-v9.3.6.2-candidate-directory-qa.js` 曾断言缺 `rawSummary` 必须全量回退；施工中应改为**可证明 Pair 已定位就局部复验**，并单独保留 unscoped unknown 的全量 fallback 红绿用例。不能仅删除旧断言而不给新边界。

---

## 6. OBS-01（P2）：离线可定位的检索证据与 Regenerate 对照

### 6.1 每次真实发送请求至少跟踪的诊断

| 分层 | 字段 | 用途 |
|---|---|---|
| 玩家来源 | `trustedPlayerTurnResolved`、`logicalPlayerMessageIdHash`、`attemptEpoch`、`regenerateOf` | 首次与重生是否同一合法问句 |
| 权限 | `thirdPersonIntentLevel`、`intentReasonCode`、`targetResolution`、`targetCount` | L0 与目标歧义分辨 |
| 时间 | `temporalMode`、`timeWindowStart/End`、`timeAnchorStatus`、`timeFallbackReason` | 识别／授权／窗选一致性 |
| 目录 | `ownerPairCount`、`candidatePairCount`、`uncertainScopedScopeCount`、`legacyScanFallbackReason`、`candidateDirectoryCacheHit` | 是否受旧档回退影响 |
| 来源 | `sourceRevisionDigest`、`selectedItemDigest`、`candidateVisibleCount`、`matchedWindowCount` | 是否实际找到合法历史 |
| 注入 | `selectedMemoryTokens`、`renderedMemoryTokens`、`injectionBlockDigest`、`budgetOmittedCount` | 是找到没注入，还是没有历史 |
| Provider | `promptFingerprint`、`requestBudget.safe`、`providerModelId`、`sendGuardStatus`、`generationStatus` | 是检索问题还是输出遵循问题 |
| 关系／年龄 | `ageSource`、`ageConflict`、`relationResolutionStatus` | 年龄 +1 与亲属绑定排查 |

对同一 `logicalPlayerMessageIdHash` 的首次生成与重生，提供**可导出的脱敏对照表**：权限 / Target / 时间 / 选取事项 / 渲染块指纹 / Provider 输入指纹 / 输出是否遵循来源。常规遥测不能落地 Summary 原文、人物可识别姓名、用户输入原文、API Key 或私人绝对路径。

### 6.2 可直接解释给用户的状态码

`NO_TRUSTED_PLAYER_TURN`、`HISTORY_INTENT_NOT_AUTHORIZED`、`TARGET_AMBIGUOUS`、`TARGET_UNRESOLVED`、`TIME_EXPRESSION_RECOGNIZED`、`TIME_WINDOW_NO_MATCH`、`SOURCE_STALE`、`INDEX_UNAVAILABLE`、`SOURCE_COVERAGE_INCOMPLETE`、`BUDGET_OMITTED`、`SELECTED_NOT_INJECTED`、`INJECTED_SUCCESS`、`MODEL_OUTPUT_NOT_GROUNDED`（最后一项**只能靠独立检验，不能仅凭主观评分**）。

**不得**把没有查到、未授权、不完整、被预算裁掉或模型忽略统一报告为 `INDEX_MISS`。

---

## 7. 综合 QA、性能与回归门禁

### 7.1 开发先红后绿

建议新增（文件名可依仓库规范调整）：

```text
scripts/test-v9.3.6.3-age-authority.js
scripts/test-v9.3.6.3-kinship-temporal-recall.js
scripts/test-v9.3.6.3-regenerate-consistency.js
scripts/test-v9.3.6.3-intent-grammar.js
scripts/test-v9.3.6.3-legacy-scoped-coverage.js
scripts/test-v9.3.6.3-mixed-archive-ab.js
scripts/test-v9.3.6.3-integration-release-qa.js
```

至少证明下列三条可复现“先红后绿”：

1. **年龄红例**：同一个可信 CK3 人物 `rawAge=17`，日序列推算=18，最终 Prompt 事实错误；修后恢复 17。
2. **历史红例**：离场第三人“去年”和“政变之后”有合法 Owner 摘要，旧版 L0 或错年；修后正确 L1/L2 + 对应窗口。
3. **重生成红例**：`regenerateMessage()` 清空 `currentTurn` 导致 trusted player turn 不可解析；修后恢复同一合法玩家锚和来源指纹。
4. **旧档红例**：300 Pair 中一个可定位缺字段源使候选变 300；修后局部 Scope，且结果 reference 等价。

### 7.2 端到端组合测试

- 年龄问答 + 父子关系 + 同名多人 + 离场人物；断言**最终 Prompt 中家庭事实是准确年龄**。
- 同一离场角色连续问 1190 年、去年、随后、现在计划，确保历史级别／时间焦点独立且场景绑定正确失效。
- 同一句历史问题首次回答、连续 5 次 regenerate，比较**已发送 Prompt 的记忆块内容 hash**，而非只比较回答措辞。
- 三人、四人以上不同回应者、不同 Owner，重生先前某一 NPC 回复后不得串配对私有历史。
- 新旧混合摘要以及同 source 修改／Forget／日期变更后重生，确认修订重检和 fail closed。
- GLM 默认新实例仍保持 Custom 90000；用户旧 Custom / Auto / 1M 配置均不被本版改变；历史长 Prompt 的 Provider Guard 不退化。
- L0=0 PairLedger 第三人读取、L1=0 来源全文 Resolve、L2≤2 总来源尝试；Budget / Source Revision/Confirm/Forget/Date 全部通过。

### 7.3 真实性对照

使用实际 `MemoryEngine` + `MemoryStore` + `PairLongTermLedger`，不要仅用 mock parser 代替权威校验。将优化 `safe-candidate-directory` 与 `exhaustive-reference` 在同一可信数据、同一 owner、same date、同一时间窗下对照：

- `targetCharacterIds`、授权等级、事项 ID/顺序、sourceSummaryKey/sourceRevision/sourceItemOrdinal、实际文本哈希、检索区间、fallbackStatus、来源尝试数均应一致。
- 若 baseline 全量本身不支持新时间窗，比较时先让 reference 使用**同一时间窗语义**，不可比较不同业务语义后声称“完全相同”。
- 不允许为通过 A/B 删除来源竞态检查或任意 Top-N 截取 Pair。

### 7.4 性能验收（目标而非既有成绩）

| 场景 | 目标 | 备注 |
|---|---|---|
| 300 Pair，新格式，常规 warm L1/L2 | P50 ≤ 1.0s、P95 ≤ 2.0s | 保住 V9.3.6.2 性能等级 |
| 300 Pair，≤5 个可定位旧格式异常 | warm P95 ≤ 2.0s | 不能 1 坏全扫 |
| 300 Pair，≤10 个可定位旧异常 | warm P95 ≤ 2.5s | 局部候选扩大可解释 |
| 同问首轮/重生成（未改源） | Memory 选取与注入指纹一致；新增 CPU 检索开销可忽略 | 模型输出与网络延迟单独统计 |
| 100/300 Pair、时间明确历史询问 | 不因时间筛选恢复大规模扫描；与 reference 相同 | 实际读 Scope 数应合理 |
| 300 Pair，全域未知或所有 Pair 包含目标 | 正确性优先，单列慢路径耗时 | 不强制伪造 P95 合格 |
| 真实 CK3 两人、三人、多人测试 | 不出现检索引发的明显几十秒阻塞；记录主观观察与实测耗时 | **真实 Provider 的总等待非代码单独可控** |

**数据采集**：同机、同 Node、同数据集、同固定 GameDate，至少 20 次 warm 样本 / 格记录 P50/P95，冷态单独报告；按 `memory.recall`、`directoryBuild`、`pairIndexRead`、`prompt.build`、`providerTTFT`、`providerTotal` 拆开。不要把“玩家体感 1–2 秒”写成所有未来运行环境的硬性保证。

### 7.5 完整发布 Gate

- 既有 `test-v9.3.6.1-*`、`test-v9.3.6.2-*`、相关 V9.3.6 以及全部 Release QA 不得跳过；旧行为合理改变时，用有充分证据的新断言替换，保留旧红例。
- 更新 `src/app`、`resources/app/out` 和真实部署产物；核对 Main / Preload / Renderer 模块版本、哈希及打包 Manifest 一致，不接受“源码修了但 exe 里没修”。
- 记录 Node / Electron / CK3 / Windows 版本、仓库 SHA、源码与运行 payload 校验、回归实际通过数量。不能预先声称“427/427 + 新增多少已通过”。
- 真实 CK3、真实 GLM/DeepSeek、20–30 轮联调、80–100 轮 Soak、远端 CI 若没执行必须各自标记 `NOT_RUN`。

---

## 8. 推荐 Codex 施工顺序和边界

**施工前必须先跑旧版性能 A/B、取出明确代码 SHA、保存最小匿名红例。**

1. **第一阶段 AGE-01（独立且优先）**：打通 CK3 年龄来源、统一生日周岁算法、避免 `relationship-resolver` 提前覆盖当前原始年龄；完成 A01–A14。
2. **第二阶段 REGEN-01**：区分 logical player message / generation attempt，重生恢复可信轮次并隔离副作用；先做 R01/R03/R06/R08，再完整 R 系列。
3. **第三阶段 INT-03 + RECALL-01**：先统一可信时间/人物意图并处理 “政变之后/去年”，再把时间窗口传入 Pair 第三人候选的筛选/排序；跑 I 系列和 T 系列。
4. **第四阶段 PERF-02**：仅修改旧源覆盖证明与局部安全候选，不动已验证的 PairLedger 权威检索与证据来源。
5. **第五阶段 OBS-01**：把每个问题的阶段结果映射为脱敏可比对诊断；验证 UI/日志不会泄漏原文。
6. **第六阶段 QA+BUILD**：全量门禁、同机性能 A/B、源码/运行包同步、生成独立 Implementation/Verification/Benchmark 报告。

**Codex 施工指令（可直接作为任务交接）**：

> 以 V9.3.6.2 `abb5f9ce` 为基础实现本文件 V9.3.6.3，先核对当前工作树是否有更新，若基线不同先列出差异。不要跳过定位和红绿测试；不要擅自改变现有 Memory 预算、Provider 配置、权限和持久存储格式；不调用付费 Provider，不改用户真实存档，不自动远程推送。每个 P1 独立提交测试报告和代码位置；所有 P1、现有 QA、A/B 与部署哈希通过前不得声称完成。若性能与权威来源复验冲突，以正确性为先并报告阻断。

---

## 9. 版本回滚与异常处理

| 异常 | 安全处理 |
|---|---|
| 年龄补丁把没有游戏依据的相对年龄当成权威 | 回退该来源优先级，仅显示已验证年龄；保留 AGE 冲突日志 |
| 扩展时间语义造成 NPC、引用、未来指令误授权 | 关闭新语义支路并回到 V9.3.6.2 已验证意图规则，禁止扩大 L2 |
| 时间窗口导致合法旧事项漏掉或错年 | 将该筛选判为 `TIME_WINDOW_MISMATCH`，回退到明确不可证而非注入错误年份 |
| Regenerate 复活旧授权、重复写 Seen 或摘要 | 禁用新的 regenerate 授权重建分支，沿 fail-closed，不继续发送过期 Prompt |
| 局部目录遗漏 reference 的合法 item | 调回 `exhaustive-reference`，失效 Owner candidate cache；保存脱敏 A/B 证据 |
| 修改造成 300 Pair 显著退化或重回 30–50 秒阻塞 | 对比 profiling：候选构建、Owner 内容验证、Source 复验、Provider；**只回滚新慢路径，不取消已有合法来源校验** |
| 文件内容修订、Forget、Campaign 或场景同时变化 | 直接丢弃过期检索结果，重新从新可信快照判断或安全失败 |

---

## 10. 版本交付验收清单

- [ ] AGE-01：当前 Game Truth 年龄优先；子女年龄 +1 最小实机红例已消除；其他亲属及生卒年龄未回归。
- [ ] REGEN-01：重新生成保留合法真实玩家锚，不产生伪玩家消息；成功发送的记忆块指纹可对照。
- [ ] INT-03：政变、登基、审判、继承与去年／前年／三年前历史句的授权与 L0 反例全过。
- [ ] RECALL-01：唯一 Runtime ID + 明确时间窗口 + Owner 源与注入一致；能区分缺来源、时间错配、预算裁剪和生成不遵循。
- [ ] PERF-02：1/5/10 条可定位旧摘要不致 300 Pair 整体全量，目录优化与 exhaustive reference 等价。
- [ ] Security：L0 无第三人读、L1 无原文、L2 总 ≤2；跨 Owner、Campaign、Forget、Date、Revision、Confirm 未退化。
- [ ] Performance：同条件 A/B、300 Pair warm P50/P95 与旧档混合性能数据达标；保留低延迟玩家体验。
- [ ] Build：源码、打包 `resources/app/out`、实际部署内容版本和哈希一致。
- [ ] Docs：交付 `V9_3_6_3_IMPLEMENTATION_REPORT.md`、`V9_3_6_3_VERIFICATION_REPORT.md`、`V9_3_6_3_PAIR_AB_REPORT.md`、`V9_3_6_3_REAL_GAME_CHECKLIST.md`（建议路径 `docs/current/v9/`）。
- [ ] Reality：真实 CK3/Provider/Soak/CI 各自 `PASS` / `FAIL` / `NOT_RUN`，不把未运行的实机验收写成通过。

**最终定义**：玩家问 NPC 子女年龄，应得到 CK3 真实年龄；问离场第三人的过去，应以可验证的人物 ID、时间窗和 Owner 摘要进行稳定、低延迟召回；点击“重新生成”只能改变模型生成尝试，不能悄悄改变授权与 Memory 来源；少量旧摘要也不应让 300 Pair 扫描重新成为对话瓶颈。

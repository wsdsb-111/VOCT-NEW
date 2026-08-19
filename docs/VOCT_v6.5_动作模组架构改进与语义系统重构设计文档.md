# VOCT v6.4 动作模组架构改进与语义系统重构设计

> 用途：供 Codex 阅读、评估并作为后续实现参考  
> 项目：VOCT-NEW / CK3 酒馆 AI 动作系统  
> 目标：在 v6.4 两段式语义判定基础上，重构 Action Gate、Execution Parser、Semantic Resolver 与 Action Registry 的职责边界，使动作系统具备更高可靠性、更低硬编码耦合和更强的未来扩展能力。  
> 原则：优先保持现有 Action Script API 与游戏行为兼容，采用渐进式重构，不做一次性推倒重写。

---

# 1. 本文要解决的问题

v6.4 第一阶段已经引入两段式语义判断：

1. 第一段：只识别真正已经发生或正在发生的动作。
2. 第二段：根据描述线索，将动作收窄到唯一或少量可执行 Action Script。
3. Action LLM 最终只负责在限定范围内解析 actor / target / args。

这个方向是正确的，但当前实现仍然有两个结构性问题。

## 问题 A：旧门控承担了过多语义权力

目前大体流程为：

```text
原始文本
  ↓
getActionTriggers()
  ↓
没有 trigger → 整个动作系统结束
  ↓
getSemanticActionProfile()
  ↓
allowedActionIds
  ↓
Action LLM
```

这意味着：

- Gate 漏判 → Stage 1 / Stage 2 永远无机会补救
- Gate 误判 → 后续系统可能过度信任错误分类
- Gate 原本只是 API 成本优化手段，现在却变成“动作事实来源”

## 问题 B：动作专属语义仍集中硬编码在 main.js

当前 `getSemanticActionProfile()` 需要知道：

```text
什么词表示死亡
什么词表示受伤
什么词表示恋人
什么词表示朋友
什么词表示骑士
什么词表示罢免
什么词表示离开
什么词表示进入
什么词表示敌对 scheme
……
```

这使 `ActionEngine` 同时承担：

```text
自然语言执行状态判断
+
所有 CK3 Action 的业务语义知识
```

随着 Action 数量增长，主程序会不断扩展。未来每新增一个 CK3 Action 都可能需要修改：

```text
ActionEngine
getSemanticActionProfile
getActionIdsForTriggers
大型 Regex
Prompt
测试映射
```

这不利于长期维护。

---

# 2. 总体设计目标

本次重构不建议完全删除门控。

正确方向是：

> **保留门控的成本控制价值，但降低它的语义权限；同时把 Action 专属语义从主程序逐步迁移到 Action 自己的 metadata。**

最终目标架构：

```text
┌──────────────────────────────┐
│ Raw Message                  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Layer 0: Candidate Gate      │
│ 高召回 / 低成本 / 宽松唤醒  │
└──────────────┬───────────────┘
               │
        no ────┴──── END
               │ yes
               ▼
┌──────────────────────────────┐
│ Layer 1: Execution Parser    │
│ 中央通用执行语义判断         │
│ 判断哪些动作真实发生         │
│ 输出 Positive Events[]       │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Layer 2: Semantic Resolver   │
│ 根据 Action Registry metadata│
│ 为每个 Event 收窄脚本候选    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Registry + check()           │
│ CK3 条件过滤                 │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Layer 3: Action LLM          │
│ ONLY: actor / target / args  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Local Validation + Execute   │
└──────────────────────────────┘
```

---

# 3. 最核心的职责边界

后续所有实现都应遵守这一原则：

> **Candidate Gate 负责“值得不值得继续分析”；Execution Parser 负责“动作到底发生没发生”；Semantic Resolver 负责“这个已发生事件对应哪些 Action Script”；Action LLM 只负责“谁对谁、参数是什么”。**

同时：

> **ActionEngine 负责理解通用自然语言执行状态；每个 Action 文件负责声明“什么样的已发生动作属于我”。**

---

# 4. Layer 0：将旧硬门控降级为 Candidate Gate

## 4.1 Gate 不再证明动作已经发生

旧思路：

```text
getActionTriggers()
    ↓
返回 combat
    ↓
等于确认 combat 已发生
```

新思路：

```text
detectActionCandidates()
    ↓
返回 combat hint
    ↓
只表示“这里可能值得分析 combat”
```

Gate 的目标从：

```text
高精度 / 尽量不误报
```

改为：

```text
高召回 / 容忍适量误报 / 尽量不漏真实动作
```

## 4.2 建议改名

建议将：

```js
getActionTriggers()
```

逐步替换为：

```js
getActionHints()
```

或：

```js
detectActionCandidates()
```

或：

```js
getPossibleActionCategories()
```

避免 `trigger` 这个名称让其他逻辑误认为动作已经被事实确认。

## 4.3 Gate 不应继续承担完整否定语义

例如：

```text
“我想拔剑。”
```

Candidate Gate 可以返回：

```js
["combat"]
```

然后由 Stage 1 判断：

```text
想拔剑
→ intent
→ not executed
→ discard
```

这样未来的未来时、否定、回忆、传闻、失败、条件句，不必在 Gate 和 Stage 1 重复维护两套复杂逻辑。

---

# 5. Layer 1：Execution Parser 成为唯一动作事实来源

这是整个动作系统最关键的 deterministic layer。

其唯一职责：

> **识别哪些动作在当前叙述中真实发生或正在发生。**

## 5.1 必须从 Category-only 升级为 Event-based 输出

不建议继续只返回：

```js
[
  "combat",
  "death_or_injury"
]
```

应该返回：

```js
[
  {
    eventId: "evt_1",
    category: "death_or_injury",
    evidence: {
      text: "刺伤了他的手臂",
      start: 12,
      end: 20
    },
    executionStatus: "executed"
  }
]
```

Event 至少应保留：

```text
eventId
category
positive evidence text
span / start / end
executionStatus
```

可选：

```text
actorHint
targetHint
resultStatus
sourceClauseIndex
```

---

# 6. Stage 1 应处理的通用语义规则

这些规则应该集中在 Execution Parser，不应该复制到每个 Action 文件：

```text
提问
命令
计划
未来时
假设
愿望
否定
未完成动作
失败尝试
回忆
传闻
引用
假装
转述
```

保留：

```text
已经发生
正在发生
当前可见动作
明确完成的状态变化
```

排除示例：

```text
“你会拔剑吗？”
→ question → discard

“我明天会离开。”
→ future → discard

“听说公爵杀了一个囚犯。”
→ reported event → discard

“我想起昨天杀过一个刺客。”
→ recollection → discard

“我没有伤到他。”
→ negated result → discard
```

---

# 7. 必须区分：动作执行失败 vs 动作结果失败

## 7.1 动作本体没有发生

```text
“我试图拔剑，但剑卡在剑鞘里。”
```

结果：

```text
combat event 不成立
```

## 7.2 动作发生，但结果失败

```text
“我挥剑刺向他，但他躲开了。”
```

结果：

```text
performCombatAction ✅
isInjured ❌
characterIsKilled ❌
```

建议 Event 支持：

```js
{
  category: "combat",
  executionStatus: "executed",
  resultStatus: "missed"
}
```

---

# 8. Stage 2 不得重新扫描整条原始消息

当前 `getSemanticActionProfile()` 如果重新用：

```js
pattern.test(fullText)
```

会重新读到 Stage 1 已经排除的内容。

例如：

```text
“我没有杀死他，只是刺伤了他的手臂。”
```

Stage 1 正确 evidence：

```text
刺伤了他的手臂
```

Stage 2 如果重新扫描整句，仍会看到：

```text
杀死
```

于是可能错误允许：

```text
characterIsKilled
```

正确原则：

> Stage 2 只能处理 Stage 1 Positive Evidence，不能重新分析完整原始消息。

建议从：

```js
getSemanticActionProfile(fullText, reasons)
```

改为：

```js
resolveSemanticCandidates(event, actionRegistry)
```

---

# 9. 新增核心重构：Action 专属语义下沉到 Action Metadata

当前 Action 文件已经可以通过：

```js
triggerCategories
```

向 Registry 声明自己属于哪些 gate category。

这说明 Action 自注册机制已经存在基础。

下一步建议继续扩展：

> **Action Script 自己声明自己的 semantic metadata。**

不要继续让 `main.js` 硬编码所有 Action 的语言规则。

---

# 10. Action Metadata 建议结构

建议每个 Action definition 可以逐步支持：

```js
module.exports = {
  signature: "isInjured",

  triggerCategories: [
    "death_or_injury"
  ],

  semantic: {
    evidencePatterns: [
      /刺伤|砍伤|打伤|受伤|负伤|骨折|流血|重创/i
    ],

    excludePatterns: [],

    exclusiveGroup: "physical_outcome",

    priority: 50,

    riskLevel: "high"
  },

  check() {
    ...
  },

  args: ...,

  run() {
    ...
  }
}
```


---

# 11. 示例：受伤与死亡不再由 main.js 硬编码

## z_isInjured.js

```js
semantic: {
  evidencePatterns: [
    /刺伤|砍伤|打伤|重伤|负伤|受伤|骨折|流血|重创/i
  ],
  exclusiveGroup: "physical_outcome",
  priority: 50
}
```

## z_characterIsKilled.js

```js
semantic: {
  evidencePatterns: [
    /杀死|处死|斩首|毙命|身亡|断气|气绝/i
  ],
  exclusiveGroup: "physical_outcome",
  priority: 100
}
```

Stage 1：

```text
“我没有杀死他，只是刺伤了他的手臂。”
```

得到：

```js
{
  category: "death_or_injury",
  evidence: "刺伤了他的手臂"
}
```

Stage 2 对 Registry 中同 category Action 进行匹配：

```text
isInjured
  → MATCH

characterIsKilled
  → NO MATCH
```

最终：

```js
allowedActionIds = [
  "isInjured"
]
```

这样 `ActionEngine` 不再需要知道具体什么词叫“死亡”、什么词叫“受伤”。

---

# 12. 示例：Relationship Action 自注册

例如：

## becomeFriendsWith

```js
semantic: {
  evidencePatterns: [
    /成为朋友|结为朋友|建立友谊|朋友关系/i
  ],
  exclusiveGroup: "relationship_tier",
  priority: 20
}
```

## becomeLoversWith

```js
semantic: {
  evidencePatterns: [
    /成为恋人|成为情人|相恋|定情|私定终身/i
  ],
  exclusiveGroup: "relationship_tier",
  priority: 50
}
```

## becomeSoulmatesWith

```js
semantic: {
  evidencePatterns: [
    /灵魂伴侣|灵魂相契|命定之人/i
  ],
  exclusiveGroup: "relationship_tier",
  priority: 100
}
```

对于：

```text
“她不是我的情人，我们只是成为了朋友。”
```

Stage 1 evidence：

```text
成为了朋友
```

Stage 2：

```text
becomeFriendsWith → MATCH
becomeLoversWith → NO MATCH
becomeSoulmatesWith → NO MATCH
```

避免全文扫描造成污染。

---

# 13. Semantic Metadata 不应只支持 Regex

长期设计建议不要把 metadata 限制死为：

```text
Regex only
```

可以考虑兼容：

```js
semantic: {
  evidencePatterns: [...],

  match(event, context) {
    ...
  }
}
```

但建议：

> 第一阶段优先采用声明式 metadata，复杂 Action 才允许自定义 semantic matcher。

这样可以避免未来所有 Action 又各自编写复杂逻辑。

---

# 14. 建议的 Semantic Resolver 算法

```js
function resolveSemanticCandidates(event, actionRegistry) {

  const candidates =
    actionRegistry
      .getAllActions()
      .filter(action =>
        action.definition.triggerCategories?.includes(event.category)
      );

  const matched = [];

  for (const action of candidates) {

    const semantic = action.definition.semantic;

    if (!semantic) {
      continue;
    }

    if (
      semantic.excludePatterns?.some(
        pattern => pattern.test(event.evidence.text)
      )
    ) {
      continue;
    }

    const patternMatched =
      semantic.evidencePatterns?.some(
        pattern => pattern.test(event.evidence.text)
      );

    const customMatched =
      typeof semantic.match === "function"
        ? semantic.match(event)
        : false;

    if (patternMatched || customMatched) {
      matched.push(action);
    }
  }

  return resolvePriorityAndExclusivity(matched);
}
```

---

# 15. exclusiveGroup 的作用

很多 Action 语义互斥，例如：

```text
isInjured
characterIsKilled
```

不能同时因为同一个 physical outcome evidence 被允许。

可以声明：

```js
exclusiveGroup: "physical_outcome"
```

关系类：

```text
friend
lover
best_friend
soulmate
```

可以声明：

```js
exclusiveGroup: "relationship_tier"
```

Semantic Resolver 可以：

```text
同一个 exclusiveGroup
→ 按 evidence match + priority
→ 留下唯一或少量候选
```

---

# 16. priority 不应覆盖明确 Evidence

priority 的作用只能是：

```text
多个 Action 都合法匹配同一 Positive Evidence 时
用于确定更具体的 Action
```

不能让：

```text
高 priority Action
```

在没有匹配 evidence 的情况下升级事件。

例如：

```text
“刺伤了他的手臂”
```

即使：

```text
characterIsKilled.priority = 100
```

也绝不能覆盖：

```text
isInjured.priority = 50
```

因为死亡 Action 根本没有 evidence match。

---

# 17. main.js 应保留什么，不应保留什么

## main.js / ActionEngine 应保留

```text
Candidate Gate
通用分句
future / negation / question / rumor / recollection / failure
Event 构建
Event 去重
Registry 调度
Action check()
Prompt 构建
Action LLM 调用
执行结果管理
审批逻辑
日志与 analytics
```

## main.js 应逐步移除

```text
死亡具体关键词
受伤具体关键词
朋友具体关键词
恋人具体关键词
灵魂伴侣关键词
骑士关键词
罢免关键词
具体 Action ID 的大规模 if/else
Action 专属 semantic allow() 映射
```

这些应逐步搬到对应 Action metadata。

---

# 18. 不要把 Stage 1 通用语义规则搬进 Action 文件

这是此次重构必须特别避免的错误方向。

不要出现：

```text
z_isInjured.js 自己判断 future
z_characterIsKilled.js 自己判断 negation
z_becomeLoversWith.js 自己判断 rumor
z_changeLocation.js 自己判断 recollection
```

否则会从：

```text
一个主程序巨大规则库
```

变成：

```text
几十个 Action 文件复制同一套自然语言逻辑
```

更难维护。

---

# 19. Action 文件只负责“我是什么”

推荐 Action 文件负责：

```text
我属于哪些 category
什么 positive evidence 能代表我
我是否与其他 Action 互斥
我的 specificity / priority
我的风险级别
我的参数
我的 target 条件
我的 check()
我的 run()
```

不负责：

```text
整句话是不是计划
整句话是不是回忆
整句话是不是传闻
整句话是不是提问
整句话是不是未来
```

---

# 20. Event-level allowedActionIds

当前 message-level：

```js
{
  reasons: [
    "death_or_injury",
    "location_or_exit"
  ],
  allowedActionIds: [
    "isInjured",
    "leavesConversation"
  ]
}
```

建议升级为：

```js
{
  events: [
    {
      eventId: "evt_1",
      category: "death_or_injury",
      evidence: "刺伤了卫兵",
      allowedActionIds: [
        "isInjured"
      ]
    },
    {
      eventId: "evt_2",
      category: "location_or_exit",
      evidence: "离开大厅",
      allowedActionIds: [
        "leavesConversation"
      ]
    }
  ]
}
```

---

# 21. Action LLM 的最终职责

理想情况下，Action LLM 不应再判断：

```text
是否发生
是真是假
是不是计划
是不是否定
是死亡还是受伤
是朋友还是恋人
是离开还是移动
```

它只处理：

```text
actor
target
args
同一个 Event shortlist 内的最终 Action
```

---

# 22. Prompt 应改为 Event-oriented

建议输入：

```text
Validated Action Events

Event 1
Category:
death_or_injury

Positive Evidence:
"刺伤了卫兵的手臂"

Allowed Scripts:
- isInjured

Event 2
Category:
location_or_exit

Positive Evidence:
"随后离开大厅"

Allowed Scripts:
- leavesConversation
```

Prompt 规则：

```text
Each event has already passed execution-state validation.

Use only that event's positive evidence to determine its action meaning.

Conversation history may be used only for:
- pronoun resolution
- actor identity
- target identity
- amount
- required argument context

Never use rejected, negated, hypothetical, recalled, reported,
planned or failed text outside the validated evidence span
to upgrade or change an event.

Never select a script outside that event's allowed scripts.

If actor, target, required arguments, or execution preconditions
cannot be resolved safely, omit that event.
```

---

# 23. Gate 不再强迫 LLM 一定执行

应删除或弱化类似：

```text
A detected category has already passed the deterministic explicit-action gate:
if a listed action encodes it, select that action instead of returning empty.
```

建议改为：

```text
The validated event has passed execution-state detection,
but execution must still fail closed when actor, target,
required arguments, script preconditions, or event-to-script binding
cannot be resolved safely.
```

---

# 24. 玩家 Action 与 NPC Action 必须分别处理

当前类似：

```js
const actionMessage =
  pendingPlayerActionMessage ?? placeholder;
```

容易造成：

```text
玩家有动作
→ 第一 NPC 自己回复中的动作不再独立处理
```

建议：

```js
if (pendingPlayerActionMessage) {
  await evaluate(playerMessage);
  pendingPlayerActionMessage = null;
}

await evaluate(npcMessage);
```

继续利用 dedupe 防止玩家动作被多 NPC 重复执行。

---

# 25. Event-level 去重

未来去重不应只基于：

```text
category + speaker + full message
```

建议：

```js
dedupeKey =
  speakerId
  + category
  + normalizedEvidence
  + optionalTargetHint
```

目标：

> 防止同一个叙事事件重复执行，而不是阻止同一 category 在一轮中执行多次。

---

# 26. Registry 重构目标

理想 Action Registry 能提供：

```js
actionRegistry.getAllActions()

action.definition.signature
action.definition.triggerCategories
action.definition.semantic
action.definition.args
action.definition.check
action.definition.run
```

Semantic Resolver 只依赖 Registry。

这样新增一个 Action：

```text
z_isTorturedBy.js
```

只需要：

```js
triggerCategories: [
  "physical_harm"
],

semantic: {
  evidencePatterns: [
    /拷打|刑讯|严刑逼供|折磨/
  ]
}
```

它就可以自动参与：

```text
Candidate
→ Semantic Resolver
→ allowed scripts
→ Action LLM
```

不要求继续编辑 `main.js` 的动作专属映射。

---

# 27. 对 triggerCategories 的建议

`triggerCategories` 已经是很好的 Action 自注册入口。

建议保留，并考虑未来将 category 定义稳定化，例如：

```text
gold_transfer
imprisonment
physical_harm
relationship
office
faith
vassalage
location
combat
intimate_contact
roleplay_status
faction
prisoner_resolution
scheme_start
```

但不要过早把 category 细分得和 Action ID 一样具体。

Category 的意义应该是：

> 给 Candidate Gate 与 Semantic Resolver 提供粗粒度语义空间。

---

# 28. 新 Action 的理想开发流程

## 旧模式

```text
1. 新建 Action Script
2. 修改 ActionEngine regex
3. 修改 getActionIdsForTriggers
4. 修改 getSemanticActionProfile
5. 修改 Prompt
6. 修改测试
```

## 新模式

```text
1. 新建 Action Script
2. 声明 triggerCategories
3. 声明 semantic metadata
4. 写 check / args / run
5. 添加该 Action 自己的回归测试
```

核心引擎原则上无需因为一个新 Action 而修改。

---

# 29. 兼容旧 Action 的渐进式迁移策略

不建议一次性要求所有现有 Action 都立刻写 semantic metadata。

Semantic Resolver 可以支持：

```js
if (action.definition.semantic) {
    useNewSemanticMetadata();
} else {
    useLegacySemanticFallback();
}
```

这样可以逐步迁移。

---

# 30. Legacy Semantic Fallback

第一阶段重构可以保留：

```text
legacy semantic rules
```

但把它包装成：

```js
LegacySemanticResolver
```

而不是继续散落在 `ActionEngine`。

结构：

```text
SemanticResolver
  │
  ├─ Metadata Resolver
  │
  └─ Legacy Fallback
```

随着 Action 完成 metadata 迁移：

```text
Legacy rules
逐步减少
最终删除
```


---

# 31. 建议的迁移阶段

## Phase A：不改变行为，只重构接口

新增：

```text
ActionEvent
Semantic metadata schema
SemanticResolver
```

但旧逻辑仍作为 fallback。

目标：

```text
所有现有测试必须保持通过
```

---

## Phase B：Stage 1 Event 化

将：

```text
getActionTriggers()
```

拆成：

```text
getActionHints()
getExecutedActionEvents()
```

Stage 2 改为 event input。

---

## Phase C：迁移高风险 Action metadata

优先迁移：

```text
characterIsKilled
isInjured
isImprisonedBy
relationship actions
office actions
faith/vassal actions
scheme actions
```

因为这些错误执行代价最高。

---

## Phase D：迁移 Scene / RP Actions

继续迁移：

```text
performCombatAction
performDailyAction
performIntimateAction
setEmotion
setRoleplayStatus
changeLocation
leavesConversation
```

---

## Phase E：删除 legacy semantic hardcode

当所有 Action 已拥有 metadata 且回归稳定后：

```text
删除 main.js 中 Action 专属 semantic 映射
```

---

# 32. 风险等级建议

可以考虑 metadata 增加：

```js
riskLevel: "low" | "medium" | "high"
```

例如：

```text
setEmotion → low
performDailyAction → low
changeLocation → medium
relationship → high
imprisonment → high
death → high
scheme → high
```

高风险 Action 可以执行更严格的：

```text
evidence requirements
target resolution
precondition
approval
```

但这是增强项，不要求 v6.4 本阶段一次性实现。

---

# 33. Semantic Specificity 建议

未来如果多个 Action 都匹配：

```text
relationship
```

除了 priority，还可以考虑：

```js
specificity: 1..100
```

Resolver 逻辑：

```text
明确具体词
→ 更具体 Action

模糊证据
→ 保留较宽 shortlist
→ 交给 Action LLM 做有限选择
```

例如：

```text
“我们成为了恋人”
```

可以直接唯一：

```text
becomeLoversWith
```

而：

```text
“我们之间的关系变得极为亲密”
```

如果证据不足：

```text
不要直接升级 soulmate
```

可 fail-closed 或保留极少候选。

---

# 34. 组合描述仍可保留，但应做成 Resolver Rule

当前例如：

```text
长久对视 + 亲吻
→ soulmate
```

这种组合规则不一定适合简单 Action-level Regex。

可以有两种方式：

### 方案 A：对应 Action 使用 custom semantic matcher

```js
semantic: {
  match(event) {
    return lingeringGaze(event) && kiss(event);
  }
}
```

### 方案 B：建立 Semantic Composition Rules

专门处理跨 evidence feature 的组合。

推荐：

> 简单 Action 用 metadata pattern；只有真正需要组合推理的少数 Action 使用 custom matcher / composition rules。

---

# 35. 不允许 Action metadata 直接扫描完整消息

即使 Action 自己有：

```js
semantic.match()
```

也必须接收：

```text
Validated Event
```

而不是：

```text
Raw Full Message
```

这是防止 Stage 1 被绕过的关键安全边界。

接口建议：

```js
semantic.match({
  event,
  evidence,
  contextHints
})
```

不要直接传完整原文作为默认输入。

---

# 36. 回归测试必须分层

建议未来测试分为：

```text
Gate tests
Execution Parser tests
Semantic Resolver tests
Action Script tests
Integration tests
```

---

# 37. Gate 测试

重点测试高召回：

```text
我想拔剑
我拔剑
昨天我拔过剑
听说他拔剑了
```

Candidate Gate 都可以允许：

```text
combat hint
```

因为是否成立不是 Gate 的责任。

---

# 38. Execution Parser 测试

重点测试真假执行状态：

```text
我拔剑
→ event

我想拔剑
→ no event

我昨天拔过剑
→ no current event

听说他拔剑
→ no event

我试图拔剑但失败
→ no event

我挥剑攻击但被躲开
→ combat event
```

---

# 39. Semantic Resolver 测试

输入必须直接使用 Positive Event：

```js
{
  category: "death_or_injury",
  evidence: "刺伤了他的手臂"
}
```

预期：

```text
isInjured
```

禁止：

```text
characterIsKilled
```

---

# 40. 必须保留的混合语义回归测试

## 否定 + 真实动作

```text
我没有杀死他，只是刺伤了他的手臂。
```

预期：

```text
isInjured
```

---

## 计划 + 真实动作

```text
我原本想杀掉他，但最终只是挥剑将他刺伤。
```

预期：

```text
performCombatAction
isInjured
```

禁止：

```text
characterIsKilled
```

---

## 回忆 + 当前动作

```text
我想起昨天曾杀过一个刺客，随后拿起桌上的酒杯。
```

预期：

```text
当前拿起物品 Action
```

禁止：

```text
characterIsKilled
```

---

## 传闻 + 当前动作

```text
听说公爵杀死了一个囚犯，我随即转身离开大厅。
```

预期：

```text
leavesConversation
```

---

## 否定关系 + 正关系

```text
她不是我的情人，我们只是成为了朋友。
```

预期：

```text
becomeFriendsWith
```

---

## 否定职位 + 正职位

```text
他没有被罢免，反而被任命为骑士。
```

预期：

```text
isEmployedAsKnightBy
```

---

## 攻击成功发起 + 伤害失败

```text
我挥剑刺向他，但他及时躲开。
```

预期：

```text
performCombatAction
```

禁止：

```text
isInjured
characterIsKilled
```

---

## 多事件

```text
我刺伤了卫兵，随后离开大厅。
```

预期：

```text
Event 1 → isInjured
Event 2 → leavesConversation
```

---

# 41. Metadata Resolver 测试

每个 Action 应能单独测试：

```text
给定 Event
→ semantic metadata 是否匹配
```

例如：

```js
assert(
  isInjured.semantic.evidencePatterns
    .some(p => p.test("刺伤了他的手臂"))
);
```

同时测试：

```text
不应匹配错误 Action
```

---

# 42. Action LLM 集成测试

Action LLM 应验证：

```text
不会越过 event allowedActionIds
不会利用 rejected clause 升级状态
target 不明时可以返回空
多个 Event 不相互串线
```

---

# 43. 推荐的核心数据结构

```js
ActionDetectionResult = {
  candidateCategories: [],

  events: [
    {
      eventId,
      category,

      evidence: {
        text,
        start,
        end
      },

      executionStatus,
      resultStatus,

      actorHint,
      targetHint,

      allowedActionIds: []
    }
  ]
}
```

---

# 44. 推荐的处理伪代码

```js
async function processActionMessage(message) {

  // Layer 0
  const hints =
    ActionEngine.getActionHints(message.content);

  if (hints.length === 0) {
    return noAction();
  }

  // Layer 1
  const events =
    ActionEngine.getExecutedActionEvents(
      message.content,
      hints
    );

  if (events.length === 0) {
    return noAction();
  }

  // Layer 2
  const semanticEvents = [];

  for (const event of events) {

    const allowedActionIds =
      SemanticResolver.resolve(
        event,
        actionRegistry
      );

    if (allowedActionIds.length === 0) {
      continue;
    }

    semanticEvents.push({
      ...event,
      allowedActionIds
    });
  }

  if (semanticEvents.length === 0) {
    return noAction();
  }

  // check()
  const executableEvents =
    filterAvailableActions(
      semanticEvents,
      actionRegistry
    );

  if (executableEvents.length === 0) {
    return noAction();
  }

  // Layer 3
  return ActionLLM.resolve(
    executableEvents,
    recentConversationContext
  );
}
```

---

# 45. Codex 修改时优先检查的现有位置

按函数名查找，不依赖打包行号：

```text
ActionEngine.getActionTriggers
ActionEngine.getActionTrigger
ActionEngine.getSemanticActionProfile
ActionEngine.getActionIdsForTriggers
ActionEngine.shouldEvaluateForMessage
ActionEngine.evaluateForCharacter

ActionPromptBuilder.buildActionMessages

Conversation 中：
pendingPlayerActionMessage
actionGateProcessedTriggers
NPC 回复后的 evaluateForCharacter 调用

Action Registry：
triggerCategories
definition.check
definition.args
definition.run
```

---

# 46. 建议新增模块/职责

如果当前打包结构允许，可以逐步抽出：

```text
ActionCandidateGate
ActionExecutionParser
ActionSemanticResolver
ActionEvent
LegacySemanticResolver
```

如果暂时不方便拆物理文件，也应先在逻辑上分层，避免继续把所有功能写进一个方法。

---

# 47. P0 / P1 / P2 优先级

## P0

1. Stage 1 输出 Event + Positive Evidence
2. Stage 2 只分析 Event evidence
3. 修复玩家动作与 NPC 动作二选一问题
4. 高风险状态 fail-closed

## P1

1. 新增 Action semantic metadata schema
2. 新增 Registry-driven Semantic Resolver
3. 高风险 Action 优先迁移 metadata
4. allowedActionIds 改为 Event-level
5. Action Prompt 改为 Event-oriented

## P2

1. Legacy semantic fallback 逐步删除
2. Event-level dedupe
3. exclusiveGroup / priority
4. riskLevel
5. composition rule
6. semantic custom matcher
7. 完成核心引擎与动作专属知识解耦

---

# 48. 不建议当前直接做的事情

## 不建议完全删除 Gate

Gate 仍有明显 API 成本控制价值。

## 不建议把所有 Regex 从 main.js 机械复制到 Action 文件

目标是：

```text
职责重构
```

不是：

```text
代码搬家
```

## 不建议让每个 Action 独立判断 future / negation / rumor

这些必须保持中央统一。

## 不建议重新让 Action LLM 自由浏览所有 Action

v6.4 shortlist 的核心优势必须保留。

## 不建议一次性强制所有 Action metadata 化

应保留 Legacy Fallback，逐步迁移。

---

# 49. 最终理想状态

未来增加一个新动作：

```text
z_isTorturedBy.js
```

开发者只需要：

```js
module.exports = {

  signature: "isTorturedBy",

  triggerCategories: [
    "physical_harm"
  ],

  semantic: {
    evidencePatterns: [
      /拷打|刑讯|严刑逼供|酷刑|折磨/i
    ],

    exclusiveGroup: "physical_harm_outcome",

    priority: 80,

    riskLevel: "high"
  },

  check() {
    ...
  },

  args: ...,

  run() {
    ...
  }
}
```

不需要再修改：

```text
main.js 大型 semantic if/else
getActionIdsForTriggers 的硬编码表
ActionPromptBuilder 的专属说明
```

Registry 可以自动发现：

```text
这是 physical_harm Action
它能匹配什么 evidence
它属于哪个互斥组
```

从而自然进入两段式语义系统。

---

# 50. 最终设计原则总结

整个 v6.4 后续动作模组优化，可以浓缩成以下六条：

1. **Gate 只负责候选召回，不再负责确认动作事实。**
2. **Execution Parser 是唯一“动作是否真实发生”的事实来源。**
3. **Stage 1 必须输出 Positive Event / Evidence，而不是只有 category。**
4. **Semantic Resolver 只处理 Positive Evidence，绝不重新扫描完整原文。**
5. **Action 专属语义逐步下沉到 Action metadata，由 Registry 自动参与候选解析。**
6. **Action LLM 只处理 actor / target / args，并严格受 Event-level allowlist 限制。**

最终职责关系：

```text
Candidate Gate
= “这里可能有动作”

Execution Parser
= “这个动作真的发生了”

Action Metadata + Semantic Resolver
= “这个已发生动作属于哪些脚本”

Action LLM
= “谁对谁，参数是多少”
```

---

# 51. 结论

v6.4 当前两段式语义判定方向应继续推进，不应退回到“让 LLM 从所有 Action 中自由猜”。

真正需要升级的是两件事：

第一：

```text
旧硬门控
↓
宽松 Candidate Gate
```

第二：

```text
main.js 中央 Action 专属语义硬编码
↓
Action semantic metadata + Registry-driven Semantic Resolver
```

这样可以同时解决：

```text
旧 Gate 漏判阻断整个语义系统
Stage 2 被否定/回忆/传闻文本污染
复杂句中的动作串线
Action 数量增长导致 main.js 不断膨胀
新增 Action 必须修改核心引擎
Action LLM 权限过大
```

最终目标不是简单“增加更多 Regex”，而是建立一个：

```text
高召回候选层
+
统一执行语义层
+
插件化 Action 语义层
+
受限 Action LLM
```

的可扩展动作架构。

这应该作为 v6.4 后续动作模组优化的长期主线。

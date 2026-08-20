# VOCT v6.5 动作系统重构设计
## Phase 0 / 0.5 / 0.6 测试反馈修订版

> 项目：VOCT-NEW / CK3 酒馆 AI 动作系统  
> 版本目标：v6.5  
> 文档性质：核心架构设计 + 测试反馈修订 + Terra/Codex 实施基线  
> 基线版本：v6.4 当前生产逻辑  
> 原则：保持现有 Action Script API 和游戏行为兼容，采用渐进式重构，不做一次性推倒重写。  
> 重要说明：真实代码与可执行测试结果拥有最高优先级；本文档用于定义 v6.5 的目标职责边界、数据结构、迁移顺序和验收不变量。

---

# 1. 为什么需要 v6.5

v6.4 已经建立了两段式动作判定：

```text
Raw Message
  ↓
getActionTriggers()
  ↓
getSemanticActionProfile()
  ↓
allowedActionIds
  ↓
Action LLM
  ↓
check / execute
```

这个方向比“让 Action LLM 从所有 Action 中自由猜”更可靠，也显著降低了动作误执行和 API 浪费。

但 Phase 0 / 0.5 / 0.6 测试已经证明，当前结构仍然存在四类核心问题：

1. Candidate Gate 仍承担过多事实判定权限。
2. Stage 2 会重新扫描完整原文，导致被否定、假设、计划等文本重新污染语义。
3. Player message 与 NPC reply 当前存在二选一式 evaluation 风险。
4. message-level category / allowedActionIds 无法表达真正的 Event 边界、顺序、执行状态和同类多事件。

因此 v6.5 的目标不是增加更多 Regex，而是重新划分：

```text
候选召回
执行事实
事件语义
动作脚本
LLM 参数解析
```

之间的职责边界。

---

# 2. 测试反馈后的证据等级

为了避免把推测写成事实，v6.5 所有设计判断分为三种证据等级。

## 2.1 已被 regression tests 明确证明

### A. Stage 2 full-text contamination

典型案例：

```text
我没有杀死他，只是刺伤了他的手臂。
```

当前结果会错误允许：

```text
characterIsKilled
```

而不是：

```text
isInjured
```

同类已验证污染还包括：

```text
他没有被罢免，反而被任命为骑士。
→ 错误偏向 isFiredFromCouncilOf

他没有离开，而是进入了王座厅。
→ 错误允许 leavesConversation
```

因此：

> Stage 2 不得再重新扫描完整 Raw Message。

---

### B. Hypothetical death false positive

```text
如果我杀了他，也许会惹麻烦。
```

当前会触发：

```text
death_or_injury
characterIsKilled
```

这证明 Gate / Legacy Semantic 仍可能把假设语境误识别为当前真实事件。

---

### C. Relationship Gate false negative

```text
她不是我的情人，我们只是成为了朋友。
```

当前 Gate 可能直接漏掉真正的 relationship change。

因此：

> Gate 不能继续作为“动作事实已经成立”的唯一前置权威。

---

### D. Gold inverse-order false negative

```text
我现在把50金币交给你。
```

当前 Gate 会漏判 gold。

核心不是“现在”这个词本身，而是当前规则主要覆盖：

```text
转移动词 → 金额/货币
```

但真实语言也经常使用：

```text
金额/货币 → 转移动词
```

例如：

```text
把 50 金币交给你
```

因此 Gate 必须提高召回并覆盖多种自然语序。

---

# 3. 已被源码确认、但尚缺 Runtime Harness 的风险

## 3.1 pendingPlayerActionMessage 二选一

当前生产路径存在类似：

```js
const actionMessage =
  this.pendingPlayerActionMessage ?? placeholder;

await ActionEngine.evaluateForCharacter(
  this,
  npc,
  signal,
  actionMessage
);
```

这意味着：

```text
Player 有 pending action
  ↓
第一个 NPC reply 完成
  ↓
这一次 Action evaluation 使用 Player message
  ↓
NPC 自己的 reply 没有被独立送入同一轮 evaluation
```

当前证据等级：

```text
SOURCE_CONFIRMED_ARCHITECTURE_RISK
```

而不是：

```text
VERIFIED_RUNTIME_FAILURE
```

因为 Phase 0.6 尚未建立真正可执行的 Conversation Runtime Harness。

v6.5 要求：

```text
Player message evaluation
≠
NPC reply evaluation
```

必须独立存在。

---

# 4. 尚未能由 v6.4 Runtime 直接测试的未来要求

以下行为在当前 v6.4 API 下无法被真正验证，只能作为 FUTURE_REQUIREMENT：

```text
ActionEvent identity
ActionEvent order
same-category multiple Events
Event-level dedupe
Positive Evidence span isolation
executionStatus
resultStatus
failed-before-execution
Player/NPC independent runtime evaluation
```

因此设计文档不得把这些写成“当前测试已经 PASS”。

正确表述应是：

```text
Current Layer:
可以验证 Gate / Legacy Semantic 是否正确

Future Architecture:
等待 ActionEvent / Execution Parser API 建立后再变成 hard assertion
```

---

# 5. v6.5 核心架构

最终目标：

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
         no ───┴──── END
               │ yes
               ▼
┌──────────────────────────────┐
│ Layer 1: Execution Parser    │
│ 唯一动作事实来源             │
│ 输出 Positive ActionEvent[] │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Layer 2: Semantic Resolver   │
│ Registry + semantic metadata │
│ Event-level shortlist        │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Registry + check()           │
│ CK3 本地条件过滤             │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Layer 3: Action LLM          │
│ actor / target / args only   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Local Validation + Execute   │
└──────────────────────────────┘
```

---

# 6. v6.5 六条强制职责边界

1. **Candidate Gate 只负责候选召回。**
2. **Execution Parser 是唯一“动作是否真实发生”的事实来源。**
3. **Actionable Event 必须携带 Positive Evidence。**
4. **Semantic Resolver / Action metadata 永远不得重新扫描完整 Raw Message。**
5. **Action LLM 只处理 actor / target / args，以及同一个 Event shortlist 内的最终选择。**
6. **高风险状态变化必须 fail-closed。**

---

# 7. Layer 0：Candidate Gate

## 7.1 Gate 不再证明动作事实

旧语义：

```text
getActionTriggers()
→ combat
→ 系统倾向认为 combat 已经发生
```

新语义：

```text
getActionHints()
→ combat
→ 这里只表示“值得继续检查 combat”
```

Gate 目标从：

```text
高精度
强否定过滤
尽量不误报
```

调整为：

```text
高召回
低成本
容忍有限误报
尽量不漏真实动作
```

---

## 7.2 Gate 可以唤醒计划、假设、失败尝试

例如：

```text
我想拔剑。
如果我杀了他……
我试图拔剑……
```

Candidate Gate 可以返回：

```js
["combat"]
```

甚至：

```js
["combat", "death_or_injury"]
```

这不代表动作成立。

真正的执行事实由 Execution Parser 决定。

---

## 7.3 Gate 必须支持多语序召回

例如 gold：

```text
我给了他 50 金币。
我支付给他 50 金币。
我把 50 金币交给他。
50 金币我已经交给他。
```

这些都应至少能够唤醒：

```text
gold
```

Gate 不负责：

```text
谁给谁
金额是多少
是否最终执行成功
```

---

# 8. Layer 1：Execution Parser

Execution Parser 是 v6.5 最关键的 deterministic layer。

唯一职责：

> 判断当前叙述中的哪些动作真正发生或正在发生。

它统一处理：

```text
question
command
future
plan
intent
hypothetical
negation
recollection
rumor/report
quotation
pretend
failed attempt
failed-before-execution
current execution
completed state change
```

这些通用执行语义不得复制进每个 Action Script。

---

# 9. Actionable Event 的定义

v6.5 必须明确：

> Actionable ActionEvent 只代表真实已经执行或正在执行、可以进入后续动作判定的事件。

推荐结构：

```js
{
  eventId: "evt_1",

  category: "death_or_injury",

  evidence: {
    text: "刺伤了他的手臂",
    start: 12,
    end: 20
  },

  executionStatus: "executed",

  resultStatus: "succeeded",

  actorHint: null,
  targetHint: null,

  sourceClauseIndex: 1
}
```

最小必需字段：

```text
eventId
category
evidence.text
evidence.start
evidence.end
executionStatus
```

可选：

```text
resultStatus
actorHint
targetHint
sourceClauseIndex
parserDiagnostics
```

---

# 10. RejectedCandidate：不要污染 ActionEvent[]

planned / hypothetical / recalled / reported / negated / failed-before-execution 不应进入 actionable Event。

如需调试，可以保留独立结构：

```js
{
  candidateId: "cand_2",
  category: "combat",
  evidence: {
    text: "试图拔剑",
    start: 3,
    end: 7
  },
  rejected: true,
  rejectionReason: "failed_before_execution"
}
```

可用 rejectionReason：

```text
question
command
future
planned
hypothetical
negated
recalled
reported
quoted
pretended
failed_before_execution
insufficient_execution_evidence
```

这样可以：

```text
调试 Parser
保留解释能力
不污染 Runtime ActionEvent[]
```

---

# 11. 必须严格区分执行失败与结果失败

## 11.1 Failed before execution

```text
我试图拔剑，但剑卡在剑鞘里。
```

正确：

```text
ActionEvent[]:
无 combat event

RejectedCandidate:
combat
rejectionReason = failed_before_execution
```

禁止：

```text
performCombatAction
isInjured
characterIsKilled
```

---

## 11.2 Executed, result failed

```text
我挥剑刺向他，但他及时躲开了。
```

正确：

```js
{
  category: "combat",
  executionStatus: "executed",
  resultStatus: "failed",
  resultReason: "dodged",
  evidence: "挥剑刺向他"
}
```

后续：

```text
performCombatAction ✅
isInjured ❌
characterIsKilled ❌
```

---

# 12. 同一 Clause 必须支持多个 Candidate Span

不能继续使用：

```text
一个 clause
→ 只取第一个 regex match
→ 这个 match 被否定
→ 整个 clause 被判无动作
```

例如：

```text
我没有杀死他只是刺伤了他的手臂
```

没有标点时：

```text
杀死
→ negated candidate

刺伤
→ executed positive candidate
```

Execution Parser 必须允许：

```text
一个 clause
→ 多个 candidate spans
→ 每个 span 独立判断 execution semantics
```

禁止：

```text
first-match-wins
first-match-fails → whole-clause-fails
```

这是避免无标点混合语义漏判的关键要求。

---

# 13. Positive Evidence 是安全边界

Stage 1 输出：

```text
Raw:
我没有杀死他，只是刺伤了他的手臂。

Positive Evidence:
刺伤了他的手臂
```

Stage 2 只能得到：

```text
刺伤了他的手臂
```

不能得到：

```text
完整 Raw Message
```

因此：

```text
characterIsKilled
```

没有死亡 evidence match 时必须被排除。

---

# 14. Semantic Resolver

输入：

```js
ActionEvent
ActionRegistry
```

输出：

```js
allowedActionIds[]
```

Resolver 不负责：

```text
判断是否计划
判断是否未来
判断是否回忆
判断是否传闻
判断动作是否发生
```

这些都已经由 Execution Parser 完成。

---

# 15. Action semantic metadata

建议 Action definition 逐步支持：

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

# 16. Metadata 只描述“我是什么”

Action metadata 负责：

```text
我属于哪些 category
什么 Positive Evidence 能代表我
我与哪些 Action 互斥
我的 priority / specificity
我的 riskLevel
我的 args
我的 target 条件
我的 check()
我的 run()
```

不负责：

```text
整句是不是计划
整句是不是回忆
整句是不是传闻
整句是不是提问
整句是不是未来
整句是不是失败尝试
```

---

# 17. Metadata Matcher 永远不能接收 Raw Full Message

允许：

```js
semantic.match({
  event,
  evidence,
  contextHints
})
```

禁止：

```js
semantic.match({
  rawMessage
})
```

或：

```js
semantic.match(fullText)
```

这是防止 Stage 1 被 metadata 绕过的强制安全边界。

---

# 18. characterIsKilled / isInjured 示例

## isInjured

```js
semantic: {
  evidencePatterns: [
    /刺伤|砍伤|打伤|重伤|负伤|受伤|骨折|流血|重创/i
  ],
  exclusiveGroup: "physical_outcome",
  priority: 50,
  riskLevel: "high"
}
```

## characterIsKilled

```js
semantic: {
  evidencePatterns: [
    /杀死|处死|斩首|毙命|身亡|断气|气绝/i
  ],
  exclusiveGroup: "physical_outcome",
  priority: 100,
  riskLevel: "high"
}
```

输入：

```text
evidence = 刺伤了他的手臂
```

结果：

```text
isInjured → MATCH
characterIsKilled → NO MATCH
```

priority 不允许让没有证据的死亡 Action 覆盖受伤 Action。

---

# 19. Relationship 示例

输入：

```text
她不是我的情人，我们只是成为了朋友。
```

Execution Parser：

```text
Rejected:
不是我的情人
→ negated

Positive Event:
成为了朋友
→ relationship
```

Resolver：

```text
becomeFriendsWith → MATCH
becomeLoversWith → NO MATCH
becomeSoulmatesWith → NO MATCH
```

注意：

```text
evidencePatterns 必须覆盖自然变化形式
```

例如：

```text
成为朋友
成为了朋友
结为朋友
成为好友
建立友谊
```

但不要再让 Action 自己判断：

```text
不是
没有
未来
传闻
```

---

# 20. exclusiveGroup

用于：

```text
同一个 Event
多个 Action 都合法匹配
但结果互斥
```

例如：

```text
physical_outcome:
  isInjured
  characterIsKilled

relationship_tier:
  becomeFriendsWith
  becomeBestFriendsWith
  becomeLoversWith
  becomeSoulmatesWith
```

Resolver 流程：

```text
先验证 evidence match
再应用 exclusivity / priority
```

绝不能：

```text
先按 priority 选最高
再假设它匹配
```

---

# 21. priority / specificity 的边界

priority 只能处理：

```text
多个 Action 已经独立 evidence-match
```

例如：

```text
“成为了挚友”
```

可能同时匹配：

```text
friend
best_friend
```

此时更具体的：

```text
best_friend
```

可通过 priority / specificity 胜出。

但：

```text
刺伤了手臂
```

死亡 Action 没有 evidence match，就算 priority=1000 也不得参与竞争。

---

# 22. Semantic Resolver 参考算法

```js
function resolveSemanticCandidates(event, actionRegistry) {
  const candidates =
    actionRegistry
      .getAllActions()
      .filter(action =>
        action.definition.triggerCategories
          ?.includes(event.category)
      );

  const matched = [];

  for (const action of candidates) {
    const semantic = action.definition.semantic;

    if (!semantic) {
      continue;
    }

    const evidenceText = event.evidence.text;

    if (
      semantic.excludePatterns?.some(
        pattern => pattern.test(evidenceText)
      )
    ) {
      continue;
    }

    const patternMatched =
      semantic.evidencePatterns?.some(
        pattern => pattern.test(evidenceText)
      ) ?? false;

    const customMatched =
      typeof semantic.match === "function"
        ? semantic.match({
            event,
            evidence: event.evidence
          })
        : false;

    if (patternMatched || customMatched) {
      matched.push(action);
    }
  }

  return resolvePriorityAndExclusivity(matched);
}
```

---

# 23. Event-level allowedActionIds

旧：

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

问题：

```text
Action 与 Event ownership 不明确
```

v6.5：

```js
{
  events: [
    {
      eventId: "evt_1",
      category: "death_or_injury",
      evidence: {
        text: "刺伤了卫兵",
        start: 0,
        end: 6
      },
      allowedActionIds: [
        "isInjured"
      ]
    },

    {
      eventId: "evt_2",
      category: "location_or_exit",
      evidence: {
        text: "离开大厅",
        start: 9,
        end: 13
      },
      allowedActionIds: [
        "leavesConversation"
      ]
    }
  ]
}
```

---

# 24. 多 Event 顺序必须保留

```text
我先拿起酒杯，随后刺伤卫兵，最后离开大厅。
```

正确：

```text
Event 1 → daily_object_interaction
Event 2 → death_or_injury
Event 3 → location_or_exit
```

禁止：

```text
按 category 固定排序
Set 导致顺序丢失
只保留第一个 Event
只保留最后一个 Event
```

Event 顺序应根据：

```text
evidence.start
```

确定。

---

# 25. 同 Category 多 Event 不得被错误 Dedupe

```text
我刺伤了第一个卫兵，随后又刺伤了第二个卫兵。
```

正确：

```text
Event 1
category = death_or_injury
targetHint = guard_1

Event 2
category = death_or_injury
targetHint = guard_2
```

不能：

```text
death_or_injury
→ 只保留一个
```

---

# 26. Event-level dedupe

建议：

```js
dedupeKey =
  speakerId
  + category
  + normalizedEvidence
  + optionalTargetHint;
```

核心目标：

> 防止同一个叙事事件重复执行，而不是阻止同一个 category 在一轮中出现多个不同事件。

---

# 27. Player 与 NPC evaluation 必须独立

旧风险：

```js
pendingPlayerActionMessage ?? placeholder
```

v6.5 目标逻辑：

```js
if (pendingPlayerActionMessage) {
  await evaluatePlayerAction(
    pendingPlayerActionMessage
  );

  pendingPlayerActionMessage = null;
}

await evaluateNpcAction(
  placeholder
);
```

真实生产实现需要结合现有 Conversation 生命周期重新设计，不应机械复制伪代码。

---

# 28. Player/NPC Runtime Test 要求

在修改该路径之前，优先建立真正可失败的 runtime regression harness。

至少：

```text
R1:
Player gold
NPC combat
→ 两个 message 独立 evaluation

R2:
Player 无动作
NPC leave
→ NPC 正常 evaluation

R3:
Player combat
NPC daily
→ 两个 message 不相互替代
```

如果现有 Conversation 太难实例化，应建立最小 test seam。

禁止：

```text
复制生产逻辑到 fake harness
然后测试复制品
```

---

# 29. Action LLM 最终权限

理想情况下 Action LLM 不再负责：

```text
动作有没有发生
是不是计划
是不是未来
是不是回忆
是不是传闻
是不是死亡还是受伤
是不是朋友还是恋人
```

它只负责：

```text
actor
target
args
同 Event allowedActionIds 内最终选择
```

---

# 30. Event-oriented Prompt

建议：

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

Prompt 强制规则：

```text
Each event has already passed execution-state validation.

Use only that event's Positive Evidence to determine action meaning.

Conversation history may be used only for:
- pronoun resolution
- actor identity
- target identity
- amount
- required argument context

Never use rejected, negated, hypothetical, recalled,
reported, planned or failed text outside the validated
evidence span to upgrade or change an event.

Never select a script outside that event's allowedActionIds.

If actor, target, required arguments or execution
preconditions cannot be resolved safely, omit that event.
```

# 30.1 Action Prompt Cache Invariant

v6.5 将 Action Prompt 改为 Event-oriented 结构时，必须保持现有动作请求的稳定缓存前缀。

核心原则：

> 固定内容必须尽量位于动态 Event 数据之前；高频变化内容必须尽量后置。

推荐 Prompt 顺序：

```text
VOTC_ACTION_CACHE_ANCHOR
↓
固定动作系统规则
↓
固定安全规则
↓
固定 Event 处理协议
↓
固定输出格式 / JSON 示例
↓
相对稳定的 Action/Schema 结构
────────────────────────
动态边界
────────────────────────
当前 allowedActionIds / shortlist
↓
当前 Event
↓
Positive Evidence
↓
actor / target / amount 等动态参数
↓
最近对话上下文

---

# 31. 高风险状态必须 Fail-Closed

以下属于强制不变量：

```text
characterIsKilled
isImprisonedBy
高影响关系变化
职位变化
臣属/信仰变化
敌对 scheme
其他不可逆或高影响 CK3 state change
```

必须满足：

```text
没有清晰 Positive Evidence
→ 不执行

target 不明确
→ 不执行

required arg 不明确
→ 不执行

check() 失败
→ 不执行

Event → Action 绑定不唯一且风险高
→ 不执行
```

riskLevel metadata 可以渐进加入。

但：

> high-risk fail-closed 本身不是可选增强项，而是 v6.5 强制安全原则。

---

# 32. Registry 目标

未来 Registry 至少应暴露：

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

新增一个 Action：

```text
z_isTorturedBy.js
```

理想情况下只需要：

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

不需要继续修改：

```text
main.js 大型 Action-specific semantic if/else
getActionIdsForTriggers 的硬编码 Action ID 表
ActionPromptBuilder 的单独专属说明
```

---

# 33. Legacy Fallback

禁止一次性删除旧逻辑。

迁移期：

```text
SemanticResolver
  │
  ├─ Metadata Resolver
  │
  └─ LegacySemanticResolver
```

但是必须遵守：

> Legacy fallback 只能消费已经经过 Execution Parser 验证的 Event / Positive Evidence。

不能为了兼容而继续：

```text
LegacySemanticResolver(fullRawMessage)
```

否则 Stage 2 contamination 会被重新引入。

---

# 34. Metadata 可以先定义，但不得先拥有 Runtime Authority

metadata schema 可以提前实现：

```text
evidencePatterns
excludePatterns
exclusiveGroup
priority
riskLevel
match
```

甚至可以提前写 metadata unit tests。

但在：

```text
ActionEvent
Positive Evidence
Execution Parser
```

没有建立以前：

> metadata resolver 不得参与真实 runtime action selection。

否则 metadata matcher 只能拿 Raw Full Message，违反最核心的安全边界。

---

# 35. Acceptance Harness 必须真正能够失败

Phase 0 / 0.5 / 0.6 已经建立了大量 case，但当前其中部分仍属于：

```text
diagnostic tracking
known-failure recording
future requirement
source contract check
```

v6.5 开始修改生产代码前，应逐步强化测试基础设施。

强制原则：

```text
UNEXPECTED_FAILURE
→ process non-zero exit

KNOWN_V6.4_FAILURE
→ 必须匹配明确的 failure signature

不能只因为 case ID 属于 known list
→ 自动把任何失败都视为 known failure

bug 被修复以后
→ 立刻转为普通 hard assertion

SOURCE_CONTRACT_CHECK
→ 不得称为 Runtime Test

CURRENT_LAYER_PASS
→ 不得等同 FUTURE_ARCHITECTURE_PASS
```

---

# 36. 测试分层

v6.5 建议正式建立：

```text
Gate Tests
Execution Parser Tests
Semantic Resolver Tests
Action Script Tests
Player/NPC Runtime Tests
Integration Tests
High-Risk Safety Tests
```

---

# 37. Candidate Gate Tests

Gate 关注召回，不关注动作是否真实执行。

例如：

```text
我拔剑。
我想拔剑。
如果我拔剑……
昨天我拔过剑。
听说他拔剑了。
```

Gate 可以统一：

```text
combat hint
```

后续真假由 Execution Parser 决定。

Gate Tests 不应再要求：

```text
所有非执行语境必须完全无 hint
```

---

# 38. Execution Parser Tests

必须直接验证：

```text
我拔剑。
→ actionable combat Event

我想拔剑。
→ no actionable Event

如果我拔剑……
→ no actionable Event

我昨天拔过剑。
→ no current Event

听说他拔剑。
→ no current Event

我试图拔剑但剑卡住。
→ no actionable combat Event
→ rejectedCandidate failed_before_execution

我挥剑攻击但被躲开。
→ actionable combat Event
→ executionStatus=executed
→ resultStatus=failed
```

---

# 39. Semantic Resolver Tests

输入应直接构造 Positive Event：

```js
{
  category: "death_or_injury",
  evidence: {
    text: "刺伤了他的手臂",
    start: 0,
    end: 8
  },
  executionStatus: "executed"
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

# 40. Metadata Unit Tests

每个 Action metadata 可独立验证：

```js
assert(
  isInjured.semantic.evidencePatterns
    .some(p => p.test("刺伤了他的手臂"))
);

assert(
  !characterIsKilled.semantic.evidencePatterns
    .some(p => p.test("刺伤了他的手臂"))
);
```

更复杂 Action 使用：

```text
custom matcher unit test
```

---

# 41. 必须保留的 Mixed-Semantic 验收案例

## Case 1

```text
我没有杀死他，只是刺伤了他的手臂。
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

## Case 2

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

## Case 3

```text
我想起昨天曾杀过一个刺客，随后拿起桌上的酒杯。
```

当前 Event：

```text
daily object interaction
```

禁止：

```text
current characterIsKilled
```

---

## Case 4

```text
听说公爵杀死了一个囚犯，我随即转身离开大厅。
```

当前：

```text
leavesConversation
```

禁止：

```text
current characterIsKilled
```

---

## Case 5

```text
她不是我的情人，我们只是成为了朋友。
```

预期：

```text
becomeFriendsWith
```

禁止：

```text
becomeLoversWith
becomeSoulmatesWith
```

---

## Case 6

```text
他没有被罢免，反而被任命为骑士。
```

预期：

```text
isEmployedAsKnightBy
```

禁止：

```text
isFiredFromCouncilOf
```

---

## Case 7

```text
他没有离开，而是进入了王座厅。
```

预期：

```text
changeLocation
```

禁止：

```text
leavesConversation
```

---

## Case 8

```text
我挥剑刺向他，但他及时躲开了。
```

预期：

```text
combat ActionEvent
performCombatAction
executionStatus=executed
resultStatus=failed
```

禁止：

```text
isInjured
characterIsKilled
```

---

## Case 9

```text
我试图拔剑，但剑卡在剑鞘里。
```

预期：

```text
no actionable combat Event
RejectedCandidate:
failed_before_execution
```

禁止：

```text
performCombatAction
isInjured
characterIsKilled
```

---

## Case 10

```text
我刺伤了卫兵，随后离开大厅。
```

预期：

```text
Event 1 → isInjured
Event 2 → leavesConversation
```

两个独立 evidence span。

---

## Case 11

```text
我明天会杀了他，但现在先离开大厅。
```

预期：

```text
current Event → leavesConversation
```

禁止：

```text
current death Action
```

---

## Case 12

```text
如果我杀了他也许会惹麻烦，不过我现在把50金币交给你。
```

预期：

```text
current Event → gold transfer
```

禁止：

```text
death Action
```

该 Case 必须同时覆盖：

```text
hypothetical death false positive
+
gold inverse-order false negative
```

---

# 42. Player / NPC 边界验收

## A

Player：

```text
我递给你50金币。
```

NPC：

```text
我接过金币，随后一拳打向卫兵。
```

v6.5：

```text
Player message evaluation
NPC message evaluation
```

都必须发生。

---

## B

Player：

```text
我拔剑刺向卫兵。
```

NPC：

```text
我向后闪开，随后拿起桌上的酒杯。
```

预期：

```text
Player combat
NPC daily object
```

互不覆盖。

---

## C

Player：

```text
你怎么看这件事？
```

NPC：

```text
我起身离开大厅。
```

预期：

```text
Player → no action
NPC → location/exit action
```

---

# 43. Event Order / Dedupe 验收

## Order

```text
我先拿起酒杯，随后刺伤卫兵，最后离开大厅。
```

必须：

```text
1 daily_object
2 injury
3 location/exit
```

---

## Dedupe

```text
我刺伤了第一个卫兵，随后又刺伤了第二个卫兵。
```

必须：

```text
2 independent injury Events
```

不能按 category 合并。

---

# 44. 高风险 Action Safety Tests

至少保证：

```text
characterIsKilled
isImprisonedBy
```

在：

```text
target missing
```

时：

```text
安全失败
不调用 runGameEffect
不产生 CK3 effect
```

后续应进一步加强：

```text
exact effect structure
source scope
target scope
required args
preconditions
```

当前不要把尚未有 hard assertion 的细节当成已经锁定。

---

# 45. v6.5 推荐迁移顺序

## Phase 1：独立审计 + Acceptance Harness Hardening

目标：

```text
重新运行所有现有测试
确认 Handoff 与真实代码一致
把关键 diagnostic case 升级为真正 hard assertions
保证 unexpected regression 非零退出
```

不改核心架构。

---

## Phase 2：定义接口，不改变行为

定义：

```text
ActionEvent
RejectedCandidate
Semantic metadata schema
SemanticResolver interface
LegacySemanticResolver interface
```

此阶段：

```text
metadata inactive
旧 runtime 仍主导
```

---

## Phase 3：Execution Parser / Positive Evidence 最小闭环

优先解决：

```text
Case 1
Case 6
Case 7
```

要求：

```text
ActionEvent[]
Positive Evidence span
Stage 2 不再读 Raw Full Message
```

---

## Phase 4：Player / NPC Independent Evaluation

先建立或补 runtime harness。

然后修：

```text
pendingPlayerActionMessage ?? placeholder
```

保证：

```text
Player evaluation independent
NPC reply evaluation independent
```

---

## Phase 5：Metadata Resolver 基础设施

建立：

```text
Registry-driven Semantic Resolver
Legacy Fallback
exclusiveGroup
priority
riskLevel schema
```

必须：

```text
resolver input = Event
resolver input ≠ full raw message
```

---

## Phase 6：高风险 Metadata 试点

优先：

```text
characterIsKilled
isInjured
isImprisonedBy
```

验证：

```text
physical_outcome exclusivity
Positive Evidence isolation
high-risk fail-closed
```

---

## Phase 7：关系 / 职位 / 信仰 / 封臣 / Scheme 迁移

逐个迁移。

每迁移一个 Action：

```text
metadata test
semantic resolver test
action script test
integration regression
```

---

## Phase 8：Scene / RP Actions

迁移：

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

## Phase 9：Candidate Gate 降权与召回优化

Gate 最终正式变为：

```text
candidate hints
```

重点修：

```text
relationship recall
gold inverse-order
hypothetical wake-up without truth authority
```

---

## Phase 10：Legacy Removal

仅当：

```text
所有 Action 已 metadata-driven
所有 acceptance tests 通过
runtime 稳定
```

才逐步删除：

```text
getSemanticActionProfile hardcoded rules
byReason Action ID mapping
旧 Action-specific regex logic
```

---

# 46. 旧 API 到新职责的映射

| v6.4 API | v6.5 目标 |
|---|---|
| `getActionTriggers()` | `getActionHints()` / Candidate Gate |
| `getActionTrigger()` | Legacy compatibility only |
| `getSemanticActionProfile()` | `LegacySemanticResolver`，最终删除 |
| `getActionIdsForTriggers()` | Registry-driven discovery |
| `shouldEvaluateForMessage()` | Candidate wake-up + event/runtime gate |
| `evaluateForCharacter()` | Event-oriented evaluation orchestration |
| message-level `allowedActionIds` | Event-level `allowedActionIds` |
| message-level dedupe | Event-level dedupe |

---

# 47. 不应做的事情

## 不要一次性删除 Gate

Gate 仍然有 API 成本控制价值。

---

## 不要把旧 Regex 机械搬家

```text
main.js 巨型 regex
→ 每个 Action 都复制一份 regex
```

不是重构。

真正目标是：

```text
通用 execution semantics 中央化
Action-specific semantics metadata 化
```

---

## 不要让 Action 自己判断 future / negation / rumor

否则只会把一个中央规则库变成几十个重复规则库。

---

## 不要让 Action LLM 恢复自由浏览所有 Action

v6.4 shortlist 的核心安全优势必须保留。

---

## 不要在 Positive Evidence 建立前启用 metadata runtime

metadata matcher 不应该先接 Raw Message 再等待未来修正。

---

## 不要为了“架构漂亮”大规模重写

优先修：

```text
已被 regression tests 证明的 bug
```

再逐步抽象。

---

# 48. v6.5 强制验收不变量
[ ] Event-oriented Action Prompt 保持稳定缓存前缀，
    动态 Event / Evidence / actor / target / conversation 不得提前破坏 cache anchor

最终至少满足：

```text
[ ] 否定死亡 + 实际受伤
[ ] 否定罢免 + 实际骑士任命
[ ] 否定离开 + 实际进入
[ ] 否定恋人 + 实际朋友
[ ] hypothetical death 不成为 Positive Event
[ ] gold “把50金币交给你” 可召回
[ ] Player message 独立 evaluation
[ ] NPC reply 独立 evaluation
[ ] 一条 message 可产生多个 ActionEvents
[ ] 每个 Event 有独立 Positive Evidence span
[ ] executed / result failed 能区分
[ ] failed-before-execution 不进入 Action candidates
[ ] Event 顺序保持
[ ] 同 category 不同 target 不被错误 dedupe
[ ] Stage 2 / metadata 永远不扫描完整 Raw Message
[ ] high-risk actions fail-closed
[ ] unexpected regression 导致 test process non-zero exit
```

---

# 49. Terra / Codex 接手时的第一阶段工作

接手后不要直接修改架构。

先：

```text
1. 重新运行 test-action-system.js
2. 重新运行 test-action-phase-0.6.js
3. node --check main.js
4. 审查 getActionTriggers
5. 审查 getSemanticActionProfile
6. 审查 getActionIdsForTriggers
7. 审查 shouldEvaluateForMessage
8. 审查 evaluateForCharacter
9. 审查 pendingPlayerActionMessage
10. 审查 actionGateProcessedTriggers
11. 审查 Action Registry
12. 审查 ActionPromptBuilder
```

然后输出：

```text
确认成立的问题
不成立或需要修正的旧判断
最终数据结构
Phase 1 最小改动范围
要修改的文件
对应 regression tests
```

确认后再施工。

---

# 50. 最终目标

未来增加一个新 Action：

```text
z_isTorturedBy.js
```

理想流程：

```text
1. 新建 Action Script
2. 声明 triggerCategories
3. 声明 semantic metadata
4. 写 args / check / run
5. 写 metadata / resolver / script regression test
```

核心引擎原则上无需为了：

```text
“新增一个 Action”
```

再次修改：

```text
大型 Action-specific regex
byReason mapping
semantic allow() if/else
Prompt 专属说明
```

---

# 51. 最终设计原则总结

v6.5 可以浓缩为七条：

1. **Gate 只负责候选召回。**
2. **Execution Parser 是唯一执行事实来源。**
3. **只有 executed/current action 才进入 actionable ActionEvent[]。**
4. **Positive Evidence 是 Semantic Resolver 的安全边界。**
5. **Action 专属语义下沉到 metadata，通用执行语义保持中央统一。**
6. **Action LLM 只做 actor / target / args，并受 Event-level allowlist 约束。**
7. **高风险动作始终 fail-closed，测试必须真正能够阻止 regression。**

最终职责：

```text
Candidate Gate
= “这里可能有动作”

Execution Parser
= “哪些候选真正执行了”

RejectedCandidate
= “哪些候选被拒绝，以及为什么”

ActionEvent
= “已验证的当前真实事件 + Positive Evidence”

Action Metadata + Semantic Resolver
= “这个 Event 属于哪些 Action Scripts”

Action LLM
= “谁对谁，参数是什么”

Local Validation
= “这个动作现在是否真的允许执行”

CK3 Effect
= “最终状态变化”
```

---

# 52. 结论

v6.5 不应退回到：

```text
让 LLM 从所有 Action 自由猜
```

也不应变成：

```text
继续无限增加 Gate Regex
```

正确方向是：

```text
高召回 Candidate Gate
+
统一 Execution Parser
+
Positive Evidence ActionEvent
+
Registry-driven Semantic Resolver
+
Event-level constrained Action LLM
+
Local fail-closed validation
```

这样可以同时解决：

```text
Gate 漏判阻断
假设误判
Stage 2 full-text contamination
Player/NPC evaluation 串线
多 Event 串线
同类 Event 被 dedupe
execution / result 混淆
Action 增长导致 main.js 膨胀
高风险动作缺乏明确安全边界
测试看似 PASS 但无法真正阻止 regression
```

这份架构应作为 VOCT v6.5 动作系统重构的正式设计基线。

---

# Appendix A：当前文档与测试资产

建议 Terra / Codex 阅读顺序：

```text
1. docs/v6.5-terra-handoff.md
2. 本文档
3. scripts/test-action-system.js
4. scripts/test-action-phase-0.6.js
5. docs/action-system-inventory.md
6. Phase 0 / 0.5 / 0.6 报告（按需）
```

---

# Appendix B：证据标签规范

后续文档建议使用：

```text
VERIFIED_BY_REGRESSION
VERIFIED_BY_RUNTIME
SOURCE_CONFIRMED_ARCHITECTURE_RISK
TESTABILITY_GAP
FUTURE_REQUIREMENT
DESIGN_PROPOSAL
```

避免：

```text
所有分析都写成“已确认”
```

从而确保测试、源码观察和架构设计之间始终保持清晰边界。

# VOCT-NEW V7.9.3 — Action Engine 4.0 正式实施规格书

> **正式勘误：** 本规格中所有 Self-Target 目标约束均以 [AE4 Spec Errata-001](AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md) 为准。Errata-001 删除全局 `source != target` 不变量，并以 Action Metadata `targetPolicy` 取代。

**文档状态：Architecture Freeze / Z1**  
**目标版本：V7.9.3**  
**核心模块：Action Engine 4.0（AE4.0）**  
**实施策略：I2 分阶段接入 + J2 Hard Phase Gates**  
**默认引擎：AE4**  
**回滚策略：H2 Engine-level Legacy Rollback**  
**运行模式：Performance / Precision**

---

## 0. 文档目的

本规格书用于冻结 V7.9.3 的 Action Engine 4.0 架构，并作为 Codex / 人工开发的实施依据。

从本规格书冻结起，除以下两类情况外，不再新增语义层、Judge、Rescue 或新的多级判断链：

1. 实施过程中发现明确的架构矛盾或不可实现项；
2. M2 Ground Truth Benchmark 或 CK3 实机数据证明当前设计存在严重问题。

AE4.0 的目标不是继续扩张语义复杂度，而是恢复动作触发能力、提高真实 Recall，并保留必要的本地合法性、安全性、Consent、关系状态与去重约束。

---

# 1. AE3.0 失败结论与 AE4.0 设计目标

## 1.1 AE3.0 实机问题结论

V7.9.2 实机测试表明，Action Engine 3.0 的主要失败不是 Token 成本，而是 **Explicit Action Recall 严重不足**。

实机中大量明确动作无法稳定触发，包括但不限于：

- 支付；
- 囚禁；
- 伤害；
- 杀害；
- 鱼水之欢；
- 情人 / 灵魂伴侣 / 结义等关系建立；
- 宫廷职位任命；
- 内阁任命；
- 内阁罢免；
- 停战；
- 其他明确关系与职位动作。

与此同时，Letter Pipeline 已恢复，Performance 下部分 Opinion/Favor 变化恢复，`setEmotion`、宽衣解带、Scene Change 等简单或确定性动作能够正常工作。

因此 AE3.0 的核心失败模式定义为：

> 系统为了降低 False Positive，加入过多前置语义 Gate、Parser、Resolver、Rescue、Judge，使大量真实动作在 LLM 真正看到完整 Action 意图前就被提前否决。

## 1.2 AE4.0 核心原则

1. **LLM 负责解释“这句话意味着什么 Action”。**
2. **本地代码负责判断“该 Action 当前是否合法、安全、可执行”。**
3. **Precision 不允许 Candidate Gate 决定是否值得调用 Action Selector。**
4. **Performance 本地层只处理确定性动作，不承担复杂自然语言理解。**
5. **同一语义不得经过多层 Judge 重复证明。**
6. **Explicit Action 与 Social Consequence 分离。**
7. **Consent / Pending 必须由本地状态机控制，LLM 无权绕过。**
8. **多人 Target 绑定错误必须 Fail-Closed。**
9. **非幂等动作绝不在未知执行结果下盲目重放。**
10. **真实 Recall 必须通过 Ground Truth Benchmark 和 CK3 实机验证，而不是只依赖单元测试。**

---

# 2. 已冻结架构决策

| ID | 决策 | 最终方案 |
|---|---|---|
| A | Precision Trigger | 每条有效 RP 对白都进入官方式 Action Selector |
| P2 | Precision Context | Available Catalog + Participants + Relevant State + 最近 3~4 轮 + Explicit Pending + 当前对白 |
| S2 | Precision Action Count | 每轮 0~3 Actions |
| R1 | AE3 迁移 | 旧组件退出运行路径，暂不物理删除 |
| C2 | Action Catalog | 官方式 Available Action Catalog |
| F2 | Performance | Local First + 最多一次 Compact Selector |
| B3 | Multi-action | 默认独立；明确依赖才建立顺序/原子链 |
| K2 | Pending | Explicit Consent Pending |
| Q2 | Structured Output | `action_call + pending_response + evidenceMessageIds` |
| O2 | Opinion | `-3/-2/-1/+1/+2/+3` 离散值 |
| D2 | Social Dedupe | Cause-aware Dedupe |
| M2 | Analytics | Runtime Funnel + Ground Truth Benchmark |
| T2 | Cache | Stable Master Prefix + Dynamic Availability Tail |
| E2 | Error Policy | Transport-only retry + Semantic Fail-Closed |
| L2 | Performance Local | 确定性白名单 + HIT/MAYBE/NONE + Recall-biased Hint Detector |
| G2 | Mode Migration | Balanced 完全退出 Runtime，自动迁移 Performance |
| H2 | Rollback | AE4 默认 + Engine-level Legacy Rollback |
| U1 | 目录结构 | 新建 `action-system/v4/` |
| V2 | Metadata | Incremental Metadata + Safe Defaults |
| I2 | 实施方式 | 7 Phase 分阶段接入 |
| J2 | 阶段验收 | Hard Phase Gates |
| Z1 | Architecture Freeze | 架构冻结，进入实施 |

---

# 3. 最终运行模式

AE4.0 仅保留：

```text
performance
precision
```

Balanced 完全退出 AE4 Runtime。

启动迁移规则：

```text
balanced         -> performance
performance      -> performance
precision        -> precision
missing / null   -> performance
invalid          -> performance
```

默认模式：

```text
DEFAULT_ACTION_MODE = performance
```

Performance ↔ Precision 切换时：

- 不清空 Explicit Pending；
- 不清空执行历史；
- 不清空 Dedupe Ledger；
- 不清空 Opinion Cooldown；
- 不清空 World Event Evidence；
- 只允许清理 Mode-specific 临时状态。

---

# 4. Engine Router 与 Legacy Rollback

## 4.1 顶层原则

顶层 `action-engine.js` 只负责 Engine Version 路由，不负责语义判断。

```text
ACTION_ENGINE_VERSION = 4
        ↓
ActionEngineV4
```

只有开发者显式配置：

```text
ACTION_ENGINE_VERSION = 3
```

才进入冻结的 Legacy AE3。

禁止：

```text
AE4 failed
→ 当前消息自动调用 AE3
```

## 4.2 AE3 定位

AE3 在 V7.9.3 中定义为：

```text
Frozen Legacy
```

允许：

- Critical compatibility fix；
- Engine-level emergency rollback。

禁止：

- 新增 Candidate 规则；
- 新增 Semantic Rescue；
- 新增 Precision Judge；
- 新增 AE3 动作优化；
- 与 AE4 混合逐消息执行。

---

# 5. 推荐目录结构

```text
action-system/
│
├─ action-engine.js
│
├─ v4/
│  ├─ action-engine-v4.js
│  │
│  ├─ precision/
│  │  ├─ precision-action-selector.js
│  │  ├─ precision-context-builder.js
│  │  └─ precision-selector-prompt.js
│  │
│  ├─ performance/
│  │  ├─ fast-action-resolver.js
│  │  ├─ execution-form-guard.js
│  │  ├─ fallback-hint-detector.js
│  │  └─ compact-action-selector.js
│  │
│  ├─ catalog/
│  │  ├─ available-action-catalog.js
│  │  ├─ master-action-dictionary.js
│  │  └─ relevant-state-projector.js
│  │
│  ├─ proposal/
│  │  ├─ action-selector-schema.js
│  │  ├─ action-proposal-validator.js
│  │  └─ action-batch-planner.js
│  │
│  ├─ pending/
│  │  ├─ explicit-pending-store.js
│  │  └─ pending-resolver.js
│  │
│  ├─ social/
│  │  ├─ opinion-effect-normalizer.js
│  │  └─ social-effect-dedupe.js
│  │
│  ├─ analytics/
│  │  ├─ action-funnel-analytics.js
│  │  ├─ selector-cache-analytics.js
│  │  └─ action-outcome-recorder.js
│  │
│  └─ constants/
│     ├─ action-engine-version.js
│     └─ action-mode.js
│
├─ actions/                    # 共享
├─ executor/                   # 共享
├─ participant-resolver.js     # 共享
├─ reference-resolver.js       # 共享
├─ relationship-transition.*   # 共享
├─ approval/                   # 共享
└─ AE3 existing files          # Frozen Legacy
```

具体文件名可按当前仓库命名风格调整，但职责边界不得重新合并成大型 God Object。

---

# 6. Precision 4.0

## 6.1 最终调用链

```text
Incoming RP Message
        ↓
Transport / Duplicate Filter
        ↓
RelevantStateProjector
        ↓
AvailableActionCatalog
        ↓
PrecisionContextBuilder
        ↓
PrecisionActionSelector
        ↓
Q2 Structured Decisions (0~3)
        ↓
Decision Normalization
        ↓
Reference / Participant Binding
        ↓
Pending / Consent Resolution
        ↓
ActionProposalValidator
        ↓
ActionBatchPlanner
        ↓
Approval
        ↓
Executor
        ↓
Outcome Recorder
        ↓
Confirmed World Event
        ↓
Social Consequence Sidecar
```

## 6.2 Precision 主链禁止组件

以下组件不得作为 Precision Explicit Action Trigger 的前置准入层：

```text
Candidate Gate
Event Parser semantic gating
Semantic Resolver gating
Semantic Rescue
Precision Action Judge
multi-stage semantic escalation
confidence execution threshold
```

这些 AE3 组件在 R1 下可保留文件，但不进入 Precision 4.0 Runtime。

## 6.3 Precision 调用频率

每条 **有效 RP 对白** 均调用一次 Precision Action Selector。

允许跳过的只有传输 / 技术级非对白输入，例如：

- 空消息；
- 重复 messageId；
- 内部系统事件；
- UI event；
- Telemetry payload；
- 已处理消息；
- 无实际 RP 文本的内部消息。

禁止重新加入语义型“先判断有没有 Action 再决定是否调用”。

---

# 7. P2 Precision Context

Precision Selector 输入只包含：

```text
Available Action Catalog
Current Speaker
Active Participants
Relevant Current Game State
Relevant Relationships / Offices / Prison State
Recent 3~4 Real Dialogue Turns
Explicit Pending Commitments
CURRENT MESSAGE
```

禁止加载：

```text
完整 Conversation History
完整 Memory
完整 Biography
完整 Summary
大量 Scene prose
内部 reasoning
旧 Action 推理日志
```

核心原则：

> Selector 只需要判断“由于当前交互，现在应该调用哪些 Action”，而不是重新理解角色全部人生背景。

---

# 8. C2 Available Action Catalog

## 8.1 Selector 前允许的 Availability Check

仅允许游戏状态合法性检查：

- 角色存在；
- 目标符合所选 Action 的 `targetPolicy`；未声明时默认 `other_only`，未知值 fail-closed；
- 角色是否存活；
- 囚禁状态；
- 当前关系状态；
- 当前是否已有职位；
- 是否在目标宫廷；
- 是否已在内阁；
- 金币等当前资源约束；
- 当前 Action metadata 的基本前置条件。

AE4 不得施加全局 `source != target` 不变量。Self-target 仅在 Action Contract 显式声明 `self_only` 或 `self_or_other` 时允许；Catalog、Target Generation、Selector、Participant/Reference Binding、Proposal Validator、`Action.check()` 与 Executor 必须遵循同一策略。

## 8.2 Selector 前禁止的检查

禁止：

- 关键词 Gate；
- Semantic Event Detection；
- completed / planned / hypothetical 分类；
- Confidence Gate；
- 当前对白是否“够像动作”的本地语义判断。

## 8.3 T2 下的实现

逻辑上采用 C2，但 Prompt 采用：

```text
Stable:
Master Compact Action Dictionary
Q2 Schema
Universal Rules

Dynamic:
AVAILABLE_ACTION_IDS
AVAILABLE_TARGETS
AVAILABLE_ARGUMENT_OPTIONS
```

这样保持 Available Action 约束，同时尽量提高 Prompt Cache 稳定性。

---

# 9. T2 Cache 架构

## 9.1 Stable Prefix

必须尽量字节级稳定：

```text
AE4 Selector Rules
Master Compact Action Dictionary
Q2 Output Schema
Pending Rules
Multi-action Rules
Universal Selection Rules
```

以下内容禁止进入 Stable Prefix：

- Current Date；
- Session ID；
- Character Name；
- Scene；
- 动态 Action 顺序；
- 当前 Available Actions；
- 当前人物状态；
- 当前 Token 统计。

## 9.2 Dynamic Tail

```text
AVAILABLE_ACTIONS
AVAILABLE_ARGUMENT_OPTIONS
PARTICIPANTS
RELEVANT_STATE
PENDING
RECENT_DIALOGUE
CURRENT_MESSAGE
```

序列化必须确定性、稳定、紧凑。

## 9.3 Cache Telemetry

每次 Selector Request 至少记录：

```text
selectorVersion
catalogVersion
schemaVersion
provider
model
stablePrefixHash
availableCatalogHash
p2ContextHash
cachedInputTokens
uncachedInputTokens
cacheHitRate
```

---

# 10. Q2 Structured Output

Selector 只允许两种 Decision：

```text
action_call
pending_response
```

推荐结构：

```json
{
  "decisions": [
    {
      "type": "action_call",
      "actionId": "playerPaysGoldTo",
      "sourceCharacterId": "player",
      "targetCharacterId": "char_123",
      "arguments": {
        "amount": 50
      },
      "evidenceMessageIds": ["msg_481"],
      "confidence": 0.97
    },
    {
      "type": "pending_response",
      "pendingId": "pending_482_1",
      "response": "accept",
      "evidenceMessageIds": ["msg_483"],
      "confidence": 0.99
    }
  ]
}
```

约束：

```text
decisions.length <= 3
```

## 10.1 Confidence

`confidence` 仅用于：

- Analytics；
- Debug；
- Benchmark；
- 排序研究。

禁止：

```text
confidence < X
→ reject
```

Confidence 不拥有执行权限，也不拥有否决权限。

## 10.2 Evidence

推荐只返回：

```text
evidenceMessageIds
```

证据必须来自：

```text
Current Message
+
Recent 3~4 Dialogue Window
```

不得使用 Memory、旧 Summary、很久以前的历史消息作为当前 Action 执行证据。

---

# 11. Action Selection Rules

Selector Stable Rules 必须明确：

只输出“由于当前消息，现在变得可执行”的 Action。

不要执行：

- 纯回忆过去事件；
- 假设；
- 条件句；
- 单纯问题；
- 尚未接受的提议；
- 单纯未来计划；
- 明确失败的尝试；
- 非当前发生的文学描写。

允许利用最近 3~4 轮恢复：

- 指代；
- 金额；
- 目标；
- Action 参数；
- 提议内容；
- 当前短回答的语义。

不得：

- 创造不存在的 Action；
- 创造不存在的角色；
- 编造缺失的必填参数。

---

# 12. K2 Explicit Consent Pending

## 12.1 Pending 仅用于需要 Consent 的 Action

Action metadata 定义：

```text
executionMode:
  immediate
  consent_required
```

默认：

```text
immediate
```

特殊 Action 覆盖：

```text
Lover
Soulmate
Blood Brother
Mutual Truce
其他明确需要双方同意的关系动作
```

## 12.2 Pending 数据结构

只保存确定性数据：

```text
pendingId
actionId
sourceId
targetId
arguments
createdTurn
expiresTurn
status
proposalMessageId (optional)
schemaVersion
```

禁止保存模型 reasoning、长自然语言解释、Semantic Confidence History、AE3 occurrence taxonomy。

## 12.3 Pending 生命周期

```text
Proposal
→ Create Pending

Accept
→ Validate
→ Execute

Reject
→ Cancel

No clear response
→ Keep Pending

Expired
→ Reject
```

建议默认 TTL：

```text
8~12 Dialogue Turns
```

具体可由 Action metadata 覆盖。

## 12.4 Pending 必须 Mode-independent

Performance ↔ Precision 切换时 Pending 保留。

AE3 ↔ AE4 Engine 切换时：

- AE4 Pending 不应被 AE3 消费；
- Pending Store 带 schemaVersion；
- 回到 AE4 后，未过期 Pending 可继续处理。

---

# 13. Shared Validation Pipeline

Precision 与 Performance 在 Action Proposal 之后必须完全汇合：

```text
Action Proposal
      ↓
ReferenceResolver
      ↓
ParticipantResolver
      ↓
Availability Recheck
      ↓
Argument Validation
      ↓
Consent / Pending
      ↓
Relationship Transition Safety
      ↓
Action.check()
      ↓
Dedupe / Conflict
      ↓
ActionBatchPlanner
      ↓
Approval
      ↓
Executor
```

禁止创建：

```text
precision-validator
performance-validator
precision-executor
performance-executor
```

模式差异只能集中在“如何从语言得到 Proposal”。

---

# 14. ActionProposalValidator

必须保持纯确定性。

允许：

- actionId 是否存在；
- 是否当前 Available；
- source / target 是否有效；
- 参数是否合法；
- Consent 是否满足；
- Relationship Transition 是否允许；
- Action.check() 是否通过；
- 当前游戏状态是否合法。

禁止：

- 当前对白是不是命令；
- 模型理解是否正确；
- Action 是否“语义够明确”；
- 再次调用 LLM Judge。

---

# 15. B3 ActionBatchPlanner

## 15.1 默认行为

多 Action 默认独立执行。

```text
Action A ✅
Action B ❌
Action C ✅
```

结果：

```text
A execute
B reject
C execute
```

## 15.2 明确依赖

只有本地 metadata 表明存在依赖时才建立顺序：

```text
release
→ appointToCouncil
```

若依赖父 Action 失败：

```text
child = skipped_dependency_failed
```

## 15.3 BatchPlanner 职责

只负责：

```text
Dedupe
Conflict Detection
Dependency Ordering
Execution Sequencing
Independent Grouping
```

不负责语义解释，不负责游戏合法性判断。

## 15.4 Conflict

例如：

```text
becomeFriendsWith
becomeRivalsWith
```

同一对角色同一轮冲突：

```text
conflict_suppressed
```

禁止按 confidence 自动选择其中一个。

---

# 16. V2 Action Metadata

采用 Incremental Metadata + Safe Defaults。

基础默认：

```text
executionMode = immediate
idempotent = false
dependencies = none
```

逐步补全：

```text
requiredArguments
optionalArguments
riskLevel
relationshipTransition
availabilityRequirements
dependencyMetadata
socialCategory
```

示例：

```text
playerPaysGoldTo
executionMode = immediate
requiredArguments = amount
idempotent = false
```

```text
becomeLoversWith
executionMode = consent_required
relationshipTransition = true
idempotent = false
```

```text
setEmotion
executionMode = immediate
idempotent = true
```

Metadata 原则：尽量避免 Pipeline 中出现大量 `if (actionId === "...")`。Catalog、Validator、Pending、BatchPlanner 应尽可能读取统一 metadata。

---

# 17. Performance 4.0

## 17.1 最终调用链

```text
Incoming RP Message
        ↓
ExecutionFormGuard
        ↓
FastActionResolver
        │
        ├─ HIT
        │    ↓
        │ Action Proposal
        │
        └─ not HIT
             ↓
       FallbackHintDetector
             │
       ┌─────┴─────┐
       │           │
      NONE        MAYBE
       │           │
      END          ↓
            CompactActionSelector
                  ↓
            0~2 Proposals
                  ↓
          Shared AE4 Pipeline
```

Provider fallback 硬限制：

```text
≤ 1 / message
```

---

# 18. L2 Fast Resolver

Local Resolver 只允许三种结果：

```text
HIT
MAYBE
NONE
```

禁止：

```text
semanticConfidence
multi-stage scores
embedding similarity
occurrence taxonomy
LLM call
```

## 18.1 HIT 标准

只有同时满足：

- Action ID 唯一确定；
- Target 唯一确定；
- Required Arguments 已解析；
- 无明显条件 / 假设；
- 无明显否定；
- 不是单纯问题；
- 不需要复杂自然语言推理；

才允许 `HIT`。

否则：

```text
MAYBE
```

## 18.2 ExecutionFormGuard

允许做非常基础的本地保护：

```text
如果……
假如……
要是……
会不会……
是否应该……
不要……
别……
我曾经……
昨天我……
```

但禁止演化成：

```text
completed_action
planned_action
reported_past_action
failed_attempt
counterfactual
soft_commitment
...
```

## 18.3 Relationship 本地规则

只处理极明确固定表达。

自然、隐含、文学化关系表达统一：

```text
MAYBE
→ Compact Selector
```

禁止不断堆积复杂 Regex 以模拟 LLM。

---

# 19. FallbackHintDetector

职责仅为：

```text
possible_action = yes / no
```

它不决定 Action ID，不决定是否执行。

设计偏向：

```text
Recall-biased
```

因为：

```text
False Positive
→ 多一次 Compact Selector 调用

False Negative
→ 永久漏掉真实 Action
```

因此不确定时优先：

```text
MAYBE
```

---

# 20. Compact Action Selector

Performance fallback 输入：

```text
Current Message
Last 1~2 Turns
Current Speaker
Resolved Target Candidates
Small Candidate Catalog
```

若 Candidate 分类不可靠，扩大到相关大类；若仍不可靠，扩大到 Current Available Actions。

禁止：

```text
unknown category
→ no action
```

Compact Selector 一轮最多返回：

```text
0~2 Proposals
```

Performance 本地 + Compact 最终整轮仍受 AE4 统一 0~3 Action 上限约束。

---

# 21. Social / Opinion

## 21.1 Precision Direct Social

Precision 下，普通直接社会语义由 Precision Selector 负责：

- 称赞；
- 感谢；
- 侮辱；
- 威胁；
- 直接爱意；
- 直接友好表达。

Social Local Resolver 不再并行对同一普通对白重复判断。

## 21.2 Performance Direct Social

Performance 下保留 Local Social Resolver，用于 praise、gratitude、insult、threat、direct affection 等低成本社会判断。

## 21.3 Derived Social

所有真实世界事件派生后果由 Social Consequence Engine 负责：

```text
Executed World Event
→ Confirmed Evidence
→ Derived Opinion
→ Derived Relationship
→ Observer Effects
```

Explicit Action 不能被 Social Engine 反向 veto。

---

# 22. O2 Opinion Delta

Precision `changeOpinionOf` 仅允许：

```text
-3
-2
-1
+1
+2
+3
```

| Delta | 语义 |
|---:|---|
| +1 | 轻微赞许 / 普通友善 / 普通感谢 |
| +2 | 明确称赞 / 明显欣赏 / 真诚感谢 |
| +3 | 强烈赞赏 / 强烈情感认可 |
| -1 | 轻微不满 / 冷淡 / 讽刺 |
| -2 | 明确侮辱 / 严重不满 |
| -3 | 强烈羞辱 / 直接威胁 / 强烈仇恨表达 |

重大世界事件的大幅 Opinion 变化由 Social Consequence Engine 产生，不由普通对白直接给出。

---

# 23. D2 Cause-aware Social Dedupe

每个 Social Effect 建议携带：

```text
sourceCharacterId
targetCharacterId
effectType
causeType
causeId
topicKey
turnId
origin
```

`origin`：

```text
explicit_dialogue
derived_world_event
observer_effect
```

规则：

```text
同 cause + 同 effect
→ dedupe

不同独立 cause
→ 可累计
```

Performance / Precision / Derived Social 最终统一进入：

```text
OpinionEffectNormalizer
→ Topic Cooldown
→ Turn Cap
→ Execute
```

Cooldown：

```text
100% → 40% → 0%
```

建议：

```text
单 Direct Cause ≤ ±3
Direct Dialogue Turn Total ≤ ±5
All Social Effects Per Turn ≤ ±10
```

---

# 24. E2 Error Policy

核心原则：

> **网络可以重试，语义不能重猜；非法就拒绝，歧义就拒绝；未知执行结果绝不盲目重放。**

## 24.1 Transport Retry

允许有限 retry：

- HTTP 429；
- HTTP 5xx；
- timeout；
- connection reset；
- temporary provider unavailable。

由 Provider 层统一处理。

## 24.2 Structured Output Failure

若 Q2 JSON / schema 无法解析：

```text
record telemetry
→ no action
```

V7.9.3 初版禁止：

```text
Repair Prompt
Semantic Rescue
Second Judge
```

## 24.3 Invalid Action

Selector 返回当前不可用 Action：

```text
rejected_unavailable_action
```

禁止自动替换成“相似 Action”。

## 24.4 Target

不存在：

```text
rejected_invalid_target
```

歧义：

```text
rejected_ambiguous_target
```

禁止随便选择第一个候选。

## 24.5 Arguments

缺失必填参数：

```text
rejected_missing_argument
```

禁止自动猜默认金额 / 职位等。

超出 schema：直接 Reject，不自动 Clamp 以改变模型原始意图。

## 24.6 Pending

错误 speaker：

```text
rejected_pending_actor_mismatch
```

过期：

```text
rejected_pending_expired
```

当前合法性变化：

```text
rejected_pending_legality_changed
```

## 24.7 Executor

必须区分：

```text
pre_send_failure
confirmed_failure
post_send_unknown
confirmed_success
```

非幂等 Action 在 `post_send_unknown` 时绝不盲目 retry。

---

# 25. M2 Analytics

每个 Proposal 从生成起分配：

```text
proposalId
messageId
engineVersion
mode
origin
```

`origin`：

```text
precision_selector
performance_local
performance_compact
derived_social
```

贯穿 Binding、Validation、Pending、Approval、Executor 全流程。

## 25.1 Runtime Funnel

至少记录：

```text
Detected
Bound
Validated
Pending/Consent
Approved
Executed
```

失败必须带：

```text
failureStage
failureReason
```

## 25.2 关键指标

```text
Action Recall
Trigger Accuracy
Execution Yield
Binding Success Rate
Validation Reject Rate
Pending Resolution Rate
Compact Selector Hit Rate
Provider Calls / 100 Dialogues
Uncached Tokens / Dialogue
Tokens / Executed Action
Uncached Tokens / Executed Action
No Action Rate
```

---

# 26. Ground Truth Benchmark

建议新增：

```text
action-engine-v4-benchmark.json
```

案例结构应支持：

```text
participants
history
message
expectedDetection
expectedActions
expectedExecution
expectedRejectReason
mode
```

每个核心 Action 不能只测一句，至少覆盖：

- Direct；
- Natural；
- Indirect；
- Multi-turn；
- Multi-person；
- Negative；
- Hypothetical；
- Past report；
- Proposal / Acceptance；
- Invalid legality。

---

# 27. P0 Benchmark Actions

V7.9.3 必须优先覆盖：

```text
Payment
Imprison
Injury
Kill
Intercourse
Blood Brother
Lover
Soulmate
Court Position
Council Appointment
Council Dismissal
Mutual Truce
Praise / Opinion
setEmotion
Undress
Scene Change
```

核心 Action 建议每项至少约 10 个以上有效/反例组合，最终 P0 集合约 150~200 cases。

---

# 28. Hard Release Metrics

## Precision

```text
Core Action Recall        ≥ 95%
Overall Action Recall     ≥ 90%
Trigger Accuracy          ≥ 92%
Critical False Positive   = 0
```

## Performance

```text
Core Action Recall        ≥ 85%
Overall Action Recall     ≥ 80%
Trigger Accuracy          ≥ 94%
Fallback False Negative   ≤ 5%
Critical False Positive   = 0
```

---

# 29. P0 Stop-the-Line Blockers

任何阶段发现以下任一问题，直接阻断 Phase / Release：

```text
错误 Action Target
错误支付
错误囚禁
错误杀害
未经 Consent 建立重大关系
非幂等 Action 重复执行
单轮执行超过 3 Actions
AE4 当前消息失败后偷偷调用 AE3
Critical False Positive
```

这些问题不能被“总体 Recall 很高”抵消。

---

# 30. I2 七阶段实施计划

## Phase 1 — AE4 Skeleton

实施：

```text
action-system/v4/
action-engine-v4.js
engineVersion router
mode migration
V2 metadata defaults
analytics skeleton
```

### Gate

必须通过：

```text
AE4 router PASS
AE3 rollback PASS
Balanced migration PASS
Invalid/missing → Performance PASS
Runtime only Performance/Precision PASS
Metadata defaults compatible PASS
engineVersion telemetry PASS
```

---

## Phase 2 — Shared Proposal → Execution Pipeline

先绕过 LLM，人工构造 `ActionProposal`。

测试：

```text
payment
imprison
injury
kill
court appointment
council appointment
council dismissal
relationship transition
truce
setEmotion
scene
```

### Gate

合法 Proposal 必须稳定经过：

```text
Binding
Validation
Approval
Executor
Outcome Recorder
```

若合法 Proposal 都执行不了，禁止进入 Phase 3。

---

## Phase 3 — Precision 4.0

接入：

```text
C2 Available Catalog
P2 Context
T2 Stable Prefix
Q2 Selector
S2 0~3 Actions
```

### Gate

```text
P0 Core Recall ≥95%
Overall Recall ≥90%
Trigger Accuracy ≥92%
Critical False Positive = 0
```

Payment / Imprison / Injury / Kill / Court Position / Council Appointment / Council Dismissal 必须单项通过。

---

## Phase 4 — Pending / Consent

接入 K2。

测试：

```text
Proposal → Pending
Accept → Execute
Reject → Cancel
Deferred → Keep Pending
TTL expiration
Wrong speaker
Third-party acceptance
Mode switching preserve
```

重点 Action：

```text
Lover
Soulmate
Blood Brother
Truce
other consent_required
```

### Gate

```text
Critical Consent False Positive = 0
```

未经同意建立正式重大关系直接判定 Phase 失败。

---

## Phase 5 — Performance 4.0

实现：

```text
ExecutionFormGuard
FastActionResolver
FallbackHintDetector
CompactActionSelector
```

### Gate

```text
Core Recall ≥85%
Overall Recall ≥80%
Trigger Accuracy ≥94%
Provider fallback ≤1/message
Fallback false-negative ≤5%
Critical False Positive = 0
```

---

## Phase 6 — Social / Opinion

实现：

```text
O2
D2
OpinionEffectNormalizer
Cooldown
Turn Cap
Direct / Derived Social split
```

### Gate

必须通过：

```text
Precision praise → Opinion
Performance praise → Opinion
Cooldown
Same-cause dedupe
Different-cause accumulation
Direct delta enum
Direct turn cap
Overall turn cap
Confirmed world-event consequence
Unconfirmed claim ≠ confirmed event
```

---

## Phase 7 — Full Benchmark + Real CK3 Acceptance

必须同时完成：

```text
Unit Tests
Integration Tests
Ground Truth Benchmark
Real CK3 Acceptance Test
```

最终输出完整 M2 报告：

```text
Precision Recall
Performance Recall
Trigger Accuracy
Execution Yield
Binding Success
Pending Success
Per-action Recall
Reject Reasons
Selector Calls
Cache Hit
Uncached Tokens
Tokens / Executed Action
```

满足所有 Gate 后才允许：

```text
V7.9.3 Stable Candidate
```

---

# 31. Codex 实施约束

Codex 在实现 AE4.0 时必须遵守：

1. 不得重新引入多级 Semantic Judge；
2. 不得让 Precision 经过 Candidate Gate；
3. 不得让 Performance Hint Detector 拥有执行权限；
4. 不得使用 Confidence 作为全局执行阈值；
5. 不得让 Social Consequence veto Explicit Action；
6. 不得让 LLM 绕过 Consent；
7. 不得自行猜测歧义 Target；
8. 不得自行补必填 Action 参数；
9. 不得自动替换成“相似 Action”；
10. 不得逐消息 fallback 到 AE3；
11. 不得让一个 Action 的失败拖死无依赖 Action；
12. 不得让 BatchPlanner 承担语言理解；
13. 不得把 Performance Local Resolver 扩张成新的 Semantic Engine；
14. 不得为了降低 API Calls 牺牲 P0 Action Recall；
15. 不得只以“测试通过数量”作为 Stable 判断标准。

---

# 32. 架构冻结后的修改规则

## 允许修改

- 实施过程中发现不可实现的明确冲突；
- M2 Benchmark 证明 Recall / Trigger Accuracy / Binding 有问题；
- CK3 实机证明当前 Safety / Execution 逻辑错误；
- P0 Blocker 修复；
- Token / Cache 优化但不改变核心语义边界。

## 禁止随意修改

- 重新加入 Candidate Gate；
- 重新加入 Semantic Rescue；
- 重新加入 Precision Judge；
- 重新建立 completed/planned/hypothetical 大型 taxonomy；
- 重新引入 Balanced；
- 将 AE3 与 AE4 混合逐消息运行；
- 为追求少量 Token 优化牺牲显式动作 Recall。

---

# 33. 最终架构摘要

```text
                         Dialogue
                            │
               ┌────────────┴────────────┐
               │                         │
          Performance                Precision
               │                         │
       Fast Local Resolver       Available Catalog
               │                         │
       MAYBE → Compact             P2 Context
             Selector                    │
               │                 Full Action Selector
               └──────────┬──────────────┘
                          ↓
                   Action Proposal
                          ↓
                  Reference Binding
                          ↓
                Pending / Consent
                          ↓
                 Proposal Validator
                          ↓
                 ActionBatchPlanner
                          ↓
                       Approval
                          ↓
                      Executor
                          ↓
                 Confirmed World Event
                          │
               ┌──────────┴──────────┐
               │                     │
         Runtime Analytics     Social Consequence
                                     ↓
                              Derived Effects
                                     ↓
                           Social Dedupe / Cap
```

---

# 34. V7.9.3 最终目标

V7.9.3 的目标不是“让 Action Engine 更聪明”，而是：

> **让明确动作重新能够被可靠识别、正确绑定、合法执行，并且任何失败都能准确知道发生在哪一层。**

最终成功标准：

```text
高 Recall
+
低 Critical False Positive
+
正确 Target Binding
+
Consent 安全
+
可诊断
+
Token 可控
+
Prompt Cache 稳定
+
AE3 可整套回滚
```

达到上述标准后，V8 才进入物理清理阶段，删除：

```text
Semantic Rescue
Precision Judge
旧 Stage B
Balanced policy
Legacy pending implementation
旧 AE3 telemetry
以及其他已证明不再需要的 AE3 runtime 组件
```

---

**Architecture Status: FROZEN — Z1**  
**Next Step: Phase 1 — AE4 Skeleton**

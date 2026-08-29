# VOCT-NEW v7.9.3 — Action Engine 4.0 实机前修复清单

> 历史文件：其中 `isInjured` 的 victim/source 示例已被[最终实机前修复清单](VOCT-NEW_v7.9.3_AE4_最终实机前修复清单_含Injury裁定.md)替代；当前正式合同为 VOCT-NEW AE4 项目级 `source=attacker / target=victim`。

## 0. 文档定位

本文件用于修复 v7.9.3 当前静态审查中发现的实机前高优先级问题。

目标不是继续改写 AE4 架构，而是在进入 Phase 7 CK3 实机测试前，完成以下收口：

1. 补全 Precision / Compact Selector 可见的 Action 语义合同。
2. 修正 Benchmark Calculator，避免错误 Action 被计入 Recall。
3. 给 `pending_response` 增加严格 Evidence 校验。
4. 加固 Performance Guard，避免混合句被整句误杀。
5. 加强多人场景 Target 绑定回归。
6. 改善 Opinion Cooldown 的 Topic Identity。

本轮原则：

```text
不重新引入 AE3 Candidate Gate / Event Parser / Semantic Resolver / Rescue / Judge。
不增加逐消息 AE3 fallback。
不增加第二次 LLM 修复调用。
不改变 Performance / Precision 双模式。
不放宽最终本地合法性校验。
```

---

# 1. P1-High：Selector 缺少完整 Action 语义合同

## 1.1 当前问题

当前 Precision Selector 的 Stable Prefix 中虽然包含：

```text
MASTER_COMPACT_ACTION_DICTIONARY
```

但 Compact Dictionary 主要只有：

```text
actionId
executionMode
idempotent
dependencies
targetPolicy
relationshipTransition
```

同时 Available Action Catalog 的序列化结果主要只有：

```text
actionId
sourceCharacterId
targetPolicy
requiresTarget
validTargetCharacterIds
arguments
```

这导致 Selector 没有稳定看到以下关键语义：

```text
Action 是什么意思
source 是谁
target 是谁
Action 的参与者方向
什么情况才算已完成
哪些参数对应什么含义
```

方向敏感动作尤其危险。

例如：

```text
characterIsKilled
source = victim
target = killer
```

如果 Selector 只看到 Action ID，很容易把 source / target 反过来。

---

## 1.2 修复目标

Selector 必须看到一个稳定、紧凑、可缓存的 Action Contract。

建议扩展 Master Compact Action Dictionary：

```ts
{
  actionId,
  shortDescription,
  sourceRole,
  targetRole,
  executionMode,
  targetPolicy,
  requiredArguments,
  optionalArguments,
  relationshipTransition,
  riskLevel
}
```

其中：

```text
shortDescription
```

必须是经过压缩后的动作真实语义，而不是完整原始 description。

---

## 1.3 建议字段

### 示例：characterIsKilled

```json
{
  "actionId": "characterIsKilled",
  "shortDescription": "Source character is killed by target character.",
  "sourceRole": "victim",
  "targetRole": "killer",
  "executionMode": "immediate",
  "targetPolicy": "other_only",
  "requiredArguments": [],
  "riskLevel": "high"
}
```

### 示例：changeOpinionOf

```json
{
  "actionId": "changeOpinionOf",
  "shortDescription": "Change source character's opinion of target character.",
  "sourceRole": "opinion_holder",
  "targetRole": "opinion_target",
  "executionMode": "immediate",
  "targetPolicy": "other_only",
  "requiredArguments": ["value"]
}
```

### 示例：isInjured

```json
{
  "actionId": "isInjured",
  "shortDescription": "Source character becomes injured by target character.",
  "sourceRole": "victim",
  "targetRole": "actor",
  "requiredArguments": ["injuryType"]
}
```

---

## 1.4 Metadata 来源

优先级建议：

```text
actionMetadata.selectorContract
↓
semantic.participantRoles
↓
压缩后的 definition.description
↓
安全默认
```

新增可选 Metadata：

```ts
actionMetadata: {
  selectorContract: {
    shortDescription: "...",
    sourceRole: "...",
    targetRole: "..."
  }
}
```

不要要求一次性给所有 Action 手工补齐。

对于已有：

```text
semantic.participantRoles
```

可直接继承。

---

## 1.5 Catalog 序列化修复

`AvailableActionCatalog.serialize()` 建议增加：

```text
shortDescription
sourceRole
targetRole
```

但不要重复发送所有长 description。

目标是：

```text
Stable Prefix：
Action 的长期语义

Dynamic Catalog：
本轮真正可用的 source / target / args
```

两者职责必须分离。

---

## 1.6 验收标准

必须新增至少以下方向回归：

```text
A 杀死 B
→ characterIsKilled
source = B
target = A

A 刺伤 B
→ isInjured
source = B
target = A

A 给 B 50 金币
→ payment
source = A
target = B

A 对 B 的评价提高
→ changeOpinionOf
source = A
target = B
```

必须同时覆盖：

```text
2 人
3 人
4 人
代词
角色名
“他杀了她”
“她被他杀了”
```

---

# 2. P0/P1-High：Benchmark Calculator 不能把 Wrong Action 算成 Recall

## 2.1 当前问题

当前 Benchmark 中：

```text
detected = true
```

主要根据：

```text
有任意 Action
有 Pending
actual.detected == true
```

判断。

这意味着 Ground Truth：

```text
expected = payment
```

实际输出：

```text
kill
```

仍可能被计入“检测成功”。

这是不可接受的。

---

## 2.2 修复原则

Recall 必须基于：

```text
Expected Action 是否被正确识别
```

而不是：

```text
有没有触发任意 Action
```

---

## 2.3 新增 Match 维度

每个 Case 至少计算：

```text
detectionMatch
actionMatch
sourceMatch
targetMatch
argumentMatch
pendingMatch
executionMatch
```

### detectionMatch

```text
expectedDetection == actualDetection
```

### actionMatch

如果：

```text
expectedDetection == true
```

则必须：

```text
actual.actions 包含 expectedActions
```

才能算 Recall 命中。

---

## 2.4 Stop-the-Line Blocker

必须新增：

```text
wrong_action
wrong_source
wrong_target
wrong_required_argument
unexpected_pending
missing_pending
unexpected_execution
missing_execution
more_than_three_actions
critical_false_positive
legacy_fallback
non_idempotent_duplicate
```

其中以下建议视为 P0 Blocker：

```text
wrong_action
wrong_target
critical_false_positive
legacy_fallback
non_idempotent_duplicate
```

---

## 2.5 Core Recall 与 Overall Recall 必须拆分

当前两个指标不能继续使用同一个 numerator / denominator。

建议：

### Core Recall

只统计：

```text
direct
natural
indirect
multi_person
multi_turn completion
```

不统计：

```text
negative
hypothetical
past_report
proposal
invalid_legality
```

### Overall Recall

统计所有：

```text
expectedDetection == true
```

的 Case。

---

## 2.6 Trigger Accuracy

建议改为：

```text
正确 Action + 正确 Detection 状态
```

而不是单纯：

```text
有动作 / 无动作
```

---

## 2.7 Per-Action Recall 必须进入 Gate

建议阈值：

```text
Precision P0 单项 Recall >= 0.90
Performance P0 单项 Recall >= 0.75
```

关键动作单独提高：

```text
payment
imprison
injury
kill
court appointment
council appointment
council dismissal
truce
```

建议：

```text
Precision >= 0.95
Performance >= 0.80
```

---

## 2.8 Benchmark 最终结构建议

```json
{
  "precision": {
    "coreRecall": 0.0,
    "overallRecall": 0.0,
    "triggerAccuracy": 0.0,
    "perActionRecall": {},
    "wrongActionCount": 0,
    "wrongTargetCount": 0
  },
  "performance": {
    "coreRecall": 0.0,
    "overallRecall": 0.0,
    "triggerAccuracy": 0.0,
    "fallbackFalseNegative": 0,
    "perActionRecall": {}
  },
  "blockers": []
}
```

---

# 3. P1-High：Pending Response 必须验证 Evidence

## 3.1 当前问题

普通：

```text
action_call
```

会经过 Evidence 校验。

但：

```text
pending_response
```

当前主要只验证：

```text
pending 存在
schemaVersion
TTL
speaker == pending.target
response 合法
```

没有强制确认：

```text
evidenceMessageIds
```

是否真的指向当前回答。

---

## 3.2 修复原则

所有：

```text
accept
reject
defer
```

都必须由当前消息直接触发。

所以：

```text
CURRENT_MESSAGE.id
```

必须出现在：

```text
evidenceMessageIds
```

中。

---

## 3.3 推荐规则

对于 `pending_response`：

```text
evidenceMessageIds 必须：
1. 非空
2. 全部属于允许的近期 Dialogue
3. 必须包含 CURRENT_MESSAGE.id
```

不要允许只引用旧消息完成 Acceptance。

---

## 3.4 推荐处理顺序

```text
pending_response
↓
schema validation
↓
evidence validation
↓
pending lookup
↓
TTL
↓
actor == target
↓
accept / reject / defer
```

---

## 3.5 回归测试

必须覆盖：

```text
正确 target + 当前 message evidence
→ PASS

正确 target + 只有旧 evidence
→ REJECT

正确 target + 随机不存在 messageId
→ REJECT

错误 speaker + 正确 evidence
→ REJECT

第三人代替 target 接受
→ REJECT

expired pending + 正确 evidence
→ REJECT
```

---

# 4. P1：Performance ExecutionFormGuard 不应整句误杀

## 4.1 当前问题

Performance 当前基础 Guard 匹配：

```text
如果
假如
不要
别
昨天我
过去我
...
```

命中后会直接：

```text
STOP
```

不会进入 Compact Selector。

对于纯假设句这是正确的：

```text
如果我杀了他会怎样？
→ STOP
```

但混合句可能出现 Recall 丢失：

```text
昨天我还犹豫，今天把他关进地牢。
```

```text
别再废话，把他押入牢房。
```

```text
如果你还敢违抗我——现在就把他关起来。
```

---

## 4.2 修复方向

ExecutionFormGuard 不应该对复杂混合句做过度语义判断。

建议状态从：

```text
ALLOW / BLOCK
```

改为：

```text
ALLOW
BLOCK
MAYBE
```

---

## 4.3 规则建议

### BLOCK

只用于明确整句均为：

```text
hypothetical
question
negative instruction
past report
```

### MAYBE

用于：

```text
同时包含 blocker 词和完成态 / 命令态 Action Signal
```

`MAYBE` 必须允许：

```text
Compact Selector
```

---

## 4.4 Hard Rule

Performance Guard 的职责：

```text
过滤显而易见的非动作内容
```

不是：

```text
替代 LLM 做复杂事件语义判定
```

---

## 4.5 回归用例

```text
如果我给他 50 金币会怎样？
→ BLOCK

昨天我给过他 50 金币。
→ BLOCK

昨天我还不愿意，今天我把 50 金币交给了他。
→ MAYBE / HIT

别再说了，把他关进地牢。
→ MAYBE

不要把他关起来。
→ BLOCK

如果你不服，现在就把他押入牢房。
→ MAYBE
```

---

# 5. P1/P2：多人 Target Binding 必须加强 Benchmark

## 5.1 当前风险

AE4 正常 Q2 路径主要是：

```text
Selector 直接输出 character ID
↓
Validator 检查 ID 是否合法
```

Validator 可以判断：

```text
这个 ID 是否存在
是否在 validTargetCharacterIds
```

但无法判断：

```text
模型是否选错了一个“同样合法”的人
```

---

## 5.2 实机前 Benchmark 必须增加

至少补：

```text
3 人场景
4 人场景
6 人场景
```

并覆盖：

```text
角色全名
简称
他 / 她
前一句明确目标
当前句省略目标
旁观者
第三者插话
当前 speaker 与 target 非邻近顺序
```

---

## 5.3 高风险动作重点测

```text
kill
injury
imprison
payment
court appointment
council appointment
council dismissal
relationship
truce
opinion
```

---

# 6. P2：Opinion Cooldown Topic Identity 改进

## 6.1 当前问题

当前 Direct Opinion Topic 主要基于：

```text
positive:<当前原文>
negative:<当前原文>
```

因此：

```text
你很聪明
你非常有智慧
你的才智令人敬佩
```

可能成为三个不同 Topic。

---

## 6.2 推荐方向

不要恢复 AE3 那种复杂 Judge。

只做轻量本地归一化：

```text
reasonCluster + target + polarity
```

例如：

```text
praise:intelligence
praise:appearance
gratitude:help
insult:competence
threat:personal
```

如果无法稳定归类：

```text
fallback 到 normalized text
```

---

## 6.3 目标

让：

```text
同一原因换措辞
```

仍进入：

```text
100% → 40% → 0%
```

但不同真正语义：

```text
夸聪明
夸勇敢
感谢救命
```

不应被错误合并。

---

# 7. Selector Prompt 修正建议

Precision Stable Rules 建议补充：

```text
PARTICIPANT BINDING
- Follow each Action's sourceRole and targetRole exactly.
- Source and target are Action-contract roles, not grammatical subject/object by default.
- Passive voice does not change the Action contract.
- Never swap source and target merely because one participant is the current speaker.
```

建议新增：

```text
ACTION CONTRACT PRIORITY
1. AVAILABLE_ACTIONS legality
2. Master Action Contract roles
3. Current Message semantics
4. Recent Dialogue only for reference resolution
```

---

# 8. Compact Selector 同步要求

Performance Compact Selector 必须共享：

```text
同一份 Master Compact Action Dictionary
同一份 Q2 Schema
同一份 sourceRole / targetRole
同一份 targetPolicy
```

不得为 Performance 单独维护另一套 Action Contract。

---

# 9. 不允许的修复方式

本轮禁止：

```text
重新加入 Candidate Gate
重新加入 Event Parser
重新加入 Semantic Resolver
重新加入 Semantic Rescue
重新加入 Precision Judge
Malformed Q2 后再进行第二次 LLM 修复
逐消息 fallback 到 AE3
按 Action 名称写大量硬编码特殊例外
```

原因：

```text
AE3 真实失败的主要原因正是多级语义裁决造成 Recall 丢失。
```

---

# 10. 实施顺序

建议严格按以下顺序执行：

1. 扩展 Master Compact Action Dictionary。
2. 暴露 sourceRole / targetRole / shortDescription。
3. Precision Prompt 加 Participant Binding Rule。
4. Compact Selector 同步 Action Contract。
5. 修 Benchmark Calculator。
6. 增加 wrong_action / wrong_source / wrong_target Blocker。
7. 将 Per-Action Recall 纳入 Gate。
8. 修 pending_response Evidence。
9. 加 Performance Mixed-Clause Guard Test。
10. 增加多人 Target Benchmark。
11. 最后再改 Opinion Topic Identity。

---

# 11. 实机前 Hard Gate

以下条件全部通过后才进入 Phase 7：

```text
PASS Precision 每条有效 RP 对白最多且恰好 1 次 Selector Call

PASS Performance 每条消息最多 1 次 Compact Selector Call

PASS Precision / Compact 使用相同 Action Contract

PASS wrong action 不再计入 Recall

PASS wrong target 进入 Stop-the-Line Blocker

PASS pending_response 必须包含 CURRENT_MESSAGE evidence

PASS setEmotion self-target

PASS isUndressed self-target

PASS payment / kill / imprison / injury self-target rejected

PASS multi-person wrong target benchmark 可被识别为失败

PASS mixed-clause Performance 不因单个 blocker 词整句误杀

PASS 无 AE4 → AE3 单消息 fallback
```

---

# 12. Phase 7 第一次实机测试建议

修复完成后，第一轮实机不要马上进行长 RP。

先执行 P0 Matrix。

## Precision

优先测试：

```text
payment
imprisonment
injury
kill
intercourse
blood brothers
lovers
soulmates
court position
council appointment
council dismissal
truce
opinion
setEmotion
isUndressed
changeLocation
```

每个至少测试：

```text
直接完成态
自然表达
被动语态
多人场景
否定
假设
过去式报告
```

## Performance

重点观察：

```text
Local HIT
Hint MAYBE
Compact Selector
Fallback False Negative
Provider Calls
```

---

# 13. 第一轮实机重点记录字段

必须重点采集：

```text
mode
messageId
selectorCalled
selectedActionId
sourceCharacterId
targetCharacterId
arguments
pendingCreated
validationResult
rejectReason
executionStatus
effectWritten
providerInputTokens
providerOutputTokens
cacheHitTokens
uncachedInputTokens
```

---

# 14. 发布判定

v7.9.3 在以下条件满足前：

```text
不得标记 Stable
```

至少达到：

```text
Precision coreRecall >= 95%
Precision overallRecall >= 90%
Precision triggerAccuracy >= 92%

Performance coreRecall >= 85%
Performance overallRecall >= 80%
Performance triggerAccuracy >= 94%

P0 单项 Recall 达标
Stop-the-Line Blocker = 0
真实 CK3 effect 与目标绑定正确
无非幂等重复执行
```

---

# 15. 本轮最终目标

本轮不是进一步增加“判断层”。

目标是把 AE4 当前路线真正完成：

```text
LLM：
负责理解“发生了什么动作”

本地 Catalog：
负责告诉模型“现在什么动作可用”

Metadata：
负责定义 Action Contract

Validator：
负责判断“是否允许执行”

Executor：
只负责执行已经验证的 Proposal

Benchmark：
必须真实反映 Action / Source / Target 是否正确
```

最终原则：

> **High Recall at semantic selection, strict legality at local execution.**

以及：

> **A wrong action is not a successful detection.**

这两条必须作为 v7.9.3 实机前最后修复阶段的核心验收标准。

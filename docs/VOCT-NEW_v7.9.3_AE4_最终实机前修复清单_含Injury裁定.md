# VOCT-NEW v7.9.3 — AE4 最终实机前修复清单（含 isInjured 合同裁定）

## 0. 文档状态

**目标版本：v7.9.3 / Action Engine 4.0**  
**用途：Phase 7 CK3 实机测试前最终收口**  
**性质：Z1 Architecture Freeze 下的实现冲突修正，不新增新的语义层**

本清单替代此前《AE4 二次实机前修复清单》中对 `isInjured` 方向存在歧义的部分。

---

# 1. P0 合同裁定：`isInjured` 不翻转为 `source=受伤者 / target=攻击者`

## 1.1 最终裁定

**选择：保留 VOCT-NEW 当前 AE4 运行合同。**

```text
isInjured

source = attacker
target = victim
effect = applied to targetCharacter
```

禁止按旧修复清单中的错误示例改成：

```text
source = victim
target = attacker
```

因为当前 CK3 执行逻辑将伤害实际施加给：

```text
targetCharacter
```

如果只翻转 Selector / Fixture，而不整体重写 Executor：

```text
受伤者 → source
攻击者 → target
```

最终会导致：

```text
攻击者被真正施加伤害
```

属于 P0 Wrong Target。

---

## 1.2 对“官方 2.0.3”的表述必须修正

不要在实施报告或代码注释中继续写：

```text
“官方 2.0.3 的 isInjured 方向就是 source=attacker / target=victim”
```

该表述不准确。

官方 v2.0.3 的原始合同实际上更接近：

```text
target = injured character
source = not defined as a specific attacker
```

官方描述明确属于：

```text
the injury happens generally, not from a specific source
```

并将伤害效果施加给：

```text
targetCharacter
```

因此 VOCT-NEW 当前：

```text
source=attacker
target=victim
```

应定义为：

> **VOCT-NEW 为 AE4 明确因果绑定而增加的项目级语义扩展。**

不是“完全照搬官方 2.0.3 participant direction”。

---

## 1.3 为什么当前方向仍然应该保留

虽然它是 VOCT-NEW 的扩展，但它与当前 Runtime 是一致的：

```text
Natural language:
A 刺伤 B

Q2:
source = A
target = B

Validator:
source = A
target = B

Executor:
effect → B
```

完整链路一致：

```text
Selector Contract
=
Proposal
=
Validator
=
Executor
=
CK3 actual victim
```

这比把 `source` 与 `target` 反过来更安全。

---

# 2. `isInjured` 的统一 Action Contract

当前版本必须统一为：

```text
actionId: isInjured

shortDescription:
Source character injures target character.

sourceRole:
attacker

targetRole:
victim

requiredArguments:
injuryType

targetPolicy:
other_only   # 当前 v7.9.3 先维持
```

`semantic.participantRoles` 必须同步：

```text
source = actor
target = patient
```

Action description 必须表达：

```text
sourceCharacter 是实施伤害者
targetCharacter 是实际受伤者
```

不得再混用：

```text
source = victim
target = attacker
```

---

# 3. `isInjured` Executor 一致性测试

必须新增 P0 契约测试：

## 3.1 主动语态

```text
阿尔诺刺伤了贝拉。
```

预期：

```text
source = 阿尔诺
target = 贝拉
effect victim = 贝拉
```

---

## 3.2 被动语态

```text
贝拉被阿尔诺刺伤了。
```

预期仍然：

```text
source = 阿尔诺
target = 贝拉
```

被动语态不得交换 Action Contract。

---

## 3.3 代词

历史：

```text
阿尔诺拔出匕首冲向贝拉。
```

当前：

```text
他一刀刺伤了她。
```

预期：

```text
source = 阿尔诺
target = 贝拉
```

---

## 3.4 多人场景

6 人场景：

```text
公爵阿尔诺拔刀刺伤伯爵贝拉。
```

即使其他 4 个角色均为合法 Character ID：

```text
source 必须 = 阿尔诺
target 必须 = 贝拉
```

Wrong Source / Wrong Target 均为 Stop-the-Line。

---

# 4. 暂不在本轮强制重构“无明确攻击者”的 Injury

官方原始 Action 支持更一般的：

```text
“某人受伤了”
```

而 VOCT-NEW 当前合同更强调：

```text
attacker → victim
```

因此以下场景存在语义边界：

```text
“贝拉摔伤了。”
“贝拉在事故中受伤。”
“贝拉突然受了重伤。”
```

本轮不要为了处理这类场景临时：

```text
猜一个 attacker
把 speaker 当 attacker
随机选择 source
重新加入 Semantic Resolver
```

### 当前原则

```text
明确攻击者
→ isInjured(attacker, victim)

攻击者不明确
→ 不得伪造 attacker
```

该类 Recall 数据在第一次 CK3 实机后单独评估。

如果实机证明“无攻击者 Injury”属于高频需求，再另行设计：

```text
environmental / source-optional injury contract
```

不要在 v7.9.3 实机前临时改变核心 participant semantics。

---

# 5. P1-High：修复 Consent Prompt 的 Action Timing 冲突

## 5.1 当前冲突

现有规则同时表达：

```text
只输出 CURRENT_MESSAGE 使其现在可执行的 Action
```

和：

```text
consent_required 的新提议要输出 action_call 来建立 Pending
```

但提议本身并没有让 Gameplay Action “现在可执行”。

这可能让：

```text
“你愿意成为我的情人吗？”
```

被错误返回：

```text
decisions = []
```

---

## 5.2 Precision Prompt 正式改法

使用：

```text
ACTION TIMING

For immediate actions:
- Emit action_call only when CURRENT_MESSAGE makes the gameplay action executable now.

For consent_required actions:
- A newly made explicit proposal MUST emit action_call so the runtime can create Pending.
- This action_call represents a proposal, NOT gameplay execution.
- Target acceptance is NOT required before Pending is created.

For an existing Pending:
- Acceptance, rejection, or defer from CURRENT_MESSAGE MUST use pending_response.
- Never emit a fresh action_call merely to represent acceptance of an existing Pending.
```

---

## 5.3 Compact Selector 同步

Performance Compact Selector 必须使用完全相同的 Consent 规则。

不得出现：

```text
Precision proposal → Pending
Performance proposal → no action
```

这种模式差异。

---

# 6. P1-High：废除 AE4 `isPlayerSource` 参与者重定向

## 6.1 当前风险

Legacy Court / Council Action 中仍可能存在：

```text
isPlayerSource
```

导致：

```text
Q2:
source = NPC

Validator:
source = NPC

Executor:
isPlayerSource=true
→ 实际操作 Player
```

这违反 AE4：

> Participants are immutable after binding.

---

## 6.2 最终规则

AE4 中：

```text
sourceCharacterId
```

是唯一 Source。

需要 Player：

```text
sourceCharacterId = playerID
```

需要 NPC：

```text
sourceCharacterId = npcID
```

Arguments 不得重定向参与者。

---

## 6.3 修改对象

至少检查：

```text
isAssignedToCourtPositionBy
isAssignedToCouncilBy
```

AE4 下：

```text
isPlayerSource
```

必须：

```text
从 Catalog 隐藏 / 删除
Validator 拒绝
Executor 不读取
```

若 AE3 Legacy 仍需兼容，可只在 Engine 3 内保留。

---

## 6.4 新增 Blocker

```text
participant_override_mismatch
```

满足以下条件立即 P0：

```text
Validator source
!=
CK3 actual recipient / actor
```

---

# 7. P1：修正 `multi_turn` Benchmark 的 Historical Replay

## 7.1 错误 Ground Truth

不要继续使用：

```text
历史：
“已经完成支付。”

当前：
“就按刚才已经完成的结果执行。”

Expected:
再次执行 payment
```

对于非幂等动作，这会把正确的“不重放”判成 False Negative。

---

## 7.2 正确 Multi-turn Case

### Payment

```text
Turn 1:
“给伯爵50金币。”

Turn 2:
“好，我现在给他。”
```

### Imprison

```text
Turn 1:
“把伯爵带来。”

Turn 2:
“人到了。”

Turn 3:
“关进地牢。”
```

### Council

```text
Turn 1:
“阿尔诺适合加入内阁。”

Turn 2:
“任命他为掌玺大臣。”
```

### Injury

```text
Turn 1:
“阿尔诺拔刀冲向贝拉。”

Turn 2:
“他一刀刺伤了她。”
```

---

## 7.3 历史已完成动作

以下必须是 Negative：

```text
历史：
“我已经给过他50金币。”

当前：
“记住刚才的结果。”
```

预期：

```text
expectedDetection = false
expectedExecution = false
```

---

## 7.4 Variant 重构

建议：

```text
multi_turn_completion
multi_turn_reference
historical_completed_no_replay
```

Core Recall：

```text
multi_turn_completion
multi_turn_reference
```

Historical Replay：

```text
negative safety set
```

---

# 8. P2：Dynamic Catalog Token 重复

Stable Master Dictionary 已拥有：

```text
shortDescription
sourceRole
targetRole
targetPolicy
```

Dynamic Catalog 如果继续为：

```text
Action × Source
```

重复发送上述字段，会增加 Precision uncached tokens。

### 推荐最终结构

Stable：

```text
actionId
shortDescription
sourceRole
targetRole
executionMode
targetPolicy
requiredArguments
optionalArguments
riskLevel
```

Dynamic：

```text
actionId
sourceCharacterId
validTargetCharacterIds
arguments
```

本项不阻断第一次实机。

先记录：

```text
cachedInputTokens
uncachedInputTokens
Action Tokens / Request
Uncached Tokens / Executed Action
```

再决定是否裁剪。

---

# 9. P2：补齐 P0 Action Metadata

至少检查：

```text
playerPaysGoldTo
paysGoldTo
isInjured
isAssignedToCourtPositionBy
isAssignedToCouncilBy
isFiredFromCouncilOf
changeOpinionOf
changeLocation
intercourse
```

建议统一：

```text
requiredArguments
optionalArguments
selectorContract.shortDescription
selectorContract.sourceRole
selectorContract.targetRole
```

---

# 10. P0 Benchmark Blockers

最终至少保留：

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
participant_override_mismatch
historical_replay
```

必须 Stop-the-Line：

```text
wrong_action
wrong_target
participant_override_mismatch
historical_replay
critical_false_positive
legacy_fallback
non_idempotent_duplicate
```

对于 `isInjured` 特别增加：

```text
injury_victim_mismatch
```

定义：

```text
Q2 target
!=
实际 CK3 被施加 injury trait 的 Character
```

出现即 P0。

---

# 11. 实施顺序

严格按：

```text
1. 固定 isInjured 当前 attacker → victim 合同
2. 删除所有 victim → attacker 的错误 Fixture / 文档要求
3. 修 Precision Consent Prompt
4. 修 Compact Consent Prompt
5. 禁用 AE4 isPlayerSource
6. 修 Court / Council Executor participant override
7. 重写 multi_turn Benchmark
8. 增加 historical replay negative cases
9. 增加 Injury victim mismatch 测试
10. 全量自动化
11. CK3 实机
```

---

# 12. 实机前 Hard Gate

必须全部通过：

```text
PASS isInjured explicit attacker:
     source = attacker

PASS isInjured:
     target = victim

PASS injury CK3 effect 实际落在 targetCharacter

PASS passive voice 不交换 Injury Contract

PASS wrong injury victim → Stop-the-Line

PASS Consent proposal → Pending

PASS Acceptance → pending_response

PASS Court Position 无 isPlayerSource 重定向

PASS Council 无 isPlayerSource 重定向

PASS Q2 source == Executor actual source

PASS historical payment 不重放

PASS historical kill 不重放

PASS multi_turn 是当前完成，不是历史 replay

PASS no per-message AE4 → AE3 fallback
```

---

# 13. 第一次 CK3 实机中的 Injury 专项

必须至少测试：

```text
A 刺伤 B
B 被 A 刺伤
A 砍伤 B
A 弄瞎 B
A 砍断 B 的腿
A 使 B 毁容
```

每条记录：

```text
selectedActionId
sourceCharacterId
targetCharacterId
injuryType
validationResult
executionStatus
effectWritten
actual CK3 victim
```

判定：

```text
actual CK3 victim == targetCharacterId
```

否则：

```text
P0 FAIL
```

---

# 14. 最终裁定摘要

本次关于 `isInjured` 的最终结论：

```text
不要翻转。
```

v7.9.3 保留：

```text
source = attacker
target = victim
```

但文档必须明确：

> 这是 VOCT-NEW AE4 为明确因果 participant binding 所采用的运行合同；官方 v2.0.3 的原始 Action 更偏向“target 受伤、source 非特定攻击者”的通用模型。

因此后续不得再用：

```text
“官方 2.0.3 明确规定 source=attacker”
```

作为理由。

真正的理由应该是：

```text
当前 VOCT-NEW Selector Contract
+
Validator participant binding
+
Executor CK3 effect target
```

三者必须一致。

---

# 15. 最终原则

> **Action Contract 必须以实际 Runtime Effect 为最终一致性约束。**

> **Selector、Validator、Executor 对 participant direction 必须一致。**

> **对于 isInjured，当前 v7.9.3 使用 attacker → victim，不得局部翻转。**

> **Historical completion must never become a replay trigger.**

> **Participants are immutable after binding.**


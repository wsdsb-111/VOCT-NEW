# VOTC v7.9.2 Social Consequence Engine 设计规格

> 状态：设计已确认，尚未实施  
> 核心版本：v7.9.2  
> Action Engine：3.0  
> Memory Engine：2.5

## 1. 目标

V7.9.2 在不恢复高频 Action Provider 调用、不破坏 Chat 稳定前缀和 Memory Engine 2.5 动态召回的前提下，新增独立的 Social Consequence Engine。系统将真实对白和已确认世界事件转换为受约束的好感变化与关系跃迁，并继续通过现有 Action Engine 完成检查、审批和 CK3 效果执行。

最终链路为：

```text
Dialogue / Confirmed Event
          ↓
Social Context Provider
          ↓
Social Meaning + Knowledge Gate
          ↓
Opinion / Relationship
          ↓
Existing Action Validation and Approval
          ↓
Persistent CK3 State
```

## 2. 已确认的范围

- Balanced 保持 v7.8.3 兼容行为，不启用 Social Consequence Engine。
- Performance 使用纯本地社会信号、后果映射和关系强证据规则，不新增 Provider 请求。
- Precision 只在 Social Gate 命中后调用独立 Social Consequence Judge。
- 冷却、递减、去重和临时证据只在当前 Conversation 生命周期内有效。
- Social Engine 复用本轮 NPC 回复生成时已经取得的 Memory Engine 召回，不进行二次检索。
- Social Judge 一次返回最多 4 个 Opinion 和 1 个 Relationship，结果不再逐项进入 Stage B。
- 原 Chat Prompt、Memory Engine 2.5、Money Hotfix、Pending Intent、Action Approval 和普通 Action Engine 行为保持兼容。

## 3. 模块边界

新增目录：

```text
resources/app/out/main/action-system/social/
├─ social-consequence-engine.js
├─ social-consequence-types.js
├─ social-consequence-gate.js
├─ social-context-provider.js
├─ local-consequence-resolver.js
├─ social-consequence-judge.js
├─ consequence-validator.js
├─ consequence-cooldown.js
├─ relationship-transition-graph.js
└─ observer-impact-resolver.js
```

各模块职责：

- `social-consequence-engine.js`：单条真实消息的总编排，不内嵌大段规则。
- `social-consequence-types.js`：统一数据结构、置信度阈值和数量上限。
- `social-consequence-gate.js`：识别值得进入社会后果流程的信号和重大事件。
- `social-context-provider.js`：构建只读 Evidence、参与者、关系、Opinion、知识和近期后果上下文。
- `local-consequence-resolver.js`：Performance 固定映射和极强关系证据。
- `social-consequence-judge.js`：Precision 独立结构化推理。
- `consequence-validator.js`：校验人物 ID、数值、置信度、知识条件、来源和数量。
- `consequence-cooldown.js`：场景内去重、预留、提交、释放和递减。
- `relationship-transition-graph.js`：强制关系状态机。
- `observer-impact-resolver.js`：只为重大事件计算有限旁观者影响。

现有模块边界：

- `conversation.js` 只负责正常对话编排、普通 Action 调用和 Social Engine 入口，不构建 Social Prompt、不推断关系、不扫描 Memory。
- `action-engine.js` 只接受已验证 Social Consequence，继续执行 Action Check、审批、参数校验、确定性调用、去重和 Action Executor。
- `approval-manager.js` 只在动作真实执行成功后发布 Confirmed World Event；拒绝、失效和失败不发布。
- `social-event.js` 只回答“发生了什么社会信号”，不决定具体 Opinion 或关系动作。
- Memory Engine 仍是唯一记忆系统；Social Engine 只读本轮召回快照。

## 4. Evidence 与知识模型

统一 Evidence：

```js
{
  evidenceId,
  type: "dialogue"
    | "confirmed_world_event"
    | "memory"
    | "game_fact"
    | "relationship_state",
  sourceMessageId,
  sourceEventId,
  actorId,
  targetId,
  content,
  confidence,
  worldStateConfirmed
}
```

多人知情状态不保存在单个布尔值中，而按角色记录：

```js
knowledgeMap = {
  [characterId]: {
    [evidenceId]: {
      known: true,
      basis: "current_dialogue"
        | "direct_victim"
        | "witness"
        | "memory"
        | "game_fact"
    }
  }
}
```

事实来源规则：

- Dialogue 能证明感谢、辱骂、威胁、承诺、声明和情感表达真实发生，但不能单独证明声明中的 CK3 世界状态已经发生。
- Confirmed World Event 必须来自成功执行且实际写入效果的 Action Result。
- Game Fact 是当前 CK3 数据明确存在的状态，可作为世界事实。
- Memory 默认只证明该角色记得或相信某事。除非具备可验证的 Confirmed Event 来源，否则 Memory 不能单独把传闻升级为世界事实。
- Relationship State 只用于当前关系和合法跃迁校验。

强因果后果必须同时满足：

```text
worldStateConfirmed == true
AND knowledgeMap[affectedCharacterId][evidenceId].known == true
```

因此，真实威胁可以降低 Opinion，但不能制造死亡事实；谎称杀人不能直接产生杀害近亲的极端后果；已确认杀害若角色不知情也不能影响该角色。

## 5. 临时证据生命周期

NPC 回复生成前已经取得的本轮召回被压缩为只读 Evidence，并按消息 ID 临时保存。Social Engine 不重新调用 `retrieveForResponder` 或 `retrieveTurnRecall`。

```text
Conversation Start
→ temporarySocialEvidenceStore = Map
→ messageId → immutable evidence snapshot
→ Social Context Provider read-only access
→ Social processing / pending approval resolution
→ delete message snapshot
→ Conversation End clears all remaining entries
```

自动动作处理完成后即可释放对应证据。若该消息仍有关联待审批动作，则保留到批准、拒绝、失效或执行失败后释放。该 Store 不落盘、不索引、不搜索，也不成为第二套 Memory Engine。

## 6. 消息与执行数据流

普通消息：

```text
Real Message
→ Normal Action Engine
→ autoApproved / needsApproval / confirmedEvents
→ Social Context Provider
→ Knowledge Gate
→ Social Gate
→ Performance Local Resolver OR Precision Social Judge
→ Direct Consequence Validation
→ Relationship Transition Graph
→ Observer Resolution and Validation
→ Cooldown / Dedupe / Global Caps
→ Validated Social Action Events
→ Existing Action Engine Check / Approval / Deterministic Execute
```

待审批动作：

```text
Pending Action
→ no Confirmed World Event
→ user approves
→ action executes successfully and effectWritten == true
→ Approval Manager emits Confirmed World Event
→ Social Engine reprocesses the associated real message once
```

审批拒绝、审批失效、动作异常或 `effectWritten != true` 均不产生 Confirmed World Event。

Social Action Event 使用 `social:` 前缀。该类 Action 成功后不得再次发布 Social Consequence 事件，防止递归。

## 7. Social Consequence 数据结构

```js
{
  consequenceId,
  conversationId,
  turnEpoch,
  sourceEventId,
  evidenceText,
  directParticipants: {
    actorId,
    targetId
  },
  opinionChanges: [{
    sourceCharacterId,
    targetCharacterId,
    delta,
    confidence,
    reason,
    reasonCluster,
    impactType
  }],
  relationshipTransition: {
    sourceCharacterId,
    targetCharacterId,
    actionId,
    confidence,
    reason,
    reasonCluster
  } | null,
  observerEffects: [],
  inferenceMode: "local" | "precision",
  riskLevel: "low" | "medium" | "high"
}
```

硬上限：

```text
Direct Opinion Changes <= 2
Observer Opinion Changes <= 2
Relationship Transition <= 1
```

## 8. Performance 本地规则

Performance 使用固定整数，不随机选取范围值：

| 社会信号 | Opinion |
|---|---:|
| 普通礼貌正向回应 | 0 或 +1 |
| 赞美、感谢、安慰 | +2 |
| 有意义的帮助 | +3 |
| 救命且已确认 | +5 |
| 接受亲密行为 | +2 |
| 拒绝亲密行为 | -2 |
| 轻微侮辱 | -2 |
| 公开羞辱 | -4 |
| 明确威胁 | -3 |
| 背叛且已确认 | -6 |
| 严重伤害且已确认 | -7 |
| 杀害近亲且角色知情 | -9 |

人物方向由语言行为决定：感谢者提升对帮助者的 Opinion；被赞美者提升对赞美者的 Opinion；被侮辱者降低对侮辱者的 Opinion；明确表达憎恨者降低对目标的 Opinion。参与者无法唯一绑定时拒绝，不猜测。

Performance 关系动作只接受极强证据：

- Friend：双方明确确认成为朋友。
- Best Friend：当前已是 Friend，并明确确认成为挚友。
- Lover：双方明确确认恋人关系；亲吻、拥抱和调情不够。
- Soulmate：当前已是 Lover，并明确确认灵魂伴侣或命定关系。
- Rival：已确认重大伤害、角色知情，并出现不可原谅或持续报复证据。
- Nemesis：当前是 Rival，再发生独立重大冲突，并出现终身极端仇恨。
- Blood Brother：明确结拜并得到双方确认。

## 9. Precision Social Judge

调用必须同时满足：

```text
mode == precision
AND Social Gate positive
AND participants resolved
AND social attitude, major event, or relationship candidate exists
```

输出契约：

```json
{
  "socialImpact": true,
  "opinionChanges": [],
  "relationshipTransition": null,
  "observerEffects": []
}
```

本地阈值：

| 类型 | 最低置信度 |
|---|---:|
| Opinion | 0.80 |
| Friend / Rival | 0.88 |
| Best Friend / Lover | 0.92 |
| Soulmate / Nemesis | 0.95 |

Judge 只能引用 Context Provider 提供的人物 ID，只能选择注册过的关系 Action。模型不能确认世界事件、修改 Knowledge Map、绕过关系状态机或提高数量上限。

## 10. Relationship Transition Graph

```text
Neutral → Friend → Best Friend
Neutral / Friend → Lover → Soulmate
Neutral / Friend → Rival → Nemesis
```

- Neutral 禁止直接进入 Soulmate 或 Nemesis。
- 每个独立事件最多一次关系跃迁。
- Opinion 数值不能自动升级关系。
- 高模型置信度不能绕过当前关系状态。
- 已存在目标关系时拒绝重复执行。
- 冲突关系的移除继续由现有关系 Action 负责。

## 11. Cooldown、递减与去重

场景内 Key：

```text
sourceId + targetId + reasonCluster + sourceEventId/normalizedTopic
```

同一事件或话题的 Opinion 递减：

```text
first = 100%
second = 40%, rounded to integer
third and later = 0%
```

关系跃迁不做 40% 折算，只允许首次合法独立事件执行。独立新事件具有新的 `sourceEventId`，不受旧事件抑制。

冷却条目状态：

```text
reserved → applied
reserved → released
```

待审批后果先预留；执行成功后才提交并计入次数；审批拒绝、失效或执行失败时释放，不消耗次数。

最终去重键：

```text
conversationId
+ sourceEventId
+ sourceCharacterId
+ targetCharacterId
+ consequenceType
+ reasonCluster
```

V7.9.2 不实现完整情绪 accumulator。

## 12. Observer 传播

旁观者影响必须满足：

```text
Confirmed major event
+ observer present or known
+ observer highly related to victim/direct participant
```

Performance 仅使用当前游戏关系可确定的近亲、Lover/Soulmate、Friend/Best Friend、直接受害关系、被点名者或明确反应者。Precision 可在同一次 Social Judge 请求中提出有限 Observer Effect，但仍需通过本地人物白名单、Knowledge Gate 和数量校验。无关旁观者始终为 0。

## 13. Action Engine 执行契约

Validated Consequence 转为内部 Social Action Event：

```js
{
  eventId: "social:<consequenceId>",
  interpretationSource: "social_local" | "social_precision",
  allowedActionIds: ["changeOpinionOf"],
  pendingBinding: { sourceCharacterId, targetCharacterId },
  validatedArgs: { value: -9, reason: "..." }
}
```

Action Engine 必须再次校验 actionId、人物绑定、参数、Action Check 和审批设置。Social Event 明确跳过 Semantic Rescue、Precision Action Judge 和 Stage B。Opinion 与关系动作最终都由现有 Action Executor 执行。

Social Engine 异常、Judge 超时、无效 JSON、无效人物、越界数值或无法确认知识条件时均失败关闭为“无后果”，不得中断人物回复和普通 Action 流程。

## 14. Prompt、Token 与缓存

Social Judge 使用独立稳定前缀，顺序固定：

```text
1. VOTC_SOCIAL_CONSEQUENCE_V1
2. Stable social definitions
3. Stable transition and confidence rules
4. Structured JSON Schema
5. Direct participants
6. Current relationships and opinions
7. Confirmed events
8. Memory Evidence, maximum 256 tokens
9. Two to four relevant real dialogue messages
10. Current message
```

第 1 至 4 项必须保持稳定；所有人物、状态、证据和消息放在动态后缀。Social Prompt 不携带完整 Conversation History、不携带完整 Action Catalog，也不修改 Chat Prompt 与 Memory Engine 的任何既有 block。

成本目标：

- Balanced 新增结构化 Token 为 0。
- Performance 新增结构化 Token 为 0。
- Precision 未命中 Social Gate 时为 0。
- Precision 单次 Social Judge 常规输入目标为 900 至 1600 Token。
- 六人最坏自动化样本单次估算输入不超过 1800 Token。
- 24 条混合对白 Social Judge 不超过 8 次，普通 RP 应更低。
- 一次 Judge 的多个结果全部本地验证和执行，不产生结果级 Stage B 请求。

## 15. Analytics 与 UI

Action Engine 统计新增默认收起的 `SOCIAL CONSEQUENCE` 区块：

- Dialogue Evidence
- Confirmed World Event Evidence
- Memory Evidence
- Knowledge Gate Rejected
- Unconfirmed Claim Rejected
- Local Consequences
- Precision Social Judge Calls
- Opinion Actions
- Relationship Transitions
- Observer Effects
- Cooldown Suppressed
- Diminishing Return Suppressed
- Validator Rejected
- Social Context Build Time

三种动作模式 Token 统计新增 `Social Judge Token / 请求数`。它与 Precision Action Judge、Semantic Rescue 和 Stage B 分栏，且只计入真正发出请求的 Precision 模式。

## 16. 自动化验收

新增测试：

```text
scripts/test-v7.9.2-social-context.js
scripts/test-v7.9.2-social-consequence.js
scripts/test-v7.9.2-social-precision.js
scripts/test-v7.9.2-social-analytics-ui.js
```

测试必须覆盖：

1. 礼貌交流最多产生微小 Opinion，不能成为 Friend。
2. 救命感谢产生 +5，不能成为 Soulmate。
3. 确认杀父、A 知情并明确仇恨产生 -9 和 Rival。
4. 确认杀父但 A 不知情产生 0。
5. Rival 遇到独立极端事件可升级 Nemesis；Neutral 不可直达 Nemesis。
6. 普通亲吻只产生 +2，不能成为 Lover。
7. 明确双向恋爱确认允许 Lover。
8. Soulmate 需要当前 Lover 和极高证据。
9. 公开羞辱只影响直接人物；Precision 仅可有限影响高度相关旁观者。
10. 威胁、谎称、回忆、传闻和失败动作不能升级为已完成世界事实。
11. 单条消息最多 4 Opinion 和 1 Relationship。
12. 重复表达按 100%、40%、0% 递减。
13. 审批前不产生 Confirmed Event；拒绝、失效和失败释放冷却。
14. Social Action 不递归触发 Social Engine。
15. Memory Engine 检索调用次数不增加。
16. Balanced 行为保持不变，Performance Social Provider 调用为 0。
17. Precision 24 条混合对白 Social Judge 不超过 8 次。
18. 3、4、6 人参与者绑定、旁观者和数量上限通过。
19. Social Judge 固定前缀指纹跨消息保持一致，动态内容只出现在后缀。
20. 原 Action、Money、Memory、Dynamic Summary 和缓存回归全部通过。

发布门禁：

```powershell
node scripts/test-action-system.js
node --check resources/app/out/main/main.js
node --check resources/app/out/main/provider-service.js
node --check resources/app/out/main/providers/index.js
node --check resources/app/out/main/ipc/register-ipc.js
node scripts/test-release.js
```

自动化通过后启动 `VOTC.exe` 做启动冒烟。真实 CK3 效果、真实 Provider Token/缓存命中和 3/4/6 人游戏场景必须明确留给实机复验，不能由静态测试替代。

## 17. 版本与文档

- 应用核心版本更新为 v7.9.2。
- Action Engine 保持 3.0。
- Memory Engine 保持 2.5。
- 更新 `README.md`、`CHANGELOG.md` 和 `docs/V7阶段优化记录.md`。
- 不创建或迁移用户 Memory、摘要、配置和 Usage Analytics 数据格式。

## 18. 不做事项

V7.9.2 不实现完整人物心理模拟、人格数值、社会网络传播、派系舆论、复杂情绪曲线、长期恋爱模拟、完整 Reputation System、全局 NPC 舆论扩散或跨对话 Social Cooldown。这些能力留给 V8 之后评估。


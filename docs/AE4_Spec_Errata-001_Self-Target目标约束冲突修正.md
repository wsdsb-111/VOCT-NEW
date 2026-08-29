# AE4 Spec Errata-001：Self-Target 目标约束冲突修正

## 1. 问题定义

当前 AE4 / Z1 冻结规格中存在一处需要立即修正的架构冲突：

原 C2 规格将以下条件作为 Selector 前置 Availability 的全局合法性要求：

```text
source != target
```

但官方及当前 Action Contract 中，部分动作允许角色以自己为目标，例如：

- `setEmotion`
- `isUndressed`

因此，如果继续保留全局 `source != target`，以下合法行为将被前置过滤：

```text
NPC 自己微笑
source = NPC
target = NPC
```

```text
NPC 自己脱衣
source = NPC
target = NPC
```

这会直接导致 P0 必测动作失效，并造成不必要的 Recall 损失。

---

## 2. 修正结论

### 2.1 删除全局 `source != target` 不变量

AE4 不得继续使用以下全局硬约束：

```text
source != target
```

目标是否合法，必须由具体 Action 的元数据决定。

### 2.2 引入 `targetPolicy`

建议在 V2 Action Metadata 中正式增加：

```ts
targetPolicy
```

允许值：

```ts
type TargetPolicy =
  | "other_only"
  | "self_only"
  | "self_or_other"
  | "none";
```

语义定义：

| targetPolicy | 含义 |
|---|---|
| `other_only` | 必须以其他角色为目标 |
| `self_only` | 只能以执行者自己为目标 |
| `self_or_other` | 自己或其他角色均可作为目标 |
| `none` | 该 Action 不需要 Character Target |

---

## 3. Safe Default

所有未显式声明 `targetPolicy` 的 Action：

```ts
targetPolicy: "other_only"
```

这意味着：

- 默认禁止 self-target。
- 不会放宽支付、囚禁、伤害、杀害、关系建立等高风险动作。
- 只有 Action Contract 明确声明时，才开放 self-target。
- 新增 Action 如果漏写 metadata，默认仍采取保守策略。

---

## 4. P0 动作 Metadata 修正

当前至少应明确：

```ts
setEmotion: {
  targetPolicy: "self_or_other"
}
```

```ts
isUndressed: {
  targetPolicy: "self_or_other"
}
```

如果实际 Action Contract 只允许自身执行，则改为：

```ts
targetPolicy: "self_only"
```

具体值必须以 Action 原始合同为准，不允许仅依据语义猜测。

---

## 5. 禁止使用 Action 名称硬编码例外

禁止采用以下形式：

```ts
if (
  actionName === "setEmotion" ||
  actionName === "isUndressed"
) {
  allowSelfTarget = true;
}
```

也禁止：

```ts
if (sourceId === targetId) {
  return false;
}
```

作为全局 Validator 逻辑。

正确形式必须统一读取 Action Metadata：

```ts
switch (action.targetPolicy) {
  case "other_only":
    return sourceId !== targetId;

  case "self_only":
    return sourceId === targetId;

  case "self_or_other":
    return true;

  case "none":
    return targetId == null;
}
```

---

## 6. Shared Pipeline 一致性要求

`targetPolicy` 不得只作用于 Selector Catalog。

它必须贯穿完整 Action Pipeline：

```text
Action Definition / Metadata
        ↓
AvailableActionCatalog
        ↓
Available Target Generation
        ↓
Action Selector
        ↓
Reference / Participant Binding
        ↓
ActionProposalValidator
        ↓
Action.check()
        ↓
Executor
```

任何中间层都不得重新引入无条件的：

```text
source != target
```

约束。

---

## 7. AvailableActionCatalog 修正

Catalog 在构建动作可用列表时，必须读取：

```text
targetPolicy
```

### `other_only`

只生成：

```text
target != source
```

的候选目标。

### `self_only`

只生成：

```text
target = source
```

。

### `self_or_other`

允许：

```text
target = source
```

以及其他合法角色。

### `none`

不生成角色 target。

---

## 8. Selector 输入要求

Selector 不应被要求自行猜测某 Action 是否允许 self-target。

应在 Action Catalog 中直接暴露约束，例如：

```json
{
  "action": "setEmotion",
  "targetPolicy": "self_or_other"
}
```

或者更紧凑地表达：

```text
setEmotion(target: self|character)
```

Selector 只负责理解用户语义与选择动作。

目标是否合法最终仍由本地 Validator 决定。

---

## 9. Validator 修正

`ActionProposalValidator` 必须统一采用 metadata 驱动的 target validation。

建议逻辑：

```ts
function validateTargetPolicy(action, sourceId, targetId) {
  const policy = action.targetPolicy ?? "other_only";

  switch (policy) {
    case "other_only":
      return !!sourceId && !!targetId && sourceId !== targetId;

    case "self_only":
      return !!sourceId && !!targetId && sourceId === targetId;

    case "self_or_other":
      return !!sourceId && !!targetId;

    case "none":
      return targetId == null;

    default:
      return false;
  }
}
```

未知 policy 必须 fail-closed。

---

## 10. Participant / Reference Binding 修正

Reference Binding 层不得因为：

```text
sourceId === targetId
```

直接判失败。

它只负责：

- source 是否可解析；
- target 是否可解析；
- 是否存在角色歧义；
- 是否符合当前 Action 的 `targetPolicy`。

因此：

```text
NPC 自己微笑
```

应允许绑定为：

```json
{
  "source": "npc_123",
  "target": "npc_123"
}
```

如果 Action 为：

```text
setEmotion
```

则合法。

如果 Action 为：

```text
payment
```

则必须在 legality validation 阶段拒绝。

---

## 11. Action.check() 一致性

如果已有单个 Action 自己的：

```ts
check()
```

实现，则必须检查是否存在隐含：

```ts
source !== target
```

逻辑。

处理原则：

1. Action Metadata 是统一的目标策略来源。
2. `check()` 可以执行额外业务合法性验证。
3. `check()` 不得与 `targetPolicy` 相互矛盾。
4. 如果旧 Action Contract 明确支持 self-target，必须修复旧 `check()` 中错误的全局排斥逻辑。

---

## 12. Executor 要求

Executor 不应重新解释 Target Policy。

执行前只需确认：

```text
proposal 已通过 Validator
```

以及 Action 本身最终游戏状态检查通过。

禁止在 Executor 中再次添加：

```ts
if (source === target) reject;
```

否则会形成重复且不一致的合法性判断。

---

## 13. P0 回归测试

必须新增永久回归测试。

### 13.1 Self-target 必须通过

| Action | source | target | 预期 |
|---|---:|---:|---|
| `setEmotion` | NPC_A | NPC_A | PASS |
| `isUndressed` | NPC_A | NPC_A | PASS |

### 13.2 默认禁止 self-target

| Action | source | target | 预期 |
|---|---:|---:|---|
| payment | NPC_A | NPC_A | REJECT |
| imprison | NPC_A | NPC_A | REJECT |
| injury | NPC_A | NPC_A | REJECT |
| kill | NPC_A | NPC_A | REJECT |
| major relationship | NPC_A | NPC_A | REJECT |

### 13.3 非自身目标不受影响

需要确认：

```text
payment NPC_A → NPC_B
imprison NPC_A → NPC_B
injury NPC_A → NPC_B
kill NPC_A → NPC_B
```

在其他合法性条件满足时仍保持可执行。

---

## 14. Selector Recall 回归样例

至少增加以下自然语言测试：

### setEmotion

```text
他笑了起来。
```

预期：

```text
setEmotion
source = current NPC
target = current NPC
```

### isUndressed

```text
她脱下了自己的衣服。
```

预期：

```text
isUndressed
source = current NPC
target = current NPC
```

### payment

```text
他给自己支付了一百金币。
```

即使 Selector 识别出：

```text
payment
source = NPC
target = NPC
```

最终 Validator 仍必须拒绝。

这体现：

> LLM 负责语义理解，本地代码负责游戏合法性。

---

## 15. 规格正式替换文本

原规格：

```text
Selector 前必须保证 source != target。
```

正式替换为：

```text
AE4 MUST NOT enforce a global `source != target` invariant.

Target legality MUST be determined by the selected Action's
`targetPolicy`.

Safe default:

targetPolicy = "other_only"

Self-targeting is permitted only when the Action contract explicitly
declares `self_only` or `self_or_other`.

The same target policy MUST be honored consistently by catalog
generation, target generation, participant binding, proposal
validation, Action.check(), and execution.
```

---

## 16. Z1 Architecture Freeze 影响

该修改属于：

```text
明确架构矛盾 / 不可实现项修正
```

不视为破坏 Architecture Freeze。

不改变：

- C2 Selector 总体架构；
- V2 Metadata 驱动原则；
- Safe Defaults；
- Local Validation；
- 高风险动作安全限制；
- Precision / Performance 双模式方向。

仅修正原先粒度过粗的全局目标约束。

---

## 17. 实施优先级

### P0 — 必须在 AE4 Phase 1 前完成

1. 删除规格中的全局 `source != target`。
2. 增加 `targetPolicy` Metadata。
3. 默认值设为 `other_only`。
4. 为 `setEmotion` / `isUndressed` 按真实 Contract 配置。
5. Catalog 读取 `targetPolicy`。
6. Participant Binding 读取 `targetPolicy`。
7. Validator 读取 `targetPolicy`。
8. 排查 `Action.check()` 中的冲突逻辑。
9. 排查 Executor 中的重复限制。
10. 加入 P0 self-target 回归测试。

---

## 18. Codex 实施要求

在修改代码前，先全仓搜索：

```text
source !== target
source != target
sourceId !== targetId
sourceId != targetId
source === target
sourceId === targetId
```

以及所有语义等价写法。

对每一处进行分类：

```text
A. 真正属于某个 Action 的合法性要求
B. 旧的全局安全假设
C. Participant Binding 限制
D. Catalog / Candidate Target 限制
E. Action.check() 限制
F. Executor 限制
```

只有 A 类可以保留，但应优先迁移至：

```text
targetPolicy
```

其余无条件 self-target 限制必须删除或改为 metadata-driven。

---

## 19. 验收标准

本修正只有同时满足以下条件才算完成：

```text
PASS  NPC 自己 setEmotion
PASS  NPC 自己 isUndressed

REJECT payment self-target
REJECT imprison self-target
REJECT injury self-target
REJECT kill self-target
REJECT invalid relationship self-target

PASS  普通 source != target 动作不受影响

PASS  Catalog / Selector / Binder / Validator / Action.check()
      对同一 Action 的 targetPolicy 判断一致

PASS  未声明 metadata 的 Action 默认 other_only

PASS  未知 targetPolicy fail-closed

PASS  全仓不存在脱离 Action Metadata 的全局
      source != target 硬约束
```

---

## 20. 最终架构原则

本次修正后的目标约束原则正式定义为：

> **Target legality is Action-specific, not global.**

以及：

> **LLM decides what action the utterance means; local metadata and validators decide whether that action is legally executable.**

这两条应作为 AE4 Target Resolution 与 Validation 的长期设计原则。


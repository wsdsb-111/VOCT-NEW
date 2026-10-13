# VOCT V9.3.1 — Provider Usage 与 Action 诊断修复专项

> **文档类型：** 可直接交付 Codex 的设计、实现与验收施工说明（候选稿）
> **阶段定位：** V9.3 Provider Platform 的收口 Hotfix；**不改变** V9.4 PromptPlan & Cache 的路线定义
> **目标基线：** `wsdsb-111/VOCT-NEW` / `main` / `6e232091edb109ccc1e34d26c4b9a120b8a199ba`
> **编制日期：** 2026-10-13
> **依据：** `docs/current/v9/V9_ROADMAP.md` §7.4/§7.5、V9.3 Implementation/Verification/P Issue Ledger、最新 `src/app/main/` 源码
> **状态：** `DESIGN_READY / NOT_IMPLEMENTED`；本文是施工方案，**不表示这些修复已提交、通过测试或通过实机验证**。

---

## 0. 执行摘要与工程决策

本次**只修已确认的 Provider 统计缺陷与已有 Action 分发诊断歧义**，并关闭 V9.3 的最终验收门禁。

1. **P1 / V931-P1-01：Gemini 原生 Usage 信息在 Adapter 被截断。** `GeminiProvider.parseGeminiResponse()` 和 `parseGeminiStreamChunk()` 只保留 `promptTokenCount / candidatesTokenCount / totalTokenCount`，丢失服务端提供的 `cachedContentTokenCount` 与 `thoughtsTokenCount`；统一 Normalizer 虽然支持这些原生字段，但 Adapter 未向下游提供。带思考的响应还会被现行跨厂商 `total === input + output` 校验误标 `INCONSISTENT`。**这是可直接从源码确认的静态缺陷；生产端点影响尚未验证。**
2. **P2 / V931-P2-01：Action 失败分发状态投影歧义。** `ActionEffectWriter.writeEffect()` 抛错时将 `{status:'FAILED'}` 推入 `dispatchRecords`，`runInvocation()` 在 catch 中仅以 `dispatchRecords.length > 0` 推断 `dispatched=true`。必须区分“尝试写入”与“成功接受/送达确认”，保持 `DISPATCH_FAILED`、`success=false` 和禁止重放的原有安全语义。
3. **P1-HOLD / V931-HOLD-01：GLM 长局缓存命中率**不在本 Hotfix 重做 Prompt，不伪造命中率，不修改 `v813`、`glmReasoningEffort`、`glmClearThinking`，按总路线移交 **V9.4**。
4. **发布 Gate：** 当前 `6e23209` 的 [Release Regression](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38350638449) 在本次编制时已为 `success`；它只证明**旧 V9.3 SHA**。V9.3.1 新 SHA 必须重新跑 CI，另补 CK3 实机与 Soak，不得复用旧绿灯宣称新版本验收。

**优先级：Gemini P1 → Usage 全链路验证 → Action P2 → 回归、构建、实机与冻结。** 施工不需要任何真实 API 请求：本阶段首先使用严格离线合成测试。无明确授权及准确价格预算，不进行新付费生成。

### 本阶段不可破坏的事实

- V9.2.3 已退役 `memory4_year` 与 `memory4_life` 的**全部自动模型生成及后台重建**；新增自动 API 请求应为 0。旧档案可合法只读/手改。
- Durable Detail、Owner/Campaign、Forget Tombstone、source revision、Commitment、恢复快照与出站前守卫不可放松。
- DeepSeek Action 两种 Schema delivery、Action/Letter 的 ACK 与幂等门禁、GLM 的 Prompt 与 Thinking 语义、39 个旧 Golden HTTP Body 必须保留。
- V9.3 平台已实现的统一 Facade、三态 Capabilities、严格 FinishReason、`native/estimated/provenance`、取消与最多两次显式尝试不重构。
- 本阶段不引入新数据库、外部日志服务、额外 UI 大型改造、新模型或新的 Provider 调用。

---

## 1. 基线核查与问题复现依据

### 1.1 最新已检查的仓库位置

| 文件 | 已证实的现状 | V9.3.1 范围 |
| --- | --- | --- |
| `src/app/main/providers/index.js` | Gemini 的两处 `usageMetadata` 仅映射三个计数；完整原生元数据被丢弃 | **核心 P1 修改** |
| `src/app/main/providers/usage-normalization.js` | 可读取 `cachedContentTokenCount`、`thoughtsTokenCount`，但校验默认所有 Provider `total=input+output`；`visible_completion_tokens` 还会通用减去 reasoning | **核心 P1 修改** |
| `src/app/main/providers/provider-result.js` | 统一 `native/estimated/provenance` 的入口 | 只做必要兼容核对，尽量不改 |
| `src/app/main/providers/provider-platform.js` | 同步/流式最终结果和事件；只发 reasoning presence，不存思考正文 | 保持，增加端到端测试 |
| `src/app/main/provider-service.js` | `trackUsage()` → `buildUsageRecord()` → `UsageAnalytics`，以及 Diagnostic | 验证全链路，无必要不改 |
| `src/app/main/actions/action-engine.js` | 失败 `{status:'FAILED'}` 进入 `dispatchRecords`；错误 catch 用非空数组作为 `dispatched` | **定向 P2 修改** |
| `scripts/test-v9.3-result-usage.js` | 仅直接测 Normalizer 支持的 Gemini 原生 `usageMetadata`，没证明 Adapter 保留 | 加 RED/GREEN |
| `scripts/test-v9.3-adapter-conformance.js` | 七 Adapter mock 与 SSE、NDJSON、取消等 | 增加 Gemini 原生字段场景 |
| `scripts/test-v9.3-independent-qa.js` | 独立 QA；合成 Gemini 常用 `75+127=202`，未覆盖带 `thoughtsTokenCount` 的转发链 | 增加端到端反例 |
| `scripts/test-manifest.js` | V9.3 releaseChecks 已有 5 组 | 登记 V9.3.1 专项或扩展既有组 |
| `docs/current/v9/V9_3_P_ISSUE_LEDGER.md` | `V93-P2-01` 已记录 Action 投影；GLM HOLD | 追加修复状态与证据链接 |

> 施工前通过 `git rev-parse HEAD` 确认仍以 `6e23209` 为基线。若 HEAD 已前进，先做只读差异核对，再更新本文件的实现定位；**不得机械覆盖新代码**。

### 1.2 Gemini 问题最小反例

假设服务商生成了以下**合成测试值**（非真实账单）：

```json
{
  "usageMetadata": {
    "promptTokenCount": 100,
    "candidatesTokenCount": 20,
    "thoughtsTokenCount": 30,
    "cachedContentTokenCount": 40,
    "totalTokenCount": 150
  }
}
```

当前 Gemini Adapter 只生成：

```json
{"prompt_tokens":100,"completion_tokens":20,"total_tokens":150}
```

由此：

- 原生 `cachedContentTokenCount=40` 丢失，最终不能声明“服务商报告命中了 40”；
- 原生 `thoughtsTokenCount=30` 丢失，`reasoningTokens` 错误表现为 `null`（未报告）；
- `normalizeUsage()` 将 `150 !== 100+20` 标为 `INCONSISTENT`，忽略了候选正文与思考是两种不同计数的事实；
- 通用 `visibleCompletion = output - reasoning` 不能直接用于 Gemini，因为 Gemini 的 `candidatesTokenCount` 是候选输出计数，`thoughtsTokenCount` 独立报告，二者不应在可见正文上重复扣除。

**提醒：** Gemini 字段是否包含在真实响应、缓存读入算入哪个收费桶、不同模型对总 Token 的定义，必须以实际 Provider 返回及官方计费合同为准；不能通过公式推算替代缺失的原生字段。

### 1.3 Action 问题最小反例

```javascript
try {
  const result = ActionEffectWriter.writeEffect(...);
  // 只有确认接受有效命令信封，才可声明“写入成功”
} catch (error) {
  dispatchRecords.push({ status: "FAILED" });
  throw error;
}

// 旧 catch：错误地把有 FAILED 记录看作已经 dispatched
const dispatched = dispatchRecords.length > 0;
```

“`writeEffect` 被调用/抛错”证明**尝试**，不证明游戏已经执行 Effect；未知送达也不能被自动重试。新诊断要保留这个区别。

---

## 2. 施工目标、验收口径与退出标准

### 2.1 功能验收目标

| 编号 | 不可妥协的通过条件 |
| --- | --- |
| G-01 Gemini 原生字段 | Adapter → Facade → Usage Writer → Diagnostics，在 mock non-stream、stream 尾帧、usage-only 帧中保留合法原生 `cachedContentTokenCount` 与 `thoughtsTokenCount`，并明确来源 |
| G-02 正确统计口径 | 合法 Gemini 多组成分的 `totalTokenCount` 不因通用二项相等式误报 `INCONSISTENT`；其他 Provider 的既有一致性门禁不降低 |
| G-03 语义与审计 | `0`、`null/undefined`、字段缺失、无效数值、部分用量、Provider 报告与本地推导必须可区分；不把 `DERIVED` 伪称原生 |
| G-04 可见输出 | Gemini 的 `visible_completion_tokens` 来源是 `candidatesTokenCount`（若有效），不误减独立 `thoughtsTokenCount`；账单/显示层不能把候选计数虚称完整计费输出 |
| G-05 Action 失败状态 | writer 抛错时 `success=false`、无伪造 `commandId`、无成功 ACK；诊断明确 attempted、accepted、confirmed；禁止自动重放 |
| G-06 兼容 | 39 个 Golden 正常出站请求 Body／Header／路径一致；七 Adapter 公共接口与老业务返回字段兼容 |
| G-07 Memory4 | 旧存档与 Durable 正常，Forget/来源校验/Commitment/Letter/Effect 安全测试通过；Year/Life 新自动请求始终为零 |
| G-08 发布 | V9.3.1 专项 PASS、完整 Release Regression PASS、构建/部署一致性 PASS、新 SHA CI PASS、CK3 实机报告签署 |

### 2.2 非目标（明确禁止）

- 不实现 V9.4 的 PromptPlan、缓存锚点重排、`glm_cache_v2` 激活或厂商缓存策略重构。
- 不为修 Gemini 统计而主动启用 Gemini Thinking、改变 `generationConfig`、Schema、SSE 帧语义或消费私有推理正文。
- 不改变 `ActionEffectWriter` 的真实游戏效果写入与 ACK 机制，不跳过任何批准、幂等、金币、关系或其他游戏数据门禁。
- 不删除/迁移玩家存档、旧摘要、Memory4 目录、Pending/Journal/ACK。
- 不为了通过测试降低 `STRICT_STOP`、来源/Forget 校验或去掉失败记录。
- 不假设七种端点已完成真实验证；Gemini/Player2/Ollama 的 V9.3 服务端能力仍属 `NOT_VERIFIED`。

---

## 3. 总体实现设计

```text
Google Gemini API response (mock / future real endpoint)
    ├─ content / finishReason（保持旧语义）
    └─ usageMetadata 原生数值
         ├─ promptTokenCount
         ├─ candidatesTokenCount
         ├─ thoughtsTokenCount
         ├─ cachedContentTokenCount
         ├─ totalTokenCount
         └─ toolUsePromptTokenCount（有则保留，不虚构）
              ↓ 白名单、类型与存在性保留
GeminiProvider.parseGeminiResponse / parseGeminiStreamChunk
              ↓ legacy flat + safe usageMetadata
ProviderPlatformFacade（无明文 reasoning）
              ↓
normalizeUsage(providerType=gemini, 原生/估算/来源区分)
              ↓
LLMManager.trackUsage → buildUsageRecord
              ↓
UsageAnalytics / 受限诊断
```

```text
ActionSandbox → runGameEffect
     ├─ WRITE_ATTEMPTED  ── writer throws ── DISPATCH_FAILED / no ACK
     └─ writer returns valid commandId + accepted status
             └─ DISPATCH_ACCEPTED / WAIT_ACK
                      └─ CK3 readback ── ACK_CONFIRMED（现有模块负责）
```

### 3.1 数据合同约束

**Gemini 用量字段保持分层：**

- `native.inputTokens`：有效的原生 prompt 计数；无则 `null`。
- `native.outputTokens`：当前公共旧合同下的 **Gemini candidates** 数；不能默认为“包含思考的所有输出计费量”。
- `native.reasoningTokens`：有效的原生 thoughts 计数；无则 `null`。
- `native.cachedInputTokens`：有效的原生缓存输入计数；无则 `null`，显式 `0` 仍为 `REPORTED_ZERO`。
- `native.totalTokens`：有效的 Provider 总计数；不得静默重算覆写。
- 额外 `toolUsePromptTokenCount` 若提供，放在受限 `provenance.providerComponents`（或经明确兼容测试的 `native` 扩展），不得混作 Reasoning，也不得当作 0。
- `provenance` 必须能表达原生报告、未报告、非法、推导和厂商多组成分计数；不把某个未知组成量强行填 0。
- 现有日志中只保留计数、枚举及匿名标识。不可记录原始响应全文、Gemini 推理文本或 Token 密钥。

**特别处理 `totalTokens` 一致性：**

- 保留非 Gemini 的现有 `input+output=total` 校验兼容性。
- 对 Gemini 采用 **Provider-specific accounting**：允许 `totalTokenCount` 与 `promptTokenCount + candidatesTokenCount` 不等，尤其当 thoughts/tool-use 等已独立报告或其他组成量未知时。
- 仅在数值明显非法、负数、非有限数、有效 total 比已确认的基础输入/候选计数还小等**能证明不可能**的情况下标记 `INCONSISTENT`。其余未能完整对账的情况记录 `PARTIAL` 或 `UNRECONCILED` 诊断标记，具体采用哪种值以当前公共状态枚举兼容为准；不要随意新建会使老 UI 崩溃的全局状态。
- 不应把 `cachedContentTokenCount` 再加进总 Token：缓存计数表示输入用量的重用维度，不是新生成输出。
- “账单可计算输出”应与“可见候选文本 Token”分别展示。缺少可信服务端计价组件/价格信息时标 `UNKNOWN`，不得写成 `0` 或武断计算节费。

---

## 4. 工作包 WP-00：冻结基线与 RED 测试

**修改目标：** 先写失败的可复现测试，再动运行时源码。

1. `git rev-parse HEAD` 记录 SHA；保留干净的基线备份和 `build/runtime-inputs.json` / 已部署产物校验数据，不包含私有 Provider 配置。
2. 保存 V9.3 已成功的远端 CI 证据，明确它只对应 SHA `6e23209`。
3. 冻结 39 个 Golden HTTP 请求序列化捕获；任何允许的 Body 变更必须事先记录差异理由。本 Hotfix **预期零变化**。
4. 新建 `scripts/test-v9.3.1-gemini-usage.js`、`scripts/test-v9.3.1-action-dispatch-diagnostics.js`；或按仓库既有惯例把用例加入现有 V9.3 组并在 Manifest 注册；推荐保留独立组方便定位。
5. 记录 RED：Gemini Adapter 丢失两个数字；带独立 thoughts 的合法 total 被判 INCONSISTENT；Action writer 抛错但生命周期 `dispatched=true`。
6. RED fixture 只含合成 ID/数值，不接入真实 API，不发送 Effect；记录测试名称、失败断言、命中源代码位置。

**交付：** `docs/current/v9/V9_3_1_BASELINE.md`、原始 RED 证据、Golden SHA 列表。

---

## 5. 工作包 WP-01：Gemini Adapter 无损安全投影（P1 核心）

**目标文件：** `src/app/main/providers/index.js`，聚焦 `GeminiProvider.parseGeminiResponse()`、`GeminiProvider.parseGeminiStreamChunk()`。

### 5.1 提取一个共用的 Gemini Usage Mapper

建议引入不产生网络行为的纯函数（可放 `providers/index.js` 私有 Helper；若拆文件必须登记构建映射）：

```javascript
// 伪代码：功能边界示意，不可未经源码适配直接复制。
function projectGeminiUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== "object") return undefined;
  // 只白名单投影：
  // promptTokenCount / candidatesTokenCount / totalTokenCount
  // cachedContentTokenCount / thoughtsTokenCount / toolUsePromptTokenCount
  // 不要把缺失值改写为0；非法字段交由Normalizer标记INVALID。
  return {
    /* legacy prompt_tokens, completion_tokens, total_tokens (仅有效且存在时) */
    /* usageMetadata: {以上允许的字段与其原始合法数值} */
  };
}
```

**硬约束：**

- **只保存原生数值字段，不复制完整 `usageMetadata` 对象**（防止未来新增敏感/未知结构进入 Diagnostics）。
- 区分字段缺失、显式 `0`、`null` 和 `undefined`；不能以 `value || 0` 处理。需避免生成“缺失字段但有 own-property undefined”影响归一化（V9.3 已修复过这类问题）。
- 有效数值为有限非负整数（或按既有 `usageNumber` 规则统一判定）；遇到负数、NaN、不可解析字符串，不能静默变成 0。若为诊断保留 INVALID 证据，仅保留字段级标志，**不写原始恶意字符串**。
- `usageMetadata` 在无 `candidate` 的 usage-only 帧中仍须成功携带，不能因正文为空而抛错或覆盖前一条有效 Usage。
- 原 `parseGeminiResponse()` 的 `content`、`id`、finishReason 和 SSE parser 行为维持不变。
- 如果上游返回 `thoughtsTokenCount=0`，下游需要正确报告**原生 0**；不得替换为 `UNKNOWN`。
- Gemini Adapter 仅处理数值及标记，不计算金额、不发起重复模型请求。

### 5.2 行为级断言

- Non-stream：`100 / 20 / 30 thoughts / 40 cached / 150 total` 通过 `parseGeminiResponse` 后完整可读。
- Stream：`delta(content)` → 终止 `STOP` → 独立 `usageMetadata` 尾帧；最终累计仅一次，原生数字完整。
- Stream：终止帧带 usage，无独立尾帧；同样可用。
- Stream：usage-only 先于终止帧；不能消失，不能重复求和。
- Stream：缺 finish、部分流中断与 Abort 不会被统计修复误认为 COMPLETE。

**交付：** 同一个 `projectGeminiUsage` 经两条业务调用链证明字段一致；Golden 请求无变化。

---

## 6. 工作包 WP-02：统一 Usage 正确处理 Gemini 多组成分（P1 核心）

**目标文件：** `src/app/main/providers/usage-normalization.js`；必要时极小修改 `provider-result.js` / `provider-service.js`。

### 6.1 Normalizer 设计要求

1. 从 `usageMetadata` 的白名单数字投影中读取 Gemini 原生 `promptTokenCount / candidatesTokenCount / totalTokenCount / cachedContentTokenCount / thoughtsTokenCount`，可选 `toolUsePromptTokenCount`。
2. 维持既有 canonical 结构 `native / estimated / provenance`，使原生 `0` 和 `null` 可区分。
3. 将严格等式 `total == input + output` **限制为适用的 Provider 计数口径**；Gemini 合法的多组成分不能误判。
4. 对有效 Gemini `candidatesTokenCount`，`visible_completion_tokens` 应直接取候选数，**不要再减独立 `thoughtsTokenCount`**。
5. 未报告时不要使用 `total - input` 冒充原生 `reasoningTokens`，也不要把总差值自动记为思考 Token：差额可能有其他组成项或协议含义。
6. 既有 DeepSeek、Zhipu、OpenRouter 的 `cached_tokens` 与推导 cache-miss 规则保持不变；尤其不能让缺失字段重新被解释为 INVALID。
7. 枚举字段、JSON 序列化与现有 UI 兼容；新增的 provider breakdown 放在受限 namespace，不让既有消费者因字段增加而抛错。
8. 当 Provider 返回原生无效数据时 `INVALID`/`INCONSISTENT` 必须可追踪；不能通过丢字段或强行调整 total 来“改善统计”。

### 6.2 合成表驱动测试（必须全部通过）

| ID | Gemini 原生字段 | 期望 |
| --- | --- | --- |
| G01 | prompt100,candidates20,thoughts30,hit40,total150 | Native 100/20/30/40/150；非 INCONSISTENT；visible=20 |
| G02 | prompt100,candidates20,thoughts0,hit0,total120 | 0 原生保留，hit=`REPORTED_ZERO`，reasoning=0 |
| G03 | prompt100,candidates20,total120，无 thoughts/cache | reasoning=null、hit=null、`NOT_REPORTED`，不补 0 |
| G04 | prompt100,candidates20,thoughts30,total170；其余分量未报告 | 保留 170；差额注明未能对账，不伪造缺失组成 |
| G05 | prompt100,candidates20,thoughts30,toolUsePrompt20,total170 | 保存工具提示计数，正常多组成分，不误报 |
| G06 | prompt100,candidates20,thoughts30,total50 | 明显低于已知基础计数，标记异常但不修改原生 total |
| G07 | cached=-1 或 `"bogus"` | 缓存标 INVALID，不推断为 0；其他原生字段仍保留 |
| G08 | thoughts=null / undefined / 缺失 | `NOT_REPORTED`，不要凭空生成 reasoning 数字 |
| G09 | usageMetadata 缺失，只有正文与 STOP | 生成可完成，但 Usage 为缺失/估算；不可冒称原生 |
| G10 | 部分流已有原生 usage 后连接失败 | 已观察数字可保留；最终状态 PARTIAL/ERROR，不记录 COMPLETE |
| G11 | STOP 之后 usage-only 尾帧（含 cache/thoughts） | 最终正确归一化，UsageAnalytics 仅写一次 |
| G12 | 重复相同尾帧与冲突 finish | 不重复累加；冲突状态 UNKNOWN |
| G13 | 非 Gemini `prompt10,completion5,total99` | 继续 `INCONSISTENT`；不得全局关闭等式校验 |
| G14 | Zhipu `cached=0` / OpenRouter `miss:undefined` | 既有 ZERO/UNKNOWN/DERIVED 兼容行为不变 |

### 6.3 流水线端到端验证

```text
Gemini fake fetch response
  -> GeminiProvider
  -> ProviderPlatformFacade.generate
  -> LLMManager.trackUsage
  -> buildUsageRecord
  -> UsageAnalytics.record (spy/mock)
  -> provider-diagnostics (脱敏)
```

断言：每次物理生成仅一份完整 Usage 终态；`native.reasoningTokens` 与 `native.cachedInputTokens` 不丢；`estimated` 不覆盖 `native`；不保存思考正文。可通过模拟/隔离环境，不读取用户应用资料。

---

## 7. 工作包 WP-03：Action 分发诊断的最小语义修复（P2）

**目标文件：** `src/app/main/actions/action-engine.js`。不改 Effect Writer 和 CK3 桥接协议。

### 7.1 明确四个不同的事实

| 事件 | 含义 | 是否证明游戏效果 |
| --- | --- | --- |
| `dispatchAttempted` | VOCT 调用了 `writeEffect()` | **否** |
| `dispatchAccepted` | Writer 返回**有效** `commandId` 和认可的排队/待 ACK 状态 | **否，只证明本地接受** |
| `dispatchStatus` | 诊断兼容字段：NOT_DISPATCHED / FAILED / queued / awaiting_ack 等 | 保持旧 UI 读取合同 |
| `confirmed` | CK3 权威 ACK/回读证明 | **是，须走现有确认路径** |

### 7.2 最小修改策略

- `runGameEffect` 进入调用时记录 `dispatchAttempted=true`；只在 `writeEffect` 返回合法 `commandId + queued/awaiting_ack` 后设置 `dispatchAccepted=true`。
- `writeEffect` 抛出异常或返回不合法信封：`dispatchAccepted` **不得**由非空 `dispatchRecords` 推出；保留 `FAILED` 尝试记录用于审计。
- `runInvocation()` 的 catch 中，`lifecycle.dispatched` 应是**已接受的状态投影**，不得因失败记录存在变成 `true`。`status` 保留合适的 `DISPATCH_FAILED`，否则遵循既有验证/失败路径；绝不能报告 `DISPATCHED` 或 `CONFIRMED`。
- `diagnostic` 可安全新增 `dispatchAttempted`、`dispatchAccepted` 等布尔字段（以现有 DTO builder 是否有白名单为准，必要时改其专用白名单）。**不得改变**旧字段的含义或把 SDK 失败误记 ACK。
- 写入过程可能已部分产生外部副作用但尚未得到命令信封：标记**UNKNOWN/UNCONFIRMED**，保留 Journal/快照，不自动第二次发送。不能把没有 ACK 的异常归并成“明确未送达”，也不能凭空重建 `commandId`。
- 真正已接受但后续 sandbox 出错：不得简单置回 `NOT_DISPATCHED`；保留接受证据与原状态，保证后续 ACK 不丢失，避免误重放。
- `dryRun` 必须保持零 Effect、零 ACK；自动审批、人工批准与金币相关路径的参数、幂等键不变。

### 7.3 Action 回归矩阵

| ID | 场景 | 期望 |
| --- | --- | --- |
| A01 | Writer 抛错（尚无有效命令信封） | attempted=true, accepted=false, success=false, 无 commandId/ACK, `DISPATCH_FAILED`（兼容状态） |
| A02 | Writer 返回 `{status:'FAILED'}` | 同 A01；不可仅因存在结果对象就当成功 |
| A03 | Writer 返回 `{status:'queued',commandId:合法}` | accepted=true, 等待 ACK；不宣称已执行 |
| A04 | Writer 返回 `{status:'awaiting_ack',commandId:合法}` | accepted=true, 保留 ACK 读取链 |
| A05 | Writer 返回 queued 但缺 commandId | 拒绝、无伪造成功；保留未知送达证据 |
| A06 | Sandbox 在 Writer 成功接受后出错 | 保留已接受证据，不重复 Effect |
| A07 | 取消/旧 Epoch/旧 Conversation | 不得重放；Source/ACK 约束仍有效 |
| A08 | `dryRun` | zero write, zero command, zero ACK |
| A09 | 金币/关系与信件现有专项 | 与 V9.3 Gold/Official Action/Letter 回归一致 |

**警告：** 当前问题 P2 是诊断投影，不是已确认的重复游戏效果问题。不能借修复诊断扩大 Action 生命周期范围。

---

## 8. 工作包 WP-04：合成安全验证与横向 Provider 保真

1. 逐项运行 `test-v9.3.1-gemini-usage.js`、`test-v9.3.1-action-dispatch-diagnostics.js`，RED→GREEN 证据单独保存。
2. 运行：

```bash
node scripts/test-v9.3-result-usage.js
node scripts/test-v9.3-adapter-conformance.js
node scripts/test-v9.3-independent-qa.js
node scripts/test-v9.3-provider-capabilities.js
node scripts/test-v9.3-cancellation-retry.js
```

3. `scripts/fixtures/v93-provider-golden.js` 逐场景重放原 **39** 个序列化 Golden；**不修改基线文件掩盖差异**。Gemini 修复仅调整解析和用量，不应改出站请求字节。
4. 测试所有七种 Adapter 的 `0 / undefined / null / bad / -1` 使用量输入；保留真实 Provider 字段与估算值来源区别。
5. Memory4 既有 Forget、Durable、History/Legacy 召回、Commitment、Letter、Action/ACK 专项继续通过；Year/Life 永久自动请求计数为零。
6. 对流式提前退出、Abort、尾包延迟、部分输出、未知 Finish、500/429/503、Retry-After 超限做回归；SDK 隐式重试继续 0，显式总 attempt ≤ 2。
7. `Provider` 接口字段的细微调整必须与已发布老数据做向后兼容测试。

**Gate：** 任意跨 Owner 数据读取、Forget 出站、未知 Finish 触发 Effect、重复 ACK/Effect、Year/Life 复活，立即判 P0 阻断，保留事故证据。

---

## 9. 工作包 WP-05：构建、发布与实际 CK3 验收

### 9.1 推荐施工提交划分

| Commit | 内容 | 可独立回滚性 |
| --- | --- | --- |
| C0 | V9.3.1 基线、Goldens、RED 验收测试 | 是，无运行时行为变更 |
| C1 | Gemini Usage Adapter + Normalizer + 完整流/非流测试 | 同一逻辑单元回滚（Adapter/Normalizer必须一起） |
| C2 | Action 诊断语义最小修复 + Action 专项 | 不影响 Gemini；但需连同诊断 DTO/测试一起回滚 |
| C3 | 完整回归、构建、验证报告与台账更新 | 文档/证据，无业务新功能 |

**不要**将七种 Provider 再次整体重构，也不要把 V9.4 功能偷偷塞入本提交。

### 9.2 统一测试命令（以仓库脚本及平台环境为准）

```bash
node scripts/test-v9.3.1-gemini-usage.js
node scripts/test-v9.3.1-action-dispatch-diagnostics.js
node scripts/test-release.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
git diff --check
```

顺序在 Windows 上遵循现有 Build/Verify/Deploy 规范与项目 `AGENTS.md`；不要并发测试正在修改的构建输入与部署目录。所有生成 `resources/app/out/main/...` 模块必须由对应 `src/app/main/...` 构建而来，不能手工只改编译结果。

### 9.3 实机 Gate（需用户执行，未执行前保持 NOT_VERIFIED）

**一场三人 CK3 对话，不需要大规模刷 Token：**

1. GLM 或当前真实主力模型完成数轮 Chat；不得为了测试 Gemini 修复而强行切换主力 Provider。
2. DeepSeek Action 触发一次安全、可逆/可核对的游戏动作，观察 `queued / awaiting_ack / ACK` 与没有重复执行；另在隔离环境用 mock 故障注入验证 `FAILED` 诊断。
3. 最终摘要、Durable、长期记忆回读、跨年历史召回正常；`memory4_year`、`memory4_life` **0 次新增自动请求**。
4. 对话中取消一次、重新打开对话一次；确认没有部分流被宣布成功，确认 pending/ACK 不丢失。
5. 以现有诊断导出记录用量与失败分类：不包含 Prompt 全文、Api Key、私人记忆正文与 reasoning 正文。
6. 在不影响真实存档的隔离 profile 执行 Provider 平台打包冒烟与连续运行观察；记录异常、模型费率/未知费率情况。
7. Gemini 真正端点验证**可选、需明确独立授权及实时价格预算**；未执行则继续标 `Mock PASS / Endpoint NOT_VERIFIED`，不得阻挡纯离线修复的完成，但不得宣传已完成真实 Gemini 服务端验证。

### 9.4 费用控制

- **默认新增真实 API 调用：0**。Red/Green、Adapter、Parser、Action 负例全部 Mock。
- 任何付费探针必须先另设预算、确认所选路由与实际计费结构、设置累计硬上限与每次保守预留、不得复用 V9.3 已过期的 USD1 实验许可。
- Gemini 缓存输入与思考计费**不**以 UI 简单“命中率”或推算数值代替，原生缺失时一律 `UNKNOWN`。
- 仅为排查统计而新启用 Life/Year 或重复生成 Action/Letter/Durable，视为施工失败。

---

## 10. 工作包 WP-06：验证报告、问题台账、版本与冻结

### 10.1 必需交付

```text
docs/current/v9/
  V9_3_1_BASELINE.md
  V9_3_1_IMPLEMENTATION_REPORT.md
  V9_3_1_VERIFICATION_REPORT.md
  V9_3_1_P_ISSUE_LEDGER.md
  V9_3_1_HANDOFF_TO_V9_4.md
  v931-conformance-evidence.json     # 仅匿名合成、统计、哈希、状态
scripts/
  test-v9.3.1-gemini-usage.js
  test-v9.3.1-action-dispatch-diagnostics.js
```

文件命名可遵循仓库现有惯例微调，但每个 Gate 必须有清晰可审计的证据。原版 `V9_3_*` 证据不可覆盖；新报告明确基础版本 SHA、修复 SHA、CI run URL 和实机状态。

### 10.2 发布判定

| Gate | 可接受状态 |
| --- | --- |
| G0 基线 / RED | PASS |
| G1 Gemini Adapter 字段 | PASS |
| G2 Gemini Normalizer / 多组成分 | PASS |
| G3 Action 尝试 vs 接受诊断 | PASS |
| G4 七 Adapter Golden / 业务安全 | PASS |
| G5 本地 Release / Build / Deploy | PASS |
| G6 **最新 SHA** GitHub CI | PASS |
| G7 CK3 三人对话 / Durable / Action / Letter | PASS 后方可 `FULL_FREEZE`；否则 `CANDIDATE` |
| G8 Gemini 真实 Endpoint | 未获授权可 `NOT_VERIFIED`，不可写成 `NATIVE_PASS` |
| G9 GLM 长局缓存 | `P1-HOLD → V9.4`，非 V9.3.1 冻结的性能改善 KPI |

**版本号管理：** 代码与文档以 V9.3.1 施工候选标记；不得根据提交消息擅自断言 Core/UI/App 已变成 9.3.1。正式运行版本沿用基线约束，待 CI + 实机 + 发版决议后统一调整；Git 标记、Changelog、App、Core/UI、打包回执需要一致，必要时单独 release commit。用户仍自行推送，方案不会自动改仓库。

### 10.3 问题台账（实施前均未关闭）

| 编号 | 严重度 | 问题 | 当前状态 | 关闭证据 |
| --- | --- | --- | --- | --- |
| V931-P1-01 | P1 | Gemini 缓存/思考 Usage 在 Adapter 丢失，`total` 校验错误 | **OPEN** | Adapter/Normalizer/Writer mock e2e RED→GREEN |
| V931-P2-01 | P2 | Action FAILED dispatchRecord 被错误投影为已分发 | **OPEN** | `runInvocation` 精确故障注入与 ACK/Effect 回归 |
| V931-HOLD-01 | P1-HOLD | GLM 长局服务商缓存零命中 | **HOLD** | V9.4 独立样本和前缀证据 |
| V931-GATE-01 | Gate | 最新 SHA 的 CI/CK3 未验证 | **OPEN** | Run URL + 三人对话验收记录 |
| V931-NV-01 | 非缺陷 | Gemini/Player2/Ollama 真实端点尚未验证 | **NOT_VERIFIED** | 独立授权后再验证 |

---

## 11. 风险、回滚、禁止项

| 风险 | 可能后果 | 控制方式 |
| --- | --- | --- |
| 对 Gemini 的 `completion_tokens` 重定义 | 老 UI 统计与历史数据字段含义不一致 | 保留旧 candidates 字段语义；新增带来源的 breakdown，不静默更改旧字段 |
| 对其他厂商关闭总量一致性 | 真正错误的账单数据不被发现 | 只在 Gemini 专属分支处理多组成分；其他 Provider 原 Gate 保持 |
| 把 `total-input` 都当思考计数 | 伪造 reasoning/计费信息 | 只能读原生 `thoughtsTokenCount`；缺失记 null |
| Gemini usage-only 尾帧覆盖已知用量 | 本地统计错漏或重复 | 统一流式事件合并、单次落账、冲突 UNKNOWN 测试 |
| Action 失败被设为明确未发送 | Writer 已部分执行导致二次重放 | 区分尝试与接受；未知状态 fail-closed，不自动重试 |
| 修改 ActionEffectWriter 协议 | ACK/金币/关系等游戏副作用异常 | 本次禁止修改物理写入与 ACK 权威逻辑 |
| 为追求缓存率改 GLM Prompt | NPC 记忆与实时状态回归 | GLM 不改，记录 V9.4 移交 |
| 编译产物与源码不一致 | 用户运行版本不是测试版本 | 严格 build → verify → deploy → verify --deployed |
| 直接回滚覆盖存档 | Memory/Journal/Letter 数据丢失 | 仅应用完全退出时回滚**受验证的源码与生成资源**；用户数据只备份不覆盖 |

**回滚原则：**

1. Gemini 修复出问题时回滚 Adapter + Normalizer + 相关消费端**同一兼容单元**；不可只还原一层造成结构不匹配。
2. Action 修复出问题时仅回滚 Action 诊断投影与 DTO 兼容层，不覆盖 Effect/ACK/游戏数据。
3. 回滚必须关闭 Runtime、验证 Git SHA 与 build manifest、重新构建并记录 deployed hash；不删除已存在的 Pending/ACK/Journal/Forget。
4. 若发现 Memory4 越权、Forget 泄漏、Effect 重放或数据丢失，直接停止新请求与对应发布，保存最小脱敏证据，优先恢复安全路径。

---

## 12. Codex 直接执行指令

将下面作为施工任务输入（与本文一起交给 Codex）：

> 以 GitHub `wsdsb-111/VOCT-NEW` 的 V9.3 SHA `6e232091edb109ccc1e34d26c4b9a120b8a199ba` 为基线，先确认本地 HEAD 并核对当前源码，再严格实施本文件《V9.3.1 Provider Usage 与 Action 诊断修复专项》。先写 RED 测试：Gemini Adapter 丢失 `thoughtsTokenCount`/`cachedContentTokenCount`、Gemini 多组成分 `totalTokenCount` 被错误标记、Action writer 抛错仍投影 `dispatched=true`。按 WP-00→WP-06 分阶段最小修改；禁止更改 V8.13/GLM Prompt、Year/Life 退役、Memory4/Forget 权限、Action/Letter ACK 或游戏效果。保留 39 个 Golden 请求字节等价；测试必须证明 `native/estimated/provenance` 与单次记账。不要自动付费请求，不要操作真实存档/凭据。完成后运行独立专项和 `node scripts/test-release.js`，执行源码构建、验证、部署和一致性校验；产出实施报告、P 问题台账、V9.4 移交与新 SHA 的待完成 CI/实机门禁。未经用户要求不要自动推送或改正式版本号。

---

## 13. 最终成功定义

V9.3.1 成功不是“又提高缓存命中率”，而是以下事实能够被重复验证：

1. **Gemini 正确保留 Provider 真正报告的缓存、思考与总 Token 数据**，不把未知值变成 0、不把有效多组成分标为不一致、不伪造账单可计费量。
2. **Action 的写入尝试、成功接受、等待回执和游戏已确认执行各有独立证据**，失败没有被诊断为成功，也不导致重复 Effect。
3. **V9.2.3 的成本治理与长期记忆仍然有效**：Life/Year 自动调用为零，Durable、Detail/Legacy 召回与 Forget 安全不退化。
4. **V9.3 的七种 Provider 合同和旧出站序列化完全兼容**，所有新增问题有 RED/GREEN、CI 与实机门禁证据。
5. **GLM 缓存仍作为 V9.4 的独立问题处理**，不能因本 Hotfix 而错误宣称已经修复。

> **文档结论：** V9.3.1 是 V9.3 Provider Platform 的小范围正确性和安全诊断补丁；补丁验收后关闭本阶段已确认 P1/P2 缺陷，才进入 V9.4 的 PromptPlan 与缓存专项。

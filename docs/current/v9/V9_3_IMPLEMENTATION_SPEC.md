# VOCT V9.3 — Provider Platform 详细设计与施工方案

> 文档状态：**施工设计（待 Codex 实施）**
> 制定日期：2026-10-13
> 项目：`wsdsb-111/VOCT-NEW`
> 基线 HEAD：`e1c3c37c89d8001f995593bc1c287a9c0d63a31f`（V9.2.3 C7）
> 唯一阶段定义：`docs/current/v9/V9_ROADMAP.md` **§7.4 V9.3：Provider 平台**
> 前阶段移交：`docs/current/v9/V9_2_3_HANDOFF_TO_V9_3.md`
> 目标版本：**V9.3**（何时更新 App/UI 版本号以最终发布门禁为准）
> 施工总原则：**行为等价优先、成本优先、安全优先、失败不伪造、逐 Provider 迁移、每一步可回滚**。

---

## 0. 一页执行摘要

### 0.1 本阶段要解决的问题

在保留 VOCT 现有 Chat / Action / Summary / Durable 行为的情况下，建立可核验的统一 Provider 平台：

1. 规范七个已存在的 Provider Adapter：`player2`、`openrouter`、`openai-compatible`、`ollama`、`deepseek`、`gemini`、`zhipu`。
2. 建立模型/端点/路线维度的 **Capabilities**；区分 **确定支持、明确不支持、未经验证**，不得将推断当事实。
3. 同一套语义支持 **非流式生成**与**流式生成**，含 Usage-only 尾块、部分输出、提前取消、结束理由。
4. 标准化 **Structured Output、Generation Result、Usage、Reasoning、FinishReason**。
5. 标准化 **取消、超时、429/5xx、Unsupported**；重试有预算、可取消且不能造成副作用重放。
6. 构建离线 Conformance Fixture、可控 Mock Server 及小规模真实 Provider 验收，以证据限定支持范围。

### 0.2 V9.2.3 基线——不可回归

| 已完成内容 | V9.3 合同 |
|---|---|
| Life/Year 自动 LLM 生成退役 | **永远不得因 Provider 重构重新启用**；正常/恢复/信件/Legacy 等路径 `memory4_life`、`memory4_year` 新增自动请求均为 **0** |
| Memory4 Durable Detail 正常 | Finalization、Owner/Campaign、Forget、source revision、KnownBy、Commitment、持久化与恢复全部保持 |
| 多年历史检索正常 | 保留 Detail、Legacy、有效旧 Year/Life 的只读兼容；不要增加额外按年生成任务 |
| V9.2.2 出站前 Forget Guard | 所有受保护的非流式发送、等待 capabilities 后、429/5xx 重试前都必须继续检查；失效证据不可再次送出 |
| `SKIPPED_DERIVED_POLICY` typed skip | 不能假装 `COMPLETE`，不能把 Durable 失败误判为成功；Letter 状态仍需完整标记 `generated:false, providerRequests:0` |
| GLM 真实长局缓存仍不稳定 | **HOLD**，不以本阶段修复 43.1%/36.8% 命中率作为 Gate；不得为了缓存改写 v813 Prompt |
| 原生缓存 Usage | 原生 `cached_tokens=0` 与 UNKNOWN 必须区分；不把 App 估算记为厂商原生命中 |
| 先前 V9.2.3 测试 | 本地 427/427；远端 CI 对 `e1c3c37` 已 Success；用户反馈实机退役/召回/Durable 正常。新提交须重新验证，**不得沿用旧 SHA 的绿灯** |

### 0.3 不做（防止阶段偏离）

- **不做 V9.4**：不实施 PromptPlan V9、全局 Stable Prefix 重排、厂商缓存 Serializer 重写、自动 cache warming、GLM 强制预热或历史转写。
- **不做 V9.5**：不大改 UI 组件体系、不开始中英文 UI、主题与整体布局翻新。
- **不做 V9.6**：不修改 CK3 Bridge / DATE / Action ACK / Letter Protocol，也不将独立 Three-Mod 工程回迁。
- 不实施 Memory5、SQLite、Year/Life 重新生成、NPC 自主玩法、重大 Token 剪裁。
- 不假设七种 Provider 对所有能力都可用；“有配置入口”与“该端点已验证支持”不是一回事。
- 不为了消灭 UNKNOWN 虚构 usage、finish reason、structured success 或网络送达。

---

## 1. 核验过的项目现状及源文件地图

### 1.1 权威源码与验证入口

- **正式可编辑源**：`src/app/`。
- **生成产物**：`resources/app/out/`，必须通过现有 Source Build/Manifest/Deploy 管线生成；禁止只手改 `resources/app/out`。
- `src/app/main/provider-service.js`：`ProviderRegistry`、`LLMManager`、路由配置、capabilities、`sendChatRequest` / `sendActionsRequest` / `sendSummaryRequest`、`trackUsage`。
- `src/app/main/providers/index.js`：当前七个 Provider 的混合实现（约 2019 行）；各有 `chatCompletion`、列表、请求序列化、Stream/Nonstream、错误路径。
- `src/app/main/providers/request-budget.js`：context window、max output、估算预算；当前已有 `source/outputSource`，但不是完整能力矩阵。
- `src/app/main/providers/usage-normalization.js`：cache hit、miss、reasoning 等字段归一化。
- `src/app/main/providers/generation-outcome.js`：有限的 `finish_reason` / 截断和完成判定。
- `src/app/main/prompts/provider-prompt-adapter.js`：旧 Prompt 的 Provider 适配点，**不在 V9.3 全面重写布局**。
- `src/app/main/analytics/provider-diagnostics.js`、`usage-analytics.js`、`real-request-diff.js`：脱敏诊断与原生 Usage 对账。
- `src/app/main/memory-system/memory4-coordinator.js`、`memory4-derived.js`、`letter-memory-finalization.js`：受保护请求以及已退役派生路径的核心回归目标。
- `src/app/main/config/settings-repository.js`、`secure-provider-secrets.js`：配置读取、凭据安全和用户既有参数兼容。

### 1.2 当前不是空白工程

已经具备 Provider Registry、七个 Adapter、以 Route 区分的 Chat/Action/Summary、可配置模型、请求预算、DeepSeek 的 Action Schema 模式兼容、Zhipu 的 `reasoning_effort` / `thinking.clear_thinking`、Gemini Usage 转换，以及 Durable request trace/Forget guard。这些都应**被收编进新合同**，不是全部推倒重做。

### 1.3 需重点验证的现有差异（审查发现，尚不等于已复现故障）

| 发现 | 当前代码表现 | V9.3 处置 |
|---|---|---|
| Capabilities 过于偏向 token 预算 | `getProviderCapabilities` 主要返回 context、maxOutput、tokenizer、来源；缺少 stream/JSON/reasoning 等支持状态 | 建能力矩阵，支持状态 tri-state；无证据不自动宣称支持 |
| 能力查询存在异步窗口 | `getProviderCapabilities` 可远端 `listModels`，缓存约 5 分钟 | Abort/超时覆盖查询等待；Durable 真实传输前校验不能上移失效 |
| Usage 缺失时补估算 | `buildUsageRecord()` 可生成 `votc_estimated:true` | 原生/估算双通道，业务回调可有估算，但厂商费用/缓存不得显示为真实上报 |
| FinishReason 映射不全 | `validateGenerationOutcome()` 仅少量值分类，未知原因有机会落到 `complete:true` | 未知不得通过严格完整性门禁；保留原值和 normalized 枚举 |
| 流式 Usage 仅在正常耗尽迭代后记账 | `trackUsage()` 用 generator return 取得最终 response | 取消/部分流事件需要明确终态与 usage UNKNOWN；不得写成功完整记录 |
| 流式取消行为不一致 | OpenRouter 流式建连调用未见 signal 传入 SDK；Ollama 流式 `fetch` 未见传入 request.signal | Provider 分别加可控 mock 负例，不影响原有输出排列 |
| 重试分散 | `BaseProvider.retryWithBackoff` 使用延迟和 3/7 次历史尝试；部分调用无取消信号参与等待 | 预算优先、支持 Abort、只重试可确认安全的阶段，取消不得再发一次 |
| Gemini SSE 错包处理 | 部分 malformed SSE 被警告并跳过 | 严格区分可忽略心跳与损坏正文帧，缺失终态时不得伪造 stop |
| 结构化能力与 Schema 策略不同 | DeepSeek 通过 `json_object` +（视 mode）Schema 注入或本地验证；Gemini 将 Schema 转成子集 | 保留各厂商已验证行为，标出 Native / Emulated / Unsupported / Unknown |
| 出站诊断隐私 | 曾有 verbose 记录 Prompt/配置的遗留调试路径 | 发布默认禁止记录原文/Key；脱敏负例必须检查导出和 error body |

上述均应先增加 RED/对照测试，再实施局部修复；不得将静态审查发现直接写为已经发生的线上事故。

---

## 2. V9.3 架构与职责边界

### 2.1 目标依赖

```text
Conversation / Action / Letter / Memory4 Durable
                  |
            existing Service Ports
                  |
                LLMManager
         (route + budgets + trace)
                  |
           ProviderPlatformFacade
       /          |            \
Capabilities   RequestPolicy    NormalizedResult
       \          |            /
           Provider Adapters (7)
                  |
       SDK / fetch / provider endpoint
```

Provider 平台**不应**知道 Memory4 Entry 正文的读写结构、Campaign 权限算法或 CK3 Effect 语义。它只接受已经过业务授权的 Prompt、route、请求元数据、可撤销 guard 和取消信号。

### 2.2 迁移模式：Strangler/Adapter First

1. 不删除 `sendChatRequest`、`sendActionsRequest`、`sendSummaryRequest` 既有 API；先添加稳定的内部 facade/DTO。
2. 新旧路径建立 **wire/client/output parity fixture**，逐 Adapter 替换内部调用。
3. 保留旧 `chatCompletion` 外部形状作为兼容 shim，直到全部消费者与测试通过。
4. 仅迁移本阶段语义，保留 V9.4 专属缓存布局。
5. 绝不新增第二套 Usage/Cost writer；复用同一个 `usageAnalytics` 入口，附 provenance 字段。
6. 拆出独立纯模块；`providers/index.js` 可逐步瘦身，但不强制一次拆完 2000 行。

### 2.3 推荐新增模块（建议路径，不是已存在文件）

```text
src/app/main/providers/
  provider-capabilities.js      # 功能支持与来源证明
  provider-contract.js          # 请求/结果/终态校验
  provider-result.js            # 非流式结果与 finish normalization
  provider-stream.js            # 统一 chunk 与完成事件语义
  provider-errors.js            # 错误/Retry-After/Unsupported 分类
  provider-cancellation.js      # signal、deadline、abortable backoff
  provider-retry-policy.js      # 阶段感知、预算感知重试
  provider-conformance.js       # 纯 Fixture 驱动断言（也可置 scripts）
  # 保留现有文件及已验证厂商专有序列化器
```

应由 Codex 首先确认 CommonJS 格式和现有构建映射，切勿在无证据时引入重型新依赖。

---

## 3. ProviderCapability 合同（WP 核心）

### 3.1 语义要求

每项能力至少保存 `{ state, source, reason? }`：

- `SUPPORTED`：在当前端点/模型/route 上已有明确合同或验证证据。
- `UNSUPPORTED`：明确不支持；应在发网前返回 Typed Unsupported。
- `UNKNOWN`：尚无可靠证据，不能自动改写为 `false` 或 `true`；根据调用路由决定是否允许受控尝试，严格结构化/有副作用业务优先 fail-closed。

**“有选项”不等于“有能力”**；**“支持 JSON 文本”不等于“支持服务端强制 JSON Schema”**。

### 3.2 建议 DTO（接口示例，实施前以冻结测试定稿）

```js
// Illustrative contract; not already implemented
{
  providerType: "zhipu", providerInstanceId: "...", modelId: "...",
  route: "CHAT", endpointFingerprint: "...", revision: "...",
  context: { windowTokens: 90000, outputTokens: 4096,
    limitsSource: "configured|provider_metadata|fallback|unknown" },
  features: {
    nonStreaming: { state: "SUPPORTED", source: "fixture" },
    streaming: { state: "SUPPORTED", source: "fixture" },
    structuredJsonObject: { state: "UNKNOWN", source: "unverified" },
    structuredJsonSchema: { state: "UNKNOWN", source: "unverified" },
    reasoningControl: { state: "SUPPORTED", source: "fixture" },
    reasoningTelemetry: { state: "UNKNOWN", source: "unverified" },
    nativeCachedUsage: { state: "SUPPORTED", source: "native_usage_fixture" },
    cancellation: { state: "SUPPORTED", source: "mock_transport" }
  },
  resolvedAt: "...", expiresAt: "..."
}
```

字段实例仅展示数据结构；**各厂商最终枚举由 Conformance 决定，不可将示例照搬成支持事实**。

### 3.3 Capabilities 缓存键与失效

缓存键至少应涵盖 provider instance、endpoint fingerprint、model ID、route、影响协议的配置和 capability revision（不包含 API Key 明文）。切换 Provider、模型、base URL、structured mode、thinking 等参数时不能误用旧能力。保留本阶段既有 5 分钟 model lookup 缓存语义，迁移后才根据测试调整。

能力元数据查询失败：

- 不影响明确支持且配置冻结的必要业务能力，但需按来源显示 fallback/unknown。
- 严格 JSON Schema 若无支持证据不能自动降级成无验证的自由文本。
- 对 Memory4 Durable 保留**请求真实发送前**的 source/Forget Guard，不能只在 capabilities 查询前运行一次。

### 3.4 七种 Provider 能力审计表（施工待填表模板）

| Adapter | Chat nonstream | Chat stream | JSON-object | JSON-schema/native | Reasoning | Native cache usage | Abort | 实验来源 |
|---|---|---|---|---|---|---|---|---|
| player2 | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | 既有 SDK / 模拟 |
| openrouter | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | SDK、模型因子 |
| openai-compatible | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | 真实第三方端点差异 |
| ollama | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | 本地 Native API |
| deepseek | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | Action/summary/Chat 既有合同 |
| gemini | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | JSON Schema 子集、SSE |
| zhipu | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | VERIFY | reasoning/usage 原生测试 |

表格中 `VERIFY` 表示待证，不表示当前功能不能使用；不要求七种模型在同一时间全部做付费联网测试。按可用端点与用户选择决定正式支持名单，缺少可用端点时 `NOT_VERIFIED`、不谎称通过。

---

## 4. 统一 Request / Result / Stream 合同

### 4.1 ProviderRequest

- 输入：`requestId`（本地匿名）、`route`、`messages`（已授权）、`model`、`stream`、`responseFormat`、`parameters`、`signal`、`deadline`、`beforeSend`（可选）、`providerSnapshot`（必要时）。
- `requestId` 仅本地关联，不自动传给云 Provider；任何调试 ID、Owner、Campaign 明文均不进入外部 Prompt。
- `route`: `CHAT` / `ACTION` / `SUMMARY`，根据原有 requestType 区分 `chat_continuation`、`memory4_durable`、`final_summary` 等，不擅自重新命名存量统计。
- 结构化约束在业务层仍由原 Action/Durable 严格解析器决定；Adapter 成功发送 JSON 不等于业务合法。

### 4.2 统一非流式 ProviderResult（示例）

```js
{
  status: "COMPLETE|PARTIAL|FAILED|CANCELLED|UNKNOWN",
  content: "...",              // 仅消费业务路径可见，不进入诊断文件
  toolCalls: [],
  finish: { raw: "stop", normalized: "STOP", source: "provider" },
  usage: { /* §6 */ },
  reasoning: { present: false, tokenCount: null, source: "unknown" },
  provider: { type: "...", model: "...", responseId: null },
  error: null
}
```

- 兼容 shim 可把统一 Result 映射回现有 `{content, tool_calls, finish_reason, usage}`；消费者迁移前不得单方面改 API。
- 终态 `UNKNOWN`、`PARTIAL` 不允许替代 `COMPLETE` 用于 Action 提案确认、Durable Commit 或 Letter 完成。
- 不能用 `content` 非空来代替 `finish_reason` 完整性。

### 4.3 Stream 生命周期

```text
CREATED -> CAPABILITIES -> BUDGETED -> READY_TO_SEND
                                    |   (beforeSend)
                                    v
                        SENDING -> STREAMING
                                  |  |  |  |
                                  |  |  |  +-> CANCELLED
                                  |  |  +----> FAILED/PARTIAL
                                  |  +-------> TRUNCATED
                                  +----------> FINISHED (+ final usage if available)
```

每条 Stream 必须区分：

- `STARTED`：开始发送尝试；不等于服务端确认计费。
- `DELTA_CONTENT`：可见输出。
- `DELTA_REASONING_PRESENT`：仅 presence/可核验 token 数，避免保留内部推理全文。
- `TOOL_CALL_DELTA`：增量提案，不执行游戏效果。
- `USAGE_UPDATE`：供应商明确提供、可重复覆盖而不重复累加。
- `FINISHED`：供应商终态已知；必须只有一次。
- `ABORTED` / `FAILED` / `PARTIAL` / `UNKNOWN`：不能伪装为正常结束。

保留现有 AsyncGenerator 返回结果形状；统一的事件内部可实现为兼容聚合层，避免 UI/Conversation 立即重写。

### 4.4 特殊流式场景

- usage-only 尾包：没有 choice 仍应收集 `usage`，不丢弃；只可记录一次。
- 正文先出、随后报错：必须保留“部分输出非完成”，不得允许 Action/Memory4 基于残缺 JSON 提交。
- 第一个 chunk 只有 reasoning / role：不得当作 first visible token；TTFB、first reasoning、first content 分别测量。
- `tool_calls` 的 `index/id/name/arguments` 可分片到达，必须稳定聚合；不将 partial arguments 当合法 JSON。
- 网络提前关闭、SSE 缺 `[DONE]` 或没有可靠 finish reason：按有证据的厂商语义决定，无法证明完成则 `UNKNOWN/PARTIAL`。
- 多个 finish 事件或 Usage 尾块乱序：幂等地只记录一次终态，不做重复计费。

---

## 5. Structured Output / Action / Summary Conformance

### 5.1 明确交付模式

| 模式 | 含义 | 业务允许 |
|---|---|---|
| `NATIVE_SCHEMA` | 端点实际支持服务端 Schema 约束，且已验证 | 仍要本地业务验证 |
| `JSON_OBJECT` | 端点只保证 JSON object（或仅声明 JSON 模式） | 严格本地 JSON/Schema/证据校验 |
| `EMULATED_SCHEMA` | 通过历史兼容 Schema 注入 + `json_object` 等手段 | 严格验证，不能描述成服务端强 Schema |
| `UNSUPPORTED` | 明确不支持指定输出能力 | 请求前返回 Typed Unsupported |
| `UNKNOWN` | 未经验证 | 高风险结构化业务默认不贸然切换到自由文本 |

### 5.2 厂商差异不能抹平

- **DeepSeek Action**：保留 `votc_actions`、`actionSchemaDeliveryMode`（`optimized_local_validation` / `official_full_injected`）、Thinking 关闭、现有 Action System Introduction/Examples、Overlay 和 fallback 排列。迁移前后对“可执行 Action 白名单、业务本地验证、拒绝未知 Action”做字节级与语义级对照。
- **DeepSeek Durable/Summary**：保留 `thinking:{type:'disabled'}`、`json_object`、max tokens、fixed Durable Policy、预发送 Forget 保护；不可将 Year/Life 请求意外重新加入。
- **Zhipu GLM**：保留 `reasoning_effort` 和 `thinking:{type:'enabled', clear_thinking:...}`，并保留 streaming usage-only 尾包；未经证据不改变 v813 或推理历史序列化。
- **Gemini**：保留 `responseMimeType`、Schema 子集转换、usageMetadata；不支持的 Schema 关键字不得悄悄丢掉再称已严格约束。
- **OpenRouter**：能力与具体上游模型有关，不只取平台级 supported；保留有意的 `reasoning.exclude` 行为，是否需要改变必须单独设计、不能趁机开放推理明文。
- **OpenAI-compatible**：同协议并不意味着同等支持 JSON Schema、Reasoning 或 caching；按实际 base URL/模型存证。
- **Ollama**：本地 endpoint、Native options、stream NDJSON、usage evalCount 映射保留，unsupported 能力明确标记。
- **Player2**：按既有 SDK 与服务特性逐项验证，不能以 OpenAI SDK 兼容外观推断全部能力。

### 5.3 Schema 验证失败处理

- 业务层不得只靠 `JSON.parse` 通过就接受 Action/Durable；继续执行原字段 enum、来源/Owner/日期/证据/Commitment 校验。
- `finish_reason=length`、半个 JSON、Schema invalid、provider refusal、结构化协议不支持分别使用不同的 Error Code。
- 不因为 JSON 失败而隐式发起无限次新模型请求；Durable 原有有限二分/修正逻辑及 Cost Trace 按既有合同运行。
- Action 提案不直接等于 CK3 执行成功；仍需后续现有执行队列与 ACK 证明。

---

## 6. Usage / Reasoning / FinishReason 的真实性

### 6.1 Usage 双通道

**首要原则：厂商原生数据与 VOCT 估算数据必须独立保留。**

建议结构：

```js
{
  native: {
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    totalTokens: null
  },
  estimated: { inputTokens: null, outputTokens: null, method: null },
  provenance: {
    status: "REPORTED|PARTIAL|NOT_REPORTED|UNKNOWN",
    providerUsageShape: "zhipu_nested|deepseek|gemini_metadata|ollama_native|...",
    cacheStatus: "REPORTED_ZERO|REPORTED_POSITIVE|NOT_REPORTED"
  }
}
```

兼容旧 `usageAnalytics` 的扁平字段时，**必须保留 `votc_estimated`** 和来源状态；UI 合计可继续展示估算，但不得把 `estimated.prompt_tokens` 写成 `native.cachedTokens` 或“官方费用”。

### 6.2 Required Usage Rules

1. 明确上报 `cached_tokens=0` ⇒ `REPORTED_ZERO`；字段不存在 ⇒ `NOT_REPORTED`，不得用 `||0` 把两者混为一谈。
2. `input>=0`、`hit>=0`；若原生 hit 超过 input，标记 `INCONSISTENT`，不能无提示截断制造假精确。
3. 缺少 miss 时，`input-hit` 可作为 **派生估算** 展示，标记 `DERIVED`，而非 `PROVIDER_REPORTED`。
4. Streaming 的 usage 尾包到达 0/1/多次时应确定一致性；重复尾块不得重复叠加。
5. Provider 没有 Usage、异常中止、取消：保持未知状态，另列本地 prompt 估算供成本上界参考。
6. Reasoning Token 不存在时不强行设为 0；存在时计入可核实类别；输出 Token 与 Visible Token 的关系由厂商真实语义证明，不能跨厂商强行套公式。
7. 保留 raw usage 的脱敏最小白名单，严禁原始回复/Prompt/密钥落盘。
8. `Total` 与 Input+Output 不一致时保存原始上报并标记差异，不自动覆盖。

### 6.3 FinishReason 归一化建议

| 原始来源示例 | 归一化 | 完整性处理 |
|---|---|---|
| `stop` / 已验证自然结束 | `STOP` | 可进入业务校验 |
| `length`, `max_tokens`, Gemini `MAX_TOKENS` | `LENGTH` | `PARTIAL/TRUNCATED`，不得业务提交 |
| `content_filter`, Gemini `SAFETY` | `FILTERED` | 非正常成功 |
| Tool/Function Calls | `TOOL_CALLS` | 仅提案阶段；需工具参数完整性与后续 ACK |
| 显式拒绝 | `REFUSAL` | 不生成虚假回答 |
| `cancelled` / AbortError | `CANCELLED` | 不作为完整输出 |
| 错误中断 | `ERROR` | 不作为完整输出 |
| `null`/未知新 enum | `UNKNOWN` | 不可凭非空内容默认 STOP |

特别注意：当前 `validateGenerationOutcome()` 对未知值可能得到 `complete:true`，V9.3 必须通过业务相容的 adapter/strict mode 处理；不应突然改变所有历史消费者而没有 golden fixture。

### 6.4 推理内容与隐私

- Reasoning 仅保留 `present`, `tokenCount`, `timing` 等诊断必要字段；除既有模型协议显式要求外，不存储、不展示推理原文。
- GLM `clear_thinking` 按现有用户参数保留；不为缓存命中私自切成 `false`。
- 结构化输出失败时，不打印原始 JSON/角色文本到错误日志。

---

## 7. 取消、超时、重试与成本边界

### 7.1 必须跨越完整生命周期的取消

取消信号覆盖：等待 capabilities/model 列表、排队、backoff、建立连接、读取 Stream、关闭 Reader/Iterator、汇总阶段。至少保证：

- `signal.aborted` 后不发起下一次网络请求；
- `beforeSend` 在每一次真实发送前执行（包括 SDK 可能发起的重试）；
- 发送后 Abort 不能证明已取消计费，Usage 未知时显示 UNKNOWN；
- 文本已产生但 Stream 被用户取消，不再生成“完整对话/可执行 Action/已提交 Durable”的成功结果；
- 定时器和网络 reader 结束时清理，不能遗留后台无限任务。

### 7.2 Timeout 分层

建议区分 `capabilitiesTimeout`、`connectTimeout`、`firstTokenTimeout`、`totalRequestTimeout`、`idleStreamTimeout`（具体默认值只能经过历史实测决定，不在文档中臆造固定毫秒）。识别用户主动取消与超时，保留 `AbortError` 的规范状态。

### 7.3 Retry 策略

| 类型 | 可否自动重试 | 限制 |
|---|---|---|
| 请求发送前、未发送的确定性错误 | 可依明确策略 | 取消后不得重试 |
| 429 且有明确 Retry-After | 可受控退避 | 遵守响应节流、次数/时长/成本上限 |
| 部分 502/503/504 | 在确认没有输出且阶段安全时可 | SDK 隐藏自动重试必须显式管控 |
| 网络超时、断线且送达状态 UNKNOWN | 不自动假定未送达 | 保留 UNKNOWN，业务按既有恢复合同决定 |
| 首个 Stream 内容已经产生后 | **禁止透明重新启动同一次生成** | 避免内容混杂与重复 token 费用 |
| JSON Schema 校验失败 | 不算传输层 5xx | 由业务已验证的有限修正策略处理 |
| Forget/SourceRevision 已变 | **绝不重试旧正文** | fail-closed，必要时重新取得授权上下文 |
| Action/Letter 有未知实际效果 | **禁止重放 Effect** | 由 CK3 ACK 和现有幂等账本负责 |

**成本优先：**不能为追求较高“成功率”将 3/7 次历史重试作为所有 Provider/Route 的新默认；引入每路由最大尝试、估算消耗与未知计费窗口。现有行为如确需修改，先 RED 记录基线并按 Provider 开关小步推出。

### 7.4 Error Code 稳定 DTO

```js
{
  category: "RATE_LIMIT|SERVER_ERROR|NETWORK|TIMEOUT|CANCELLED|UNSUPPORTED|INVALID_RESPONSE|BUDGET|AUTH|UNKNOWN",
  provider: "...", model: "...", statusCode: 429,
  retryable: false, safeToReplay: false, responseStarted: false,
  attemptCount: 1, retryAfterMs: null,
  messageCode: "provider_rate_limited"
}
```

`retryable` 只描述传输层是否可能重试，`safeToReplay` 还必须包含业务幂等/来源守卫判断，二者不得混同。日志仅记录结构化 code，不导出服务器可能包含正文的完整 error body。

---

## 8. 施工工作包（WP-00 ～ WP-11）

### WP-00：冻结 V9.2.3 基线和范围（P0）

**施工前：**

1. 记录 SHA `e1c3c37`、已成功的对应 CI Run、版本号、`287` 构建映射、已锁依赖快照和当前 Runtime Manifest。
2. 保存私有用户目录、存档、Summary、Memory4、Recovery、设置和 Provider 配置的**脱敏哈希/离线备份**；不得上传正文/密钥。
3. 记录 31 次 GLM 43.1% 作为**历史非受控实机窗口**，注明原生零命中与 UNKNOWN；不得用它直接给 V9.3 设缓存 KPI。
4. 用户已确认 Year/Life 0 新增、Durable 正常、5/10 年回忆正常；保留为 V9.2.3 人工 Gate 证据。
5. 创建 `V9_3_BASELINE.md` 和 `v9.3-baseline-evidence.json`，报告 CANDIDATE/NOT_VERIFIED 边界。

**Exit：**具备可还原版本、红线清单及旧 Provider 请求 Golden Fixture。

### WP-01：Provider 现状盘点与能力证据（P1）

- 为七个 Adapter 列出：class、有效 endpoint/model、SDK/fetch、stream/noStream、JSON modes、thinking、native usage、错误/取消路径、默认重试次数、当前测试来源。
- `getProviderCapabilities()` 的 model list 是**元数据线索**，不是全部能力的最终证据。
- 为各 route 列出必须有的能力；无法验证的模型应标 UNKNOWN 或显式 UNSUPPORTED。
- 成果：`V9_3_PROVIDER_MATRIX.md` 与可机器校验的能力 fixture（不可包含账户 ID/Key）。

### WP-02：Capabilities/Registry 合同（P1）

- 新增纯模块、typed feature 状态、revision/fingerprint；保留 `ProviderRegistry` 与用户实例配置。
- 避免不同 instance 同一 providerType 的 Capability 串用；如现有实例缓存由 providerType 键控，评估其 stateless 安全性，必要时按实例隔离但不破坏既有行为。
- 能力读取失败时采用明确的 fallback 语义，不默认 JSON Schema/Reasoning 受支持。
- 写单元测试：不同模型、base URL、用户配置、模型列表变化、超时、错误、取消。

### WP-03：统一 Generation Result 与 FinishReason（P1）

- 新增 `normalizeResult`、`normalizeFinishReason`、`validateComplete` 纯函数。
- 兼容旧 `{content,finish_reason,usage}`；逐 Consumer 使用 facade。
- 保留 `Unknown` 与缺失；非流式和流式完成使用同一最终语义。
- 负例：仅有内容但没有 finish、误报 stop、拒绝/安全过滤、max_output 截断、不可解析 JSON。

### WP-04：Usage / Reasoning Provenance（P1）

- 围绕 `usage-normalization.js` 与 `trackUsage()` 增加 native/estimated 层，不引入第二个计费数据库。
- 专项验证 Zhipu `prompt_tokens_details.cached_tokens=0`、DeepSeek 命中/未命中、Gemini usageMetadata、Ollama evalCounts、OpenAI-compatible usage-only 流尾包。
- `UNKNOWN` 与 `REPORTED_ZERO` 必须独立，推理 token 未报告不是零。
- 与已有 V9.2.3 `usageAnalytics` 历史统计对照；在 UI 未重构前用兼容投影保持面板行为，确保没有虚假改善。

### WP-05：非流式 / 流式 Conformance（P1）

- 定义统一 Stream event/final result 内核；先兼容现有 AsyncGenerator。
- 修正可复现的取消、SSE/NDJSON、usage-only、重复尾块、分片 tool call、partial reply 缺终态问题。
- 用可控 Mock Server/SDK fixtures 验证七种 Adapter；不把所有 Provider 强行套进一个 wire serializer。
- 冻结业务顺序：正常 Chat 流式输出可以增量展示；Action/Durable 必须最终完整合法才交付业务。

### WP-06：Structured Output 与严格本地验证（P1）

- 将 `Native / JSON Object / Emulated / Unsupported / Unknown` 语义落实到能力声明与请求前判断。
- 保留 DeepSeek Action 优化、GLM 参数、Gemini schema 子集转换，做逐字节请求 Golden Diff。
- 接入现有 Action Schema、本地拒绝未知命令、Durable Fragment/Owner/source proof 验证。
- 禁止“没有原生 Schema → 静默降级为 freeform 且当作成功”。

### WP-07：Cancel / Deadline / Backoff / Error（P1）

- 先做取消期间 capabilities/退避/流式输出/Provider 重试的 RED 测试。
- 受控修复 OpenRouter/Ollama/Gemini/SDK 取消信号传播与流式资源释放，不借机更改 Prompt。
- 将 `429/5xx/Retry-After/timeout/unsupported` 变成稳定 Error Category，保留 Status/Retryable/Unknown Side Effect。
- 一旦收到部分流事件，不透明重复发起同一调用；未结束事件不得报 COMPLETE。
- Durable 每次发送前校验不丢失；禁止重放未知效果。

### WP-08：七 Provider Adapter 分批迁移（P1）

建议施工次序按实际真实流量和危险性，而不是按文件字母顺序：

1. **zhipu**：主力 Chat；稳定 v813、Thinking 与 Cache Usage，先归一化、不改 wire。
2. **deepseek**：Durable/Action/Final Summary；严格保持 `thinking disabled`、Action Schema/Guard/Usage。Year/Life 必须仍零请求。
3. **openai-compatible**：用户自定义路由；谨慎处理端点间模型/JSON差异。
4. **openrouter**：多上游路由、流式取消/错误语义。
5. **gemini**：SSE、Schema 子集、finish 和 usageMetadata。
6. **ollama**：本地 NDJSON、取消、无远端成本但仍有运行负担。
7. **player2**：按实际可用端点验证，不做未授权网络探测。

顺序允许 Codex 基于实际测试夹具调整，但每迁移一类必须有独立可回滚 commit、Golden Diff 及 Conformance 报告。七入口都要审计；未连真实端点不能声称已做在线完整验收。

### WP-09：隐私、诊断及成本上限（P1/P2）

- 诊断白名单：provider/model 指纹、route、错误 enum、finish enum、usage/provenance、请求耗时、匿名 attempt ID；不可记录 Prompt、NPC 私人内容、真实 Owner、Authorization。
- Trace 默认关闭，启用时有界保存，必须可主动脱敏导出。
- 网络实测采用用户明确允许的费用上限、绝对尝试上限、失败未知占用预留；费用报告区分价格估算与账单事实。
- 现有 Cached/Noncached Input 与实际输出 Token 各自保留。
- 诊断不得引入额外模型请求；不自动 cache warming。

### WP-10：系统集成/数据安全回归（P0）

- 三人多轮 CK3 对话、切换 NPC、重进旧存档。
- Player 与 NPC 的五年/十年详情召回、Forget、KnownBy、SourceRevision、Dirty 老 Year/Life 只读兼容。
- `memory4_life/memory4_year` 新增自动请求 **0**，恢复/Letter/Legacy/手工按钮无法绕过。
- Durable 正常生成、提交并安全恢复；截断/Bad JSON 不能被误判完成。
- Action 只提交合法提案，CK3 Effect 必须 ACK；Letter 不重复归档/重寄。
- Provider SNAPSHOT 切换：Memory4/Letter 任务完成前配置改变不得悄悄换模型或错发私有证据。
- 对取消和未知完成，不作乐观剧情事实写入。

### WP-11：CI、发布与 V9.4 Handoff（P1）

- 更新 `scripts/test-manifest.js` / regression workflow；运行全部 releaseChecks 和新增 V9.3 conformance。
- 验证锁定依赖、源码构建、运行产物 hash、`verify-runtime-build --deployed`、隔离 EXE smoke、版本一致性。
- 依据最终提交 SHA 检查远端 Release Regression，不能用 `e1c3c37` 的旧 Success 替代。
- 成果：`V9_3_VERIFICATION_REPORT.md`、`V9_3_P_ISSUE_LEDGER.md`、`V9_3_PROVIDER_MATRIX.md`、`V9_3_HANDOFF_TO_V9_4.md`、匿名 evidence JSON。
- 缺少真实端点时按 Provider 标记 `NOT_VERIFIED` 或 `DEGRADED`；若核心常用 Provider 未通过，不签 Full Freeze。

---

## 9. 推荐 Commit 分组（适合 Codex Desktop）

| Commit | 内容 | 独立 Gate |
|---|---|---|
| C0 | V9.2.3 基线、矩阵、现状 Golden Fixture | 备份 + 原始行为留证 |
| C1 | Capability DTO / Registry | 单元测试 + 配置/端点隔离 |
| C2 | Result/FinishReason | 输出等价 + 错误/未知合同 |
| C3 | Usage/Reasoning | 原生 0/UNKNOWN + 停止时统计 |
| C4 | Structured Output | Action/Durable Schema/权限回归 |
| C5 | Stream + Cancellation | Mock SSE、NDJSON、提前终止、Abort |
| C6 | 429/5xx / Retry Policy | 退避取消、成本上限、No Replay |
| C7 | 七 Provider 分批适配 | 各 Provider 独立 Conformance |
| C8 | 完整回归及打包 | local release + payload hash + EXE smoke |
| C9 | 实机验证与移交 | 对应 SHA CI + CK3 + issue ledger |

禁止将所有 Provider 重构、UI、Prompt 改动合并为单一不可回滚提交。

---

## 10. Provider Conformance 测试矩阵

### 10.1 基础功能（每 Provider/可用模型）

| 编号 | 用例 | 期望 |
|---|---|---|
| T01 | 无模型/配置缺失 | 不发网，明确错误 |
| T02 | Capabilities cache miss/hit | 来源可追溯，参数不串实例 |
| T03 | 更换模型、端点或路由 | 重新解析能力，不沿用旧判断 |
| T04 | 非流式 stop | Normalized COMPLETE，内容/usage 匹配 |
| T05 | 流式 token delta | 顺序稳定，最终内容等价 |
| T06 | 流式 usage-only 最后包 | 只记一次 Usage；允许 no-choice |
| T07 | `max_tokens` 截断 | 标 TRUNCATED，不当完整 JSON |
| T08 | 只收到部分内容后断链 | PARTIAL/UNKNOWN，禁止“成功” |
| T09 | 供应商拒绝与 content filter | Typed refusal/filter，不接受 Action |
| T10 | 未知 finish reason | UNKNOWN，严格业务不放行 |
| T11 | 空 usage | UNKNOWN，而不是官方 0 |
| T12 | 明确 cached_tokens=0 | `REPORTED_ZERO`，而非 UNKNOWN |
| T13 | cached_tokens>0 | 原生值精确保留 |
| T14 | reasoning 仅 presence | 不泄露 reasoning 原文 |
| T15 | reasoning_token 仅部分提供 | 缺失保持 null |
| T16 | tool call 多 chunk 拼接 | index/id/arguments 正确，重复不双计 |
| T17 | native schema 支持 | 真实验证和本地校验通过 |
| T18 | JSON object 兼容模式 | Schema 仍在本地拒绝非法字段 |
| T19 | 明确 unsupported feature | 发送前 Typed Unsupported |
| T20 | 未经验证 feature | 显示 UNKNOWN，不谎称支持 |

### 10.2 异常与成本（跨 Adapter，按 route）

| 编号 | 用例 | 期望 |
|---|---|---|
| T21 | capabilities 查询中 Abort | 不发业务请求 |
| T22 | 429 Retry-After / Abort | 不再尝试下一次 |
| T23 | 502/503/504 请求前故障 | 按明确策略有限重试 |
| T24 | 传输可能送达但超时 | 送达状态 UNKNOWN，不重放效果 |
| T25 | 首个输出 chunk 后中断 | 不透明重试/不拼接第二轮 |
| T26 | SDK 默认隐藏重试 | 明确禁用或计数，避免成本不透明 |
| T27 | 用户取消普通 Chat | 正确终态和 Reader 关闭 |
| T28 | Durable SourceRevision 在 capabilities 中途变化 | 发送前拒绝旧证据 |
| T29 | Durable SourceRevision 在 backoff 中变化 | 下一次 Attempt 拒绝旧证据 |
| T30 | Forget 与返回结果竞态 | 不提交已忘内容 |
| T31 | Action 部分 JSON + HTTP 200 | 不执行 CK3 Effect |
| T32 | Letter 失败/未知 ACK | 不重复投递或归档 |
| T33 | 估算 vs 原生总数不一致 | provenance 标识明确，账单不虚报 |
| T34 | 缓存 hit 大于 input / 非数值 | INCONSISTENT/UNKNOWN，不掩盖异常 |
| T35 | Diagnostics on/off | 关闭不改变 HTTP body，开启不泄露文本 |
| T36 | Provider Instance 切换 | 路由/密钥/能力不串用 |
| T37 | Provider Snapshot 固定后用户改模型 | 明确错误或保留快照，不暗中切换 |
| T38 | 模型名下线 / listModels 失败 | 不假定已支持，合理退化 |
| T39 | 旧 Year/Life UI 直接调用 | 返回 SKIPPED，Provider Request=0 |
| T40 | Legacy 手工旧档与跨年代召回 | 仍按旧权限与来源结果 |

### 10.3 既有回归必须复用

- `scripts/test-v7.7-provider-service.js`
- `scripts/test-v7.10-action-provider-parity.js`
- `scripts/test-v7.10-deepseek-action-compatibility.js`
- `scripts/test-v8.8.5-zhipu-provider.js`
- `scripts/test-v8.6.1-provider-cache-metadata.js`
- `scripts/test-v8.6.2-third-party-token-budget.js`
- `scripts/test-v8.9.1-cache-usage.js`
- `scripts/test-usage-analytics-reconciliation.js`
- `scripts/test-v9.2.2-presend-forget.js`
- `scripts/test-v9.2.3-derived-retirement.js`
- `scripts/test-v9.2.3-derived-recovery.js`
- `scripts/test-v9.2.3-glm-outbound-equivalence.js`
- `scripts/test-v9.2.3-glm-native-usage.js`

上述是仓库现有测试文件，V9.3 新测试建议命名 `test-v9.3-provider-capabilities.js`、`test-v9.3-result-usage.js`、`test-v9.3-stream-conformance.js`、`test-v9.3-structured-output.js`、`test-v9.3-cancellation-retry.js`、`test-v9.3-independent-qa.js`。新测试名称仅为施工建议。

---

## 11. Golden Fixture、Mock Server、在线验收

### 11.1 Golden Fixture

冻结不同 route 的旧版本请求，包括：

- GLM v813 Chat：正常、续聊、多 NPC、日期变化、Thinking/clearThinking 配置、stream。
- DeepSeek：Durable fixed policy、Final Summary、Action 两种 Schema 模式及 overlay。
- Gemini：systemInstruction 与 Schema 子集转换。
- OpenRouter/OpenAI-compatible：base URL/headers/request parameters/JSON mode。
- Ollama：Native message mapping、options 和 NDJSON 序列化。
- Player2：既有 SDK 请求参数。

要求对照**真正序列化出站 Body 与有效请求参数**，而不是只比较 PromptBuilder 中间结果；所有 Fixture 都采用合成内容和匿名配置，不含真实聊天文本或 API Key。历史冻结结果不可为使测试通过而偷偷改写。

### 11.2 Mock Transport

模拟至少：请求体、状态码、Header（含 Retry-After）、延迟连接、SSE usage-only、缺损 SSE、NDJSON、断线、Abort、429/503、重复尾帧、服务端已收到而客户端超时。每个测试记录 `attemptCount`、`bytesSent`（仅合成）、`terminalState`、`usageStatus` 和 `beforeSendGuardCalls`。

### 11.3 真实 API 对照原则

- 先离线覆盖全部 7 个 Adapter；真实 API 仅测试用户当前可用端点，尤其 Zhipu 主力 Chat 和 DeepSeek Action/Durable。
- 真实联网要有单独的授权与明示 **人民币最高预算 + 请求数硬上限**。不得从前阶段 ¥10 的研究预算推断新阶段还被授权。
- 测试无个人存档正文、不调用真实 CK3 Effect，只用合成 Prompt。
- 不要求真实 GLM 缓存率上升；对原生 zero、UNKNOWN、positive 只做一致性/真实性验收。
- 失败或未知要进入独立 Issue 台账，不能通过再发大量请求掩盖。

---

## 12. P 级风险与处置

| 等级 | 风险 | 必须采取的措施 | 发布阻断 |
|---|---|---|---|
| **P0** | Provider 重构绕开 Memory4 Forget / Owner / Source Guard | 真正发送前及每次重试前 guard，精确竞态测试 | 必须阻断 |
| **P0** | Year/Life 自动请求再次出现 | 退役哨兵、各入口零调用回归 | 必须阻断 |
| **P0** | Structured Action 部分输出被当成功并触发游戏效果 | 完整性 + Schema + 原 ACK/幂等 | 必须阻断 |
| **P0** | Letter / Action 未知结果导致重复效果 | 不透明重放禁令、原恢复权威 | 必须阻断 |
| **P1** | 取消后仍发生隐藏重试、重复费用 | abortable backoff、按 attempt 计数、真实发送前检查 | 必须关闭或明确降级 |
| **P1** | 原生 Cache 0 与 UNKNOWN 混淆 | 原生/估算 Provenance 明确 | 必须关闭 |
| **P1** | 未知 FinishReason 被标成功 | strict terminal semantics | 必须关闭 |
| **P1** | 现有七 Provider 中主力路由回归 | 分 Provider Golden Conformance + 小规模在线测试 | 阻断受影响 Provider 发布 |
| **P1-HOLD** | GLM 长局原生零缓存 | 移交 V9.4；不虚报本阶段修复 | 不阻断 V9.3 平台，继续追踪 |
| **P2** | 非主力 Provider 真实端点暂不可用 | 端点/模型 NOT_VERIFIED、限制宣传与可见状态 | 视真实支持名单 |
| **P2** | UI 部分描述未显示完整能力 | 保留 V9.5 UI 重构；V9.3 最小提示即可 | 不越界 |

---

## 13. 发布 Gate 与量化验收

### G0：版本与证据

- 新阶段基线 SHA、旧本地/远端 CI、用户反馈、源码 hash 已归档。
- 当前候选 SHA 的测试独立记录，不继承旧 pass。

### G1：Capabilities

- 七个配置入口均有可读能力表；每个功能项可判断 `SUPPORTED/UNSUPPORTED/UNKNOWN`。
- 模型/端点/route 变更不能串能力；无法验证时诚实降级。

### G2：Result/Usage/Reasoning

- 非流式/流式 Conformance 完整通过；终态不能假成功。
- `cached_tokens=0`、`UNKNOWN`、估算数据三者可区分；真实缓存统计与旧测试兼容。
- Reasoning 明文不会进入诊断或历史存储（必要的显式厂商协议另按专项严格测试）。

### G3：Structured/Abort/Retry

- 40 个核心场景中所有适用的 P0/P1 测试通过；不适用的需有理由与 fixture 证据。
- 取消后零新 Attempt；部分流不重放；429/5xx 有界；Unsupported 不静默降级。
- Durable 发送前权限钩子及 Forget 竞态安全通过。

### G4：业务一致性

- `memory4_year` / `memory4_life` 新增自动请求、输入、输出均为 **0**。
- Durable/Detail/Legacy/Commitment/Forget、Action/Letter 的原功能通过。
- 本地历史多年回忆在测试存档仍可用；已有合法旧 Year/Life 可只读。

### G5：构建/CI

- 源码构建、287 映射一致性（如本阶段映射数变更须有 manifest 证据）、锁依赖、EXE smoke、完整 releaseChecks 均 PASS。
- GitHub Actions 必须是**最终提交 SHA**对应成功；不得引用上一版本的 Run。

### G6：真实实机与支持范围

- 一次 CK3 三人正常对话、一轮最终摘要/持久化、Action/Letter 核验、取消及重开。
- 已上线可用的主力 Provider 有真实端点验证；未联网的标 `NOT_VERIFIED`，不强迫购买全部服务。
- 记录 Token/输出/TTFT/429/5xx，至少与 V9.2.3 同类工作负载比；无可比基线时不得宣称提速或节省百分比。

### G7：冻结与移交

- P0 全部关闭；P1 未关闭需明示影响路由和发布决策，不能含糊签字。
- 文档一致、版本号统一、可回滚；交付 `V9_3_HANDOFF_TO_V9_4.md`。
- GLM Cache HOLD 作为 V9.4 输入，但不得重新启用 Year/Life 或更改 v813 强行提高命中率。

---

## 14. 回滚方案与失效处理

**触发回滚：**任何 Owner/Campaign 错配、Forget 撤销信息出站、已退役请求复活、Action/Letter 重放、已提交 Durable 丢失、主力 Provider 参数/功能明显回归、取消后无界重试、不可逆迁移未获许可。

1. 立即停止新 Provider 平台入口，切回仍保留的旧 Adapter/LLMManager 兼容路径（仅在数据合同相容前提下）。
2. 保留用于判断未知结果的 Durable/Action/Letter 原始 journal，不删除 pending/ack 未决记录。
3. 对照 `src/app`/`resources/app/out` 生成 Manifest 和部署回执，用既有安全回滚程序恢复运行资源。
4. 不回滚、覆盖或清理用户新生成的 Memory4 原始资料；涉及恢复格式时必须验证向后兼容。
5. 真实 Provider 可能已计费的请求不自动重放；计费 UNKNOWN 如实记录。
6. 回滚后恢复 `Year/Life` 停用策略仍必须保持。不能因为切换回旧版本而重新运行后台派生生成。
7. 输出 rollback evidence：触发原因、受影响 Route/Provider、SHA、回执、数据校验、是否出现未知效果。

---

## 15. 提交给 Codex 的执行指令

> 请以 `docs/current/v9/V9_ROADMAP.md` §7.4 和本施工文档为施工合同；从 V9.2.3 `e1c3c37` 的源码树 `src/app` 分阶段完成 V9.3 Provider Platform。先完成 WP-00/01 的 Golden Fixture 与能力审计，然后逐个工作包 RED→改动→GREEN→全量关键回归→独立提交。保留 Memory4 Year/Life 全部自动生成退役路径、Durable 发送前 Forget Guard、V8.13 Prompt/GLM 参数和 DeepSeek Action 兼容；不实施 V9.4 PromptPlan/Cache、V9.5 UI 或 V9.6 Bridge。每个 Provider 的支持能力需给出 mock/原生证据，没有证据标 UNKNOWN。禁止日志泄漏、伪造 Usage/FinishReason、无限重试和重放未知 Effect。最终提交源码/生成产物与 CI、独立验收报告和问题台账；真实端点调用需再次征得明示的付费预算许可。

---

## 16. 资料索引与事实边界

以下来源均已按 GitHub `main` / `e1c3c37` 核对（如后续 SHA 发生变化须重新对照）：

- `docs/current/v9/V9_ROADMAP.md` §6 / §7.4 / §7.5 / §8：V9.3、V9.4 与阻断红线。
- `docs/current/v9/V9_2_3_HANDOFF_TO_V9_3.md`：派生退役、GLM HOLD 与历史数据兼容。
- `docs/current/v9/V9_2_3_VERIFICATION_REPORT.md`、`V9_2_3_P_ISSUE_LEDGER.md`：427/427 本地报告、GLM 实验、未签门禁与风险状态。
- `src/app/main/provider-service.js`：ProviderRegistry、LLMManager、能力、预算、Usage、Durable Guard。
- `src/app/main/providers/index.js`：七 Adapter、结构化特判、SDK/fetch、Stream/Retry。
- `src/app/main/providers/usage-normalization.js`、`generation-outcome.js`、`request-budget.js`：当前合同起点。
- `src/app/main/memory-system/memory4-derived.js`、`memory4-coordinator.js`、`letter-memory-finalization.js`：退役、持久记忆权限与恢复。
- 用户 2026-10-13 实机反馈：Year/Life 零新增、Durable 正常、多年历史召回正常；GLM Chat 仍有零命中。

**凡涉及厂商新 API 支持名单、具体响应字段和实时收费，必须通过对应端点的官方资料或真实可控测试另行验证；本文件不会凭现有配置入口推定这些能力已经可用。**

**阶段完成定义：V9.3 = Provider 平台合同与 Conformance 达成，并保留 V9.2.3 成本与安全基线；GLM 完整缓存性能优化不属于 V9.3 的结束条件。**

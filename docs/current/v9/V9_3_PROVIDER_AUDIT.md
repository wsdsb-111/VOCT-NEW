# V9.3 Provider Adapter 现状盘点与 Golden 基线

审计基线：`e1c3c37c89d8001f995593bc1c287a9c0d63a31f`（VOTC Core 9.2、App 9.2.0）。依据 `src/AGENTS.md`，本审计以 `src/app/` 为源码；对照 `docs/current/v9/V9_ROADMAP.md` §7.4、`V9_2_HANDOFF_TO_V9_3.md` 和用户指定的 V9.3 WP-00/WP-01 施工方案。此次只读检查了源码与既有专项，没有读取用户 Provider 配置、凭据或运行数据，没有联系服务商，也没有修改 production。

## 证据级别

- **SOURCE**：源码中存在该请求转换或传输路径，只证明本地 Adapter 如何构造请求。
- **FIXTURE**：既有测试以合成数据或 mock 验证了本地行为，不证明服务商端点接受该请求。
- **ENDPOINT**：真实、当前的端点与具体模型行为证据。本审计没有 ENDPOINT 级证据。
- **UNKNOWN**：未由来源证明。存在 SDK 方法、字段映射、模型列表或格式转换，都不能单独把端点能力升级为 `SUPPORTED`。

## 七个 Adapter

| Provider | Endpoint 与模型证据来源 | Client 与请求序列化 | Stream / non-stream | Structured Output 与 reasoning | Usage、取消与重试 | 当前判断 |
|---|---|---|---|---|---|---|
| `openrouter` | 源码固定 `https://openrouter.ai/api/v1`。`listModels()` 会请求 `/models` 并读取 id/name/free/context_length；本审计没有请求该端点。有效用户模型 UNKNOWN。 | OpenAI SDK `chat.completions.create`；源码添加 `HTTP-Referer`、`X-Title`，请求总带 `reasoning: { exclude: true }`。 | 两条路径都有；流式汇总文本、工具调用、finish reason 和 usage。 | `response_format` 直传；能力是否受选定模型/上游支持 UNKNOWN。reasoning 请求固定排除。 | non-stream 外层 `maxRetries=3`（最多 4 次 wrapper 调用），stream 为 7（最多 8 次建流调用）。无 `requestControl` 时 SDK 保留默认 `maxRetries=2`；Durable control 存在时设为 0。流式 `.create(request)` 未把 signal 作为 SDK 第二参数传入。 | 请求形状 SOURCE；端点能力 UNKNOWN。 |
| `openai-compatible` | 用户配置提供必需 `baseUrl`；`/models` 只返回模型 id/name。实际配置和模型未读取。 | OpenAI SDK；固定 `maxRetries: 0`；请求透传有限的标准参数、`response_format`，流式加入 `stream_options.include_usage`。 | 两条路径都有；流使用 OpenAI 风格 SSE。 | 默认模式直传 `json_schema`；Action 优化模式使用 `json_object`，业务本地校验。普通 Adapter 不声明端点支持。普通请求 builder 不传 reasoning 参数。 | wrapper non-stream 3、stream 7 次重试上限参数（总计最多 4/8 次建连调用）；retryable 为 429、5xx 和列出的网络错误。流式 SDK 调用传 signal；non-stream 仅从 `requestControl` 取 signal。 | 请求形状 SOURCE；当前模型/端点能力 UNKNOWN。 |
| `zhipu` | 默认 URL `https://open.bigmodel.cn/api/paas/v4`；`listModels()` 读取服务端返回 id，失败/空列表回退 `glm-5.3-flash`。列表行为和 fallback 是源码证据，不是本轮联网证据。 | 继承 OpenAI-compatible；创建 SDK 时 `maxRetries: 0`。每个请求都增加 `reasoning_effort`（low/high/max，默认 low）和 `thinking: {type: enabled, clear_thinking}`（默认 clear）。 | 继承两条路径和 stream usage 尾块处理。 | `response_format` 直传；本地测试覆盖参数组装，不证明当前 GLM 模型原生支持 Schema。Thinking 配置由专用 GLM 字段控制。 | usage 经统一 normalizer，并保留受限 raw/normalized debug 字段；wrapper 继承 compatible。stream signal 传 SDK；non-stream signal 依赖 `requestControl`。 | GLM 参数与 usage 有合成 FIXTURE；实际模型能力 UNKNOWN。 |
| `ollama` | 必须配置 `baseUrl`；`/api/tags` 返回模型名称，源码明确未从该端点取得 context length。实际本地服务未访问。 | 原生 `fetch` POST `/api/chat`；role=`tool` 转为 `assistant`；采样参数写入 `options`，`max_tokens` 映射 `num_predict`。 | non-stream 解析 JSON；stream 解析 NDJSON，`done` 帧设置终止原因并带 eval 计数。 | Adapter body 不包含 `response_format` 或 Schema 字段；其他 JSON 约束能力 UNKNOWN。 | non-stream 仅当传入 `requestControl` 时使用 signal；stream fetch 未传 signal。没有 retry wrapper。 | 仅源码路径；按任务约束只做模拟，endpoint/model 能力 UNKNOWN。 |
| `player2` | 固定 loopback `http://127.0.0.1:4315/v1`；`listModels()` 返回空列表，所选模型实际名称 UNKNOWN。源码中的游戏认证 header 值不进入审计或 fixture。 | OpenAI SDK Chat Completions；支持字段白名单和 `response_format` 直传。 | 两条路径都有；stream 使用 SDK iterator。 | 发送 OpenAI 风格 Schema/JSON mode 的能力未经当前 Player2 服务验证；没有额外 thinking 参数。 | wrapper non-stream 3、stream 7；无 control 时 SDK 使用默认 `maxRetries=2`，有 Durable control 时设 0。stream 传 signal；non-stream 依赖 `requestControl`。 | 按任务约束仅模拟；本地服务也未访问，remote/service 能力 UNKNOWN。 |
| `deepseek` | 默认 URL `https://api.deepseek.com`，可被配置覆盖。模型列表是源码中的静态 ID（含 V4 条目），不是当前服务端目录。 | OpenAI SDK，显式 `maxRetries: 0`；`buildDiagnosticRequest()` 先运行 DeepSeek 转换。 | 两条路径都有；stream SDK 请求传 signal，保留 usage-only 尾块。 | `json_schema` 改为 `json_object`。Action 有 `optimized_local_validation`（不注入完整 Schema）与 `official_full_injected` 两种模式；只有 DeepSeek Action 转换将 thinking 关闭。Chat 路由启用 thinking，structured summary 关闭 thinking。 | usage 取 prompt/completion/total/cache hit/miss；通用 normalization 可推导 miss，不能把推导值称作原生字段。wrapper non-stream 3、stream 7。 | Action 转换有 FIXTURE；端点/模型能力 UNKNOWN。 |
| `gemini` | 默认 URL `https://generativelanguage.googleapis.com/v1beta`，可被配置覆盖。`/models` 代码筛选 `generateContent` 和 Gemini 名称，并读取 `inputTokenLimit`；失败回退源码内静态列表。本审计没有请求端点。 | 原生 `fetch`；OpenAI messages 转 Gemini contents/systemInstruction；模型位于路径，API key 在 query 中。Golden 捕获会删去整个 query。 | non-stream `:generateContent`；stream `:streamGenerateContent?alt=sse`，逐行解析 SSE。 | `json_object` 映射为 `responseMimeType=application/json`；Schema 映射为 `responseJsonSchema`，转换器只复制白名单字段，未知关键字会被丢弃。当前具体模型接受情况 UNKNOWN。无 reasoning 字段映射。 | usage 映射 `usageMetadata`；retry wrapper non-stream/stream 均为 3。signal 传给 stream fetch；non-stream 仅从 `requestControl` 取 signal。Malformed SSE data 当前会被警告后跳过，流末缺少 finish frame 时最终结果默认成 `stop`。 | Usage 解析有合成 FIXTURE；按任务约束仅模拟，实际 Gemini endpoint/model 能力 UNKNOWN。 |

## Route 与公共边界

`LLMManager` 将 Chat、Action、Summary 分别路由到活动聊天配置、Action 配置、Summary 配置。Chat 的 stream 由全局开关和 `noStream` 决定；Action 固定 non-stream，默认发送严格 `json_schema`；结构化 Summary 固定 non-stream 和 `json_object`。DeepSeek 的 Chat/Action/Summary 特殊处理仍由现有路由及 Adapter 完成。V9.3 需保留这些现有 wire 形状，再逐步迁移；本审计没有改 V813 Prompt、DeepSeek Action wire、Year/Life 退役逻辑或任何游戏效果。

现有 `getProviderCapabilities()` 不是功能能力清单：它只为预算解析 context window、max output、tokenizer profile 和来源。可读数来源为配置、模型列表元数据或 fallback；在缺少元数据时默认 context 为 8192、output 为 2048。OpenRouter 只给 `context_length`，Gemini 给 `inputTokenLimit`，Ollama tags 不给 context；其他列表不能证明 stream、Schema、reasoning、native usage 或取消能力。缓存键包含 provider instance/model 和预算字段，但不包含 endpoint 与 route；WP-02 应评估更换自定义端点后旧预算元数据在 5 分钟内复用的边界。

取消路径有明确的静态缺口，需放入 WP-07 的 mock conformance：Chat/Action/Summary 都会构造 signal，但普通 non-stream Chat 和 Action 没有把 `requestControl` 传给 Adapter；Durable Summary 才把 signal 与 `beforeSend` guard 作为 control 传入。Chat/Summary 的 capability/model lookup 没有 signal。流式路径中 OpenAI-compatible、Zhipu、Player2、DeepSeek 将 signal 传给 SDK；OpenRouter 只在 catch 中检查 aborted，没有将 signal 传入 SDK；Ollama stream 不传 signal；Gemini stream 传入 fetch。源码观察不等同于 Abort 的实际运输验收。

OpenAI SDK 实际锁定 `4.104.0`，构造器默认 `maxRetries=2`。当前 OpenRouter、Player2 在没有 `requestControl` 时继承该 SDK 默认值；有 control 时设为 0。OpenAI-compatible、Zhipu、DeepSeek 始终显式设 0；它们另有 Adapter wrapper retries。wrapper 的 stream retry 只包住建立 stream 的 SDK 调用，不重试已经开始读取后的断流。V9.3 若统一显式关闭 SDK 重试，应把该客户端差异单独记录，并继续要求 HTTP method/path/headers/body 与本 Golden 字节一致。

usage 的规则也有来源边界：`normalizeProviderUsage()` 会将 cached hit 归一化，并在 hit 与 prompt 都存在时推导 miss；`trackUsage()` 只在没有 usage object 时估算。因而“字段缺失”、“明确 0”、“推算值”需在 Conformance 中分开。当前 Ollama Adapter 总是构造 usage object，即使输入评估计数字段缺失也会产生 `total_tokens` 算式结果；该路径应增加缺字段 fixture，防止被解释成真实的零消耗。`validateGenerationOutcome()` 对 null/未知 finish reason 当前仍给 `complete: true`；Gemini Adapter 还会把未知或缺失的 non-stream finish reason 映射为 `stop`。不得把这些既有含义和服务商的原始终止状态混为一谈。

## 既有专项证据

- `scripts/test-v7.7-provider-service.js` 覆盖 Provider 注册、Chat/Action/Summary 路由组装；使用合成 SDK iterator 覆盖 OpenRouter、OpenAI-compatible、Player2、DeepSeek usage-only 尾块及 Gemini `usageMetadata` 解析，也验证 usage 完全缺失时产生明确估算值。它不是 HTTP serialized-body capture。
- `scripts/test-v8.8.5-zhipu-provider.js` 使用 mock client 验证 GLM 参数、Reasoning/Cache usage normalization、非流式和 usage-only stream 结果以及 fallback。它不证明真实 GLM 端点能力。
- `scripts/test-v7.10-deepseek-action-compatibility.js` 覆盖 DeepSeek schema full injection、optimized local-validation 与普通 Chat/Summary request transform。
- `scripts/test-v7.10-action-provider-parity.js` 覆盖 Action route 传入模型、stream=false、默认参数、signal 字段及 JSON Schema DTO。
- `scripts/test-v8.8.5-provider-diagnostics.js`、`scripts/test-real-request-diff.js` 验证诊断请求准备/差异；没有截获 HTTP transport 的最终 serialized body。`scripts/test-v8.6.1-provider-cache-metadata.js` 是 Worldline block attribution 证据，不是 Provider feature evidence。

这些测试均由 `scripts/test-manifest.js` 编排。它们是本地 fixture/code evidence；此次没有重跑发布门禁，也没有执行真实 Provider、CK3 或 Electron Gate。

## Golden 捕获

`scripts/fixtures/v93-provider-golden.js` 导出 `SCENARIOS` 与 `captureAll()`，新 Node 子进程用真实 vendored OpenAI SDK `4.104.0` 运行 Adapter。Node 条件分支实际使用 `node-fetch` shim，因此捕获器在 SDK 首次载入前将该 shim 替换成记录型本地 stub；同时替换 `globalThis.fetch` 供 Gemini/Ollama 原生 fetch 使用。Stub 只回放合成 JSON、SSE 或 NDJSON，不能回退到外网或本机服务。

`scripts/fixtures/v93-provider-golden-baseline.json` 固定在 SHA `e1c3c37c89d8001f995593bc1c287a9c0d63a31f`，包含 39 个合成场景：每家 Provider 有 Chat stream、Chat non-stream、Action Schema、Summary JSON 和 Durable `beforeSend`；OpenAI-compatible/DeepSeek 另有 Action 两种 Schema delivery mode。每个捕获保留方法、origin+path、安全 header、精确 body 字符串、UTF-8 字节数和 SHA-256、attempt count、guard 次数及当前 client retry 设置。对话正文和模型 ID 均为 fixture 合成值；Authorization、Player2 game key 值已抹除，Gemini 查询参数整体移除。

`node scripts/fixtures/v93-provider-golden.js --write-baseline` 仅在当前 HEAD 和相关源码仍为基线时写出文件；已生成的 baseline 不应通过更新 fixture 来掩盖 wire drift。`captureAll()` 可供后续 V9.3 专项测试捕获当前 Adapter，与该冻结文件逐字段比较。所有捕获均为 stub 回放，`attemptCount=1` 只描述 synthetic fetch，不是服务商调用次数或费用证据。

## 尚未证明的事项

没有读取当前用户选中的 Provider/model/base URL，因此有效运行配置 UNKNOWN；没有请求任何 `/models` 或 provider generation endpoint，因此服务端当前模型名单、模型级 stream/Schema/thinking/usage/cancel 支持、native cache 字段、429/5xx 行为、retry-after 语义、真实计费和线上 FinishReason 全部 UNKNOWN。Player2、Ollama、Gemini 在本任务中只模拟；所有其他 Provider 也仅做离线捕获。Fixture 证明的是 e1c3c37 本地序列化合同，不签发端点支持名单或 V9.3 发布 Gate。

# V9.3 Provider 支持与证据矩阵

代码候选 `218fd1a91227ae33a31ce8a085cda8ce8e044dae`。本表补充[基线审计](V9_3_PROVIDER_AUDIT.md)；源码路径和Mock通过只证明Adapter合同，不代表任意端点／模型已获服务端支持。

| Provider／Adapter | 传输与保留参数 | 结构化交付路径 | 本轮证据／支持限制 |
|---|---|---|---|
| zhipu／ZhipuProvider | OpenAI SDK；v813、reasoning_effort、clear_thinking及usage raw来源保留 | response_format透传，原本地校验 | Golden／Mock PASS；本轮价格未闭合，未联网生成，模型功能UNKNOWN。 |
| deepseek／DeepseekProvider | OpenAI SDK；thinking和Action overlay保留 | json_object＋完整注入或优化本地校验 | Golden／Mock PASS；deepseek-v4-flash 8次合成原生完成／用量通过。完整服务端Schema强制能力仍未证明。 |
| openai-compatible／OpenAICompatibleProvider | OpenAI SDK；自定义base URL及标准参数，stream usage尾块保留 | 标准json_schema或兼容json_object＋本地校验 | Golden／Mock PASS；自定义精确计费未闭合，未联网生成。 |
| openrouter／OpenRouterProvider | OpenAI SDK；既有headers及reasoning.exclude保留 | response_format透传＋本地校验 | Golden／Mock PASS；z-ai/glm-5.3-flash非流Chat仅1次原生响应；缺失miss误判已离线修复，其余7次计划未发。 |
| gemini／GeminiProvider | fetch／SSE；systemInstruction与usageMetadata | 原JSON MIME／Schema子集 | 用户指定Mock PASS；完整Native Schema与真实服务端均NOT_VERIFIED。 |
| ollama／OllamaProvider | fetch／NDJSON；Native messages及options | 未新增format；显式协议与本地校验不能冒充Native Schema | 用户指定Mock PASS；本地服务未连接，NOT_VERIFIED。 |
| player2／Player2Provider | OpenAI SDK；既有字段白名单 | response_format透传＋本地校验 | 用户指定Mock PASS；本地服务未连接，NOT_VERIFIED。 |

所有七入口都有nonStreaming、streaming、structuredJsonObject、structuredJsonSchema、reasoningControl、reasoningTelemetry、nativeCachedUsage、cancellation的三态合同。没有具体实例×端点×model×route证据时保持UNKNOWN；模型目录只贡献预算元数据。显式UNSUPPORTED在发送前拒绝，UNKNOWN的已有协议尝试仍须严格本地业务校验。

Chat按原设置选择流式；Action固定非流式及严格Schema门禁；Summary／Durable结构化JSON必须明确完成、合法来源及当前Forget。所有SDK隐藏重试为0；显式生成最多2次，仅未输出的429/502/503/504允许重试。目录查询最多1次，不占生成费用；取消覆盖查询、退避和传输。失败、部分流和未知送达不透明重放。

39个冻结正常出站场景、七Adapter模拟与18组独立QA见[场景证据](v93-conformance-evidence.json)。费用、原生字段和未完成Gate见[验证报告](V9_3_VERIFICATION_REPORT.md)。原生探针不会自动把生产配置能力从UNKNOWN改为SUPPORTED。

# V8.9.1 后续：Real Request Diff 实施报告

日期：2026-09-14  
状态：代码与自动化门禁完成；真实 Provider、CK3、角色扮演和长时运行 Gate 待执行  
冻结结论：`V8.9 FULL FREEZE = PENDING MANUAL GATES`

## 1. 实施范围

本轮按《VOCT-真实RequestDiff与Conversation-Responder-Scoped-Prefix分析设计》替换已完成的 Synthetic GLM 缓存路径诊断。诊断目标改为观察 VOCT 真实 `requestType=chat` 出站请求，不修改正式 Prompt、Runtime Profile、Action、Relationship、Memory、Worldline、Summary 或 Provider 路由合同。

旧的 GLM 缓存路径探针、缓存路径 IPC、Preload API、诊断页旧工具、专项测试和实现报告已移除。普通真实 Chat 仍进入既有 UsageAnalytics；不再因为诊断用途从正常 Token 统计中排除。

## 2. 真实请求捕获边界

捕获发生在 PromptBuilder 与最终 Provider 请求参数组装完成之后、调用 `provider.chatCompletion()` 之前。Provider 通过 `buildDiagnosticRequest()` 暴露实际发送形态：

- OpenAI-compatible 使用最终 `model/messages/stream` 及有效请求参数；
- 智谱保留 `reasoning_effort`、`thinking.clear_thinking` 等实际参数；
- DeepSeek 使用其最终请求转换结果，避免把 Provider 内部变换误判为公共前缀。

每条真实 Chat 元数据包含稳定的 `conversationId` 和稳定的 NPC `responderId`。显示名称、随机诊断 ID 和 API Key 不参与诊断持久化。

## 3. 比较范围与内存边界

系统分别维护以下两个最近请求基线，每个 Scope 最多一条，且只存在于当前进程内：

1. Route：`provider + model + requestType`；
2. Conversation / Responder：Route 加 `conversationId + responderId`。

因此，同一路由但换 NPC 时不会把两个角色的公共前缀错误算成同一个 Conversation Prefix；同一 NPC 的连续请求仍可获得更细的消息、Block 和 Chunk 差异。

进程重启后第一条请求明确标为 `cold_local_baseline`，不恢复上一进程的 Prompt 基线，也不在磁盘写入 Prompt 正文。

## 4. 安全数据合同

持久化只保留可用于聚合和复核的脱敏字段：消息位置、role、Block ID、estimated tokens、内容 hash、Chunk hash、公共前缀统计、有效参数差异、Endpoint fingerprint、Conversation/Responder ID、时间、状态和 Provider Usage。不会保存 Prompt、系统指令、用户消息、NPC/Memory/Worldline/Family 文本、回复正文、reasoning 正文或 API Key。

消息级诊断提供首个差异位置和 Block；同 role 的首个差异消息还会给出公共内容字符/字节/估算 Token。公共前缀使用确定性的约 512 estimated-token Chunk hash，便于判断前缀在哪个 Chunk 发生变化而不暴露正文。

## 5. Provider Truth 与对齐判定

原始 Provider Usage 只保留安全字段，统一识别 `prompt_tokens`、`cached_tokens` 以及 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。Provider 未报告缓存值时保持 `unknown/not_reported`，明确的零不会被转成缺失。

本地公共 Prefix 与 Provider 缓存 Token 分开记录，并按以下状态对齐：

- `aligned`：缓存值与估算公共前缀处于 0.75–1.25 区间；
- `provider_under_hit`：Provider 报告低于本地公共前缀；
- `provider_over_estimate`：Provider 报告高于本地公共前缀；
- `provider_zero_despite_large_prefix`：参数相同、间隔不超过 300 秒、公共前缀至少约 8000 Token，但 Provider 报告零；
- `insufficient`：没有可比较的 Provider 真值或本地前缀不足。

诊断页同时展示 Prefix 长度桶（0–2K 至 16K+）、请求间隔桶（<5 秒至 >300 秒）、同 NPC / 换 NPC 聚合和 Provider A/B 统计。

## 6. 诊断页与导出

诊断页保留现有 V8.9 请求捕获和布局开关，新增/替换为：

- 真实 Chat 请求总览、可比较请求、换 NPC 请求、高价值异常和加权命中率；
- 当前 Provider 状态与真实 Request Capture 开关，默认开启；
- Provider A/B、Prefix 长度桶、请求间隔桶；
- 最近真实 Chat 列表和展开详情，包括 Scope、首个差异 Block、消息/Chunk 状态、有效参数差异、Provider Usage 与对齐结论；
- 脱敏导出格式 `real_request_diff_v1`，最多保留最近 300 条 UI 记录。

新增 IPC/Preload 边界：

- `provider-diagnostics:get-real-request-diff`
- `provider-diagnostics:export-real-request-diff`

## 7. 自动化验证

已通过的专项检查：

- `node scripts\test-real-request-diff.js`
- `node scripts\test-v8.8.5-provider-diagnostics.js`
- `node scripts\test-v8.9-outbound-diagnostics.js`

完整门禁与隔离启动冒烟也已通过：`node scripts\test-release.js` 为 300 个发布组通过（369 个测试文件分类、68 个历史检查归档），`node scripts\v8.8-electron-startup-smoke.js` 为 `PASS`，且 `RENDERER_ERRORS []`。

覆盖范围包括消息/Block/Chunk Diff、Route 与 Conversation/Responder Scope、有效参数差异、同 NPC/换 NPC、Provider Usage 对齐、高价值异常、分桶聚合、脱敏持久化、导出、IPC/Preload/UI 接线以及旧 Synthetic 工具不存在。

仍需人工执行的 Gate：重启应用后使用真实 GLM 与 DeepSeek Chat、实际 CK3/RP 流程、检查 Provider 返回的 Raw Usage、确认换 NPC 不污染 Conversation Scope，并进行长时间运行 Soak。静态测试与 Electron 启动冒烟不能替代这些真实环境验证。

# V9.3.6.2 Context 兼容说明

状态：CFG-01／CFG-02／BUD-01 的最终专项、完整发布回归与隔离Electron双启动验证通过。真实Provider、CK3及模型原生长上下文验收为 **NOT_RUN**；90K／1M仍明确标为用户配置值。

## GLM 默认与既有配置

新建 GLM 配置在 Main 与 Renderer 默认值中均明确选择 `contextMode: "custom"`、`customContextLength: 90000`。这是恢复既有兼容配置意图的 **90K Custom**，来源为 `user_provided_unverified`；它不代表 GLM 模型已确认支持 90K，也不是 Provider 请求成功保证或全局上限。

| 配置状态 | 处理与显示 |
|---|---|
| 新 GLM 实例 | 默认 Custom 90,000；原生能力未知时显示 `Verified Native: Unknown / Unverified`。 |
| 已保存的 Auto GLM | 保留 Auto，不因默认值更新而改写；可信窗口未知时按保守 8,192 回退，并提示这不是模型原生上限。 |
| GLM Auto 引导 | 提供“使用 90K 兼容设置”“保持 Auto”“自定义”三个明确操作；只在用户选择时更改模式或值。 |
| Custom 1M | 1,048,576 属于合法 Custom 范围；未知原生能力时仍标为未验证。可信原生上限存在时，有效值受其约束。 |
| 非法已存值 | 读取能力时安全回退，不把损坏值解释为更大的 Provider 原生窗口；保存路径继续校验合法整数。 |

合法 Custom 范围为 256–2,000,000 的安全整数。`contextMode: "auto"` 保留用户选择；新实例默认与已有设置读取是不同路径，不能通过配置数值猜测或静默迁移老 Auto。

## Mode、Source、Configured、Verified Native 与预算

Settings Context 状态同时展示：

- `Mode`：当前 Auto 或 Custom。
- `Source`：有效窗口来源，例如 `safe_fallback`、`user_provided_unverified`、`provider_native` 或 `provider_native_cap`。
- `Configured`：当前有效 Custom 值；Auto 显示没有生效的 Custom 值（即使旧配置保留了未启用数值）；坏配置显示 invalid。
- `Verified Native`：只展示明确带 `provider_native` provenance 的模型值；其余情况显示 `Unknown / Unverified`。90K 或 1M 用户配置不会被当成原生能力。
- `Effective`：本次预算采用的 context window。
- `可用输入` 与 `输出预留`：分别展示扣除输出、协议开销与安全余量后的空消息输入预算，以及当前输出预留。

只读 `llm:getContextDiagnostics` IPC 由 Main 注册并通过 preload 暴露。`LLMManager.getContextDiagnostics()` 用当前 Provider 能力调用真实 `planRequestBudget()`，返回 `contextMode`、`contextWindowSource`、`configuredContextLength`、`modelNativeContext`、`effectiveContextWindow`、`outputReserveTokens`、`usableInputBudget` 和 `budgetStatus`。Settings 显示的是基于已选配置与可用模型能力的空消息预估；实际请求仍由 Main 对完整消息重新计算并在发送前守卫。

`customContextLength=256` 仍是合法设置，但保留输出预留、最低安全余量和协议开销后，输入预算为 0。请求预算将 `budgetStatus` 标记为 `NO_USABLE_INPUT`，即使消息为空且 Token 计数为 0，`safe` 也为 false。界面说明当前值无法留出可用输入，并建议提高 Custom 值或降低输出上限；实际消息发送仍须通过完整请求预算守卫。

Provider context 改大不会增加玩家记忆策略上限。回归直接调用当前 `resolveMemoryBudget()`：4 人及以上在 1,000,000 context/headroom 下仍为 6,400 Token 上限。

UsageAnalytics 的上下文诊断沿现有白名单保存 `contextMode`、`contextWindowSource` 与 `effectiveContextWindow`；不保存提示正文、绝对路径或 API Key，也不把原始任意 context metadata 展开到记录中。

## 代码范围与自动化证据

相关实现位于 `src/app/main/main.js`、`src/app/main/config/settings-repository.js`、`src/app/main/providers/request-budget.js`、`src/app/main/provider-service.js`、`src/app/main/ipc/register-ipc.js`、`src/app/preload/preload.js`、`src/app/main/memory-system/player-memory-diagnostics.js`、`src/app/main/analytics/usage-analytics.js` 与 `src/app/renderer/assets/index-Dn3qWlAB.js`。专项为 `scripts/test-v9.3.6.2-context-compatibility.js` 和 `scripts/test-v9.3.6.2-provider-budget-regression.js`。

Node v22.23.3 最终专项均 **PASS**。context compatibility 验证 Main/Renderer 新 GLM 默认、老 Auto 保留、Custom 1M、可信原生 cap、坏配置回退、三项用户操作、Configured／Verified Native 状态字段与 256 预算提示；provider budget regression 验证 256 空输入发送守卫、输出预留、真实 diagnostics 与 memory budget 函数、UsageAnalytics 临时文件隐私白名单，以及只读 diagnostics IPC/preload 接线。合法候选诊断字段实际落盘，非法枚举、计数及比例投影为 null；正文、姓名、绝对路径与 Key sentinel 未进入持久化内容。

| 验收面 | 状态 | 说明 |
|---|---|---|
| Node 22 context compatibility 专项 | PASS | 包含最终 Configured／Verified Native 断言；不冒充 Electron 视觉验证。 |
| Node 22 provider budget regression 专项 | PASS | 使用真实预算/诊断/记忆预算函数及临时 UsageAnalytics 文件；不读取用户运行时数据。 |
| 隔离 Electron | PASS | 实际 VOTC.exe 双启动：新90K、Auto保存并重启保留、兼容按钮、1M、非法值与256警告，以及真实只读IPC；生成／外网调用0。 |
| 真实 Provider | NOT_RUN | 未发送真实模型请求，90K / 1M 原生支持未知。 |
| 真实 CK3 | NOT_RUN | 未验证游戏内行为。 |

隔离窗口新90K的实际预算为：Effective 90000、Configured 90000、Native null、来源 user_provided_unverified、输出预留4096、空消息输入75072。切Auto后Effective8192、来源safe_fallback、输出预留4096、输入3080；重启后仍为Auto。1M时输入918618，256时输入0并明确NO_USABLE_INPUT。三张设置截图已逐图检查可读性与按钮可见性；匿名[原生证据](v9362-native-evidence.json)。本地截图路径见 `.build/v9362-native-location.json`，不将截图复制到仓库。

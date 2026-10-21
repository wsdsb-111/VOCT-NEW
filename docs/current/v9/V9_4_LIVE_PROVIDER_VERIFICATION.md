# V9.4 真实付费 Provider 验证

2026-10-21 16:10（Asia/Shanghai）。用户明确授权总预算 **1 美元**；本轮实际执行 **6 次串行请求，全部 COMPLETE／stop，每次 attemptCount=1，无重试**。覆盖当前智谱官方 `glm-5.3-flash`，不将该结果扩展为其他六个 Adapter 的真实端点通过。

受测版本为提交 `56979afd4b174ee9fec198f9c7cd8255a6436c22` 的已部署资源，payload `759019e100cc0689868a0e0c540611e4eef75048ad73e4e57820c178dccbfc14`。该 SHA 的 [Windows CI 39563713574](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39563713574) 已通过完整发布回归与完整 EXE 冒烟；本报告为之后的文档补记，未修改生产 Runtime。

## 执行边界

- 使用 `resources/app/out/main/provider-service.js` 的真实 `LLMManager`，正式 Provider 注册表、分发 SDK、最终 Adapter preflight 和 `ProviderDiagnostics` V2；没有 mock transport。
- 只读选取当前 Provider；密钥按当前 Windows 用户解密后经匿名 stdin 传给一个 Node 22.23.3 子进程，不写入脚本、命令行或报告。测试证据位于忽略的 `.build/v9.4-construction/live-provider/`，诊断不写到 APPDATA。
- 全部输入为虚构夹具，Chat 使用真实 PromptBuilder 构造 V9 静态优先 Plan，含合成冻结的时间／第三人资料。两个轮次的冻结消息逐字节相同，当前提问变化。发送前检查 HMAC、消息、route、scope 和最终预算；**来源 verifier 使用合成授权，不代表真实 Conversation 的 CK3／Knowledge／Forget 权限已实测**。生产成功回调的召回→冻结状态转换仍由此前独立离线专项证明。
- 保留当前 `glmReasoningEffort=high`、`glmClearThinking=true`；仅本次内存配置将输出限制为 1024 Token、上下文设为 192K。`maxAttempts=1`，SDK `maxRetries=0`，每次 deadline 60 秒，间隔 2.5 秒。
- Action 仅请求测试 JSON schema `votc_live_probe`，校验返回 `ok=true`；不运行正式动作执行器或 CK3 Effect。Summary／Letter 验证生成、完成、用量与诊断接线，不签署游戏投递或叙事质量验收。

## 原生结果

输入、输出、缓存及推理 Token 均读取智谱原生证据；输出数已包含推理 Token，不重复计费。

| 场景 | 输入 | 输出 | 其中推理 | 缓存命中 | 结果 |
|---|---:|---:|---:|---:|---|
| V9 Chat 首次非流式 | 2905 | 13 | 8 | 0 | COMPLETE，精确输出 LIVE_OK |
| 相同消息流式复用 | 2905 | 28 | 23 | 2880 | COMPLETE，精确输出 LIVE_OK |
| 冻结内容不变、当前轮变化，流式 | 2905 | 18 | 13 | 2880 | COMPLETE，精确输出 LIVE_OK |
| Action JSON schema | 28 | 21 | 14 | 0 | COMPLETE，测试 schema 校验通过 |
| Summary | 134 | 34 | 10 | 0 | COMPLETE，非空回包 |
| Letter | 32 | 32 | 15 | 0 | COMPLETE，非空回包 |
| 合计 | **8909** | **146** | **83** | **5760** | **6/6** |

两次流式均收到一次原生 usage 更新，终局返回继续保留原生用量。推理／可见 TTFT 分别为 2165／2493ms、2288／2575ms；样本太少且首次请求为非流式，不据此宣称延迟改善。

六条 V2 记录均观察到 `ADAPTER_FINAL` 和安全最终预算。Chat 的 Plan／Owner 为 `PLAN_OBSERVED`／`VERIFIED`（合成授权）；Action、Summary、Letter 保持 `LEGACY_OBSERVED`／`UNKNOWN`。0 命中记录为 `PROVIDER_REPORTED_ZERO`，2880 命中为 `PROVIDER_REPORTED`，miss 为 `DERIVED`，真实服务端断点保持 `UNKNOWN`。两个流式请求归同一参数组，与非流式组分开；新轮首个变化块为 `CURRENT_TURN`／`DYNAMIC`，message position 28。

## 费用与停止条件

执行前核验[智谱官方价格](https://docs.bigmodel.cn/cn/guide/start/pricing)：GLM-5.3-Flash 每百万 Token 输入 ¥0.8、输出 ¥2.8、缓存命中 ¥0.23；缓存存储当前限时免费。[官方缓存说明](https://docs.bigmodel.cn/cn/guide/capabilities/cache)定义原生 `cached_tokens` 与隐式复用。

本轮估算：`(8909−5760)×0.8/1e6 + 5760×0.23/1e6 + 146×2.8/1e6 = ¥0.0042528`。即使全部输入按未命中计价，也仅为 **¥0.007536**。这是原生 Token × 官方价的估算，不是账户账单回执。

测试内部上限 **¥0.5**；每次 transport 前以最终 payload UTF-8 字节数加 8192 的保守 Token 预留、全部输入按未命中价和完整输出上限计费，追加并 fsync 费用账本。六笔累计预留 **¥0.0912176**，请求完成也不退回预留；失败／超时／未知用量立即停止，不透明重发。最多允许 8 次，但本轮满足验证目标后停在 6 次，没有继续消费剩余预算。初始运行由根代理保证唯一实例；静态复核后另补排他执行锁，崩溃留锁拒绝后续运行，未再次发付费请求。

本地匿名证据审计通过：6 笔预留、6 笔结果、0 失败，原生总数与 V2 分类相符。脚本、密钥和用户配置未提交；此报告只记录虚构测试的计数及边界。真实 CK3、桌面输入／焦点、Soak、其他 Provider 的真实端点及多人数大窗口性能仍各自待验收。

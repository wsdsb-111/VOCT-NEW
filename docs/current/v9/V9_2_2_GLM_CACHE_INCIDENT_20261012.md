# 2026-10-12 GLM 原生零命中实机审计

用户要求冻结 Durable，直接分析本轮后台。基线 `main / 071f62b`；本轮仅增加审计文档，Runtime、Prompt、Provider 参数、Durable 与用户业务数据均不修改，没有新增付费 API 调用。正式 App/UI 保持 9.2.0/V9.2。

## 结论与窗口

后台 Usage 与 Provider Diagnostics 的本轮八条 GLM chat 逐条对应，原始 nested `prompt_tokens_details.cached_tokens` 与 Analytics 完全相同。统计窗口为北京时间 **17:43:15.337–17:54:27.421**；其中 GLM 完成请求为 **17:45:08–17:53:00**。输入 86367、命中 28864、未命中 57503，加权命中率 **33.4202%**，八次中五次供应商原生报告零。不是把缺失 usage 当成零，也不是本地估算命中。

本轮没有发现可证明的应用侧缓存失效缺陷：八次均为同一 conversation/responder、相同端点、相同有效参数和 v813，完整稳定前缀的序列化 SHA 相同；七次可比请求均从动态 history 才出现首差异。cacheEpoch=0、rollingSegmentCount=0，没有压缩／滚动换代。日志中的八次 GLM Chat 调用与本轮对应，没有应用级重试或取消记录。

| 完成时间（北京时间） | 原生命中 / 输入 | 首差异块 | 共同消息数 | 共同前缀 Token 估算 | 距前次完成至本次开始（秒） |
| --- | ---: | --- | ---: | ---: | ---: |
| 17:45:08 | 0 / 9986 | 本地无前序比较 | UNKNOWN | UNKNOWN | UNKNOWN |
| 17:46:12 | 0 / 10228 | history | 20 | 8760 | 55.589 |
| 17:46:49 | 9472 / 10427 | history | 22 | 8980 | 25.638 |
| 17:47:52 | 9472 / 10507 | history | 24 | 9200 | 53.498 |
| 17:48:47 | 9920 / 10820 | history | 26 | 9469 | 45.550 |
| 17:50:24 | 0 / 11115 | history | 28 | 9703 | 80.819 |
| 17:52:20 | 0 / 11388 | history | 30 | 9978 | 102.119 |
| 17:53:00 | 0 / 11896 | history | 32 | 10290 | 30.450 |

共同消息数按完整 messageHash 比较，稳定前九条消息始终相同；Token 数只是应用估算，不是供应商真实缓存断点。首次本地无比较不等于供应商一定冷启动。三次正命中单次均在 90% 以上，只能作为事后描述，不能选择性剔除零命中后宣称总体恢复。

当天上一次保留的 GLM 窗口为 13:08:48–13:13:30，十二次输入 204075、命中 127808，加权 **62.6280%**，两次零命中。它与本轮人物／证据及长度不同，不能作为受控前后 A/B。两轮有效参数与端点指纹相同，但不同会话的稳定内容不同。

## 原因等级与改进决策

确证的是“相同应用前缀与参数下，供应商仍返回零”，更符合缓存驻留／淘汰或后端路由波动这一类供应商侧解释；具体根因仍 **UNKNOWN**。应用后台没有缓存节点、淘汰记录、供应商请求 ID 或账单证据，不能认定供应商故障。80.819 秒后高命中转零可能与驻留有关，但随后仅 30.450 秒仍为零，初次零后 55.589 秒也为零；不能推导固定 60 秒 TTL。

[官方缓存文档](https://docs.z.ai/guides/capabilities/cache)说明缓存自动识别重复内容、通过 nested cached_tokens 报告，并有时间限制；该文档没有提供可用于判定本轮的具体驻留秒数。国际端点文档只作机制参考，本轮实际为 BigModel，不能把两个服务区域的路由或 TTL 当作同一事实。

不重排 v813、不增加 cache anchor、不减少事实／历史、不自动预热或对零命中收费重试：这些改变没有本轮根因证据支持，还会增加成本或破坏已有可复用前缀。现有诊断已正确标出 `provider_zero_despite_large_prefix`，无需再添加同类观测代码。

[官方 Preserved Thinking](https://docs.z.ai/guides/capabilities/thinking-mode)要求 `clear_thinking=false` 时完整、原样回传历史 reasoning_content。本轮没有执行该模式的质量／成本实验，不将切换 clear_thinking 或保留推理作为已验证修复，也不把清理推理直接等同于清除整个上下文缓存。

如需进一步定位，应做同一 GLM 配置的合成原生对照，固定完整消息并只改变调用间隔，对照“原样重复”和“仅追加尾部”，保留全部零值、TTFT 与供应商请求 ID，再确认是否需要供应商协助。此项本轮未执行，不能沿用上轮付费授权自动追加请求；实际账户／缓存节点的变化仍不可观测。

## 验证与冻结

- `node scripts/test-v9.2.1-glm-v813-prefix.js`：主机真实原子文件替换夹具 **12/12 PASS**，含角色切换、Campaign、Forget、实时状态、Unicode/角色/name、原生 0/UNKNOWN。初次 sandbox 运行被原子 rename 权限阻断，随后主机重跑通过；没有用复制／删除替代原子操作。
- `node scripts/test-v8.8.5-zhipu-provider.js`：PASS，流式 usage-only 尾块与 GLM 参数合同保留。
- `node scripts/test-real-request-diff.js`：PASS，作用域、参数、哈希、异常分类与脱敏合同保留。
- `node scripts/verify-runtime-build.js --deployed`：287 源码／交付哈希一致。仅文档新增，因此不需要重新构建部署或用完整发布回归冒充新的实机性能验收。
- 独立只读代码审查与实际后台结果一致；本轮两个输入统计文件读取前后 SHA 不变。未清理用户缓存、配置、记忆或恢复队列。

源码依据：`providers/index.js` 的 Zhipu 同构请求构造器与流式最终 usage、`providers/usage-normalization.js` 的空值合并、`provider-service.js` 的 Chat 请求预算与 trackUsage、`prompts/prompt-builder.js` 的 v813 冻结块、`analytics/real-request-diff.js` 的消息／参数比较。Durable 按用户指示保持基线字节；冻结改动范围不等于签发 Full Freeze 或新的 Provider 性能验收。

脱敏逐条证据见 [JSON 清单](glm-cache-20261012-evidence.json)。原始后台文件和完整日志仅在用户本地，未复制到仓库。

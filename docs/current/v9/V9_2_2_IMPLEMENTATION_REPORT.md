# V9.2.2 Durable 安全与诊断候选实施

2026-10-12，基线 `main / edb3896`，依据[施工方案](V9_2_2_DURABLE_INCIDENT_PLAN.md)。本轮定位并修复发送边界竞争及范围归因缺陷，补齐今后真实请求树；正式 App/UI 保持 9.2.0/V9.2，缓存收益验收为 HOLD。

## 事故结论

[基线与逐条记录](V9_2_2_BASELINE.md)核对 14 次、729898 输入、70144 命中、9.6101%。12 次 User 指纹可精确对应保留恢复快照，包含多范围长证据、128 分块和与截断后二分吻合的 98→49+49 请求。日志确认 `memory4_invalid_event_status` 失败。恢复库存有 146 份，本窗口更新的 21 份涉及 6 个 Owner，并非只含新一轮短对话。未把这些库存数量当作请求次数。

低总命中率的主要可证因素是大比例的易变／首次发送证据输入；截断和恢复可能进一步放大输入。旧元数据缺少实际入口、原生 finish_reason 及父 Attempt ID，不能宣称已完整证明 14 次的真实树。诊断跨 Owner 串线影响本地首次差异说明，不会改变 DeepSeek 原生 hit。

## 最小生产改动

| 源码 | 行为及边界 |
| --- | --- |
| `memory-system/memory4-coordinator.js` | 捕获同步发送校验回调，复核当前 Forget、范围／来源修订及持久化恢复快照；普通提取在 Forget 确认变化时最多刷新一次，空来源不发送。Legacy 编辑／失效只安全拒绝并保留原恢复合同。加上入口、分块、二分、解析／提交状态的安全追踪。 |
| `provider-service.js` | 能力查询之后、正式 Provider 调用之前同步验证；追踪最终有效参数和真实 native presence，估算值不补成原生零。内部控制对象与 metadata 分开。 |
| `providers/index.js` | 同一可选控制回调沿七种 Provider 的非流式 Durable 路径到每次实际 SDK/fetch 发送（含退避重试）；typed source-change 错误保留。OpenRouter/Player2 在受控 Durable 请求中禁用隐藏的 SDK 自动重试，保留现有应用级重试；普通聊天／其他调用不传此控制对象，保持已有行为。未更改 JSON 请求形状。 |
| `analytics/durable-request-trace.js` | 默认关闭、内存上限 500（硬上限 2000）的白名单 recorder；随机 run/attempt UUID，带临时随机盐 HMAC 的 Owner/Campaign/finalization/内容与参数指纹。超限标记 dropped/truncated；失败不影响业务。不写第二份用户数据或原始文本。 |
| `analytics/usage-analytics.js` | Durable 首次内容差异比较仅在五个范围／可比性哈希完整相同后建立链；A→B→A 的 A2 只与 A1 比较，注明中间跨范围。历史无关联记录标 `unattributable_cross_owner`，原生总 hit/miss 数值保持一致。 |
| `main.js`、`conversation/conversation.js`、`letter-memory-finalization.js` | 注入同一 recorder，完整转发安全元数据及 guard，分别明确 finalization/recovery/legacy/letter 入口。 |
| `ipc/register-ipc.js` | 现有性能诊断导出附加 `durableTrace` 安全包；保持既有 IPC 名称。 |

已按 `build/runtime-inputs.json` 新增一项映射并构建部署；默认 Prompt、Anchor、block ID、fragment 顺序、128 硬限、每 Owner 八条额度、4096 输出限额均保留。Store、schema、解析校验、ACL/知识边界、Forget、Commitment、Action、Letter 效果合同未削弱。GLM Chat 的 v813 布局、推理强度、clear_thinking 和实际请求不变；Zhipu 仅在被选择为 Durable Provider 时转发同一发送控制。

## 复现与修复

独立 QA 用真实 Store tombstone 与真实 Coordinator→LLMManager、异步能力查询和 mock Provider 复现：删除 A 后释放等待，基线依然将 A+B 传给 Provider，明确断言 RED。修复后 F01–F06 全绿：只发送 B、全部遗忘零发送、原始字节保持、能力失败／超时回退不绕过门禁、取消零发送、已发送后的 Forget 不声称撤回并继续过滤提交。另验证持久化 sourceRevision 在等待期间改变：typed 拒绝、零出站、不做无根据刷新。

独立追加 RED 发现：旧请求被拒绝后，原失败处理会回写旧 snapshot，覆盖等待期间的新 revision。本轮禁止 typed stale 请求回写旧恢复快照；GREEN 证明新 revision 保留且 `recoverPending` 可用一次授权请求恢复。恢复 JSON 在等待期间损坏时零发送、原始坏字节保留，不覆盖事故证据。

真实 DeepSeek `_nonStreamChatCompletion` 的离线 SDK fixture 第一次 create 注入 ECONNRESET，第二次发送前来源改变：两次 guard、一次 create、typed 错误原样传播。分块 fixture 验证 129=128+1，四片段截断完整七节点树计入全部 12 次片段提交和父子输入；单片段失败一次停止；累计八条 transitions、后续 superseded 替代索引正确。未知／未报告／零缓存独立。

同一离线夹具覆盖七种真实非流式适配器：内部重试之前再次校验、typed 错误不丢失、旧来源不再次 SDK/fetch；检查取消信号转发、普通／受控请求 JSON 相同，以及 OpenRouter/Player2 的 SDK retry 限制只对 Durable 控制生效。

## 原生实验

[全部 28 次脱敏尝试](v9.2.2-durable-native-ab-evidence.json)通过 `buildPrompt` 与正式 `DeepseekProvider.buildDiagnosticRequest` 发送合成证据，单 fetch 禁止收费重试；不是对真实 CK3 对话的质量验收，也不是完整应用 finalization 的实机运行。每次原生用量、finish、严格解析状态／精确错误码均保留。28/28 parsed OK；按[官方高峰价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)并加 50% 余量，费用上界 **1.00864056 元**，小于用户授权 10 元，未独立查账单。

| 合成对照 | V9.2 原策略 | V9.2.1 固定 Policy（本候选保持） |
| --- | ---: | ---: |
| 同 Owner／证据暖缓存（预定 sample 1/2/4/5） | 92.0863% | 91.0627% |
| 同标签 Owner 切换的单次请求 | 640/2224 | 640/2249 |
| 额度变化第二次请求 | 256/2224 | 2048/2249 |
| 长 128-fragment 首次请求 | 0/140192 | 0/140217 |
| 所有 14 次／每策略加权 | 6.74498% | 7.78984% |
| 所有样本输入／命中／未命中 Token | 168896 / 11392 / 157504 | 169246 / 13184 / 156062 |
| 所有样本输出 Token | 2359 | 3180 |
| P50／P95 耗时（nearest rank，毫秒） | 1197 / 3052 | 1256 / 5360 |

首发长冷请求占分母绝大部分，故总比例仍低，但相同来源重复能高命中。固定 Policy 在这组额度变化中保留更多前缀；小样本不证明广泛收益。A/B 使用合成 case 标识隔离共享缓存，各 case 冷／暖与不同因素分开，不把不同 Owner 请求计入同范围暖样本。没有修改 provider model/temperature/endpoint；请求／响应模型名称都记录。

这次长 140k 输入的合成请求仍完整解析，没有证明“缩小 Token 块必然更优”；事故树又缺少直接 parent/finish 证据，因此保留现有分块，未引入猜测阈值。需要下一轮真实来源的安全追踪后比较截断率、质量、全部输入和费用，不能仅提高百分比就宣称收益。

原生样本未提供 activeCommitments，故 Commitment 证据合法率为 NOT_EXERCISED，不能填 100%；受控截断采用自动化夹具，原生缓存驻留只覆盖近时与三秒间隔，TTL 为 UNKNOWN。未运行实际应用 Finalization，逻辑 job 倍增分母未知。上述输出量／P95 变化也阻止签发性能改善；G5-CACHE 选择 **HOLD**，解释为有限可复用前缀，不宣称真实 9.6% 已恢复到 60%。

## 诊断使用

普通启动不记录该追踪。用户主动以现有 `--diagnostics` 启动后，可从现有性能诊断导出获取带 `durableTrace` 的 JSON；仅内存保存，退出丢失。HMAC 盐只在当前进程，跨进程窗口不能比较。报告不含人物 ID、Prompt、响应文本、凭据或私有路径。

显式文件报告命令：`node scripts/v9.2.2-durable-incident-report.js --usage <本地Usage文件> --trace <导出的性能诊断JSON> --baseline docs/current/v9/v9.2.2-incident-baseline.json`。不自动扫描 APPDATA；输出三层 provider_native/exact_app_content_diff/local_estimation、UUID 对账、UNKNOWN 与完整性。无法证明 raw miss 时不冒充原生 miss，费用仅给 Token 代理量而非账单。导出的 User 敏感信息仍不进入工具输出。

没有实际 wire serializer 的适配器不生成 effectiveParameterHash/requestHash，相关内容比较保持无法严格归因，不把内部 request 对象冒充供应商 wire 参数。Zhipu trace 从既有规范化 usage 读取 input/hit/output，并核对 raw_usage 中显式 miss 的存在；规范化派生 miss 不当作供应商已报告 miss。请求输出限额与有效限额分别记录，4096 请求被模型能力压到 2048 时仍保留两者，离线夹具验证通过。

## 验证命令与回滚

四项专项：`node scripts/test-v9.2.2-durable-lineage.js`、`node scripts/test-v9.2.2-durable-attribution.js`、`node scripts/test-v9.2.2-presend-forget.js`、`node scripts/test-v9.2.2-durable-chunking.js`。构建依次执行 `runtime-dependencies.js`、`build-runtime.js`、`verify-runtime-build.js`、`deploy-runtime-build.js`、`verify-runtime-build.js --deployed`；完整回归为 `node scripts/test-release.js`，实际隔离窗口为 `node scripts/v9.0-performance-packaged-smoke.js`，两者串行运行。结果及当前限制见[验证报告](V9_2_2_VERIFICATION_REPORT.md)和[问题台账](V9_2_2_P_ISSUE_LEDGER.md)。

本轮私有备份已验证业务与代码字节；部署使用现有 receipt/原子替换回滚合同。若需回退，先退出应用、保留当前业务数据及 tombstone，按源码边界回退有问题的新增改动，再 build→verify→deploy→deployed parity。不得直接覆盖用户数据、删除恢复记录或回退本轮已证实的 Forget／旧 revision 保护。没有执行回滚或真实来源重放。

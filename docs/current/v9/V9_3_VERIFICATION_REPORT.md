# V9.3 候选验证报告

本轮代码提交 `218fd1a91227ae33a31ce8a085cda8ce8e044dae`；源码构建输入摘要 `60ecceb1d406a83ba67ea7a23a67bfb1c8d682a3f9c889f2555dd35f70322d31`。正式Core/UI V9.2、App9.2.0保持，候选待本轮实机／最终CI，不能签Full Freeze。文档提交只补证据和入口，不改变该运行时输入。

| Gate | 本轮状态 | 证据与限制 |
|---|---|---|
| G0 基线／备份 | PASS | [基线](V9_3_BASELINE.md)，e1c3c37历史CI成功单独留证；3894业务／设置文件、579代码资源、13存档逐字节备份。 |
| G1 Capabilities | OFFLINE_PASS | 七Adapter三态、证据来源、实例／端点／model／route／协议隔离及5分钟缓存。真实端点功能缺证据继续UNKNOWN。 |
| G2 Result／Usage／Reasoning | OFFLINE_PASS＋有限NATIVE | 严格STOP、用量原生／估算、0／UNKNOWN／INCONSISTENT、reasoning仅presence、缺失及非法字段分别处理。原生及离线回放边界见下。 |
| G3 Structured／Abort／Retry | OFFLINE_PASS | 39匿名Golden、18独立QA、[40核心场景映射](v93-conformance-evidence.json)；Unsupported预发送拒绝、最大2attempts、SDK0、部分流／未知网络不重放、source／Forget每transport复核。 |
| G4 业务一致性 | 针对回归PASS | 原Action/Letter/ACK、Durable、Detail/Legacy、Commitment、Forget、合法历史只读通过；Year/Life自动请求与重建仍0，固定SKIPPED。CK3本轮真实效果仍待人工。 |
| G5 构建／发布组 | FULL_LOCAL_PASS | 最后两处用量修复后的完整门禁432/432 PASS；293源码／资源哈希及deployed parity PASS，5981依赖文件／264包锁定保持。504 test文件已分类，432 release组，71 historical checks。 |
| G5 实际打包窗口 | AUTOMATED_PACKAGED_PASS | 真实VOTC.exe、独立可丢弃profile，Main哈希、Renderer/Preload/IPC、4条纯合成Provider route、stream tail/guard/单次记账、目录合并及诊断开关通过；窗口截图目视确认。本证据不等同CK3人工验收。 |
| G5 最终SHA CI | NOT_VERIFIED | 未自动推送；沿用用户前次自行推送偏好。最终main提交的GitHub Actions必须另行核验，不能引用旧e1c3c37。 |
| G6 CK3／Soak／可比性能 | NOT_VERIFIED | 需要本轮三人对话、最终摘要/保存、Action与Letter回读、取消重开及Soak。无同负载A/B，不能宣称提速、缓存率或节费百分比。 |
| G7 文档／移交／冻结 | DOCUMENTED_CANDIDATE | [七Provider支持矩阵](V9_3_PROVIDER_MATRIX.md)与[V9.4移交](V9_3_HANDOFF_TO_V9_4.md)已补齐；共享代码提交未逐Adapter拆分，实际回滚边界在实施报告明示。人工和最终CI未闭合，不签Full Freeze。 |

## Provider支持矩阵

| Provider | 离线／Mock | 本轮真实端点 |
|---|---|---|
| DeepSeek | PASS | 现有deepseek-v4-flash：非流Chat、流Chat、Action小Schema、Durable空载荷各2次，共8次COMPLETE/STOP并验证原生输入／输出；没有Effect或真实记忆提取。完整Native Action Schema强制执行未证明。 |
| OpenRouter | PASS | z-ai/glm-5.3-flash非流Chat1次真实返回COMPLETE/STOP与数值；当时初版归一化误判缺失miss，探针保留reserve并停止。修复后仅匿名数值离线回放通过；流式、Action、Durable等7次计划未发，仍NOT_VERIFIED。 |
| 智谱GLM | PASS | PRICE_UNKNOWN，未调用本轮付费生成；v813／clear_thinking／推理配置及旧冻结签名保持。不能把旧43.1%实机窗口当本轮新验收。 |
| OpenAI-compatible | PASS | 自定义端点的精确计费未闭合，PRICE_UNKNOWN，未付费。标准／兼容Schema出站各自冻结。 |
| Player2 | PASS（用户指定Mock） | NOT_VERIFIED，无真实生成请求。 |
| Ollama | PASS（用户指定Mock） | NOT_VERIFIED，既有Native消息／options／NDJSON保持；没有新增format字段，不宣传Native完整Schema。 |
| Gemini | PASS（用户指定Mock） | NOT_VERIFIED，保留systemInstruction及既有Schema子集，不宣传完整Schema强制能力。 |

## 原生实验与两处小修复

北京时间2026-10-13 12:40:14.854–12:40:25.931，唯一一轮9个合成attempt（原计划最多16），总授权USD1，累计预留USD0.06228994。原生数字按计划最高费率计算的上界USD0.00130368包括第9次OpenRouter USD0.00022008；这不是确认账单，预留不释放。DeepSeek原生输入896／输出679、hit0／miss896；reasoning仅2次有报告，6次缺失保持null。OpenRouter报告输入75／输出127、hit0／reasoning79／total202，miss未报告。

OpenRouter适配器保留旧返回形状，会补一个own-property `prompt_cache_miss_tokens: undefined`。初版readNumber把它误判INVALID，导致INCONSISTENT。精确反例先RED，再最小修为null/undefined不作已报告；可算75只标DERIVED，native miss仍null。独立QA另发现显式bad/-1仍可能同时被推导值遮蔽，第二条最小修只允许NOT_REPORTED字段推导；显式非法保留INVALID且derived=null。两组RED/GREEN、跨七Adapter的undefined/null/非法值/显式值反例、最终18/18独立QA通过。

[原生匿名摘要](v93-native-summary.json)保留原运行状态，不改写原第9次USAGE_UNKNOWN；[修复后离线回放](v93-native-postfix-replay.json)仅用9次匿名数字投影，9/9数值归一化通过，没有新Provider请求或凭据读取。原账本SHA-256 `2a67f5074f5f03e4d1b845e407d2e5818b1330e993586d8e80f7397f6dc71eee`；最终normalizer源码SHA-256 `cf546ed5e653e00c859e800ecbd5b599c4a4db354d44251c6bbdfda2399caa43`。原账本只在忽略的.build，未提交正文、配置或凭据。

费用参考[DeepSeek官方定价](https://api-docs.deepseek.com/quick_start/pricing/)与[OpenRouter该模型当前公开路由价](https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints)。OpenRouter发送前32条公开路由最大input0.225／output1.6／cache-read0.099 USD/M均不超规划；采购信用额度的账单没有读取。用户USD1总上限覆盖本轮，不继承旧人民币10元许可。

## 自动化记录

新增测试均在test-manifest登记：capabilities、result/usage、cancellation/retry、adapter-conformance、independent-qa。e1c3c37全git-show加载的原始独立基线23 RED／4 PASS，保留原日志不重写；候选18 PASS／0 RED／0 SKIP。39冻结出站Body与有效参数保持；GLM历史usage签名仍`56a9c120bc9b334e2eadec8a75297abf3c97c55ffc1ee2fbc6f27bfb4473d747`。

构建、verify、deploy、verify --deployed及锁依赖验证均按既有脚本；沙箱对合成目录rename的EPERM以主机权限执行同一原子机制复核，没有用copy/unlink替代。旧成功mock补明确stop；合法但语义越界的反例也标完整生成以继续验证来源门禁，错误、length、未知finish不放宽。

最终完整命令 `node scripts/test-release.js` 的修复后记录为 `.build/v93-release-postfix-final.log`，退出0、432组PASS，日志SHA-256 `155531dbab7680c44c094469f022826cdfac2fc0f5fe16e3faf0873fd13899fc`。另核验 `runtime-dependencies.js`、`verify-runtime-build.js --deployed`、主题／Official Action专项、根目录要求的七个生成JS语法检查及 `git diff --check`。文档收口不改变已验证源码输入；独立最终提交CI仍NOT_VERIFIED。

隔离实际窗口第一次隐藏截图被Chromium暂停；改为不抢焦点短暂显示窗口后，诊断开／关两实例及截图通过，自动退出。空profile的Player2健康提示为阻断网络后的预期错误，未作真实生成测试。截图和本地测试日志不进入仓库，不含真实用户配置。

最终完整门禁后再次串行执行 `.build/v93-packaged-smoke.js`，诊断开／关两实例、四条纯合成Facade路径及截图再次PASS；退出0且无残留VOTC进程。记录 `.build/v93-packaged-smoke-postfix.log`，不会并行运行打包窗口与发布门禁。

[实施](V9_3_IMPLEMENTATION_REPORT.md)与[问题／支持台账](V9_3_P_ISSUE_LEDGER.md)解释保留的范围及未完成Gate。

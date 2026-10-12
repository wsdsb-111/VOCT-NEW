# VOCT V9.2.2 — Memory4 Durable 缓存异常、请求倍增与诊断可信度修复施工文档

> **文档性质**：可直接交给 Codex 按工作包执行的设计与验收规范（Proposal，非“已完成”报告）  
> **拟议版本**：V9.2.2 / Memory4 Durable Cache Incident Hotfix  
> **基线**：`wsdsb-111/VOCT-NEW` · `main` · `edb389623ba34e8a668779b74509d8f1b2bf78cb`（V9.2.1 候选，Git 提交标题仍为 `v9.2`）  
> **对照版本**：`6026713d88deeafef6cf45e6a07405908c98e030`（V9.2）  
> **依据**：`docs/current/v9/V9_ROADMAP.md` §7.3–§7.5、`V9_2_1_VERIFICATION_REPORT.md`、`V9_2_1_P_ISSUE_LEDGER.md`、`V9_2_1_HANDOFF_TO_V9_3.md`、最新三人对话缓存面板与实际源码  
> **施工状态**：尚未实施。本文件中的问题等级、目标和接口均为待执行规范；不得把它们写成已通过的测试。  
> **阶段定位**：V9.2 的局部维护补丁。**不改变 V9.3 Provider Platform 与 V9.4 PromptPlan/Cache 的主路线。**

---

## 0. 执行摘要与最重要的判断

V9.2.1 把 Memory4 durable System 中的动态额度变成固定 Policy，保留了 Memory4 的安全合同；但用户在三人对话后的新统计窗口看到 durable 缓存率由历史窗口约 59.9% 降为 **9.6%**。这不是严格的同工作量版本 A/B：请求量、Owner 数、证据大小、冷缓存比例均可能不同。现在**不能直接断定 V9.2.1 把服务商缓存实现破坏了**。

V9.2.2 必须按下列顺序工作：

1. **回答“14 次 durable 是谁、为什么、因何重试而发出的”**。逐条关联 Owner、finalization、来源、批次、递归路径和实际 Provider usage；不能只凭三人对话假设本来应该只有三次。
2. **修复跨 Owner 的相邻请求诊断串线**。原生 cached tokens 保持原值；只改变匿名关联和归因可信度，不美化命中率。
3. **保护真实出站 Forget 边界**。V9.2.1 已修复递归重试前的过滤，但 `sendSummaryRequest()` 在正式传输前还有异步能力查询，须证明这期间的 Forget 不会发出过期证据。
4. **量化冷缓存、新 Policy、Owner 切换、超长片段与截断重试各自成本**，再决定是否实施**有证据的**分块最小修复。
5. **用供应商原生 Usage 进行受控对照**，保持 Memory4 质量/隐私与 JSON 约束。无法证明改善，记为 `HOLD`，不标记“缓存修复成功”。

> **禁止“修复”手段**：跨 Owner 共享动态证据、冻结已经改变的授权状态、缩减 Memory4 校验、删除 Fragment、凭感觉加大模型 `max_tokens`、取消 Forget、篡改缓存统计，以及为了 KPI 大规模重排 Prompt。

---

## 1. 实机事件记录及可确认事实

### 1.1 当前窗口（用户 2026-10-12 三人对话截图）

| 请求类型 | 请求数 | 总 Token | 输入 Token | 缓存命中率 |
|---|---:|---:|---:|---:|
| `memory4_durable / deepseek-v4-flash` | **14** | **748,927** | **729,898** | **9.6%** |
| `memory4_life / deepseek-v4-flash` | 21 | 371,777 | 303,628 | 98.6% |
| `memory4_year / deepseek-v4-flash` | 17 | 236,405 | 178,400 | 98.3% |
| `chat / glm-5.3-flash` | 12 | 206,799 | 204,075 | 62.6% |
| `action / deepseek-v4-flash` | 12 | 50,126 | 49,403 | 61.7% |

Durable 平均输入约 `729,898 / 14 ≈ 52,136` Token/次。按 UI 四舍五入的 9.6% 估算，有约 7.0 万命中、约 66 万未命中输入 Token，**这只是数量级，不是精确原始账单**。

旧窗口 `memory4_durable` 为 **372 请求 / 20,030,998 输入 / 59.9% 命中**，不同窗口不能直接当作 V9.2 vs V9.2.1 的因果对照。

### 1.2 截图中两类诊断（互相重叠，不可相加）

- **估算未命中断点**：`summary_dynamic / Summary Generation Request` 7 次，区块自身 339,939 Token；`summary_stable / Stable Memory4 Durable Policy v9.2.1` 7 次，区块自身 5,285 Token、之后连带估算 314,530 Token。
- **相邻请求最早内容变化**：`memory4_durable / Summary Generation Request` 13 次，关联未命中估算 609,803 Token。
- 这些不是供应商逐段缓存报告，也不是“7 次 System 出现实际字节变化”的证明。Stable Policy 的分类名称来自本地诊断规则，可能在相邻跨 Owner 请求的估算中被分配未命中，**即使 Policy 本身逐字相同**。

### 1.3 已确认的代码事实

| 事实 | 具体源码 | 意义 |
|---|---|---|
| durable System 的动态额度已移至 User JSON 最后 `limits` | `src/app/main/memory-system/memory4-coordinator.js` `buildPrompt()` | 同一 Policy 在不同额度下应保持字节一致；旧版 Policy 修改后发生冷缓存切换 |
| `prepareSummaryMessages()` 为 Summary 加公共 Anchor | `src/app/main/prompts/prompt-builder.js` | Anchor 与 Policy 可以作为公共前缀；**不能说所有 5 万 Token 都可跨 Owner 缓存** |
| User JSON 以 Owner/Campaign/Date/Commitments/Fragments 开头 | 同上 `buildPrompt()` | 各 Owner/不同回合的大段 User 通常不共享长相同前缀 |
| `MAX_FRAGMENTS_PER_REQUEST=128`，截断后递归二分 | `memory4-coordinator.js` `finishOwner()/extractChunk()` | 可能造成额外 API 调用和重复输入，**本次 14 次的构成未知** |
| `finalizeCommitted()` 最多两个 Owner Worker 并发 | `memory4-coordinator.js` | 三人不等于同一时刻三份连续热缓存请求 |
| `recoverPending()`、`recompressLegacy()` 可另外触发 `memory4_durable` | 同文件 | 对话窗口内的 durable 不一定全部属于此次三人 Finalization |
| `main.js` 的 `requestDurable` 包装器没有把 Owner 的匿名诊断身份传入 Usage | `src/app/main/main.js` | 多 Owner 的 `characterId` 可能为空，造成分析比较链串线 |
| `usage-analytics.js` 使用 `requestType/provider/model/responderKey` 比较相邻 Prompt | `src/app/main/analytics/usage-analytics.js` | 当前 durable 很可能跨 Owner 关联；影响“最早变化”，**不改变厂商原生命中值** |
| `sendSummaryRequest()` 在 Provider 调用前 `await getProviderCapabilities()` | `src/app/main/provider-service.js` | 需要测试 Forget 检查后至真正发出前的异步时间窗 |
| DeepSeek 原始 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` 已接入 | `src/app/main/providers/index.js` | 不应人为修改或替代供应商报告值 |

### 1.4 未证实的假设及排查优先级

| 假设 | 证据级别 | 必须怎样验证 |
|---|---|---|
| 新 Policy 造成首次请求冷缓存 | 合理推断，**未量化** | 按 policyHash/cold-warm 分桶，重复同模板合成请求 |
| 同一三人对话对应 14 次正常 Durable 提取 | **未知** | 14/14 请求来源关联、Owner、finalization、batch、retry tree |
| 4096 输出上限导致多次截断/二分 | 代码路径存在，**现场未知** | 每次 `finish_reason`、`truncated`、`retryDepth`、`parentAttempt` |
| 由于 Policy 固定化导致命中率必然持续下降 | **不成立为已证实结论** | 同证据、同模型、匹配冷/热条件的原生 A/B |
| Life/Year 98% 证明 Durable 也应有 98% | **错误推断** | 不同生成任务、输入结构、重试流程单独统计 |
| 供应商缓存整体失效 | 现有现象**不支持** | Life/Year 的高命中是反向信号；仍以端点原生记录为准 |

---

## 2. V9 路线边界、范围与非范围

### 2.1 当前 V9 路线的阶段合同

- V9.2：Application Boundary & JSON Repository；V9.2.2 只能在其维护范围内解决故障。
- V9.3：Provider Platform；统一 capabilities、普通/流式生成、结果/Usage/Reasoning/FinishReason、超时取消与 429/5xx 等。**本次禁止重写七 Provider 平台**。
- V9.4：PromptPlan、稳定前缀与完整缓存架构；**本次禁止引入通用 PromptPlan、全局 Serializer 替换或改写旧布局**。
- V9.5–V9.9：UI、CK3 Bridge、Workshop、退役、RC，均不提前施工。

### 2.2 本版允许改动

- `Memory4Coordinator` 内部的**小范围诊断**、请求来源关联、批次/截断统计及**经测量证实的**重试修复。
- `main.js` 各 Durable 入口到 `LLMManager.sendSummaryRequest()` 的**仅用于本地观测的元数据传递**，不能改变供应商请求中的真实 `messages`、model、thinking、JSON 输出设置。
- `UsageAnalytics` 的相邻请求归因键和诊断过滤；增加独立、可选、脱敏的 durable 请求链路报告。
- `ProviderDiagnostics` 的匿名补充字段及出站确认日志；不得输出原文、API Key、Owner 明文、对话文件绝对路径。
- 狭窄的 Durable **最终传输前授权二次校验**，且保持 V9.2.1 每次二分请求前过滤和解析/提交后检查。
- 新增独立 QA、对照实验脚本和交付文档。

### 2.3 明确禁止

- 不取消 V9.2.1 `filterForgottenSnapshot()` 的二分/后续 chunk 校验。
- 不绕过 Owner/Campaign、knownBy、sourceRevision、Tombstone、Fragment 证明、Commitment expectedRevision、Strict JSON 解析。
- 不以缓存为理由跨 Owner 复用 User 证据、缓存私密 Prompt、把 `ownerId/campaignToken` 变成常量或合并角色知识。
- 不为了“少请求”丢弃超量 Fragment 或把截断输出当成完整成功。
- 不以改变 UI 统计分母/归因显示“修复”原生命中率；未报告必须显示 `UNKNOWN`。
- 不删除旧 recovery journal，不重放 ACK / Letter / Action，不直接覆盖 `resources/app/out` 绕过 V9.1 构建链。
- 不自动扩大用户真实 API 费用预算；任何新真实 Provider 试验先取得用户明确授权。

---

## 3. P 级问题清单（本版开工状态）

| ID | 级别 | 问题 | 证据 | 本版关闭条件 |
|---|---|---|---|---|
| `CACHE-922-P1-01` | P1 | 14 次大体量 Durable 请求的成本/来源不透明 | 实机 14 次/729,898 输入 | 14/14 可关联；按来源、Owner、finalization、batch、retryDepth、finishReason 精确分桶，归因总和与 Usage 相符 |
| `CACHE-922-P1-02` | P1 | durable 原生命中率仅 9.6%，较历史约 59.9% 显著偏低 | 两个不可直接比较的窗口 | 同工作量真实 A/B；分冷/热、Owner、Policy、retries；若原因不可控明确 HOLD |
| `CACHE-922-P1-03` | P1（若复现，升 P0） | Forget 到真实 Provider 出站之间可能有异步竞态 | `getProviderCapabilities()` 异步边界 | 控制测试证明已 Forget 内容绝不在**其后尚未发出的**请求中出现；失败升 P0、禁止发布 |
| `CACHE-922-P2-01` | P2 | Usage 相邻比较可能跨 Owner 串线 | `previousKey` 缺少 Durable owner 信息 | 相同 Owner 同链、不同 Owner 隔离，统计值保持原生一致 |
| `CACHE-922-P2-02` | P2 | Stable Policy 断点被过度解读 | 本地估算断点≠供应商断点 | 区分 System 内容哈希、模型原生命中、first-different 内容比较、估算归因 |
| `CACHE-922-P2-03` | P2 | V9.2.1 缓存效果 HOLD、当前测试窗口缺可重现实验记录 | V9.2.1 报告 / 新截图 | 给出观察证据、HOLD 结论、运行版本与 SHA 对齐 |

**P0 冻结不变量**：跨 Scope 泄漏、Forget 后出站未发送请求仍泄露已忘正文、遗忘复活、未授权实体/Commitment 被保存、摘要/信件副作用重放，任何一个实际发生均立即阻断。

---

## 4. 总体设计：可追踪的 Durable Request Lineage

### 4.1 不改变业务内容的观测链

```text
Finalization / Recovery / Legacy / Letter
                |
                v
       Memory4Coordinator
          finishOwner / recompressLegacy
                |
                v
       extractChunk (source chunk)
           + recursion tree
                |
                v
       buildPrompt(snapshot, fragments, limits)
                |
                v
       LLMManager.sendSummaryRequest
          await capabilities -> budget -> preflight -> Provider
                |
                v
       DeepSeek native Usage + finish_reason
                |
                v
       UsageAnalytics (原生账本) + DurableTrace (脱敏 lineage)
                |
                v
       分桶分析报告（cold / warm / scope / batch / retry）
```

### 4.2 关联 ID 设计（只用于观测，不发给模型）

- `durableRunId`：一次 finalize/recover/recompression 调度的随机内部 ID。
- `durableAttemptId`：单次真实 Provider 尝试的随机 ID；不得把 retry tree 的根节点误算成 API 调用。
- `durableParentAttemptId`：二分重试的父 Attempt；只有真正进入 Provider 的调用计入 `apiRequests`。
- `origin`：枚举 `finalization` / `recovery` / `legacy_recompression` / `letter_finalization` / `other`，由**真实入口**设置，不靠内容猜测。
- `ownerScopeHash`、`campaignScopeHash`、`finalizationHash`：本次实验窗口盐值下的不可逆 HMAC/带私有盐摘要；同窗口可关联，公开后不可回推出 ID。不能仅对小范围数值 ID 做无盐 SHA-256。
- `chunkIndex` / `chunkTotal` / `fragmentCount` / `fragmentTokenEstimate` / `retryDepth` / `retryReason` / `parentAttemptId` / `sourceSetDigest`。
- `policyHash`、`systemHash`、`anchorHash`、`userPayloadHash`、`serializedRequestHash`，仅记录摘要，不记录 Prompt。
- `providerType`、`model`、**脱敏 endpointHash**、`capabilityKeyHash`、`effectiveParameterHash`、`requestedMaxTokens`、`effectiveMaxTokens`。
- `requestPreparedAt`、`providerSendStartedAt`、`providerCompletedAt`、`finishReason`、`complete`、`truncated`、`parseStatus`、`errorCode`、`providerAttemptCount`、`inputTokens`、`hitTokens`、`missTokens`、`outputTokens`。
- `forgetEpochBeforePrepare` / `forgetEpochAtSend` 或等价的当前可验证 Tombstone 修订证据。**不要将内部 epoch 信息直接注入模型请求**。

### 4.3 推荐的内部 DTO（设计示例，非仓库现有接口）

```js
const traceContext = {
  requestType: "memory4_durable",
  origin: "finalization",
  durableRunId,
  durableAttemptId,
  durableParentAttemptId: parentAttemptId || null,
  ownerScopeHash: hashScopedOwnerForThisReportOnly(scope),
  finalizationHash: hashFinalizationForThisReportOnly(finalizationId),
  chunkIndex, chunkTotal,
  retryDepth, retryReason,
  fragmentCount: chunk.length,
  fragmentTokenEstimate,
  policyHash, userPayloadHash
};
```

**强制边界**：DTO 只在 VOCT 内部传递。`provider.chatCompletion(request, config)` 的 `request.messages` 及厂商序列化参数仍由原有逻辑生成，**Trace 字段不进入 API JSON Body、Headers 或 Tool Schema**。避免因新增诊断字段反而破坏缓存。

### 4.4 数据收集失效策略

- 观测默认关闭或受控限时开启；不影响业务成功/失败。
- 单次记录长度与保留条数有上限，写入有权限保护的本地诊断目录；磁盘满只跳过诊断，不改记忆提交结果。
- 提供**公开导出白名单**与敏感字段禁入测试。Owner 数字 ID、用户文本、Fragment 原文、密钥、文件系统私有路径绝不导出。
- 不能因为安全问题而默默跳过实际 Forget 校验；**业务 fail-closed 与诊断 fail-soft 要分开**。

---

## 5. WP-00 — 冻结基线、备份、确认本次窗口

**目标**：让后续比较不会把 V9.2.1 的长期累计统计和三人对话短窗口混为一谈。

### 施工步骤

1. 记录当前最新提交 `edb3896`、仓库状态、当前 Core/App/UI 版本、用户选择的 Summary 路由及实际模型 ID。验证真实配置，不能假设 UI 列出的别名等于 API 实际 model。
2. 记录最新 SHA 的 CI 结论。GitHub Actions `38204649687` 已显示 Success，但**此证据仅属于 V9.2.1 代码基线，不能继承到 V9.2.2**。
3. 用户实际 Memory4 数据、摘要、Settings、Provider 配置与恢复日志先离线备份且核对 checksum；备份中的密钥不得进入 Git。
4. 将本次 14 次、9.6% 的截图记录成只读 incident summary。需要用户本机授权时，导出窗口内**脱敏** Usage/Provider Diagnostics；无法取到原始日志必须写 `evidence_missing`，不伪造 14 条样本。
5. 保留旧 59.9% 窗口作为历史参考，不作为改进百分比的计算基线。
6. 确认用户数据没有待处理中部署 receipt；应用退出再进行构建部署，不直接删除 receipt。

**交付物**：`V9_2_2_BASELINE.md`、`v9.2.2-incident-baseline.json`（公开脱敏）。  
**Gate G0**：源码 SHA、真实配置、隐私备份、旧回归、事件窗口均可复核。

---

## 6. WP-01 — Durable 单次请求可观测性（最高优先级）

### 6.1 必须埋点的实际入口

- `memory4-coordinator.js`：`finalizeCommitted()`、`finishOwner()`、`recompressLegacy()`、`recoverPending()`。
- `memory-engine.js` 与 `main.js` 中各 `requestDurable` 包装器（普通 Finalization、恢复、Letter），在入口判定 `origin`。
- `extractChunk()`：初次 128 片段 Chunk、递归拆分、跳过空 Chunk、已忘源被过滤、请求结束/解析失败/限额耗尽。
- `provider-service.js`：`sendSummaryRequest()` 的能力解析、预算检查、实际发送开始、Provider 结束与原生 Usage 回收。

### 6.2 一次 API 调用的状态模型

```text
PREPARED
  -> PREFLIGHT_WAIT
  -> AUTHORIZED_TO_SEND
  -> PROVIDER_SENT
  -> PROVIDER_COMPLETED
  -> PARSED_OK | INCOMPLETE | INVALID_JSON | INVALID_SHAPE
  -> COMMITTED | REJECTED | RETRY_SCHEDULED
```

失败和拒绝必须保留明确的 `errorCode`，不得只保留“失败”字符串；可以保留原报错类别，不保留私密响应正文。对于 SDK 内部网络重试，若原生尝试数不可得，设 `providerAttemptCount=UNKNOWN`，不能假定严格为 1。

### 6.3 实机与离线验收

- **REQ-01**：固定三个 Owner、每人少量合法 Fragment、不需要二分；应观测到与实际调用数相同的 Attempt 数。业务结果不变。
- **REQ-02**：129 条合法 Fragment，验证外层 `128 + 1` 及 Attempt 与 Chunk 的映射。
- **REQ-03**：人为合成 `finish_reason=length`，验证根→左→右的 retry tree，禁止遗漏父请求成本。
- **REQ-04**：合法单片段截断不能无限拆，按旧严格错误合同返回；不能吞异常。
- **REQ-05**：构造恢复 + Legacy 重压缩，与正常 Finalization 在同一窗口，报告必须正确分出不同 origin。
- **REQ-06**：原生 usage 缺失写 `UNKNOWN`；不能用估算 input/hit 覆盖原生零。
- **REQ-07**：同 Owner 两次更新/不同 Owner 同次完成，在私有视图可关联，在公开视图只出现脱敏 ID。
- **REQ-08**：14 次窗口若保存了原始记录，要求 `sum(requests by origin) = 14`，分组输入及 hit/miss 数值能与原始 Usage 对账；缺数据则无法签 Gate，不得补造。

**交付物**：`scripts/test-v9.2.2-durable-lineage.js`、`scripts/v9.2.2-durable-incident-report.js`。  
**Gate G1**：每个真实出站 Attempt 唯一可定位；重试、分块、恢复无漏计或重复计。

---

## 7. WP-02 — 修复跨 Owner 诊断串线及断点误解

### 7.1 已知问题

现有 `usage-analytics.js` 相邻比较键：

```js
const responderKey = entry.characterId ?? entry.character ?? "";
const previousKey = `${entry.requestType} | ${entry.providerType} | ${entry.model} | ${responderKey}`;
```

普通 Durable 请求不一定附带 `characterId`，可能将 Owner A 和 Owner B 的 Prompt 放入同一比较链；这只能影响**本地“首次差异”诊断**，不会直接降低 DeepSeek 返回的 `prompt_cache_hit_tokens`。

### 7.2 最小修复要求

1. 为 Durable 的相邻内容比较引入 `ownerScopeHash + campaignScopeHash + endpointHash + effectiveParameterHash + policyHash`。只有**可证明同一窗口同一 Owner**才进行“相邻内容变化”归因。
2. 对无 Owner 关联的历史记录输出 `unattributable_cross_owner`，**不重新写入历史 Usage**。若需要保留全局原生 hit 统计，应让其继续累加。
3. `breakpoint`（按 Token 比例估算）和 `firstChangedBlock`（指纹实际差异）两个字段仍独立，二者不一致要明确提示。
4. `summary_stable` 标签只表示政策规则属于理论稳定区块；可用 `systemHash` 证明内容相同，但不得直接据此推算供应商已缓存。
5. 报告必须分三层：`provider_native`、`exact_app_content_diff`、`local_estimation`。`UNKNOWN` 独立显示。
6. 不修改原有 `getReport()` 的原生 cached/miss 汇总计算结果；改动前后同一原始 Usage 样本的按模型总 hit/miss 应逐字节/逐数字一致。

### 7.3 反例

- `A -> B -> A`：B 不得被判为 A 的动态变化；第三条 A 只可与之前 A 的请求比较，报告需要注明中间经过其他 Owner。
- 同 Owner 但不同 Campaign：拒绝内容链比较。
- 同 Owner 但不同 endpoint、effective settings、policy：停止链或标记无法严格比较。
- 前缀内容相同但 provider hit=0：原生 0 保持 0，解释仍为 UNKNOWN。
- 同 Owner Fragment 真实变化：不能隐藏或错误归类为稳定。

**交付物**：`scripts/test-v9.2.2-durable-attribution.js`。  
**Gate G2**：断点统计可信度提升，但同原始样本的供应商命中率**前后完全相同**。

---

## 8. WP-03 — Finalization 的请求倍增与截断重试评估

### 8.1 先测量、再动代码

必须给出每个 `durableRunId` 的审计树，例如：

```text
finalization #A (Owner hash ...)
  original-fragments=154
  chunk 0: 128 fragments
    attempt A: 52k input, finish=length
      child A.L: 64 fragments -> stop / parsed_ok
      child A.R: 64 fragments -> stop / parsed_ok
  chunk 1: 26 fragments -> stop / parsed_ok
finalization #B ...
```

**以上数字只是结构示例，不是已观测的 14 次现场记录。**

### 8.2 诊断指标

- `normalAttempts`、`outerChunkAttempts`、`binaryRetryAttempts`、`recoveryAttempts`、`legacyRecompressionAttempts`。
- `submittedFragmentCount`、`uniqueFragmentCount`、`repeatedSourceTokenEstimate`、`providerInputTokens`、`outputTokens`。
- `finishReasonDistribution`：`stop / length / tool_calls / null / other`；以 Provider 实际字段为准。
- `parseFailureDistribution`：`invalid_json / invalid_shape / incomplete / unknown_entity / commitment_evidence / other`。
- `effectiveReservedOutputTokens` 与 configured `4096`，单列 `request_budget_exceeded`（未实际发送）与 Provider 已发请求。
- `perOwnerTotalCostProxy`：提供原生输入/命中/未命中与输出量；如果缺官方分档价格不计算人民币费用。

### 8.3 何时允许最小修改分块策略

**只有观察到**截断造成显著重复证据、并且模型请求 Budget/合法结果具有可重现数据，才允许一个可回滚的**Durable 专属**分块实验分支：

- 依据可靠的 Token 预算/片段数量估计，将超大源集按**确定性且来源完整**的边界拆分；保持 Owner/Campaign 与 Fragment 的全部合法证据。
- 不改变原 `MAX_FRAGMENTS_PER_REQUEST=128` 的安全上限含义；可增加更保守的**软阈值**，须由受控实验定标。
- 不擅自提高 `DURABLE_MAX_OUTPUT_TOKENS=4096`。若要改变，先验证真实模型 output limit、Structured JSON 合法率、费用、质量和超时，然后另开可审查变更。
- 保留 `maxEntries/maxCommitmentTransitions` 对本 Owner 的累计硬限制以及 superseded `replacementEntryIndex` 的跨 chunk 修正。
- `chunk` 重试时不得重新发出已忘/未授权的 Fragment；不得在解析失败后静默写入部分不完整结果。
- 每个源 Fragment 至少经过必要的合法处理或以原有失败/恢复机制记录，**不允许悄悄跳过**。

### 8.4 目标口径

优先目标是**减少同工作量、同完成质量下的重复输入 Token/多余 API Calls**。缓存命中率是第二目标。即使仍为 9.6%，如果明确是多 Owner 新证据与冷请求，则不准为达到 60% 人为改变权限、合并任务或假造统计。

**Gate G3**：全部 Attempt 来源解释完整。若未发现重试/分块异常，文档明确 `NO_PROVEN_REQUEST_MULTIPLICATION_BUG`，不强行“优化”。

---

## 9. WP-04 — Forget 到真实 Provider 传输前的并发安全补测

### 9.1 时间窗

源码中的 `extractChunk()` 在调用 `requestDurable()` 前执行 `filterForgottenSnapshot()`；但 `LLMManager.sendSummaryRequest()` 之后仍可能执行 `await getProviderCapabilities()`、Budget 计算等，最后才调用 `provider.chatCompletion()`。

```
Forget 过滤完成
  -> 生成 User JSON
  -> await capabilities（可能联网）
  -> 用户 Forget
  -> 原始 Payload 仍可能进入 Provider.chatCompletion
```

**当前这是待验证的 TOCTOU 风险，尚不能仅凭静态代码将它宣告为已复现 P0。**

### 9.2 实施约束

1. 新增真实 `Coordinator -> LLMManager -> Provider Adapter` 的可控等待夹具，在能力查询挂起时提交真实 Tombstone。
2. 如可复现，必须在最终 Provider 传输入口之前同步验证当前 Scope/Forget/sourceRevision：若快照变化，拒绝当前出站请求，返回类型化 `memory4_request_source_changed_before_send`，由 Coordinator 读取最新合法源并决定受控重试。
3. 最终重建 Prompt 必须使用刷新后的 Fragment / Scope；**不可仅更改记录里的 version/epoch 而继续发送旧 messages**。
4. 若 Provider 请求已实际发出，无法保证撤回已送出的字节；应使用原有取消信号尽量终止，禁止已忘来源落盘，并确保后续再请求不重发。
5. 不引入把原始私密 Fragment 保留在长期全局 Promise/缓存中的结构；校验回调若持有敏感引用，其生命周期必须受限于本次请求。
6. 除 Durable 之外的 Summary/Action/Chat 路由不受这一 Hotfix 的隐式参数或 Provider 行为改动影响。

### 9.3 必须通过的故障注入

- F-01：能力查询挂起 -> Forget A -> 放行能力查询：最终网络 Mock **没有 A 的正文**。
- F-02：Forget A 后同请求仍有 B：要么安全重建仅 B，要么拒绝并由合法恢复流程重试，不能半旧半新混发。
- F-03：Forget 后源集空：禁止空来源旧 Prompt 出站；按原合同返回 FORGOTTEN/NO_DURABLE_CONTENT。
- F-04：正常能力查询无变化：出站 messages 哈希与修复前完全相同（**不破坏缓存与功能**）。
- F-05：Capability 查询失败、取消、超时：不能绕过授权校验或触发无界重试。
- F-06：Provider 已发出后 Forget：提交前禁止落盘、后续重试不再出站旧源；不得虚称已经撤回发送字节。

**Gate G4-SAFETY**：上述负例全部通过；如复现真实泄漏，标为 P0 并先修复，任何缓存提升证据均不能覆盖安全失败。

---

## 10. WP-05 — Cold/Warm 及同 Owner 可比缓存 A/B 实验

### 10.1 需要解决的实验混杂

旧版 `59.9%（372 请求）` 与新版 `9.6%（14 请求）` 不具备可比请求构成。V9.2.1 已有的 2 次 Durable 原生实验在旧 baseline 第 2 次因严格解析拒绝而停止，**新版候选实际上没有完成原生 A/B**。所以本版不能把该实验写成已证实优化。

### 10.2 实验队列（仅合成合法证据）

| Cohort | 场景 | 检验问题 |
|---|---|---|
| D-A | 同 Policy、同 Owner、同 Campaign、同 Fragments 连续请求 | 热缓存是否逐渐出现，公共+动态全量可复用多少 |
| D-B | 同 Policy、不同 Owner，合法不同源 | 公共 Anchor/Policy 能否复用，动态 User 是否从前部断开 |
| D-C | 同 Owner，仅日期变化 | 日期放在 User 前部对可复用前缀的限制 |
| D-D | 同 Owner，仅合法 Fragments 变化 | 必要真实差异的命中与代价 |
| D-E | 相同源，变更 `limits` | V9.2.1 固定 System 是否相较旧版改进跨额度复用 |
| D-F | 128 / 129 fragments 与受控截断 | 输入重复是二分树导致还是 Provider 缓存问题 |
| D-G | 同请求隔不同间隔、冷启动 / 近时重复 | 缓存驻留和自然过期，不能把 TTL 猜测写成事实 |
| D-H | 同样源与参数，V9.2 vs V9.2.1（隔离执行） | 固定 Policy 修复的实际原生命中收益 |

每组至少采用若干**有效完成且严格 `parseResult()` 合格**的样本，记录全部尝试（含失败与拒绝），不得仅挑选成功且高命中请求。具体付费样本数量须在得到用户授权的成本上限内决策；**没有授权不做额外真实 API 实验**。

### 10.3 控制变量

- 对照保持实际路由（DeepSeek）、model ID、endpoint、thinking/JSON 选项、effective max_tokens、源证据量、消息顺序、请求节奏与验证脚本一致。
- A/B 明确区分“不同版本 Policy 的预热”和“已热请求”，必要时轮换执行顺序；若请求前缀相互污染，报告限制，不追求伪严格因果。
- 记录同一供应商原生字段 `prompt_tokens / prompt_cache_hit_tokens / prompt_cache_miss_tokens`；缺失为 UNKNOWN。
- 对照必须同时报告：请求数、输入/输出 Token、缓存 Token、冷样本 hit、热样本 hit、JSON 合法率、Commitment 证据合法率、P50/P95 耗时和错误分布。
- 匹配每个 Owner 的真实授权 Scope；不同 Owner 的证据**不得为了构建 A/B 而复制为共享私密数据**。测试使用可公开的合成数据。

### 10.4 主要指标

```text
native_hit_rate = Σ provider_cached_input_tokens
                / Σ (provider_cached_input_tokens + provider_missed_input_tokens)

request_multiplier = actual_provider_requests
                   / eligible_logical_durable_jobs

input_amplification = Σ submitted_input_tokens
                    / comparable_baseline_input_tokens
```

`request_multiplier` 的分母仅限真实符合资格的逻辑作业；无来源的历史记录不进入此比值。`hit_rate` 需注明真实原生 Usage 覆盖率及 cold/warm 分桶。Provider 返回 0 仍然是 0。

### 10.5 成功定义

- **工程成功**：G0–G4 安全、请求归因、统计一致性通过。
- **性能改善**：在同工作量可比数据上，durable `native_hit_rate` 或真实每次有效 Finalization 的未命中输入 Token 明确改善，且成本/时延/JSON 合法率不回归。
- **无法改善**：若所有固定 Policy 已正确复用但动态证据本来占大头，可给出 `EXPLAINED_NO_APP_FIX` 或 `HOLD_PROVIDER_UNCERTAIN`；不可宣称“9.6% 已提升到 60%”。
- **用户体验**：三人会话真实 CK3 可完成，对话/记忆/恢复不出现新的卡顿或无界重试。

**Gate G5-CACHE**：可比实验完整，结论采用 `IMPROVED`、`NO_REGRESSION_BUT_NO_GAIN`、`EXPLAINED_LIMITED_REUSE`、`HOLD` 四选一，并附脱敏证据。

---

## 11. WP-06 — 质量、权限、恢复与回归 Gate

### 11.1 Memory4 合同不可削弱

- Owner/Campaign Scope；knownBy/visibility/allowedEntityIds；陌生实体 ID 严格拒绝。
- Forget/Tombstone、来源删除及二分重试、后续 128+ Chunk 的二次过滤。
- `sourceRevision`、`finalizationId`、JSON/Index 一致性与恢复日志。
- Commitment 原始语句与完整证据逐字匹配、expectedRevision、fulfilled/cancelled/superseded 及 replacement index。
- 报告事实 vs 已验证 CK3 事实、Legacy `sourceAsOf`/日期不确定性。
- Derived Life/Year 继续使用既有高命中与质量验证；不能为了 durable 拆分而影响其输入合同。
- Letter / Action ACK 的确认为真实回执，不因为缓存/重试改动而二次执行。

### 11.2 回归用例矩阵

| 编号 | 用例 | 必过断言 |
|---|---|---|
| T-01 | D-A 同 Owner 连续 | 可关联、原生 usage 不被估算替代 |
| T-02 | Owner A/B/A | 不串联不同 Owner 的本地相邻内容归因 |
| T-03 | Campaign A/B | 不跨战役关联或共享私有 User |
| T-04 | 128/129 fragments | 每个合法 Fragment 无遗漏，batch 账本一致 |
| T-05 | 截断二分 1→2 | 统计父子 Attempt，保留硬限/恢复 |
| T-06 | 单 Fragment 截断 | 严格失败、不无限递归 |
| T-07 | Forget 于二分之前 | 被忘正文不进入下一次出站 |
| T-08 | Forget 于后续 Chunk 之前 | 不复发已忘正文 |
| T-09 | Forget 于 capability await 中 | 真正 Provider 传输不含已忘正文 |
| T-10 | Forget 于 Provider 发送之后 | 不复活持久记忆、后续不复发 |
| T-11 | Legacy 重压缩与普通 Finalization 同窗 | origin 统计分开 |
| T-12 | 恢复任务与正常对话同窗 | 重复 logical job 不虚增、实际 API 调用不漏计 |
| T-13 | JSON 输出格式损坏 | 精确错误类别、不得持久化部分内容 |
| T-14 | Commitment transition-only | 保留 `NO_DURABLE_CONTENT` 合同和 transitions |
| T-15 | 完整 Memory4 三种 Scope 负例 | 每个 Owner 仅见合法授权源 |
| T-16 | raw usage 正数/0/缺失 | 原生 hit 0 不篡改，缺失 UNKNOWN |
| T-17 | Policy 稳定及额度变化 | System hash 相同、User limits 改变、原 Policy 其它规则逐字保留 |
| T-18 | 生产 Summary 路由一致性 | Provider model/JSON 参数不被诊断注入改变 |
| T-19 | 磁盘满/诊断文件损坏 | 诊断失败不破坏业务；安全校验失败 fail-closed |
| T-20 | 默认日志/公开导出隐私 | 不出现 Prompt、人物 ID、密钥、私有路径 |
| T-21 | 旧 V9.2.1 回归 | 原有 422 组作为参考，实际全量结果重新执行 |
| T-22 | Windows 构建/部署 parity | 源码与运行资源 sha 一致、receipt 无异常 |
| T-23 | CK3 三人对话现场 | Chat、记忆落盘、Forget、Recovery、Action/Letter 冒烟正常 |

### 11.3 完整执行链（在仓库根目录）

```powershell
node scripts/test-v9.2.1-durable-cache-policy.js
node scripts/test-v9.2.1-cache-invariants.js
node scripts/test-v9.2.1-cache-native-usage.js

# 新增脚本需由本版施工实现并注册进 scripts/test-manifest.js
node scripts/test-v9.2.2-durable-lineage.js
node scripts/test-v9.2.2-durable-attribution.js
node scripts/test-v9.2.2-durable-presend-forget.js
node scripts/test-v9.2.2-durable-chunking.js

node scripts/test-release.js
npm run build
npm run verify:build
npm run deploy:build
node scripts/verify-runtime-build.js --deployed
```

**注意**：打包/部署之前必须关闭运行中的 VOTC；真实执行顺序若以仓库当前发布门禁为准应先 build/verify/deploy/verify，再对最终产物重复发布回归。上述新脚本目前是**计划名称，不是已经存在的仓库脚本**。用户数据与凭据不能用于公开测试。

---

## 12. WP-07 — 施工提交与验收顺序

| 顺序 | 提交建议 | 核心产物 | 阶段 Gate |
|---|---|---|---|
| C0 | `docs: freeze v9.2.2 durable incident baseline` | 私有备份证明、窗口/版本/代码基线 | G0 |
| C1 | `feat: trace durable attempts without prompt payload` | attempt tree、origin、脱敏元数据、请求对账 | G1 |
| C2 | `fix: isolate durable cache attribution by scope` | 同 Owner 归因、原生统计不变 | G2 |
| C3 | `test: reproduce forget during capability lookup` | 红绿安全注入测试；若复现补最小修复 | G4-SAFETY |
| C4 | `test: classify durable chunks truncation and retries` | 128+、二分、recovery/legacy 分类与最小成本判断 | G3 |
| C5 | `perf: reduce proven durable retry amplification` | **仅证实需要时**提交；若无异常则只提交 no-fix 诊断报告 | G3 + 质量 |
| C6 | `docs: record native cache controlled comparisons` | 冷/热、同 Scope、不同比较窗与 Provider 用量 | G5-CACHE |
| C7 | `release: verify v9.2.2 hotfix candidate` | 版本/构建/CI/CK3/移交 | G6 |

必须保证每一步可单独回滚。**禁止所有 WP 累积完后才运行第一次 Memory4 安全测试。**

---

## 13. 版本策略与正式发布 Gate

### 13.1 版本号

当前仓库 Core 为 `9.2`、App 为 `9.2.0`，V9.2.1 候选因 G4 收益 HOLD 曾有意不改正式版本。V9.2.2 施工开始时应先锁定这份现实，**不要假设运行版本已经是 9.2.1**。

候选代码和文档可明确标注 `V9.2.2`；正式 Core / App / UI version 如何统一须基于项目版本对应表及上一候选状态审查后执行。建议正式发版时 Core `9.2.2` / App `9.2.2` / UI `V9.2.2`，但只有在所有正式发布 Gate 通过后才修改并重新跑完整回归。Workshop、Memory Engine、Three-Mod 等独立版本**不得随 Hotfix 自动递增**。

### 13.2 Exit Gate

| Gate | 条件 | 未通过处理 |
|---|---|---|
| **G0** | 代码/应用配置/用户数据备份、事件窗口可追溯 | STOP |
| **G1** | 可解释每一条 Durable API Attempt 与来源、重试树 | HOLD |
| **G2** | 跨 Owner 诊断串线修复，原生统计不变 | HOLD |
| **G3** | 分块、截断、恢复的开销有证据；有问题才最小修复 | HOLD |
| **G4-SAFETY** | Forget 出站竞态红绿验证、Memory4 安全全绿 | **P0 则 STOP** |
| **G5-CACHE** | 受控原生命中/成本实证，明确分类和限制 | 未改善记为 HOLD，不虚报 |
| **G6** | 最终 SHA 远端 CI 成功、源码/打包一致、CK3 功能正常、人工 Soak 已标记 | 未通过不得宣称正式完成 |

**发布决策**：安全修复/观测修复可作为功能候选；若 G5 无原生改善，不得发布“缓存已提升”的新闻或改写历史 9.6%。用户可决定在明确保留缓存效果 HOLD 的前提下，将安全补丁先冻结并继续 V9.3，但不能把性能问题视为已解决。

---

## 14. 回滚与紧急处置

### 14.1 触发条件

- P0：已忘正文在“Forget 后、真正发送前”仍出站；跨 Owner 事实泄漏；记忆授权/Commitment 违规；数据丢失；Action/Letter 副作用重复。
- P1：Durable 请求数无界增加、相同合法来源反复调用造成明显成本倍增、持续解析失败、CI 回归失败。

### 14.2 操作原则

1. 暂停引起问题的本版 Hotfix 代码路径；不要删除或覆盖现存 Memory4 业务数据、恢复日志和 Tombstone。
2. 优先保留 V9.2.1 的**已修复 Forget 二分重试保护**；若需要回滚仅回退本版新增诊断/分块调整，不能为了恢复缓存回滚到存在已知隐私缺陷的原实现。
3. 通过官方 `src/app` 权威源进行回滚后重新 build→verify→deploy→deployed parity；不要手动只改 `resources/app/out`。
4. 实际网络请求如果已经发出，不能声称“回滚之后请求未发生”。必须保留敏感信息暴露的私有事件记录并停止后续重发。
5. `.build/runtime-deploy-state` 的 receipt/in-progress 状态必须用既有安全恢复命令处理，不删除 receipt 强行绕过。
6. `rollbackCommit`、`preRollbackUserInventoryHash`、`postRollbackUserInventoryHash` 仅写脱敏结果；恢复之前先验证当前 CK3/VOCT 全部退出。

---

## 15. V9.3 / V9.4 移交条款

**给 V9.3（Provider Platform）**：当前 DeepSeek 原生 cached/missed Usage、finish_reason、请求预算和 capability await 的受控 fixture，可直接纳入七 Provider 的能力/取消/错误一致性测试。但 V9.2.2 不实现平台 Adapter 重写。

**给 V9.4（PromptPlan/Cache）**：Durable 固定 Anchor/Policy 与 Owner User 结构、真实跨 Owner 前缀限制、原生零命中样本、稳定哈希、冷热窗口、TTL 未确定性、请求长度对照和 A/B 证据。完整的 Provider Serializer、全局语义块重排、缓存 TTL/价格策略保持 V9.4 范围。

**禁止给下一版虚假的移交状态**：`9.6% -> 60%` 如果未在可比原生数据中出现，就只能写“事故解释完成/部分优化/效果 HOLD”。本阶段完成定义是**请求路径可解释、权限安全、成本可计量、必要的重复工作被最小化**，而不是以百分数作为唯一成功标准。

---

## 16. Codex 施工约束（可直接复制到任务提示词）

> 以 `edb389623ba34e8a668779b74509d8f1b2bf78cb` 为 V9.2.2 起点。严格遵循仓库 `docs/current/v9/V9_ROADMAP.md`，按照本文件 WP-00～WP-07 逐步提交。首先只读完成基线、真实入口梳理、隐私风险检查；优先建立 Durable Request Lineage 和跨 Owner 归因负例，**严禁在归因前直接重写 Durable Prompt 或提高模型输出上限**。保持 Memory4 的 Campaign×Owner/Forget/Tombstone/Commitment/Recovery 合同；复现 capability await 后 Forget 的真实出站竞态则立即 P0 阻断并做最小修复。所有供应商缓存改善必须由真实原生 Usage 与可比实验支持；没有授权不做额外付费调用。每 WP 输出变更清单、运行命令、PASS/FAIL、剩余问题和回滚方案，最后执行完整构建/CI/CK3 验证。不提交真实用户数据、原始 Prompt、密钥或完整日志。G5 未满足时标记 HOLD 而不是强制宣告缓存修复成功。

### 必须交付的文件（建议名称）

```text
docs/current/v9/
  V9_2_2_BASELINE.md
  V9_2_2_IMPLEMENTATION_REPORT.md
  V9_2_2_P_ISSUE_LEDGER.md
  V9_2_2_VERIFICATION_REPORT.md
  V9_2_2_HANDOFF_TO_V9_3.md
  v9.2.2-incident-baseline.json
  v9.2.2-durable-native-ab-evidence.json
scripts/
  test-v9.2.2-durable-lineage.js
  test-v9.2.2-durable-attribution.js
  test-v9.2.2-durable-presend-forget.js
  test-v9.2.2-durable-chunking.js
  v9.2.2-durable-incident-report.js
```

> 新文件仅为预期交付，不代表已存在；根据实际项目结构可等效命名，但必须在 `scripts/test-manifest.js` 中登记真正的发布门禁。文档文件不可替代真实测试证据。

---

## 17. 最终施工目标核查表

- [ ] 14 次旧事件若可取得原始记录，逐条关联来源；若不能取得，明确标记“不足以追溯”，用受控复现实验替代猜测。
- [ ] Durable 的每一个实际 Provider Attempt 均有匿名 Owner、Source、Chunk、Retry 和结果字段。
- [ ] `memory4_durable` 跨 Owner 比较串线关闭；旧原生 hit/miss 字段未被修改。
- [ ] 区分 Policy cold start、Owner switch、dynamic evidence、recovery、binary split；每个结论有数据等级。
- [ ] Provider 原生 `prompt_cache_hit_tokens` 缺失值始终 UNKNOWN，原生 0 始终为 0。
- [ ] 已完成 `Forget -> capabilities await -> Provider transport` 注入测试；实际 P0 漏洞被修复或真实不可复现证据充分。
- [ ] Fragment 数量、Scope、Commitment 与来源不因提高缓存而缩减。
- [ ] 若实施分块软阈值，有可比输入成本、JSON 合格率、响应时间和恢复完整性证明；否则保留原分块。
- [ ] GLM v813 请求内容与推理配置未被本版改动。
- [ ] `memory4_year/life` 行为和命中统计没有发生不合理回归。
- [ ] CI 对**最终 V9.2.2 SHA** 完成 SUCCESS（不能继承 V9.2.1 绿灯）。
- [ ] CK3 三人对话、普通记忆、Forget、重启 Recovery、Action 与 Letter 经实机验证。
- [ ] 公开提交不包含用户私密日志、人物全文、Token 之外的敏感诊断内容与 API Key。
- [ ] 正式版本号仅在发布 Gate 通过后统一更新；版本不一致明确记录。
- [ ] V9.3 Provider Platform 阶段边界保持不变；V9.4 PromptPlan/Cache 未提前实施。

**结束条件**：先把“为什么 14 次请求、为什么 9.6%”转化为可复核的请求证据；只修复被证实的缺陷。在无证据证明缓存改善时，诚实交付安全/可观测性 Hotfix，并将 Provider 缓存的不确定性按路线移交。

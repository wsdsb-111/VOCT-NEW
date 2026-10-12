# VOCT V9.2.1 缓存优化专项 — 设计开发与详细施工方案

> **文档性质**：V9.2.1 Hotfix 实施规格（交付 Codex 施工）。不是“已完成”报告。  
> **撰写日期**：2026-10-12  
> **基线仓库**：[`wsdsb-111/VOCT-NEW`](https://github.com/wsdsb-111/VOCT-NEW)，`main`，`6026713d88deeafef6cf45e6a07405908c98e030`（V9.2）  
> **唯一阶段路线**：`docs/current/v9/V9_ROADMAP.md`，尤其 §6、§7.3～§7.5、§8  
> **用户实机反馈**：V9.2 已在 2026-10-11 晚间实际游戏测试，功能未见异常（`USER_CONFIRMED`；不是各 Provider 的缓存实验或长时间 Soak）。  
> **版本定位**：V9.2.1 是进入 V9.3 Provider Platform **之前**的精准缓存 Hotfix；完成后继续按 V9.3、V9.4 的既定范围开发。  
> **状态标记**：本文代码路径与已有逻辑已对照 V9.2 仓库；涉及供应商缓存阈值、TTL、真实命中原因与优化收益的判断均属**待验证假设**，不得作为既成事实。  

---

## 0. 执行摘要

### 0.1 版本目标

V9.2.1 只做两个主问题，以及让它们**可验证**的最小诊断：

1. **GLM-5.3-Flash 主力 Chat**：解释累计缓存命中率偏低的来源，在不改变 V8.13 动态世界/记忆权限合同的前提下增加可重用前缀的真实稳定性，并通过智谱原生 `cached_tokens` 验证收益。
2. **DeepSeek V4 Flash 的 `memory4_durable`**：把与调用批次有关的剩余额度从较长、原本可稳定复用的 System 规则中拆出；确保用于 durable 提取的前缀确定、结构清晰，并在响应解析时保留全部源证据校验。
3. **诊断可信**：区分本地估算断点、实际 Prompt 文本变化以及服务商真实返回的缓存命中，避免仅仅改变 UI 统计就“优化成功”。

**最关键原则：缓存命中率是成本指标，不是正确性指标。任何以泄露、使用过期世界状态、复活 Forget 记忆、绕过权限校验、丢失 Action/Letter 语义为代价的缓存提升，一律视为 P0 回归。**

### 0.2 本版明确不做

- 不重构 V9.3 的 Provider Adapter / Structured Output / Reasoning / Retry / Timeout 全平台。
- 不实施 V9.4 的 PromptPlan V9、统一 Serializer、版本路径退役或新的持久 KV Cache 系统。
- 不把 `getChatPromptV813Layout()` 改为 `false`；不强制启用旧 `glm_cache_v2`；不重新排列全部 Prompt。
- 不修改 Memory4 Schema、Owner/Campaign Scope、KnownBy、Forget/Tombstone、Commitment 提交规则。
- 不关闭 GLM `clear_thinking` 或擅改 `reasoning_effort` 来追逐缓存数据。
- 不把不同 Owner/不同 Campaign 的私有 memory fragments 拼成共享静态前缀。
- 不为提升百分比缩短正常历史、删除历史事实、关闭 Worldline 读取、移除实时状态和后置授权检查。
- 不把 Prompt 估算命中或提供者未报告的命中填成真实 hit；UNKNOWN 不等于 0。

---

## 1. 基线、证据等级与诊断口径

### 1.1 用户提供的历史用量截图（2026-10-12）

| 指标 | 请求数 | 输入 Token | 当前显示缓存命中率 | 解释 |
| --- | ---: | ---: | ---: | --- |
| 全部请求 | 2,000 | — | **55.9%** | 全部请求混合口径，仅用于背景 |
| `chat | zhipu | glm-5.3-flash` | **563** | **13,383,685** | **36.0%** | 首要专项：主力 Chat |
| `memory4_durable | deepseek | deepseek-v4-flash` | **372** | **20,030,998** | **59.9%** | 第二专项：高输入量的 durable 抽取 |
| `memory4_life | deepseek | deepseek-v4-flash` | 244 | 3,643,412 | 97.3% | 不同任务形态的参考，不构成 durable 可达到相同命中率的证明 |
| `memory4_year | deepseek | deepseek-v4-flash` | 92 | 970,691 | 95.7% | 同上 |
| `action | deepseek | deepseek-v4-flash` | 535 | 2,765,141 | 54.3% | 非本轮优化重点 |
| `chat | openai-compatible | deepseek-v4-flash-0731` | 20 | 439,993 | 45.1% | 小样本，用户确认延长同一会话可超过 80%；不用于推断 GLM 本身异常 |

截图显示总 Token **44,757,543**，未命中 **18,279,350**。按各行输入和显示命中率粗算，GLM 未命中约 **856.6 万**，durable 未命中约 **803.2 万**；这属于量级估算，不能直接视为可节省量或准确账单。

**统计口径说明**：此处“命中率”应按提供者确实报告的 `cached_tokens` / (`cached_tokens` + `cache_miss_tokens`) 加权。`usage-analytics.js` 当前汇总只在 `cacheHitTokens != null` 时把请求计入 `cacheReportedRequests`，报告期间、缺失数据和历史统计混入需在实验报告中明确。**拒绝用历史累计 36.0% 对比新版本一天的数据直接宣称提升。**

### 1.2 截图中的“未命中归因”不能等同供应商断点

| 截图显示的归因 | 次数 | 对应未命中量（估算） | 审查解释 |
| --- | ---: | ---: | --- |
| `memory4_durable | summary_dynamic | Summary Dynamic Context` | 135 | 7,075,040 | 很可能处于 System 规则侧，但分类名仅是基于 Prompt 区块识别 |
| `memory4_durable | summary_dynamic | Summary Generation Request` | 237 | 0 | 动态 User 内容；“本区块未命中为 0”是**本地归因分布**，不能推断数据免费缓存 |
| `chat | main_segment | Stable History and Roleplay Rules` | 179 | 3,192,550 | 需核验旧/新请求真正的静态模板哈希与是否成功提前 |
| `chat | provider_zero_hit` | 172 | 3,921,005 | 真实服务商返回零缓存，但零值的**原因未知** |
| `chat | history | Conversation History` | 159 | 158,066 | Prompt 历史自然增长不等于整个历史前缀无效 |

另一个“相邻请求的最早变化”表显示 `Conversation History` 335 次（对应未命中约 4,523,839）、`Live Character State` 73 次（约 1,505,714）、`Conversation Frozen Date / Era` 53 次（约 823,530），以及 `Action system introduction` 327 次。以上数字来自截图中**不同统计表**，既可能重叠，也可能只是不同聚合维度。**禁止把它们相加视为独立的节省空间。**

源码 `src/app/main/analytics/usage-analytics.js` 使用 `ordered_prefix_estimate_v1`，把原生命中/未命中 Token **按本地估算的块 Token 比例映射**；“首个估算断点”与“前后相邻文本变化”是两种不同推断。因此本版不能仅凭表格判定“某个 Block 导致 X 百万真实未命中”。

### 1.3 已确认的源码事实、待验证假设

| 结论 | 等级 | 依据/下一步 |
| --- | --- | --- |
| 运行时 `getChatPromptV813Layout()` 恒返回 `true` | **代码事实** | `src/app/main/config/settings-repository.js` |
| `glm_cache_v2` 仅在 `!v813Layout` 时启用，故当前 GLM 走 `v813` 布局 | **代码事实** | `src/app/main/prompts/prompt-builder.js` |
| V8.13 有静态全局、对话冻结、回应角色冻结与动态区块 | **代码事实** | `buildMessagesWithTokenCount()`、`insertCacheV2Frozen()` |
| `stable_global`、`stable_history_rp` 只有满足无未处理模板变量条件才可向前提升 | **代码事实** | Prompt 主模板拆段与 `hoistedMainSegments` |
| `memory4_durable` System 模板内插入可变 `remainingEntrySlots`、`remainingTransitionSlots` | **代码事实** | `memory4-coordinator.js::buildPrompt()` |
| `prepareSummaryMessages()` 已追加（前置）通用 `VOTC_SUMMARY_CACHE_ANCHOR_v1` | **代码事实** | `prompt-builder.js` |
| 上述 System 插值是 durable 59.9% 的**主要**原因 | **尚未证明** | 必须统计真正发生插值变化的请求频次与原生 hit |
| GLM V8.13 稳定规则哈希变化造成 36.0% | **尚未证明** | 必须查同一 NPC、同端点、相邻请求的请求指纹及模型返回 Usage |
| 同一 NPC 连续请求通过修复即可达到 80%+ | **不能保证** | 服务商阈值、TTL、路由、并发和真实响应决定；以实验为准 |

---

## 2. V9 总路线范围与版本依赖

路线原文约束：

- §7.3 V9.2：Application Boundary & JSON Repository — 不改 Memory4 权限权威。
- §7.4 V9.3：Provider Platform — 能力矩阵、结构化/流式输出、正常化、错误和取消。
- §7.5 V9.4：PromptPlan & Cache — 正式稳定前缀架构、厂商 Serializer 和完整缓存诊断。
- §8 性能与 P0：不能用过期 Worldline、跨战役记忆和不完整数据换速度；缓存原生命中与本地结构指纹明确区分。

**V9.2.1 的豁免范围仅包括修复现有 V8.13/Durable 构造中可复现的缓存破坏及所必需的诊断。** 架构性缓存工程和厂商适配平台仍保留给 V9.4 与 V9.3；本文不是修订路线表。

依赖链：

```text
V9.2（实机功能通过 + 对应 SHA 远端 CI 通过）
   ↓
V9.2.1（此次）
   ├─ Durable 固定规则最小拆分
   ├─ GLM V8.13 静态前缀真实性、命中 A/B 与局部修补
   └─ 原生 Usage/Prompt 指纹对照和严格行为回归
   ↓ 只在安全 + 验证通过后冻结
V9.3 Provider Platform（原计划不变）
   ↓
V9.4 PromptPlan / Serializer / Cache（全面架构整理）
```

---

## 3. 工程范围与文件清单

### 3.1 候选修改文件（限范围，施工前重新核对实际代码）

| 路径 | 当前职责 | V9.2.1 允许操作 |
| --- | --- | --- |
| `src/app/main/memory-system/memory4-coordinator.js` | Durable System/User 构造、Chunk、Commitment、解析与验证 | 仅拆分固定/动态额度；加不改变数据权威的局部辅助函数 |
| `src/app/main/prompts/prompt-builder.js` | `v813` Chat Prompt 与 Summary Anchor/Blocks | 极小范围可复用区块稳定化/明确区块元数据；不改总体布局 |
| `src/app/main/prompts/provider-prompt-adapter.js` | GLM/DeepSeek profile 识别 | 主要作检查/测试；不把旧 GLM Cache v2 改成新默认 |
| `src/app/main/config/settings-repository.js` | Prompt 设置 | 不改变 `v813` 默认开启；只读诊断所需接口可复用 |
| `src/app/main/analytics/real-request-diff.js` | 哈希、真实出站请求比较、异常分类 | 可增加不含敏感正文的最小对照字段，不改变既有字段语义 |
| `src/app/main/analytics/provider-diagnostics.js` | 原始/归一 Usage + 指纹诊断 | 小范围补齐 route/model/cohort 标记与摘要报告，不能持久化 Prompt 正文 |
| `src/app/main/analytics/usage-analytics.js` | 历史请求聚合、估算未命中归因 | 可增强新实验专用只读汇总；旧统计不回写、不伪造 |
| `src/app/main/providers/index.js`（Zhipu/DeepSeek） | API 传输、Usage 结构与缓存元数据 | **尽量不改**；只需确定真实响应 Usage 未丢失。真发现问题才给独立补丁与测试 |
| `src/app/main/main.js` | Durable/Summary 请求接线 | 原则上不改；如需传播仅限有证据的诊断元数据 |
| `src/app/default_userdata/prompts/system/default.hbs` | 默认主 Prompt | 默认不动规则内容；只有证明特定静态段模板边界异常时再作最小调整 |
| `scripts/test-v9.2.1-*.js` | 新增专项测试 | 必增，覆盖下述 TC 系列 |
| `docs/current/v9/V9_2_1_*.md` | 阶段与验收文档 | 新增结果和风险台账；总路线仅加索引，不改阶段承诺 |

所有生产修改必须发生在 `src/app` **权威源码树**，通过 V9.1 构建流水线生成 `resources/app/out`，不能直接修改生成产物作为最终权威。

### 3.2 禁止修改对象

`Memory4Store` 数据模式、Scoped Repository 授权语义、Forget/Tombstone 规则、CK3 Bridge 协议、Three-Mod 独立仓库、Provider API Key 持久化、Action ACK、信件幂等语义、历史摘要/长期记忆文件本身。

---

## 4. 施工前验收与可回滚基线（WP-00）

### 4.1 操作

1. 确认 `git rev-parse HEAD` 为此次冻结的 V9.2 HEAD；记录 `git status --short`；避免直接覆盖用户未提交更改。
2. 记录 V9.2 主线 CI 的**实际 SHA/Run/Conclusion**；用户实机功能成功单独记为 `USER_CONFIRMED`，不可反向写成各 Provider 性能 Gate PASS。
3. 对 `userdata`、用户 Prompt 模板/设置、Memory4/摘要、使用统计、Provider 诊断、UI 配置制作校验备份，备份置于**仓库外私有路径**，只把摘要哈希与文件数放进文档。
4. 用 V9.2 现有构建/部署/完整 release test 门禁生成 `baseline-manifest`；仓库不要提交真实凭据、角色对话正文或完整存档。
5. 从用户当前 `usage-analytics` 导出只读基线聚合与“最近 N 次记录”的**脱敏**快照；保留原始文件不清零。
6. 收集 Provider 原生 `usage` 能否提供 `cached_tokens` / `prompt_tokens_details.cached_tokens`，无法报告标记 `UNKNOWN`。

### 4.2 基线产物

- `docs/current/v9/V9_2_1_BASELINE.md`：SHA、版本、配置、统计样本窗口及证据等级。
- `docs/current/v9/v9.2.1-cache-baseline.json`：只含模型名、请求类型、计数、Token 总量、匿名指纹、统计学结果；不得含 Prompt、API Key 或绝对私有路径。
- 若已有独立可追溯 V9.2 Tag，则复用；如无，请**先确认仓库标签状态**，不要假定存在。

**Gate G0**：备份可读、生成产物一致、全量基线测试通过、运行配置/真实统计窗口已登记；否则不施工。

---

## 5. WP-01：Durable 固定策略与动态请求隔离（首要低风险收益点）

### 5.1 确定性问题

`Memory4Coordinator.buildPrompt(snapshot,fragments,remainingEntrySlots,remainingTransitionSlots)` 的较长 System 字符串中包含：

```js
`Return no more than ${remainingEntrySlots} entries and
 ${remainingTransitionSlots} commitment transitions ...`
```

由于额度在 `finishOwner()` 的 Chunk 迭代及 `memory4_generation_incomplete` 的二分重试时会变化，同一规则模板可能出现不同字节内容。一旦发生，这种变化从 System 中间开始，后面一大段固定规则也无法构成完整相同的请求前缀。

**限制**：当前许多 owner / chunk 可能始终从 `8,8` 开始，故绝不能声称每次 durable 都由此破坏缓存。要记录剩余额度变化出现比例、固定规则哈希变化次数、Provider 原生命中变化才能归因。

### 5.2 最小变更目标

目标出站顺序：

```text
System[0]  VOTC_SUMMARY_CACHE_ANCHOR_v1（现有、原字节保留）
System[1]  Memory4 Durable Policy v9.2.1（固定规则与 JSON 结构，独立于 Owner、Campaign、日期和剩余额度）
User[2]    Owner/Campaign/Date/Commitments/VerifiedFragments + remainingEntrySlots / remainingTransitionSlots（动态）
```

建议设计为函数而非引入缓存系统：

```js
// 示意：不代表可直接替换的完整业务规则
function buildDurablePolicy() {
  return DURABLE_POLICY_TEXT_V921; // 没有任何动态插值
}
function buildDurableRequest(snapshot, verifiedFragments, entrySlots, transitionSlots) {
  return {
    ownerId: snapshot.ownerId,
    campaignToken: snapshot.campaignToken,
    conversationDate: snapshot.date,
    completeness: snapshot.completeness,
    activeCommitments: serializeCommitments(snapshot.activeCommitments),
    fragments: serializeAuthorizedFragments(snapshot, verifiedFragments),
    limits: {
      maxEntries: entrySlots,
      maxCommitmentTransitions: transitionSlots
    }
  };
}
```

固定 Policy 内保留与原语义等价的约束：仅使用当前 Owner 已授权 fragments、准确 Fragment ID、`allowedEntityIds` 唯一可用人物 ID 集合、`participantIds` 不授权人物事实、第三方私人知识不推断、相对日期采用 `sourceAsOf`、现实与已报告事件区分、承诺状态变迁要求 `commitmentQuote/evidenceQuote/expectedRevision` 的双重明确证据、不得确认 CK3 效果、不得跨 Campaign/Owner、无事实返回 `NO_DURABLE_CONTENT`，以及遵循**动态请求 `limits`** 的上限。

可选小优化：把 `limits` 放 User 对象的尾部，使同一 Owner、同一证据内容且仅额度变化时，User 序列化拥有更长公共前缀。**不要为此移动 `fragments` 的业务排序或跨 Owner 缓存内容。**

### 5.3 不容改变的行为合同

- `MAX_FRAGMENTS_PER_REQUEST = 128`、`MAX_DURABLE_ENTRIES_PER_OWNER = 8`、`DURABLE_MAX_OUTPUT_TOKENS = 4096` 等原有限制本版不擅改。
- `finishOwner()` 的 Chunk / 截断二分重试语义不变；已完成的 entries 和 commitment transitions 仍影响下一 Chunk 剩余额度。
- `parseResult()` 仍对 `maxEntries/maxTransitions` 硬校验，对未授权 Fragment、遗忘 Fragment、未知实体拒绝；不因 Prompt 提到限额就弱化本地校验。
- `activeCommitments`、`entityNames`、`relationships` 仍按原 owner/source 证据生成；不把它们提升到跨请求共享的 System。
- `SourceRevision` / `KnownBy` / `Forget` 应在生成后、提交前维持既有重核验流程。变更后的 Policy 只改善可复用性，不成为权限来源。
- 不修改 `json_object` 的选择、不自行启用推理开关、不改 DeepSeek 费用/Usage 映射。

### 5.4 Durable 专项测试

| ID | 验证场景 | 必须满足 |
| --- | --- | --- |
| D-01 | 相同 Scope/证据，`limits=(8,8)` 与 `(6,3)` | Anchor、固定 Durable System 的**字符串 SHA-256 相同**；动态 User 不同 |
| D-02 | 不同 Owner / 不同 Campaign、相同规则 | 固定 System 可相同；动态 Scope 不同；绝不读取对方 fragments |
| D-03 | 相同数据多次构造 | 完整 JSON User 输出字节稳定，未改原事实及顺序 |
| D-04 | 128+ Fragments，二分重试 | 原有 Chunk 上限与剩余上限准确传递，不溢出 |
| D-05 | 0 条剩余额度、仅 transitions、空 fragments | 符合原契约，绝不靠忽略上限通过 |
| D-06 | 模型试图输出超过额度 | `parseResult()` 原样拒绝 |
| D-07 | 模型引用他人未授权 `entityIds` | 原样拒绝 |
| D-08 | Forget 在请求过程中发生 | 过滤/重审来源，不能提交被忘内容 |
| D-09 | Commitment quote 不符合完整原条件 | 仍然拒绝状态迁移 |
| D-10 | 缺失或脏结果、截断、无效 JSON | 保持原恢复状态与重试行为 |
| D-11 | 固定 Policy 与旧 System 业务条款差异复核 | 形成 clause-by-clause 保留表，无遗漏 |
| D-12 | 同样输入的 provider 原生 A/B | 用独立的 Policy 版本做小样本受控验证，记录 hit、TTFT、质量与是否有服务商 Threshold/TTL 限制 |

### 5.5 Gate G1

D-01～D-11 全 PASS、旧 Memory4/恢复/授权全 PASS；D-12 得到合法原生 Usage（如果服务商不报告记为 UNKNOWN，不能签发命中率优化 PASS）。若观测改善仅发生于更换额度的请求群，应在报告中如实说明，不扩张为所有 durable 请求都有收益。

---

## 6. WP-02：GLM V8.13 真实缓存路径审计（先诊断，不先改布局）

### 6.1 当前生产路径

```text
settingsRepository.getChatPromptV813Layout() === true
   ↓
PromptBuilder.buildMessagesWithTokenCount()
   ↓
layoutId = v813
   ↓
GLOBAL_STATIC
   ├─ V8.13 cache anchor
   ├─ 尝试前置 stable_global
   └─ 尝试前置 stable_history_rp（须可安全去模板动态变量）
   ↓
CONVERSATION_FROZEN
   ↓
RESPONDER_FROZEN（仅该角色获准知晓的冻结证据）
   ↓
DYNAMIC tail：当前世界/关系/角色状态、最新召回、历史追加及本轮指令
   ↓
ZhipuProvider.buildRequestParams() / chatCompletion() / streaming usage
```

GLM v2 的 profile 配置存在，但在当前 `v813Layout=true` 下不会用旧 `glm_cache_v2` 整体布局。这是**分支选择事实，不是故障证明**。

### 6.2 排查优先级

**A. 真实“全局静态”逐字节不稳定**：在同一构建、相同主模板配置下连续生成 GLM Chat 请求，检查 `cache-anchor-v8.13`、`main-stable_global`、`main-stable_history_rp` 的**实际出站消息**与 `serializedPrefixSha256`；识别是否有模板变量、角色称谓、自动增补的前后缀或 `suffix` 使提前机制失效。

**B. 会话/角色冻结前缀切换**：`conversationId`、`responderId`、Scope、角色固定快照发生变化时，该部分缓存自然不共享。按同 NPC 连续、跨 NPC、跨会话分桶，不再把它们混成同一 36%。

**C. 动态历史本身的自然变化**：对相邻请求看 `firstDifferentMessagePosition`、`firstDifferentBlockId`、`sameMessageCountBeforeBreak`、`estimatedCommonPrefixTokens`。历史尾部新增是正常变化，不能标记为必须修复的“静态失效”。

**D. Provider 原生 zero-hit**：有前缀且 Provider 返回 0 时，只有“服务商观察到 0”是事实；可能是窗口、TTL、阈值、路由或服务商处理方式，也可能是不可见请求参数变化。绝不假定是某段文本必定变了。

**E. 参数一致性**：核对模型、端点、`reasoning_effort`、`clear_thinking`、temperature、stream、max_tokens、消息顺序、JSON 字段及 role 变化。只读记录 `effectiveParametersFingerprint`，不持久化 Key、Header Secret 或正文。

### 6.3 必须生成的 GLM 基线分桶

| Cohort | 取样条件 | 检验假设 |
| --- | --- | --- |
| GLM-A | **同一 NPC、同一会话连续 20 次**，无其他负载干扰 | 当前 V8.13 的 warm prefix 真正命中多少 |
| GLM-B | **3 NPC 交替、合计至少 18 次** | 冻结角色前缀切换的自然损失 |
| GLM-C | **同 NPC 日期推进/Worldline 更新至少 10 次** | 早期全球规则能否保持，动态数据是否及时更新 |
| GLM-D | **同 NPC 同会话中加入可见记忆/关系更新**（隔离测试） | 必要变化不能被缓存“吃掉” |
| GLM-E | **两个新会话、相同通用模板** | 全局静态规则是否跨会话保留有效公共前缀 |
| GLM-F | **同样的真实出站请求在不同时间间隔重复** | 区分 App 前缀相同与 Provider 实际缓存过期/不可用 |

每个 Cohort 至少记录 `provider/model/route/conversation-responder anonymized keys/layoutId/actualStablePrefixTokens/serializedPrefixSha256/firstDifferentBlockId/estimatedCommonPrefixTokens/promptTokens/cachedTokens/cacheReportingStatus/TTFT/latency`。禁止生成并提交明文 Prompt。

### 6.4 允许的 GLM 最小修复（以审计证据触发）

- **允许 GLM-01**：修正静态模板段被错误视为动态的判定或锚点冗余不稳定，前提是不修改真实规则语义；为每项增加“同一输入、完整出站消息相同”与安全边界测试。
- **允许 GLM-02**：将可证明不含个人/时间/场景数据且现在确实错误后置的完全静态句段，置于既有 V8.13 的 GLOBAL_STATIC 范围。**不得改段内容含义**；同等权限和行为必须通过对照测试。
- **允许 GLM-03**：在同一 NPC 的冻结快照中消除无语义差异的序列化抖动（例如稳定 ID 顺序、换行格式），但不能冻结真实变更的 CK3/Memory/Worldline；如果来源本就变了，必须立刻反映为动态变化或按原有 Frozen 合同正确失效。
- **允许 GLM-04**：通过匿名化的 per-cohort 统计找出“Provider zero despite identical outbound prefix”的比例，并将此与 App 可修复的问题区分；若 App 层不存在可修复破坏，可以给出**原因受控未确定**的真实结论，而不是人为提高 hit。

**禁止**：无证据把 `v813Layout` 关掉或全量退回 `glm_cache_v2`；把 `memoryContext?.worldTurnRecallText`、`live-character-state`、`live-relationships`、`history` 等动态材料移入长期 Frozen 缓存；跨回应角色合并 `RESPONDER_FROZEN`；禁用或削弱 Forget 失效逻辑。

### 6.5 GLM 负向测试

| ID | 测试 | 判定 |
| --- | --- | --- |
| G-01 | 生产真实配置读取 | `layoutId=v813`，禁止报告为实际 `glm_cache_v2` |
| G-02 | 相同 NPC、静态模板、追加历史 | 实际 GLOBAL_STATIC/冻结前缀不被**不相关**历史尾部污染 |
| G-03 | 多 NPC 交替 | 不得把 A 的角色冻结证据套到 B |
| G-04 | Campaign 切换 | 不得复用上一战役私有前缀/记忆 |
| G-05 | Forget/Tombstone 后下一次生成 | 已忘信息绝不继续被复用到 Prompt；若原冻结上下文可能已失效，必须遵循现有有效性规则或拒绝出站 |
| G-06 | CK3 日期/年龄/官职/财富/好感/关系变化 | 当前轮最新状态与原实现等价，不能出现过期值 |
| G-07 | 对话切换、重新进入 | Conversation Frozen 不串场，固定全局仍能复用 |
| G-08 | `stable_history_rp` 自定义模板带动态占位符 | 禁止直接 hoist 含未知动态变量的内容 |
| G-09 | Unicode、模板换行、角色标题和消息 role/name | 序列化可解释、变化时 hash/诊断正确 |
| G-10 | Provider `cached_tokens=0` 且本地稳定 | 保持真实 0，报 `provider_zero_despite_large_prefix` 或明确 UNKNOWN 原因 |
| G-11 | Provider 未报告缓存字段 | `UNKNOWN`，绝不填 0/估算 hit |
| G-12 | 任意安全测试失败 | GLM 优化分支立即回滚，不用更改期望值掩盖回归 |

### 6.6 Gate G2

先形成一份“异常归因矩阵”：`可复现的 App 静态文本抖动`、`自然会话/NPC 切换`、`动态尾部正常变化`、`Provider 原生 zero-hit 而 App 前缀一致`、`UNKNOWN` 五类，附脱敏频数和原生 Usage。**只有第一类以及有明确证据的无语义抖动可通过改 Prompt 本体修补**。

---

## 7. WP-03：缓存诊断与对照工具的最小增强

### 7.1 现有组件已能利用

- `real-request-diff.js`：真实出站消息规范化、哈希、按路由与 `conversation_responder` 的相邻请求比较、`stablePrefixUnchanged`、`estimatedCommonPrefixTokens`。
- `provider-diagnostics.js`：保存脱敏诊断、原始与归一后的 Usage、`firstReasoningAt`/`firstVisibleContentAt`、导出最近相邻请求摘要。
- `usage-analytics.js`：按请求类型/模型加权聚合；现有 `attributeCacheMiss()` 是 `ordered_prefix_estimate_v1` **估算**而不是厂商定位。
- `ZhipuProvider.normalizeUsage()`：保留 `prompt_tokens_details.cached_tokens` 及 `not_reported` vs `reported` 的三态含义。

不要另建一套重复的持久化分析引擎。本阶段如需专门报告，使用**只读聚合器**分析已匿名化/已存在字段即可。

### 7.2 建议报告结构

```json
{
  "schemaVersion": 1,
  "baselineCommit": "6026713d88deeafef6cf45e6a07405908c98e030",
  "candidateCommit": "<filled by actual run>",
  "cohort": "GLM-A",
  "providerType": "zhipu",
  "model": "glm-5.3-flash",
  "layoutId": "v813",
  "requestCount": 20,
  "providerReportedRequestCount": 20,
  "weightedNativeHitRate": null,
  "estimatedCommonPrefixTokensP50": null,
  "providerZeroDespiteStablePrefixCount": null,
  "firstDifferenceByBlock": {},
  "p50VisibleTtftMs": null,
  "p95TotalLatencyMs": null,
  "source": "native_usage_plus_redacted_diff",
  "status": "PENDING"
}
```

**不可让 `nativeHitRate` 从 `estimatedCommonPrefixTokens` 推导**。输出中 0、null、UNKNOWN 必须区分；有 Usage 但无 Cache 字段，也不能自动当作“没有缓存”。需要输出真实请求笔数、报告命中笔数、首次请求占比、同 NPC 与跨 NPC 比例、模型/端点版本，避免少量成功的 warm 请求稀释异常。

### 7.3 数据最小化

- 日志仅保留请求时间范围、匿名 Scope 键、模型名、请求类别、参数/前缀哈希、区块 ID 与估算 Token、原生 Usage、时间指标。
- **不得持久化**真实 Prompt 明文、Worldline/Memory 正文、人物身份详情、API Keys、Authorization Header、外部服务商完整错误对象。
- 原始数据仅在本地临时对比；导出前进行红线审计，不把私人日志/存档上传公共仓库。
- 允许添加 `analysisVersion: "v9.2.1"`，保持 V8.14 旧记录向后兼容；旧历史记录不更改。
- 取消超时等 Provider 平台内容只记录现状，不在 V9.2.1 重写。

**Gate G3**：相同请求的诊断指纹可重现；Vendor 原生 0、不报告、报告命中与本地估算各走独立字段；统计面板不需 UI 重构也可生成脱敏对照报告。

---

## 8. WP-04：测试矩阵与受控 A/B 实验

### 8.1 三层验证，避免“绿灯等于命中率提升”

1. **离线确定性层**：固定 Fixture 对比请求出站结构与字节级稳定性；证明没有不必要的前缀变化，亦证明所有安全变更仍触发必要动态更新。
2. **模拟 Provider 层**：假 SDK 返回 `cached_tokens=0/positive/missing`、stream usage-only tail、非流响应、异常与截断，证明 Usage 正规化和诊断没有造假。
3. **真实 Provider A/B 层**：使用隔离账号或测试预算、真实 GLM 与 DeepSeek 端点跑等价请求序列，记录实际命中 Token、可比价格（若供应商提供）、TTFT、P50/P95、输出质量。

### 8.2 A/B 设计

- A 为**冻结 V9.2**，B 为 V9.2.1 Candidate；同一份脱敏/隔离 Fixture、同一模型、同一路由、同等 context 长度/内容和提供者设置；两种版本各自记录请求自身的缓存热身状态。
- 每组先完成明确的 cold/warm 分段。报告既有**全样本**也有**warm-only**加权 hit；禁止只挑 warm-only 显示而把冷启动隐藏。
- 两组请求内容仅允许发生本版批准的格式/顺序差异；不得通过降低对话内容量、跳过记忆提取或改变输出上限造成假提升。
- 若 Provider 缓存跨 A/B 串扰，采用不同明确标注的 policy/anchor 版本、独立实验窗口或随机化运行顺序，并说明这种隔离可能改变命中本身；不能声称达到严格因果识别。
- 记录 Provider 真实模型 ID、端点、请求序列、间隔、网络失败次数、有效使用 Token 及成本；如果提供者无稳定复现条件，标明不确定性。
- 至少各进行 GLM-A 20 轮、GLM-B 18 轮、GLM-C 10 轮；Durable 使用能覆盖额度变化的 20+ 个受控请求对，辅以不改变额度的对照组。受控场景可在不暴露真实存档的本地复制环境实现。
- 因为输出随机，**缓存收益与记忆提取质量需要分开验收**：固定 Fixture 双运行结果使用 Schema 质量、引用证据覆盖和人工抽样，而不是要求文本逐字节一致。

### 8.3 主要 KPI

```text
reported_weighted_cache_hit_rate
  = Σ native_cached_tokens / Σ(native_cached_tokens + native_cache_miss_tokens)
    [only requests with genuine cache reporting]

native_reporting_coverage
  = providerReportedRequestCount / totalRequests

estimated_prefix_ratio
  = locallyEstimatedCommonPrefixTokens / inputTokens
    [structure diagnostic ONLY]

redundant_dynamic_prefix_changes
  = number of requests whose earliest changed block was expected to be invariant
    [after verifying actual hash and role/order]
```

若提供者没有 `cache_miss_tokens` 但有 `prompt_tokens` 和真实 `cached_tokens`，可单独在适用且验证语义一致时按 `prompt_tokens - cached_tokens` 派生缺失量，需标记推导来源；绝不从本地 Prompt 指纹推导厂商缓存。

### 8.4 成功目标：工程门槛与效果目标分离

**刚性工程门槛（必须）**：

- D-01～D-11、G-01～G-12 全 PASS，所有 V9.2 关键行为合同与完整发布回归 PASS。
- `memory4_durable` **固定 System 规则跨额度完全相同**；被授权的动态 User/额度差异仍准确。
- GLM 静态/冻结/动态边界经过真实出站诊断核验，确认未引入“明明变化却被当成稳定”的安全错误。
- 每次缓存使用量来自原生响应且无统计伪造；缺失字段仍是 UNKNOWN。
- 对应新 SHA 远端 CI 必须通过，CK3 实机冒烟无功能回归。

**建议收益目标（非事实、非供应商保证）**：

| 路由 | 历史累计基线（非可比对照） | 受控 A/B 工程目标 | 延伸目标 |
| --- | --- | --- | --- |
| GLM Chat | 36.0% | **同 NPC warm 组**相对 A 组命中率正向提高，优先争取 **≥ +10 个百分点**，同时减少真正的静态前缀异常 | 在适当长会话中 **≥70%**，但不承诺单靠本轮实现 |
| Memory4 durable | 59.9% | **额度变化组**相对 A 组真实缓存命中率正向提高，争取 **≥ +10 个百分点**；不变额度组不能劣化 | 同等源证据输入量下接近或超过 **70%～75%**，须有原生实证 |

上述数字是**验证目标而非预期必然结果**。如本地固定策略改善已证实、厂商未报告/不支持/因 TTL 表现不稳定：版本不得在总结中声称“命中率已提升”，应将对应收益标记为 `HOLD / INCONCLUSIVE`，并记录进入 V9.3/V9.4 的后续实验建议。**V9.2.1 的主目标是可测量的缓存改善；若 GLM 在真实 A/B 中始终没有正向效果，不能以测试绿灯冒充达成，应暂停并解释。**

### 8.5 性能与质量防回归

- 对比相同有效输入 Token、真实 `cached_tokens` 与未命中 Token；TTFT、总耗时、P95 主线程停顿不能出现可解释的显著恶化。
- 记录结果质量：历史事实准确率、NPC 人设一致性、Memory4 证据绑定、跨 Owner 泄漏、Forget、角色称号与关系动态值。
- 不因缓存优化增加明显额外 Provider 请求。新增测试会产生成本，须在实施前确定预算上限，避免 20+ 请求意外扩张为无界收费实验。

---

## 9. WP-05：安全、隐私与行为回归（不可缩减）

### 9.1 P0 一票否决

任何下列现象即 P0：

- Campaign A 的信息在 Campaign B Prompt 中出现；NPC A 的私有内容在 NPC B 视角被复用。
- 已 Forget/Tombstone 的记忆在下一次出站 Prompt、Memory4 Year/Life、Legacy 投影或回复中重新出现。
- 无可见性证据的第三方 trait、主观事实、私人信件、官职信息进入缓存前缀。
- `Owner`、`knownBy`、`sourceRevision`、`visibility`、`allowedEntityIds` 判断被绕过。
- 用缓存/重试重新执行已确认 Action/Letter CK3 副作用，或误把 ACK UNKNOWN 当成功。
- 数据目录、长记忆文件或用户配置丢失/发生静默迁移。

### 9.2 必须保留的稳定路径

`Memory4` 的 Owner/Campaign、recovery、legacy summary、official recollection、year/life projection、letter、Action ACK、Prompt 的 `v813` 动态当前事实，均使用 V9.2 fixture 和当前源码的真实 contract tests。新测试作为**附加检查**，不能删除/降级旧断言来获得绿灯。

### 9.3 额外负向场景

- `Forget` 恰好发生在下一轮开始、生成中、`Summary/Durable` 二分重试之间。
- NPC 被替换/改名/更换角色索引，持久 ID 相同与不同分别测试；响应中的真实姓名以当前 CK3 事实为准。
- 不同战役相同 `ownerId`；完全相同 public 规则与不同 private fragments 共存。
- 结构化输出只包含 transitions 且 entries 为空，不能误判为普通内容失败。
- Provider 实际返回 `cached_tokens=0` 但 App 前缀 SHA 保持不变，统计必须保留“原生 0 + 可能提供者原因”，不能反向修改 Prompt 语义。

---

## 10. 施工顺序与提交切分（WP-06～WP-09）

| 顺序 | 工作包 | 施工内容 | 独立提交建议 | 通过门槛 |
| --- | --- | --- | --- | --- |
| 0 | WP-00 | 冻结 SHA/备份/现有统计/运行配置 | `docs: freeze v9.2.1 cache baseline` | G0 |
| 1 | WP-01A | 先建立 Durable 规则与 User 额度的测试（红测） | `test: cover durable dynamic-limit prefix` | 失败原因应对应源码现状 |
| 2 | WP-01B | Durable 固定 Policy 与动态 `limits` 拆分 | `fix: stabilize memory4 durable policy prefix` | G1 + 全量 Memory4 |
| 3 | WP-02A | GLM V8.13 出站哈希/真实模式诊断，**先不给 Prompt 改代码** | `test: audit v813 glm outbound prefix` | G2 的原始归因结论 |
| 4 | WP-02B | 只对可复现 App 静态抖动进行小修复（如果存在） | `fix: remove proven glm static-prefix jitter` | G2 + G-01～G-12 |
| 5 | WP-03 | 最小脱敏统计/Provider 0 vs UNKNOWN 检查 | `test: distinguish native and estimated cache evidence` | G3 |
| 6 | WP-04 | 受控真实端点 A/B、质量回归、成本/TTFT 数据 | `docs: record v9.2.1 cache ab evidence` | G4 |
| 7 | WP-05 | 正式 V9.2.1 版本对齐、构建、部署、CI 与实机 | `release: v9.2.1 cache hotfix` | G5 |

**原则**：先做低风险、可验证的 Durable 最小修复；GLM 先找到实际故障再改，不能因为 36% 看起来低就大规模移植旧 layout。若某项 A/B 不显著，应停止该项优化，不继续加 Prompt 规则来追求截图里的数字。

### 10.1 版本对齐

在最终发布候选才修改：Core `9.2 → 9.2.1`、Electron App `9.2.0 → 9.2.1`、UI 版本标签 `V9.2.1`、现行 README/CHANGELOG 和验证报告。仍保留 Memory Engine UI `4.0`、Memory 协议 `3.0`、摘要兼容 `2.5`、CK3 Workshop `2.0.5`、Official Action `official-votc-2.0.3`、独立 Three-Mod 版本；不假装 EXE 旧壳文件属性已经重建。若项目实际 Release 方案另有明确版本字段，以同版本对齐台账为准。

### 10.2 构建与回归建议

以仓库现有 CLI/测试清单的实际可执行命令为准，示例：

```powershell
# 新增专项测试（由本版施工落地，不是当前仓库中已经存在的脚本）
node scripts/test-v9.2.1-durable-cache-policy.js
node scripts/test-v9.2.1-glm-v813-prefix.js
node scripts/test-v9.2.1-cache-native-usage.js
node scripts/test-v9.2.1-cache-invariants.js

# 保留已经存在的回归
node scripts/test-v8.10.2-glm-cache-v2.js
node scripts/test-v8.14-inc05-outbound-cache-diagnostics.js
node scripts/test-v8.9.1-cache-usage.js
node scripts/test-v8.8.5-zhipu-provider.js
node scripts/test-release.js
```

V8.10.2 旧测试验证的是 `glm_cache_v2` 分支，不代替**当前生产 `v813`**专项测试。新测试必须进入 `scripts/test-manifest.js` 或当前实际发布 Gate 的登记清单，并经 Windows CI 执行；不得孤立运行后就宣布完成。

---

## 11. Gate、P 级问题台账与退出判据

### 11.1 本轮问题（按证据等级，而非虚构已复现故障）

| ID | 暂定级别 | 内容 | 证据等级 | 关闭要求 |
| --- | --- | --- | --- | --- |
| CACHE-921-P1-01 | P1 | GLM 主力 Chat 缓存历史聚合仅 36%，真实稳定前缀与 Provider hit 的差距需解释 | 用户统计 + 当前 V8.13 代码；根因未知 | G2/G3 与有意义的原生 A/B；无改善则 HOLD 而非假关闭 |
| CACHE-921-P1-02 | P1 | Durable 规则内含运行时剩余额度；可引起长 System 前缀变化 | **已确认代码问题**，发生比例待测 | 稳定 System 哈希 + D 系列测试 + 原生 A/B |
| CACHE-921-P2-01 | P2 | 旧 Usage UI 将估算断点显示为“未命中归因”，存在过度因果解读风险 | **已确认诊断口径** | 提供原生/本地估算区分、报告显式注释、未报告 UNKNOWN |

另：先前 V9.2 Review 的 `Memory4 readCandidateEntries` 重复验证与改名目录合并主线程同步 I/O 属于**另一类性能隐患**，已登记在 V9.3 施工计划的跨阶段收口工作中；不要把它们混入本次**Provider Prompt 缓存命中率**的原因分析。若实机发现它们与当前卡顿相关，可独立小补丁处理，不借 V9.2.1 擅自重写 Repository。

### 11.2 Exit Gates

- **G0 BASELINE PASS**：SHA、原始用户数据校验备份、真实配置、独立统计窗口、原 V9.2 CI 与实机用户反馈记录完整。
- **G1 DURABLE PREFIX PASS**：固定 System 跨额度哈希不变、动态 Scope 仍正确、D-01～D-11 和 Memory4 全量合同 PASS；A/B 有原生记录或明确不可测。
- **G2 GLM PATH PASS**：确定真实走 `v813`，区分静态异常/自然变化/zero-hit；改动仅针对可证明 App 原因，G-01～G-12 PASS。
- **G3 METRIC INTEGRITY PASS**：真实 Provider Usage、UNKNOWN、估算指纹彼此不冒充；隐私导出通过检查。
- **G4 CACHE EVIDENCE PASS / HOLD**：若欲宣称“解决命中率问题”，必须有可比实测显示 GLM 与 Durable 各自的原生 hit 有明确改善，且请求量、成本和质量未回归。收益无法确认则给出 `HOLD/INCONCLUSIVE`，不能报告 `IMPROVED`。
- **G5 RELEASE PASS**：源码构建／部署一致、`node scripts/test-release.js` 全绿、**最终 SHA** 远端 CI PASS、真实 CK3 功能无回归、文档/版本对齐，方可冻结并进入 V9.3。

**决策规则**：G0～G3 + 安全测试通过但 G4 未证明提升，允许运行一个仅包含安全/诊断修复的候选版本用于继续采样，但不要签发“缓存专项效果达标”；由用户决定继续小实验还是带 HOLD 进入 V9.3，且所有未知保留到 V9.4，不得把未解决问题写成 DONE。

---

## 12. 回滚、灰度与恢复

1. 所有 Prompt 排列变更以隔离 feature guard / 可独立恢复 commit 推进；不要增加会污染旧存档的设置字段。
2. Durable 优化回滚只恢复 `buildPrompt()` 固定/动态序列化实现；不得回滚或重放用户记忆数据。
3. GLM 优化回滚只恢复 V8.13 原出站构造，不修改真实 Persona/记忆快照，不触发 Legacy 自动迁移。
4. 如果测试中触发跨 Owner/Forget 污染，立即停止真实 Provider 请求，保全证据，回滚代码和运行资源，再在**隔离副本**上复现；不要用清空缓存统计文件掩盖。
5. 提交前以及生产部署前各做一次 `userdata` 清单与 hash 对照；本版不需要写入或重写持久 Memory 数据。
6. 保留 V9.2 版本的可回退构建资源；使用现有 V9.1/V9.2 durable deployment receipt / 校验路径，不能用直接拷贝部分 `out` 文件代替验证部署。
7. 回滚后的旧版可能对同一外部端点保留一段供应商缓存；观测时标注缓存预热/冷启动状态，不据此推断代码回滚失败。

---

## 13. Codex 执行准则（可直接作为施工任务验收清单）

- [ ] 第一步只读审计：列出当前 HEAD、V8.13 真正执行链、Durable 现行请求序列、已有 tests 和 user data 备份状态。
- [ ] 建立 `V9_2_1_BASELINE.md` 与可脱敏基线报告；不要修改 V9_ROADMAP 的阶段含义。
- [ ] 先写 D-01～D-11 负向测试，再改 `memory4-coordinator.js` 的动态剩余额度插值。
- [ ] 逐条对照旧 Durable System 的业务规则文本，证明权限与 Commitment 条款等价。
- [ ] 以出站真实消息/字节哈希建立 G-01～G-12；不要以 `glm_cache_v2` 老测试替代 `v813`。
- [ ] 如果 GLM 真正稳定静态块不稳定，提交**最小**、可解释的修复；否则明确标注 Provider zero-hit/会话切换为调查对象。
- [ ] Native Usage 的 0、Positive、Missing 分别保留；诊断不写 Prompt 明文和密钥。
- [ ] 分离 historical aggregate 与实验时间窗；相同 Cohort、相同端点与实际原生缓存 Usage 做 A/B。
- [ ] 回归 Memory4 Forget/Tombstone/Commitment、CK3 动态状态、Action/Letter/Legacy、构建发布；失败立即停止。
- [ ] 用户实机验证：同 NPC 连续对话、3 NPC 切换、日期变更、短暂断线与重启、摘要/信件/Action。
- [ ] 生成 `V9_2_1_VERIFICATION_REPORT.md` 和 `V9_2_1_P_ISSUE_LEDGER.md`，标明每项 `PASS/HOLD/UNKNOWN/FAILED` 与 SHA/Run。
- [ ] G0～G5 全部符合时，才对齐 V9.2.1 版本并冻结；可单独提交测试与文档，不修改生成产物为源码权威。

---

## 14. 必须交付的工程成果

| 交付物 | 文件/位置 | 目的 |
| --- | --- | --- |
| 本施工规格 | `docs/current/v9/V9_2_1_IMPLEMENTATION_SPEC.md` | 固定目标和边界，避免 Codex 扩大范围 |
| 基线与统计实验计划 | `docs/current/v9/V9_2_1_BASELINE.md` | 保留历史来源与脱敏窗口 |
| Durable 新规则与测试 | `memory4-coordinator.js` + `scripts/test-v9.2.1-durable-cache-policy.js` | 消除确定的动态 System 插值风险 |
| GLM 当前生产路径专项测试 | `scripts/test-v9.2.1-glm-v813-prefix.js` | 审计真实 `v813` 而非旧 Cache v2 |
| 原生 Usage/诊断测试 | `scripts/test-v9.2.1-cache-native-usage.js` | 严格区分本地估算与服务商命中 |
| 权限/业务回归测试 | `scripts/test-v9.2.1-cache-invariants.js` | Owner/Campaign/Forget/实时状态不回归 |
| A/B 脱敏汇总证据 | `docs/current/v9/v9.2.1-cache-ab-evidence.json` | 不捏造真实 hit 改善 |
| 版本验证与风险台账 | `V9_2_1_VERIFICATION_REPORT.md` / `V9_2_1_P_ISSUE_LEDGER.md` | 将风险与最终 SHA 实证闭环 |
| V9.3 移交 | `V9_2_1_HANDOFF_TO_V9_3.md` | Provider 平台阶段的限制/剩余异常和后续 V9.4 延续点 |

真实用户的 Provider 诊断日志、秘钥、CK3 存档、角色文本、性能跟踪原始文件、Windows 临时测试路径不得添加至公共 GitHub。

---

## 15. V9.3 / V9.4 移交与完成定义

V9.2.1 冻结后移交：

- **给 V9.3**：原有七 Provider Adapter 不被改写；保留 `usage-normalization` 现有真实字段；本轮发现的供应商不报告/zero-hit、Streaming usage tail 等现象作为 Provider 合同测试输入。不要在 V9.3 顺手重构 V9.4 前缀结构。
- **给 V9.4**：本轮实验中可证明的 v813/GLM 结构约束、durable 固定与动态区块样式、缓存阈值/TTL 的未证实假说、误估算诊断界限，作为 PromptPlan/Serializer 正式设计资料。
- **给 V9.9**：真实 CK3、多 NPC、长期连续回合、完整 Provider 供应商矩阵的 Soak 继续保留独立 Gate。

### 最终判定

**成功的 V9.2.1 不等于“面板中的 36% 变成 80%”**。真正的交付是：

1. Durable 规则前缀不再因请求额度变化而改变，且无 Memory4 合同回归；
2. GLM 的生产布局、真正稳定前缀、自然会话切换与原生 zero-hit 已分类清楚，对可复现的 App 抖动做了最小修复；
3. 在受控真实请求中取得**有证据的原生命中收益**，或者在服务商行为/样本限制下明示 `HOLD`，不伪称解决；
4. 不泄露用户数据、不损失 NPC 对话体验、无旧存档/Forget/CK3 Action/Letter 行为回归；
5. 最终 SHA 的构建、CI、实机 Gate 可追溯。

> **执行优先顺序：Durable 的确定性最小修复 → GLM 真实路径审计 → 仅对确认的抖动修复 → 原生 A/B 验证 → 冻结 V9.2.1 → 进入 V9.3。**

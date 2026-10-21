# VOCT V9.4 — PromptPlan & Cache 详细设计开发文档

> **文档类型**：Design Specification / Implementation Plan / Acceptance Contract（单版本完整施工文档）  
> **目标版本**：**V9.4**；本设计中的工作包仅表示施工顺序，**不拆分 V9.4.0～V9.4.5 等功能版本**。所有目标须在同一次 V9.4 版本闭环内完成。  
> **审查基线**：`wsdsb-111/VOCT-NEW`，`main`，`2330bbcb6c068a4e42c19b26eba82f4034e6db63`（2026-10-20 审查时的 HEAD）。  
> **上游路线**：用户提供《v9阶段开发总路线文档.md》（Revision 2，2026-10-11），§6、§7.5、§8–§10。  
> **后续版本边界**：V9.5 专项 UI/i18n、V9.6 VOCT CK3 Bridge 源码纳管、V9.7 分发、V9.8 历史退役、V9.9 RC/Soak。  
> **状态**：`DESIGN_ONLY`。文档不是已经执行的代码变更或验收报告。施工前重新核对 HEAD、CI、文件清单与现有配置。  
> **工作原则**：**行为兼容优先、权限不可回退、原生缓存数据不伪造、构建与最终可执行文件同时验收。**

---

## 0. 执行决策与完成定义

**V9.4 的目标不是单纯提高缓存命中率，而是建立一个具有可验证语义、可解释生命周期、可复验最终请求、可诊断真实缓存表现的 Prompt 架构。**

本次一次性完成：

1. **统一 PromptPlan V9**：将旧版 Prompt 组装的语义、来源、权限、生命周期、块顺序、消息角色与预算变成明确中间表示（IR），由一个主入口完成规划与验证。
2. **统一现有布局的版本化映射**：完整覆盖 `v5`、`v6`、`v7`、`v813`、`deepseek_v89`、`glm_cache_v2`，保留其用户配置及既有输出行为，**不在 V9.4 删除旧配置或迁移用户持久数据**。
3. **建立 Provider-aware 序列化/请求指纹合同**：语义 Plan 与具体 Provider 的消息/请求形态分离；以**真正送入 Provider Adapter 的有效请求**作为 Token 预算和指纹复核的依据，并捕获 Adapter 必需的可观察转换。
4. **统一冻结与失效判定**：将“有权限使用”“可被冻结”“局部前缀可复用”分开；继续保留 V9.3.9 的成功后冻结、Source Provenance、Forget/Tombstone/Recovery 和多回应者隔离。
5. **缓存诊断 V2**：把 Provider 真正上报的 Usage、由字段派生的 miss、本地预测的公共前缀、相邻请求首个变化块和 TTFT 分开统计与展示，不再将估算位置标记成真实 Provider 缓存断点。
6. **全链路对照与发布验收**：冻结旧版 Golden 请求，执行新旧双构建影子比对、差异归因、完整回归、原生 Windows EXE 冷启动、受控 Provider 和 CK3 实机验证；可安全退回旧布局。

**V9.4 完成判定**：生产 Chat 使用 PromptPlan V9 作为统一组装中间层，其他既有需要模型 Prompt 的路径具备明确的统一 Plan/诊断接入合同且保持原有行为；所有受支持布局有可追溯的等价测试；诊断严格标明证据级别；原生打包启动验证通过；完整 CI 与必要实机门禁签署；无新增 P0/P1。不得只提交若干模块文件就宣称 V9.4 完成。

### 0.1 不在 V9.4 开发的内容

- 不做 Memory5，不恢复已退役的 Year/Life 自动生成和后台重建，不重新设计 Durable/Legacy/PairLedger 的存储策略。
- 不做 SQLite 或 JSON/SQL 双写；不重新安排 Action、Letter、RunFile 的副作用或 ACK 生命周期。
- 不做 V9.5 的全 UI 组件化、国际化与主题资源大改动；诊断页只做必须的少量字段呈现。
- 不做 V9.6 的 CK3 Bridge 全量源码纳管，也不把已分离的 Three-Mod 兼容工程纳回仓库。
- 不做 V9.7 的 Workshop EXE 分发、安装器、自动更新/回滚完整产品化。
- 不凭缓存指标变动修改 RP 原文、删减人物关系、降低记忆权限验证或压缩合法叙事 Detail。
- 不更改默认记忆人数档位/硬上限：目前两人 65%/80K、三人 70%/84K、四人及以上 75%/96K，仍受真实 Provider 预算余量约束；除非有单独问题复现及显式批准。
- 不把“整场多人对话共享 192K Token”当成 Provider 模型限制；**窗口限制始终逐个请求计算**，全场共享的只是现有明确规定的检索名额及冻结状态。

---

## 1. 审查基线：已经有的能力与缺口

以下为本次只读核对的代码/报告事实，不等同于现场运行或真实 Provider 全覆盖证据。

| 当前模块 | 已存在的实际能力 | V9.4 缺口 / 对策 |
|---|---|---|
| `src/app/main/prompts/prompt-builder.js` | `buildMessagesWithTokenCount()` 已可组装不同布局；包含块 ID、`stable`、部分生命周期标签、冻结文本、角色/亲属/摘要来源 | 该文件承担了过多策略职责，真实语义块、输出顺序、Provider 布局及动态事实相互交织；引入独立 Plan + 编排/序列化，先保持原有消息等价 |
| `src/app/main/prompts/provider-prompt-adapter.js` | `resolveProviderPromptProfile()` 与 `resolvePromptLayoutId()` 支持默认、DeepSeek、GLM 布局，兼容 `v5/v6/v7/v813/glm_cache_v2` | 把“选择布局”与“生成序列化消息”解耦；现有布局 ID 保持不变并版本化 |
| `src/app/main/conversation/conversation.js` | `buildPromptBlockMetadata()`、`prefixFingerprint`、按回应者历史/Presence、记忆预算、请求预算与来源快照 | 将位置推断改为 Plan 显式输出的消息跨度；每次真正出站时复验 Plan 与最终消息一致 |
| `src/app/main/memory-system/dynamic-summary-freeze.js`、`player-centered-memory.js` | 冻结动态摘要与回应者来源快照、成功注入后提交、失效检查 | 明确权限、冻结、复用三态；改造不得导致多次记账、失败后提交或旧来源复活 |
| `src/app/main/analytics/real-request-diff.js` | `real_request_diff_v1`，有效请求摘要、消息及 Endpoint/参数指纹、首个变化消息/块估算 | 扩充 Plan/block 级变化原因及相容性版本，不篡改已有 v1 结果或历史统计 |
| `src/app/main/analytics/provider-diagnostics.js` | 原生 Usage、相邻请求、首字时间、本地区块估算 | `ordered_prefix_estimate_v1` 当前按区块比例映射 cached/miss 容易让用户误认真实断点；升级到来源标注的 V2 指标 |
| `src/app/main/providers/usage-normalization.js` | 支持不同 Provider 的 reported / derived / estimated / inconsistent / unknown 区分 | 继续复用，不为提高表面命中率改写或补造真实 Usage |
| `src/app/main/providers/provider-platform.js` 与七个 Adapter | 统一结构化结果、完成态、取消、用量与能力矩阵 | 在最终 Adapter 变换后复验有效请求；不能要求所有厂商使用相同缓存语义 |
| `scripts/test-release.js`、`scripts/test-manifest.js`、CI | `main` 最新 `2330bbc` 的 Windows Release Regression 已通过；版本维护已有 Node 22 构建/部署门禁 | 增加 PromptPlan 专项、影子差异与真正 EXE 冷启动 Gate；禁止只凭 JS 测试宣称 Windows 发行可运行 |

**重要现场经验**：V9.3.9.3 本机启动事故已经定位出本机 EXE/DLL 完整性标签异常、便携目录缺失 locales、全屏透明捕获等环境/打包问题。Git 提交无法携带本机 ACL 修复。V9.4 的发布 Gate 必须在完整新拷贝包中检测文件和启动，不得用“已有开发机可启动”或 `test-release.js` 替代。

**已实测的缓存判断边界**：此前用户多轮数据表明，同 Provider/模型/请求类型之间命中率存在明显差异；早期 29% 小样本不能证明缓存系统性失效。V9.4 应记录对照，而非预设需要“修好 29%”。

### 1.1 当前审查尚未证明的内容

1. 真实 CK3 存档上的原“年龄 +1”个案是否被同游戏日完全复现和关闭。
2. 七家 Provider × 所有模型 × 流式/非流式的真实服务器端缓存语义。
3. 新引入的统一序列化在用户所有历史自定义 Prompt 上百分百等价。
4. 不同机器从全新发行目录的 EXE 冷启动是否均正常。

这些必须按本设计形成验证 Gate，不能写成“已完成”。

---

## 2. 目标架构：从来源事实到有效出站请求

```text
CK3 Current Game Truth ─┐
Worldline View ──────────┤
Memory4 / Summary ───────┼──► Existing Authority/Scope Guards
Knowledge/Presence ─────┤            │
Conversation History ────┘            ▼
                           Authorized Prompt Inputs
                                      │
                           PromptPlanBuilder V9
                     [语义块、授权凭据、生命周期、预算]
                                      │
                              PromptPlanValidator
                          [来源/时点/Owner/Forget]
                                      │
                              LayoutPolicyRegistry
                   [v5/v6/v7/v813/deepseek_v89/glm_cache_v2]
                                      │
                               PlanSerializer
                 [顺序/role/文本/分隔/消息跨度/块映射]
                                      │
                          Provider-specific Adapter
                 [实际请求字段、流式选项、模型参数]
                                      │
                        EffectiveRequestPreflight
             [最终请求预算/授权/长度/指纹/取消/版本]
                                      │
                             Model Transport
                                      │
           Result/Native Usage ─► CacheDiagnosticsV2
                                      │
                成功提交、失败/取消安全回滚或不提交
```

### 2.1 不可破坏的执行顺序

`授权事实读取 → 语义 Plan → 布局序列化 → Provider 实际请求投影 → 发送前复验 → 单次传输 → 结果完成/副作用门禁`。

- **不可让 Serializer 从磁盘重新读取原始 Memory、CK3 文件或人物认知记录**；Serializer 必须是纯函数。
- **不可让 Provider Adapter 直接决定 NPC 有权知道什么**；角色权限已经在 Plan 输入阶段判定，Adapter 只变换请求协议。
- **不可用缓存命中信息作为来源权限证明**；缓存命中不代表事实合法。
- **不可让分析/诊断反向修改生产 Prompt**；诊断是只读投影。
- **不可在新旧影子模式中对 Provider 发送两次**；影子只构建和比较，不联网、不提交摘要、不触发 Action/Letter。

---

## 3. PromptPlan V9 数据合同

**拟新增** `src/app/main/prompts/prompt-plan-contract.js`。以下是设计合同（非现存 API），Codex 应按仓库习惯实现并提供运行时校验与 TypeScript JSDoc 类型（暂不要求项目迁移 TS）。

### 3.1 顶层 Plan

```js
// 设计形态，接口细节可经证据验证后细化，不能删掉语义字段
const plan = {
  schemaVersion: "prompt_plan_v9_1",
  planId: "<request-scoped opaque id>",
  requestType: "chat",               // chat/action/final_summary/rolling_summary/...
  layoutId: "v813",                  // 保留现有旧布局 ID
  layoutRevision: "v9_4_compat_1",   // 改变物理顺序/角色/模板时必须递增
  scope: {
    campaignToken: "<opaque>",
    conversationId: "<opaque>",
    ownerId: 1001,                  // 谁有权获知这些内容
    responderId: 1001,
    playerId: 2001,
    conversationEpoch: 12,
    logicalTurnEpoch: 18,
    sourceSnapshotId: "<opaque>"
  },
  providerRoute: {
    providerType: "zhipu",
    modelId: "glm-5.3-flash",
    routeKind: "chat"
  },
  inputRevisions: {
    promptSettings: "<revision>",
    conversation: "<revision>",
    memory: "<revision>",
    knowledge: "<revision>",
    worldline: "<revision>",
    source: "<revision>"
  },
  blocks: [],                       // 有序块，不允许隐式重排
  budget: {
    configuredContextTokens: 192000,
    effectiveInputBudgetTokens: null,
    reservedOutputTokens: null,
    safetyMarginTokens: null,
    estimatedInputTokens: null,
    memoryBudgetTokens: null
  },
  diagnostics: {
    onlyOpaqueFingerprints: true,
    planFingerprint: "<hash>",
    lifecycleCounts: {}
  }
};
```

数字均是**示意值**，不构成默认配置变更。`scope.ownerId` 必须明确表示该请求的知情主体，不因玩家与 NPC 互相说话而默认等于玩家 ID。对于非 Chat 请求，Owner 及 Scope 的语义必须明确，未建立证明则拒绝引入个人记忆而不能假造一个主体。

### 3.2 单个语义块 `PromptBlock`

```js
{
  id: "memory-dynamic-frozen",        // 同布局内稳定，禁止任意重命名
  kind: "RESPONDER_FROZEN",           // 见 §4
  legacyBlockId: "memory-dynamic-frozen",
  role: "system",                     // 最终 role 不由 Provider 默改
  content: "<authorized text>",       // 仅驻留当前请求内存
  order: 80,
  permission: {
    status: "AUTHORIZED",             // 无法验证不得输出
    ownerId: 1001,
    campaignToken: "<opaque>",
    sourceRefs: ["<opaque source refs>"],
    authorizedAtRevision: "<revision>",
    visibility: "RESPONDER_ONLY"
  },
  lifecycle: {
    state: "FROZEN",                  // STATIC / FROZEN / APPEND_ONLY / DYNAMIC
    freezeScope: "RESPONDER_IN_CONVERSATION",
    invalidationRevision: "<revision>"
  },
  cache: {
    stableCandidate: true,           // 只表示 App 可预测的稳定性
    contentFingerprint: "<hash>",
    prefixEligible: true             // 经消息顺序审核后才可处于可复用前缀
  },
  tokens: { estimated: 1200, source: "LOCAL_ESTIMATE" }
}
```

**严格分离**：

- `permission.status` 是授权结果；不可由 `cache.stableCandidate` 推断。
- `lifecycle.state` 表示内容变更语义；不可当作 Provider 真实缓存机制。
- `cache.prefixEligible` 是本地结构候选，不意味着当前发送必定获得 cached tokens。
- `tokens.estimated` 只来自本地 TokenCounter；Provider 实际 usage 不可倒填为“单块真实 Token”。
- `content` 只用于当前内存组装；诊断落盘最多保留白名单元数据与脱敏指纹，不永久记录消息正文、密钥或秘密特质。
- `sourceRefs` 按现有实际来源及 revision/Scope 生成；不可凭文本相同认为来源相同。
- 对因配置或旧模板产生的用户自定义块，应明确 `CUSTOM_LEGACY` 来源和权限上下文；不可默认全部视为 `GLOBAL_STATIC`。

### 3.3 不变量

1. 每个最终消息必须能追溯到至少一个 Plan 区块；每个非空区块必须绑定确定的消息范围/角色；无法建立映射则标记错误而不是把整段估算成一个系统前缀。
2. 同一请求内的块顺序和内容在通过最终发送前审查后不得再次悄悄变化。
3. `Campaign × Owner × Source Provenance × Effective Time` 是权限维度；`conversationEpoch` 和当前历史可见窗口是会话维度；二者均不得仅由缓存指纹替代。
4. 禁止通过“冻结”保留已 Forget、Tombstone、撤回/过期、错 Campaign 或没有有效 knownBy 的内容。
5. 任一未授权的动态/冻结块不得进入最终出站 `messages`；也不得通过预览、日志或诊断输出正文。
6. 缺少完整绑定条件时 fail closed。区分可容忍的“没有该事实”与必须阻断整个请求的“曾有事实但发送前权限失效”；后者要明确错误码，禁止静默发送过时已组装请求。
7. 不根据 `id` 或 `stable: true` 字段自动把区块移动到前缀；物理顺序只由锁定的布局策略控制。
8. 任何缓存或预算层都不可以扩展 NPC 的可知内容集。

---

## 4. 七类 Prompt 语义块与生命周期规则

路线文档中建议的七类语义必须全部在新 Plan 中获得明确映射。允许一个语义类别包含多个现有细分块；不要求把不同授权来源混成单段文本。

| `kind` | 内容 | 生命周期与稳定性 | 权限重点 |
|---|---|---|---|
| `GLOBAL_STATIC` | 角色扮演规则、全局系统说明、合法通用模板、已有 cache anchor | 内容版本/模板/配置不变可作为稳定候选 | 不得引入 NPC 专属秘密或无权访问的动态变量 |
| `CONVERSATION_FROZEN` | 当前会话明确冻结的日期/时代/公共环境锚 | 仅在现有会话冻结合同成立期间稳定 | 新场次、Campaign/时代输入合法变化必须重建 |
| `RESPONDER_FROZEN` | 回应者冻结身份、稳定公开血亲、合法官方追忆、Recent/PairLedger、V9.3.9 已成功提交的动态冻结摘要 | 按 `Campaign × Conversation × Responder × Source Revision` 隔离；证据变更时撤销 | Owner、knownBy、Forget、公开/秘密边界不可失效 |
| `APPEND_ONLY_HISTORY` | 当前回应者有权看到的历史消息片段 | 新轮可以追加；遇 Rolling Summary/历史裁剪时发生重排，应提升 `cacheEpoch` | Presence/加入-离开窗口；暂时缺席不可看见错过内容 |
| `DYNAMIC_WORLDLINE` | 当前时间/地点/在场、实时关系、CK3 人物状态、世界线 patch | 通常本轮动态，不能因“文字刚好一样”永久冻结 | 当前 CK3 游戏真值与 NPC 可知视图区分 |
| `QUERY_DYNAMIC_MEMORY` | 由当前玩家问题驱动的第三人历史、Turn Recall、补充事实 | 本轮动态或按既有“成功提交后冻结”明确晋升 | 来源验证、数额、去重、权利范围与成功注入证据 |
| `CURRENT_TURN` | 玩家最新输入、当前说话人、Action 已确认反馈及最终指令 | 当前轮动态；不得移入旧静态前缀 | 当前轮身份与副作用状态必须真实且不可重复执行 |

### 4.1 兼容规则

- `GLOBAL_STATIC / CONVERSATION_FROZEN / RESPONDER_FROZEN` 是**语义生命周期分类**，并非保证这些区块在所有旧布局里物理上连续。
- `APPEND_ONLY_HISTORY` 只有在旧布局真实处于稳定前缀连续序列时才可参加本地前缀候选；若其前方已有动态消息，则不能越过动态块被视为可缓存。
- `QUERY_DYNAMIC_MEMORY` 中 V9.3.9 已成功冻结的内容应通过**已确认提交的来源快照**映射到 `RESPONDER_FROZEN`；尚未成功注入的内容保持动态，不能预先冻结。
- 现有多个独立 Worldline 块按原先物理顺序映射；不因为名称里包含 `stable` 就默认能够永久冻结。
- 自定义脚本的编译/执行结果在实际输出有动态变量时应保持动态；如无法可靠证明稳定，**默认 DYNAMIC**。
- `lifecycle` 与 `legacyBlockId` 变更须升级 Plan/布局版本并更新 Golden，不能沿用旧 fingerprint 误认为同一语义。

---

## 5. 与既有 V9.3.9.3 生产路径的兼容迁移

### 5.1 首先冻结原始行为

以 `2330bbc` 为原始基线（施工实际 HEAD 若已改变则重新记录）；在任何生产改动前，用既有 `PromptBuilder.buildMessagesWithTokenCount()` 和七类 Provider 的可控 Fixture 生成 **Legacy Golden**：

- 最终消息 `role`、位置、内容（内存比较；落盘仅限虚构 Fixture）、消息总数；
- 系统块顺序、cache anchor 原始字节与新旧布局 ID；
- 有效 Provider 请求参数：model、stream、response_format、thinking/reasoning 以及 adapter 转换后的白名单有效字段；
- 输入预估 Token、输出预留、安全余量；
- 记忆来源实际注入、当前事实、人物权限可见结果；
- 首个动态消息位置、可稳定候选 Token（仅本地估计）及原版 diagnostics；
- 请求失败、取消、重生成、Action/Letter 反馈、摘要最终提交的副作用状态。

旧版存在多次同角色、同用户消息、同内容的情况，不应靠字符串反向搜索猜位置；**新 Plan 采用正向声明的 `messageSpan`**，Golden 测试同时断言 `messageSpan` 覆盖率。

### 5.2 旧布局映射表

| 现有布局 | 选择来源 | 新实现要求 |
|---|---|---|
| `v5` | 旧配置关闭 V8.9 布局时 | 保留旧消息顺序、角色、模板与历史位置；不通过默认设置偷偷迁到 V813 |
| `v6` | V8.9 默认路径 | 保留当前规则、历史、响应者身份及补充事实位置 |
| `v7` | runtime profile split 开启时 | 保留 split 顺序和标签/角色，不改逻辑上的用户身份 |
| `v813` | `chatPromptV813Layout` | 保留 `cacheV2FrozenSnapshots.prefixByResponder`、冻结块位置与每 NPC 范围 |
| `deepseek_v89` | 现有 Provider profile 决策 | DeepSeek 相关请求参数与 Prompt 兼容；语义布局 ID 不擅自重命名 |
| `glm_cache_v2` | 已启用 GLM Cache v2 选择 | 保留 GLM Anchor、冻结与 live tail 分界、相关已知参数与出站结构 |

关于 `deepseek_v89`：当前代码 `resolvePromptLayoutId()` 最终可返回 `v5/v6/v7` 等 ID，`deepseek_v89` 同时是 `promptProfile.id`。新 Plan 必须区分 `layoutId` 与 `promptProfileId`，**不能把二者合并后误改旧版结构**。

### 5.3 用户配置和数据零迁移

- 继续读取旧版 Prompt、布局、Provider 模型等配置原键；不批量改写用户配置文件。
- 保留现有系统/角色 Prompt 脚本、模板编辑能力和 `promptSettings.suffix` 行为。
- 保留目前来源审计/人物认知/摘要目录，不搬移、复制或重新生成记忆。
- 保留旧 API 的适配器：`buildMessagesWithTokenCount()` 可以调用新核心，但必须继续返回现有调用方依赖的 `messages`、`blocks`、`totalTokens`、`promptProfile`、`ageDiagnostics`、`familyDiagnostics` 和各预算字段。
- 若发现历史用户模板无法无损映射，则将**该请求**安全回退旧版，留下脱敏原因，不得放任缺块的 Plan 出站。

---

## 6. PlanBuilder、LayoutPolicy 与 Serializer 的边界

### 6.1 建议新建的主模块

以下路径是**拟新增**文件；Codex 施工前先检查是否已有等价模块，优先复用避免平行双实现。

```text
src/app/main/prompts/
  prompt-plan-contract.js          # Plan/Block schema 与验证
  prompt-plan-builder.js           # 只消费已经授权的现有输入
  prompt-plan-layouts.js           # 旧布局选择、物理顺序与版本
  prompt-plan-serializer.js        # 纯函数 Plan→messages + messageSpan
  prompt-plan-prefix.js            # 生命周期/复用候选/失效
  prompt-plan-compat.js            # 当前公开 API 兼容输出/影子对照
  prompt-plan-errors.js            # 明确错误码/阻断策略
```

现有 `prompt-builder.js` 不应在 V9.4 立即整文件替换：先提取纯函数和布局，保持外部主入口；完工时不再保留**两套可同时写出不同生产消息**的重复组装逻辑。保留 Legacy 兼容用于测试与回滚，且路径明确。

### 6.2 输入/输出接口建议

```js
// 设计伪接口；非当前已存在函数
buildPromptPlanV9({
  requestType, responder, authorizedInputs,
  providerConfig, promptSettings, scope, revisionSnapshot
}) -> PromptPlan

validatePromptPlan(plan, { phase: "BUILD" | "PRE_SEND", proofVerifier })
  -> { ok, reasonCodes, checkedRevision }

serializePromptPlan(plan, { layoutId, profileId })
  -> { messages, messageSpans, blockMetadata, serializedFingerprint }

buildEffectiveProviderRequest({ messages, providerConfig, requestOptions })
  -> { request, effectiveRequestFingerprint, routeMetadata }

preflightEffectiveRequest({ plan, serialized, effectiveRequest, budgetPolicy, proofVerifier })
  -> { ok, budget, requiredRevision, reasonCode }
```

**特别注意** `buildEffectiveProviderRequest()` 的所有字段并不一定能在通用层完整确定。DeepSeek/GLM/OpenRouter/Gemini/Ollama/Player2 的现有 Adapter 具有不同变换，不能为了结构整齐就复制一份参数映射。具体实现应在各 Adapter 的“即将传输的请求边界”构造只读可观测摘要/白名单指纹；正式 transport 继续走 V9.3 ProviderPlatform 的单一路径。

### 6.3 Serializer 必须是确定性纯函数

1. 同 Plan、同布局版本、同配置修订必得同样 `messages` 与指纹。
2. 不自行读取时间、磁盘、当前人物、记忆数据库或随机数。
3. 不自行进行权限“补救”：权限缺口在 Build/PreSend 报错。
4. 不因诊断开关导致出站 role/content/参数变化。
5. 保留系统/用户/助手消息 role、数量、顺序及旧版所有合法模板注入位置。
6. 显式计算 `messageSpans`：索引范围 `[start, end)`（end 不包含），一个物理消息可由多个块贡献时须记录可解释归属，不能模糊宣称完全覆盖单个块。
7. 对重复消息、空正文、有同名块、跨块合并、一个块多消息、旧历史裁剪边界有完整正反测试。
8. 只有经批准的版本化兼容差异可以更新 Golden，不允许“批量重写预期快照”来掩盖退化。

### 6.4 全部请求类型的接入边界

| Request Type | V9.4 接入要求 | 禁止改动 |
|---|---|---|
| `chat` | 全面使用 PromptPlan V9，保留旧入口兼容，真实 serializer+preflight | 不减少 NPC 合法记忆/知识、角色上下文 |
| `action` | 为独立 Action Prompt 提供统一 Plan 元数据和最终有效请求诊断；保持现有 Action 模板/Schema/非流路径；若迁移物理消息必须 Golden 等价 | 不重放 Action/Effect，不放松 Schema 与 ACK |
| `final_summary`、`rolling_summary`、合法 `memory_recovery` | 将其现有 Prompt 标记为不同用途 Plan；有预算、完成态和 Usage 指纹；正常的独立来源授权不与 chat 共用未校验快照 | 不恢复 Year/Life 自动生成功能；不改变 Episode 提交/Forget 映射 |
| `letter` 等由独立服务发起的模型调用 | 明确在 Plan/有效请求白名单和监控中纳入；没有可证明等价的调用先保留现有序列化并标记 `LEGACY_OBSERVED`，但不得漏掉真实传输预算 | 不改变 Letter 发送、确认、回执或用户授权 |

V9.4 所谓“统一”是指 **所有路径拥有统一元数据与安全/诊断合同；Chat 的实际构建合流**，而不是粗暴要求动作、摘要与聊天共享同一串模板。必须逐条记录哪些请求实际启用新 Serializer，哪些仅遵循新 Plan 接口经兼容 Adapter 输出。

---

## 7. 稳定前缀设计与冻结语义

### 7.1 三个不同的指纹

- `planFingerprint`：Plan 的版本化语义/块顺序/来源修订摘要。用于确认计划结构是否一样；**不等于可发出的文本字节相同**。
- `serializedMessagesFingerprint`：Serializer 输出的 role/content/顺序、消息结构的规范化指纹，用于旧新 Golden 和相邻请求比较。
- `effectiveRequestFingerprint`：Provider Adapter 完成协议转换后、真正送出前，对允许的有效请求字段做白名单序列化指纹；用途是定位 payload 变化，并不代表 Provider 服务器内部实际 tokenization/cache key。

加入 `layoutRevision`、`requestType`、`providerType/model`、可适用的系统参数修订等版本作用域。内容指纹应仅用于受控本地诊断，并考虑按安装生成的随机 HMAC 密钥以降低敏感正文哈希的关联风险；不得在上报/日志中暴露明文消息、API Key、URL query 或具体秘密内容。现有 `real_request_diff_v1` 字段保留向后兼容，V2 用明确新名字，不能悄悄替换旧指纹意义。

### 7.2 “可复用前缀”计算原则

**仅从最终物理消息顺序计算从第一条消息开始的连续稳定候选段**：

```text
messages: [S, S, S, D, S, S, D]
local candidate prefix: [S, S, S]
late stable blocks:      不计入连续稳定前缀
```

- `S` 仅表示存在复用候选条件；与 Provider 原生 Cache Hit 无同义关系。
- 只看 `stable: true` 的块合计不能代表连续前缀长度。
- 本地 TokenCounter 的块估算总和与 Provider token 数不相等时，单块 Token 必须继续标 `ESTIMATED`，不能按比例“校准”为原生真实 Token。
- 历史压缩、增加新 NPC、改变系统指令、世界线新增动态信息后都要真实重新计算连续候选段。
- 如果某厂商明确提供显式缓存标记/创建接口，只有得到该厂商当前真实模型能力证据后才在专门 Adapter 启用；**V9.4 默认不盲加服务商特有 cache_control 类字段**。

### 7.3 版本化失效矩阵

| 变化事件 | 不可继续使用的对象 | 是否允许保留其他合法冻结内容 |
|---|---|---|
| Campaign/存档身份切换 | 旧 Campaign 下全部 Owner/Responder 内容、请求局部前缀 | 否；全部重建并发送前校验 |
| 当前 Responder 切换 | 旧 NPC 私有冻结内容与其 Prefix 状态 | 同一会话全局静态可能可复用，但不可带走上一 NPC 的知情内容 |
| 场次/ConversationEpoch 切换 | 会话冻结日期/人物出入场相关快照 | 全局模板在修订未变时可复用 |
| 已知/秘密/头衔来源撤销、修订、过期 | 受影响角色相应事实和指纹 | 与该来源无关且仍有效的事实可保留 |
| Forget/Tombstone/人工隐藏 | 涉及被撤销来源的所有冻结/动态注入及候选 | 不允许通过旧快照/Legacy/缓存兜底恢复内容 |
| CK3 当前日期或关系改变 | 当前年龄、称谓、婚姻、当前世界线等相关动态事实 | 保留经证明不依赖当前日期/关系的合法稳定事实 |
| 参与者在场/候场/离场状态变化 | Presence/历史可见窗口/当前说话关系 | 回应者未改变且无关的合法冻结可以保留 |
| 历史压缩/摘要版本更新 | 受影响历史跨度、`cacheEpoch`、新 Rolling Summary | 不自动删除完全无关的独立来源记忆 |
| 冻结摘要成功新增 | 当前回应者新来源冻结快照与后续请求前缀身份 | 已成功旧摘要不因无关追加任意抖动/丢失 |
| Provider/model/endpoint/参数变化 | 有效请求指纹、能力/预算与该端点相关前缀估算 | 只保留业务层合法事实；发送结构重新计算 |
| Prompt 用户模板/布局配置变化 | 对应布局/模板 Block 与有效请求指纹 | 记忆数据仍合法，但必须重新输出 |
| 取消、失败、部分流、未知送达 | 本次尚未成功提交的动态摘要/奖励/副作用 | 已确认的旧状态保持，不二次提交或重试未知外部效果 |

失效策略必须依赖**来源和修订关系**，不能仅依赖文本字符串等价；同时不能因为无关新摘要出现就粗暴清空全部合法固定块。

### 7.4 成功后冻结（保留 V9.3.9 语义）

当前实现将动态来源先以候选形式进入请求，只有在合法来源正文真实注入、Provider 成功完成、符合已有 Memory 成功提交门禁时，才将对应来源升级为冻结。

V9.4 必须验证：

1. **构建新 Plan ≠ 注入成功**，影子构建不得改变计数/冻结状态。
2. Provider 启动 ≠ Provider 成功；取消/部分输出/超时/错误不能提交。
3. 同一来源及同一成功回合不得重复占用“全场 5+3 或 3+3”名额。
4. Freeze Commit 仍在现有业务 Coordinator/MemoryEngine 的受控位置完成；Plan 只返回本次真实注入证明，不直接调用存储写入。
5. 在响应等待期间来源变成无效时，遵循现有异步恢复和安全阻断策略，不允许将旧来源继续追加到后续请求。
6. 失败重试不得重放已确认 Action/Letter Effect，也不得将失败生成内容认作已提交长期事实。

---

## 8. Token 预算、历史窗口与压缩策略

### 8.1 单一预算合同

继续调用现有 `planRequestBudget()`，以**实际将送往 Provider 的 messages / 传输参数**为最终预算判定对象。

```text
effective context window
  ├─ actual serialized input estimate
  ├─ reserved output tokens
  └─ safety margin / protocol overhead
      ⇢ preflight 必须判断 safe
```

- 当前配置、Provider 已验证能力、用户上限与安全余量共同约束有效窗口；**不得默认所有模型都支持 1M Token**。
- 首选对 Plan 的粗预算用于检索预留，再以序列化的**有效请求**进行最终核算；禁止粗预算安全、真正出站却超额。
- 原有 `memoryBudgetPolicy`、全场摘要篇数、Recent、PairLedger 注入优先级原样保留。
- 合法冻结来源完整文本不足以纳入窗口时，保留现有“先执行有界历史压缩，再不能满足就阻断并解释分项预算”的合同；禁止默默裁切长期来源正文。
- 不将历史文本移至稳定前缀仅为追求命中；任何历史重排需通过所有 Presence/知情/Golden 测试。
- 对普通聊天、Action、结构化 Summary 应采用各自已存在的输出预留；不得用 Chat 规则替代所有路由。

### 8.2 预算字段分层

| 预算指标 | 证据来源 | 是否可称实际数值 |
|---|---|---|
| `estimatedInputTokens` | 本地 TokenCounter | 仅估算 |
| `configuredContextTokens` | 用户当前配置 | 配置值 |
| `providerContextWindow` | 已核验的 Provider/模型能力或配置来源 | 标记来源/UNKNOWN |
| `reservedOutputTokens` | 当前请求规划 | 明确的预留值，不是输出实耗 |
| `actualInputTokens` | Provider Usage 返回 | 原生报告；无返回则 UNKNOWN |
| `stablePrefixCandidateTokens` | 本地连续块估计 | 本地估算 |
| `cachedInputTokens` | Provider Usage 返回 | 原生上报（含明确为零） |
| `derivedCacheMissTokens` | 已知 input 与 cached 的差 | 只能标 DERIVED |

### 8.3 超额与退化策略

- 冻结来源已注入但完整请求超限：明确阻断，记录 `PROMPT_PLAN_INPUT_BUDGET_EXCEEDED` 与分项 Token 估计；不静默发送半截 Prompt。
- 旧配置的模型窗口大小不可信：优先保守地使用有效已知配置；不将 `UNKNOWN` 强制成 1M。
- 能力为 `UNSUPPORTED` 的请求模式由 ProviderPlatform 提前拒绝；`UNKNOWN` 则按当前受控协议/本地结构校验的合同处理。
- Token 计算或 Serializer 不能解释物理消息跨度：**不采用“总量大概相符就放行”**；必须回退经过验证的兼容序列化或阻断请求并保留诊断。

---

## 9. 缓存诊断 V2：原生事实与本地推断严格分开

### 9.1 设计目标

用户应该能回答四类问题：

1. **真实用了多少缓存？** 由 Provider 该次请求直接返回的 cached Token 决定。
2. **这次请求与上次相比哪里开始变了？** 由本地最终请求 role/content/参数指纹比较决定。
3. **为什么本地认为前缀可能失效？** 根据具体块来源版本/物理顺序/模型参数变化列出可解释原因。
4. **能否证明 Provider 服务器的真实断点在哪里？** 除非服务商明确报告，否则输出 `UNKNOWN`，不能用本地按比例归因代替。

### 9.2 观测数据结构（拟新增）

```js
{
  schemaVersion: "cache_diagnostics_v2",
  requestKey: "<opaque>",
  route: { providerType: "zhipu", modelId: "glm-5.3-flash", requestType: "chat" },
  plan: { layoutId: "glm_cache_v2", layoutRevision: "v9_4_compat_1" },
  local: {
    source: "APP_LOCAL_COMPARISON",
    stablePrefixCandidateTokens: 8000,
    commonPrefixEstimatedTokens: 6000,
    firstChangedBlockId: "live-relationships",
    firstChangedMessagePosition: 16,
    changeReasons: ["WORLDLINE_REVISION_CHANGED"]
  },
  provider: {
    cacheHit: { value: null, source: "NOT_REPORTED" },
    cacheMiss: { value: null, source: "NOT_REPORTED" },
    inputTokens: { value: null, source: "NOT_REPORTED" },
    nativeCacheBreakPosition: { value: null, source: "UNKNOWN" }
  },
  time: {
    requestStart: "<timestamp>",
    firstReasoningAt: null,
    firstVisibleAt: null,
    completedAt: null
  }
}
```

### 9.3 四类缓存数据必须独立展示

| 类别 | 示例 | 备注 |
|---|---|---|
| `PROVIDER_REPORTED` | Provider 上报 `cached_tokens = 5234` | 真实服务商字段；要保留 SDK 返回的确切字段映射 |
| `PROVIDER_REPORTED_ZERO` | Provider 明确报告 0 | **不能解释成“未返回”** |
| `DERIVED` | 已知 Input 与 cached，用二者做差得到 miss | 不能标成原生 `cache_miss_tokens` |
| `NOT_REPORTED / UNKNOWN / INCONSISTENT / ESTIMATED` | 缺失、能力未知、本地估算、字段自相矛盾 | 分开标记，不得一律视为 0 或 100% |

原有 `normalizeUsage()` 的来源字段和冲突检验继续作为真值；V9.4 仅对诊断消费层进行升级，禁止生成虚假的 Provider usage。

### 9.4 修复“首个未命中归因”的表达问题

当前 `buildLocalPrefixDiagnostics()` 把总 cached/miss Token 按区块估算 Token 占比分配到物理位置，并将第一次估算未命中的区块表示为 `firstBreakSegment`。这一结果**不是 Provider 提供的真实缓存断点**。

V9.4 应：

1. 保留旧 `ordered_prefix_estimate_v1` 作为历史估算兼容字段，但 UI 标成“旧估算，不代表真实 Provider 断点”；不用于新的主结论。
2. 新增 `firstChangedBlockId`（基于请求本地指纹差异，**仅代表第一个不同区块**）。
3. 新增 `nativeCacheBreakPosition`（无直接服务商字段则始终 `UNKNOWN`）。
4. 在报告中明确“一次请求原生命中 52%”**不能反推出是哪一个块造成命中**。
5. 无上次可比较请求、首次请求、Provider/模型/参数发生变化时，不作“前缀优化失效”断言，只标明为什么不可比。

### 9.5 聚合规则

- 必须按 `Provider × Model × Route × Stream/NonStream × EffectiveParameters` 分组；除非明确是观察用途，不对这些维度的混合样本宣称一个可比较命中率。
- 命中率采用有来源的 `sum(cachedTokens)/sum(inputTokens)` 加权；未报告缓存的请求不能自动计为 0 命中。
- 显示参与加权的请求数、排除/未知请求数、输入 Token 数、异常/取消/失败次数。
- 划分“同一 NPC 连续请求”“不同 NPC 交替请求”“同 NPC 不同会话”“不同 Provider/模型”；后两者尤其不等价于服务商同一 cache scope。
- GLM、DeepSeek、OpenRouter 以及其他 Provider 的真实缓存字段只依照各自现有 Adapter/Usage 合同；不可用“适用于 OpenAI-compatible”就假设另一个厂商上报完全一致。
- TTFT 分为 first reasoning / first visible；对于只有总耗时或非流式响应的请求，缺失的时间戳保持 UNKNOWN。
- 记录明确的数据窗口与样本量；允许导出无正文、无密钥的 JSON/CSV 摘要，默认不导出用户完整消息。

### 9.6 诊断入口与 UI 范围

利用已有 `provider-diagnostics.js`、`real-request-diff.js`、Renderer 诊断页面，只做：

- 原生命中/派生 miss/未知状态分离；
- 同类请求的按 Token 加权命中率；
- 本地前缀比例及第一变化区块；
- 各区块的语义类、生命周期、估算 Token、来源修订原因；
- 以 `UNKNOWN` 呈现服务器没有上报的真正断点；
- 请求编号、时间、模型、Route、流式模式与可比较性提示。

不在 V9.4 引入全新组件框架、主题替换或多语言重构；这些属于 V9.5。

---

## 10. 安全、隐私、权限与并发保护

### 10.1 核心权限红线（出现任一即 P0）

- 已 Forget 的历史或人物事实重新进入模型请求。
- A Campaign / Owner 的摘要、第三人秘密或称谓混入 B 的 Prompt。
- 暂时缺席或尚未加入的 NPC 获得不应知道的对话历史。
- NPC 因 Stable Profile、Worldline、缓存快照或“全场统一前缀”获得未经披露的 trait/title/secret。
- 来源撤销后，旧的已生成 Prompt 仍在重试时发送，而没有最后一跳权限复核。
- Action、Letter 的未知送达被重复执行，或摘要 Finalization/Forget 操作重复提交。

### 10.2 发送前复核与竞态处理

1. 请求 Build 时采集 Source Revision/Scope/知情视图。
2. Serializer 输出后，Provider 运输启动前由现有可信服务复核 Source Provenance、Tombstone、Knowledge Revision、Campaign/Owner/Responder、当前逻辑轮次。
3. 若授权版本不一致，废弃此次 Plan，最多按现有安全可重建规则重建一次并重新核算预算；不允许直接编辑某一个字符串继续发送。
4. 网络连接已发出但状态未知，遵守现有 request cancellation/retry 合同；不能无限重试或透明重放有副作用请求。
5. 提交动态冻结记忆须绑定成功的请求、合法注入证据和当前 turnEpoch；重复成功事件幂等。
6. 影子计划模式绝对不得写来源、占用摘要槽位、生成摘要、改变游戏状态或创建第二次 Provider 账单。

### 10.3 日志与诊断的安全标准

- 不落盘完整 Prompt、角色私密字段、API Key、未脱敏原始 CK3 日志、个体完整信息流或 URL 查询参数。
- 默认保留内容无关的匿名 ID、哈希、块类型、估算 Token、版本、时间及错误码；日志存储与现有应用数据策略兼容。
- 不使用 `console.log(plan)` 一次性打印整个 Plan 对象。
- 保留旧 `provider-diagnostics` 记录兼容性，任何格式迁移先提供只读解析与失败容忍，不自动改写旧档。
- 用户主动导出调试包时再次确认是否包含内容；默认安全脱敏。诊断导出不得把缓存状态与知情状态混为一个集合。

---

## 11. 性能目标与真实 Provider A/B 方案

### 11.1 离线性能

记录旧路径与新路径在**同机、同 Node22、同 Snapshot、同布局、同 TokenCounter**下的：

- Plan Build P50/P95；
- Serializer P50/P95；
- 来源/权限 Preflight P50/P95；
- 输入 Token 估算开销与 CPU 占用；
- 多轮同 NPC、跨 NPC 的指纹稳定性；
- 典型 2/3/4+ 人配置、128K/192K 与模型低窗口预算边界。

性能门槛建议为：**等价任务不能出现系统性 P95 明显恶化**；具体允许增长阈值在冻结基线采集后写入本轮验收记录，不预先编造“提速 30%”。新架构适度增加局部指纹计算是可接受的，但不能重复读取所有记忆文件或对每个块重新解析全量人物图。

### 11.2 受控真实 Provider 测试

**只有在用户显式同意费用、模型和最大预算时才发起。** 不沿用此前 V9.3 的付费测试授权。

至少验证不同机制的一个 GLM、一个 DeepSeek、一个 OpenAI-compatible/OpenRouter 实例（具体模型是否可用，以当时有效端点和实际配置为准）；其他 Provider 能力按 V9.3 的可用范围与 Mock 金样追踪，不能把不支持的能力称为真实 PASS。

每个可用 Provider 最少设计下列负载：

1. 同 NPC 同场逐轮对话（冻结摘要不变）。
2. A/B NPC 交替回复（每个 NPC 拥有不同合法记忆）。
3. 新摘要首次成功提交 → 下一轮复用。
4. Worldline 实时状态变化但静态规则不变。
5. Forget/来源撤销后安全阻断或更新。
6. 历史达到压缩阈值后前缀重新计算。

每个对照保存：模型路由、Provider 原生 cached/input/output、缺失状态、TTFT、有效请求指纹、消息数量和合法记忆是否完整。输出回答只在授权的测试环境做人工质量审查；不得把实际 RP 退化包装成缓存收益。

### 11.3 保守的收益判据

- 主 Gate：权限正确、请求等价、Provider 原生 Usage 可信、失败/取消一致、无 P0/P1。
- 次 Gate：稳定前缀有可解释的变化、真实用量/延迟在可比较样本里可测量。
- **不设必须达到 80%、90% 或必须比 52.3% 更高的强行数字指标**。
- 若重构造成统计口径变化，应保留老口径并注明样本不可比，不能简单连接成连续图表。

---

## 12. 工作包与施工顺序（**同一个 V9.4 版本内完成**）

下面的 `WP` 是工程执行与验收顺序，**不是子版本号、独立发布里程碑或永久功能 Flag**。

### WP-A：冻结基线与风险清单

- 记录 HEAD、源/构建/部署摘要、LFS 原生资源、CI run、Node22、已安装应用与 CK3 Workshop 指纹。
- 完整保存 `v5/v6/v7/v813/glm_cache_v2/deepseek_v89` 的虚构 Golden、Token 预算、权限负向夹具。
- 单列 V9.3.9.3 未验收的年龄真实例、真实 Provider/Soak，不得混进 V9.4 改动“顺便修掉”。
- 将仓库内意外跟踪的 `np-test.exe` 识别归属、检查是否有测试引用；若只是调试二进制则停止跟踪并更新忽略规则，清理必须保存必要回退证据。

**Gate**：Golden 可重复，差异工具能定位到具体布局和消息位置。

### WP-B：PromptPlan 合同和布局映射

- 新建 Plan schema、Block 类型、版本化 LayoutPolicy、显式消息跨度、类型/角色/来源/权限校验。
- 现有 PromptBuilder 优先只调用新 Plan；旧构建保留只读 Golden 适配，禁止两套业务来源重新计算。
- 迁移 6 个布局 ID/Prompt profile，全部对照旧实际消息数组。

**Gate**：Mock/离线所有未授权字段隔离；未批准的 role/顺序/模板差异为 0。

### WP-C：最终 Serializer / Provider 接入 / 请求预算

- 在 ProviderPlatform 的实际运输边界增加只读有效请求白名单摘要/指纹。
- 保持七类 Provider 的参数与完成态、取消、JSON 验证、重试合同。
- 将现有 `planRequestBudget()` 与新 Plan 绑定，进行最终出站预算/来源/Scope 复核。
- 让 Action/Summary/Letter 等模型请求拥有统一 Plan 元数据/诊断投影，但保持各自专用模板/业务编排。

**Gate**：所有生产路径有可识别请求类型；无影子第二次发送；任何超额请求不得传输。

### WP-D：冻结、前缀、来源失效闭环

- 抽取/统一 `prefixByResponder`、动态摘要、Worldline、Knowledge、Forget 的失效条件与原因码。
- 实现连续稳定前缀候选计算，对齐最终 `messageSpans` 与实际序列化。
- 保留成功后提交、全场共享配额/回应者正文隔离，以及失败不消费永久配额。

**Gate**：跨 Campaign、Owner、Observer/Presence、来源撤销、同名不同 ID 的负向测试通过。

### WP-E：Cache Diagnostics V2

- 复用 `real_request_diff_v1` 和 `usage-normalization`，新增 V2 事实投影，不覆盖历史原始数据。
- 区分原生 cached、原生 miss、derived miss、本地 prefix candidate、first changed block、UNKNOWN provider break。
- 扩展现有诊断 UI 的说明和筛选；保存匿名导出。

**Gate**：`0`、缺失、非法、乱序 Usage、估算值、跨 Provider 不可比等反例正确分类。

### WP-F：完整回归、灰度开关、真实安装验证、文档收口

- 同输入新旧 Plan 双构建影子对照（仅一条发送），逐布局完成 Replay/Golden。
- 施工期保留内部 `legacy | shadow | v9` 路径选择，切换前通过 Gate；最终 V9.4 默认 `v9`，保留**有限、明确、可撤销的紧急回退**，不向 UI 暴露未经测试的乱序切换选项。
- 真实 Windows 完整目录 LFS/EXE/Renderer/IPC 冷启动验证（包括 locales、ffmpeg.dll、资源完整、输入焦点、透明空白穿透）；最小空白 Profile 测试不得改动用户真实配置。
- 真实 Provider 与 CK3 Gate、CI/Soak、回滚演练、最终版本号与源/构建/部署同步。

**Gate**：见 §14。**未全部完成不得宣称 V9.4 已发布、Full Freeze 或实机 PASS。**

---

## 13. 施工文件清单与改动边界

| 类别 | 具体路径 | 要求 |
|---|---|---|
| 新增核心 | `src/app/main/prompts/prompt-plan-{contract,builder,layouts,serializer,prefix,compat,errors}.js`（拟） | 细分清晰、纯函数、JSDoc、定向测试，不能平行维护另一套私有 Memory/Provider 数据层 |
| 现有入口 | `src/app/main/prompts/prompt-builder.js` | 迁移为编排入口/兼容 Adapter；保留公开返回合同及现有模板/脚本行为 |
| 旧布局 | `src/app/main/prompts/provider-prompt-adapter.js` | 保留 profile/layout ID，映射新 LayoutPolicy；先兼容后优化 |
| 会话主流程 | `src/app/main/conversation/conversation.js` | Plan 建立、历史可见性、预算、预发送验证、冻结成功回执；不要改变 turnEpoch/动作提交 |
| Provider | `src/app/main/providers/{provider-platform,usage-normalization,provider-capabilities}.js`及真实 Adapter | 最终请求观测、能力范围、原生字段；生产 transport 不复制重实现 |
| 记忆 | `src/app/main/memory-system/{dynamic-summary-freeze,player-centered-memory,memory-budget-policy}.js` | 只改必要的版本/快照接口，保持历史事实与成功提交权威 |
| 诊断 | `src/app/main/analytics/{real-request-diff,provider-diagnostics,cache-usage-reconciliation}.js` | V2 不伪造真实缓存用量，保留旧记录兼容与默认隐私 |
| Renderer/IPC | 现有 Provider Diagnostics 页与对应 IPC 模块 | 限量补充指标/未知标识，不做 V9.5 UI 重构 |
| Test | `scripts/test-v9.4-*.js`（拟，见 §14） | 每个脚本登记 `scripts/test-manifest.js`，严禁跳过旧测试 |
| 构建资源 | `resources/app/out/*`、`build/runtime-inputs.json` | 必须通过 `build-runtime → verify → deploy → verify --deployed` 生成，不直接只改 out |
| 文档 | `docs/current/v9/V9_4_{DESIGN,IMPLEMENTATION,VERIFICATION,HANDOFF}.md`（拟） | 本设计、生产差异、证据、未验收项与回滚步骤独立记录 |
| 发行 | `.github/workflows/regression.yml`、`scripts/test-release-assets.js`（按需） | 增加完整二进制 smoke 与 Gate，不动用户数据目录/Windows 全局安全设置 |

**文件名说明**：括号标“拟”的为设计建议而非仓库目前已有文件。最终以 Codex 实地读取模块、`AGENTS.md`、依赖拓扑和现有 test-manifest 为准；任何路径变更在实施报告中说明原因和等价关系。

---

## 14. 测试矩阵与硬门槛

### 14.1 必做专项（建议对应独立测试脚本）

| 测试组 | 必须覆盖的核心情形 | 失败严重度 |
|---|---|---|
| `test-v9.4-plan-schema.js` | 版本、块 role/order/source/scope、重复 ID、未知分类、非法权限、缺失 messageSpan | P0/P1 |
| `test-v9.4-legacy-layout-golden.js` | 6 布局+profile 全量旧新消息/参数 Golden、系统 anchor 字节等价、自定义 suffix | P1 |
| `test-v9.4-responder-isolation.js` | 两人/三人/四人、同名不同 ID、NPC 交替、Presence 离开和迟到 | P0 |
| `test-v9.4-knowledge-forget.js` | knownBy、可见特质、秘密头衔、Forget/Tombstone、失效来源、Campaign/Owner 串档 | P0 |
| `test-v9.4-freeze-lifecycle.js` | Recent/PairLedger、动态摘要首次候选、成功冻结、失败/取消无提交、追加无关来源不乱清、名额幂等 | P0 |
| `test-v9.4-budget-preflight.js` | 低上下文窗口/128K/192K、输出预留、请求端字段变化、Rolling Summary、最终超额阻断 | P0/P1 |
| `test-v9.4-serializer-spans.js` | role/消息顺序/多块共消息、重复内容、单块多消息、Plan 与最终 payload hash | P1 |
| `test-v9.4-provider-effective-request.js` | 七 Adapter 参数/流式/非流式、Thinking/Schema/Usage 尾帧、单次传输、取消 | P0/P1 |
| `test-v9.4-cache-evidence.js` | Provider 0/missing/invalid、DERIVED/UNKNOWN、firstChanged 非 native break、混合样本排除 | P1 |
| `test-v9.4-replay-audit.js` | Chat、Action、Final Summary、合法 Rolling/Recovery、Letter 模型路径，影子不发第二请求 | P0 |
| `test-v9.4-windows-packaged-smoke.js`（按现有工具落地） | LFS 物料、完整 locales、DLL、预加载/Renderer、首次无配置冷启动、透明点击穿透 | P0 |

### 14.2 Golden 必备场景（至少）

1. `v5/v6/v7` 各含无记忆和含长记忆两类。
2. `v813` 同 NPC 冻结前/后；跨 NPC 不串记忆；更换 responder 再回同 NPC。
3. `glm_cache_v2` system anchor、stable/live 分界、多轮动态关系更改。
4. `deepseek_v89` 与实际 `v5/v6/v7` layout 的组合，不混淆 profile/layout ID。
5. 自定义模板、suffix、示例消息、嵌入变量、脚本报错与合法空文本。
6. Recent2/PairLedger/官方追忆、合法第三人摘要、5+3/3+3 名额、失败不占名额。
7. 原始年龄与生日冲突、长幼称谓、公开亲属与未知关系；不因统一缓存提前确定未知事实。
8. 玩家与 NPC 交替发言，NPC 迟到/离开/暂离、历史裁剪与 rolling summary。
9. Forget 后再次提问、来源被修订、Campaign 变更、旧缓存命中指纹保持但授权撤销。
10. 真实请求预算临界值、Provider 模型窗口未知、非流/流式 usage-only 尾块。
11. 生成失败/取消/超时、partial response、重新生成仅更改台词、Action ACK 不重放。
12. Finalization/摘要编辑、删除和恢复映射；不能因 Chat PromptPlan 迁移产生双写。

### 14.3 Windows 发行 Cold-start Gate（新硬门槛）

**必须验证真实可执行文件，不得以 `node --check` 或模拟 Electron 代替。**

- 在 Windows 隔离 Runner 或干净独立目录取得**完整分发物**：`VOTC.exe`、DLL/Pak、`locales/`、`resources/app/`、`.bin` 等受 LFS 管理文件。
- 先确认 Git LFS 已拉取，关键文件不是 LFS pointer，查验资源清单/哈希。
- **不要仅凭 `np-test.exe` 或单独复制一份 EXE 当成可安装包**；入口必须来自完整发行目录。
- 不删除或重写用户 `%APPDATA%/VOTC`；创建隔离 Profile 和沙箱/临时用户目录。检查一次冷启动和至少一次关闭后重启。
- 真实启动进程并断言主进程、Renderer、Preload、IPC 建立；检查日志及启动时无立即退出。
- 断言设置→聊天后输入框可聚焦/键入、草稿保留，透明背景空白不会捕获全屏点击；托盘关闭/重启正确。
- 检测加载 `ffmpeg.dll`、`locales` 等关键资源；将缺文件/Win32 Error 5/资源清单不匹配分开报错。
- **不在发布脚本里自动降级 Windows Defender、安全完整性级别或大范围修改 ACL**；本机 Low/Medium 修复属于外部环境诊断，不能变成应用自修复行为。
- 若 CI 仅能完成可执行文件的受控隔离测试，则 CK3 Overlay 焦点的真实桌面复核仍必须在用户现场单独完成。

### 14.4 门禁分层与签署要求

| Gate | 通过要求 | 不通过时 |
|---|---|---|
| G0 代码与迁移审计 | 所有新增文件、输入/输出路径和旧配置兼容已核实 | 停止生产切换 |
| G1 纯函数 Golden | 不允许未解释的 role/顺序/模板/有效请求差异 | 保留 legacy 与影子，分析差异 |
| G2 权限负向测试 | Forget/Owner/Presence/Campaign/秘密/历史隔离严格通过 | **P0：停止发布** |
| G3 预算/冻结 | 成功后冻结、超限阻断、失败不提交，Action/Letter 不重放 | **P0：停止发布** |
| G4 Provider 契约 | V9.3 七 Adapter 的 39 组既有 Golden 和现有完整矩阵无回归（数量以当前清单为准） | 不将测试计数充当唯一证据 |
| G5 构建与部署 | Node22、locked dependencies、manifest、source/deployed parity | 停止安装/提交候选 |
| G6 GitHub CI | 指定最终源 SHA 的完整 Release Regression 为 SUCCESS | 不宣称 CI_PASS |
| G7 Packaged Windows | 全新完整发行目录 EXE/Renderer/IPC 冷启动、关闭重启、输入穿透通过 | **P0：不发布** |
| G8 Provider Live | 获授权的真实模型/端点/计费与原生 usage，有清晰 UNKNOWN 剩余清单 | 不宣称真实缓存收益 |
| G9 CK3 Live | 明确真实存档与 Mod 组合，多人、记忆、关系、Action/Letter 回执正常 | 不宣称 CK3_LIVE_PASS |
| G10 Soak/回退 | 连续场景与紧急回退无数据丢失、未知动作不重放 | 不签署正式冻结 |

原则上 P0/P1 必须关闭后才能最终声明本阶段完成。若用户明确允许某项真实端点在此时保持 UNKNOWN，可以保留该特定 Provider 的未验证能力说明，但不能将它标成 PASS，也不能规避对已经支持的核心生产路径的发布门槛。

---

## 15. 回滚、灾难恢复与发布安全

### 15.1 安全切换策略

- 开工前创建**不可变引用**或明确记录的 Git 基线/安装包哈希与最新成功测试记录，不在施工中覆写用户存档。
- 内部运行方式先 `legacy`，再 `shadow`（只比较且仅 legacy 发送），通过足量 Golden 后进入 `v9`（仅新路径发送）。用户请求的最终交付依然是**一个 V9.4 版本**。
- 新路径出现 `PLAN_SOURCE_REVOKED`、`PLAN_SCOPE_MISMATCH`、`PROMPT_PLAN_INPUT_BUDGET_EXCEEDED` 等安全阻断时不得偷偷 fallback 到另一条**未经当前来源复核**的老路径；只有完成安全复核的旧发送链才可紧急使用。
- 回退前停止新发送，确保 pending 请求和未知 Effect 不会因热切换被重复执行。
- 回退目标仅包括应用源码、构建与部署的验证资源、布局选择；不回滚用户写入的 Memory、Summary、Forget ledger、ACK、Letter、Pending 或 Journal。
- 执行原有 `build-runtime → verify-runtime-build → deploy-runtime-build → verify --deployed` 链路，并再次检查二进制运行包版本/签名/资源完整性。
- 回退操作应提供可执行检查清单和最后有效状态，不直接运行破坏性 `git reset --hard` 对用户工作区和数据做无差别覆盖。

### 15.2 灾难信号与立即响应

| 信号 | 首次响应 |
|---|---|
| Forget 已撤销内容出站 | 阻断相关新请求，保留脱敏证据，冻结后续提交，不允许重发送到另一个 Provider |
| Owner/Campaign 串档 | 停止当前会话并隔离来源，核对快照与完整链路 |
| 冻结摘要重复提交、记忆凭空消失 | 暂停成功回执提交、保存 Epoch/Source 证据，使用已验证的安全路径恢复 |
| Action/Letter 重复/未知执行 | 保留 ACK/RunFile 状态，不重新驱动 Effects，按现有副作用恢复合同执行 |
| 缓存命中骤降但无授权/功能错误 | 先扩大同类样本、检查 Native Usage 与首次变化区块，不把它自动当 P0 |
| EXE 无法启动或整屏拦截点击 | 立即阻断发布，检查完整分发目录、Windows 错误/日志/Renderer 与 overlay 原生状态 |

---

## 16. 建议生成的施工交付物

V9.4 所有代码和报告在同一个最终版本内交付：

1. **PromptPlan V9 Schema 与 ADR**：定义七类语义块、版本、来源、生命周期和回滚合同。
2. **布局兼容 Golden 集合**：六布局+各 Request Type 的冻结 Fixture、差异白名单、更新审批记录。
3. **统一 Serializer 与预发送预算/权限检查**：真实生产接入点有代码/测试证明。
4. **冻结与失效矩阵实现**：来源修订、Forget、多人会话/响应者隔离、成功提交证据。
5. **Cache Diagnostics V2**：原生 vs 派生 vs 本地估算 vs UNKNOWN，现有 Renderer 诊断兼容。
6. **全部新增测试及 test-manifest 登记**；Node22 完整 CI 结果、二进制 Cold Start 验证记录。
7. **发布与回退核对表**：Git SHA、payload SHA-256、EXE/DLL/locale/LFS 指纹、真实安装情况、缺失证据。
8. **V9.4 实施报告 + 验收报告 + V9.5 移交单**：明确已完成、待验证、已接受风险、实机发现问题、确切证据级别。

### 16.1 建议执行命令（以施工时 HEAD 为准）

```powershell
# 在项目根目录，Node.js 22；先阅读根目录与所属目录 AGENTS.md

git status --short
git rev-parse HEAD
git lfs pull
node scripts/test-release-assets.js
node scripts/runtime-dependencies.js

# V9.4 独立专项：脚本落地后逐项执行，均需登记到 test-manifest
node scripts/test-v9.4-plan-schema.js
node scripts/test-v9.4-legacy-layout-golden.js
node scripts/test-v9.4-responder-isolation.js
node scripts/test-v9.4-knowledge-forget.js
node scripts/test-v9.4-freeze-lifecycle.js
node scripts/test-v9.4-budget-preflight.js
node scripts/test-v9.4-serializer-spans.js
node scripts/test-v9.4-provider-effective-request.js
node scripts/test-v9.4-cache-evidence.js
node scripts/test-v9.4-replay-audit.js

# 标准源码构建、部署与完整回归
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
git diff --check
```

`test-v9.4-*.js` 目前是**待开发的建议测试名**，不能在编写之前声称可执行；最终由实施者同步修改 `test-manifest.js`、CI 和报告。Windows 打包 Smoke 应在能启动完整 EXE 的 Windows 环境执行，不能在没有 GUI 的测试环境用 Node 模拟冒充已通过。

---

## 17. 给 Codex 的最终执行约束

1. **单版本完成**：本设计的 WP-A～WP-F 是同一 V9.4 的工作安排，不生成六个独立正式小版本，不把阶段中间状态称为已发布。
2. **先读代码与 AGENTS.md**：确认 `2330bbc` 或最新实际 SHA、源/构建/部署映射和修改前数据合同；避免照抄文件名而误改无关模块。
3. **不改变功能语义**：默认重构的目标是等价输出。想调整前缀、Prompt 顺序、历史数量、合法来源上限时必须有单独的最小对照与明确批准。
4. **不弱化安全门禁**：身份/知情/来源/Forget/Action/Letter 的负向断言优先级高于缓存收益，任何未授权事实出站都是 P0。
5. **尽量少动业务**：Memory4、Worldline、角色亲属/年龄、Action、Letter 不因 PromptPlan 分层而重新实现第二套。
6. **最终出站是权威比较对象**：对接已存在七个 Provider Adapter 的真实传输形态；本地中间表示只供解释，不证明服务器缓存。
7. **不得假绿**：错误的旧 Golden 需要解释、修正夹具并补反例，不能跳过测试或机械更新所有 Snapshot 让 CI 通过。
8. **不自动联系付费 Provider**：真实端点的成本/模型/样本预算由用户再次授权；无授权保留模拟与 UNKNOWN。
9. **保护本地用户数据**：不得清理 `%APPDATA%/VOTC`、重生成已退役记忆、覆盖旧存档；运行安装/诊断不改系统 Defender、完整性策略或 Windows 全局 ACL。
10. **报告必须可审核**：写明每个接口变化、差异、测试、风险、证据 SHA/时间，以及 `CODE_REVIEWED`、`LOCAL_TEST_PASS`、`CI_PASS`、`PACKAGED_PASS`、`PROVIDER_LIVE_PASS`、`CK3_LIVE_PASS`、`SOAK_PASS` 中真实达成的级别。

---

## 18. V9.4 → V9.5 移交边界

V9.4 完成后，V9.5 可以沿用：

- 统一 `PromptPlan` 的稳定区块与缓存诊断 DTO；
- 原生/估算/UNKNOWN 的明确标记，避免 UI 国际化过程中误翻译统计口径；
- 统一角色/历史/记忆的只读诊断入口和错误码；
- 已独立稳定的 Provider/Request/Scope 元数据，便于 V9.5 组件化状态管理；
- 单次出站、取消/重试、请求 epoch 的可观测合同。

**V9.5 不应被迫重新开发 Prompt 缓存**；而 V9.4 不应提前侵占 V9.5 的布局、英文/中文和主题组件化任务。

---

## 19. 资料来源与证据边界

### 19.1 用户已提供的路线基线

- 《v9阶段开发总路线文档.md》，Revision 2：V9.4 目标为 PromptPlan、稳定前缀、厂商 Serializer 和缓存诊断；保留旧布局配置、知识权限不变量以及真实 Provider Cache 证据与本地估算的区别。
- 路线文档 §7.5 的七类建议语义块、§8 跨版本 P0/P1 风险与 §10 全阶段完成定义已落实为本文合同。

### 19.2 仓库审查入口（2026-10-20）

- [VOCT-NEW main / 2330bbc](https://github.com/wsdsb-111/VOCT-NEW/commit/2330bbcb6c068a4e42c19b26eba82f4034e6db63)
- [V9.3.9.3 实施报告](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/current/v9/V9_3_9_3_IMPLEMENTATION_REPORT.md)
- [V9.3 → V9.4 移交](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/current/v9/V9_3_HANDOFF_TO_V9_4.md)
- [PromptBuilder 源码](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/prompts/prompt-builder.js)
- [Prompt 布局选择](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/prompts/provider-prompt-adapter.js)
- [Conversation 主流程](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/conversation/conversation.js)
- [Real Request Diff](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/analytics/real-request-diff.js)
- [Provider Diagnostics](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/analytics/provider-diagnostics.js)
- [Usage Normalization](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/providers/usage-normalization.js)
- [Provider 平台](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/providers/provider-platform.js)
- [V9.3 Provider 能力矩阵](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/current/v9/V9_3_PROVIDER_MATRIX.md)
- [最新 Windows CI（对应 2330bbc）](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39397200360)

### 19.3 来源与建议的区分

**已核对的仓库事实**包括：现有多布局 PromptBuilder、V813/GLM 缓存布局与冻结快照、Provider 归一化、Real Request Diff、当前 V9.3.9.3 完整 CI 成功和本机启动事故记录。**本文新增的架构建议**包括：`PromptPlan V9` Schema、拟新增文件、统一 Serializer、请求三类指纹、失效原因码、V2 诊断 DTO、施工 WP 和新增测试脚本。这些方案需要实现、运行与验收，不能当作目前已经存在的功能。

> **最终决策**：V9.4 一次性交付 PromptPlan V9 + 全布局等价映射 + 稳定前缀与权限失效闭环 + Provider-aware 最终请求诊断 + Cache Diagnostics V2 + 真正可启动发行物的验收。**保持 V9.3 功能与记忆语义不回退，不以命中率数字替代正确性证据。**

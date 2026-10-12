# VOCT V9.2.3 详细设计与施工方案

## Memory4 Life/Year 自动生成退役 × GLM 缓存异常根因调查与最小修复

> **文档性质**：可交给 Codex 按工作包执行的工程施工规格（Design + Implementation + Verification）。
> **开发阶段**：V9.2.3，V9.2 后置、V9.3 前置的成本止损与诊断修复；**不改变** V9 总路线分期。
> **当前审查基线**：`wsdsb-111/VOCT-NEW`，`main`，`071f62b73d27cf4bd37309e5e836335f914c174d`（仓库提交信息 `v9.2.2`）。实施前必须重新验证 HEAD、工作树、现有安装资源与该 SHA 对应关系。
> **设计依据**：`docs/current/v9/V9_ROADMAP.md` §§7.3–7.5、§8–10；V9.2.1/9.2.2 仓库验证报告及实现；用户 2026-10-12 多轮 CK3 实机统计和体验反馈。
> **工程价值次序**：**实际费用安全 > Durable/Forget/Scope 正确性 > NPC 有效历史回忆 > 真实缓存命中率 > 模型输出规模**。
> **性质区分**：文中“已确认”指已审查到具体代码机制；“用户实机观察”指截图/反馈；“待验证”是需要本地记录或真实 API A/B 的假说。尚未运行本方案的修改、测试或 CI。

---

## 0. 执行摘要与决策

本版有两项 **明确施工任务**，不得以另一项未完成为理由继续让异常费用扩大。

1. **正式退役 Memory4 Year/Life 的自动大模型生成、自动再生成、恢复补算与失败重试**。保留 Memory4 Durable Detail、Legacy、跨年代原始事实检索、授权/Forget/Tombstone、Year/Life 旧文件的只读兼容与必要的安全失效处理。确保所有正常游玩路径 **新增 `memory4_year`、`memory4_life` API 调用数严格为 0**。
2. **调查并最小修复 GLM-5.3-Flash Chat 缓存不稳定**，特别是实际长上下文里约 36.8% 的加权命中率及 45 次请求中 20 次供应商报告零命中。先证明真实出站前缀/参数是否一致，再决定是否需要变更；严禁为了命中率冻结实时世界/知识状态、改变人物私有记忆授权或凭空提高统计值。

**不得做的事情**：删除 Memory4、丢弃原始 Detail、清空 Recovery、直接删除所有 `years/`/`life.json`、切换 SQLite、重写全局 PromptPlan/缓存平台、重构全部 Provider、修改 CK3 Bridge、把 Three-Mod 合并回主工程。完整 Provider Platform 属于 V9.3；完整 PromptPlan/稳定前缀重构属于 V9.4。

### 0.1 验收逻辑

- **G-DERIVED / 必达**：新 `memory4_year` 与 `memory4_life` 调用 = **0**，包括正常结算、已有 Durable、恢复、Legacy、活动队列、历史失败快照、手动旧入口（如果保留仅允许非模型读/编辑）。旧文件不被删除；原始 Durable 正常提交；恢复不空转。
- **G-SAFETY / 必达**：Owner×Campaign、Forget、Tombstone、Source Revision、Commitment、Legacy 不回退，已有两个 V9.2.2 P0 修复保留。
- **G-GLM-DIAG / 必达**：对原生零命中完成可复现分组、旧/新版本出站等价对照；能明确标为 `APP_PREFIX_DIFF`、`APP_PARAM_DIFF`、`COMPARABLE_PROVIDER_ZERO`、`EXPECTED_COLD` 或 `UNKNOWN`。
- **G-GLM-FIX / 条件**：只有证明应用层可控缺陷才修改最小相关代码；若无应用层缺陷，则输出证据、保留 `UPSTREAM_OR_UNRESOLVED`，不实施无证据 Prompt 调整。**不保证必须达到某个任意百分比**。
- **G-RELEASE / 必达**：指定新 SHA 的完整测试、构建产物、远端 CI、CK3 多人/跨年代/Forget 实机、成本监测符合门禁；历史报告不可冒充新版本证据。

---

## 1. 已有证据与准确的问题边界

### 1.1 用户实机数据（不混用窗口）

以下摘自用户提供的最近一次统计窗口，与先前 GLM、Durable 窗口 **不构成严格 A/B**：

| 请求 | 次数 | 输入 Token | 总 Token | 推算输出 Token | 缓存命中率 |
|---|---:|---:|---:|---:|---:|
| `memory4_life / deepseek-v4-flash` | 80 | 1,174,167 | 1,437,309 | **263,142** | 98.6% |
| `memory4_year / deepseek-v4-flash` | 79 | 839,789 | 1,109,979 | **270,190** | 98.3% |
| **Life + Year** | **159** | **2,013,956** | **2,547,288** | **533,332** | 高命中不代表低输出费 |
| `chat / zhipu / glm-5.3-flash` | 45 | 786,237 | 823,500 | 37,263 | **36.8%** |
| `memory4_durable` | 22 | 678,809 | 717,962 | 39,153 | 77.1% |

- 当前窗口约 **53.3 万 Year/Life 输出 Token**，平均每次约 **3,354**。这是按分类统计推算的总输出，包括模型推理/结构化响应及失败尝试；**不代表落盘摘要字数**。
- 45 次 GLM Chat 中约 **20 次**报告零命中，同一会话可出现 19,392/1,229、20,608/13 的高缓存请求，也可出现 0/28,642 的零命中。
- 用户实测：当前 NPC 的 Year/Life **没有可见的有效摘要**，玩家角色可能有；现有 Memory4 Detail/Legacy 已能正常处理 5 年、10 年之前的历史召回。**这是用户侧事实反馈，不擅自断言所有 NPC 磁盘文件均不存在**。
- 另一张按小时 Tokens 图记录“某小时输出 460,813”，与表格的总窗口不同；禁止将它写为 Year/Life 精确输出或同一时间窗口的结果。

### 1.2 源码已确认的 Year/Life 机制

| 文件 | 已确认事实 | 本版意义 |
|---|---|---|
| `src/app/main/memory-system/memory4-derived.js` | `schedule()` -> `rebuild(kind:"all")`；按 Owner 各年度 `buildYear()`，再 `buildLife()`；`compress()` 最多 2 次质量尝试；写入 `years/<year>.json` / `life.json` | 必须关闭 **所有 LLM 生成入口**，保留只读与权限失效逻辑 |
| 同文件 | 年度组压缩失败后可继续扫描其他年份，最后仍失败；任务排队及 `setImmediate` 重新调度 | 失败来源可触发重复成本，须强制阻断新自动调用 |
| `src/app/main/memory-system/memory4-coordinator.js` | `finishOwner()` 已提交 Durable 后调用 `finishCommittedDerived()`；Legacy `recompressLegacy()` 也可请求重建；已提交来源的 `recoverPending()` 会进入 Derived | 不得只注释 `compress()`：否则 Durable 恢复会继续卡住 |
| 同文件 | `DERIVED_REBUILD_FAILED` 多处写入 `retryCount: prior?.retryCount || 0`，不增长；`recoverPending()` 自动停止门槛为 `retryCount >= 3` | 已确认存在失败反复自动恢复的代码路径 |
| `src/app/main/conversation/conversation.js` | 进入对话会后台 `recoverPendingMemories()`；结束对话 `finalizeConversation()` | 必须覆盖开场恢复与关场结算 |
| `src/app/main/main.js` | `configureDerived({requestCompression: (...) => llmManager.sendSummaryRequest(...)})` | 正式出站链路的零调用验收点 |
| `src/app/main/memory-system/memory4-recall-planner.js` | 原始 Detail 和 Legacy 独立召回，Year/Life 仅作可选 `derived.selectSlice()` 概览 | 可以保留多年前检索，不必维护付费派生视图 |

**关于“NPC 为什么没有 Year/Life”的证据边界：**源码没有硬编码仅玩家 Owner 才能生成；Year/Life 带 Owner×Campaign 作用域。可能原因包括压缩质量失败、某年度失败阻断 Life、`dirty`/来源版本失效、侧车目录问题或 UI 展示路径，但当前没有用户磁盘诊断证明是哪一种。**本版不以修好 NPC Year/Life 为目标**；只留下只读匿名失败分类，避免再花模型费用去追逐非核心功能。

### 1.3 V9.2.1 → V9.2.2 GLM 对照：不能预先认定回归

仓库两版对应提交：

- V9.2.1：`edb389623ba34e8a668779b74509d8f1b2bf78cb`
- V9.2.2：`071f62b73d27cf4bd37309e5e836335f914c174d`

实查两版以下权威源文件 **逐字节相同**：

- `src/app/main/prompts/prompt-builder.js`
- `src/app/main/config/settings-repository.js`
- `src/app/main/prompts/provider-prompt-adapter.js`
- `src/app/main/analytics/real-request-diff.js`

`provider-service.js`、`providers/index.js` 有改动，但主要增加 **Durable 专用** `requestControl/beforeSendGuard` 与请求追踪。普通 `sendChatRequest()` 调用 `provider.chatCompletion(request, activeConfig)` 时**不传**该专用第三参数。V8.13 全局布局在 `getChatPromptV813Layout()` 仍固定 `true`。这属于反对“V9.2.2 改坏 GLM Prompt 布局”的代码证据，**但尚未通过旧新二进制/实际请求逐字节对照完全排除 Provider 的间接影响**。

V9.2.1 报告中 GLM 同 NPC 热缓存约 96%、三 NPC 热约 87%，是在 **约 1.6K–2.6K Token 的合成短 Prompt** 上得到，而且 A/B 生产布局实际上相同；本次实机平均 **约 17.5K 输入 Token/请求**。V9.2.1 **没有实证“修好 GLM 的真实长对话缓存”**。必须先消除这一错误归因。

---

## 2. 缺陷登记（施工前，未自动宣称修好）

| ID | 优先级 | 类型 | 问题 | 状态与处理 |
|---|---|---|---|---|
| `P0-COST-01` | **P0 施工阻断候选** | 成本与恢复 | Year/Life 自动重复生成可造成异常巨量模型输出；实际 159 次/53.3 万输出 | **用户实测异常 + 确认代码循环风险**，具体触发比例待取证；V9.2.3 必须止损 |
| `P1-DER-01` | P1 | 控制流 | 退出/恢复/Legacy/队列绕过单入口开关 | 确认多入口；统一策略收口 |
| `P1-DER-02` | P1 | 持久化 | `DERIVED_REBUILD_FAILED` 失败计数不增长、已提交 Durable 恢复被 Derived 成败阻塞 | 确认；状态机修复、历史积压隔离 |
| `P1-DER-03` | P1 | 数据正确性 | 停用派生后仍需维护旧 Year/Life 对 Forget、dirty、source revision 的安全过滤 | 预防回归，必须回归 |
| `P1-GLM-01` | P1 | 费用/缓存 | 实机 GLM 45 次仅 36.8% 命中，20 次供应商报告零命中 | 实测确认，应用/上游根因未归因 |
| `P1-GLM-02` | P1 | 对照有效性 | 将 V9.2.1 短合成热缓存误解释为真实长局已修复 | 证据解释缺陷，必须在报告纠正 |
| `P2-DIAG-01` | P2 | 观测 | Year/Life 的请求费用、结果有效性、是否写盘与 Recovery 归因不清 | 本版补历史快照和新报告；退役后不增加新调用 |
| `P2-DIAG-02` | P2 | 观测 | 真实 GLM 零命中缺少按会话/人物/端点/参数/TTL 的归因 | 复用 `realRequestDiff`，仅增量补字段 |

P0 是**成本失控发布门槛**，不是断言目前 Memory4 数据发生删除/泄漏；遇到 Owner 交叉或 Forget 复活才另列数据安全 P0。

---

## 3. V9.2.3 范围约束与不可变合同

### 3.1 In Scope

1. Year/Life **所有自动大模型调用退役**及其队列、旧恢复状态、手动可触发模型入口的成本封禁。
2. 保留旧 Year/Life 文件只读/手动编辑接口（若原 UI 有编辑），但不产生后台新生成。
3. **Durable 提取、提交、Commitment、Forget、Source Revision、Legacy 归档保留**，已提交 Durable 不再等待 Derived 成功才能完成正常恢复清理。
4. GLM 出站差异审计：同场景有效请求 JSON、角色/会话、提示块哈希、流式参数、原生 Usage、HTTP endpoint、时间间隔。
5. 在实验允许且有证据时实施**最小** GLM 修复；执行与未执行的真实端点测试分别留证。
6. 版本号、文档台账、发布回归、真实成本报告。

### 3.2 Out of Scope

- 新建或重写完整 `PromptPlan`、全局 Block Serializer、跨 Provider 缓存控制系统（V9.4）。
- 重构七个 Provider 的统一运行平台（V9.3）。
- 重写 Memory4 Durable Schema/Fragment/Commitment 或删减年度历史 Detail。
- 新建“更便宜的 Year/Life 替代模型生成”；如未来有需求单独立项。
- 因 Year/Life 停用而直接清理旧用户目录、旧 JSON、Tombstone、Recovery 与历史文档。
- 为提高 GLM 命中，把活动关系、当前 CK3 世界/日期或未授权记忆挪入跨 Owner 静态前缀。

### 3.3 不变式（任何违反直接阻断）

- `campaignToken × ownerId` 不能串档，`knownBy`/Disclosure/Forgotten/Tombstone 在**召回前**强制校验。
- Year/Life 的旧摘要即使只读也不能绕过 Source Revision/Forget；失效则 **不注入 Prompt**。
- 已成功提交的 `memory4_durable` Detail **不因派生退役而重做**；已提交/未提交的恢复状态必须区分。
- `final_summary`、`memory_recovery`、`memory4_durable`、Action、Letter、Worldline、Provider Chat 继续按原合同工作。
- 退役不删除用户多年历史；也不将模型派生摘要伪造成已存在的有效档案。
- 无原生供应商报告的缓存数值显示 `UNKNOWN`，不得填 0 或估算命中。

---

## 4. 目标架构

### 4.1 退役前

```text
Conversation Finalization / Recovery / Legacy
    → Memory4 Durable extraction (必要)
    → commitOwner() + 来源证明 (必要)
    → Derived.schedule/rebuild(kind=all) (高成本)
         → years[] → Year LLM compression × N × retry
         → Life LLM compression × M × retry
    → 失败保留 DERIVED_REBUILD_FAILED
    → 下一场启动 recoverPending() → 再执行
```

### 4.2 退役后

```text
Conversation Finalization / Recovery / Legacy
    → Memory4 Durable extraction + typed verification
    → commitOwner() + Forget/SourceRevision 校验
    → 标记 derivedGeneration=RETIRED_POLICY（仅本次运行状态）
    → 完成 Durable/叙事恢复 handoff；不等待 Year/Life
    → 必要时记录匿名退役审计；无 LLM compress()

Memory Recall
    → 当前合法 Detail / Legacy / 官方历史（原有路径）
    → [可选] 已存在、仍 sourceValid 的旧 Year/Life 只读片段
    → 超时/无视图/dirty 时回退 Detail，不自动重建
```

**提示**：`RETIRED_POLICY` / `SKIPPED_DERIVED_POLICY` 是本方案建议的*新内部状态*，非现有 API 已实现常量。Codex 应选定一个无歧义内部枚举名，增加合同测试；对外 `COMPLETED` 只表示相应已经验证的 Durable 阶段完成，**不能**宣称派生档案已生成。

### 4.3 默认策略

建议 **V9.2.3 固定策略值** `derivedLLMAutoGeneration = false`，以可测试常量/Service Policy 作为唯一权威；旧配置中若存在未来遗留 true，也不得覆盖此默认。不要临时新增一个可能误开巨大费用的 UI 开关。未来若要手动生成，需要独立版本重新评估成本上限和用户确认。

---

## 5. WP-00：冻结基线、成本证据与止损

### 目标

保证测试可以重现，且施工期间不会误操作真实存档。

### 步骤

1. 记录 `git rev-parse HEAD`、`git status --short`、当前 App/Core UI/Workshop 版本、`resources/app/out` 和 `src/app` 是否一致。基线 SHA 预期为 `071f62b`；若已改变，先重新比较。
2. **完全退出 VOCT/CK3** 后，对用户摘要、`.memory4`、`years/`、`life.json`、`recovery/`、`metadata.json`、Legacy、Forget/Tombstone、Provider 配置进行**限定目录备份**，制作文件数/字节数/hash 清单；不可在日志公开 API Key 或记忆正文。
3. 从诊断导出只读窗口整理请求类型/次数/原生输入、缓存命中、非命中、输出、finishReason。区分“全部历史累计”和“本场对话”。
4. 在测试环境使用合成 Owner、Campaign、Recovery；**禁止拿真实存档直接做故障注入**。
5. 暂停额外长时间实机压力测试直到 WP-02 熔断正确：防止历史队列自动再次生成 Year/Life。

**产出**：`docs/current/v9/V9_2_3_BASELINE.md`、`v9.2.3-baseline-evidence.json`（仅脱敏统计、路径哈希、验证结果）；实际私有备份不提交 Git。

---

## 6. WP-01：统一 Year/Life LLM 生成退役策略（最高优先级）

### 文件

- `src/app/main/memory-system/memory4-derived.js`
- `src/app/main/memory-system/memory4-coordinator.js`
- `src/app/main/main.js`
- 关联 Service Port / IPC（以当前运行源码查找全部 `schedule(`、`rebuild(`、`requestCompression(`、`buildYear(`、`buildLife(` 后确认）

### 施工要求

1. **单一权威、默认 OFF**：实现 `isAutoGenerationRetired()` 或等效恒真策略，不依赖某个画面/调用方传参；`configureDerived()` 的 `requestCompression` 保留为兼容受控输入，但生产状态下绝不会被调用。
2. 在 `schedule()`、`rebuild()` 的**最外层**拦截未来新任务；即使上游漏改也不能调用 `compress()`。对 `kind:"all"|"year"|"life"` 一致有效。
3. `buildYear()`、`buildLife()`、`compress()` 出站前还应有**第二道防线**，拒绝退役后的任何模型生成。测试用 `requestCompression` 抛异常/计数器，证明调用数为 0。
4. 仍存在的 `active` 任务：在启用退役策略时 `cancel(scope)` / abort，并禁止稍后 `persist()`；**不能依赖 abort 必定阻止已经发送的请求计费**。如果运行中安全切换不可证明，版本部署需要求退出 VOCT，启动时即固定 OFF。
5. `queuedRequest` 和 `REQUEUED` 的 `setImmediate` 路径在退役状态下不得再次排队。
6. 不删除 `snapshot()`、`sourceValid()`、`validView()`、`getPointers()`、`getSources()`、`selectSlice()`、`markDirty()`、`forgetEntries()`、现有只读/手工编辑（如适用）；这些是数据安全与旧存档兼容必需。
7. **保留 dirty**：退役只代表不再追求派生最新，不修改事实源 revision，不为了 UI 显示强行将旧文件标为 clean。

**建议伪码（非可直接替换的正式实现）**：

```js
const DERIVED_LLM_POLICY = Object.freeze({ autoGenerate: false });

function retiredGenerationResult(kind = 'all') {
  return {
    status: 'SKIPPED_DERIVED_POLICY', // 提议的新 typed 状态
    kind,
    generated: false,
    providerRequests: 0
  };
}

// 在 schedule/rebuild 的第一层拒绝出站
if (!DERIVED_LLM_POLICY.autoGenerate) {
  return Promise.resolve(retiredGenerationResult(options.kind || 'all'));
}

// 在 compress 的真实 Provider 前设置单独防御性断言
if (!DERIVED_LLM_POLICY.autoGenerate) {
  throw new Error('memory4_derived_llm_retired');
}
```

**注意**：示例不能原样覆盖 `async rebuild()` 的异步调用约定。Codex 必须按现有函数签名、Promise 类型及调用方预期适配；`retired` 不应被视为生成成功。

### WP-01 正反例

| 场景 | 预期 |
|---|---|
| 普通结束三人对话 | 各 Owner Durable 照常处理，Year/Life 真实 Provider 请求均 0 |
| 记忆新增、编辑、Forget、Tombstone | 可以置 dirty / scrub 旧派生，但不能触发 LLM rebuild |
| `rebuild(kind:"all")` 直接/间接被调用 | 返回可识别的退休状态，无 Year/Life 请求 |
| `rebuild(kind:"year"/"life")` 及旧手工“重新生成”入口 | 明确 Unsupported/Disabled；不得默默调用模型 |
| Source Revision 在运行中变化 | 无新派生落盘；旧视图安全拒绝 |
| 已存在有效旧 Year/Life | 可通过既有严格来源校验只读，不需要重新生成 |

---

## 7. WP-02：Derived/Recovery 状态机解耦，修复失败空转

### 需要覆盖的全部入口

在 `memory4-coordinator.js` 中逐一处理（按当前源码定位，实际施工以函数名和调用图核对为准）：

1. `finishOwner()` 中已有 `commitOwner()` 的路径。
2. `finishOwner()` 中初次 Durable Commit 成功路径。
3. `finishCommittedDerived()`。
4. `recompressLegacy()` 的“已转换并 `rebuildDerived=true`”分支及已有/新提交分支。
5. `recoverPending()` 自动扫描已提交 finalization 的 `DERIVED_REBUILD_FAILED`；`legacyRecompression === true` 的已提交特殊分支。
6. `Memory4DerivedService.schedule()` 的 pending queue、`rebuild()` 的 `finally` 队列、source-changed 自重排。
7. Electron Main `configureDerived()` 的正式 `requestCompression` 插口。

### 必须明确区分的持久化状态

| 现有文件/记录 | 原始 Durable 是否提交 | V9.2.3 处理 |
|---|---|---|
| 纯 `DERIVED_REBUILD_FAILED`，finalization/source revision 证明已成功且所有 Durable 事实存在 | YES | **停止派生恢复**；记录退休审计；在受控事务下结束 *派生待恢复标记*，不重新写 Detail |
| `PENDING`/`EXTRACTION_FAILED`，原始 Durable 未提交或证明不足 | NO/UNKNOWN | **保留原恢复**，继续 Durable 专用恢复与 Forget/source guard；不允许把“退役派生”当作 Durable 已成功 |
| `legacyRecompression`，旧 Legacy 已转换并且 Durable 已验证 | YES | 保留 Legacy 来源与 Detail，跳过派生重建；旧派生恢复可收口 |
| Legacy 正在转换但尚未提交 | NO | 继续受控的原有转换/恢复（若用户仍启用该功能），**只跳过后置派生** |
| 破损/无法解析的 Recovery JSON | UNKNOWN | 保全原字节并报警；不得假定成功、删除或重建源 |
| 不同 Campaign 的 Recovery | OTHER | 原封不动保留，不跨战役处理 |
| 退役前残留主动异步任务 | UNKNOWN | 停止新出站；确保不落盘过时派生；记录有限诊断 |

**状态机改动关键**：原 `retryCount` 在派生失败时不增加属于已确认旧缺陷；V9.2.3 不应仅靠 `+1` 修复空转，而应让**已提交 Durable 不依赖派生成功**、派生恢复从自动重试路径退出。旧版 `DERIVED_REBUILD_FAILED` 不得被当作 `EXTRACTION_FAILED` 再调用 Durable Model。

### 建议兼容标识

- 运行结果：`derivedGenerationStatus: "SKIPPED_DERIVED_POLICY"`、`durableStatus: "STORE"|"NO_DURABLE_CONTENT"|...` 分开。
- 旧 Recovery 文件：**优先最小化迁移**。若已证明仅剩派生阶段且已经 Durable committed，可以保留原件副本/写退役 receipt 后安全完成该恢复阶段；若现有 Recovery 合同不允许新增 status，采用经验证的兼容审计标记，而不是直接把旧 `status` 改成“成功”。
- 退役证明键：`hash([campaignToken, ownerId, finalizationId, sourceRevision])`，只记录哈希与状态，不导出人物身份及正文；若意外重跑，应幂等。
- 手工恢复按钮：对纯派生旧任务回报 `SKIPPED_DERIVED_POLICY`，不得悄然再次产生付费请求；对真正未提交 Durable 的恢复继续按原流程。

### 事务与删除限制

凡需要结束旧 Recovery 状态，只允许在 **Durable Commit/source revision 证明**与文件内容检查成功之后，并使用现有原子写入/Journal/恢复约定。禁止广泛 `rm -rf recovery`，禁止把 `lastError` 清空来假装已成功，禁止修改 `knownEvidenceRevisions` 来绕过来源检查。

### 退出验收

- 同一个 `DERIVED_REBUILD_FAILED` 快照跨重启、连续进入 5 次会话、反复调用 `recoverPending()`：Year/Life Provider 调用恒 0，恢复状态有可解释结果、无重复模型消耗。
- 真正未提交 Durable 快照仍按原方式安全恢复，成功后不生成 Year/Life；晚到 Forget 仍可阻止旧正文发送。
- 旧已提交 Detail 的 `index.revision`、entries 与来源 hash 在“跳过派生”过程中不变。

---

## 8. WP-03：只读兼容、时间召回与 NPC 成本/质量验证

### 8.1 既有检索保持原样

- `Memory4RecallPlanner.plan()` 原生 Detail 候选过滤、`knownBy`、Scope、日期、Temporal Focus、来源版本与 Forget 仍然执行。
- `derived.selectSlice()` 可以只读现有有效 Year/Life；当缺失、dirty 或失效，则 `null`，**不能自动调用 Provider 补齐**。
- `conversation_year` 已有非 LLM 的临时概览路径，在原适用条件下保留；不得误认为它是 Year LLM 新派生视图。
- 保持最多 1 份概览、最多 2 条 Detail、LIFE 细节最多 1 条和现有 Prompt 总预算等行为约束；不因为停用派生而增大无限历史正文。

### 8.2 旧文件与 NPC 视图

- 保留已生成 `years/<year>.json`、`life.json`、revision、manual_override、sourceRevisionSet；不自动“补修”NPC 缺失年份。
- 旧文件中的 Forget 污染仍需经 `markDirty/forgetEntries/sourceValid/validView` 阻断；**退役不代表停止 Forget 安全处理**。
- UI 可显示“派生档案自动生成已退役；此处为历史只读结果/无有效结果”，不要显示“生成成功”。本版仅做最小状态文案，不实施 V9.5 UI 架构重做。
- NPC 与玩家角色均相同策略，不做单独的“玩家仍允许大量 Year/Life 生成”例外。

### 8.3 历史记忆 A/B（离线＋实机）

在同一份只读克隆存档和相同时间点，比较“V9.2.2 当前行为”与“V9.2.3 退役行为”的**回答事实质量**，但不要为了 A/B 在真实旧版中继续大规模派生生成；建议用事先已持久化的合法历史视图与 Detail-only 两组隔离回放。

| 测试问题 | 最低正确性 |
|---|---|
| “五年前那次会面发生了什么？” | 能据授权 Detail/Legacy 正确召回，不编造日期或人物 |
| “十年前你答应过我什么？” | Commitment 原状态和条件正确，已撤销的承诺不复活 |
| “某一年最重要的三件事是什么？” | 能选择存在的来源；如果检索不足，承认不完整，不伪造完整年度编年史 |
| “你的一生有什么重大转折？” | 允许宏观叙事变弱，但必须保持已知事实正确性 |
| 未知/未见过人物、缺席耳语 | 不跨 Owner 读取、不越权声称亲历 |
| Forget 后重复历史提问 | 完全不得召回已忘来源及其旧派生文案 |

**质量 Gate**：重要事实/来源安全/承诺不能退步；宏观概览自然度可记录为被接受的明确退化（成本优先的用户已授权），但不得写作“质量完全无影响”。

---

## 9. WP-04：GLM V9.2.1 → V9.2.2 差异证伪，先不改 Prompt

### 9.1 已知对照（先写入报告）

- PromptBuilder、配置仓库、ProviderPromptAdapter、realRequestDiff **逐字节相同**。
- 当前 `getChatPromptV813Layout() = true`；GLM 专属 `glm_cache_v2` 分支不是当前生效路径，不能“直接切换”当作缓存 Hotfix。
- `sendChatRequest()` 的常规 Chat 仍调用 `provider.chatCompletion(request, activeConfig)`；V9.2.2 的第三参数钩子主要服务 Durable。需要在精确 JS 出站 JSON 及旧/新产物层再次证明等价。
- V9.2.1 的 96 个 GLM 合成测试证明短上下文热请求可复用，不证明 15K～30K 的真实多人历史局稳定。

### 9.2 准备三个隔离实验基线

| 基线 | 使用目的 | 操作 |
|---|---|---|
| 旧 `edb3896` | V9.2.1 真实构建逻辑 | 在隔离目录从已锁定源码构建；不覆盖用户安装版 |
| 当前 `071f62b` | V9.2.2 真实逻辑 | 与旧版本用相同配置、固定合成输入进行离线出站比较 |
| V9.2.3 候选 | 验证最小修复不破坏参数与前缀 | 自动使用同一套 fixture 检查 |

严格比对 `ZhipuProvider.buildDiagnosticRequest()` **序列化后的**完整语义请求：`baseURL`（匿名哈希）、`model`、消息 role/content 字节哈希序列、message count、stream、max_tokens、temperature、top_p、presence/frequency penalty、`reasoning_effort`、`thinking.type`、`clear_thinking`、`stream_options.include_usage`、以及其他实际送出的字段。

**比较前先将游戏日期、NPC Owner、Conversation Epoch、Worldline、最近历史、UI 设置等冻结为相同合成输入**，否则“不同请求”完全可能是业务必需变化；不要为了通过测试在生产代码中强行冻结。

### 9.3 受控根因假设及验证证据

| 假设 | 需看什么 | 证据意义 |
|---|---|---|
| `H-A`：V9.2.2 SDK/参数/序列化改变 | 新旧相同输入 `buildDiagnosticRequest` JSON hash/有序字段 diff | 若不同且落在前缀之前才值得修 |
| `H-B`：同一 NPC 切换、历史重排或系统块变更 | `sameConversation`、`sameResponder`、`sameEffectiveParameters`、`stablePrefixUnchanged`、首差异块、历史 append-only 检查 | 区分应用布局问题与正常动态变化 |
| `H-C`：GLM 在相同长前缀下间歇性 0 | `provider_zero_despite_large_prefix` + 同端点/同参数/足量稳定公共前缀 + 连续短间隔；原生 cached_tokens=0 | 支持“供应商侧未复用/缓存未驻留”假设，**不直接证明服务商故障** |
| `H-D`：路由、端点、模型参数变动 | endpoint hash、model、effective params、stream、thinking/maxTokens、timestamp | 若不等价属于不可比或配置漂移 |
| `H-E`：缓存时效/模型调度/拥塞导致随机未命中 | 同一前缀多次暖请求、间隔组、交叉顺序与重试频度；可控正反例 | 只能得到统计相关，不擅自宣布真实内部 TTL 原因 |
| `H-F`：Usage 的零与 UNKNOWN 混淆 | 原始脱敏 usage 字段及 normalize 路径 | 保证统计可信，禁止补算虚假命中 |

### 9.4 关键异常复现对象

用户最近一次 45 Chat 里有 20 次原生零缓存；高命中 19K–20K 与 `0/28,642` 交替。若真实使用的是同一 NPC，会话窗口里 `estimatedCommonPrefixTokens >= 8,000`、`sameEffectiveParameters=true`、`sameEndpoint=true` 且原生 `cachedTokens=0`，可标记 `COMPARABLE_PROVIDER_ZERO`。具体 8K 是**诊断分桶建议阈值**，不是供应商缓存保证值。

**必须比较真实出站消息序列，而不是只看 UI 里的 `firstChangedBlockId`。** 后者是本地根据 Prompt 区块估算的“最早变化”，不代表供应商精确缓存断点。

---

## 10. WP-05：GLM 原生长上下文实验（费用受控）

> **默认禁止自动发起真实付费请求**。需由用户确认 API 预算与测试时段，并在明确费用上限后执行。离线回归可随时运行。

### 10.1 控制条件

- 模型：当前真实使用的 `zhipu / glm-5.3-flash` 及同一端点；如果实际配置改变，需要重新记录而非硬编码旧参数。
- 只使用安全、匿名、可公开合成的对话；**不上传真实存档或私人记忆**。
- 与真实游玩保持相同 `stream=true/false`、`reasoning_effort`、`clear_thinking`、`max_tokens` 和输出模式；若运行配置不同，分别实验，不能混算。
- 测试提示长度分档：**约 2K（验证短缓存）、15K、25K、35K 输入 Token**；35K 仅在上下文/预算许可时进行。长度是目标分桶，不是必须消耗的费用指标。
- A/B 以变体 ID 的*公共前缀稳定性*分组，避免不同组共享完全相同 Prompt 导致跨组缓存污染；新旧版本的合成语义负载与字节对照必须先过离线 Gate。
- 随机/交错顺序，记录实际请求时间与间隔。缓存预热与后续暖请求分开汇总，不把第一次冷请求计入所谓“热命中”。

### 10.2 最小矩阵

| 实验组 | 目的 | 最少需要的观察样本（不含失败重试） |
|---|---|---|
| A：相同 NPC、相同系统规则、History append-only | 验证 GLM 最佳暖缓存 | 每个长度档至少 10 次，独立两批（预算不足先做 15K/25K） |
| B：三 NPC 交替 | 分离 Responder 冻结前缀差异 | 每人至少 5 个有效请求，按 NPC 和全局分别统计 |
| C：固定 NPC、游戏日期与 live state 合法改变 | 识别合理前缀变化 | 至少 10 次，保留不可比说明 |
| D：同端点/同参数/完全相同 Prompt 的间隔复测 | 测厂商可用性，而非业务布局 | 短间隔与较长间隔各一组，公开假设条件 |
| E：V9.2.1 与 V9.2.2 相同业务 Fixture | 证伪回归 | 优先本地字节相等；真实 A/B 仅在字节不同或有合理必要时执行 |

### 10.3 记录字段（脱敏白名单）

```json
{
  "schemaVersion": 1,
  "requestType": "chat",
  "provider": "zhipu",
  "model": "glm-5.3-flash",
  "cohort": "same_responder_warm",
  "conversationHash": "ANON_SHA256",
  "responderHash": "ANON_SHA256",
  "endpointHash": "ANON_SHA256",
  "effectiveParamsHash": "ANON_SHA256",
  "orderedMessagePrefixHash": "ANON_SHA256",
  "promptProfileId": "v813_effective",
  "messageCount": 0,
  "estimatedCommonPrefixTokens": null,
  "nativeCachedTokens": null,
  "nativeInputTokens": null,
  "nativeOutputTokens": null,
  "usageReportingStatus": "UNKNOWN",
  "alignmentStatus": "insufficient",
  "intervalMs": null,
  "finishReason": "UNKNOWN",
  "errorCategory": null
}
```

**仅为输出 Schema 示例**；真实实现使用已有诊断模块的数据结构并采取白名单最小增量，不要新增两套互不对账的 Usage 事实源。Hash 用进程级脱敏盐；跨进程不可对账时标 `UNKNOWN`，不得伪装同一身份。

### 10.4 判断规则

- `APP_PREFIX_DIFF`：应用实际出站 role/content 在应固定部分出现无必要差异；有确定性复现，才进入 WP-06 修。
- `APP_PARAM_DIFF`：同业务请求 Provider 实际字段有意外变化；保留最小修复与反例。
- `EXPECTED_COLD`：首次请求、新 NPC/新前缀、跨条件比较不可比；不视为 BUG。
- `COMPARABLE_PROVIDER_ZERO`：可比长前缀、同端点、同参数、供应商确报 0；记录观察，多次复测后可能升级上游供应商问题。
- `UNKNOWN`：无原生 usage、丢失关联或含隐式 SDK 参数差异；不得编造结论。

不允许通过关闭 GLM `thinking`、更换模型、减少记忆授权过滤、删除系统规则、缓存整个动态世界上下文等手段“优化”。

---

## 11. WP-06：有证据才做 GLM 最小修复

### 修复路径 A：确证是应用层 bug

1. 在 `scripts/test-v9.2.3-glm-outbound-equivalence.js` 等专项中先做 **RED**：完全相同的上下文在同一有效参数下请求前缀无故变化、消息被替换/重排、SDK 字段错误漂移、Usage 混淆等。
2. 在最小相关边界改动（例如 `sendChatRequest` 元数据、模板分块分类、Adapter 参数映射）；保留 V8.13 Prompt 语义与实时更新；不得顺手推进 V9.4 架构。
3. 验证 **GREEN**：旧/新需求测试、History append-only、不混 Owner、真实 native usage 回传正确。
4. 对非缓存指标增加门禁：NPC 角色正确性、CK3 世界当前性、Provider TTFT/P50/P95、请求成功率、合法记忆召回质量。
5. 无真实收益时如实标 `APP_FIX_PASS / NATIVE_BENEFIT_HOLD`，不能宣传命中率已经提升。

### 修复路径 B：应用请求逐字节稳定，GLM 仍零命中

- **不修改 Prompt**；把 `UPSTREAM_OR_UNRESOLVED` 写入台账，并给出同端点/同参数/大公共前缀下的匿名对照证据。
- 供应商的缓存驻留、负载路由、TTL 等无法从 VOCT 源码确定。仅建议将来联系服务商或在 V9.4 研究正确的前缀规划，不擅自声称“智谱官方故障”。
- 若成本不能接受，允许用户以后显式选择其他 Provider；这不属于 V9.2.3 默认自动模型切换工作。

---

## 12. WP-07：测试矩阵与故障注入

### 12.1 Year/Life 零成本合同（全部必须 PASS）

| ID | 场景 | 断言 |
|---|---|---|
| DER-01 | 一人普通 Finalization | `memory4_durable` 按需，`memory4_year/life` **0** |
| DER-02 | 三人会话、不同 KnownBy、不同日期 | 三 Owner 各自保存合法 Detail，Year/Life **0**，不串档 |
| DER-03 | 旧 `DERIVED_REBUILD_FAILED`，Durable 已提交，三次启动与 5 次恢复 | 永远无 Derived 模型请求，Recovery 不无界循环 |
| DER-04 | Durable 未提交 `PENDING` | 不把派生退役当作已提交，仍按原安全恢复 |
| DER-05 | `legacyRecompression` 已转换和未转换两类 | 前者无派生补算；后者未完成转换不能伪造完成，派生均 0 |
| DER-06 | 同 Owner `active` + `queuedRequest` + `REQUEUED` | 退役后不再进入压缩；无异步补写 |
| DER-07 | 曾经成功的 Year/Life 文件 | 保留文件 hash，仍按原来源有效性只读 |
| DER-08 | Forgotten / Tombstone / SourceRevision 变化 | 旧派生不再可用，不能复活或泄漏 |
| DER-09 | NPC Year/Life 完全缺失 | 5 年/10 年 Detail 与 Legacy 仍可召回，模型派生 0 |
| DER-10 | UI 手动编辑既有视图 | 保留授权编辑/来源校验；不得偷偷触发 LLM |
| DER-11 | 旧 UI 的“重建”按钮/IPC（如存在） | 明确 `UNSUPPORTED` / `RETIRED`，不请求模型 |
| DER-12 | 只读归档、无战役/异战役 | 不写错 Scope、不清除 Recovery，不跨库调用 |
| DER-13 | Recovery JSON 损坏或旧版本缺失字段 | 保全原字节、报告 UNKNOWN，不能静默删除 |
| DER-14 | Derived 文件与 `metadata.derivedDirty` 不一致 | 不因生成退役把脏视图误标 clean |
| DER-15 | `requestCompression` 安装 throw-on-call sentinel | 整个完整回归中触发次数 **0** |
| DER-16 | 尝试使用旧 `kind:"year" / "life" / "all"` API | 同一种已说明的禁用行为，保证无付费发送 |

### 12.2 GLM/统计/互操作测试

| ID | 场景 | 断言 |
|---|---|---|
| GLM-01 | V9.2.1 与 V9.2.2 同一合成输入/配置 | 有序 wire JSON 与参数报告，不得未经审查声称相同或不同 |
| GLM-02 | V8.13 生效布局 | `glm_cache_v2` 标签不冒充实际布局；静态规则字节稳定 |
| GLM-03 | 相同 NPC History append-only | 已发出的旧历史不被改写；必要动态状态更新不被吞掉 |
| GLM-04 | 不同 NPC/不同 Campaign | 不可比分类，私有记忆不进入共享静态前缀 |
| GLM-05 | GLM 原生 `cached_tokens=0` | 记为真实 0，保留相邻 diff；不被改成 UNKNOWN |
| GLM-06 | GLM `usage` 缺失/仅尾包/含 reasoning | 原生未知为 UNKNOWN；推理/输入/输出量不重复计 |
| GLM-07 | 端点/参数/stream/thinking 不等价 | 归为不可比或 `APP_PARAM_DIFF`，不能归咎上游 |
| GLM-08 | 零命中但大稳定前缀 | 若条件满足，正确进入 `COMPARABLE_PROVIDER_ZERO` |
| GLM-09 | 不同轮次 / 真实长上下文规模 | 2K/15K/25K 组分别汇总，绝不混算为“优化提升” |
| GLM-10 | 修复候选对 User/Worldline/Forget/Action/Letter 影响 | 现有全回归不下降 |

### 12.3 成本防回归测试

针对生产路径安装 `llmManager.sendSummaryRequest` 计数拦截器：

```js
const derivedRequests = [];
function recordRequest(meta) {
  if (meta.requestType === 'memory4_year' || meta.requestType === 'memory4_life') {
    derivedRequests.push(meta.requestType);
  }
}
// 测试结束必须：assert.deepStrictEqual(derivedRequests, []);
```

同时对 `requestCompression` **直接调用抛错**，覆盖“未携带 requestType”“被错误标为 summary”的偷渡发送路径。仅统计 requestType 不足以证明安全，必须配合 Service 外层和 Adapter 发送前哨兵。

---

## 13. WP-08：诊断数据、成本仪表盘与验收文档

### 13.1 报表必须清楚分离

- **Memory4 Durable**：请求数、授权 Owner 数、输入/输出、原生 cached、恢复情况、Commitment 提取质量。
- **Year/Life 已退役**：`policy=RETIRED`、**新增请求=0、输入=0、输出=0**；已有历史日志不能删改，历史累计曲线不会立刻归零。
- **GLM Chat**：完整分母、原生零命中次数、原生缓存字段覆盖率、各实验 cohort 的加权命中率、热/冷分别汇总。
- **质量**：Detail 召回的来源准确率、承诺/Forget 核对、长跨度故事回答是否失去概览。

### 13.2 诊断记录建议

```json
{
  "derivedPolicy": "RETIRED",
  "durableCommitVerified": true,
  "derivedAutoLLMRequests": 0,
  "derivedAutoInputTokens": 0,
  "derivedAutoOutputTokens": 0,
  "legacyDerivedFilesRetained": true,
  "recoveryClassification": "DERIVED_ONLY_VERIFIED",
  "retiredDerivedRecoveryActions": 1,
  "unverifiedRecoveryActions": 0
}
```

这只是建议字段；**不得通过在 UI 里写入 0 来代替实际 Provider 拦截器证据**。统计要核对当前窗口而非把历史 80/79 次擦除。日志不输出真实 NPC 文本、Prompt、API 密钥或 Windows 私有路径。

### 13.3 必交付文件

- `docs/current/v9/V9_2_3_BASELINE.md`
- `docs/current/v9/V9_2_3_IMPLEMENTATION_REPORT.md`
- `docs/current/v9/V9_2_3_P_ISSUE_LEDGER.md`
- `docs/current/v9/V9_2_3_VERIFICATION_REPORT.md`
- `docs/current/v9/V9_2_3_HANDOFF_TO_V9_3.md`
- `docs/current/v9/v9.2.3-verification-evidence.json`（匿名证据）
- 相应测试脚本加入 `scripts/test-manifest.js` 的 release gate；生成路径映射更新 `build/runtime-inputs.json`（仅当新增 Runtime 文件时）
- `CHANGELOG.md`、项目版本显示及运行包标识对齐（**在收口 Gate 后执行**）

---

## 14. WP-09：施工提交顺序、命令与回滚

每个工作包单独 Git 提交，不进行一场大型无分界重构。建议顺序如下：

| 提交 | 内容 | 阻断条件 |
|---|---|---|
| `C1` | Baseline、历史统计、受控数据备份、Year/Life 请求哨兵 RED | 用户数据备份无法核验立即停止 |
| `C2` | 单一 `derivedGenerationPolicy=RETIRED`，拦截所有自动 schedule/rebuild/compress | 未证明请求 0 不进入下一步 |
| `C3` | 处理 Durable 已提交、Legacy、Recovery、queued/requeued 状态机 | 误删/误完成任何 Recovery 立即回滚 |
| `C4` | 保留旧视图只读、Forget/source validity、Detail 时间召回正反例 | 任意 Scope/Forget 回归阻断 |
| `C5` | GLM 旧新离线对照与脱敏报告；验证历史误判 | 无对照结论时记录 UNKNOWN，不做经验优化 |
| `C6` | *可选* GLM 最小确证修复 + RED/GREEN / 原生实验 | 没有证据则跳过代码改动 |
| `C7` | 发布回归、实机费用测量、报告同步、版本号冻结 | P0/P1 未关闭则不能发布正式版 |

### 14.1 实施/验证命令（以仓库脚本为准）

```powershell
# 在正确的 VOCT 仓库根目录
 git status --short
 git rev-parse HEAD
 git diff --check

# 先阅读脚本与测试清单，使用现有构建/验证入口
 node scripts/build-runtime.js --help
 node scripts/verify-runtime-build.js --help

# 新增专项的计划命名（只有实现后才可执行）
 node scripts/test-v9.2.3-derived-retirement.js
 node scripts/test-v9.2.3-derived-recovery.js
 node scripts/test-v9.2.3-glm-outbound-equivalence.js
 node scripts/test-v9.2.3-glm-native-usage.js
```

**注意**：`--help` 是否为当前脚本支持的参数应先实际核对源文件；若未实现 help，按脚本已有 CLI 直接执行。上面 V9.2.3 测试文件是**新建计划名称**，不是声称仓库已有。完整 Release Regression 由 `scripts/test-manifest.js` / 仓库 workflow 的权威入口执行，禁止直接只跑四个新测试就签发 PASS。

### 14.2 回滚原则

- 不修改正式用户档案才能回滚代码；由新版本引入的状态 receipt 必须幂等且可由旧读取路径容忍，不能简单覆盖旧 Recovery。
- 退役开关如需回滚，必须先评估是否会**重新启动高成本旧任务**。默认回滚到“Derived OFF 的安全热修复”，不能直接滚回原始无界自动生成。
- 对 GLM 仅回滚本次已证明的最小修复，保持 Durable、Forget 现有 P0 修复。
- 同步回退部署 receipt/生成产物，**绝不**覆盖、删除或重写用户的 Memory4、Legacy、Forget、Recovery 数据来解决兼容性。

---

## 15. 最终发布 Gate（逐项签署）

| Gate | 可验收的要求 | 不满足时 |
|---|---|---|
| **G0 基线** | 基线 SHA、真实安装路径、原子备份/哈希、原始统计已保存 | HOLD |
| **G1 退役费用** | 全部可能入口 `memory4_year/life` 新请求 0，模型输入/输出 0；跨重启、后台队列、旧 Recovery 也 0 | **P0 阻断** |
| **G2 Durable 数据安全** | 真实 Detail 仍提交；Commitment/Forget/Tombstone/source revision/Owner 不回归；旧 P0 修复仍通过 | **P0 阻断** |
| **G3 Recovery** | 旧派生失败不空转、不伪造成功、不删除真 Durable 待恢复；跨战役不触碰 | P0/P1 阻断 |
| **G4 长跨度历史召回** | 5 年/10 年、承诺、具体人物与事件来源正确；宏观 Life 概览损失按成本优先原则接受并记录 | 如果事实/权限退步则阻断 |
| **G5 GLM 根因诊断** | 至少有旧新字节对照、长上下文真实或严谨 UNKNOWN 归因、原生缓存字段覆盖率；误称“V9.2.1 已修好”已纠正 | P1 不关闭；可在用户明确批准下记录延期到 V9.4 |
| **G6 GLM 最小修复** | 如确证 App 缺陷，RED/GREEN 与原生受控对照；若不能确证则无改动并留 HOLD | 不允许为了 KPI 随便动 Prompt |
| **G7 构建/CI/实机** | 干净环境构建、依赖锁、资源一致性、全部 Release Regression、指定 SHA 远端 Actions 成功；VOTC.exe + CK3 现场至少 1 次三人对话/重复开启/跨年代历史/Forget/行动信件冒烟 | 未通过不能宣称冻结 |
| **G8 文档/版本** | 台账/实施报告/测试清单与真实 SHA 一致；Core/App/UI 版本统一，Workshop/Three-Mod 只有确需时才改变 | HOLD |

### 15.1 硬性监控数值

- **Year/Life**：新运行窗口 **请求=0，输入=0，输出=0**（强制，不依赖供应商缓存）。
- **Memory4 Durable**：不得用停止 Durable 来掩盖成本；要保持完成率与 Forget 安全；另有其原生缓存监测。
- **GLM**：45 次、36.8% 是**问题基线**，不是发布必须达到的数字；不能拿 1.6K–2.6K 短合成 96% 冒充 15K～30K 真实长对话的修复效果。真实命中率提升仅在**相同负载/端点/参数/缓存温度**受控实验显示时承认。
- **成本报告**：同时记录全部 Token 与未命中折扣价格；不以缓存高低推断输出一定便宜。

---

## 16. V9.3 / V9.4 移交边界

V9.2.3 完成后，正常进入总路线 §7.4 **V9.3 Provider Platform**：capabilities、普通/流式生成、Structured Output、Result/Usage/Reasoning/FinishReason、取消/超时、429/5xx 和 Unsupported；不再把 Year/Life 退役工作无限扩散成完整 Provider 重构。

以下问题属于 V9.4 §7.5 **PromptPlan/Cache** 的长期任务，如 V9.2.3 无法用证据定位最小修复则保留 `HOLD`：

- 长局稳定前缀跨角色/跨日期的规划与 Serializer 平台化；
- 面向 GLM 的缓存驻留/提示序列策略与可靠性基准；
- 全部 Provider 的本地 Prefix Ratio 与服务商真实 cached token 分离展示；
- 大规模历史 Context 对缓存成本和输出质量的长期 A/B。

Year/Life 退役后若将来用户主动要求“低成本生平摘要”，需要**新提案**明确一次性/显式授权、Token/费用硬预算和保留的事实校验，不得自动恢复旧的无界按年编年 LLM 生成。

---

## 17. Codex 交接执行说明

> **执行方式**：严格按 C1→C7 的工作包小步修改；每完成一个包先给出涉及文件、行为合同、RED/GREEN、Source/Runtime parity 与 rollback，再进入下一包。不得隐式展开 V9.3、V9.4 的重构。
>
> **第一优先级**：用合成三 Owner + 已提交派生失败 Recovery 复现高成本旧路径，然后让**全部 Year/Life Provider 请求严格归零**。不修改真实用户历史 JSON。
>
> **第二优先级**：恢复队列区分已提交 Durable 和未提交 Durable，所有 Forget/Source Revision 守卫保留。
>
> **第三优先级**：核对 `edb3896` 和 `071f62b` 的 GLM 出站实际 JSON，填补 45 次 36.8% / 20 次零命中原因；无法证明 App 回归时不得擅自改 Prompt。
>
> **最终交付**：可复现的源码改动与测试、匿名机器证据、P 级关闭/未关闭台账、特定 SHA CI、真实 CK3 人工测试结果、版本号与 V9.3 交接单。未执行项标 `NOT_VERIFIED`，原生缓存未获提升标 `HOLD`。

### 源码参照（GitHub）

- [V9 总路线](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/current/v9/V9_ROADMAP.md)
- [Memory4 Derived](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/memory-system/memory4-derived.js)
- [Memory4 Coordinator](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/memory-system/memory4-coordinator.js)
- [Memory4 Recall Planner](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/memory-system/memory4-recall-planner.js)
- [GLM/Zhipu Provider](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/providers/index.js)
- [Provider Service](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/provider-service.js)
- [Prompt Builder](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/prompts/prompt-builder.js)
- [Real Request Diff](https://github.com/wsdsb-111/VOCT-NEW/blob/main/src/app/main/analytics/real-request-diff.js)
- [V9.2.1 验证](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/current/v9/V9_2_1_VERIFICATION_REPORT.md)
- [V9.2.2 问题台账](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/current/v9/V9_2_2_P_ISSUE_LEDGER.md)

**当前状态**：施工方案已编制；尚未实施 V9.2.3 代码、执行本版自动化或发起新的真实 GLM API A/B。所有预期结果须由施工后测试证明。

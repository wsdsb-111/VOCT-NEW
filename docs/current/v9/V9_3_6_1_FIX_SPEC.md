# VOCT V9.3.6.1 修复与上下文扩展开发规范

> 文档类型：Codex 可执行施工规范（Markdown）
> 版本：V9.3.6.1
> 基线：V9.3.6；代码候选 `5681d10aa5d9ff1e5d9665c722afc98fe7451f06`；报告收口 `6c056c0bf71cc0c794c75c266e4cce5e6003a541`
> 仓库：`wsdsb-111/VOCT-NEW`
> 状态：待施工；本文件不代表修复、构建或实机验收已完成
> 目标：修复历史意图误授权、加固跨 Pair 查询与 Recent1 去重、解除人为 90K Context 限制，同时维持 V9.3.6 记忆与 Provider 安全边界。

## 0. 施工总则与禁止范围

本版本为局部修复，**不重构 Memory Engine，不引入新存储格式，不迁移或重写真实用户数据**。只修改必要的源代码、设置界面及配置验证、测试和文档；构建输出必须由标准构建链同步，不得只修改 `resources/app/out`。

以下 V9.3.6 合同不得退化：

- 每个回应 NPC 的固定记忆始终锚定可信玩家 ID；最后发言的其他 NPC 不改变固定 `Owner → Player` Pair。
- 第三人历史授权只来自当前有效玩家轮次。NPC 文本、引用文本、未绑定代词、失效 Binding 不能单独授权。
- L0 不读第三人历史；L1 只读允许的索引事项且每目标最多 16 条、不打开来源全文；L2 才能在权限、来源键和修订验证后打开至多 **2 次总来源读取**（包括失败、竞争与 fallback）。
- Owner、Campaign、当前游戏日期、Forget、Source Key/Revision、主客体方向及可见性隔离继续生效；`B→C` 不能读取 `C→B` 的私有视角。
- 最终发送前重算完整 Prompt 与输出预留、记忆预算、消息跨度/指纹；流式及非流式 `LENGTH` 续写必须重新经过相同安全守卫。
- Durable/Memory4、Year/Life 自动生成与重建保持退役；NPC→NPC 摘要合法写入、Legacy、Pair Index、信件、Official Action、Worldline 现有合同不变。
- 未经用户授权，不推送远端、不操作真实 `%APPDATA%`、CK3 存档、密钥或付费 Provider。

## 1. 改动分级和交付物

| ID | 优先级 | 工作项 | 完成标准 |
|---|---|---|---|
| FIX-01 | P1 | 历史意图误判 | 当前/未来语句不误升 L1/L2，合法历史询问仍可召回 |
| FIX-02 | P1 | 解除人为 90K Context 限制 | 大于 90K 的合法模型窗口可配置、可生效，实际请求仍受模型能力限制 |
| FIX-03 | P2 | 跨 Pair 查询规模优化 | 能按 Owner/Target 缩小候选且无漏召回、越权和失效源回归 |
| FIX-04 | P2 | Recent1 精确去重 | 不再只凭正文 `includes()` 判断一条事项已完整表示 |
| FIX-05 | P2 | Responder 预算冻结语义 | 参与人数变化不隐式扩额，新 Responder 不能继承他人授权 |
| FIX-06 | P3 | 测试/文档清理 | 正式 Manifest 收录新测试，过时注释清理，发布报告准确 |

### 1.1 预期核心文件

```text
src/app/main/memory-system/pair-memory-routing.js
src/app/main/memory-system/player-centered-memory.js
src/app/main/memory-system/pair-memory-source-retrieval.js
src/app/main/memory-system/memory-budget-policy.js
src/app/main/conversation/conversation.js
src/app/main/prompts/prompt-builder.js
src/app/main/provider-service.js
src/app/main/providers/request-budget.js
src/app/main/providers/provider-capabilities.js
src/app/main/config/settings-repository.js
scripts/test-manifest.js
```

同时检索并核实 **Renderer 设置表单、IPC 参数验证、配置迁移、预设/Provider 切换逻辑** 中对 `90000`、`9e4`、`max=90000`、数值型限制及文本提示的全部实际引用；不要假设单个默认值就是唯一上限。

## 2. FIX-01：意图分类与权限语义修复（P1）

### 2.1 已知问题

当前 `HISTORICAL_PATTERN` 混入 `记得`、`之后`、`接下来` 等双关词，仅因出现目标人物及通用关键词就可能升级第三人检索，例如：

- `记得把信交给玛蒂尔达。` —— 当前/未来行动，不应查历史。
- `接下来你准备怎么安排玛蒂尔达？` —— 计划询问，不应查历史。
- `之后还要不要和玛蒂尔达见面？` —— 未来安排，不应查历史。

### 2.2 设计合同

将分类分解为可单元测试的**明确过去事件/关系**、**当前或未来行动/计划**、**有限上下文追问**三类，并明确优先级，而不是不断向单个正则增加例外：

1. **可信轮次先决条件**：只有经 `resolveTrustedPlayerTurn()` 验证的当前玩家消息可授权第三人历史读取；没有可信轮次直接 L0。
2. **明确拒绝优先**：`不要回忆……`、`只谈现在……` 等保持 L0；引用文本中的历史关键词不构成授权。
3. **当前/未来意图优先判定**：`记得把/记得通知/接下来准备/之后要不要/明天……` 等不得仅凭关键词触发 L1。
4. **明确历史查询**：`你以前认识 C 吗`、`你还记得 C 吗` → L1；`1090 年与 C 具体争执的经过是什么` → L2。
5. **含糊跟进**：`那后来呢？`、`那之后呢？` 只有目标 Binding 在相邻合法轮次、同一 Owner/Player/Conversation/Scene 内仍有效时才能沿用目标，原则上为 L1，**绝不沿用旧 L2 来源授权**。
6. **混合语句**：若一句同时包含当前指令和确切历史请求，应按清晰的独立历史问句处理；模糊时默认 L0，不能静默扩大授权。
7. 目标身份歧义、别名冲突、提名失败仍为 L0；不因“记得”或“后来”绕开身份验证。

建议将意图识别拆为纯函数（命名可按代码风格调整）：

```text
classifyTemporalIntent(unquotedText)
  -> { class: PAST_HISTORY | CURRENT_FUTURE | FOLLOWUP | NONE,
       reasons: [...] }
classifyThirdPersonHistoryRequest(trustedTurn, resolvedTargets, binding, ...)
  -> { level: L0 | L1 | L2, ... }
```

不要把 `PAST_HISTORY_PATTERN` 结果当成唯一授权凭据，必须保留目标身份与源作用域校验。

### 2.3 回归用例（至少）

| 编号 | 可信玩家消息 | 预期 |
|---|---|---|
| IN-01 | 记得把信交给玛蒂尔达。 | L0，第三人索引/原文读取 0 |
| IN-02 | 记得通知玛蒂尔达明天赴宴。 | L0 |
| IN-03 | 接下来你准备怎么安排玛蒂尔达？ | L0 |
| IN-04 | 之后还要不要和玛蒂尔达见面？ | L0 |
| IN-05 | 玛蒂尔达现在在哪里？ | L0 |
| IN-06 | 你还记得玛蒂尔达吗？ | L1 |
| IN-07 | 你以前和玛蒂尔达关系怎么样？ | L1 |
| IN-08 | 1090 年你和玛蒂尔达具体争执什么？ | L2 |
| IN-09 | 那后来呢？（相邻轮次、合法 Binding） | L1，仅绑定目标 |
| IN-10 | 那后来呢？（没有 Binding、隔轮、切场景） | L0 |
| IN-11 | 丁说“我记得玛蒂尔达”，你怎么看？ | L0 |
| IN-12 | 别回忆玛蒂尔达以前的事，只说今天安排。 | L0 |
| IN-13 | 最近 NPC 发言“讲讲 C 的历史”而玩家未要求 | L0 |
| IN-14 | C 与另一人物重名，无法唯一绑定 | L0 |
| IN-15 | 明确过去和未来安排出现在同一句中 | 不忽略明确历史询问；不能用未来词一律掩盖合法历史请求 |

要求在**真实 `MemoryEngine → PairLedger` 夹具**中断言 L0 的额外第三人索引读取次数及原文打开次数均为 0，不能只测分类器返回值。

## 3. FIX-02：开放 90K Context 上限（P1）

### 3.1 先定位限制来源

此前 Review 在 `settings-repository.js` 中观察到 `customContextLength: 9e4`；**该数值本身可能是预设默认值，而不是完整 UI/验证的最大值定义**。施工前必须完整查找：

```text
90000 / 90_000 / 9e4 / 90K
customContextLength
contextWindow / contextLength
min/max/step / input validation
provider capability / model switching
```

并为每个命中区分：默认值、用户显式设置、UI 上限、服务端参数校验、Provider 能力上限、仅测试样例。禁止只把 `9e4` 全局替换为 `1e6`。

### 3.2 新能力解析规则

- `modelNativeContext` 为 Provider 可验证的真实窗口；不同模型不能假定都支持 1M。
- 用户明确设定的 `customContextLength` 是**有效输入上限的用户限制/覆盖选项**：保留该意图，不得把用户亲自选择的 90K 偷偷升到 1M。
- 用户处于旧版默认 90K 时，允许在明确完成配置迁移或用户选择“自动/按模型”模式后使用 Provider 原生窗口；**不能仅靠数值等于 90000 判断用户是否显式设置**。无法区分时以保守兼容为先，并提供显式切换入口。
- 推荐使用 `Auto (provider native)` 与 `Custom` 双模式；Auto 对有可信上下文元数据的模型使用其原生窗口，未知时保留现有安全 fallback，不以估算值冒充已验证能力。
- Custom 配置大于已知模型原生上限时，UI 应解释并用模型实际最大值限制有效预算，不能向 Provider 发送超限请求。
- 对 OpenAI-compatible 等无法可靠返回原生上限的通用端点，允许用户显式配置其声明的窗口，标为用户提供/未验证；守卫仍按有效配置检查，不宣称模型真实支持。

**上下文扩大≠记忆预算扩大。** V9.3.6 记忆策略仍使用分层比例及硬顶：

| 对话参与人数（冻结层级） | 比例 | 记忆预算硬顶 |
|---|---:|---:|
| 2 | 16% | 4800 Token |
| 3 | 18% | 5600 Token |
| 4+ | 20% | 6400 Token |

实际值仍取 `policy budget`、非记忆 Prompt 后的 Provider headroom、输出预留及安全余量所允许的较小值。上下文升至 256K/1M 时仍不能突破以上记忆硬顶。

### 3.3 边界和兼容

- 兼容现有用户 90K 自定义值、旧配置、不同供应商/模型切换，以及上下文能力不可用的回退。
- 保持 `planRequestBudget()`、TokenCounter 估算、安全比率、协议开销、输出预留和 `beforeSend` 复验。
- 若新的 Context UI 使用自由数字输入，验证有限正整数、范围、NaN、空输入、极大值及溢出；界面不显示无根据的“所有模型 1M”。
- 长 Context 可能增大延迟、费用与内存；不通过扩大记忆配额来“填满”窗口。
- 不调整当前任何 Provider 的原生请求协议或缓存行为，除非严格必要且有专项测试。

### 3.4 验收用例

| 编号 | 场景 | 预期 |
|---|---|---|
| CT-01 | 旧配置 `customContextLength=90000` | 不崩溃，保持显式用户值语义 |
| CT-02 | Auto，可信模型元数据窗口为 131072/262144/1048576 | 不被 90K UI/配置层静默夹断 |
| CT-03 | Auto，模型能力未知 | 安全 fallback，明确来源状态 |
| CT-04 | Custom=120000，模型最大 65536 | 有效窗口不大于 65536，UI 明确提示 |
| CT-05 | Custom，通用兼容端点未提供可信元数据 | 允许用户声明，但状态不能标成 verified native |
| CT-06 | 1M Context，4+ 人 | Memory cap 不超过 6400 |
| CT-07 | 最终完整 Prompt + output reserve 超过 effective budget | 发送前拒绝 |
| CT-08 | Provider 切换/模型切换 | 重算能力并正确失效预算缓存 |
| CT-09 | 流式 LENGTH 续写后部分文本增长致超窗 | 第二次发送前拒绝 |
| CT-10 | 异常设置：0、负数、非数字、Infinity、超大整数 | 明确校验或安全 fallback，不静默危险转换 |

## 4. FIX-03：第三人跨 Pair 检索性能与候选完整性（P2）

### 4.1 风险

现有 `collectOwnerCounterpartIds()` 可按 Owner 扫描其多个 Pair；L1/L2 对非直接 Pair 的候选处理随着 Owner 关系数量增大可能接近线性增耗。已有离线测量显示 L1 暖路径较慢，但尚未证明真实 CK3 长档的体验问题。

### 4.2 不允许采用的“优化”

**禁止直接把跨 Pair 遍历改成任意 Top-N 截断并声称等价**：这可能漏掉由 B→D 转述、但确实涉及 C 的合法重要事项，破坏当前召回合同。

### 4.3 建议路径

1. 先补充按 Owner Pair 数量（如 5/30/100/300）、历史事项总量和实际缓存冷热分层的可复现基准。
2. 优先复用现有 PairLedger 的 Owner 本地派生数据，在**Owner 作用域**引入 `targetCharacterId → candidatePairScope` 的轻量反向索引或等价准确候选集合；仅由已验证 Owner 来源生成，不跨 Owner 混用。
3. 数据变更、Forget、Campaign、更名、Source Revision、编辑、删除时正确失效；索引不能成为新权威数据源。
4. 仅有可信候选索引且版本有效时使用快速路径；不存在完整索引时使用原有安全读取路径，不能因为任意上限丢失合法结果。
5. 确保 L0 仍不访问第三人历史索引；L1 不打开来源；L2 原文尝试合计 ≤2，包括失败和 fallback。
6. 记录最小匿名诊断：候选 Pair 总数、实际索引读取数、source resolve attempts、cacheHit、耗时、fallback reason，不记录敏感原文。

若本版本无法在充分验证数据变更一致性的前提下实现快速路径，可以**只交付测量、诊断和缓存层低风险优化**，把反向索引留在后续版本；不得牺牲正确性强行实现 O(1)。

### 4.4 必测规模/正确性

- 5/30/100/300 Pair：冷/暖 P50/P95、逻辑 index reads、原文 resolve calls、CPU 或 wall time；测量注明机器、输入规模、是否真实磁盘 I/O。
- B→C 直接事项可查；B→D 中明确提及 C 的合法转述可查；C→B 私密事项不可查。
- 搜索范围变化、增删源、Forget、不同 Campaign、同名不同 ID 不返回陈旧候选。
- 与旧算法在权限范围、足量预算下的选中事项集合进行对照，差异必须有解释。

## 5. FIX-04：Recent1 精确事项去重（P2）

### 5.1 现状

`retrievePlayerBaselineLedger()` 当前在 `recentSummary` 包含匹配 source key/revision 且 `recentSummary.text.includes(item.text)` 时将事项渲染为“详见近期摘要”。`includes()` 只能证明字符串包含，不能单独证明结构化事项被完整展示（尤其 Recent1 截断时）。

### 5.2 修复合同

- 优先使用**同一 source key + 同一 source revision + 同一事项 ordinal + 该事项在 Recent1 实际输出范围内完整可验证**的组合条件。
- 解析事项时应使用已有 `parseImportantMatters()`，匹配与索引生成一致的标准化规则；必须考虑 Recent1 的截断副本而非存储原文。
- 只有确知该条事项已在最终 Recent1 文本中完整出现，才能改为日期/证据引用；否则保留完整事项文本。
- 同源不同 ordinal、仅 substring、相近短语、已更改 revision、截断掉后半句，均不得误去重。
- 去重处理不得移除事项对象、日期、证据标签，也不得破坏总 Memory Token Budget。

### 5.3 用例

`RD-01` 完整同源同序事项 → 可引用去重；`RD-02` 同源不同 ordinal → 不去重；`RD-03` 仅句内 substring → 不去重；`RD-04` Source Revision 变化 → 不去重；`RD-05` Recent1 截断在事项中间 → 不去重；`RD-06` 同一天不同来源 → 不去重；`RD-07` 文本高度相似但身份不同 → 不去重；`RD-08` 预算紧张且去重失败 → 整条事项裁剪，不制造“详见近期摘要”的假证据。

## 6. FIX-05：对话冻结预算与新 Responder 语义（P2）

V9.3.6 采用 Conversation 首次计算后冻结参与人数预算，后加入 NPC 不会自动扩张至更高阶配额。**这是保守行为，不作为必须重写的 Bug**。

本版本优先保持全会话预算冻结，同时验证每个 Responder 的实际记忆快照、Owner/Player/Source 作用域独立、`getMemoryTokenBudget()` 和 PromptBuilder 的计算/发送一致。

- 两人首轮冻结 4800；后来变四人时不能隐式膨胀成 6400。
- 新加入的 C 首次回答只可取 `C→Player` 固定历史，不能继承 B 的 `B→Player` Snapshot 或动态 Binding。
- Context Window 或 Output Reserve 改变时，按 Provider headroom 收紧；不得凭缓存继续注入超过实际预算的记忆。
- 是否在未来引入 Responder-specific tier snapshot 必须另行设计、明确迁移兼容与优先级；本次默认**不改变预算冻结政策**。

新增回归 `CB-01` 至 `CB-06`：首次冻结、人数变化、不同 Responder 隔离、Source Revision 变化、Provider headroom 下降、流式续写。

## 7. 测试计划与执行顺序

建议新增（名称可随现有测试风格调整）：

```text
scripts/test-v9.3.6.1-intent-boundary.js
scripts/test-v9.3.6.1-context-limit.js
scripts/test-v9.3.6.1-pair-retrieval-scale.js
scripts/test-v9.3.6.1-recent-dedup.js
scripts/test-v9.3.6.1-responder-budget.js
```

所有新增 `test-*.js` 必须加入 `scripts/test-manifest.js` 正式发布清单，遵循 `scripts/AGENTS.md`。清理 `test-v9.3.6-independent-qa.js` 中已过期的“尚未加入 Manifest”注释。

### 阶段与每阶段 Gate

1. **基线确认**：锁定 V9.3.6 起点 SHA、工作树、现有测试清单；保留可对照红例。
2. **意图修复**：先红后绿；在 Engine 级断言 L0 不读第三人索引及原文。
3. **Recent1 去重**：先红后绿；验证同源、修订、截断和 ordinal。
4. **跨 Pair**：先建立基准，再选择经测试的安全优化；任何漏召回则回退此项优化。
5. **90K Context**：完整查找限制、实现 Auto/Custom 及能力校验，检查旧配置兼容；验证 Provider guard。
6. **Responder Budget**：维持当前冻结语义，补充加入/退出、模型切换和 headroom 回归。
7. **全量回归**：运行仓库现有完整 Release Gate 及全部新增专项，不只运行局部测试；既有 V9.3.6 报告记录的 417 组是**历史参考基线**，新增测试后总数可能增加，须按当时 Manifest 实际结果报告。
8. **构建与一致性**：按仓库的 runtime-dependencies → build-runtime → verify-runtime-build → deploy-runtime-build → verify-runtime-build --deployed → test-release 标准流程，逐项核实 source/artifact/deployed 映射；不手动修改 out 伪造通过。
9. **独立打包冒烟**：隔离配置/本地沙盒，仅做无外网、无付费调用验证。
10. **可选真实 CK3 / Provider 试验**：需用户实际提供可用环境与授权；结果不应预先标为 PASS。

### 长会话与 Context 实测验收

至少设计 20–30 轮和 80–100 轮场景，包含三人/四人、反复询问第三人往事、当前/未来指令、代词追问、Forget、模型切换。记录记忆选中率、第三人误授权次数、Source attempts、Prompt Token、Provider 返回 Usage（如有）、缓存与延迟；禁止把本地估算当成真实账单或缓存命中。

如 Provider 实际支持，分别测试约 90K、128K、256K、512K、1M 的能力/发送边界；**无需为测试强行填满所有 Context**，重点验证合法配置不会被旧 90K 人为夹断，超限仍被安全拒绝。

## 8. 发布阻断项（Blockers）

任何以下情况出现时，不可标记版本已完成：

- 当前/未来语句通过“记得/之后/接下来”误开第三人索引。
- 无可信当前玩家轮次时第三人历史被读取。
- L1 打开来源全文，或 L2 原文读取在竞争/fallback 后合计超过 2。
- 新跨 Pair 优化漏掉合法 B→D 转述 C，或出现 Owner 视角越权。
- Recent1 substring 导致未完整显示的事项被替成“详见近期摘要”。
- 自定义 90K 设置被无声改写成更大窗口，或超出可信模型能力的请求未受控。
- Context 扩大导致 Memory 超 4800/5600/6400 硬顶。
- Forget/Source Revision 失效仍在最终 Prompt/续写中发送。
- `src`、构建输出、部署输出不一致，新增测试未加入 Manifest。

## 9. 验收报告格式

交付必须包含：

- `V9_3_6_1_IMPLEMENTATION_REPORT.md`：每个 FIX 的实际文件、修改、未完成项；每项附 commit 与复现用例。
- `V9_3_6_1_VERIFICATION_REPORT.md`：环境、Node 版本、测试总组数/通过/失败、构建哈希、真实与模拟界限、CK3/Provider/Soak 结果或 `NOT_RUN`。
- `V9_3_6_1_CONTEXT_COMPATIBILITY.md`：默认/显式 90K 行为、Auto/Custom 规则、不同 Provider 能力判定、回退机制。
- 若跨 Pair 优化实际实施，再交付性能数据表，明确 5/30/100/300 Pair 的冷/暖数据及召回一致性。

**对没有执行的 Gate 必须写 `NOT_RUN` 或 `PENDING`，不得沿用 V9.3.6 的 PASS 冒充本次验证。**

## 10. Codex 施工要求摘要

> 以本文件为 V9.3.6.1 施工合同。在仓库的 V9.3.6 最终代码基线上实施 FIX-01 至 FIX-06。先完成代码搜索与红例，再作最小改动；保持 Owner/Player/Campaign、L0/L1/L2、Forget、Source Revision 与 Provider beforeSend 守卫。Context 不得简单把 90000 替换为 1M，必须分辨默认值、用户显式设置与模型能力。跨 Pair 优化以召回正确性为硬前提，不得任意截断。新增专项必须入 Manifest，运行完整 Release Gate，并按真实证据出具报告。未经授权不修改真实用户数据、不发付费请求、不远端推送。

---

**版本完成定义**：修复意图误判、Recent1 去重以及 90K 人为限制；完成跨 Pair 的安全扩展性处理或据实保留为可观测后续工作；Responder Budget 语义明确且回归通过；发布清单、构建和部署一致；真实 CK3/Provider/长会话状态单独诚实标注。版本通过后才讨论 V9.4，不在此版本引入新 Memory 功能。

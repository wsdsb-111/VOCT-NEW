# VOCT V9.7 详细工程施工方案
## Legacy Decommission · 历史路径退役与技术债收口

> **状态：设计待施工（DESIGN / NOT IMPLEMENTED）**  
> **设计日期：2026-11-01**  
> **目标仓库：** `wsdsb-111/VOCT-NEW`，`main`  
> **当前核对基线：** `3721b925270457175e0e583f943a20db581de03e`（V9.6.1，2026-11-01）  
> **施工版本：** V9.7.0（建议 Core／App／UI 同步；具体以构建版本合同为准）  
> **工作属性：** 工程退役、兼容边界治理、可追溯的非破坏性维护；**不新增游戏玩法**  
> **施工优先级：** P0 数据安全与恢复边界 > P1 生产行为等价 > P2 可维护性和性能改善  
> **施工范围：** 仅 VOCT-NEW，不修改独立 `CK3-Three-Mod-Compatibility` 仓库

---

## 0. 路线编号裁定（本次施工最高约束）

**本 V9.7 不再是旧文档所说的 Workshop Unified Distribution。** 原 V9.7 的“将 Electron/Node Runtime 通过 Steam Workshop 一体化交付”因 Workshop 不能承载所需 `.exe` 可执行文件而被取消，不能绕过此决策重新开发 Bootstrapper、尝试上传 Runtime 或制造只有一个 Workshop 订阅项即可取得完整桌面程序的承诺。

| 历史编号 | 旧目标 | 最终决定 | 当前编号 |
| --- | --- | --- | --- |
| 原 V9.6 | VOCT 自身 Mod 源码、Bridge 协议、兼容性与使用体验 | 已以 V9.6 / V9.6.1 施工及修复 | V9.6、V9.6.1（保持） |
| **原 V9.7** | Workshop/Runtime 统一分发 | **取消，不重新排期** | **无** |
| **原 V9.8** | **Legacy Decommission / 历史路径退役** | **前移一个版本** | **新 V9.7** |
| **原 V9.9** | **RC / Soak / Full Freeze** | **前移一个版本** | **新 V9.8** |

V9.7 完成后直接进入 **V9.8 RC、真实场景长测与最终冻结**。V9.7 不自行宣布 V9 全阶段 Full Freeze。

分发策略保持：

- VOCT **桌面 Runtime / EXE 独立交付**，CK3 **Workshop Mod 独立订阅/安装**；运行时由 Bridge 协议连接。
- Workshop 现有 **2.0.5** 版本保留，不能把“Runtime 无法上传”误解释为“Workshop Mod 已下架/可删除”。
- CK3 Bridge 1、日志协议 3.0、Legacy Summary 存储 2.5、Official Action 2.0.3 等现行接口保持版本兼容；未发生真正的合同变更不得为了本次清理随意提高协议版本。
- Three-Mod 兼容工程已经独立维护，不回迁 VOCT，也不形成强制依赖。
- V9.7 应将 `docs/current/v9/V9_ROADMAP.md` 中旧的 V9.7/8/9 **未完成路线描述**正式标记为“历史版本规划”，并添加本编号变更的当前有效路线页或明确的顶部覆盖声明；**不篡改历史报告、旧 CI 结论、旧提交的事实**。

## 1. 版本动机与基线事实

### 1.1 目标

V6–V9.6.1 经过多轮替换，仓库内存在可执行兼容层、旧式配置键、已退役生成器遗迹、旧 Action 测试、历史 Prompt 布局与数据读取器。**这些内容的名称带有 `legacy`、`v8`、`compat`，并不能证明它们可删除**；有的仍是迁移或恢复所必需，有的仍由真实 Prompt、Provider 或打包入口调用。

本版目标是让每条生产路径都有**唯一清晰的责任边界**，并仅在替代行为、数据安全和回退机制均得到证实时，退出无用实现或重复分支。

**完成效果：** 仓库更容易维护，历史测试与正式测试可区分；旧配置和存档可继续运行；不会因删代码而改变 NPC 行为、权限、缓存布局或玩家历史数据。

### 1.2 当前已核对的 V9.6.1 基线

- `main` 核对提交：`3721b925`；其前一实际功能修复提交为 `7d05c3d`。
- 最新 `Release Regression` GitHub Actions **成功**（run `41264613076`）。功能代码提交 run `41263860222` 也成功。
- 当前已记录的门禁：**519 组发布回归、353 项 Runtime 构建/部署一致性检查**，以及 Windows 分发 EXE 冷启动、同配置重启、Preload/IPC、媒体解码、正常退出。上述是**已有 CI 证据**，不是 V9.7 已运行的结果。
- 现有生产能力包括：订婚/前配偶/继亲及五代亲属识别、完整身份目录脱敏、手动隐藏、世界记忆分支恢复、普通 Canon 4096 Token 动态召回、有效 Action/Letter/ACK 与恢复、静态 Prompt 前缀与 Provider 缓存诊断。
- 近期用户真实 CK3 实测未报告明显缺陷；不能由此推出 Soak、全部 Provider 或所有大存档性能已签署。

### 1.3 必须遵循的现行行为合同

| 编号 | 不变量 |
| --- | --- |
| B-IDENTITY | `Campaign × Owner` 知识隔离；手动隐藏/撤销优先；未知身份与未授权身份不外泄。 |
| B-FAMILY | 五代有来源亲属互知、婚约/前婚/继亲**不相互混同**；错误 Campaign、过期证据、冲突与截断 fail-closed。 |
| B-MEM | 叙事摘要、官方追忆、长期事项索引/快照、第三人必要证据和授权边界按 V9.6.1 实际生产合同保持；已遗忘内容不能被旧读取器恢复。 |
| B-CANON | 普通世界记忆在动态轮尾，按权限、Campaign、Branch、时间、当前 CK3 真值检查；完整记录不足预算不截断；普通 Canon 上限为 4096 Token，且不能超过实际剩余窗口。 |
| B-BRANCH | 同日不同内容指纹需用户确认；待确认可只读预览，禁止写入/NPC 召回；不把“未绑定”显示成记忆删除。 |
| B-PROMPT | 当前 V813/PromptPlan 的缓存锚点、冻结块、动态尾部、Role、消息顺序、Prefix Token 计数保持；真实 Provider cache hit 与本地估算不得混淆。 |
| B-PROVIDER | Provider 请求、流式结束、取消、重试、错误语义和 usage 标准化不退化；不因旧适配器名称而改变模型兼容规则。 |
| B-ACTION | 官方 Action 2.0.3、RunFile FIFO/ACK/Readback/CONFIRMED、STALLED 不盲目重放、effect exactly-once 边界保持。 |
| B-LETTER | DATE/LOAD、收信事实/回执、存档恢复与最终归档保留；未收信件、异常中断恢复不丢不重复。 |
| B-DATA | 用户的 JSON、摘要、长期事项、信件、恢复文件、旧配置、密钥与游戏存档**不得随代码退役自动删除/重写**。 |
| B-BUILD | 正式源是 `src/app/`；`resources/app/out` 为构建核验的运行产物；Source → Build → Package → Deployment 应能逐项校验。 |

## 2. 施工范围、非范围与总策略

### 2.1 In Scope

1. **生产调用图与旧路径台账：** 判断哪些路径还在用、替代路径是否完整、是否具备安全退役条件。
2. **Prompt 布局兼容收口：** 治理重复转换、历史配置入口及观察模式；保留实际自定义 Prompt 兼容。
3. **Provider 旧式封装收口：** 收敛同义参数/返回值转换；消除可证明的重复调用，不合并厂商实际语义差异。
4. **摘要、长期事项及历史数据读取路径：** 统一可观察的读取边界和来源/版本判断；仅退役已无生产消费者的重复实现。
5. **旧 IPC/Renderer/Action/Worldline/CK3 Bridge 入口：** 核对真实消费者，取消无用分支但保留恢复和协议兼容的必要入口。
6. **发布测试、构建产物与历史文档治理：** 清楚区分 release/archived，移除不再需要的生产依赖，保留可追溯历史测试。
7. **退役前后等价、安装升级、回滚和失败恢复验证。**

### 2.2 Out of Scope（不得顺带施工）

- 不新增 NPC 自主对话、自主 Agent、动作种类或游戏机制；留到后续正式版本。
- 不采用 SQLite、SQL 双写，不进行整库迁移或重新生成全体历史摘要。
- 不恢复已废弃的 Durable 自动生成、Year/Life 自动生成，也不开发 Memory5；不无故恢复已归档的旧 Memory4 生产旁路。
- 不改变已确定的“最近一篇摘要 + 官方追忆 + 长期事项 + 必要第三人证据”类召回行为或批量调整召回阈值。
- 不重做 V9.6.1 刚修复的亲属披露白名单和 Canon 分支机制。
- 不改变产品分发模型、不上传 EXE 到 Steam、不替换 Workshop Mod ID、不隐式修改上游 CK3 Mod/独立兼容工程。
- 不将历史测试失败改写成历史通过，也不为了 CI 变绿去删除真实负例。
- 不直接修改用户的生产数据目录；任何迁移只在隔离副本上验证，用户实机安装步骤须单独授权。

### 2.3 退役状态模型

对每一候选路径标注以下**互斥决策**，不得用文件名推断结论：

- `KEEP_ACTIVE`：目前仍在生产，不能删。
- `KEEP_COMPAT`：仅为读取旧格式/自定义配置/协议兼容，但有存量用户；应收敛为只读适配器。
- `REPLACE_THEN_RETIRE`：有明确替代路径，但需先行为冻结、双路径对比，再移除旧调用。
- `RETIRE_PROVEN`：全调用图、数据样本、构建、IPC、协议与回滚证据齐备，可移除生产实现。
- `ARCHIVE_ONLY`：历史测试/报告/迁移工具；从当前 release gate 隔离，但不销毁证据。
- `HOLD_UNPROVEN`：缺少证据、影响用户数据或难以测试，**保留并写明阻碍条件**。

**保留不视为施工失败。** 本版以风险可控的退役覆盖率和证据质量为指标，不以删除行数或仓库缩小多少 MB 为指标。

## 3. 实际仓库候选路径清单（是审计对象，不是删除批准）

| 域 | 已核对的源/入口 | 需解决的问题 | 初始决策与注意事项 |
| --- | --- | --- | --- |
| PromptPlan | `src/app/main/prompts/prompt-plan-compat.js`、`prompt-plan-builder.js`、`prompt-plan-serializer.js` | 旧 `legacy/shadow/v9` 模式与最终结果桥接；旧脚本消息不兼容回退 | `KEEP_COMPAT` 起步；必须测试自定义 description/examples/custom 的非标准消息，不能直接删 fallback |
| Prompt Layout | `prompt-plan-layouts.js`、`provider-prompt-adapter.js`、`prompt-builder.js` | `v5/v6/v7/v813/glm_cache_v2` 布局与 Provider cache 特判 | 生产引用仍在，`KEEP_ACTIVE`；只合并证实重复逻辑，不动前缀/Role |
| Prompt 配置 | `prompt-config-manager.js` | 老配置字段 `systemPromptTemplate`、旧 description/examples/suffix 与内置默认 prompt hash 迁移 | `KEEP_COMPAT`；需要旧用户配置样本才能改变兼容分支 |
| Provider | `provider-platform.js`、`provider-result.js`、`provider-service.js`、`provider-capabilities.js`、`effective-request.js` | 标准化返回、Legacy facade、厂商差异及 usage | `KEEP_ACTIVE`；先证明重复转换可移，再整合；不把结构诊断当服务端命中 |
| 摘要 | `memory-system/memory-engine.js`、`memory-store.js`、`legacy-source-lineage.js`、`summary-folder-*` | 旧摘要兼容读、迁移 owner、Pair summary 来源身份与去重 | `KEEP_ACTIVE/KEEP_COMPAT`；数据来源和恢复受保护 |
| 长期事项 | `memory-system/pair-long-term-ledger.js`、`pair-memory-service.js`、`summary-catalog.js` | 长期事项索引/快照与原始摘要的关联、双读取路径 | `KEEP_ACTIVE`；先枚举消费者、去重语义、冻结/回读保证 |
| 旧 Memory/Durable | 已归档测试与仍可能用于历史阅读的支持逻辑 | 不能因旧模块名就重启已退役的生成器，也不能删读取老数据的适配器 | 默认 `HOLD_UNPROVEN`，专项审计后逐项决定 |
| 亲属 | `worldline/legacy-family-presentation.js`、`character-family-facts.js`、`family-visibility.js` | 旧格式化器与 V9.6.1 新来源图是否真实重复 | 当前关系识别风险高：**默认 KEEP**；只有无入口且反例齐备才动 |
| Action | `actions/action-engine.js`、`action-prompt-compatibility-overlay.js`、`run-command-recovery.js` | 自研旧 Action 名称、现行官方 overlay 与恢复边界 | 现行 overlay/RunFile/Recovery **KEEP_ACTIVE**；旧模块逐引用证明 |
| IPC/UI | `ipc/register-ipc.js`、`src/app/preload/`、`src/app/renderer/` | 旧 channel、历史 view、外部脚本/热键/旧用户设置消费者 | 不能只看 main 中 `ipcMain.handle`；必须逐 IPC/Renderer/Preload 交叉比对 |
| Worldline | `worldline/branch-registry.js`、`canon-service.js`、`supplemental-retriever.js` | 同日分支确认/只读预览、4096 动态召回、旧历史模式 | **KEEP_ACTIVE**；不得在清理时误删 11 月 1 日的修复 |
| Bridge | `ck3-mod/`、`src/app/main/bridge/`、`compatibility-patches/v8.15.2-letter-runner/` | 历史副本与正式源、脚本/协议冗余 | 先核对 97 文件、Bridge 清单、外部安装路径与回滚；**不删活跃桥** |
| Tests | `scripts/test-manifest.js`、各 `test-v8*`/`test-v9*` | 发布组与历史归档混杂、已退役测试适用性 | `ARCHIVE_ONLY` 不等于删历史；任何 release 改动须有替代测试和证据 |
| Docs | `docs/current/v9/V9_ROADMAP.md`、`V9_DECOMMISSION_LEDGER.md` | 老编号过时、历史术语与现实不一致 | **必须更新当前索引**，历史内容只注释/归档，不重写原结论 |

重要：**上述表格只是本次在仓库中实际定位到的文件和风险位置，不构成确认“这些文件都冗余”的结论。** 施工代理须输出更细的函数/导入/持久字段级引用表。

## 4. 施工分期（阶段 Gate，前一门禁不通过不得进入危险删除）

### Phase 0 — Freeze & Evidence：冻结基线与建立可回退现场（P0）

**任务：**

1. 检查 `main` HEAD、分支、是否存在未提交修改、`git status`；记录 V9.6.1 代码、构建产物和已安装二进制指纹，不能默认本机安装等于 GitHub 最新 HEAD。
2. 建议建 `v9.7/decommission` 工作分支；输出 `docs/current/v9/V9_7_BASELINE.md`，包含基线 SHA、Runtime/Mod 版本、协议号、清单数、Release CI URL、用户待验项。
3. 制作 **只读、脱敏** 兼容测试夹具：新用户配置、V8 旧配置、V9.3 摘要、V9.3.5 长期事项、V9.6.1 Canon、分支待确认、未收信件、未完成 ACK/Finalization/恢复、曾 Forget 的项目。不得复制用户原始聊天、密钥、存档到仓库。
4. 在独立测试根目录生成快照，记录每个持久文件的 SHA-256、状态、Revision、Scope（可哈希）与期望的读回结果。对恢复策略做沙盒演练，不触碰生产数据根。
5. 记录当前 release gate 的完整输出和 V9.6.1 冻结的 golden Prompt/Action/Letter/Memory/Worldline 结果，区分字节级等价与语义级等价（仅允许在书面批准范围内差异）。

**Exit Gate：** 拥有可证明的 V9.6.1 基线、隔离存储夹具、构建对照与回滚入口；否则只能做只读调查。

### Phase 1 — Reference & Ownership Audit：引用与数据权威审计（P0/P1）

按生产组合根、依赖注入、动态 `require`、启动事件、CLI、环境变量、Preload/IPC、Renderer、Config、JSON schema、打包脚本、CK3 `.txt`、用户自定义模板分别建立引用图。

**必须交付 `V9_7_DECOMMISSION_LEDGER.md`（扩展旧台账，逐条记录）：**

```text
candidateId
sourcePath + symbol / configKey / IPC channel / persisted schema
producer / writer / consumers / fallback entry / dynamic-load entry
replacement owner & contract / test fixtures / affected data
current status / proposed action / risk P-level
source-usage evidence / semantic parity evidence / rollback
execution commit / independent reviewer / final decision
```

重点检查：“无静态 `require`”是否仍被模板名字、反射、`eval`/脚本、用户自定义配置、旧持久记录或打包内路径间接引用。必须做 **0 引用 + 0 未证明消费者 + 可验证替代行为** 才能列 `RETIRE_PROVEN`；仅 `rg` 返回 0 不足以删除。

**Exit Gate：** 每个计划删除项都有明确调用图、数据来源、替代函数和负向测试。证据不足即 `HOLD_UNPROVEN`。

### Phase 2 — Adapter Boundary：先稳定边界，再处理旧路径（P1）

1. **Prompt 边界：** 冻结最终 Provider 有效消息数组、Role、消息映射、稳定块/轮尾边界、Token、cache anchor 与自定义脚本加载行为。`prompt-plan-compat.js` 当前仍有“非标准旧自定义脚本消息”保护回退，只有该类输入被新的受控 adapter 等价表示，且不改变权限验证与最终预算校验，才能移除。保留其他真实生产配置的旧值读取能力。
2. **Provider 边界：** 定义统一的内部 typed result、error、finish、usage DTO；旧返回格式的转换只能留在**一个明确的边界**。全量检查 OpenAI-compatible、智谱/GLM、DeepSeek 与仓库实际启用的 Provider；不得假设所有厂商共享缓存机制、错误码或流式 token 统计。
3. **Memory 边界：** 对摘要、长期事项、第三人索引和官方追忆分别明确唯一 writer/source-of-truth、可重建 index、兼容 reader。将重复入口先改为只转发，不增加并行写入/双写。迁移脚本必须只在手动调用且有证据时运行；禁止启动时全量重写摘要。
4. **IPC 边界：** 形成 channel → preload exposure → UI/page → main handler → service 的完整矩阵；所有旧 channel 改动先提供别名路由或版本化拒绝机制，不得形成“旧 UI 静默调用失败”。
5. **Action/Letter/Bridge 边界：** 用当前唯一真值服务提供查询/状态接口，旧调用仅转发到新入口，不重新执行 Effect、不再发送一次 RunFile。

**Exit Gate：** 真实业务入口已经收敛到清晰 adapter；同一输入旧新产物等价，安全门禁没有降低。若不能等价，不强行移除。

### Phase 3 — Strangler Migration：有证据的逐项替换（P1）

实施规则：**一次只退役一个独立 call path**；每项按“影子比对（不产生外部副作用）→ 合同正/负例 → 替换生产调用 → 再比对 → 删除可证明的冗余实现”执行。每一步独立提交可回滚。

**建议顺序：**

**3A Prompt 与历史模式**

- 查证 `VOTC_PROMPT_PLAN_MODE=legacy/shadow/v9` 及旧布局是否仍由设置、用户脚本、测试或发行包使用；无法证明没有消费者就保留 adapter。
- 删除可证明的**重复序列化/同义格式化**，但不得删除实际还用于 GLM Cache、V813 prefix 或自定义 Prompt 的分支。
- 同批运行静态前缀/缓存字节对照，不允许“优化”后每轮静态 fingerprint 重新变化。

**3B Provider 封装与旧特判**

- 仅合并已证明重复的参数/结果归一化；保留厂商能力 gate、重试/取消、真实 usage、Finish Reason 语义。
- 对应厂商专属配置仍可加载，淘汰旧配置键前必须验证升级映射以及旧配置重新启动的结果。

**3C 摘要、长期事项与历史数据访问**

- 盘点 `memory-engine.js`、`memory-store.js`、`pair-long-term-ledger.js`、`summary-folder-*`、`legacy-source-lineage.js` 的真实当前 writer 与 reader，清理**无生产调用的辅助旁路**而不是删除 Legacy 数据读取链。
- 继续保留“摘要最近一篇 + 官方追忆 + 长期事项快照 + 必要第三人索引”的既有触发和预算结构；个人/多人不同来源不能错误互换。
- 保留 Forget/Tombstone、手动改写的长期事项、历史来源 proof、Finalization、Episode、旧摘要目录和必要迁移工具。
- 任何 **读取成功但旧格式** 的样本必须仍可读取且绝不默默改写；错误/冲突 source fail-closed。

**3D IPC/旧 UI/动作入口**

- 先用运行时路由计数验证旧 channel 是否被正式 Renderer/Preload 或用户插件调用（诊断仅输出 channel、调用数，不记录 payload）。
- 真实无人调用且已有等价的新 handler 才可退役；对外版本化能力被使用的入口仍保留兼容。
- `actions/action-prompt-compatibility-overlay.js`、RunFile Recovery、Letter 回执、Bridge Hello 当前均有正式职责，**不得仅因名称包含 compatibility/legacy 就删除**。

**Exit Gate：** 每一项都能给出“原入口 → 新入口 → test → SHA → 逆向回滚”的闭环证据。不能形成多个大域同一提交的不可定位回归。

### Phase 4 — Contract Verification：非破坏性兼容与恢复合同（P0）

至少完成以下可执行的黄金用例：

1. V9.6.1 原有用户设置启动 V9.7：Provider 配置、Prompt 自定义脚本和多主题页面仍可用；无未知旧键导致覆盖默认配置。
2. 旧 V8/V9 摘要和长期事项、已手动编辑/隐藏记录、已 Forget/撤销的记录，在 V9.7 读取结果与现行权限一致；**不得因为清理旧索引复活已遗忘记忆**。
3. 角色 A/B 双向关系、多 NPC Presence、公开五代亲属、订婚对象、前配偶、继亲、年龄与名字遮盖、场外人物及冲突 evidence，不因旧实现删除回归。
4. Canon 同日存档指纹变化时：只读预览、用户明确确认后恢复、再次启动、跨 Campaign 隔离；4096/剩余预算不足为明确拒绝而非截断。
5. Action：停止、重启、断网、LOAD、ACK、未知 Effect、重复回执；确定不会重新执行已确认动作。
6. Letter：未收信、日期扫描、收信回执、Finalization 异常中断与恢复；持久化数据前后 SHA/逻辑状态一致，除明确测试操作外无文件变化。
7. Prompt：Provider 实际有效请求，默认/GLM/DeepSeek/自定义模板的 Role、system/user 分隔、冻结块和动态轮尾；缓存诊断不能伪造真实命中。
8. 安装包：独立 CK3 Mod 有/无独立 Three-Mod 均能保持 VOCT 运行接口，未误删 `ck3-mod` 权威源或 Bridge 生产脚本。

**差异判定：** 对安全/权限、最终动作参数、持久数据、缓存前缀和 JSON schema 的无授权变化为阻断项；界面文本或历史文档重排若不影响行为可按可审查预期差异放行。

### Phase 5 — Decommission & Archive：真正删除与历史归档（P1/P2）

只在 Phase 4 的证据门禁之后执行：

- 删除 `RETIRE_PROVEN` 的**未使用生产实现及打包入口**，并核对构建产物不再包含该生产依赖。
- `KEEP_COMPAT` 改成有明确输入/输出合同的受控读取 adapter；应有下一次评估条件，不在本版强制退役。
- 将历史测试标记为 `archivedChecks` 或保留在历史入口；任何从 `releaseChecks` 调出的测试必须说明行为已有哪个现行测试完全覆盖，不能仅用“当前失败”作为归档理由。
- 已归档的旧模型/模块脚本、说明或报告可以移至 `docs/archive/` 但需保持 Git 可追溯、引用可解析、历史 CI 可辨认；严禁大批量删除历史材料或篡改旧结果。
- 不删除实际用户数据目录中的任何文件；不清理自动备份、不按目录名删 `Legacy`、`episodes`、`recovery`、`pending-letters`、`run-command-queue`、`tombstones`、`branch-registry`。
- 仅有编译后生成的 `out/` 可按**现有受控构建机制**更新，不能把 `resources/app/out` 当成可随意垃圾清理的文件夹。

**Exit Gate：** 实际删除清单逐项对应 `RETIRE_PROVEN`，并有负向引用断言；没有误删历史/兼容源。

### Phase 6 — Complete Release Gate & Handoff：打包、CI 与下阶段移交（P0/P1）

1. `npm test` / `node scripts/test-release.js` 运行完整发布测试（实际入口按 HEAD 核实）。对任何 manifest 改动生成 before/after 差异和对应测试覆盖关系。
2. `npm run build` + `npm run verify:build` 重建并验证 `src/app` → `resources/app/out`；隔离进行 packaging 与 Windows EXE 冷启动、重启、IPC/Preload、媒体解码、正常退出。
3. `npm run deploy:build` **仅在隔离安装目录或经用户确认的部署步骤执行**；不得在审查阶段自动覆盖用户安装版本、记忆或设置。
4. Windows Release Regression 必须对应**准确代码 SHA**，CI 成功不等于 Provider/CK3/Soak 成功。
5. 输出 `V9_7_IMPLEMENTATION_REPORT.md`、`V9_7_VERIFICATION.md`、`V9_7_DECOMMISSION_LEDGER.md` 和 `V9_7_HANDOFF_TO_V9_8.md`；变更/测试/回滚/阻断项要可追踪。
6. 更新当前路线索引、README、CHANGELOG（新增 V9.7“Decommission”里程碑，显式说明旧 Workshop V9.7 已取消，新 V9.8 是 RC/Soak/Full Freeze）。

---

## 5. 建议新增的测试与静态审计工具

| 脚本（建议命名） | 核心覆盖 | 失败策略 |
| --- | --- | --- |
| `scripts/test-v9.7-production-reference-audit.js` | 已退役模块不再被生产组合根、动态加载、IPC 或构建 Manifest 引用；合法兼容 reader 仍被识别 | 发现悬空引用立即 FAIL |
| `scripts/test-v9.7-prompt-plan-parity.js` | 默认与自定义脚本、V813/GLM 等模式的最终 messages、冻结边界、source/Forget/预算 | 安全/Role/prefix 变化 FAIL |
| `scripts/test-v9.7-provider-compat.js` | Provider 原有配置升级、typed/legacy result、usage、stream/cancel/retry/error | 业务语义变化 FAIL |
| `scripts/test-v9.7-legacy-data-readonly.js` | 旧摘要/长期事项/Forget/恢复/分支/信件沙盒读取与全文件哈希对照 | 未授权写入/数据丢失 FAIL |
| `scripts/test-v9.7-transaction-recovery.js` | Finalization、未收信、RunFile STALLED、ACK、重复回执、崩溃恢复 | 丢/重复 Effect 或回执 FAIL |
| `scripts/test-v9.7-ipc-preload-compat.js` | main ↔ preload ↔ renderer channel/DTO 与旧配置调用 | 已支持入口断裂 FAIL |
| `scripts/test-v9.7-manifest-and-build-parity.js` | 生产模块、manifest、源码/out/完整 EXE 文件一致性及禁止误删 Bridge | 不一致 FAIL |

新增测试要进入 `scripts/test-manifest.js` 的实际发布入口，同时复用已有测试，不要为了本次施工再产生数十个只测试内部变量的重复脚本。

**保留并重点运行的既有测试主题：** V9.6.1 家庭/婚约/身份规模/关系图、V9.6.1 世界记忆重启/预算、V9.6 世界记忆动态召回、V9.4 PromptPlan/缓存、V9.3 摘要/长期事项/Forget、V8 Action/Letter 恢复、V9.5 UI/i18n 及 V9.6 Bridge。具体文件名和清单以施工时 `test-manifest.js` 为准。

## 6. 数据兼容及迁移协议（禁止破坏性退役）

### 6.1 数据分类

| 分类 | 允许行为 | 禁止行为 |
| --- | --- | --- |
| Source of Truth：Legacy 摘要、长期事项用户编辑、Episode、授权/撤销 | 按旧 schema 只读；以有证据的兼容 reader 读取 | 自动批量清理、重新总结覆盖、丢 Owner/Campaign |
| Source of Truth：Canon、Branch、Forget/Tombstone | 版本校验后读取、显式用户确认后改变绑定 | 同日冲突自动继续、恢复旧知识、跨 Campaign 复制 |
| Source of Truth：信件、RunFile 队列、ACK、最终化恢复 | 在原事务语义下读写和重试 | 把 UNKNOWN 当 FAILED 重做 Effect、删除未完成队列 |
| Derived：可重建索引、部分缓存、统计 | 证据充分且可恢复时重新计算 | 用派生索引覆盖原始记录或删除唯一来源 |
| 用户设置、Prompt、密钥 | 升级后读回保持、必要时兼容只读 | 重置 Provider 凭据、自定义脚本或配置 |
| 历史文档/测试 | 标记过时、建立新索引/归档入口 | 修改历史 CI 事实、无证据批量删除 |

### 6.2 迁移与恢复步骤

1. **本版默认不做用户数据迁移。** 只在专门发现旧数据**不可读取**且有明确 schema/读写权威时，设计单项可选迁移。
2. 若确需迁移：独立 `dry-run`、确定性目标文件清单、内容哈希、owner/campaign 校验、写入前备份、原子提交或事务 journal、故障注入、幂等重试与可复原恢复。未经用户明确授权不得对其真实用户数据运行。
3. 不能删除单一可恢复副本；即使目标数据看似空白或已被新索引覆盖也须确认源拥有者与全部读者。
4. 所有产出的统计/诊断去标识化；不得包含 API Key、用户对话正文、原始存档人物敏感字段或私有世界记忆正文。

## 7. 质量、安全与性能门禁

### 7.1 P 级定义与 Stop Conditions

- **P0：** 数据不可恢复的删除、跨 Owner/Campaign 隐私泄露、Forget 复活、重复未知 Action Effect、未收信件/ACK 丢失、用户存档或配置被无授权覆盖。**立即停止危险施工并回退该变更。**
- **P1：** 已支持的真实业务入口断裂、V9.6.1 亲属识别/手动隐藏回归、Canon 重启/预算回归、最终 Prompt Role/缓存锚点大面积错误、安装包不可启动。**不得完成 V9.7。**
- **P2：** 经证实的局部性能退化、翻译遗漏、文档/非关键测试索引问题。记录 owner、影响、修复或明确延期至 V9.8，不允许无记录默许。

### 7.2 性能方法

- 与同机相同用户配置的 V9.6.1 对照，使用匿名合成样本及同一 CK3 实机测试流程；至少对比冷启动、首次/稳态 Prompt 构建、1000/5000/10000 人身份投影、摘要/长期事项读取、关系图查询以及 1/3/多人场景。
- 同时记录 `P50/P95`、样本量、首次冷读/热读、主线程阻塞、峰值内存、真实 Provider usage/cache hit（如果已实际请求）；没有同条件基线则**不声称提高多少百分比**。
- 不把删除安全检查导致的耗时减少算作性能改善。测出可重复退化再定 P 级与优化范围。

### 7.3 验证证据分级

`CODE_REVIEWED` / `LOCAL_TEST_PASS` / `CI_PASS` / `PACKAGED_PASS` / `PROVIDER_LIVE_PASS` / `CK3_LIVE_PASS` / `SOAK_PASS` / `USER_CONFIRMED` 分开登记，**互不替代**。

V9.7 最低可以作为“可提交工程候选”的标准为：P0/P1=0、全部被修改路径的合同回归通过、准确 SHA 的远端 CI、源码/out/分发一致、退役台账完整。

V9.7 **作为实机完成候选** 还应完成一次新版本 CK3/Provider 基本回归。若无实机证据，必须标记 `CK3_LIVE_PENDING / PROVIDER_LIVE_PENDING`，不能把代码审查签成实机通过。全量两小时以上和连续 100+ 回合 Soak 留给新 V9.8 RC Gate，不在 V9.7 强制提前做完整长测。

## 8. 变更提交、审查与回滚方案

### 8.1 建议提交拆分（可按实际证据调整）

```text
docs(v9.7): align roadmap numbering and freeze decommission baseline
test(v9.7): add reference inventory and protected behavior goldens
refactor(v9.7): consolidate verified prompt/provider adapter boundaries
refactor(v9.7): retire proven duplicate memory or legacy read paths
refactor(v9.7): remove verified unused ipc/runtime entries
test(v9.7): close storage/recovery/bridge/build parity gates
docs(v9.7): publish retirement ledger and v9.8 handoff
```

**注意：** 标题是拆分建议，**不是默认允许删除上述所有领域**。没有 `RETIRE_PROVEN` 的域保留 `HOLD_UNPROVEN`，仍可完成本版。

### 8.2 每个 PR / 提交必须说明

- 基线 SHA 和对应修改后 SHA。
- 代码/配置/持久数据/协议的 before→after 行为。
- 当前生产消费者/动态入口证据及目标替代路径。
- 单项正例、负例、恢复/中断验证与命令/结果。
- 构建产物与实际安装一致性情况。
- 数据迁移是否发生（默认 NO）。
- 最小回滚方法；哪些持久文件绝不能用 `git checkout` 或旧数据镜像直接覆盖。
- 保留的 `HOLD_UNPROVEN` 列表、P2 处置与新 V9.8 的待验事项。

### 8.3 回滚原则

- **代码回滚：** 仅对对应独立提交反向应用或回退到安全 tag/build；不要整体回滚真实用户数据目录。
- **数据回滚：** 本版原则上不写用户数据；若有专门批准的数据迁移，使用迁移 journal/快照执行，保护最新合法 ACK/Letter/Forget，不让旧数据覆盖新状态。
- **安装回滚：** 恢复旧 Runtime 二进制与适配版本，保持 Workshop Mod 原独立安装方式；运行时应拒绝超出协议兼容范围的不安全写入。

## 9. 交付物清单

建议作为当前文档或施工时新增文件写入 `docs/current/v9/`：

1. `V9_7_DETAILED_ENGINEERING_SPEC.md`（本文件，施工规则）。
2. `V9_7_BASELINE.md`（冻结基线与 SHA）。
3. `V9_7_DECOMMISSION_LEDGER.md`（逐条真实引用、状态与退役证据）。
4. `V9_7_BEHAVIOR_PARITY_MATRIX.md`（Prompt、Provider、Memory、Worldline、Action、Letter、IPC、Bridge 正反例对照）。
5. `V9_7_DATA_PRESERVATION_REPORT.md`（隔离副本旧数据、摘要/Canon/信件/恢复读回和哈希）。
6. `V9_7_IMPLEMENTATION_REPORT.md`（实际改动文件、提交、异常与回滚）。
7. `V9_7_VERIFICATION.md`（本地、CI、打包、CK3、Provider 证据分级）。
8. `V9_7_HANDOFF_TO_V9_8.md`（RC 所需 Soak、安装升级/回滚和未结 P2）。

**不要求施工代理生成空白占位文件来凑交付数**；多个短报告可合理合并，但上述信息必须完整可追踪。

## 10. 明确的 Definition of Done

### 10.1 P0 数据安全

- [ ] 无用户数据删除/批量重写，或已批准的可恢复专项迁移有完整日志与回滚。
- [ ] Legacy 摘要、长期事项、忘记/撤销、Canon、Branch、Action/Letter/ACK/Finalization 全部可读取、可恢复。
- [ ] 没有跨 Owner/Campaign/Branch 的越权或旧 Forget 数据复活。

### 10.2 P1 业务与接口等价

- [ ] 退役台账所有删除项均为 `RETIRE_PROVEN` 且有实际消费者/替代证据。
- [ ] 自定义 Prompt 与 Provider 输入输出行为不退化，稳定前缀/动态尾部、4096 普通 Canon 上限保持。
- [ ] 亲属五代互知、订婚/前婚/继亲、手动隐藏、年龄来源不回归。
- [ ] Action、Letter、Bridge、IPC、Renderer 生产合同与故障恢复不回归。
- [ ] 历史用户设置和旧摘要格式仍有兼容 reader，无法证实退役的模块明确 KEEP/HOLD。

### 10.3 工程质量与交付

- [ ] 当前有效 V9 路线明确“旧 Workshop V9.7 已取消，新 V9.7=Decommission，新 V9.8=RC/Soak/Freeze”。
- [ ] `test-manifest.js` release/archived 映射有清单，有真实负例且无无解释的发布组撤销。
- [ ] 全量 Release Regression 对**准确 V9.7 代码 SHA**通过；构建、Runtime、EXE 隔离检查成功。
- [ ] P0/P1 为 0；每个 P2 均有修复/接受/延期负责人和目标版本。
- [ ] 向 V9.8 交接真实 CK3/Provider、Windows 安装/升级/离线/失败恢复/回滚、2 小时与 100+ 回合 Soak 的计划和验证矩阵。
- [ ] 用户实机项目若尚未执行，状态**明确标为 PENDING**，不能宣称 Full Freeze。

## 11. 向 V9.8（原 V9.9）的移交

新 V9.8 的职责是 **RC / Soak / Full Freeze**，而不是继续大规模删代码。应在 V9.7 收口的稳定代码上，对 Windows 安装/更新/离线/文件锁/失败恢复/回滚，真实 CK3 Bridge、存档/Memory、Provider、Prompt/缓存、UI/语言、性能和长时运行做全量矩阵。参考真实 CK3 至少 2 小时、连续 100+ 回合，并将具体游戏版本、Mod 组合、存档、请求统计、故障恢复和结果写入可复现报告。冻结门槛：**P0=0、P1=0、P2 有明确处置；全部应有 Gate 不可用“CI 绿灯”替代。**

---

### 设计依据（施工前再按 HEAD 校验）

- `docs/current/v9/V9_ROADMAP.md`：原 V9.8 Decommission、原 V9.9 RC/Soak/Full Freeze 的历史定义（编号需修订）。
- `docs/current/v9/V9_DECOMMISSION_LEDGER.md`：旧路径初始台账，其中多个项目此前标为 `KEEP_UNTIL_PROVEN`。
- `docs/current/v9/V9_DATA_OWNERSHIP_LEDGER.md` 与 `V9_BASELINE_BEHAVIOR_CONTRACTS.md`：数据 Source of Truth 与不可变行为。
- `docs/current/v9/V9_6_1_IMPLEMENTATION.md`：五代关系、身份投影、Bridge 与当前自动化证据。
- `docs/current/v9/V9_6_1_WORLD_MEMORY_RESTART_FIX.md`：11 月 1 日 Canon 重启、同日分支确认与 4096 Token 预算修复。
- `scripts/test-manifest.js`、`package.json`、`.github/workflows/`：发布门禁、构建与远端 CI 权威入口。

**施工总原则：Behavior Freeze → Adapter Boundary → Strangler Migration → Contract Verification → Decommission。先证据后删除；先数据/权限安全后代码整洁；每个危险变更单独提交、单独回滚。**

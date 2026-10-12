# VOCT V9 阶段开发总路线（修订版）

实施索引补记（2026-10-12）：[V9.2.1 缓存专项候选](V9_2_1_VERIFICATION_REPORT.md) 仅修复现有 Durable 前缀/Forget 重试及诊断，缓存效果 HOLD。此索引不修改下方历史路线、阶段承诺或 V9.3/V9.4 范围。

> **文档类型**：Roadmap / Architecture Charter / ADR 索引（路线与边界，不代替逐文件施工文档）  
> **文档版本**：V9 Roadmap Revision 2 · 2026-10-11  
> **审查对象**：[wsdsb-111/VOCT-NEW](https://github.com/wsdsb-111/VOCT-NEW)，`main`  
> **仓库快照**：`3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4`（2026-10-10 03:38:58 UTC）  
> **阶段状态**：**V8 功能冻结（用户于 2026-10-11 确认）；V9.0 待实施**。此处“冻结”是产品/开发决策，不表示所有远端 CI 与新场景实机问题已关闭，也不表示已经创建 Git tag。  
> **执行入口**：配套《V9.0设计开发文档_修订版.md》。任何实际施工前应再次检查 HEAD、工作区、安装版与 CK3 Workshop 文件指纹。

---

## 0. 执行摘要：这次修订改变了什么

V9 的方向维持不变：**不以堆砌新玩法为主，而是把 V6–V8 演化而来的工程建成可重建、可维护、可测试、可安装、可更新、可回退的产品**。

在上传的旧路线基础上，新增三个 V9.0 优先事项，并修正一个事实基线：

1. **把“游戏刚进入时，前几轮对话反复卡一下，后续自然恢复”列为 V9.0 的 P1 性能事故（根因未明）。** 先分段打点、复现、对照，再做最小修复；不凭观察直接删轮询、禁用信件管道或关闭 Memory4。
2. **将东方王朝／汉番礼制／天家宗仪独立兼容工程从 VOCT 的开发与发布体系中分离。** 兼容 Mod 继续独立存在、独立测试、独立发版；不修改三款上游 Mod，不清理玩家本地已安装副本，也不把独立兼容 Mod 变成 VOCT 的必需依赖。
3. **修复远端 Release Regression 的基线问题。** 最新 HEAD 的 GitHub Actions 为 Failure；可见的直接失败发生于历史版本对照脚本执行 `git show fda1b8e:...`，而工作流浅克隆未取得该历史对象。V9.0 必须恢复真实可重复的 CI Gate，不允许通过跳过反例测试“刷绿”。
4. **规划基线由旧文档中的 `0c290d8` 更新为当前 `3c49364`。** 该 HEAD 包含 V8.15.2 多轮后续修复与 Three-Mod 1.0.6 的提交；仍须在 V9.0 开工前核验真实运行包/Mod 是否与此一致。

### V9 的九项确定性决策

- **V8 行为冻结，V9 采用受控变更**：新问题进入 V9，不在 V8 上继续无序叠补丁；冻结快照只能作对照，不可直接覆盖。
- **保留 Memory Engine 4.0**：不开发 Memory5；保留现有 `engineVersion: 3.0` 兼容协议和摘要 2.5 存储合同，除非后续有明示的版本化迁移。
- **继续使用 JSON**：V9 不进行 SQLite/SQL 迁移，也不做 JSON/SQL 双写；优先治理 Scope、索引、事务恢复、单一权威记录。
- **保持知识授权边界**：Owner / Campaign / knownBy / Presence / Direct Observation / Disclosure / Source Provenance / Forget / Tombstone / Recovery 不允许因提速或架构迁移被弱化。
- **一个产品、一个规划中的 Workshop 分发入口、两个独立运行组件、一个 Bridge 协议**：CK3 Mod 不与 Electron/Node Runtime 合并进程。
- **独立兼容工程退出 VOCT 产品边界**：Three-Mod 兼容不随 VOCT V9.7 Workshop 本体发布，不参与 VOCT 的 Release blocker；VOCT 的**自身 CK3 Bridge 补丁**则仍受 VOCT 管理。
- **Provider 合同统一，缓存策略不伪统一**：只有服务商返回的真实数据可称 Provider Cache Hit；本地 Prefix Fingerprint 只能称结构诊断。
- **任何重构先有行为证据再退役旧路径**：尤其不能重新生成旧记忆、误删信件、回滚已确认 ACK、恢复已遗忘来源。
- **性能优化以使用体验为目标而非只看 CPU 指标**：CK3 帧时间、Electron 主/渲染线程阻塞、请求首字延迟分开测量。

**产品口号**：`One Product · One Workshop Distribution · Two Runtimes · One Bridge Protocol`。  
**工程边界补充**：`Independent Compatibility Mods ≠ VOCT Product Dependency`。

---

## 1. 核对到的仓库实际状态与证据等级

| 主题 | 当前能确认的情况 | 不能据此声称的结论 |
|---|---|---|
| 仓库 | `main` HEAD `3c49364`；根目录为 Windows 打包形态 | 不能宣称已有独立可重复构建的正式 `src/` 工程 |
| Runtime | `resources/app/out/main/` 含 conversation、memory-system、letters、worldline、providers、actions、ipc 等模块 | 不能把 `out/` 简单视为随时能从干净源码再生的构建目录 |
| 发行包版本 | `resources/app/package.json` 为 Electron App `2.0.4` | 不能将 App 包版本混同业务功能 V8.15.2 或未来产品正式 2.0 |
| Memory | 现有 Memory4、Legacy 摘要、Episode/Memory、Year/Life 等多种 JSON 记录 | 不能把所有摘要误称为一场一文件，也不能声称完成统一存储改造 |
| 通信 | VOCT Workshop item `3346777360` 的日期／RunFile 桥接快照见 V8.15.2 报告 | 不等于 Workshop Mod 全量、最新且可重建源码已在 VOCT 仓库纳管 |
| 信件 | V8.15.2 退役旧 runner、引入 DATE 增量扫描；旧卡顿曾有用户报告“改善” | 不等于本次“前几轮短暂停顿”已定位和完全消除 |
| 兼容工程 | `compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility/`，Three-Mod 1.0.6；含独立官职交接逻辑 | 不属于 VOCT NPC 对话产品核心；不能在整理仓库时误删本地已安装 Mod |
| 测试 | 最近实施报告记录本地 `409/409 PASS`（该报告中的时间点与环境） | 不能等价于本次审查重新运行过 409 项 |
| 远端 CI | 2026-10-10 HEAD 对应 Release Regression Failure，历史 `git show fda1b8e` 缺对象 | 不能从 CI Failure 直接推定信件业务逻辑实际失败；亦不能宣称远端通过 |
| V8 冻结 | 用户明确作出 V8 正式冻结、转入 V9 的决定 | 仓库现有 tag、安装包 SHA、Workshop 文件与冻结承诺仍需 V9.0 落证 |

### 1.1 V8 应继承而非重写的能力

Memory4 的叙事 Detail + 结构化知识、第三人和时间召回、逐 Owner 认知、可观察特质、披露事实版本、源权限与持久遗忘；Worldline Current Runtime Truth 和历史资料／时点检索；多人 Presence 和终局 Finalization；官方 Action System 2.0.3、RunFile 队列／ACK／效果回读；信件独立日期、宝物回执与归档恢复；三主题 UI 及现有多 Provider 适配。

### 1.2 证据分层

统一使用以下等级，报告不得越级使用“PASS”一词：

1. `CODE_REVIEWED`：读到生产源、调用链和配置，但未执行。
2. `LOCAL_TEST_PASS`：本地自动化回归通过，附 commit、命令、退出码。
3. `CI_PASS`：远端指定 SHA 的 GitHub Actions 成功。
4. `PACKAGED_PASS`：实际 VOTC.exe、Renderer、IPC 的隔离或真实启动验证。
5. `PROVIDER_LIVE_PASS`：真实 Provider 请求／结构化输出／流式／usage 证据。
6. `CK3_LIVE_PASS`：明确游戏版本、存档／开局、启用 Mod 组合、Workshop 指纹的实机确认。
7. `SOAK_PASS`：长时间与连续回合压力场景的可复现记录。
8. `USER_CONFIRMED`：用户明确确认某个操作结果；可以与其他证据并列，但不能替代未采集的具体指标。

上表为分类维度，并非所有测试都必须严格按数字顺序执行。**V9.0 之前的报告与截图是历史证据，不自动继承为 V9.0 本轮结果。**

---

## 2. 已知启动／逐轮卡顿：V9 新增风险基线

### 2.1 症状（事实）

2026-10-10 用户实机观察：进入游戏及开始对话的初期，多轮对话各有一次明显停顿；继续运行一段时间后，对话趋于正常。**尚无具备统一时钟的帧时间、调用栈或逐回合耗时日志；原因待验证。**

### 2.2 需要排查但不可先行定罪的生产路径

| 路径 | 仓库中已有事实 | V9.0 要获取的证据 |
|---|---|---|
| CK3 GUI 原生日期与 `run votc.txt` | V8.15.2 报告记录原生桥约每 2 秒轮询；属于正式信件与 Action 传输的一部分 | 游戏帧时间、每次调用耗时、游戏是否因双 consumer 而短暂阻塞 |
| Electron 剪贴板 Listener | `main.js` 当前仍是 `setInterval(..., 100)` | 轮询次数、单次成本、游戏／非游戏焦点、相同输入重复处理情况 |
| Conversation 初始化 | `conversation.js` 在开场解析 CK3 日志、加载摘要、保存可观察认知、同步官方追忆 | `initializeGameData` 各步骤 wall time、同步 I/O、Owner/人物数量与耗时曲线 |
| 认知快照 | `captureDisclosureProfiles` 对相关 Owner 遍历人物并形成快照；`observeVisibleTraits` 做同场合法观察 | 首次调用数量、Owner × Entity 数量、内存／I/O；必须保留合法来源门禁 |
| Worldline 预取 | 开场 `prefetchFrozenWorldline()`，可包含 Canon 准备与候选查询 | 冷预取与重复使用分段耗时、主线程阻塞、缓存命中依据 |
| Memory／Prompt | 每轮存在 Memory Context、Prompt 构建和 Provider 调用 | Recall、读盘、Token 估算、Prompt 序列化、真实 TTFT 分开计时 |
| LetterLogReader / DATE | V8.15.2 已加入分块冷扫描与增量更新，且仍需 ACK 看门狗 | 冷扫描 bytesRead/duration/maxBlock、增量模式、重启次数、队列长度 |
| Renderer | 对话列表、状态展示与接收流式 Token | 点击到 IPC、渲染 Long Task、首 token 至绘制的延迟 |

**不把“热身后恢复”自动解释为缓存命中。** 也可能是启动恢复队列完成、日志冷扫描结束、Worker 初始化结束、CK3 自身加载收尾或多个因素叠加。

### 2.3 原则性验收

V9.0 应能用相同环境、相同存档／Provider 分别给出冷启动前 10 轮与稳定后 20 轮的 `P50/P95`，并明确是哪一段（CK3 帧、主线程、渲染、Recall、Prompt、网络 TTFT、日志扫描）发生了差异。若无法复现，应保留可匿名化的诊断入口和“未复现”结论，**禁止凭猜测关闭必要功能**。

---

## 3. 独立兼容 Mod 与 VOCT 核心的边界

### 3.1 需要独立维护的工程

当前仓库中可明确识别：

```text
compatibility-mods/
  VOTC_Three_Mod_Character_Name_Compatibility.mod
  VOTC_Three_Mod_Character_Name_Compatibility/
    descriptor.mod
    common/
    events/
    gui/
    localization/
```

该兼容项目现为 Three-Mod 1.0.6；面向 **Oriental Empires（东方王朝）／Eastern Ritual and Governance（汉番礼制）／天家宗仪** 的人物显示、政体及流官任命规则，不依赖 VOCT 的对话引擎完成业务功能。相关仓库测试至少有：

- `scripts/test-three-mod-character-name-compatibility.js`
- `scripts/test-v8.15.2-celestial-office-release.js`
- `scripts/test-v8.15.2-celestial-office-independent-qa.js`

这三组目前登记在 VOCT `scripts/test-manifest.js` 的 `releaseChecks`；**分离时必须迁走对应测试与 fixtures，调整清单并重新验证**，而非仅移动 Mod 目录。

`compatibility-patches/tianjia-benji-repair/` 是另一个上游兼容性质的补丁目录；V9.0 应逐文件核验其独立性，再决定纳入独立兼容仓库的对应子项目，**不能未经审计按目录名统删**。

### 3.2 必须留在 VOCT 的工程

`compatibility-patches/v8.15.2-letter-runner/` 虽然位于 `compatibility-patches`，实质是 VOCT Workshop Mod 的**原生 Bridge / DATE / RunFile / ACK** 运行配套快照；它与 VOCT Runtime 有协议耦合。**本目录必须保留至 V9.6 纳管和 V9.7 分发接替完成**，不得与 Three-Mod 一起删除。

`VOCT → CK3` 的角色数据导出、`VOTC:IN`、`VOTC:DATE`、Trait Canonical Key、Action ACK、Letter 回执属于 VOCT 产品接口；`东方王朝 ↔ 汉番礼制 ↔ 天家宗仪` 的官职、称谓冲突解决属于独立兼容工程。代码内若存在有限交叉，则通过“可选能力／输出字段合同”维持，不形成必须安装 Three-Mod 的依赖。

### 3.3 推荐分离方案（迁移前提，而非已完成事实）

建议建立单独 Git 仓库，例如 `CK3-Three-Mod-Compatibility`（**建议名称，未创建**），完整复制当前源代码、描述符、脚本、fixtures、测试、对应历史说明、版本与许可元数据。先在独立环境 PASS，再由 VOCT 当前工作树移除已迁出的**被跟踪副本**和独立测试入口，保存 README 外部链接与历史归档。VOCT Git 历史保持不改写；如需保留独立项目提交史，可在临时镜像上做 `git subtree split` 或等价提取，禁止在 VOCT 主仓库上运行破坏性历史重写。

**不触碰**：CK3 本地安装目录、当前 Playset、存档、上游三款 Mod、已保存兼容工程备份、VOCT Runtime Memory4 与信件记录。`git rm` 的目标仅是验证完毕的 VOCT 工作树被跟踪副本；不等同于卸载玩家游戏 Mod。

### 3.4 完成判断

- 独立仓库源码、测试、CI、安装说明和最低兼容版本齐备；Three-Mod 1.0.6 源码行为与迁出前一致。
- VOCT 在 **不安装** Three-Mod 时，核心聊天、导出、Memory4、Action、Letter 正常；在 **安装** Three-Mod 时，接口字段仍正确，不以兼容工程内部规则判断对话是否可运行。
- VOCT Release Regression 不再运行 Three-Mod 自身测试；独立项目另有有效自动测试；无悬空引用、CI 无假绿。
- 后续 Three-Mod 1.0.x 发版不增加 VOCT V9 的发布阻塞项，反之亦然。

---

## 4. 不变的 Memory4、Worldline 与持久化原则

### 4.1 认知授权不变量

```text
CK3 当前真实事实  ≠  NPC 被授权知道的事实  ≠  NPC 的叙事性理解与记忆
```

- `Scope = Campaign × Owner`；人物实体 ID、对话对象、事件时点／获知时点、来源与证据修订不可丢。
- 真实可观察内容仅由合法在场观察建立；非可见特质不得因 UI、缓存或摘要循环越权进入 Prompt。
- Forget 必须撤销所有生产召回资格；Tombstone、Recovery、旧索引和 Year/Life 不能重新使其生效。
- 历史事实、当前游戏事实、计划／未来事件分离；世界线不写入 CK3 的真实游戏状态。
- Legacy 旧摘要只有证据充分时才能绑定当前 Campaign，不能猜测归属或批量重写叙事文本。

### 4.2 数据层策略

继续使用 JSON，逐步建立受 Scope 约束的单一权威数据、索引与派生视图；允许按关系聚合 JSON 与独立 Memory4 entry 并存，但必须明确哪一层能写、哪一层可重建。原子 rename 仅是单文件承诺，多文件 Finalization 需要 journal / commit marker / idempotency 与崩溃恢复合同。

保留关系叙事、承诺、情绪和事件因果，不把 Narrative Detail 压扁为一串事实标签。Year/Life 是可追踪的长期视图，不是可以覆盖所有原始记忆的唯一存储。

### 4.3 ADR

| ADR | 决策 | 再评估条件 |
|---|---|---|
| ADR-V9-001 | V9 使用 JSON，不采用 SQLite／SQL 双写 | 实测 P95/索引扫描／并发提交／损坏恢复出现可复现且 JSON 优化无效的问题 |
| ADR-V9-002 | Memory4 叙事与结构化知识双层共存 | 只能经过完整权限和 RP 品质双门禁评估，不能仅因目录改造调整语义 |
| ADR-V9-003 | Workshop 单入口目标；Mod 与 Runtime 独立运行 | 平台策略、执行文件、许可、更新行为由 V9.7 实测决定可行交付形态 |
| ADR-V9-004 | Three-Mod 与 VOCT 产品解耦 | 仅经双方协议变更审查，不能作为新的隐性必装项 |
| ADR-V9-005 | V9.0 性能先诊断再最小修复 | 有统一 trace、差异性复现、负向回归及真实游戏反馈后才改运行时循环 |
| ADR-V9-006 | 不跳过失败 CI 测试 | 对照 fixture 与环境可重建且 CI 对指定 SHA 成功后关闭 |

---

## 5. 目标架构与依赖方向

```text
                          ┌───────────────────────────────┐
                          │  Presentation                 │
                          │  Electron UI / CK3 GUI        │
                          └───────────────┬───────────────┘
                                          │ IPC / Bridge
                          ┌───────────────▼───────────────┐
                          │  Application Services          │
                          │  Conversation / Presence       │
                          │  Memory / Worldline / Action   │
                          │  Letter / Character Profile    │
                          └───────────────┬───────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │  Domain Contracts              │
                          │  Owner / Knowledge / Time      │
                          │  Evidence / Permission Rules   │
                          └───────────────┬───────────────┘
                                          │ Ports
                          ┌───────────────▼───────────────┐
                          │  Adapters                      │
                          │  Provider / JSON Repository    │
                          │  CK3 Bridge / External IPC     │
                          └───────────────┬───────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │  Infrastructure                │
                          │  Node / Electron / File System │
                          │  Windows / Steam Distribution  │
                          └───────────────────────────────┘

      [单独的 Three-Mod Compatibility 工程，不属于上述运行依赖链]
```

最终建议目录（**目标形态，不是仓库现状，也不要求 V9.0 迁完**）：

```text
VOCT/
  packages/
    shared-contracts/       # 业务 DTO 与 Bridge 协议
    runtime-core/           # Application 组合根
    conversation/ presence/ memory/ worldline/
    action/ letter/ provider/ persistence/
    ck3-bridge/ desktop/ ui/
  ck3-mod/                  # VOCT 自身 Workshop Mod（V9.6 纳管）
  distribution/
    bootstrap/ workshop/ manifests/ release/
  tests/
    contracts/ integration/ regression/ e2e/ fixtures/ performance/
  docs/
    current/ archive/
  dist/                     # 构建输出，禁止作为唯一事实源码

# 独立项目：另一个仓库
CK3-Three-Mod-Compatibility/
  mod/ tests/ fixtures/ docs/ .github/workflows/
```

约束：Domain 不依赖 Electron、Provider 或 debug.log 原始文本；Provider 不直读 Memory4 内部；UI 不直写持久文件；CK3 Bridge 不绕过服务层改变知识权限；诊断层不记录用户对话内容和密钥。

---

## 6. V9.0—V9.9 修订总览

| 版本 | 里程碑 | 本阶段核心交付物 | 退出条件摘要 |
|---|---|---|---|
| **V9.0** | **Freeze Transition / CI / Startup Latency / Mod Separation** | 冻结清单、可追溯 CI、冷启动卡顿诊断或验证修复、独立兼容项目迁移、架构/数据合同 | 能复现/解释卡顿或如实记录未复现；CI 绿；兼容工程独立；V8 行为基线保存 |
| **V9.1** | Reproducible Source & Build | 正式可编辑源码、构建管道、锁定依赖、产物清单 | 干净环境能从源码构建 Runtime，与 V8 行为合同等价 |
| **V9.2** | Application Boundary & JSON Repository | 服务端口、Scoped JSON Repository、索引与多文件故障恢复 | Memory4 不变；授权一致；索引可核验、可安全恢复 |
| **V9.3** | Provider Platform | Adapter、能力矩阵、正常化输出、结构化/流式 Conformance | 支持的每类 Provider 都有合同证据；错误/usage 不伪造 |
| **V9.4** | PromptPlan & Cache | PromptPlan V9、前缀指纹、厂商 Serializer、缓存诊断 | 不泄露已忘/未授权知识；原生缓存指标可解释 |
| **V9.5** | UI Architecture / English | 组件化、异步状态治理、`zh-CN`/`en-US` | 中英文主要路径可读；Prompt/UI/Game 三种语言独立 |
| **V9.6** | CK3 Bridge & VOCT Mod Source | 仅 VOCT 自身 Mod 源码纳管、握手、能力版本、协议 Fixtures | Mod/Runtime 错配可提示，Trait/DATE/ACK/Letter 合同通过 |
| **V9.7** | Workshop Unified Distribution | 合规预审、payload/bootstrap/manifest、升级与回滚 | 若平台允许，订阅取得必要文件，不另上 GitHub 获取 Runtime；可回退 |
| **V9.8** | Legacy Decommission | 清债台账收口、旧 Flag/路径有证据退役、文档归档 | 不删可恢复数据、不丢迁移读者、不误删历史工具 |
| **V9.9** | RC / Soak / Full Freeze | CK3、Provider、Windows 安装、Memory、性能的完整矩阵 | P0/P1 关闭，CI 与升级/恢复实证完成 |

**顺序是合并 Gate 的依赖顺序，不是绝对日历。** 可以并行调研，不可越过行为/数据/恢复门槛将后续重构当成已完成。版本内部按 `V9.0.1` 等小版本拆包时，以单一合同和可回滚提交为单位。

---

## 7. 各阶段范围与边界

### 7.1 V9.0：冻结、性能、CI、解耦（新增优先级）

**必须完成**：

- 固化 HEAD/二进制/Workshop 来源、历史证据、数据备份及真实安装清单；建议创建不可变 V8 冻结标签（需实际执行并验证）。
- 对最新 CI Failure 进行对照修复：保留 `git show` 历史负向测试，短期可使 checkout 获取必要历史对象；长期可用经过校验的独立只读 fixture 避免历史耦合。两种方案均不得跳过测试。
- 建立冷启动／逐轮 trace；对剪贴板 100ms、CK3 2s 桥、日志冷扫描、认知快照、Worldline、Memory/Prompt、Provider、UI 分段排查。确认根因后仅进行受控最小修复。
- 完整、可回滚地分离 Three-Mod 兼容源与测试；其他 `compatibility-patches` 逐项归属；VOCT CK3 原生桥保留。
- 整理模块责任、数据 Source of Truth、写入路径与 `V9_DECOMMISSION_LEDGER.md`，建立针对实际数据规模的首份性能基线。

**不做**：SQLite、Memory5、UI 大重构、Prompt 重新排序、Workshop payload 分发、新的游戏玩法、不明原因批量删除计时器。

详见配套 V9.0 设计开发文档。

### 7.2 V9.1：源码与构建闭环

从打包态 `resources/app/out` 建立可编辑源、Renderer/Preload/Main 构建管线；锁定依赖与生成产物 hash，旧构建作为对照 until parity；暂不强制 TypeScript。CI 包含源码构建 Smoke + 原有发布合同 + 文件完整性；本地构建与发布产物对比必须实际可重现。处理现有 LFS/打包二进制边界与许可清单。

### 7.3 V9.2：服务分层及 JSON 整合

逐步建立 ConversationService、PresenceService、MemoryService、WorldlineService、ActionService、LetterService、PersistenceService。`readEntry(scope,id)`、`queryCandidates(scope,filter)`、`commitFinalization(batch)`、`forgetSource(scope,proof)`、`recover()` 是语义 Port 样例而非预先钉死的代码签名。索引优先定位候选、按需读取正文，修订号/校验和与多文件日志可恢复；旧 Legacy 与官方追忆保持兼容。

### 7.4 V9.3：Provider 平台

统一 `capabilities`、普通/流式生成、Structured Output、Result/Usage/Reasoning/FinishReason、超时取消、429/5xx、Unsupported 能力。V9.0 仓库现有 `player2`、`openrouter`、`openai-compatible`、`ollama`、`deepseek`、`gemini`、`zhipu` 配置入口；最终支持名单按实际可用端点与用户选择，不假设默认模型名称永远有效。各厂商的缓存方式、思考开关与费用以厂商结果为准。

### 7.5 V9.4：PromptPlan、稳定前缀与缓存

语义块建议为 `GLOBAL_STATIC / CONVERSATION_FROZEN / RESPONDER_FROZEN / APPEND_ONLY_HISTORY / DYNAMIC_WORLDLINE / QUERY_DYNAMIC_MEMORY / CURRENT_TURN`。迁移旧 `v5/v6/v7/v813/deepseek_v89/glm_cache_v2` 的生产路径时先映射，不在本阶段直接删除旧配置。诊断区分 App 可控 Prefix Ratio/Fingerprint 与服务商的真实 cached token/hit/TTFT；未知应显示 UNKNOWN。

### 7.6 V9.5：UI 与英文

整理 Conversation、Memory4、Worldline、Letter、Action、Provider、Diagnostics、Settings；统一 IPC Client、Stale Request、Context Epoch、Error Code，双语 `zh-CN`／`en-US`。明确 `uiLanguage`、`promptLanguage`、`gameLanguage` 互不联动。保留三主题内部键 `parchment/knight/ink` 及现有图片布局和中文可读性合同。

### 7.7 V9.6：正式 VOCT CK3 Bridge

**仅纳管 VOCT 自身** Workshop Mod 的脚本、导出、事件与 GUI，不导回已分离的 Three-Mod 业务工程。提出 `bridgeProtocol`、`modVersion`、`runtimeCompatibility` 与 capability 集合（如 `trait_key_v1`、`presence_v2`、`run_ack_v2`、`letter_v2`、`native_date_v1`）；支持 `SUPPORTED/DEGRADED/INCOMPATIBLE` 与最小协议错误描述。真实 CK3 导出、加载、读档、Action、Letter 和日期必须验证。

### 7.8 V9.7：Workshop 统一分发（前置合规 Gate）

计划同一 Workshop 入口交付 CK3 Mod 与桌面 Runtime 所需文件，通过可发现的 Bootstrap 完成用户明确启动、hash 校验、安装、staging 更新与回滚。**必须先核验 Steam/CK3/Paradox Workshop 的当前格式、可执行文件政策、大小/许可/安全限制**。不能假设 CK3 Mod 可以静默运行 Windows EXE；若平台不允许 exe payload，应重新作符合规则的分发设计与用户体验 Gate，而不是规避限制。与 Three-Mod 独立工程无关。

### 7.9 V9.8：有证据退役历史路径

按 `Behavior Freeze → Adapter Boundary → Strangler Migration → Contract Verification → Decommission` 顺序执行。旧 Prompt 路径、Provider 特判、Memory 重复读取、旧 IPC、测试/文档等按引用证明退出；**保留 V8 存档、旧摘要、未收信件、Forget 记录、恢复快照和必要迁移工具**。历史文档归档而非直接销毁。

### 7.10 V9.9：RC、Soak、完整冻结

停止新增大型功能。组合验证：完整下载/安装/更新/离线/回滚，双 Runtime 握手，真实 CK3 存档与多人互动，Memory4 权限，Letter/Action 的一次性真实确认，Provider 请求矩阵，英中 UI，第一轮与长期连续回合性能、复杂数据恢复。建议起点为真实 CK3 至少 2 小时与 100+ 回合，但阈值最终需以 V9.0 采样和设备能力定标，而非把建议写成已经测试。

---

## 8. 跨版本风险优先级与阻断门槛

| 级别 | 风险 | 最低阻断规则 |
|---|---|---|
| P0 | Campaign／Owner 串档、Forget 复活、旧记忆/存档丢失、重复执行有副作用的 Effect | 任意出现即阻断对应合并／发布，保留数据并恢复安全路径 |
| P0 | 错误的 ACK/Letter 状态导致错误确认或未知效果重放 | 不得通过忽略日志或绕过幂等锁解决 |
| P1 | 冷启动前几轮重复 UI／游戏卡顿 | V9.0 必须有 trace 和验证修复，或在无法复现时保存可验证未复现说明与继续监测 Gate |
| P1 | CI 对指定 SHA 失败 | 不能宣称 `CI_PASS`；V9.0 Exit Gate 要求稳定绿灯 |
| P1 | 兼容工程迁移丢文件、测试或误删除本地安装 Mod | 先完整备份与独立仓库复验，后移除 VOCT 跟踪副本 |
| P1 | CK3 Bridge/Workshop 更新导致版本错配或用户数据覆盖 | 协议检查、manifest、备份与回滚是分发前置条件 |
| P2 | UI 翻译遗漏、历史文档死链、部分非生产测试过时 | 进入退役台账，V9.8/9.9 收口 |

### 性能防回归底线

- 在没有可比基线前，任何“速度提高 X%”均不得写为完成事实。
- 首次优化优先消除明确重复工作、无界扫描与主线程同步阻塞；不能减掉安全校验、隐私过滤或 ACK 等待来换取响应速度。
- 记录异常和可用性的同等 Gate：冷启动时不能用过时 Worldline、跨战役的记忆或不完整数据换掉 UI 卡顿。

---

## 9. V9.0 之后的主要依赖链

```text
V8 冻结决策 + 实际 SHA/安装版核验
               │
               ▼
V9.0 三条前置流（可在隔离分支并行）
  ├─ CI 反例保留与远端 Gate 修复
  ├─ 冷启动/逐轮性能归因与最小修复
  └─ Three-Mod 工程独立迁移与校验
               │
               ▼
V9.0 合同/基线/文档 Exit Gate
               │
               ▼
V9.1 Source/Build ──► V9.2 JSON/Core ──► V9.3 Provider
                                            │
                                            ▼
V9.4 PromptPlan/Cache ──► V9.5 UI/i18n ──► V9.6 VOCT CK3 Bridge
                                            │
                                            ▼
V9.7 Workshop/Bootstrap ──► V9.8 Legacy Retirement ──► V9.9 RC/Freeze
```

每次提交必须交代：**基线 SHA、受影响代码与数据、修改范围／非范围、验证命令、人工待测项、回滚方法、证据级别**。每个危险入口均有独立正例和负例；不能把“测试脚本执行次数”当作唯一进度指标。

---

## 10. 最终 V9 全阶段完成定义

1. **可重建**：正式源文件在干净环境构建出含完整资源的 Runtime，产物可校验。
2. **可维护**：Conversation、Memory、Provider、Worldline、Bridge、Persistence 的责任和对外 DTO 明确。
3. **可回忆**：Memory4 不泄露没有合法获得的记忆，叙事因果与跨年代的人物关系仍自然。
4. **可恢复**：JSON/Index/Finalization/Letter/RunFile 崩溃可重放或安全停机，不丢数据、不重做未知副作用。
5. **可测量**：启动阶段卡顿和长局 P50/P95 有证据；Remote CI、真实 Provider、CK3、打包 UI 结果各自可追踪。
6. **可调用**：主要 Provider 的正常／错误／流式／结构化能力稳定，缓存诊断可信。
7. **可使用**：中文和英文 UI 不破坏对话 Prompt 语言及主题阅读体验。
8. **可安装**：在平台允许且符合许可的前提下，Workshop 提供单一发行入口；升级/回滚保留用户数据。
9. **边界清晰**：Three-Mod 兼容工程可以独立维护与发版，VOCT 本体没有它也可工作；VOCT 自身 CK3 Bridge 仍被正确管理。
10. **可冻结**：P0/P1 = 0，P2 有明确接受／延期记录，完整 Gate 与发行回退成功。

---

## 11. 证据链接与仍未核验的事项

**本次实际审阅的仓库来源：**

- [当前 HEAD 提交](https://github.com/wsdsb-111/VOCT-NEW/commit/3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4)
- [最新失败的 GitHub Actions 工作流](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38021500350)
- [Release Regression 工作流定义](https://github.com/wsdsb-111/VOCT-NEW/blob/main/.github/workflows/regression.yml)
- [历史版本 QA 脚本](https://github.com/wsdsb-111/VOCT-NEW/blob/main/scripts/test-v8.15.2-letter-archive-independent-qa.js)
- [V8.15.2 旧计时管道退役与实机改善记录](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-letter-timer-retirement-report.md)
- [V8.15.2 日期增量扫描／停机回执修复](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-fix5-implementation-report.md)
- [V8.15.2 空闲 RunFile 轮询与合法空操作](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-idle-run-carrier-report.md)
- [V8.15.2 对话窗口外正式载体消费缺口](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-outbound-bridge-followup-report.md)
- [Three-Mod 1.0.6 同级流官独立功能报告](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-celestial-same-tier-office-report.md)
- [当前测试清单](https://github.com/wsdsb-111/VOCT-NEW/blob/main/scripts/test-manifest.js)

**仍需现场/执行验证：** `V8 冻结 tag 是否存在`、当前本机 VOCT 二进制 SHA 与 HEAD 是否对应、Workshop 文件是否与记录快照相同、用户本次卡顿的具体现场 trace、迁出兼容工程的新仓库与 CI、V9.0 修改后的远端 CI 绿灯。凡未执行均保留 `NOT_VERIFIED`，不以计划文字冒充实际交付。

---

## 附录 A：V9.0 施工文档最低结构

1. 实际 SHA／冻结证据／受影响安装文件版本；
2. 当前生产调用链及阶段计时位置；
3. In Scope / Out of Scope / 安全边界；
4. 性能实验、统计和反例矩阵；
5. 独立兼容工程迁移清单与回退；
6. CI 修复与历史版本基准资产；
7. Behavior Contracts、Data Ownership、Decommission Ledger；
8. 自动化、远端、打包、CK3、Provider 和 Soak Gate；
9. 明确的退出标准、结果文件和下一版移交单。

## 附录 B：与旧路线的关键差异

| 旧路线 | 本次修订 |
|---|---|
| V9.0 仅收集架构与行为基线 | 把启动卡顿归因/必要修复、红 CI 收口、兼容工程剥离纳入 V9.0 硬门槛 |
| 基线 `0c290d8`（修复2） | 最新读到 `3c49364`（修复6），现场需再次核对 |
| Three-Mod 作为不得误删的外部目录保护项 | 明确 **迁出 VOCT 当前仓库**，独立测试/版本/CI，同时不得删除玩家本地安装工程 |
| V9.6/9.7 再整理 Mod 发行 | **V9.0 就解耦兼容项目；V9.6/9.7 仅纳管/分发 VOCT 自身 Bridge Mod** |
| 性能只是一般性 P50/P95 基线 | 加入 CK3 帧、Renderer、Main、Provider 和冷／暖逐轮 trace，防止“关掉循环就好了”的误修 |
| 本地发布检查可引用历史报告 | 新增最新远端 CI 已失败的可复现根因与修复 Gate |

> **路线总结**：V9.0 要先将 V8 的“功能冻结”变成**可执行、可验证、边界清楚且性能有证据的工程基线**，再进入 V9.1 及后续系统重构。此文档不代表任何 V9 工程变更已经实施。

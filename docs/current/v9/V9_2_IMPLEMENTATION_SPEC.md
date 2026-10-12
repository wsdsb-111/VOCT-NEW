# 原文身份说明

> 下方施工规格正文从《v9.2施工文档.md》逐字节复制；本说明是唯一添加内容。原文 Rev.1、日期与“待实施”状态作为设计快照保留。当前代码和验证状态以 [V9.2 实施与验证报告](V9_2_VERIFICATION_REPORT.md) 为准。

---

# VOCT V9.2 阶段设计与开发施工文档

**阶段正式名称：Application Boundary & JSON Repository（应用服务边界与作用域 JSON 持久化）**  
**文档类型：实施规格 / Work Packages / 测试矩阵 / 风险与回滚计划**  
**方案版本：V9.2 Design Rev.1，2026-10-11**  
**目标工程：** [`wsdsb-111/VOCT-NEW`](https://github.com/wsdsb-111/VOCT-NEW)  
**已审查 V9.1 基线：** `main` / `f9c088ff384597fa9e07db248a6cc8c6be68113e`（提交标题误写为 `v9.0`；代码本身为 V9.1）  
**前序 V9.0 SHA：** `c819c85e6912e8531028aa13f0fd87062e36d9d9`  
**V9.1 远端 CI：** [Release Regression #38117263132](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38117263132)，Success（对应 `f9c088f`）  
**V9.1 用户验收：** 2026-10-11 用户反馈“刚刚测试了功能都正常”，记为 `USER_CONFIRMED`；没有提供逐场景日志与帧时间，不代替专项自动化或全矩阵 CK3 测量。  
**施工状态：** **待实施**。本文是下一阶段方案，不代表 V9.2 已修改仓库、已运行测试或已取得任何 PASS。

> **约束优先级：** 仓库中的 `docs/current/v9/V9_ROADMAP.md` 第 **6、7.3、8、9、10 节**是本阶段的唯一版本范围与长期原则基准；其次遵循 `V9_1_ARCHITECTURE_HANDOFF.md`、`V9_DATA_OWNERSHIP_LEDGER.md`、`V9_BASELINE_BEHAVIOR_CONTRACTS.md`。以前两版由助手起草的所谓 V9.1 “Context Core 重构”计划仅作为被否决的跨阶段设计参考，**不是 V9.2 或 V9.1 的实施授权**。

---

## 0. 决策摘要（给实施 Agent）

**一句话目标：** 在 V9.1 确立的 `src/app/` 权威源码及可重复构建基线上，为既有 Conversation、Presence、Memory4、Worldline、Action、Letter 建立渐进式**应用服务端口（Ports）**和**按 Campaign × Owner 隔离的 JSON 持久化访问边界**；强化索引可核验性、来源证明、修订与多文件故障恢复，**绝不重写业务真相、数据格式或已验证的恢复链路**。

**严禁误解为：** V9.2 要彻底重做 Conversation、统一 Prompt ContextPackage、迁移 SQLite、设计全新 Action ACK / Letter 传输 Envelope、拆解 React、替换 Provider，或重构 CK3 Workshop Mod。这些工作由后续对应阶段管辖。

本阶段按风险最小化排序实施：先建立冻结证据与隔离夹具，再打通只读/语义端口，最后用已有权威 Store 增强索引、事务一致性和恢复；未经反例证明，**不得直接删除旧调用路径**。

### 0.1 对照 V9 总路线的合规矩阵

| 总路线要求（第 7.3 节） | V9.2 交付承诺 | 不可越界事项 |
|---|---|---|
| 逐步建立 `ConversationService`、`PresenceService`、`MemoryService`、`WorldlineService`、`ActionService`、`LetterService`、`PersistenceService` | 在现有实现上引入薄接口/Adapter/DTO，业务可逐调用点替换 | 禁止同一版本把旧域模块整体搬迁或全面重写 |
| `readEntry(scope,id)`、`queryCandidates(scope,filter)`、`commitFinalization(batch)`、`forgetSource(scope,proof)`、`recover()` 为**语义 Port 示例** | 按实际代码审计后落地最小接口；样例**不是钉死的签名** | 不伪造未知来源、ACK 或无证据事务结果 |
| 索引先定位候选、再按需读取正文 | 在 Memory4 已有 `INDEX_KEYS` 与 `query()`、`readEntry()` 上做有界优化与性能证明 | 不绕过 Forget、knownBy、Owner 或正文 hash 校验 |
| 修订号、校验和、多文件日志可恢复 | 重用 `memory4-store.js` 和 `memory-store.js` 中现存机制，以故障注入补齐缺口 | 不把单文件 `rename` 宣称为跨多文件原子事务 |
| 旧 Legacy 与官方追忆兼容 | 保留原 Legacy 保守读者、official recollection、Year/Life 来源边界 | 不推断未知 Campaign，不删历史数据或重算叙事事实 |

### 0.2 完成定义

V9.2 的成果是“**责任清楚、端口可测、JSON 读写有 Scope 与索引闭环、故障可安全恢复**”，而不是“文件夹看起来更整洁”。若只是把函数换个目录，没有证明写入权威唯一、认知隔离、故障恢复和索引一致性，则 **不得签发 `V9.2 COMPLETE`**。

---

## 1. V9.1 Review 遗留 P 级问题统计与 V9.2 收口

### 1.1 明确统计：共 3 项

| 编号 | 级别 | 审查发现 | 事实 / 风险区分 | V9.2 处理与完成证据 |
|---|---|---|---|---|
| `REV91-P1-01` | **P1** | `scripts/deploy-runtime-build.js` 按文件部署；断电/强杀可能留下混合版本 | **已证实的设计边界与潜在故障场景；未收到用户发生数据损坏的报告**。普通异常已有备份及回滚；断电不具多文件事务语义。 | V9.2 开工前置安全收口：部署 receipt/进行中标记、预部署一致性检查、故障后重建/恢复流程、注入中断测试；`VOTC.exe` 关闭后部署；不触碰用户数据。 |
| `REV91-P2-01` | **P2** | `scripts/build-runtime.js` 的可配置 `outputDir` 尚未对 `.git/`、`scripts/`、`docs/` 等全部仓库保护域实施最小权限策略 | **防御性加固建议**，不是已证实发生路径覆写；正常 CLI 默认 `.build/runtime` 无此问题。 | 收紧正式 CLI 输出域；测试夹具采用显式隔离根/明确的测试入口；拒绝 `.git`/源码/脚本/文档/依赖等受保护路径、Windows 大小写/链接别名。 |
| `REV91-P2-02` | **P2** | `V9_1_VERIFICATION_REPORT.md` 仍记远端 `CI_PENDING` | **文档状态过期**；实际 `f9c088f` 已在 Actions #38117263132 Success。 | 追加基于具体 SHA 的 `CI_PASS` 和用户实机正常反馈，不覆盖施工时原有 PENDING 历史快照；同时修订 README 的现行状态摘要。 |

**优先级计数：`P0=0`、`P1=1`、`P2=2`，合计 `3` 项。** 上表仅统计**前次 V9.1 Code Review 明确提出的 P 级问题**，不能解释为对所有 VOCT 历史 P 级风险的穷举。V9.2 实施中若发现新的 P0/P1，应另行编号登记，不默默合并到这三个编号。

**收口原则：** P1 部署恢复必须在开始大规模修改核心持久化路径之前处理，属于跨阶段工程护栏；两个 P2 可以与预研/文档同步完成。建议给这三项合计限定为 V9.2 前置工作包，不以此取代总路线第 7.3 节规定的主要内容。**无需以改正 Git 提交标题为由强推重写 `main` 历史。**

### 1.2 上述 3 项逐项具体验收

**P1／部署中断检测：**

1. 程序部署前验明 `src/app` → `.build/runtime` → 当前 `resources/app` 完整 hash。差异只在授权操作中修复。
2. 为“准备 / 正在应用 / 已校验 / 完成或恢复失败”记录持久部署状态（位置限代码部署管理目录，**不是用户数据目录**），记录旧/新 payload hash、受影响路径、备份与阶段；协议须允许重启后识别 `INCOMPLETE`。
3. 在隔离副本注入第 1 个文件后、第 N 个文件后及校验前退出，验证重启部署工具能够**识别**半部署状态，且不会错误报告 PASS。恢复策略先核对旧备份与目标指纹，恢复/重建必须可审计；未知或缺少备份时拒绝继续自动覆盖。
4. 用户记忆、Legacy、`pending-letters.json`、`run-command-queue.json`、CK3 存档完全不参与部署事务。
5. 标准 CLI 成功路径不增加运行期常驻循环；任何部署日志不得携带 Token、Prompt 或用户内容。

**P2／输出路径保护：**

1. 提前列出真实受保护目录（至少 `.git/`、`src/`、`resources/`、`scripts/`、`docs/`、`build/`、用户数据/安装资源），并按 Win32 真实路径与链接路径验证。
2. 为正式 CLI 限定明确的 `.build/runtime`；自定义 `rootDir/outputDir` 仅服务隔离 fixture，避免把独立 QA 一并锁死。
3. 添加入侵性路径的负面测试（仓库根、目录本身、子目录、大小写变体、junction、symlink、`..`、保留名称）。**需要真实可写隔离环境，不能在用户工作区尝试有风险的破坏性负例。**

**P2／文档：** 追加如下证据而不是抹去历史：

```
V9.1 post-push supplement — 2026-10-11
HEAD: f9c088ff384597fa9e07db248a6cc8c6be68113e
CI: https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38117263132 — Success
Live: USER_CONFIRMED（用户反馈功能正常；缺少具体场景和测量日志）
Git commit subject: v9.0（历史标题误写；V9.1 代码内部版本正确）
```

---

## 2. 实际代码审阅与施工边界

### 2.1 不是新设计推测的实际代码事实

本次审阅了 `f9c088f` 代码及 V9.1 移交报告，确认：

- **正式源码输入**在 `src/app/`；CI 使用 Node 22、完整 checkout 与 LFS，先执行 `scripts/runtime-dependencies.js`、`build-runtime.js`、`verify-runtime-build.js`、`deploy-runtime-build.js`，再运行 `scripts/test-release.js`；V9.1 远端已绿。
- **现有对话入口**为 `src/app/main/conversation/conversation.js`（约 2,300 行）以及 `conversation-manager.js`、`conversation-runtime.js`、`conversation-turn-manager.js` 等；包含初始化、Presence、Memory、Worldline 调用。V9.2 优先逐入口包装，而非一次删除大文件。
- **现有 Memory4**：`memory4-store.js` 的 `loadIndex(scope)` 检查 `metadata.indexHash === hash(index)`、修订与 Scope；`query(scope, filters)` 已按索引筛选 ID，但会加载所有选中正文并验证 hash、Forget；`readEntry(scope,id)` 又做 `revision/deleted/bodyHash` 校验。V9.2 应**复用**，不能先创建一套并行 Index/Store。
- **索引现状**含 `byCampaign/byOwner/byEntity/byTopic/byEventYear/byEventDate/byConversationYear/byAcquiredYear/byCounterpart/byMemoryType/byState/bySourceFinalization`，各项是已经存在的索引轴；新增 Candidate-only 查询必须有明确的**只返回 ID/投影、不泄露正文**语义。
- **已有多文件回滚**：`memory-store.js` 的 `withSummaryMutation()`、`summary-mutation.json`、`trackSummaryMutation()`、`restoreSummaryMutation()` 提供以旧文件快照为基础的事务回退。它不是一个覆盖 VOCT 全部文件系统/RunFile/Letter 的通用 ACID 数据库；V9.2 是证明覆盖边界、故障注入及有据补齐，而非推倒重写。
- **已有人工遗忘安全逻辑**：`memory4-orphan-audit.js` 将来源不足的情况标为 `UNKNOWN`，`forget()` 要求 `confirmed` 与最新 `auditToken`；新审计不得让 `UNKNOWN` 自动变成可删证据。
- **Legacy 仍有不同查询路径**：`memory-store.js` 的 `queryMemories()` 会遍历 `this.index.memories` 载入条目并在有 Owner 时校验 `knownBy`；本阶段可以做非语义性的候选定位改良，但不能将 Legacy 的不确定归属假定为当前 Campaign。
- **Worldline 持久态**：`historical-system/worldline-store.js` 校验持久 Campaign 身份/来源 token 指纹，用临时文件、`fsync` 和 `rename` 保存；所存 `mode=shadow`，不产生 CK3 游戏权威写入。
- **Action、Letter 是独立安全状态机**：`actions/run-file-manager.js` 有 FIFO、awaiting ACK、STALLED 等恢复；`letters/letter-manager.js` 有 pending v4、DATE/回执与一次归档。V9.2 的 PersistenceService **不能合并其确认含义，也不能默认接管其全部文件操作**。

### 2.2 计划中的路径（不是已存在文件）

下面路径为**建议**，实际以仓库既有 CommonJS 模块与构建清单为准，允许采用等效命名，但必须文档化：

```text
src/app/main/
  application/                # [NEW, proposed] 薄应用端口与组装
    service-ports.js          # Service factory + 契约校验
    conversation-service.js
    presence-service.js
    memory-service.js
    worldline-service.js
    action-service.js
    letter-service.js
    persistence-service.js
  persistence/                # [NEW, proposed] scoped JSON repository 适配层
    scoped-json-repository.js
    index-candidate-reader.js
    integrity-audit.js
    recovery-orchestrator.js

  conversation/...            # [KEEP] 既有业务与会话生命周期
  memory-system/...           # [KEEP] Memory4 真实权威及现存事务
  worldline/...               # [KEEP] 已有事实与时点规则
  historical-system/...       # [KEEP] 旧时点/持久世界线读者
  actions/...                 # [KEEP] Official Action/RunFile 现有职责
  letters/...                 # [KEEP] Letter/DATE/Receipt 现有职责

scripts/test-v9.2-*.js       # [NEW] 独立测试及反例
scripts/test-manifest.js    # [UPDATE] 将新验证组纳入 releaseChecks
build/runtime-inputs.json  # [UPDATE] 每个新增源文件必须显式映射
resources/app/out/...       # [GENERATED] 不能手工改这里代替 src
```

**注意：** “Seven Services”代表职责明确、可注入与可测的**七个语义边界**，不是要求七个互不关联的新持久化数据库，也不是把所有现有业务逻辑搬进七个空心壳。`main.js` 仍是组合根；既有 IPC channel 名、Preload API 与用户可见行为保持。

---

## 3. 任务分解、优先级与先后约束

| 工作包 | 优先级 | 内容 | 前置 | 交付证据 |
|---|---|---|---|---|
| `WP-00` | P0/基础 | V9.1 冻结、数据备份、合同映射、当前 CI/版本证据 | 无 | Baseline manifest、实际用户数据的**私有**备份/哈希、原始 Gate |
| `WP-01` | P1/P2 | 收口上述 V9.1 Review 三项遗留风险 | WP-00 | 独立安全反例 + 新 CI/文档状态 |
| `WP-02` | P1 | 七个服务边界、DTO、依赖方向与最小接线 | WP-00；WP-01 安全护栏 | 结构图、端口合同、单入口迁移证据 |
| `WP-03` | P0 | Scoped JSON Repository 与 Authority Ledger | WP-02 的 Scope 定义 | Owner/Campaign、单写入权威、拒绝越权反例 |
| `WP-04` | P1 | Index-first candidate 查询、版本/校验和闭环 | WP-03 | 与旧路径等价的候选/召回/权限及性能对照 |
| `WP-05` | P0 | 多文件事务恢复和故障注入 | WP-03、WP-04 | Journal、重放/回滚、重复启动幂等反例 |
| `WP-06` | P1 | 只读 Integrity Audit + Legacy/Official 兼容 | WP-03—05 | 有界报告、零自动删除、旧数据兼容样本 |
| `WP-07` | P1 | Strangler 小步迁移、长期可维护的测试/文档 | WP-02—06 | 正式源构建、413 原有发布组 + 新专项全绿 |
| `WP-08` | Gate | 打包、CK3、Provider、Soak 采样与冻结 | WP-00—07 | 分级证据、未完成项记录、下阶段交接 |

**并行性：** WP-02 的纯接口调研、WP-06 的只读报告设计可并行；任何真实用户数据写入调整必须等到 WP-00 完成冻结与可恢复备份。P0/P1 失败不得以跳过旧测试继续推进。

---

## 4. WP-00：基线冻结、保全与权限地图

### 4.1 开工状态核验

在 VOCT 工程根目录（Windows PowerShell）：

```powershell
# 一切写操作前，先核对当前本地状态
 git status --short
 git branch --show-current
 git rev-parse HEAD
 git log -3 --oneline
 git lfs ls-files
 node --version
 node scripts/runtime-dependencies.js
 node scripts/build-runtime.js
 node scripts/verify-runtime-build.js
 node scripts/verify-runtime-build.js --deployed
 node scripts/test-release.js
 git diff --check
```

预期起点 `f9c088f`；若开工时 HEAD 已变化，以新的真实 SHA 重新记录和审核差异，不在本文假装最新 SHA 永远不变。**上述 `--deployed` 若因生成资源尚未同步而失败，应先解释差异，在闭合 VOTC 后运行有备份的部署流程；不得直接覆盖用户配置。**

### 4.2 快照和私有样本

- 保存 `src/app`、`build/`、原 V9.1 运行资源和 V9.1 构建 manifest 的指纹；保留原始 CK3 Bridge 七份已知关键文件及安装版本；不改 Workshop 自身代码。
- 对用户实际 Memory4、Legacy、Worldline、pending Letter、RunCommand/ACK、设置、Prompt 等**仅做原路径外的私有备份和哈希清单**；密钥、聊天正文、存档不提交 GitHub。
- 建立脱敏**复制**的测试样本：单 Owner、跨 Owner、跨 Campaign、具有 Forget/Tombstone、Legacy 歧义、真实 Pending/ACK（隐去原文）、部分损坏 JSON、已提交/中断多文件突变。
- 设置两份对照：① 原 V9.1 行为基线；② 新 V9.2 路径。任何差异明确为“预期结构行为变化”或“未授权回归”。

### 4.3 写入所有权清单

以仓库 `V9_DATA_OWNERSHIP_LEDGER.md` 为原表，增加字段：`logicalKey` / `canonicalOwner` / `writer` / `scope` / `schemaVersion` / `revision` / `hash` / `indexType` / `recoveryAuthority` / `legacyReader` / `cleanupPolicy` / `proof`。最小记录以下家族：

| 数据家族 | 唯一写入权威 | V9.2 原则 |
|---|---|---|
| Memory4 entry、index、metadata、known-entities | `Memory4Store` / `Memory4Coordinator` 现有调用链 | Repository 必须委托既有验证与写入，不另开平行 JSON 正本 |
| Legacy summary、Episode、Memory、Knowledge | `MemoryStore`、`SummariesManager` | 旧读者兼容；未知 Campaign 不能凭文件夹名自动绑定 |
| Year/Life 派生 | `memory4-derived.js` | sourceRevision 权威，脏派生只作为受控可重建视图 |
| Finalization / 恢复快照 | 现有 Finalization/Memory 服务 | 保持来源证据和幂等边界，不能跨 Owner 混合提交 |
| Worldline checkpoint/archive | `WorldlineService` / `WorldlineStore` | 只读投影与持久事实分离；不改变 CK3 当前状态 |
| `pending-letters.json` | `LetterManager` | 保留版本 4、Effect ACK 与收信证明分别确认 |
| RunFile 队列/ACK | `RunFileManager` | 原协议及 STALLED 不重发，非 V9.2 通用事务的默认成员 |
| 用户配置/Provider Key/Prompt | 原 Config/Secrets/Prompt 服务 | 禁止通用扫描器读取 Key 或改写定制 Prompt |

---

## 5. WP-02：Application Service Ports（薄边界）

### 5.1 边界划分及最小职责

| Service | 可提供的服务行为（候选，按现存调用验证） | 禁止的越权 |
|---|---|---|
| `ConversationService` | 创建/结束对话、轮次编排、终局协调；委托现有 Conversation/Manager | 不在服务外擅自跳过 Presence/Forget 或直接修改 Memory JSON |
| `PresenceService` | 当前合法在场参与者、时间窗口、直接观察凭证只读快照 | 不凭人物列表推断听见/知道，离场后不新增观察 |
| `MemoryService` | `Scope` 解析、授权召回、Forget/Disclosure 的既有命令委托、Legacy 保守读取 | 不对未授权 entry 返回裸正文，不旁路 Tombstone |
| `WorldlineService` | 当前游戏事实/时点历史的带 provenance 查询 | 不把历史假设写回 CK3 或抹掉 source/time 分界 |
| `ActionService` | Official Action 状态/请求的现有业务入口包装 | 不把 RunFile ACK 等同游戏效果 CONFIRMED，不重放未知副作用 |
| `LetterService` | 待发/已发/已收/待归档的受证据状态，日期只读投影 | 不将 effect 接收与最终收信/记忆归档合并成布尔成功 |
| `PersistenceService` | scoped 存储入口、索引/修订、只读审计、已有恢复协调 | 不越权接管 RunFile/Letter 已有业务确认链路 |

**依赖流向：** `Electron/IPC → Application Port → 已有业务服务/Domain Validator → Store/Repository → 文件系统`。不能让持久层 `require('electron')`、API Provider 或 Renderer；组合根负责构造/注入必要现存实例。

### 5.2 语义 DTO 草案（开发者须对照真实调用后冻结）

```js
// 仅为设计级别伪接口：最终命名/错误语义要从实际旧代码证明，不是强制签名。
const scopedContext = {
  campaignToken: "<validated-existing-campaign-token>",
  ownerId: 1001,
  // 可选：conversation epoch / provenance / expectedRevision
};

// 只读安全视图，不暴露文件路径/原始未授权内容
memoryService.queryAuthorized(scope, predicate);
worldlineService.queryAsOf(scope, temporalQuery);
presenceService.snapshot(conversationId, boundary);

// 持久化 Port，优先复用现有 Memory4Store/MemoryStore
persistenceService.readEntry(scope, id);
persistenceService.queryCandidates(scope, filter);
persistenceService.commitFinalization(validatedBatch);
persistenceService.forgetSource(scope, verifiedProof);
persistenceService.recover();
```

实现要求：DTO **先校验** Campaign、Owner、时间、证据、期望 revision，不在验证失败时回退到 global/all。跨 `Owner` 要求分别授权，不能因为多人对话就调用一个“联合读入”绕过认知分割。`readEntry` 的内部返回与暴露给应用层的 DTO 不一定一致：对外更小、对内可保留必要校验字段。

### 5.3 Strangler 迁移手法

对每个服务按如下固定序列：

1. 抓取 V9.1 旧路径签名、调用者、错误、side effects、性能采样；保存行为 fixture。
2. 新端口默认**委托原服务**，先不变更数据格式/文件路径。
3. 以 feature gate 或低风险单入口替换一个调用点；验证所有原旧路径测试仍过。
4. 比对成功、失败、取消、重启、跨 Owner 情形；**同一业务事件只能有一个写入路径**。
5. 迁移下一个调用点；不在 V9.2 删除仍有恢复价值或未覆盖的 Legacy reader。
6. 若新服务只是增加无意义转发层且无法提供可测合同，停止该抽取并登记原因，避免名词架构膨胀。

---

## 6. WP-03：Scoped JSON Repository / Authority / Schema

### 6.1 Scope 不变量（P0）

`Scope = Campaign × Owner` 是授权最小单位，但并非 VOCT 所有文件都天然具有此二维键（如独立 RunFile、世界线状态、应用设置）。Repository **按数据域**选择合法 Scope，而不是把所有旧文件强行改名后分目录。Memory4 必须沿用 `assertScope`、`assertPersistedScope` / 现存持久身份检查与 Source Provenance。

- Campaign 未证明/Owner 为空/Owner 不是合法角色时：`DENIED / UNKNOWN_SCOPE`，不可扫全盘“猜最近一个存档”。
- Legacy 内容缺明确 Campaign：只沿现有兼容阅读策略呈现其合法部分；不能作为已证明事实写入当前 Campaign。
- 不允许缓存跨 Campaign/Owner 复用；读权限过滤必须在返回文本和 Prompt 前完成。
- 路径只来自受控根及规范化映射，不接受由用户可控 ID 拼接任意路径；显式拒绝 traversal、symlink/junction、重复 owner 文件夹歧义。

### 6.2 Single Source of Truth 设计

V9.2 新增的 `ScopedJsonRepository` 是**适配/协调层**，不是“重新复制一份 Memory4 JSON”。建议：

- `Memory4Store` 保持 `entries/index/metadata/known-entities/forgotten projections` 的已存在有效写入链；Repository 注入该实例并使用它的验证器。
- `MemoryStore` 继续持有 Legacy/episode/summary mutation 原有根，不能新建一个自定义 `memory.json` 总表。
- `WorldlineStore` 继续管理已验证 campaign identity、schema 与文件边界。
- `Finalization` 只通过既有协调器提交业务事务，不将跨 File 事务直接转换为一个未审核的原子 rename。
- 不建立 JSON/SQL 双写或统一到 SQLite；不把 `index.json` 当成永远权威的正文；**索引为可验证派生定位，entry/来源记录与 tombstone/forget 撤销优先**。

### 6.3 新增责任映射（代码评审须填写）

| Port 或能力 | 委托的既有实体 | 权威类型 | 主要异常 |
|---|---|---|---|
| `readEntry(scope,id)` | `Memory4Store.readEntry` / `Memory4Contract` | authoritative body+revision/hash | Missing, stale, corrupted, forgotten, wrong-scope |
| `queryCandidates(scope,filter)` | `Memory4Store.loadIndex` / `INDEX_KEYS` | derived index only | missing index、invalid axis、indexHash mismatch |
| `commitFinalization(batch)` | `FinalizationCoordinator` + `MemoryStore.withSummaryMutation` + coordinator | 已证实来源的事务提交 | interrupted, duplicate, stale revision, conflict |
| `forgetSource(scope,proof)` | Memory4 Forget/Projection + 已有撤销链 | durable tombstone/proof | no proof, stale proof, wrong owner, in-flight |
| `recover()` | `MemoryStore.restoreSummaryMutation`、现有 Memory4 recovery | scoped journal & snapshot | pending journal, unknown commit, corrupted recovery |
| `integrityAudit(scope)` | `Memory4Store` validators + `Memory4OrphanAudit` | read-only diagnosis | unknown lineage, mismatched index, unsafe path |

**提醒：** 上述 `commitFinalization` 等名称来自路线的语义 Port 提示，实施前必须列出已有 Finalization 的实际阶段与落盘点；不能假设一个函数调用覆盖 Letter、Action 及 CK3 副作用。

---

## 7. WP-04：索引先定位候选 / 惰性正文 / 一致性

### 7.1 当前实现及改进点

当前 `Memory4Store.query(scope, filters)` 先交集筛选 `index.byOwner` 及所选 `INDEX_KEYS`，再为所有匹配 ID 打开 JSON 正文、验证 bodyHash、应用 forgotten projection 过滤。这**已经具备索引前置**，V9.2 的改进是将候选查询与授权正文读取拆成清晰的 Port，以支持上层仅在需要时读取，而不是重建索引算法。

目标流程：

```text
validated Scope + filters
    ↓
loadIndex (verify metadata revision/indexHash)
    ↓
index candidate IDs (no raw text)
    ↓
owner / campaign / rev / visibility proof checks
    ↓
request bounded bodies as needed (readEntry + current tombstone/forget validation)
    ↓
authorized memory DTO / existing ranker / original narrative order
```

索引候选不可在缓存或异步批次跨 Scope/Revision 复用；**每次正式输出必须再次按现有 Store 的权限规则核验**，防止 TOCTOU 中旧 index 指向被忘来源。

### 7.2 索引一致性与性能标准

- 完整性：`indexHash`、`metadata.revision`、entry `bodyHash`、`entry.revision`、`deleted`、`campaignToken/ownerId` 必须互相符合；缺失/损坏时 fail-closed。
- 候选：保持当前全部实际 index 轴（包括 EventDate range 的特殊包含规则）；空候选时不得读取正文；排序规则如有使用，必须与旧路径对照。
- 效能：对同一复制 fixture 比较候选数、实际正文读盘数、总 wall time、Memory4 recall 结果 hash；应在有效过滤条件下证明正文读取数量**不高于旧实现**，不是凭空宣称提升百分比。
- 并发：索引变更期间 reader 要看到一致修订；stale candidate 必须重新取证/重试有界次或返回 `STALE`，不能隐式退回全局扫描。
- 变更 Scope、Forget、用户手改、纪年、人物参与者及 Legacy 回退时，保持现有排序与合法源约束。

### 7.3 索引损坏或缺失

当前 `loadIndex()` 对 index 丢失而 metadata/entries 存在时抛 `memory4_index_missing_rebuild_required`。V9.2 **首先应保留这一 fail-closed 行为**。是否加入显式修复命令取决于是否能从完整合法正文与当前 tombstone/projection forget 证明全部索引轴；不能“一扫所有 JSON 就自动恢复”，更不能修改 authoritative entry。无法证明完整性时输出 `REBUILD_BLOCKED` 与损坏明细（不含用户正文），保留现场备份，停止该 Owner 的不安全召回。

---

## 8. WP-05：多文件提交、恢复与幂等（最高风险核心）

### 8.1 先承认现存恢复能力

`MemoryStore.withSummaryMutation()` 会在受控根内建立 `summary-mutation.json` 旧值日志，跟踪写入前内容；异常时回滚，启动恢复由现有路径处理。新的 PersistenceService **优先对现有事务链加验证与故障注入**，不要写第二份 journal 并且试图同时完成相同职责。

### 8.2 有状态机证据的事务合同

设计审查时必须画出实际 `Finalization` 写入点与持久事件源，至少区分：

```text
PREPARED (validated Scope, immutable proof, pending journal)
   ├── abort before writes → no effects
   ↓
WRITING (journal captures all affected owned paths)
   ├── crash/error → recover old coherent state OR return BLOCKED
   ↓
COMMITTED (entries, metadata, index and durable source agree)
   ↓
RECOVERY_CLEARABLE (verified durable state; safe journal retirement)
```

这只是**需要证明的语义状态**，不要求替换当前 journal schema，也不能提前声称现存系统已使用这些名称。对现有正常持久写入不能为了新状态机增加双次写入或不必要的独立队列。

### 8.3 故障注入矩阵（隔离副本）

| 注入点 | 必须证明 |
|---|---|
| 还未写任何文件便中断 | 重启与首次数据完全一致，不产生幽灵 entry |
| 已写正文未写索引 | 启动先恢复或隔离，读者不得看到孤儿正文为合法事实 |
| 已写索引未写 metadata | 不可产生 `hash` 匹配假象，原索引/metadata 可证明恢复 |
| 已写 metadata 未清 journal | 重启恢复流程幂等，不能将已遗忘源复活 |
| 同 `finalizationId` 重复进入 | 不重复原始记忆、派生摘要、已确认收信归档 |
| `expectedRevision` 过期 / 并发手工编辑 | 明确拒绝覆盖较新的用户编辑，记录冲突原因码 |
| 磁盘满/JSON 截断/权限拒绝/目录链接 | 原唯一数据保留或拒绝访问，禁止自动“初始化一个空档”覆盖 |
| 撤销/Forget 与读入并发 | 新输出必须遵循 tombstone/撤销优先，不基于缓存旧快照泄露 |
| Owner 或 Campaign 在中途改变 | 当前事务不移交到另一 Scope，不写入错误人物 |
| 状态未知的 CK3 Action / Letter receipt | 只报告 `UNKNOWN/STALLED`，不视为可通用事务重放 |

**P0 阻断：** 任一注入路径出现跨 Owner 信息、遗忘复活、原始数据损坏、重复 Effect 或错误收信确认时，立即回退该迁移，保留现场样本用于修复。

### 8.4 恢复必须遵守的上限

- 单实例主进程内统一协调；不以 `rename` 充当跨多文件数据库锁。
- 按 Scope/FinalizationId 及来源指纹做幂等，冲突不凭时间戳“最后写入获胜”。
- 旧 Legacy episode、source hash、用户手改、Year/Life 派生的提交顺序不破坏；可重建视图只能在原始可核对来源合法时再生成。
- 严禁采用“异常就删 journal／删损坏 entry／清空 index／重跑模型生成摘要”的快捷恢复。
- V9.2 仅处理**本项目本阶段已审计的 JSON 域恢复**；Bridge 协议及 Action/Letter 本体传输的重设计由 V9.6 执行。

---

## 9. WP-06：Read-only Integrity Audit、Legacy 与官方追忆

### 9.1 安全审计输出

加入可选的**只读**完整性报告，不触发数据修复、清理或 Provider 请求：

```json
{
  "schemaVersion": 1,
  "scopeLabel": "ANONYMIZED",
  "result": "OK | DEGRADED | BLOCKED",
  "counts": {
    "entriesExamined": 0,
    "hashMismatch": 0,
    "staleIndex": 0,
    "forgottenCandidate": 0,
    "ambiguousLegacySource": 0,
    "unresolvedFinalization": 0
  },
  "reasonCodes": []
}
```

以上 JSON **仅为提议的脱敏展示样本**，不是现有 API，也不要求固定字段；禁止把原始 Campaign Token、Owner ID、对话文本、Prompt、源路径、API Secret 填进报告。审计依据必须来自现存 `Memory4Store`、`memory4-contract.js`、`memory4-orphan-audit.js`，不复制一遍弱化的判断规则。

### 9.2 Legacy / Official 合同

- 现存 Legacy 摘要、Episodes、已保存的用户编辑、Source Provenance、Year/Life 派生以及 CK3 官方追忆仍按原读者与许可门禁被消费。
- 官方追忆不是由模型新生成的普通叙事记忆；保留获取来源和时点，不能被 JSON 归一化误写入 Memory4 主 entry。
- 不可从某个文件存在或字符名匹配推断已有合法 `Campaign` 或当前 `Owner` 权限。
- 若新 Repository 不支持某一历史数据形态，保留旧 reader Adapter 和 `UNKNOWN/UNSUPPORTED`，不强行转换用户唯一数据。
- `Memory4OrphanAudit` 的 `UNKNOWN` 与 proof 要求不可降级，手工 Forgot/删除只经现存合法授权与最新审计 token。

---

## 10. WP-07：施工提交粒度、构建部署与验证

### 10.1 建议拆分 7 个可回滚提交（可进一步拆小）

| 提交/PR | 内容 | 单独验收 | 禁止夹带 |
|---|---|---|---|
| `v9.2-01-baseline` | V9.1 报告补记、风险登记、数据备份状态、测试映射 | 状态记录精确 SHA；不触及用户数据 | 业务重写 |
| `v9.2-02-build-guard` | REV91-P1/P2 工具链边界加固 | 中断、路径入侵反例；原 V9.1 QA 绿 | 修改运行期 Memory/Worldline |
| `v9.2-03-ports` | 七域 service port 最小可测边界；先只读再迁业务入口 | 旧 API/IPC 兼容、一个入口替换对照 | 全量 Context Core/Prompt 重构 |
| `v9.2-04-scoped-json` | Scope/Authority/DTO + 现有 Store 委托 | 跨战役/Owner/失效 Scope 全负例 | 新 JSON 正本、双写 |
| `v9.2-05-index-read` | Index candidate 查询与延迟正文读取 | 正文 hash 一致，候选计数，Forget 实时撤销 | 换索引 schema 或重排召回排名 |
| `v9.2-06-recovery-audit` | 现有 journal 故障注入、无损恢复与只读审计 | 断点/重启/手改/Legacy/官方追忆反例 | 自动清理损坏条目 |
| `v9.2-07-verification` | 重构前后全回归、打包/实机、文件指纹、交接 V9.3 | 最新 SHA CI/现场分级 Gate | V9.3 Provider 统一等后续功能 |

**每个提交必须说明：** Base SHA、修改文件、Scope/数据影响、测试命令和结果、性能读盘变化、真实游戏待测、回滚 SHA 与备份证据。若 P0 异常发生，停止合并。

### 10.2 标准构建与发布门禁

仅编辑 `src/app/`；每加源文件同步 `build/runtime-inputs.json`。生成资源不得手工改作为权威。每次提交（CI 与本地）至少跑：

```powershell
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
# 保证 VOTC 已关闭，并在受保护/可恢复的开发副本部署
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
```

加上 `scripts/test-v9.2-*.js` 独立测试和 CI `releaseChecks`。V9.1 报告的 413 组为**历史基数**，V9.2 改动后以实际 manifest / 完整测试结果填新数，不能事先写成固定数量。CI 必须保留 Node22、LFS、历史负例，且针对**最终合并 SHA**确认 Success。

### 10.3 典型完整合同测试（最小必测矩阵）

| ID | 场景 | 必须保留或取得的结果 |
|---|---|---|
| `T-SCOPE-01` | Campaign A/Owner 甲写入，Campaign B/甲读取 | B 不可读到 A 的私有来源，不能隐式回退 |
| `T-SCOPE-02` | 同战役甲、乙交错发言并读取 | 未披露的甲记忆对乙不可见 |
| `T-SCOPE-03` | Presence 离开/昏迷/返回 | 未在场期间不产生合法观察证据 |
| `T-SCOPE-04` | Direct Observation 合法/非法特质 | 不可观察的私密特质不会进入返回 DTO |
| `T-FORGET-01` | Forget 后热读取/重启/索引重建 | tombstone 始终优先，来源永不复活 |
| `T-FORGET-02` | Forget 与并发旧候选 | 强制重新验证权限，不把旧正文送上层 |
| `T-INDEX-01` | 有界 Entity/Topic/Time 候选 | 与基线合法记忆集合及顺序对照一致 |
| `T-INDEX-02` | Index/metadata/body hash 不匹配 | 明确 BLOCKED，不接受部分损坏为可信正文 |
| `T-INDEX-03` | 缺 index 但留 entry | 保持 `memory4_index_missing_rebuild_required` / 拒绝无证据恢复 |
| `T-REV-01` | 修改 entry 后旧修订再提交 | CAS/期望 revision 冲突；手改不丢 |
| `T-REC-01` | 写正文后进程终止 | 安全恢复/拒绝读取，没有幽灵记忆 |
| `T-REC-02` | 写 index 或 metadata 中断 | 无半提交读出，无数据覆盖 |
| `T-REC-03` | 重启恢复执行两次 | 幂等，最终字节/授权输出等价 |
| `T-REC-04` | finalization 重复交付 | 不重复 Memory/Year/Life 或 Letter 归档 |
| `T-LEGACY-01` | 无有效 Campaign 绑定的旧摘要 | 不猜 Scope；合法旧回退仍可用 |
| `T-OFFICIAL-01` | CK3 官方追忆读取 | provenance/日期仍准确，不变成模型写入来源 |
| `T-WORLD-01` | 历史时点与 Current Truth 冲突 | 保持原时点优先级/不改变 CK3 状态 |
| `T-ACTION-01` | Awaiting ACK / STALLED / 未知 Effect | 不能重复投递、不能判为 CONFIRMED |
| `T-LETTER-01` | Effect ACK 与收信回执分离 | 一次收信一次归档，重启不重复 |
| `T-IPC-01` | 现有 Renderer/Preload/IPC 调用 | 通道名、错误、异步状态对外不破坏 |
| `T-BUILD-01` | 源码/依赖/manifest 被篡改 | 生成/部署/验收拒绝不一致 |
| `T-BUILD-02` | 半部署/非法 outputDir | 明确失败与可验证恢复；不动用户资料 |

必须保持 `V9_BASELINE_BEHAVIOR_CONTRACTS.md` 中 B-MEM-01~05、B-WORLD-01、B-ACT-01、B-LETTER-01、B-PROMPT-01、B-UI-01、B-PERF-01、B-MOD-01 等既有发布组运行；新测试不取代旧负例。为每个 T-ID 建立测试文件/夹具/SHA/正例/负例/结果的 manifest。

### 10.4 性能度量（不立未经测量的百分比目标）

在同机同复制数据上对 V9.1/V9.2 记录 Memory4 候选索引次数、条目打开数量、加载字节、热/冷查询的 P50/P95、启动/Main/Renderer 的可观测阶段。对时间维度明示是否 CK3 游戏帧、Electron Main span 或 Provider 网络首 token；不可混用或夸大。收益必须与信息权限一致性同时 PASS，**不能以跳过校验换读盘减少**。

---

## 11. WP-08：V9.2 正式 Exit Gate、风险升级与回滚

### 11.1 Go / HOLD 判定

| Gate | 必须满足 | 可用于证明的证据 |
|---|---|---|
| `G0` 基线 | V9.1 freeze/备份与用户数据保全清单有效 | 真实 SHA、hash、私有备份可读取检查 |
| `G1` 三个旧 Review P 项 | P1 已用中断/半部署实证收口；P2 有负例与状态补记 | 工具脚本、隔离故障测试、更新文档 |
| `G2` 七个服务边界 | 与旧行为等价的端口/DTO/注入点，单一业务写入者 | 调用图、服务合同、交接测试 |
| `G3` Scoped JSON | Campaign/Owner 隔离、无任意文件路径、无第二套正本 | T-SCOPE/T-FORGET/T-REV 正反例 |
| `G4` Index Integrity | 候选先定位，正文懒读取但不泄密；缺损拒绝或合法重建 | T-INDEX/审计报告与旧版对照 |
| `G5` 故障恢复 | 多文件中断/重启/重复交付不丢不重不复活 | T-REC 全部通过、journal 证据 |
| `G6` Legacy/Official | 旧读者、用户手改与官方追忆无损 | T-LEGACY/T-OFFICIAL/原 B-MEM |
| `G7` 远端/打包 | CI 对最终 SHA `Success`；VOTC.exe 与目标产物 hash 匹配 | Windows Actions、脚本退出码、打包冒烟 |
| `G8` 实机 | CK3 旧档/新档、多人会话、记忆/遗忘、Action、Letter 至少基本冒烟；真实 Provider 按其范围记录 | USER_CONFIRMED + 场景/版本/Mod 组合；未测明确标注 |

**不允许在 `CI_PASS` 后自动推断 `CK3_LIVE_PASS`、`PROVIDER_LIVE_PASS` 或 `SOAK_PASS`。** 如用户仅回复“功能正常”，登记 `USER_CONFIRMED`，不要虚构逐案例截图、Token 统计或压力测试。

### 11.2 升级规则

- **P0（立即阻断）**：Scope 串档、Forget 复活、唯一用户数据损坏、错误确认或重复 CK3 Effect、信件错误归档。停止所有写入迁移，备份现场，回退受影响源码/Port，保证原 Store 可读。
- **P1（不能关闭 V9.2）**：跨文件恢复不确定且不能检测、CI 指定 SHA 失败、无备份即改生产数据、服务端口产生已知业务回归、V9.1 遗留 P1 部署保护仍开口。
- **P2（需记录 Owner 与后续版本）**：非生产文档/测试迁移遗漏、未使用的接口模板、UI 内容小偏差；对 V9.2 的 P2 若实际可能导致失忆/越权应上调 P0。

### 11.3 回滚

1. 停止运行中的 VOTC 和会触碰目标 JSON 的施工工具；记录当前 SHA 与私有用户数据指纹。
2. 新 Port/Adapter 以最小提交回滚并通过 **V9.1 的构建/部署/校验流程**恢复既有运行资源；不能只把老 `resources/app/out` 粘贴覆盖新 `src/app`。
3. 已有用户数据由**当前权威原 Store**读取；若 journal 存在则使用经过验证的旧恢复链路，禁止把旧整目录备份直接覆盖新发生的合法记忆、Letter/ACK 或 Tombstone。
4. 新增只读索引/审计缓存可重建，但不能删除已确认的原始记忆、来源证据、用户编辑或 pending 队列。
5. 重新跑原发布门禁及目标出错的专项负例，再做实机最小确认。

---

## 12. 明确不属于 V9.2 的工作（避免再偏离总路线）

| 内容 | 应属阶段 | V9.2 允许的动作 |
|---|---|---|
| 重新统一多家 Provider 的 capabilities、响应归一化、流式/结构化 | **V9.3** | 保持适配器合同，通过旧 Provider 测试 |
| 重排 Prompt Stable Blocks、PromptPlan、各厂商 Serializer / Cache Hit 重定义 | **V9.4** | 只保证 authorized memory DTO，不改 Prompt 字节/块键 |
| React 组件源码恢复、UI 框架治理、英文国际化 | **V9.5** | 保持原三主题/IPC/语言行为，必要诊断仅走现有接口 |
| 正式 VOCT CK3 Mod 源码全量纳管、Bridge 握手协议、能力版本 | **V9.6** | 保留 `compatibility-patches/v8.15.2-letter-runner/` 与现有原生通信 |
| Workshop 桌面 Runtime 统一分发、安装器/下载/自更新方案 | **V9.7** | 只让源码构建可靠，不提交 Workshop EXE payload |
| 系统性 Legacy 代码/测试退役 | **V9.8** | 只移除已有调用证明完全替代且不涉及恢复功能的小路径 |
| 完整长局 2 小时/100+ 回合、全面发行冻结 | **V9.9** | 做 V9.2 所需场景验证并保留待测矩阵 |
| Memory5、SQLite、JSON/SQL 双写、NPC 新玩法、Three-Mod 回迁 | **不在当前 V9 总路线授权范围** | 禁止 |

特别说明：**旧版 V9.1“Context Core 重构”方案提到的统一 `ContextPackage`、全面 Prompt Token 优化、CK3 Bridge 通用 ACK Envelope，不能因为它被复制到仓库 `V9_1_REVIEWED_PROPOSAL.md` 就在 V9.2 全部实现。** V9.2 只执行总路线第 7.3 节的渐进式应用端口和 Scoped JSON/恢复治理。

---

## 13. 交付文件清单与向 V9.3 移交

施工完成时至少提交：

1. `docs/current/v9/V9_2_IMPLEMENTATION_SPEC.md`（本方案纳入仓库后按实际文件名）；
2. `docs/current/v9/V9_2_VERIFICATION_REPORT.md`：各 WP、实际运行命令/退出码、SHA、故障注入证据、未执行的 CK3/Provider 场景；
3. `docs/current/v9/V9_2_SERVICE_PORTS.md`：七域职责、调用图、端口/DTO、依赖方向；
4. `docs/current/v9/V9_2_JSON_AUTHORITY_AND_RECOVERY.md`：数据 Owner、Scope、Schema、索引/修订、Journal、重放/回滚说明；
5. `docs/current/v9/V9_2_P_ISSUE_LEDGER.md`：至少包含本文件 3 项历史 Review 事项及新增 P 级问题、状态和关闭证据；
6. `docs/current/v9/V9_2_HANDOFF_TO_V9_3.md`：固定 Provider 当前契约，标记后续 Provider Platform 的工作，不提前实施；
7. `scripts/test-v9.2-*.js`、`scripts/test-manifest.js` 登记、`build/runtime-inputs.json` 映射更新、完整发布 CI 结果；
8. 必要的 `README.md`/`CHANGELOG.md`/`V9_DATA_OWNERSHIP_LEDGER.md` 状态补充；历史施工证据保留，不覆写为现在视角。

### 最终交付一句话

> **V9.2 = 七域应用服务的可验证边界 + 唯一写入权威的 Scoped JSON Repository + Index-first 候选与哈希修订 + 可信多文件恢复 + Legacy/官方追忆无损兼容。**
>
> **先证据、后迁移；先私有备份、后写数据；先源构建、后运行包；任何 Owner/Forget/ACK 损害立即 P0 阻断。**

---

## 附录 A：审查依据与证据等级

**仓库既有文本（截至 `f9c088f`）：**

- [`V9_ROADMAP.md`](https://github.com/wsdsb-111/VOCT-NEW/blob/f9c088ff384597fa9e07db248a6cc8c6be68113e/docs/current/v9/V9_ROADMAP.md)，特别是 **第 6 节、7.3 节、8–10 节**。
- [`V9_1_ARCHITECTURE_HANDOFF.md`](https://github.com/wsdsb-111/VOCT-NEW/blob/f9c088ff384597fa9e07db248a6cc8c6be68113e/docs/current/v9/V9_1_ARCHITECTURE_HANDOFF.md)。
- [`V9_DATA_OWNERSHIP_LEDGER.md`](https://github.com/wsdsb-111/VOCT-NEW/blob/f9c088ff384597fa9e07db248a6cc8c6be68113e/docs/current/v9/V9_DATA_OWNERSHIP_LEDGER.md)。
- [`V9_BASELINE_BEHAVIOR_CONTRACTS.md`](https://github.com/wsdsb-111/VOCT-NEW/blob/f9c088ff384597fa9e07db248a6cc8c6be68113e/docs/current/v9/V9_BASELINE_BEHAVIOR_CONTRACTS.md)。
- [`V9_1_SOURCE_BUILD.md`](https://github.com/wsdsb-111/VOCT-NEW/blob/f9c088ff384597fa9e07db248a6cc8c6be68113e/docs/current/v9/V9_1_SOURCE_BUILD.md)。
- [`V9_1_VERIFICATION_REPORT.md`](https://github.com/wsdsb-111/VOCT-NEW/blob/f9c088ff384597fa9e07db248a6cc8c6be68113e/docs/current/v9/V9_1_VERIFICATION_REPORT.md)。
- `src/app/main/memory-system/memory4-store.js`、`memory-store.js`、`memory4-contract.js`、`memory4-orphan-audit.js`、`conversation/conversation.js`、`actions/run-file-manager.js`、`letters/letter-manager.js`、`historical-system/worldline-store.js`。
- `scripts/build-runtime.js`、`scripts/deploy-runtime-build.js`、`scripts/verify-runtime-build.js`、`.github/workflows/regression.yml`。

**本文新增的设计推导（尚待实施检验）：** Service/Repository 文件布局、Port DTO 形式、部署状态标记建议、故障注入夹具/T-ID、具体 PR 划分、退出 Gate 的分阶段组合。这些不是已经存在的项目接口或已运行的验证结果。

**用户新提供的实测依据：** V9.1 功能正常（`USER_CONFIRMED`）；不能据此推断性能定量改善、每类历史数据无差异或 CK3/Provider 完整矩阵通过。

**远端 CI 依据：** `f9c088f` 在 [GitHub Actions #38117263132](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38117263132) 为 Success，说明 V9.1 该提交的工作流成功，并非 V9.2 完成证明。

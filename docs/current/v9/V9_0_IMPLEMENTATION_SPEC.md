# VOCT V9.0 设计与开发施工文档（修订版）

> **文档类型**：Design / Implementation Specification / Verification Plan（实施规划，**不是实施完成报告**）  
> **目标版本**：V9.0 — Frozen V8 Baseline, Startup Latency, CI Reliability & Independent Compatibility Separation  
> **编制日期**：2026-10-11  
> **唯一审查仓库**：[wsdsb-111/VOCT-NEW](https://github.com/wsdsb-111/VOCT-NEW)；读取到的 `main` HEAD：`3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4`  
> **产品状态**：用户已确认 V8 正式冻结并转入 V9；当前 **V9.0 未施工、未签发 PASS**。  
> **输入依据**：用户上传《V9阶段总路线文档.md》旧版、仓库当前源码和 V8.15.2 修复／测试记录、2026-10-10 用户新报告的前几轮对话卡顿、用户要求独立兼容工程与 VOCT 分离。  
> **关联总纲**：《V9阶段总路线文档_修订版.md》；后续施工需再核验分支、部署文件和用户现场状态。

---

## 0. V9.0 目标、决策与范围

### 0.1 一句话目标

在不重写 VOCT Memory4、Action、Letter、Worldline、Prompt 或 UI 的前提下，把 V8 冻结态变成**有可复用测试、可定位启动性能故障、远端 CI 可运行、独立兼容 Mod 不再捆绑的 V9 工程底座**。

### 0.2 五个交付包（Work Packages）

| WP | 级别 | 交付主题 | 主要结果 |
|---|---|---|---|
| **WP-00** | P0 基线 | V8 Freeze Evidence / Environment Inventory | 固定 commit、构建包、Mod、设置／数据边界，生成冻结资产清单与可回滚点 |
| **WP-01** | P1 | GitHub CI 修复和测试可重复性 | 修复历史 `git show` 缺对象导致的最新 CI Failure；保留所有负向测试，不假绿 |
| **WP-02** | P1 | 开场及逐轮卡顿归因、必要时最小修复 | 冷／暖回合 trace、主要耗时根因证据、验证安全性与体验改善 |
| **WP-03** | P1 工程边界 | Three-Mod 兼容项目独立迁出 | 独立源码/测试/文档/版本/CI；VOCT 保留自身 CK3 Bridge，核心零强依赖 |
| **WP-04** | P1 文档/合同 | Architecture Charter / Behavioral Baseline | 数据权威、服务边界、永久测试、退役台账与 V9.1 开工条件 |

### 0.3 本版本明确不做

- 不更换 SQLite，不设计虚置数据库 Adapter，不进行 Memory5 或叙事重写。
- 不改变官方 Action System 2.0.3 的效果判断逻辑，不把 ACK 当 CONFIRMED。
- 不改 Memory4 的 Owner/Campaign、旧 `engineVersion: 3.0`、摘要 2.5、Forget/Tombstone、Year/Life 等业务合同。
- 不大规模改 Provider Serializer、缓存布局、默认 Prompt block ID，也不拿“删除缓存”作为解决启动卡顿的手段。
- 不在 V9.0 重构 UI、迁移全量 `out/`、合并 CK3 与 Electron 进程。
- 不打包 Workshop Runtime payload；这属于 V9.7，并受现行平台政策和许可验证约束。
- 不卸载、不删除、不改写玩家 CK3 本地的 Three-Mod 兼容包或三款上游 Mod。
- 不为了“优化性能”禁用正式日期桥、信件投递、Action 重放保护、角色认知校验和待恢复任务。

### 0.4 准入与完成状态词

任何进度卡片使用 `NOT_STARTED / IN_PROGRESS / BLOCKED / LOCAL_PASS / CI_PASS / PACKAGED_PASS / CK3_PASS / PROVIDER_PASS / USER_CONFIRMED / HOLD`，并附测试日期、SHA、运行条件。`LOCAL_PASS` 不代表 `CI_PASS`；人工“体验顺畅”不等于已采集 P95。

---

## 1. 开工基线与源代码现状（已审阅，不代表实测）

### 1.1 版本基线

- **GitHub 仓库**：`wsdsb-111/VOCT-NEW`，默认分支 `main`。
- **本次可读最新 HEAD**：`3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4`，提交信息 `v8.15.2-修复6 and VOCDthree兼容mod更新`。
- **旧 V9 总路线记录**：`0c290d8aa6ed74345810c54b6e16b94ce1d4d778`，已经不是最新基线。
- **Runtime App package 版本**：`resources/app/package.json` 中的 `2.0.4`；与业务开发 V8/V9 版本并非同一维度。
- **独立兼容包版本**：Three-Mod Character Name Compatibility `1.0.6`，代码文件位于 `compatibility-mods/`。
- **最新报告中的本地发布测试**：`409/409 PASS`，分类测试 478、归档 68；这是仓库历史报告的结果，**本次未重新运行**。
- **远端最新 CI**：`3c49364` 的 Release Regression 为 Failure，详见 [Actions Run 38021500350](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38021500350)。
- **仓库 AGENTS.md / docs/AGENTS.md** 部分“当前基线”文字仍写 V8.8.5；V9.0 文档维护包应按实际 HEAD 更新，不直接使用旧数量做最终断言。

### 1.2 已核查的生产入口

| 责任域 | V8 当前实际路径 | V9.0 操作原则 |
|---|---|---|
| 组合根／启动 | `resources/app/out/main/main.js` | 只加有界性能 trace 或已验证修复，暂不拆成新架构 |
| 对话创建与编排 | `resources/app/out/main/conversation/conversation.js`、`conversation/conversation-manager.js` | 对开场和每轮加分段计时，维持初始/在场认知语义 |
| Memory4 | `resources/app/out/main/memory-system/` | 验证而非重写；继续保留 Legacy、叙事、权限、索引与派生 |
| Worldline | `resources/app/out/main/worldline/`、`historical-system/` | 分别测 Canon 准备、预取、动态查询，不改变事实优先级 |
| Provider | `resources/app/out/main/provider-service.js`、`providers/` | 只对现有耗时、usage/TTFT 建立观测，不改协议 |
| CK3 log / letters | `letters/letter-manager.js`、`letter-date-session-scanner.js`、`letter-log-reader.js` | DATE/ACK/回执必须完整；不能把完整日志反复扫描当成无成本 |
| CK3 Effect | `actions/run-file-manager.js`、`actions/run-command-recovery.js` | 保留 FIFO、命令 ID 去重、未知副作用不自动重放 |
| 测试 | `scripts/test-manifest.js`、`scripts/test-release.js`、`.github/workflows/regression.yml` | 所有生产测试组继续受 CI 管理，兼容独立组迁出后双侧验证 |
| Three-Mod | `compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility/` | 先复制、独立绿测，再从 VOCT HEAD 的跟踪树移除 |
| VOCT Bridge 快照 | `compatibility-patches/v8.15.2-letter-runner/` | **保留**，V9.6 再纳管正式源 |
| 其他兼容目录 | `compatibility-patches/tianjia-benji-repair/` | 单独归属审计，不预判删除 |

### 1.3 V8 冻结操作（WP-00，不得先于备份）

开工者应执行以下顺序，保留输出日志（不包含凭据与私有正文）：

```powershell
# 在本地 VOCT 工作副本；预期 Git HEAD 应与实际冻结包记录相符
 git status --short
 git branch --show-current
 git rev-parse HEAD
 git lfs ls-files
 git log -5 --oneline

# 检查当前可构建／可运行文件和工作流
 node --version
 node scripts\test-release.js
 git diff --check
```

**冻结证据登记表（施工时填实值，不得预填为 PASS）：**

| 字段 | 要求 |
|---|---|
| freezeCommit | 本地完整 SHA；若与本次所见 `3c49364` 不同，停止并核对 |
| freezeTag | 建议 `v8.15.2-freeze-20261011`，仅在验证后由维护者创建；此处未创建 |
| runtimeArtifactHash | 实际 `VOTC.exe`、resources、Prompt 资产 manifest/hash；如采用 LFS 则核对 LFS 对象 |
| workshopItem | 当前 VOCT item ID、目录、关键 Bridge 文件 SHA-256、Mod/CK3 版本 |
| nativeModFiles | DATE / RunFile / Trait 输出／Letter 依赖的当前真实文件集合 |
| userData | 现有配置、Memory4、Legacy、Pending、RunCommand 的**备份存在性与可读取性**；不得提交到仓库 |
| perfEnvironment | OS、CPU、存储介质、CK3/应用版本、启用 Mod 集合、日志尺寸、存档年份；匿名化即可 |
| originalGate | 本地、远端 CI、打包、游戏、Provider、Soak 分别记录状态 |

**冻结策略**：V8 快照只读；所有新代码进入 V9 分支或受控 V9 提交。若发生数据损坏，使用经过验证的备份／恢复程序；不在主用户存档上做清理实验。

---

## 2. WP-01：恢复可信 CI（当前已有明确失败根因）

### 2.1 已确认的失败链

最新 `.github/workflows/regression.yml`：

```yaml
- uses: actions/checkout@v5
  with:
    lfs: true
- uses: actions/setup-node@v5
  with:
    node-version: 22
- run: node scripts/test-release.js
```

Runner 默认浅克隆不会带齐历史对象。现有 `scripts/test-v8.15.2-letter-archive-independent-qa.js` 的 `loadHeadLetterManagerFactory()` 调用：

```javascript
execFileSync('git', [
  'show',
  'fda1b8e:resources/app/out/main/letters/letter-manager.js'
]);
```

2026-10-10 CI 日志在 `v8.15.2-letter-archive-independent-qa` 组报 `fatal: invalid object name 'fda1b8e'`，退出码 1。**这是可复现的历史 Git 对象缺失，不是信件业务语义失败的直接证据。** 2026-10-09 的较早一次运行还出现过 `letter_memory_context_invalid`；不能用修复浅克隆来宣称所有历史红测均已解决。

### 2.2 最小修复路线（优先）

**方案 A：V9.0 快速恢复**——对 `actions/checkout@v5` 增加必要历史深度，最稳妥的起点为：

```yaml
- name: Checkout
  uses: actions/checkout@v5
  with:
    lfs: true
    fetch-depth: 0  # 历史对照脚本需要 fda1b8e 等旧对象
```

仅此不算 PASS：还需重新跑指定 SHA 的远端完整门禁，核查是否有更多隐藏失败。完整历史增加拉取成本，可在首次修复 CI 后测量，然后考虑收窄对象依赖。

**方案 B：后续长期降低耦合**——从已确认的原始历史内容生成只读反例 fixture（附 `sourceCommit`、路径、SHA-256、预期旧行为）；测试先验证 fixture hash 再加载，不依赖 Runner 是否知道某个 commit。但要保证反例确实仍能在旧行为上 RED、当前行为 GREEN；不能把测试改成永远通过的静态断言。该方案可放在 V9.0 后续独立提交，非强制用全新架构替代最小修复。

### 2.3 红绿验证序列

1. 在浅克隆（或等价隔离环境）复现 `git show fda1b8e` 缺历史对象，记录 **预期 RED**。
2. 使用改进的 checkout 获取目标对象，并显示 `git cat-file -e fda1b8e^{commit}` 可通过。
3. 单独跑 `node scripts/test-v8.15.2-letter-archive-independent-qa.js`，保留原负向对照。
4. 跑 `node scripts/test-release.js`；不得跳过组或篡改历史断言。
5. 在 PR／分支与最终合并 SHA 上分别检查 GitHub Actions，保留工作流链接和各阶段结论。
6. 若出现新的失败：分类为产品行为、权限、数据 fixture、时序、Windows 文件系统或环境依赖，独立修复并形成报告。

**WP-01 Exit Gate**：最新 V9 工作 SHA 的 Release Regression `success`；历史反例还存在且可识别 RED/GREEN；独立 Three-Mod 测试迁出前或迁出后均有明确归属；CI 日志和清单数量相符。

---

## 3. WP-02：开场／前几轮对话卡顿专项

### 3.1 事故定义

- **用户报告时间**：2026-10-10（实机）。
- **可见症状**：刚进入游戏时，连续几轮对话各会停顿一下；之后没有明显停顿。
- **当前证据级别**：`USER_REPORTED`；没有统一时钟的 Main/Renderer/CK3 帧时间和 HTTP TTFT 数据。
- **优先级**：P1（交互体验）；若证明造成命令错配、数据损坏、无响应恢复失败，则上升 P0。
- **核心问题**：是 CK3 游戏画面卡、Electron 窗口卡、请求开始前卡、首 token 延迟，还是多个子系统竞争主线程？必须分别辨别。

### 3.2 假设清单（按排查位置分类，不是结论）

| Hypothesis | 直接证据／代码触点 | 如何证伪 |
|---|---|---|
| H1：旧或现存游戏侧频繁轮询导致帧尖刺 | Workshop 现有 `votc_runtime_bridge.gui` 每约 2 秒处理 DATE／RunFile；V8.15.2 曾因旧 runner 改善卡顿 | 记录 CK3 帧时间与原生日志 marker 同时序；检查是否不在轮询窗口仍卡顿 |
| H2：Electron 100ms 剪贴板轮询放大开场竞争 | `main.js` 的 `ClipboardListener.start()` 每 100ms 读取 clipboard | 记录 poll 的单次耗时／数量；隔离在同等数据负荷下对比；不随意关闭 CK3 命令入口 |
| H3：新会话初始 GameData／摘要/认知快照同步工作过重 | `conversation.initializeGameData()`：`parseCK3GameData`→`loadCharactersSummaries`→`captureDisclosureProfiles`→`observeVisibleTraits`→`syncOfficialRecollectionSummaries` | 各阶段墙钟与 event-loop delay；按 Owner × Entity、文件数分组；热轮调用若无该工作则原因需另寻 |
| H4：开场 Worldline 冷预取／Cache 初始化 | `prefetchFrozenWorldline()`、`prepareCanon()`、per-responder baseline | 标记预取在何时开始／结束、是否阻塞第 1–N 轮、缓存温热时有无尖刺 |
| H5：Memory Recall/Prompt 每轮重复扫描或序列化 | `checkAndSummarizeIfNeeded()`、`getMemoryContextFor()`、`PromptBuilder.buildMessages()`、Token 估算 | 同一 NPC/相同消息长度做逐段耗时；确认是不是请求前 CPU 占用而非远端 Provider 延迟 |
| H6：日志 DATE 冷扫描、reader 重启或 ACK watchdog | `letter-date-session-scanner.js`、`letter-manager.js`、`letter-receipt-recovery.js` | `scan.mode`、bytesRead、durationMs、maxBlockMs 与阻塞时间关联；确认没有重新从头扫全文件 |
| H7：Renderer 首次载入/流式渲染 | Electron UI、React/Zustand 事件与渲染 | 对照 BrowserWindow `webContents` 性能 trace、Renderer Long Task 与点击／绘制间隔 |
| H8：游戏加载、磁盘杀毒、网络／Provider 热身 | CK3/Windows/网络环境；不属于已证明 VOCT 错误 | 分离无请求的游戏运行、相同日志体积但不新建对话、Mock Provider 与真实 Provider 对照 |

**特别保护**：`LetterDateSessionScanner` 已实现分块冷扫描、增量读取与事件循环让出；即便它仍需优化，也必须通过读档边界、LOAD 截断、日志轮转、半行及信件幂等回归，不能回退为“遇到新日期直接相信旧值”。

### 3.3 设计一套低侵入 Trace 合同

仅 V9.0 增加诊断性 Span，默认低开销、可开关、可限制条数，采集以下字段：

```text
TraceContext {
  traceVersion: 1
  startupId: <random nonce>
  conversationIdHash: <non-reversible local hash>
  turnOrdinal: 1..N
  sessionPhase: APP_START | CK3_LOAD | CONVERSATION_OPEN | TURN | IDLE
  step: <machine-readable stage key>
  wallMs: number
  cpuMs?: number
  eventLoopDelayMaxMs?: number
  count?: number                 # 人物数／扫描字节／候选数等
  bytesRead?: number
  result: OK | ERROR | CANCELLED | STALE | SKIPPED
  attribution: MAIN | RENDERER | CK3_LOG | PROVIDER | UNKNOWN
}
```

用 `performance.now()` 或 `process.hrtime.bigint()` 记录**单进程内相对时长**；多进程关联使用 trace ID + 单机系统时间做粗关联，切勿把不同进程的 `performance.now()` 绝对值直接相减。主进程可利用 `perf_hooks.monitorEventLoopDelay()` 和 `eventLoopUtilization()` 的采样窗口判断循环负荷；Renderer 用 Performance API 的 Long Task/Frame 指标；CK3 性能依赖实际可获得的游戏内或外部帧数据，若不可用，须明确标注 `NOT_MEASURED`。

建议切分 Span：

```text
app.launch
  ├─ settings.load / prompt.seed / runqueue.recovery
  ├─ worldline.start / letterReader.start / pendingReceipt.recovery
  └─ renderer.firstReady

ck3.gameLoad / bridge.date / runfile.consumer

conversation.open
  ├─ gameData.logParse
  ├─ summary.load
  ├─ knowledge.disclosureSnapshot
  ├─ knowledge.directObservation
  ├─ officialRecollection.sync
  ├─ worldline.frozenPrefetch
  └─ memoryRecovery.pending

conversation.turn(N)
  ├─ input.toIpc
  ├─ memory.recall
  ├─ worldline.turnQuery
  ├─ prompt.build / tokenEstimate / serialization
  ├─ provider.requestStart
  ├─ provider.firstByte / firstVisibleToken / streamEnd
  ├─ renderer.firstPaint / appendCost
  └─ postTurn.work

background
  ├─ clipboard.poll
  ├─ letter.logReader / dateScanCold / dateScanIncremental
  └─ runCommand.ackWatchdog
```

**隐私与安全**：记录耗时、计数、匿名化 ID、错误码和来源模式；不记录原 Prompt、聊天文本、Memory 内容、游戏密钥、API Key、原始 debug.log、玩家存档路径。诊断开关关闭后不得仍持续每轮写重型日志。限制环形内存缓冲与导出体积，诊断失败不可使游戏逻辑失败。

### 3.4 四层感知延迟，不能混为一谈

| 维度 | 起止定义 | 主要问什么 |
|---|---|---|
| Game Hitch | CK3 帧间隔与交互掉帧 | 是否在游戏本身跑循环时发生短暂停顿？ |
| UI Stall | Electron Renderer 无响应/Long Task | 点击、窗口滚动或流式绘制是否被阻塞？ |
| Local Turn Preparation | 用户提交到发出 Provider HTTP 请求 | Memory/Worldline/Prompt 是否每轮先卡？ |
| Provider Latency | request 发出 → first token / stream end | 是否主要是模型端冷连接、推理或网络？ |

这四者允许并发。仅报告“一轮 3 秒”没有诊断价值；必须切分阶段，否则有将 Provider 网络延迟误修为游戏循环的风险。

### 3.5 复现实验矩阵（固定环境并重复运行）

| Case | 场景 | 采样目标 | 必须控制的变量 |
|---|---|---|---|
| C1 | 完全退出 CK3/VOTC → 启动 → 载入原存档 | 冷启动、首 10 回合 | CK3/Mod 版本、日志尺寸、NPC 选择、Provider、Prompt |
| C2 | 同一会话第 11–30 回合 | 稳态 20 回合 | 相同历史和回复模式；记录消息数量增长 |
| C3 | 保持 CK3 同局，关闭/重启 VOTC | 区分 Runtime 冷启动与 CK3 冷启动 | 不删除磁盘缓存、Pending、Memory |
| C4 | 保持 VOTC，CK3 读档与重新进入对话 | LOAD/session 边界与回合尖刺 | 日期／Campaign／Owner 合法切换 |
| C5 | 同 NPC 与切换另一 NPC、多人在场 | Worldline/Knowledge 热缓存对比 | 保留 Presence/Disclosure 权限 |
| C6 | 无信件 pending／有合法 pending（**副本环境**） | 排除 ACK watchdog/收信流程相关开销 | 不重寄、不乱造旧 ACK、不清除主用户队列 |
| C7 | Mock/固定 Provider vs 真实 Provider | 分离本地阻塞与远程 TTFT | 保证 Mock 不写入真实持久记忆／Action |
| C8 | 纯 CK3、VOCT 再开启对照 | 识别 CK3 自身帧尖刺 | 不把拆除 VOCT Bridge 当成生产修复；仅隔离对照 |
| C9 | 旧存档大日志/中小日志（复制件） | 首次 DATE backscan、GameData 解析和 I/O 放大 | 不篡改原始唯一证据；合法模拟日志轮转 |

每例至少记录可比较的 10/20 回合，统计每个 Span 的 P50/P95、最大值、事件循环延迟峰值、CK3 帧数据可用性和错误数。不能以合成日志性能数字替代真实磁盘／实际 CK3；重复试验中严格区分“冷启动”与“重复热启动”。

### 3.6 诊断到修改的决策树

```text
能否在相同环境重现前 N 回合反复卡顿？
  ├─ 否 → 记录 NOT_REPRODUCED、保存低开销 Trace 入口与详细条件
  └─ 是
      ├─ CK3 帧尖刺是否与日期/RunFile GUI 触发同步？
      │    ├─ 是 → 验证 Bridge 重复执行、日志体积和实际 Effect 消费；保留 ACK 幂等
      │    └─ 否 → 继续
      ├─ Electron Main / Renderer Event Loop 有对应长任务？
      │    ├─ 是 → 按 Span 找确切同步 I/O、全量遍历/重复计算
      │    └─ 否 → 分离 Provider TTFT、IPC 等待与 CK3 独立帧源
      ├─ 冷扫描/启动恢复/Canon 预取是否结束后问题自行消失？
      │    ├─ 是 → 查有界分片／初始化时机／去重与缓存合法性
      │    └─ 否 → 查逐轮重复路径与计时器/Listener
      └─ 得到可自动 RED 的最小反例 → 最小修复 → 本地/CI/CK3 双向验证
```

### 3.7 允许的优化与禁止事项

**优先候选**：只读索引复用、同 Scope 的重复读取去重、增量解析、合并并发相同扫描、I/O 分块让出、只在有合法需求时运行额外诊断、对单个 listener 注册次数防重、缓存具备 Scope+Revision 的精确键、将不会改变对话语义的预热放在可控阶段。

**禁止**：把必要的认知来源过滤推迟到模型发送之后；异步预取出错后直接喂跨战役旧数据；跳过合法 `LOAD_SESSION`、未确认 ACK 或已遗忘来源；盲目关闭 100ms 剪贴板（这可能使 `VOTC:IN` 不可触发）；删除每 2 秒的正式 RunFile 桥而使信件和 Action 无法执行；把 UI loading 消失等同于真实任务完成。

### 3.8 性能退出阈值设置方法

V9.0 首次跑出的统计才是基线；**本文件不预设已经测得的 P95 数值**。施工完成时建议满足以下可检查要求：

1. 同环境可重复的前几轮异常有明确主导 Span 或充分的排除证据；每次结论附 trace 及采样条数。
2. 若修复已实施，异常 Span 的冷／暖 P50/P95 与修复前相比，按同一数据和版本可显示改善；没有引入信件/Action/Memory 错误。
3. 如引入任何性能回归阈值，需基于至少 3 次独立冷启动、稳定态 20 回合与测试设备表现定标；CI 合成环境阈值与 CK3 实机主观门槛分列。
4. 需有“UI 是否仍短暂停顿”的用户重新验收记录。未取得用户确认只能写 `CK3_USER_GATE_PENDING`，不能标 `FULL_PASS`。
5. 若未复现，不作未经证实的优化，并明确写明 `ROOT_CAUSE_UNDETERMINED`。

**WP-02 Exit Gate**：性能 trace 与反例矩阵存在；已归因问题完成最小修复或有透明未复现结论；CK3/Provider/Letter/ACK 权限回归不下降；用户现场复测状态明确。

---

## 4. WP-03：东方王朝、汉番礼制等独立兼容 Mod 的安全剥离

### 4.1 工程现状与归属边界

**目标是分离“兼容工程开发仓库与发布责任”，不是卸载玩家已经使用的 CK3 Mod。** 用户原要求明确该独立工程不影响 VOCT 项目，因此应移出 VOCT 版本路径并让 V9 产品对它零必需依赖。

| 目录/资源 | 类型 | 预定归属 | V9.0 操作 |
|---|---|---|---|
| `compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility/` | 独立 Three-Mod 兼容 Mod 源 | 独立工程 | 完整迁出并验证后，从 VOCT 当前树移除 |
| `compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility.mod` | 本地启动器描述符 | 独立工程 | 连同源码迁出，核查本机实际路径指向 |
| `scripts/test-three-mod-character-name-compatibility.js` | 独立兼容 Mod 测试 | 独立工程 | 迁至新仓库，修正相对路径；验证后从 VOCT release 清单退役 |
| `scripts/test-v8.15.2-celestial-office-release.js` | 独立流官功能测试 | 独立工程 | 同上 |
| `scripts/test-v8.15.2-celestial-office-independent-qa.js` | 独立流官对抗测试 | 独立工程 | 同上 |
| `compatibility-patches/tianjia-benji-repair/` | 另一个兼容补丁候选 | **待审计**的独立子项目 | 检查实际依赖、所属 Mod、安装/发布策略；不能按名称强删 |
| `compatibility-patches/v8.15.2-letter-runner/` | VOCT 原生信件/RunFile/DATE Bridge 补丁 | **VOCT 本体** | 原位保留，V9.6 再移入 `ck3-mod/` 的正式源码管理 |
| Memory4、Provider、Action、Worldline、Conversation | VOCT Runtime | **VOCT 本体** | 不因兼容工程剥离而改动 |
| `docs/v8.14-three-mod-...` 与 V8.15.2 兼容报告 | 历史证据 | 双项目可引用 | VOCT 保留历史归档及外部链接；当前功能说明迁至新项目 |

**不能简单删除整个 `compatibility-patches/`**。`letter-runner` 与 Three-Mod 角色/称谓/流官业务的角色不同，误删会使 V9.6 Bridge 纳管缺失关键源文件。

### 4.2 推荐独立仓库形态（建议）

```text
CK3-Three-Mod-Compatibility/              # 建议名，尚未创建
  README.md                               # 功能说明 / 本地安装 / 先决 Mod 与版本
  CHANGELOG.md                            # 独立 1.0.6 及后续版本
  LICENSE / THIRD_PARTY_NOTICES           # 按真实源授权情况核对
  mod/
    VOTC_Three_Mod_Character_Name_Compatibility.mod
    VOTC_Three_Mod_Character_Name_Compatibility/
      descriptor.mod
      common/
      events/
      gui/
      localization/
  tests/
    test-three-mod-character-name-compatibility.js
    test-v8.15.2-celestial-office-release.js
    test-v8.15.2-celestial-office-independent-qa.js
    fixtures/
  docs/
    migration-from-voct.md
    compatibility-matrix.md
    independent-release-record.md
  .github/workflows/compatibility-tests.yml
```

注意：现有测试可能引用 VOCT `scripts/` 公共 helper。迁出前先做 `require/import/relativePath/fixture` 引用闭包审计；确有公共测试工具的，将**不含 VOCT 生产代码的最小通用 fixture/helper** 拷贝到独立项目并注明来源。不得通过继续读取 `../VOCT-NEW/` 达成表面分离。

### 4.3 六步迁移交易（先复制验证，后从 VOCT 移除）

**M1 — 清点与永久备份**

- 枚举 Three-Mod 目录与 `.mod` 相邻描述符全部文件、大小、SHA-256、Git tracked 状态、现有安装目录版本与加载顺序。
- 从仓库当前提交导出独立源码快照；对当前本地已安装版本建立**只读备份**，但不以其内容覆盖 Git 工作树。
- 保存 `migration-manifest.json`（仅路径／hash／来源 SHA／去向，不含真实用户存档路径、密钥和数据正文）。

**M2 — 建立独立工程副本**

- 新建独立仓库及工作流（需要拥有者实际授权并执行；本文不假设已存在）。
- 迁入源码、测试、fixtures、文档、最低 CK3/三 Mod 版本、安装/卸载说明。
- 保持 Three-Mod `1.0.6` 运行逻辑和 `remote_file_id`、`replace_path` 等已存在合同的真实值；迁移本身不新增官职规则。

**M3 — 独立验收**

- 不再从 VOCT 目录 `require` 源代码；独立测试在全新 checkout 运行。
- 必要时复现原项目下 3 组正常测试、旧 BUG 负例、兼容脚本静态语法和原文件 hash 一致性。
- 人工 CK3 Gate 仅针对 Three-Mod：角色名称、天家／汉番称谓、东方王朝庙谥号、县/公/王/帝同级流官新旧职位交接、候任者闭环、世袭和其他政府豁免。尚未执行要写 `CK3_PENDING`，不以静态 QA 冒充。

**M4 — VOCT 当前工作树退役跟踪副本**

- 单独 V9.0 提交，移除已通过迁移的 Three-Mod 目录、相邻描述符、3 个独立测试入口及 `test-manifest.js` 内相关 release 条目。
- 修改 VOCT `README.md`、`docs/README.md`、`CHANGELOG.md`：历史 V8 链接保留，当前入口指向独立项目，不再以 Three-Mod 版本号作为 VOCT 最新功能版本顶部标题。
- 对 `tianjia-benji-repair` 另开“归属审计”小项；检查后决定一起迁入独立工程子目录，或保留明确理由，不与前述三组无条件打包操作。

**M5 — 核验 VOCT 零必需依赖**

- 在全新 VOCT checkout 跑完整 Release Regression、文件引用检查；针对生产 Main/Renderer/CK3 Bridge 做无 Three-Mod 环境 smoke。
- 在启用 Three-Mod 的环境做可选兼容验证：VOCT 仍从自己的导出消费有效 `VOTC:IN` 与姓名/头衔字段，`t_1/t_2/t_3/t_18/t_26` 的意义不随迁移变化。
- VOCT 不做 Three-Mod 官职政策断言；独立 CI 承担该责任。

**M6 — 回滚与持久边界**

- 独立项目若丢文件或测试失败，仅回滚 VOCT **迁移提交**，或重新导出只读冻结快照；不要回滚用户数据／CK3 存档。
- 本地已安装的兼容 Mod 始终原封不动；若以后要做安装更新，另立版本化部署脚本与用户明确操作。
- VOCT Git 历史无需重写，历史提交仍可查到曾跟踪的兼容工程；如需单独保留提交史，只在临时镜像执行 subtree/path 提取，绝不可对 VOCT `main` 强推改写。

### 4.4 双侧发布门禁

| Gate | VOCT 侧 | 独立兼容侧 |
|---|---|---|
| 内容 | 生产核心无 Three-Mod 代码或位置硬依赖 | 完整 1.0.6 功能源、相邻 `.mod`、加载条件 |
| 自动化 | 剥离后 Release 仅含 VOCT 合同；CI 绿 | 自身测试和独立 CI 绿 |
| 接口 | 有/无 Three-Mod 时合法角色导出、记忆、动作、信件可工作 | 对上游三 Mod 的命名与官职规则按其版本验证 |
| 文档 | 历史记录不失效；当前 README 外链 | 独立 README/CHANGELOG/安装和兼容矩阵 |
| 操作 | 不卸载玩家安装、Playset、存档和日志 | 任何更新需明确用户操作／备份／回滚 |
| 发布 | Three-Mod 不再是 VOCT blocker | VOCT V9 迭代也不是兼容项目 blocker |

**WP-03 Exit Gate**：所有待迁文件有 manifest/hash 与新仓库真实链接；独立环境可运行完整兼容测试；VOCT 本地与远端 Regression 不再依赖此工程；必要的 VOCT Bridge 文件未误删；本地 CK3 Mod 未被触碰；两侧文档互相可导航。

---

## 5. WP-04：行为保护、架构合同和数据责任

### 5.1 永久行为合同（签发前必须具备正反例）

| 合同 ID | 不可破坏行为 | 最低验证对象 |
|---|---|---|
| B-MEM-01 | Campaign / Owner / 人物对隔离 | 多战役、同名/相同 ID、跨 NPC、第三人错误反例 |
| B-MEM-02 | Forget/Tombstone 真正撤销 Recall/Prompt 使用资格 | 重启、索引重建、Recovery、Derived 不复活 |
| B-MEM-03 | Direct Observation 仅合法在场观察，隐藏特质需来源 | 首次对话、临时离场、多人旁听、Self vs Observed |
| B-MEM-04 | Narrative Detail 与 source provenance 不丢 | 承诺/转述/情绪、Event Time vs Acquisition Time |
| B-MEM-05 | Legacy 历史数据保守迁移 | 未绑定 Campaign 时拒绝猜测，旧正文保持 |
| B-WORLD-01 | 当前事实／历史／规划三类分离 | Current Runtime Truth、Definition↔Runtime 一对一、前缀不陈旧 |
| B-ACT-01 | RunFile Queue、ACK、CONFIRMED 严格分层 | 真实前后状态、同命令去重、STALLED 未授权不重放 |
| B-LETTER-01 | DATE/Letter 到期一次投递、收信一次归档 | LOAD/session、断线、重启、回执、连续不同信、未知 Effect |
| B-PROMPT-01 | Provider Prompt 不能泄露未授权记忆 | 当前轮、Stable/Frozen Prefix、切换角色／时间更新 |
| B-UI-01 | 三主题、Memory 页面、设置及异步状态持续可用 | Packaged smoke、过时异步结果不覆盖新状态 |
| B-PERF-01 | 背景采集不会造成无界重复工作 | 冷/暖 trace、日志大文件、定时器数量稳定 |
| B-MOD-01 | Three-Mod 工程不在 VOCT 必需依赖链 | 有/无兼容 Mod 两组真实接口 smoke |

### 5.2 数据 Source of Truth 登记示例

以下是需在施工中经生产引用证实的**初始调查对象**，不是暗示可以随便移动：

```text
%APPDATA%/VOTC 或应用实际 userData 下
  conversation_summaries/<Owner>/...            # 旧关系有向摘要及兼容数据
  conversation_summaries/.../memory4/<Campaign>/ # Memory4 entry/index/metadata/years/life
  memory/episodes/episode_<ID>.json
  memory/episodes/memory_<ID>.json
  memory/index.json
  其他恢复、Pending/RunCommand、Worldline、用户配置与 Prompt 文件

CK3 用户目录
  logs/debug.log
  run/votc.txt
  saves/...（只读原始存档）

Workshop 安装位置
  VOCT 自身 Mod 原生脚本／GUI／事件（不等于 Three-Mod）
```

表格每行填：`producer`、`writer`、`ownerScope`、`schemaVersion`、`authoritative?`、`derivedFrom`、`updateAtomicity`、`recoveryPath`、`migrationReader`、`backupProcedure`、`safeDeletionGate`。不能把“文件存在”当成“仍在生产消费”的证据；反过来也不能把“文件名是旧版”当成可删除依据。

### 5.3 V9 核心接口草案（只定义边界）

```text
ConversationService
  openGameSession(ck3Snapshot, context)
  beginTurn(turnInput, scope)
  finalizeConversation(snapshot)

MemoryService
  buildRecall(scope, query, evidence)
  recordObservation(scope, provenance)
  disclose(scope, evidence)
  forget(scope, sourceProof)
  recover(scope)

WorldlineService
  currentTruth(scope, request)
  historicalEvidence(scope, temporalQuery)

RunCommandService
  enqueue(effect, identity)
  observeAck(physicalEvidence)
  confirm(effect, gameReadback)

LetterService
  observeGameDate(sessionEvidence)
  reconcileDelivery(letterId, ackEvidence)
  finalizeReceipt(receiptEvidence)

JsonRepository
  read(scope, id)
  queryIndex(scope, criteria)
  commit(batch, expectedRevision)
  recoverJournal()

Ck3BridgeAdapter
  inspectCapability(gameBridge)
  decodeCanonicalState(rawLog)
  encodeRunCommand(command)
```

全部签名属**设计示例**，V9.0 不需实现这些服务，也不能把其列为已经生效的生产 API。V9.1/9.2 才依成熟合同分层；V9.6 的协议要以真实 CK3 文件为准。

### 5.4 必须生成的 V9.0 文档成果

```text
docs/current/v9/
  V9_ROADMAP.md
  V9_0_IMPLEMENTATION_SPEC.md
  V8_FREEZE_EVIDENCE.md
  V9_BASELINE_BEHAVIOR_CONTRACTS.md
  V9_STARTUP_PERFORMANCE_INVESTIGATION.md
  V9_COMPATIBILITY_MOD_SEPARATION.md
  V9_ARCHITECTURE_BOUNDARY.md
  V9_DATA_OWNERSHIP_LEDGER.md
  V9_DECOMMISSION_LEDGER.md
  V9_0_VERIFICATION_REPORT.md      # 执行后填写，不能预先宣布 PASS
```

路径是建议目标，符合仓库当前 `docs/README.md` 单入口约定；未来在 V9.8 整理 `docs/current`/`docs/archive` 时再统一迁移，不在 V9.0 为了目录好看重命名全部历史文件。

`V9_DECOMMISSION_LEDGER.md` 对每项写：`legacyPath / owner / currentCallers / replacement / compatibilityReader / dataRisk / tests / rollback / evidence / removableAfterVersion`。任何尚无运行时引用证明的旧路径先登记 `KEEP_UNTIL_PROVEN`。

**WP-04 Exit Gate**：模块/数据责任图齐备、永久合同有测试映射、退役台账可审计、V9.1 可按文件和权限链条接手。

---

## 6. 施工拆包与变更顺序

为了避免多系统同时施工导致无法回归，建议使用四个可审查的小阶段（版本号可以按仓库实际命名调整）：

### V9.0-A — Freeze & CI

- 完成 WP-00 冻结快照登记、备份和工作区核验。
- 最小修复 CI historical baseline checkout；独立 CI green。
- 创建 V9 性能/数据/兼容三个风险台账。
- **不改对话语义与游戏脚本。**

### V9.0-B — Startup Profiling & Targeted Fix

- 首先只加低侵入 trace，提供 `--diagnostics` 或等价有限开关。
- 用 C1–C9 场景收集红测／冷暖数据，定位相应 Span。
- 实施**仅限已证实瓶颈**的最小修复，保持 Memory4/Letter/Action/Bridge 合同。
- 重新跑本地/CI/Packaged/CK3 性能与功能双 Gate。

### V9.0-C — Compatibility Project Extraction

- 新建独立工程，导入 Three-Mod 源码与 3 组 QA，验证独立工程通过。
- 调整 VOCT manifest/README/docs；仅在双侧可靠后移除已迁出的跟踪副本。
- 把 `tianjia-benji-repair` 的归属结论记录清楚；保留 VOCT `v8.15.2-letter-runner`。
- 不修改 Three-Mod 1.0.6 的游戏效果。

### V9.0-D — Architecture Baseline & Exit Gate

- 合并 Contract Ledger、Data Ownership、Decommission Ledger 和真实性能统计。
- 归档最新正确 SHA 的 CI、Packaged、CK3、Provider 状态以及明确未测试的工况。
- 输出 V9.0 Implementation/Verification Report，交付 V9.1 的边界与回滚清单。

**顺序约束**：WP-01 可以与调查阶段的非破坏性阅读并行；任何改变发行文件、JSON 写入和用户本地 Mod 的操作必须有各自隔离验证。CI 最终 Gate 必须在所有 V9.0 提交合并后的最终 SHA 上重新执行；不能把 A 子阶段的绿灯冒充 D 阶段绿灯。

---

## 7. 测试策略与必须具备的反例

### 7.1 现有基础命令

在 VOCT 仓库根目录按需运行：

```powershell
node scripts\test-release.js
node scripts\test-v8.15.2-letter-archive-independent-qa.js
node scripts\test-v8.15.2-idle-run-carrier.js
node scripts\test-v8.15.2-outbound-bridge.js
node scripts\test-v8.15.2-date-scan-incremental.js
node scripts\test-v8.15.2-letter-receipt-startup-recovery.js
node scripts\test-v8.15.2-runtime-followup-independent-qa.js
node scripts\test-v8.15.2-derived-compression-independent-qa.js
node --check resources\app\out\main\main.js
node --check resources\app\out\main\conversation\conversation.js
node --check resources\app\out\main\letters\letter-manager.js
git diff --check
```

迁移前（VOCT）与迁移后（独立仓库）分别验证：

```powershell
node scripts\test-three-mod-character-name-compatibility.js
node scripts\test-v8.15.2-celestial-office-release.js
node scripts\test-v8.15.2-celestial-office-independent-qa.js
```

注意：上述**只是待执行命令目录**；本次提供的文件并未运行这些命令或启动用户 CK3。

### 7.2 每个 WP 的负向验证

| WP | 应当先失败的反例或拒绝场景 | 通过时不能发生的事 |
|---|---|---|
| CI | 历史对象缺失时对照脚本报明确错误；修复后同脚本绿色 | 不允许捕获异常后标记通过或删除历史测试 |
| 性能 | 反复同步读盘、同 Scope 重复扫描、意外双 listener/CPU 长任务可被 trace 发现 | 不能以关停必要桥接任务来掩盖阻塞 |
| Memory4 | 陌生 NPC 不能读上局/他人已忘秘密；跨 Campaign 失败关闭 | 不能因“缓存已热”返回越权前缀 |
| Letter | 已写未知 ACK 不重试 Effect；停机回执只合法一次归档 | 不生成第二件宝物，不吞别的信回执 |
| RunFile | 双 CK3 consumer 对同一 ID 去重 | 不重复执行金钱、关系或其他有副作用命令 |
| Compatibility | 独立仓库缺原文件或 fixture 时测试明确失败 | 不可通过 fallback 读取 VOCT 父目录获得假绿 |
| Arch | 冗余索引/数据视图冲突能审计报告 | 不把视图悄悄当成权威数据覆盖正文 |

### 7.3 自动化和人工证据矩阵

| 维度 | 最低覆盖 | 签字证据 |
|---|---|---|
| Node static | `node --check`、manifest、test-release、差异检查 | SHA、原始命令、exit code |
| CI Windows | `node 22`、真实 HEAD、完整历史对象／可靠 fixture | GitHub Workflow URL、job outcome |
| Electron isolated | Packaged Main/Preload/Renderer、诊断开关、设置 | 打包版本 SHA、匿名日志、截图（若需要） |
| CK3 Native | 真读档、对话前 10 轮+后 20 轮、DATE/RunFile/ACK、信件 | CK3 build、启用 Mod、桥文件 hash、trace、用户确认 |
| Provider live | 已实际支持的至少一个主力 Provider；普通/流式/结构化 | model、时间、usage 原生字段、异常处理，脱敏 |
| Recovery | Pending、RunCommand、Legacy/Memory4、日志轮转/LOAD | 不写原始用户档的隔离 fixture |
| Three-Mod | 自身测试/真实关键官职规则 | 独立仓库 SHA、CI、可选 CK3 结果 |
| Soak | 暂以 V9.0 冷暖 30 轮诊断为最低采样；V9.9 才做长期完整压测 | 回合数、P50/P95、错误数、数据增长记录 |

若需要收集实机日志，先复制到受控目录并进行脱敏；不要把真实聊天、Key、存档、CK3 debug.log 原件提交到 GitHub。

---

## 8. 合并与回退控制

### 8.1 提交边界

每个 PR/变更包只包含一个主要因果集合：

- `v9.0-a: freeze baseline + CI historical fixture`（不改用户数据）
- `v9.0-b1: performance trace only`（诊断可关闭）
- `v9.0-b2: proven startup bottleneck fix`（只有 RED/GREEN 证据后存在）
- `v9.0-c1: independent compatibility export`（新仓库先验证）
- `v9.0-c2: VOCT tracked copy retirement`（链接、测试、manifest 同步）
- `v9.0-d: architecture/behavior docs + final gates`

上述是建议标题而非要求固定 git 历史。**不要在一个提交同时改写 Memory4 召回、Letter 轮询、Three-Mod 官职效果与 Prompt**。

### 8.2 回滚表

| 修改类型 | 可接受回退 | 不可接受回退 |
|---|---|---|
| CI checkout | 回退 YAML/test fixture 提交，并保留失败证据 | 跳过 CI 或丢失 negative test |
| 性能 Trace | 关闭开关或回退诊断提交 | 清除用户日志/状态以伪造不卡 |
| 性能优化 | 回退单个行为等价补丁，维持基线存储与协议 | 回滚用户存档、抹除 Forget/ACK/Pending |
| Three-Mod 分离 | 恢复 VOCT 跟踪源码副本或从独立仓库重导；本地安装不动 | 删除/覆盖玩家 CK3 Mods/Playset/存档 |
| 文档迁移 | 恢复新索引链接，历史文档可查 | 重写旧报告为未发生的 PASS |

### 8.3 数据操作安全门槛

所有涉及本地数据的任何脚本必须：仅针对显式指定的测试目录、支持只读 dry-run、生成 manifest/hash、确保目标 Scope、保留备份、失败不回退到其他 Campaign、输出恢复说明。独立兼容仓库迁出无需读写 `%APPDATA%/VOTC` 的记忆与设置内容。

---

## 9. V9.0 完成判定（Exit Gate，逐条签字）

| Gate ID | 条件 | 当前状态（2026-10-11 文档审查时） |
|---|---|---|
| G00 | V8 freeze SHA、tag（若采用）、Runtime artifact/Bridge hash 和备份一致 | `NOT_VERIFIED` |
| G01 | HEAD 对应完整远端 Release Regression 成功、历史反例未绕过 | `BLOCKED`：最新 `3c49364` CI 失败，原因已定位到 shallow history |
| G02 | 开场卡顿冷／暖逐轮 trace + 根因结论 + 前后对比 | `NOT_STARTED`：有用户症状报告、无此轮可用 trace |
| G03 | 若实施性能修复：有独立 RED/GREEN、无 Memory/Letter/RunFile 副作用 | `NOT_STARTED` |
| G04 | Three-Mod 完整导出独立仓库，源码/hash、测试与 CI 完成 | `NOT_STARTED` |
| G05 | VOCT 本体不再跟踪独立 Three-Mod 源/测试，且仍保留 native Bridge | `NOT_STARTED` |
| G06 | 有/无 Three-Mod 时 VOCT 核心功能合法，独立仓库功能可维护 | `NOT_STARTED` |
| G07 | 主要持久数据 Owner/Scope/Schema/读写与恢复责任登记 | `NOT_STARTED` |
| G08 | V9 Behavior Contracts、Architecture、Decommission Ledger 可导航 | `NOT_STARTED` |
| G09 | 本地/CI/Packaged/CK3/Provider 结果分类记录，无把未测写成 PASS | `NOT_STARTED` |
| G10 | V9.1 交接说明与回滚包齐备，P0=0，P1 按证据关闭 | `NOT_STARTED` |

**签发规则**：V9.0 只有在上述已实施的相关门禁有可追溯证据且关键 P1 关闭后才能宣称 `V9.0 COMPLETE`。若某个真实 CK3 场景不能执行，结论为 `HOLD / CK3_PENDING`，不是整体 Full Pass。新性能症状若无法复现，允许保留 `UNREPRODUCED` 与后续复测计划，但需实事求是地说明未证明问题消除。

---

## 10. 下一阶段 V9.1 的交接包

V9.0 最终应向 V9.1 交付如下信息，不提前施工 V9.1：

1. 冻结 V8 功能与本机二进制／Workshop 的可追溯 SHA、备份与回滚索引。
2. 完整通过的 Remote CI Workflow 和稳定历史反例测试方案。
3. 已实测的冷启动/稳定态性能基线、根因清单、尚可能阻塞的 Main/Renderer/I/O 路径。
4. 独立兼容仓库地址、版本、CI、安装路径与适配矩阵；VOCT 不依赖它的证据。
5. `resources/app/out/` 的事实源码地图、可编辑源缺口、打包资源和 LFS 风险清单。
6. Memory4/Worldline/Letter/RunFile/Provider/Prompt/IPC 的契约、数据 Owner 与禁改项。
7. 明确的 P0/P1/P2 余项及各自负责阶段；不会因进入 V9.1 把 V9.0 遗留问题自动“视为完成”。

---

## 11. 来源和重要依据

以下均为**仓库中实际可访问的资料**；本文件的设计、测试矩阵、退出标准是基于这些资料提出的建议，不是已经实现的代码：

- [HEAD `3c49364` 的实际提交](https://github.com/wsdsb-111/VOCT-NEW/commit/3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4)
- [远端 Release Regression 失败 Run](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38021500350)（失败位于历史 letter archive independent QA）
- [CI checkout/test 命令](https://github.com/wsdsb-111/VOCT-NEW/blob/main/.github/workflows/regression.yml)
- [CI 缺对象的具体 `git show` 脚本](https://github.com/wsdsb-111/VOCT-NEW/blob/main/scripts/test-v8.15.2-letter-archive-independent-qa.js)
- [剪贴板 100ms 与启动器](https://github.com/wsdsb-111/VOCT-NEW/blob/main/resources/app/out/main/main.js)
- [开场摘要／Disclosure／直接观察／Worldline 预取](https://github.com/wsdsb-111/VOCT-NEW/blob/main/resources/app/out/main/conversation/conversation.js)
- [LetterManager、日期 Session 扫描和 ACK watchdog](https://github.com/wsdsb-111/VOCT-NEW/blob/main/resources/app/out/main/letters/letter-manager.js)
- [DATE 增量 Scanner](https://github.com/wsdsb-111/VOCT-NEW/blob/main/resources/app/out/main/letters/letter-date-session-scanner.js)
- [V8.15.2 旧计时管道退役／用户卡顿改善](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-letter-timer-retirement-report.md)
- [V8.15.2 停机回执／DATE 性能热修](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-fix5-implementation-report.md)
- [V8.15.2 RunFile 空闲轮询合同](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-idle-run-carrier-report.md)
- [V8.15.2 后台信件消费缺口与新桥逻辑](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-outbound-bridge-followup-report.md)
- [Three-Mod 1.0.6 官职连续交接报告](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-celestial-same-tier-office-report.md)
- [三 Mod 称谓规则与 `VOTC:IN` 不变的边界](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.14-three-mod-character-name-compatibility-report.md)
- [当前测试 Manifest](https://github.com/wsdsb-111/VOCT-NEW/blob/main/scripts/test-manifest.js)
- [当前文档入口](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/README.md)

> **最后声明**：用户 V8 冻结决定已被采纳为开发路线前提；Git tag、真实新仓库、CI 修复、性能实机采样、兼容工程迁出和所有代码变更仍待执行。本设计文档不能替代施工结果或实机验收。

# V8 Historical System（v8.3.1）

V8.0 在此目录建立结构化、可验证的历史基线；V8.1 增加存档身份和最小 WorldlineStore；V8.3 增加只读 Historical Figure Resolver；V8.3.1 增加实机诊断和人工 Ground Truth Dashboard。当前仍保持 Shadow Mode，不改变 v7.10.1 的 Prompt 与既有运行合同。

## 当前模块

- `schema.js`：HistoricalPeriod、HistoricalFigure、HistoricalFact、HistoricalEvent 与 Ruler 数据合同及全量引用校验。
- `historical-data/`：从旧年份分支逐字迁移的时期、事件和人物；V8.0 不扩写旧历史文案。
- `historical-baseline.js`：提供 `getPeriodByYear()`、`getLegacyReferenceByYear()` 和只读 baseline snapshot。
- `compatibility-adapter.js`：将结构化数据投影回 V7 的 `{ period, context, notableEvents, notableFigures }`。
- `temporal-knowledge-gate.js`：严格日期解析和 fail-safe 时间可用性判断；V8.0 仅供 shadow/test 使用。
- `campaign-identity.js`：验证 CK3 存档 token，派生稳定哈希 ID；无可靠 token 时返回不可持久化 session identity。
- `worldline-store.js`：校验并原子保存 schema version 1 `worldline.json`，未知/损坏 state 不覆盖。
- `historical-data/figure-matching.js`：为 48 个历史人物提供显式 resolver readiness；首批 14 人包含人工复核的出生年与正向文化提示。
- `historical-figure-input.js`：每个 GameData 只构建一次 Canonical Relationship Profile，并生成深冻结、紧凑的候选证据快照。
- `figure-name-index.js`：归一化人物名与别名，只允许 exact canonical/alias 进入候选集。
- `historical-figure-resolver.js`：分离 identity 与 world-state 证据，输出 `UNSUPPORTED` 至 `RESOLVED` 六种 shadow 状态。
- `historical-figure-diagnostics.js`：将当前 GameData 已有解析结果投影为 Renderer 可用的紧凑纯 JSON Snapshot。
- `historical-ground-truth-store.js`：只在 diagnostics 目录 append 人工裁定，生产 Resolver 不读取。
- `historical-diagnostics-ipc.js`：执行一次 parse、维护短期可信 capture cache 并校验裁定 IPC。
- `dynamic-history-service.js`：组合 Campaign Identity、WorldlineStore 与 Figure Resolver 的唯一 Shadow 入口；状态绑定到当前 GameData 的隐藏 `dynamicHistory`，不保留全局 last-writer state。

Schema version：`1`。

## 依赖方向

```text
historical-data + schema
          ↓
historical-baseline
          ↓
compatibility-adapter
          ↓
game-data/legacy-historical-reference.js

CK3 VOTC:CAMPAIGN → LogParser
                         ↓
               DynamicHistoryService
              ↙         ↓          ↘
 CampaignIdentity   Figure Resolver   WorldlineStore
                         ↓
              RelationshipResolver
                         ↓
             GameData.dynamicHistory
```

原 `game-data/legacy-historical-reference.js` import 路径、函数名与返回结构保持不变。`dynamicHistory` 和兼容入口 `historicalCampaignIdentity` 均不可枚举，不进入对象展开或 JSON 序列化；`getWorldlineState(gameData)` 只读取指定实例。`default.hbs`、Prompt block 顺序、cache anchor 和 stable/dynamic 分类均不读取 V8 shadow state。

Figure Resolver 先以规范名/别名精确门禁缩小候选，再使用出生时间、性别与亲属关系等身份信号评分；文化、家族、头衔、职位、领地和位置仅作为正向辅助证据。当前角色的头衔或位置与历史不一致不构成身份冲突，历史死亡日期也不排除 CK3 沙盒中的存活人物。`RESOLVED` 要求分数不低于 0.85、领先第二名至少 0.15、没有硬冲突，且具备强出生年或亲属证据。结果只保存在不可枚举的 `GameData.dynamicHistory.figureResolution`，不写入 `worldline.json`。

## 边界

V8.3.1 historical-system：

- 不拥有或修改 Memory；
- 不执行 Action；
- 不生成或投递 Letter；
- 不写 CK3 文件；
- 不依赖 Conversation Runtime 或 Run Command Queue；Figure Resolver 只读复用 Canonical Relationship Resolver，不修改其语义或状态；
- 只在 `votc_data/dynamic_history/` 持久化可靠 campaign 的最小 Shadow state，不修改 Memory 目录；
- 不持久化 figure binding，不建立全局人物缓存、GameStateSnapshot、divergence、fact validity 或 worldline projection；
- Ground Truth 只写 `votc_data/diagnostics/historical-figure-ground-truth/records.jsonl`，不按 campaign 覆盖，不进入生产 Resolver；
- 不让 Temporal Gate 改写最终 Prompt。

GameStateSnapshot、Divergence Ledger、Fact Validity 和 Worldline Projector 仍按后续阶段推进；V8.3 的人物解析结果在人工 Ground Truth 与真实 CK3 Save A/B Gate 完成前只作为 shadow diagnostic。

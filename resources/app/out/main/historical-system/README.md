# V8 Historical System（v8.1）

V8.0 在此目录建立结构化、可验证的历史基线；V8.1 增加存档身份和最小 WorldlineStore。当前仍保持 Shadow Mode，不改变 v7.10.1 的 Prompt 与既有运行合同。

## 当前模块

- `schema.js`：HistoricalPeriod、HistoricalFigure、HistoricalFact、HistoricalEvent 与 Ruler 数据合同及全量引用校验。
- `historical-data/`：从旧年份分支逐字迁移的时期、事件和人物；V8.0 不扩写旧历史文案。
- `historical-baseline.js`：提供 `getPeriodByYear()`、`getLegacyReferenceByYear()` 和只读 baseline snapshot。
- `compatibility-adapter.js`：将结构化数据投影回 V7 的 `{ period, context, notableEvents, notableFigures }`。
- `temporal-knowledge-gate.js`：严格日期解析和 fail-safe 时间可用性判断；V8.0 仅供 shadow/test 使用。
- `campaign-identity.js`：验证 CK3 存档 token，派生稳定哈希 ID；无可靠 token 时返回不可持久化 session identity。
- `worldline-store.js`：校验并原子保存 schema version 1 `worldline.json`，未知/损坏 state 不覆盖。
- `dynamic-history-service.js`：组合 Campaign Identity 与 WorldlineStore 的唯一 Shadow 入口；状态绑定到当前 GameData 的隐藏 `dynamicHistory`，不保留全局 last-writer state。

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
                  ↙             ↘
       CampaignIdentity      WorldlineStore
                         ↓
             GameData.dynamicHistory
```

原 `game-data/legacy-historical-reference.js` import 路径、函数名与返回结构保持不变。`dynamicHistory` 和兼容入口 `historicalCampaignIdentity` 均不可枚举，不进入对象展开或 JSON 序列化；`getWorldlineState(gameData)` 只读取指定实例。`default.hbs`、Prompt block 顺序、cache anchor 和 stable/dynamic 分类均不读取 V8 shadow state。

## 边界

V8.1 historical-system：

- 不拥有或修改 Memory；
- 不执行 Action；
- 不生成或投递 Letter；
- 不写 CK3 文件；
- 不依赖 Conversation Runtime、Run Command Queue 或 Relationship Resolver；
- 只在 `votc_data/dynamic_history/` 持久化可靠 campaign 的最小 Shadow state，不修改 Memory 目录；
- 不建立 GameStateSnapshot、figure binding、divergence、fact validity 或 worldline projection；
- 不让 Temporal Gate 改写最终 Prompt。

GameStateSnapshot、Figure Resolver、Divergence Ledger、Fact Validity 和 Worldline Projector 分别留给 v8.2–v8.6。

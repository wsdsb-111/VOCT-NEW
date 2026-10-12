# V9.2 应用服务端口与接线

日期：2026-10-11。本文记录 V9.2 七个服务端口的最小可测合同及其现有业务 owner。端口只绑定并委托原方法，不改变签名、错误、返回值或副作用。

## 组合入口

`main.js` 是 Electron 主进程组合根。组合根将已经创建的业务对象交给 `createApplicationServices({ conversation, presence, memory, worldline, action, letter, persistence })`，得到冻结的七个小接口：`conversation`、`presence`、`memory`、`worldline`、`action`、`letter`、`persistence`。此工厂不会创建第二个业务 manager、Store 或恢复器。

每个 Port 都以原 owner 为 `this` 绑定真实方法；owner 缺失或必需方法缺失时在组合阶段抛出带 service/method 名称的 `TypeError`。调用时不转换参数、结果或异常。方法定义集中在 `APPLICATION_SERVICE_METHODS`，避免为七个域各造一个无行为的转发类。

## 最小合同与真实 owner

| Port key | 最小方法 | 真实 owner 与行为边界 |
| --- | --- | --- |
| `conversation` | `createConversation()`、`getCurrentConversation()`、`sendMessage(userMessage, streaming = false)`、`endCurrentConversation(options = {})`、`flushFinalizations(options = {})`、`hasPendingFinalizations()` | 现有 `ConversationManager`。创建、消息、结束和终局排空仍使用原 epoch、listener 与 FinalizationCoordinator。 |
| `presence` | `getConversationState()`、`joinWaitingCharacter(characterId)`、`leavePresentCharacter(characterId)`、`temporarilyLeaveCharacter(characterId, mode)`、`returnTemporaryCharacter(characterId)` | 与 Conversation 共用 `ConversationManager` 实例。Presence 真相保存在当前 `Conversation`；Manager 负责活动会话检查、调用和 UI 更新。 |
| `memory` | `retrieveForResponder(args)`、`finalizeConversation(context)`、`forgetSummaryProjection(summaryRecord, options)`、`recoverPendingFinalizations(options)` | 现有 `MemoryEngine`。Recall、Finalize、Forget 和既有恢复入口继续由 Memory Engine/协调器负责。 |
| `worldline` | `getPromptContext(args)`、`getSubjectivePromptContextAsync(args)`、`getCheckpointStatus()` | 现有 `WorldlineService`。只读 CK3 检查点、身份/来源/时点校验和 fail-closed 规则保持原样。 |
| `action` | `evaluateForCharacter(conversation, npc, signal)`、`runInvocation(conversation, npc, invocation, options)` | 现有 Official VOTC Action Engine。既有确定性门禁、注册校验、Effect、ACK 与游戏回读责任不变。 |
| `letter` | `processLatestLetter(options)`、`clearLettersFile(receipt, recovery)`、`getAllLetterStatuses()` | 现有 `LetterManager`。投递、游戏回执、摘要归档及锁/恢复语义不迁移到 Port。 |
| `persistence` | `queryCandidates(scope, filters)`、`readEntry(scope, id, options)`、`audit(scope)` | 组合根传入的 `ScopedJsonRepository`。它复用同一 `Memory4Store`/`MemoryStore` 实例；候选定位、授权正文读取与只读匿名审计为独立能力。 |

具体形参名称以上表为便于阅读的合同说明；Port 保持原 owner 的实际 JavaScript 调用约定。Persistence 的新增最小合同采用真实 Repository API 的 `audit` 名称。它不声称 Repository 新增 Forget 或 Recovery 权威。

## 迁移边界

Main 已将现有 `ConversationManager` 同时注入 `conversation` 与 `presence`，并注入现有 `MemoryEngine`、`WorldlineService`、Action Engine 类、`LetterManager` 和 `Memory4Coordinator.repository`。同一个 `applicationServices` 对象传给 `Conversation.configure` 和 IPC 注册器；Conversation 使用 `memory.retrieveForResponder`，Memory4 Recall Planner 通过同一 Repository 做候选/正文读取，Finalize 通过 Repository 委托既有 `commitOwner`。生产入口还包括 CK3 game-load 会话创建、会话消息/Presence IPC、Worldline checkpoint、Action invocation、Letter 状态/处理与显式 Memory4 integrity-audit IPC。

Presence 不被提升为独立真相源；它是 Conversation 的有名应用能力。Memory 的 `forgetSummaryProjection` 与 `recoverPendingFinalizations` 仍委托 Memory Engine；Persistence 的 `audit` 通过 `memory4:integrityAudit` 显式触发，不在启动时自动执行。既有 `memory4:auditOrphans` 仍调用 `Memory4OrphanAudit`，两类报告职责不同。

## 验证边界

端口夹具验证稳定 key、方法缺失、owner `this`、原异常传播，并使用真实 `ConversationManager` 和 `Memory4Store` 检查创建/Presence 与 Scope/query 语义。`node scripts/test-v9.2-service-ports.js` 通过，并包含在最终 deployed 286 payload 的 418 groups exit 0 门禁中。端口 fixture 不是 CK3、Provider、打包窗口或长期运行验收；改名目录合并另有专项及实际 Renderer／Preload／IPC 冒烟证据。更新计数与边界见 [V9.2 实施与验证报告](V9_2_VERIFICATION_REPORT.md)。

# V9.1 架构审查与后续阶段移交

日期：2026-10-11。已阅读用户提供的重新审查方案和 V9 总路线；此次只落地 Source/Build。以下是当前代码证据和未来任务，不是本版新增功能。

## 当前依赖与所有权

路径以下按可编辑的 `src/app/main/` 表示；构建映射到 `resources/app/out/main/`。

| 模块 | 当前职责／写入权限 | 后续处理 |
|---|---|---|
| `main.js`、`ipc/register-ipc.js` | Electron 服务组合、生命周期和 IPC 注册 | V9.2 明确服务端口，保持 IPC 名称 |
| `conversation/conversation.js`、`conversation/` | 对话、在场与终局编排；直接协调 Memory、Worldline、Prompt、Provider、Action | V9.2 渐进梳理边界，先锁合同与失败路径 |
| `memory-system/memory4-coordinator.js` | 逐 Campaign/Owner 认知、召回、遗忘、恢复和派生协调 | V9.2 scoped 服务端口；Memory4 不换代 |
| `memory-system/memory4-store.js`、`memory4-contract.js` | JSON entry、索引、Scope、hash、revision、tombstone 验证 | V9.2 复用原验证器做只读 integrity report |
| `memory-system/memory4-orphan-audit.js` | 旧来源的只读审计；写入仍须经正式遗忘链路 | 禁止自动删损坏条目、重生已忘来源 |
| `worldline/`、`historical-system/` | CK3 事实投影、历史定义与 Runtime 绑定 | V9.2 只读端口；冲突与来源缺失 fail-closed |
| `prompts/prompt-builder.js`、`prompts/` | 现有稳定／易变块和缓存前缀合同 | V9.4 才引入 PromptPlan 与 serializer |
| `provider-service.js`、`providers/` | 参数编排、厂商请求、stream/usage 归一化 | V9.3 Provider conformance |
| `actions/run-file-manager.js` | 正式队列、carrier 写入、ACK、stall/recovery | V9.6 协议层；未知 Effect 不重放 |
| `actions/` | Official 2.0.3 候选门禁、绑定、Effect 和状态读回 | ACK 不等于效果 CONFIRMED |
| `letters/letter-manager.js`、`letters/` | 逐信件投递、游戏回执、摘要归档和恢复 | V9.6 保持投递与接收两类证据 |
| `renderer/`、`preload/` | 展示、用户操作与受限 IPC | V9.5 组件化和异步状态治理 |

Memory entry、Narrative Detail、Legacy 摘要和 Year/Life 派生视图继续由原服务拥有；JSON 存储、协议 3.0／摘要 2.5 不改变。Worldline 读事实，不写 CK3。文件操作仍由现有 Store/queue 提交，不在本次构建迁移中建立第二套写入权威。

## 新方案与旧路线的对应

| 新方案内容 | 按用户确认的旧路线归属 | V9.1 本次结果 |
|---|---|---|
| Conversation/Context Core、Memory4 接口、数据所有权 | V9.2 | 读取调用链、记录移交；不重构生产路径 |
| Worldline 查询边界、完整性审计 | V9.2 | 记录现有 Scope/绑定／hash 校验器；无自动修复 |
| Provider 统一 | V9.3 | 保留六类适配和原 usage 合同 |
| Prompt 上下文优化、缓存计划 | V9.4 | Prompt 与 cache anchor 原字节保持 |
| Renderer 解包、组件治理 | V9.5 | 保留可编辑的现有 ESM／CSS；未声称恢复组件源 |
| CK3 Bridge 协议统一与 Mod 纳管 | V9.6 | 只读审查，正式 carrier 与快照保留 |
| 性能优化 | 有现场诊断与可复现证据的对应阶段 | V9.0 默认关闭的诊断继续运行；不猜测删轮询 |

## 重构前必须保留的证据

Memory Store 已有 Scope、entry/index hash、revision、tombstone 和恢复校验；后续完整性检查应复用这些规则，输出有限原因码、计数和相对 ID。不得把未知旧来源推断成当前 Campaign，不得借审计重写叙事或弱化 knownBy。入口应先只读，修复须沿已有事务、恢复与遗忘合同。

Bridge 现有 `VOTC:RUN_ACK` 是 marker kind＋commandId，不是通用 success 布尔值。Action 要结合同命令 BEGIN—ACK 和真实前后状态才能 CONFIRMED；Letter 的 Effect ACK 与收信回执／记忆归档是独立阶段；DATE/IN 的会话事实不是命令完成 ACK。不能用统一 Envelope 把这些都改成“成功”。

当前启动／每轮停顿原因没有现场采样定案。Conversation 会协调认知观察、官方追忆、Worldline 预取、Memory/Prompt；日期扫描、正式 ACK 看门狗和剪贴板循环也存在。V9.1 字节等价不能证明卡顿消除。继续采集冷／暖阶段耗时，再在相应阶段做最小修复；既有用户验收不降级。

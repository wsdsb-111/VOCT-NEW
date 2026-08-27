# VOTC v7.9 / Action Engine 3.0 实施记录

## 版本边界

- 核心版本更新为 v7.9，动作系统标记为 Action Engine 3.0。
- Memory Engine 保持 2.5；人物目录、摘要写入、动态召回、在场窗口与最终摘要 Token 上限均未改变。
- 外挂 UI 与 CK3 模组版本继续保持 2.0.4。

## P0：Fork 自动更新隔离

- 更新源固定为 `wsdsb-111/VOCT-NEW`，缓存目录改为 `votc-new-updater`。
- 正式包启动时不会自动检查或安装更新；手动检查入口也在禁用状态下直接返回。
- 发布回归静态扫描更新配置、仓库身份和启动入口，禁止重新指向上游 `Voices-of-the-Court/VOTC`。

## 三模式动作框架

- 平衡模式为默认值，沿用 v7.8.3 的本地候选、严格语义白名单和 fail-closed 行为。
- 性能模式增加跨轮 `PendingActionIntent`。第一阶段覆盖结盟、停战和关系承诺；唯一且仍在最近上下文中的明确接受可完成双边承诺，拒绝、过期、多人歧义和模式切换均安全截止。金币、囚禁、死亡等请求仅确认提议，不把“好”当作动作已完成。
- 性能模式的 Semantic Rescue 只在 Event Parser 已确认当前动作发生、但本地语义模块未命中时调用；仅发送同类别最相关的 1–3 个候选和正反例，高风险动作不进入 Rescue。
- 精准模式优先复用本地确定性结果，其余真实对话消息进入轻量 Stage A。只有 `completed_action` 与有效的 `accepted_pending_commitment` 可以继续；Stage B 复用原 Action Provider，并通常只暴露一个动作。
- 三模式共用既有参与者绑定、参数验证、互斥语义、审批策略、事件去重和 Action Executor。模型不能自行改变 Source；待定意图确认继续使用提议时冻结的双方 ID。

## UI 与统计

- “操作”页顶部提供平衡、性能、精准三个并列模式按钮，与单个 Provider 的动作 JSON 架构类型相互独立；点击后立即保存，下一条真实消息按新模式判定，并清理旧模式下尚未完成的待定意图。
- 用量页新增 Action Engine 3.0 指标：本地事件、Pending 生命周期、Semantic Rescue、Precision Judge、Stage B 调用、本地/服务商执行、识别效率以及每 100 条对话的动作 API 调用；“动作系统模式”行可用三角形展开，分别显示平衡、性能、精准三种模式实际发出的动作 API 请求及累计 Token。

## 自动化验收

- `test-v7.9-updater-isolation.js`
- `test-v7.9-action-modes-pending.js`
- `test-v7.9-semantic-rescue.js`
- `test-v7.9-precision-judge.js`
- `test-v7.9-analytics-ui.js`
- `test-action-regression.js`
- `test-release.js`

自动化只覆盖静态合同、模块级和模拟 Provider/执行器回归。真实 CK3 指令落盘、真实服务商结构化输出、Token 与缓存命中率仍需在发布包中手动冒烟。

# VOTC v7.9.1 生产稳定性修复实施记录

## 定位

v7.9.1 是 Action Engine 3.0 的稳定性、成本与识别修复版。Memory Engine 保持 2.5；没有修改人物目录、摘要生成、动态摘要召回选择、Turn Recall 查询或既有摘要数据格式。

## 已实现

- ActionEngine 的 Precision Judge 已移出普通消息早期入口。真实消息先经过可用性过滤、Cheap Gate、ActionEvent、局部语义和参与者绑定；Semantic Rescue 仅处理 Gate 为正且本地语义未解析的事件；Judge 仅在 Rescue 后仍歧义、参与者歧义或符合模式限制的高风险未解析候选上调用。
- Precision Judge 接收同类别候选动作、已绑定的 source/target 和最近四条真实对白；仅当绑定本身歧义时才补充其他在场人物，不再把完整动作注册表和完整历史作为默认输入。
- 三种模式语义调整为：Performance 使用本地规则与 Rescue、关闭 Judge；Balanced 使用 Rescue，Judge 仅处理高风险未解析或多候选冲突；Precision 使用 Rescue 后的最终歧义仲裁。已确认的 Pending 不再次进入 Judge。
- 新增 `social-event.js`。亲吻、拥抱、牵手、依偎、抚摸、示爱及拒绝会产生社交事件，而不会固定映射为好感或关系改写；基础亲密互动不自动发起 CK3 Action Provider 请求。亲密请求进入无副作用的 Pending 记录，接受后也不会凭空写入 CK3 状态。
- PromptBuilder 将动态记忆/摘要块推迟到稳定前缀之后。固定锚点升级为 `VOTC_CACHE_ANCHOR_v4`；同一会话的角色基础资料与描述通过稳定序列化/缓存冻结。Prompt 元数据、用量记录和缓存归因包含 block hash、stable、position、稳定前缀 token 与动态后缀 token；`firstChangedBlock` 在用量报告中携带对应 hash、token 与稳定标记。
- 用量页保留三模式的折叠入口，并在每个模式内显示总 Token/请求数及 Stage B、Semantic Rescue、Precision Judge 的来源拆分。旧记录中没有 `actionStage` 的动作请求按 Stage B 归类；新 Stage B 请求会明确写入 `actionStage: "stage_b"`。
- 摘要页的记忆策略与用量页的适配状态均改为默认折叠；水墨主题的 Memory Engine 概览、人物摘要目录和对话分组改为柔和浅色纸面。以上仅为展示与统计改进，不修改 Memory Engine 2.5 的目录、摘要生成或动态召回。

## Hotfix：确定性金币转账与统计统一

- 新增 `money-lexicon.js` 和 `money-amount-resolver.js`。Candidate Gate、语义解析、参与者绑定与提议解析共用同一金币转账语义；本阶段稳定解析 `文/文钱/铜钱/金币/金/银币/两/两银子/贯/贯钱` 前的阿拉伯数字。
- `playerPaysGoldTo` 与 `paysGoldTo` 声明 `moneyTransfer`、`deterministicInvocation` 及 actor→patient 绑定。明确完成的转账会本地解析金额和唯一对象，并直接进入既有验证、审批与执行器，不调用 Semantic Rescue、Precision Judge 或 Stage B。
- “想/准备/愿意/可以……吗”等计划或提议，以及“没有接/没有给”等失败边界均不会直接执行。金额不明确但确有转账语义时仍允许按原链路降级到 Stage B；中文数字和历史货币换算留待 V8。
- 全局 Stage B、Semantic Rescue 与 Precision Judge 调用数不再依赖独立诊断计数器，而是与三模式明细一起从带 `actionStage` 的真实 Action 用量记录聚合；旧的无阶段 Action 请求兼容归入 Stage B。

## 回归范围

- 动作回归：普通对话、提问、计划、回忆、假设、失败尝试、已完成事件、Pending、审批、参与者绑定、去重与执行器。
- 社交事件：亲吻、未完成亲吻、亲密请求、拒绝亲密行为；3/4/6 人明确 actor/patient 绑定。
- 摘要保护：真实默认模板冒烟、Memory Engine 2.5 缓存保护与 v7.7.1 动态召回/Turn Recall 顺序测试。
- 金币 Hotfix：十种阿拉伯数字单位、三种玩家完成表达、NPC 转账、3/4/6 人唯一目标、提议/计划/拒收边界、明确金额零 Stage B，以及统计聚合一致性。

## 验证边界

自动测试验证本地逻辑、Prompt 顺序、请求元数据与 53 个直接发布回归组；明确金币转账的测试路径为零 Stage B。尚未用真实 Provider 对六人四轮场景做 API 成本统计，因此每百条动作 API、Chat token、服务端缓存命中率以及 V7 Final Stable 封档仍需实机复测确认。

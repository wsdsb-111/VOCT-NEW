# VOTC v7.9.1 生产稳定性修复实施记录

## 定位

v7.9.1 是 Action Engine 3.0 的稳定性、成本与识别修复版。Memory Engine 保持 2.5；没有修改人物目录、摘要生成、动态摘要召回选择、Turn Recall 查询或既有摘要数据格式。

## 已实现

- ActionEngine 的 Precision Judge 已移出普通消息早期入口。真实消息先经过可用性过滤、Cheap Gate、ActionEvent、局部语义和参与者绑定；Semantic Rescue 仅处理 Gate 为正且本地语义未解析的事件；Judge 仅在 Rescue 后仍歧义、参与者歧义或符合模式限制的高风险未解析候选上调用。
- Precision Judge 接收同类别候选动作、已绑定的 source/target 和最近四条真实对白；仅当绑定本身歧义时才补充其他在场人物，不再把完整动作注册表和完整历史作为默认输入。
- 三种模式语义调整为：Performance 使用本地规则与 Rescue、关闭 Judge；Balanced 使用 Rescue，Judge 仅处理高风险未解析或多候选冲突；Precision 使用 Rescue 后的最终歧义仲裁。已确认的 Pending 不再次进入 Judge。
- 新增 `social-event.js`。亲吻、拥抱、牵手、依偎、抚摸、示爱及拒绝会产生社交事件，而不会固定映射为好感或关系改写；基础亲密互动不自动发起 CK3 Action Provider 请求。亲密请求进入无副作用的 Pending 记录，接受后也不会凭空写入 CK3 状态。
- PromptBuilder 将动态记忆/摘要块推迟到稳定前缀之后。固定锚点升级为 `VOTC_CACHE_ANCHOR_v4`；同一会话的角色基础资料与描述通过稳定序列化/缓存冻结。Prompt 元数据、用量记录和缓存归因包含 block hash、stable、position、稳定前缀 token 与动态后缀 token；`firstChangedBlock` 在用量报告中携带对应 hash、token 与稳定标记。

## 回归范围

- 动作回归：普通对话、提问、计划、回忆、假设、失败尝试、已完成事件、Pending、审批、参与者绑定、去重与执行器。
- 社交事件：亲吻、未完成亲吻、亲密请求、拒绝亲密行为；3/4/6 人明确 actor/patient 绑定。
- 摘要保护：真实默认模板冒烟、Memory Engine 2.5 缓存保护与 v7.7.1 动态召回/Turn Recall 顺序测试。

## 验证边界

自动测试验证本地逻辑、Prompt 顺序和请求元数据；尚未用真实 Provider 对六人四轮场景做 API 成本统计。因此 0–5 次 Judge、每百条动作 API 上限、Chat token 降幅及服务端缓存命中率仍属于上线后的实测指标，而不是本地静态测试结论。

# VOTC v7.8.3 / Memory Engine 2.5 实施记录

## 实施范围

本版本按开发方案完成动作精度、动态记忆召回、缓存边界和多人关系权威层改造。人物摘要目录、IPC、Provider 配置、外挂 UI 2.0.4 与 CK3 模组 2.0.4 均不改格式或版本。

## 已实现

- 动作语义解析在未命中模块或白名单为空时 fail-closed，不再把空白名单解释为全部动作；请求、疑问、计划、回忆和含混描述不调用 Action Provider。
- `setEmotion` 使用本地确定性词组解析和明确人物绑定；含混或同时命中多个表情时不执行。同一回合相同 ActionEvent 只处理一次。
- `setEmotion` 本地解析无法唯一确定表情时直接 fail-closed，不再回退 Action Provider；完整链回归覆盖多表情与含混描述的 Provider 0 / Effect 0。
- 用量记录保留动作阶段、事件、调用来源和执行结果，并汇总本地动作、Provider 调用、空响应与执行效率。
- Memory Engine 2.5 新增 Turn Recall：当前用户消息是主查询，最近消息只辅助；本地意图门控后选 Top1，默认 256、硬上限 320 Token，同回合相同回应者和查询复用缓存。
- Turn Recall 意图门移除普通疑问词与单独人名触发；人物名仅用于实体排序且从词法查询中剔除。用量统计改为计算标题、记忆正文和权威规则组成的完整 Prompt 块。
- Explicit Recall 增加最低相关性门：主查询至少 0.08 或辅助上下文至少 0.20；无回忆词的相似度召回仍要求主查询至少 0.30。明确询问过去但没有相关记忆时返回 `explicit_recall_no_relevant_memory`，不再把无关 Top1 注入为权威事实，并在 Analytics 中按原因汇总。
- Session Topic Anchor 从动态历史尾部移到历史前冻结区；Turn Recall 则严格位于当前用户消息之后。上下文余量不足 192 Token 时跳过动态召回。
- 关系权威层覆盖全部当前在场人物，分别输出双向正式关系和当前好感；当前 CK3 数据代表现在，摘要只代表过去。
- 新写入摘要标记 `engineVersion: "2.5"`，2.3/2.4 人物目录摘要继续兼容读取；摘要文件与设置无需迁移。

## 自动验收

- `v7.8.3-action-precision`：语义失败关闭、本地表情、目标绑定、Provider 零调用和事件去重。
- `memory-engine-2.5-turn-recall`：意图门控、主查询相关度、Top1、知识权威文本、Token 上限和缓存命中。
- `memory-engine-2.5-cache-preservation`：稳定/直接召回不重排、Session Topic Anchor 冻结、Turn Recall 尾部顺序。
- `v7.8.3-relationship-authority`：全部在场人物、长幼关系、正式关系/好感分离、当前/过去权威边界。
- `scripts/test-release.js` 完整发布门禁通过：46/46 个发布组，测试清单覆盖 79 个测试文件。

## 仍需外部实机确认

自动测试不伪造真实 Provider、CK3 日志、服务商缓存或 GitHub 发布环境。发布前仍应完成长对话 A/B 缓存对照、三人真实对话、动作模型 Provider 统计、最终摘要质量以及 CK3 游戏内效果验证。

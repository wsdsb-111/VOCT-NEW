# V9.5.0 异步与双语验证

2026-10-23，代码 SHA `d8db0eeb66bccb3b95712401f581dfce1e302e24` 的 [Windows CI 39844302011](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39844302011) **PASS**：343 项构建／部署一致性、完整 501 组回归，以及完整 EXE 冷启动／重启／媒体加载均通过。629 个测试文件已分类，127 项历史检查归档。Payload SHA256 `ed5482336f61203ef5b62414bbf93a912a99c06d46f9533e866017a4a4735afd` 与本机已部署资源一致。后续若仅更新本文等记录，不将文档提交冒充重新运行的代码 SHA。

## 本轮覆盖

- UI 语言独立字段／IPC，只接受 zh-CN、en-US；旧动作语言、Prompt、Provider 配置和游戏语言不随 UI 切换写入。
- Main opaque scope、逐资源 latest read、上下文 epoch、取消、退订、来源与修订复验、Provider 模型列表归属以及未知写效果不重放专项通过。
- Pair、人物认知、World Memory 的固定标签在语言切换时更新，保留草稿和焦点；姓名、事实与来源正文不翻译。725 个双语键、完整层级及打包词典检查通过。
- 原页面的三主题／双语／透明背景在实际 Renderer 入口和匿名 Preload 下验证，零外部请求／业务副作用。独立工作区已撤下，不以旧八域工作区冒烟作为当前功能。
- 世界记忆相关 21 项专项已串行核对；旧测试改为检查真实 copy／映射／读取接线，当前事实白名单、迁移 ACL、只读、developer 门禁和分支拒写保护保留。
- 完整历史原文 Canon 保存与回读通过；“战事仍在持续”不再误判为人物当前状态。明确当前状态仍要求结构化 CK3 核验。
- DeepSeek 交付 22/22、生命周期 3/3；弹窗焦点、行替换焦点和过期过渡检查通过。通用八域 fixture 不代表全部旧功能 DOM 已迁移。

## 限制

旧功能页尚未完成全面双语／容器迁移。复杂 Summary 结果、Letters 开发诊断仍有历史文案；官方追忆诊断按钮的旧 getOfficialRecollection 路径未迁入新的 scoped read boundary，不把该路径标为已覆盖。真实 CK3、真实 Provider、本机手动输入／穿透和 Soak 仍未验收；性能 A/B 为 NOT_MEASURED。

旧 SHA 失败、隔离环境诊断和最终精确 CI 记录见[发布验证](V9_5_RELEASE_VERIFICATION.md)。共享契约 revision 1 保留，独立工作区生产接线已撤下。

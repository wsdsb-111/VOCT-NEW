# V9.5.0 Candidate 实施记录：工作区、语言隔离与异步展示

日期：2026-10-22。Core／App／UI 元数据为 9.5.0 候选。本记录描述已接入的源码与 Root 串行验证结果，不代表完整发布验收。

## 范围

V9.5 增加“V9.5 工作区”只读面板，以冻结的 `v95-view-v1` revision 1 合同将八类已有授权数据接到 DeepSeek 提供的视觉模块：对话、Legacy Summary、人物认知、世界线、信件、动作活动、Provider 诊断和设置。数据由 `workspace-controller.js` 从现有 Main／Preload 只读接口读取，按当前 Campaign、Owner、Conversation、conversation epoch 与 active 标志执行 latest-wins；数据再经 `domain-container.js` 和 `snapshot-presentation.js` 投影到 `mountByKind`。旧 scope 的记录立即作废；不清楚来源或状态时保留 UNKNOWN／unknown，而不合成成功状态或零值。

新面板不接入业务写入。浏览、分页和详情使用只读投影；没有外部 intent 回调时只打开安全的本地详情。编辑、审批和原始来源仍由旧页面控件处理，视觉层不会将按钮点击或回调完成冒充 Main 成功，也不会重放未知效果。既有对话 Markdown、编辑器、审批及来源控件仍由原容器提供；V9.5 没有把所有旧 DOM 和旧业务页重写为新视觉模块。

契约字段、intent、未知状态、无副作用与富文本边界见 [V9.5 共享展示契约冻结](V9_5_VIEW_CONTRACT_FREEZE.md)。视觉渲染将正文写入文本节点；来源 key、路径、密钥和未经投影的 Main 对象不进入行数据。图标只接受本地语义名，未知值回退本地图标；没有外链图标加载。

## 语言与兼容边界

Main 设置使用独立的 `uiLanguage` 字段和 `getUiLanguage`／`saveUiLanguage` IPC；只接受 `zh-CN`、`en-US`，无效读取回退简体中文，无效保存拒绝。它保留原 `language`、`getLanguage`／`saveLanguage` 及其消费者行为。`getLanguagePreferences()` 将旧值明确标为 `promptLanguage`，来源为 `legacy-action-language`；这代表动作本地化及更新文案的既有语言事实，不代表通用聊天 Prompt 语言。游戏语言目前报告 `unknown`。

Renderer runtime 通过 `i18next.changeLanguage('zh'|'en')` 切换 UI 字典，并在保存独立字段后回读确认。语言切换不调用旧 `saveLanguage`、不改变 Prompt 内容或业务本地化语义。新增的 Pair 长期记忆、人物认知和 World Memory 编辑器接收受控 `t`；既有无 `t` 调用仍使用原中文。语言更新只刷新显示，不重新发送 IPC、提交写入或丢弃编辑草稿。

主 UI 对导航、流式／在场控制、上下文用量、Summary 工具栏与确认、Letters 按钮及 Provider 预算标签增加了 80 个精确 UI 替换片段。替换只覆盖固定 UI 文案；人物姓名、事实正文、Prompt 示例、动态日期和业务来源标识保持原值，不做整 DOM 自动翻译。

覆盖范围仍是分阶段迁移。Letters 开发诊断、Summary 的复杂结果信息和其他历史常量尚未完成全面双语审计；不能将当前 80 个替换片段描述成整个旧 UI 已完整翻译。新旧容器并存期间，这些未覆盖区域仍可能显示原有中文或英文。

## 主题与动效

新视觉模块沿用 `parchment`、`knight`、`ink` 三个主题键和既有背景图 URL。V9.5 展示标志开启时，主题专属色彩变量和阅读 veil 覆盖内容层，不替换主题图片；焦点样式使用可见轮廓。常规过渡为 150ms，`prefers-reduced-motion: reduce` 时关闭过渡和悬停位移。

同机没有可比的 V9.4／V9.5 性能基线，启动、渲染、内存或响应性能变化均为 **NOT_MEASURED**，不据此宣称提升。

## 兼容与状态

Prompt bytes、Official Action、Legacy Summary 的现有业务与存储合同、Main 权限门槛及现有编辑／审批／来源流程不因 UI 语言变化而改变。新的展示面板只读取当前授权快照；翻译只作用于固定 UI 标签，不翻译姓名、摘要正文、人物事实、信件内容、世界线事实或动作结果。

版本目标为 9.5.0 candidate。346 项构建／部署一致性已通过；远端 CI 和完整 EXE 验收状态见发布验证记录；不得将当前源码或单次 Chrome 检查表述为正式发布或 Full Freeze。验证细节见 [异步与双语验证记录](V9_5_ASYNC_I18N_VERIFICATION.md)。

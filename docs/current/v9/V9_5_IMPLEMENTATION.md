# V9.5.0 Candidate 实施记录：原页面、语言隔离与异步状态

日期：2026-10-23。Core／App／UI 元数据为 9.5.0 候选。本记录描述当前源代码范围和已知验证状态，不代表完整发布验收。

## 当前修正验证

2026-10-23 已提交推送 `31037d9`。本机 build、verify、deploy 和 deployed parity 通过：343 项映射，Payload SHA256 `d2d28139fe24ec47fe40cac2e0b059f31a91c6e1e416ab424783a8c8a6958430`。原功能页的三主题／双语、透明底色、保留主题图片、焦点和零业务副作用通过单 Chrome 匿名 Preload 冒烟；工作区 UI 未接入。历史世界记忆完整原文的 Canon 保存／回读与当前状态反例通过。旧 knowledge-ui 断言已按实际 `t` 与 `updateLanguage` 接线更新并在本地通过，原安全／作用域断言保留。最新提交的完整 Windows CI 等待中。

## 范围

用户反馈原有功能页已足够，并指出新增白色大面板遮挡了主题背景。已移除独立“V9.5 工作区”UI 和其专用生产接线；浏览、编辑、来源查看及审批继续使用原有功能页面与业务容器。`v95-view-v1` revision 1 通用契约和共享展示组件保留，供通用适配使用；独立工作区不再接入当前 UI。

现有聊天 Markdown、Summary、Letters、Official Action、人物认知、世界线、设置和 Provider 页面继续使用各自既有业务入口；本轮不增加第二套只读工作区，也不改变原编辑、审批、来源复验或 Main 权限流程。契约字段、intent、未知状态、无副作用与富文本边界见 [V9.5 共享展示契约冻结](V9_5_VIEW_CONTRACT_FREEZE.md)，契约和共享组件保留，工作区专用生产接线已撤下。旧功能页面尚未全面迁移到通用展示组件。

## 语言与兼容边界

Main 设置使用独立的 `uiLanguage` 字段和 `getUiLanguage`／`saveUiLanguage` IPC；只接受 `zh-CN`、`en-US`，无效读取回退简体中文，无效保存拒绝。它保留原 `language`、`getLanguage`／`saveLanguage` 及其消费者行为。`getLanguagePreferences()` 将旧值明确标为 `promptLanguage`，来源为 `legacy-action-language`；这代表动作本地化及更新文案的既有语言事实，不代表通用聊天 Prompt 语言。游戏语言目前报告 `unknown`。

Renderer runtime 通过 `i18next.changeLanguage('zh'|'en')` 切换 UI 字典，并在保存独立字段后回读确认。语言切换不调用旧 `saveLanguage`、不改变 Prompt 内容或业务本地化语义。新增的 Pair 长期记忆、人物认知和 World Memory 编辑器接收受控 `t`；既有无 `t` 调用仍使用原中文。语言更新只刷新显示，不重新发送 IPC、提交写入或丢弃编辑草稿。

主 UI 对导航、流式／在场控制、上下文用量、Summary 工具栏与确认、Letters 按钮及 Provider 预算标签增加了 80 个精确 UI 替换片段。替换只覆盖固定 UI 文案；人物姓名、事实正文、Prompt 示例、动态日期和业务来源标识保持原值，不做整 DOM 自动翻译。

覆盖范围仍是分阶段迁移。Letters 开发诊断、Summary 的复杂结果信息和其他历史常量尚未完成全面双语审计；不能将当前 80 个替换片段描述成整个旧 UI 已完整翻译。新旧容器并存期间，这些未覆盖区域仍可能显示原有中文或英文。

## 主题与动效

主题继续使用 `parchment`、`knight`、`ink` 三个键和既有背景图 URL。视觉调整回到原功能页面呈现，并降低大面板遮罩的不透明度，让主题背景可见；不替换背景图片。可访问焦点轮廓和 reduced-motion 约束保持。

同机没有可比的 V9.4／V9.5 性能基线，启动、渲染、内存或响应性能变化均为 **NOT_MEASURED**，不据此宣称提升。

## 兼容与状态

Prompt bytes、Official Action、Legacy Summary 的现有业务与存储合同、Main 权限门槛及现有编辑／审批／来源流程不因 UI 语言变化而改变。翻译只作用于固定 UI 标签，不翻译姓名、摘要正文、人物事实、信件内容、世界线事实或动作结果；移除工作区不改变这些业务边界。

此前含独立工作区的构建部署批次有 346 项映射通过，Payload SHA256 为 `1a800b12bda2e750174a7bdf0452d0dd0451cf351ca5637a50655f364958e3c2`；该旧批次 EXE 检查通过，但不代表当前源码。前次 SHA `ff86656` 的 [CI run 39822389302](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39822389302) 因旧 `knowledge-ui` 源码断言停止，该 SHA 全量验证失败；断言现已修正且本地通过。当前已推送 SHA `31037d9` 的 343 项 build/deploy/verify 及本地 Chrome、Canon 回归见上方；最新 SHA 的完整 CI 等待中。V9.5 继续保持候选，不签署 Full Freeze。验证细节见 [异步与双语验证记录](V9_5_ASYNC_I18N_VERIFICATION.md) 和[发布验证记录](V9_5_RELEASE_VERIFICATION.md)。

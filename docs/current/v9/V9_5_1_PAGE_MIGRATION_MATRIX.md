# V9.5.1 原业务页共享组件接线矩阵

本文按 2026-10-23 当前 Renderer 源码记录生产调用点。矩阵区分“源代码中存在受控调用”与构建部署、Electron 视觉验收；静态接线不等于窗口视觉已验收。

## 共享组件入口

`src/app/renderer/v95/integration/react-visuals.js` 的 `createReactVisuals({ jsxRuntime, iconRegistry })` 提供 React `Icon`、`StatusBadge` 和旧 DOM 小模块可选调用的 `decorateLegacyRow`。React 页面显式传入图标名、状态码和当前显示标签；旧 DOM 调用只将图标插入传入的当前行标题节点。该模块不扫描页面、不读取业务数据、不调用 IPC。

主 Renderer bundle `src/app/renderer/assets/index-Dn3qWlAB.js` 导入工厂，并在 `jsxRuntimeExports = requireJsxRuntime()` 之后创建实例、赋给 `window.VOTCV95PageVisuals`；React root 在后续初始化。`build/runtime-inputs.json` 已登记 adapter 的 Runtime 映射。此处证明源码调用与映射声明，不证明构建或部署产物。

## 页面矩阵

| 页面 | 已核实的实际生产调用 | 仍未接入 / 范围限制 | 业务边界与验证状态 |
| --- | --- | --- | --- |
| Connection / Provider | `.provider-list` 中实际 Provider `<li>` 标题前显式渲染 `Icon(name: "provider")`；原 `onSelectProviderType(type)` 与 `getProviderDisplayName(type)` 仍在该行。 | 模型、连接状态、空状态、错误提示、preset 行未由这次 adapter 接线。 | 图标只参与显示；源码调用存在，已构建部署；实际八页浏览器验收见验证报告。 |
| Settings | 原 Settings 表单 `.form-group` 中 `label[for="globalStreamEnabled"]` 显式渲染 `Icon(name: "settings")`；同页 `V95UiSettings` 语言偏好段落也有图标。 | 其他设置表单项仍保持原样。 | checkbox 的 `id`、`name`、checked 来源和 `handleGlobalStreamToggle` 保留；语言偏好与 Presentation 控件原节点仍在。源码调用存在，实际浏览器验证见验证报告。 |
| Actions | `.action-title-group` 标题前显式渲染 `Icon(name: "action")`。Action feedback 的 `.action-feedback-status` 在有 `lifecycleLabel` 时调用 `StatusBadge(code: lifecycleStatus, label: lifecycleLabel)`。 | `ActionApprovalItem` 的状态仍是普通文本。状态组件只认识共享状态枚举；其他 lifecycle code 会显示原 label，但组件按 `UNKNOWN` 样式归类。 | 标题点击校验回调、反馈正文和审批容器保留。不得把 badge 当作 ACK/效果判定；源码调用存在，实际浏览器验证见验证报告。 |
| Prompts | `.main-prompt-card` 主 Prompt 标题有 `Icon(name: "edit")`；真正的 Prompt Preview `previewData.blocks.map(...)` 中，每个 `.preview-block .block-title` 也显式渲染该共享图标。 | 可编辑模板库 `renderBlock` 的逐块标题也接入共享图标；拖拽与编辑按钮保留原控件，Preview header 有自身标题图标。 | Preview block 的展开点击、标签、类型、错误标记与 token 数仍由原容器提供；模板编辑、保存和重置流程不变。源码调用存在，实际浏览器验证见验证报告。 |
| Summary / Legacy Summary | 每个 `.summary-item .summary-header .summary-date` 前显式渲染 `Icon(name: "memory")`。 | 当前图标对 Legacy 与 Official Recollection 都使用 `memory`，没有依据 `sourceType` 切换；摘要操作/编辑/来源结果状态未改为共享 status。 | Official Recollection 标签和日期仍按原逻辑输出，摘要数据及操作容器保留；源码调用存在，实际浏览器验证见验证报告。 |
| Optimization / Metrics | 主报告 `.optimization-metrics` 的实际 `metrics.map(...)` 每行显式渲染 `Icon(name: "optimization")`；共享 `metric(label, value)` helper 也用于其其他指标行。 | `.optimization-error` / `.optimization-loading` 仍按原组件输出，没有改成 StatusBadge；这些是读取状态/错误提示，不是指标行。 | 指标值和现有统计调用未改变；源码调用覆盖主指标列表，实际浏览器验证见验证报告。 |
| Worldline / Canon | Worldline pipeline 状态节点调用 `StatusBadge`，传入 `apiReady ? pipelineStatus : "UNKNOWN"` 和原本地化 label。真实事实、subjective facts、诊断、关系候选/路径/差异和世界知识等多组列表行调用 `Icon(name: "worldbook")`。 | Prompt/token 原始诊断、部分身份候选、年度变化、历史映射及补充知识行仍保留原复杂行布局，没有共享图标；不代表全部 `.worldline-row` 已迁移。 | Worldline 数据、只读 / Canon 容器与状态生产逻辑不迁入组件；至少多组实际列表与 pipeline 状态已接线，实际浏览器验证见验证报告。 |
| Letters | 每个 `LetterItem` 的 `.letter-header` 在折叠图标和 Letter ID 前显式渲染 `Icon(name: "letter")`。 | 分组标题未接此图标；响应/摘要状态继续走 `getStatusIcon`、`getStatusText`，没有共享 StatusBadge。 | `onToggle`、原状态图标/文案、送达与 ACK 流程保留；实际邮件项目标题区域已接线，实际浏览器验证见验证报告。 |
| World Memory Editor | 当前记录行标题的 `strong` 内通过 `window.VOTCV95PageVisuals?.Icon` 使用 `worldbook` 图标，同时保留 `record.title` 和原 status tag。 | Legacy entries 的另一列表渲染分支未加图标。 | 编辑器、状态和业务容器保持原实现；仅当前记录标题有受控可选图标，实际浏览器验证见验证报告。 |
| Knowledge facts | `character-knowledge-ui.js` 创建当前 `.character-knowledge-fact-heading` 行后，显式调用 `decorateLegacyRow(row, { target: title, icon: "knowledge" })`。 | 共享接线仅为该标题图标，不替换事实/状态行及编辑控件。 | 目标必须属于传入行；原文本、事件、开关和来源/修订信息保留。源码调用存在，实际浏览器验证见验证报告。 |
| Pair long-term ledger | `pair-long-term-ui.js` 创建当前事项文本后，显式调用 `decorateLegacyRow(row, { target: itemText, icon: "memory" })`。 | 共享接线仅为事项标题图标，不替换整行或来源状态。 | 原事项文本、来源展开、分页及回填确认流程保留。源码调用存在，实际浏览器验证见验证报告。 |

## 专项证据与边界

`scripts/test-v9.5.1-page-integration.js` 通过真实 bundle 中的 JSX 调用 pattern、运行时初始化顺序、共享图标 ID、状态 label 输入和关键原业务 handler 字段核验接线；具体断言包含 Settings 的 `globalStreamEnabled` 表单标签、Prompt Preview 每个 block 标题、Optimization 主 `metrics.map`、Worldline 实际列表与状态，以及 Letter item 标题。测试也覆盖 adapter 对旧行文本、DOM 事件、重复插入和越界目标的保留行为。测试不证明 Electron 中每种状态都实际渲染，也不证明映射已构建部署。实际浏览器八页和构建部署已由Root完成；本机EXE失败与远端CI状态见验证报告。

该矩阵只记录当前源代码证据，不把未接入行标成完成项。本次达到各原页面至少实际列表／状态／图标区域的共享接线目标，复杂编辑器及既有业务行为按表中例外保留；异步、双语、导航及完整门禁实际结果见[V9.5.1验证](V9_5_1_VERIFICATION.md)。

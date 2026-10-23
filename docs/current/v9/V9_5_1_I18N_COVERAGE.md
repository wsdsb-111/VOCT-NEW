# V9.5.1 固定 UI 双语覆盖矩阵

日期：2026-10-23。本文记录 V9.5.1 本轮指定旧页面的固定文案覆盖，不代表整个 Renderer 已完成国际化，也不代表完整发布验收。

## 覆盖审阅

| 页面 / 组件 | 本轮固定 UI 文案 | 语言切换行为 | 保留原值的内容 |
| --- | --- | --- | --- |
| Canon / `WorldMemoryEditor` | 表单、按钮、picker、状态、类型、错误及辅助说明通过 `worldMemoryEditor.*` 字典和 `EDITOR_COPY_KEYS` / `uiText` 映射；Canon 的当前状态错误有中英词条 | Renderer 将稳定 `v95Runtime.t` 传入组件，React 页面切换语言时重渲染；`test-v9.5-canon-state-context.js` 验证当前状态错误的双语译文和安全键映射，但未单独挂载整个编辑器做语言往返 | Canon 标题／正文、人物姓名、日期、状态证据和来源保持原值。`world-memory-editor.js` 的 `TEMPLATES` 的样例标题和正文仍为中文，模板按钮名称通过 `templates.*` 词条显示；这是此前明确排除的示例 Prompt 内容，不是游戏事实。 |
| Character Knowledge / `character-knowledge-ui.js` | 当前对话标题、选择器、事实类型／状态、来源和错误提示使用受控 `t` | `test-v9.5-legacy-i18n.js` 用真实 `createUiTranslator` 验证英中往返、姓名／日期／事实保留、焦点保留且不重取 IPC | 人物姓名、事实值、日期和来源 key 保持原值。 |
| Pair Ledger / `pair-long-term-ui.js` | 页面、分页、预览／确认／来源／错误等固定 UI 使用受控 `t` | `test-v9.5-legacy-i18n.js` 验证真实双语译者往返、搜索草稿／焦点保留、不重读来源、不回填或写入 | 人物姓名、摘要正文、日期、来源 key／ID 保持原值。 |
| Summary / `SummariesManager` | 已验证来源定位结果、摘要重试与重整状态、模型失败分类、单篇与批量 Campaign 绑定确认／预览／结果／已知错误、搜索匹配标签与计数、目录和编辑信息标签、恢复状态和诊断空状态 | 保存显示键和参数；重新渲染时按当前 UI 字典生成消息。确认框即时使用当前语言。搜索分类会在 `i18n.language` 改变时重算。语言变化不调用摘要重试、重整、绑定或来源读取。 | 人名、摘要正文和日期、Campaign token、原摘要身份、来源标识及诊断 JSON。来源定位的实际比较、展开与绑定业务条件不变。 |
| Letters / `LettersStatusModal`、`LetterItem` | 重试／取消／清除确认、载荷错误状态、日期异常、队列 BLOCKED／STALLED 说明、Effect 诊断标题／阶段说明／禁用原因／可见结果确认、日期诊断标签、投递日期偏差、开发者模式说明 | UI 发起的操作结果以 locale key 和参数保存，现有结果可随语言重绘；切换本身没有 IPC 或写入调用。 | Letter ID、收件人姓名、正文、游戏日期、文件名、ACK／Effect 状态码及 Main 返回的动态错误字段保持原值。 |
| Provider diagnostics / `ProviderDiagnosticsView` | 中英文列头、统计项、前缀分档与间隔表使用页面内 `text(zh, en)`；原来两语同为英文的固定标签及 UNKNOWN 脱敏说明已补中文。比较详情中的 Conversation Prefix、Endpoint、Effective Params、Provider Cached、Ratio 和 Estimated 也按语言显示 | `i18n.language` 选择 `text` 的中文或英文值；新增测试核对固定标签调用及两种语言输出。复杂诊断表的全页浏览器往返回归未单独执行 | Provider／模型／路由、请求记录、指标、hash、Endpoint 值、诊断代码和实际 UNKNOWN 状态保持原值；脱敏诊断 JSON 不翻译。 |
| Optimization / `OptimizationView` | 固定文案使用页面内 `text(zh, en)`；Token 数字随语言格式化。与 Provider diagnostics 共用的 Provider 名称和技术值仍保留来源形式 | 继续使用既有语言选择逻辑；本轮未改优化行为或请求参数 | Provider 与模型名、原生指标、Endpoint、请求记录和诊断代码保留来源值；脱敏诊断 JSON 不翻译。 |
| Worldline / `WorldlineView` | 原来两语同为英文的诊断标题、schema 字段标签、身份／历史／关系检查标签和 World Prompt Token 标签均改为 `text(zh, en)`；记忆／世界线 Token 标题也补中译 | `i18n.language` 选择 `text` 的中文或英文值；新增测试核对固定标签调用及两种语言输出。Worldline API、事实处理和 Canon 保存门槛未改变 | CK3 人名／头衔、事实、日期、来源 key、Runtime ID 的值、证据原文、补充知识标题和正文均保留原值。 |
| Prompt Builder / `PromptsView` | “This block uses the main prompt text or conversation history.” 帮助语按当前语言显示；pinned 徽标改用已有 `prompts.pinned` 中英词条 | 页面现有 `useTranslation()` 的 `i18n.language` 分支和词条随语言切换；测试核对两种 pinned 词条及帮助语接线 | 主提示词、对话历史、用户自定义区块正文和区块顺序不变。 |
| 核心导航、Conversation、Action、Provider 设置及其他 Prompt 页面 | 使用已有 `legacyUi.*` / `v95.*` 调用和页面内文案；本矩阵不将这些页面的每个状态／分支计作全部双语覆盖 | 顶部导航及设置接线由同轮其他改动处理；新增测试覆盖此处列明的 Provider diagnostics、Worldline 与 Prompt Builder 固定标签，但不替代整页人工验收 | 聊天 Markdown、用户输入、Prompt 正文、Action 回执及 Provider 配置值／模型名均保留业务原值。 |

Summary 与 Letters 的新增词条单独存于 `src/app/renderer/v95/i18n/locales/v9-5-1-legacy-ui.js`，并由 `src/app/renderer/v95/i18n/index.js` 合入现有 `v95` catalog。Renderer 只在既有显示／确认边界读取这些词条；没有通用 DOM 替换器，也没有新增业务 IPC 或网络调用。

## 固定文案与动态原文边界

- Provider diagnostics 的可见固定列头和说明现在都有中英分支。原生用量、估算值、UNKNOWN／YES／NO 等状态值、请求记录、Provider／模型／路由、hash 和原始诊断 JSON 仍是技术或来源数据，测试不会把这些值当作 UI 文案替换。
- Worldline 的诊断 schema 标签（例如 Runtime、Definition、`definitionId`、`sourceComplete`、`matchedRawKeys`）显示时已本地化；字段所承载的 ID、bool、姓名、头衔、事实、日期、来源正文和补充知识内容保持原文。`UNKNOWN`、原始 JSON 与事实中出现的任意语言不会通过通用 DOM 翻译。
- Canon 编辑器固定控件已接字典，但内置示例模板 `TEMPLATES`（`world-memory-editor.js`）的样例标题和正文仍保留中文，模板按钮名称已有中英词条；这是此前明确排除的示例 Prompt 内容，不是动态游戏事实。
- Summary／Letters 的 178 个新增叶子键、Canon、Knowledge、Pair、Provider diagnostics、Optimization、Worldline 和 Prompt Builder 各自沿用受控的本地化路径；本轮没有将所有旧页面迁入 `legacyUiV951`，也没有通用 DOM 替换器。

## 边界与未覆盖项

- 顶部导航及官方追忆按钮处理由本轮其他改动负责；本文件不将其计入本矩阵。官方追忆正文仍以 CK3 原文显示；编辑说明只翻译固定 UI 外壳。
- Summary 的完整摘要正文、用户输入、来源正文和诊断 JSON 不翻译。Letters 中 Main 返回的任意错误细节及技术状态码可能继续以原文显示；本轮只翻译固定 UI 提示和明确的已知状态。
- Optimization 的既有双语覆盖来自 Renderer 内联文案，不在本轮迁入新 locale fragment。Provider diagnostics、Worldline 与 Prompt Builder 的列明固定标签已做受控双语映射；静态／专项检查不证明每种运行状态均已在打包窗口逐项目视验证。
- 追加截图范围：连接 Schema delivery、DeepSeek 选项、GLM 推理与 clear thinking、最终摘要最大输出 Token 已接双语；英文动作列表使用只读 DTO 中的原英文标题，旧执行语言保持。
- Conversation 正文、Prompt、动作结果及未列明的历史 UI 常量不在本轮覆盖。旧页面整体并未完成全面双语迁移。

## 验证

`test-v9.5.1-i18n-coverage.js` 在 `384 MB` Node 堆和工作区临时目录下通过：178 个新增叶子键的中英数量、路径和插值参数一致，真实 `createUiTranslator` 可解析全部词条，Summary／Letters 的生产调用与保存的结果 key/参数都存在，切换译者可重绘结果且不改变描述符；测试还核对 Provider diagnostics、Worldline 列明的固定文案在两种语言下选择正确，并核对 Prompt Builder 帮助语与 pinned 词条。摘要／信件正文仍直接使用源值。既有 `test-v9.5-legacy-i18n.js` 覆盖 Knowledge／Pair 的真实译者往返，`test-v9.5-canon-state-context.js` 覆盖 Canon 当前状态错误词条。专项检查不替代 Provider diagnostics／Optimization／Worldline 全页交互回归；本矩阵的专项之外，构建部署、实际生产入口的离线浏览器八页/三主题/双语检查及完整门禁的最终状态见 V9_5_1_VERIFICATION.md；不据此声称真实 CK3 或 Provider 已通过。

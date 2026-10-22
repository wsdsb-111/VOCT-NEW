# V9.5.0 Candidate 异步与双语验证记录

更新日期：2026-10-23。本文区分独立工作区移除前的历史检查、当前已通过的本机验证和仍待运行的 CI。旧 SHA 的失败保留为历史记录；最新提交的完整 CI 尚无结果。

## 当前修正验证

2026-10-23 工作区移除已推送 `31037d9`，本轮另补齐头部旧渐变清除。本机 build、verify、deploy 和 deployed parity 通过：343 项映射，Payload SHA256 `d2d28139fe24ec47fe40cac2e0b059f31a91c6e1e416ab424783a8c8a6958430`。原功能页的三主题／双语、透明底色、保留主题图片、焦点和零业务副作用通过单 Chrome 匿名 Preload 冒烟。历史世界记忆完整原文的 Canon 保存／回读与当前状态反例通过。旧 knowledge-ui 断言已按实际 `t` 与 `updateLanguage` 接线更新并本地通过，原安全／作用域断言保留。本轮提交的完整 Windows CI 等待中。

## 当前状态

用户确认原有功能页面已满足需求，并反馈白色大面板遮挡主题背景。Root 已移除独立“V9.5 工作区”UI 和专用接线，将视觉呈现回归原功能页并降低大面板遮罩不透明度。通用视图契约和共享展示组件仍保留；独立工作区集成检查只作为历史结果，旧功能页面尚未全面迁移。

前次 SHA `ff86656` 的 [CI run 39822389302](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39822389302) 在旧 `knowledge-ui` 源码断言处停止；**FAILED 仅归属该旧 SHA**，后续检查未完成。断言已按实际 `t` 和 `updateLanguage` 接线修正并本地通过；新 SHA `31037d9` 的完整 CI 等待中，不预写结果。

## 移除前的历史专项记录

以下结果来自包含工作区 UI 的旧源码批次，保留作历史证据，不认证移除后的当前源码：

| 检查 | 移除前结果与边界 |
|---|---|
| `test-v9.5-view-contract.js` | 历史 PASS：80 项双语 kind／state fixture 和 734 项双语字典键／插值检查；revision 1 原 91 个合同键保持。通用契约和共享组件仍保留，独立工作区 UI 已移除。 |
| `test-v9.5-async-state.js`、`test-v9.5-main-scope.js` | 历史 PASS：scope 变化、乱序读、取消和未知效果边界；未知写效果需要 Main 回读，不自动重放。当前全量运行未走完。 |
| `test-v9.5-workspace-controller.js`、`test-v9.5-renderer-reads.js`、`test-v9.5-renderer-runtime.js` | 历史 PASS：当时的八域只读投影、Renderer 白名单、运行时资源和上下文切换。工作区专用实现已移除，这些结果不作为当前功能或验收依据。 |
| `test-v9.5-language-settings.js`、`test-v9.5-legacy-i18n.js`、`test-v9.5-legacy-async.js` | 历史 PASS：UI 语言与旧动作语言隔离、旧 DOM 双语更新、事实正文保留，以及草稿／焦点边界；需以当前 SHA 完成后的门禁确认。 |
| `test-v9.5-provider-model-scope.js`、`test-v9.5-domain-containers.js` | 历史 PASS：此前 Provider／容器专项；不替代当前源码的完整验证。 |
| 实际 Renderer 页面入口与匿名 Preload 的 Chrome 检查 | 移除前历史 PASS：八域、三主题、双语和焦点；当时观察到零外部请求与零业务副作用。工作区已移除，不能代表当前页面验证。 |

移除前本机 build/deploy 曾报告 346 项映射通过；对应 Payload SHA256 为 `1a800b12bda2e750174a7bdf0452d0dd0451cf351ca5637a50655f364958e3c2`。该 payload 属于含工作区的旧批次。其 EXE 检查通过，但不能验证工作区移除后的当前源码或构建产物。DeepSeek 交付／生命周期 22/22 与 3/3 结果保留为此前审查证据，不等同于当前发布门禁通过。当前 343 项部署、原页面 Chrome 冒烟，以及完整历史原文 Canon 保存／回读和当前状态反例均已通过，见上方。

## 待完成验证

- 对最新提交 串行运行完整 Windows CI；目前等待中。旧 SHA `ff86656` 的失败已留作历史证据，knowledge-ui 断言修正已本地通过。
- 当前 343 项 build/deploy/deployed parity 和原功能页 Chrome 冒烟均已通过；最新 Payload 不等于当前源码 EXE 验证。
- 最新历史世界记忆回归已通过；完整原文保存并回读，当前状态反例仍被拦截。只使用合成临时战役，未写用户记忆。
- 真实 CK3、真实 Provider、新增外部业务效果和长时间 Soak 未执行。
- 性能对比 **NOT_MEASURED**：没有可比同机基线，不报告启动、帧率、内存或响应时间提升。

V9.5.0 仍是候选。`ff86656` 完整 CI 失败保留为该旧 SHA 的证据；最新 SHA 的完整 CI 尚待结果。本机 build 和专项 PASS 不替代完整 CI；不签署正式发布或 Full Freeze。

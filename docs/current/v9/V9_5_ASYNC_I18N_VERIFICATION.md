# V9.5.0 Candidate 异步与双语验证记录

更新日期：2026-10-23。本文区分移除重复工作区之前的历史检查与当前源代码门禁。此前八域工作区和 Chrome 冒烟结果不代表当前 UI；当前全量发布验证失败，不能据旧批次通过签署 V9.5。

## 当前修正验证

2026-10-23 当前修正已在本机完成 build、verify、deploy 和 deployed parity：343 项映射，Payload SHA256 `ae690bf88da1d62cdcdfa4920fe48594d1d3903960f3794c5aa511d178fb8aa6`。原功能页的三主题／双语、无重复工作区、透明底色、保留主题图片、焦点和零业务副作用通过单 Chrome 匿名 Preload 冒烟。历史世界记忆完整原文的 Canon 保存／回读与当前状态反例通过。旧 knowledge-ui 断言已按实际 t 与 updateLanguage 接线更新并通过，原安全／作用域断言保留。最新源码的完整 Windows CI 待本次提交后运行。

## 当前状态

用户确认原有功能页面已满足需求，并反馈白色大面板遮挡主题背景。Root 已移除“V9.5 工作区”界面及其专用模块，将视觉呈现回归原功能页并降低大面板遮罩不透明度。冻结的视图契约文档仍保留，但工作区相关检查只作为移除前的历史结果。

前次 SHA `ff86656` 的 [CI run 39822389302](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39822389302) 在旧 `knowledge-ui` 源码断言处停止，因此全量发布门禁为 **FAILED**，后续检查未完成。Root 需修正过时断言后重新串行运行；本文不把此前专项 PASS 记作本版全量 PASS。

## 移除前的历史专项记录

以下结果来自包含工作区 UI 的旧源码批次，保留作历史证据，不认证移除后的当前源码：

| 检查 | 移除前结果与边界 |
|---|---|
| `test-v9.5-view-contract.js` | 历史 PASS：80 项双语 kind／state fixture 和 734 项双语字典键／插值检查；revision 1 原 91 个合同键保持。契约仍有冻结文档，工作区 UI 已移除。 |
| `test-v9.5-async-state.js`、`test-v9.5-main-scope.js` | 历史 PASS：scope 变化、乱序读、取消和未知效果边界；未知写效果需要 Main 回读，不自动重放。当前全量运行未走完。 |
| `test-v9.5-workspace-controller.js`、`test-v9.5-renderer-reads.js`、`test-v9.5-renderer-runtime.js` | 历史 PASS：当时的八域只读投影、Renderer 白名单、运行时资源和上下文切换。工作区专用实现已移除，这些结果不作为当前功能或验收依据。 |
| `test-v9.5-language-settings.js`、`test-v9.5-legacy-i18n.js`、`test-v9.5-legacy-async.js` | 历史 PASS：UI 语言与旧动作语言隔离、旧 DOM 双语更新、事实正文保留，以及草稿／焦点边界；需以当前 SHA 完成后的门禁确认。 |
| `test-v9.5-provider-model-scope.js`、`test-v9.5-domain-containers.js` | 历史 PASS：此前 Provider／容器专项；不替代当前源码的完整验证。 |
| 实际 Renderer 页面入口与匿名 Preload 的 Chrome 检查 | 移除前历史 PASS：八域、三主题、双语和焦点；当时观察到零外部请求与零业务副作用。工作区已移除，不能代表当前页面验证。 |

移除前本机 build/deploy 曾报告 346 项映射通过；对应 Payload SHA256 为 `1a800b12bda2e750174a7bdf0452d0dd0451cf351ca5637a50655f364958e3c2`。该 payload 属于含工作区的旧批次。其 EXE 检查通过，但不能验证工作区移除后的当前源码或构建产物。DeepSeek 交付／生命周期 22/22 与 3/3 结果也保留为此前审查证据，不等同于当前发布门禁通过。

## 待完成验证

- 更新旧 `knowledge-ui` 源码断言，再针对当前 SHA 串行重跑全量 CI；当前结果为 FAILED，不能标记 PASS。
- 本机已完成新 Payload 构建部署；完整 CI 待新提交。
- 最新历史世界记忆回归已通过；只使用合成临时战役，未写用户记忆。
- 真实 CK3、真实 Provider、新增外部业务效果和长时间 Soak 未执行。
- 性能对比 **NOT_MEASURED**：没有可比同机基线，不报告启动、帧率、内存或响应时间提升。

V9.5.0 仍是候选。前次完整 CI 失败保留为原 SHA 的证据，最新本机通过不替代新提交的完整 CI；不签署正式发布或 Full Freeze。

# V9.5.0 Candidate 异步与双语验证记录

日期：2026-10-22。以下 PASS 项来自 Root 本轮串行结果；本文编写期间未运行测试、构建或 EXE。测试通过只覆盖列出的自动化夹具和一次 Chrome UI 冒烟。

## 自动化结果

| 检查 | 结果与边界 |
|---|---|
| `test-v9.5-view-contract.js` | PASS：80 项双语 kind／state fixture，以及 734 项双语字典键与插值检查；覆盖无副作用、无敏感字段、未知状态及非法 intent 边界。revision 1 的原 91 个合同键保持，新增本地化键为兼容追加。 |
| `test-v9.5-async-state.js`、`test-v9.5-main-scope.js` | PASS：scope 变化、乱序读、取消和未知效果边界。未知写效果需要 Main 回读；不自动重放。 |
| `test-v9.5-workspace-controller.js`、`test-v9.5-renderer-reads.js`、`test-v9.5-renderer-runtime.js` | PASS：八域只读投影、Renderer 读取白名单、运行时资源和上下文切换。密钥／路径不投影；缺少可信 Provider 原生用量时显示 unknown，不用本地 stable-prefix 数替代。 |
| `test-v9.5-language-settings.js`、`test-v9.5-legacy-i18n.js`、`test-v9.5-legacy-async.js` | PASS：UI 语言与旧动作语言隔离、旧 DOM 中文／英文更新、事实正文保留，以及语言刷新时草稿和焦点边界。 |
| `test-v9.5-provider-model-scope.js`、`test-v9.5-domain-containers.js` | PASS：此前已完成的 Provider／容器专项；不替代本轮完整打包验收。 |

## Renderer 冒烟

Root 使用实际 Renderer 页面入口和匿名 Preload facade 完成一次 Chrome 检查。八类工作区、三主题、双语切换与焦点保留均通过；检查观察到零外部请求、零业务副作用。此结果验证该页面入口在所用 Chrome 环境中的接线，不是 Electron 打包壳或 EXE 冷启动／重启验证。

## 尚未执行或测量

- Runtime dependencies、源码构建与部署一致性：PASS（346项）；完整 release suite 交隔离 CI。
- 远端 CI、冻结候选 EXE 冷启动／重启／媒体加载：NOT_RUN。
- 真实 CK3、Provider 请求和长时间 Soak：本轮未执行；没有新增外部业务效果。
- 性能对比：NOT_MEASURED。没有同机基线，不报告启动时间、帧率、内存或响应时间的提升。

因此 V9.5.0 仍是候选。上述专项及单次 Chrome 冒烟不能签署构建、发布、实机或 Full Freeze Gate。

# VOTC v7.7 `main.js` 架构拆分与迁移清单

## 一、目标与边界

V7.7 的唯一目标是降低打包主进程入口的单文件职责密度，同时保持当前核心功能等价。设计方案作为后续架构方向参考，本次不实现 Context Manager、Memory Compression、Action Engine 2.0、新模型选择策略或用户数据迁移。

本次必须保持不变：

- 92 个 IPC 通道名称、参数和返回值；
- 六种 Provider ID、注册顺序、模型参数、流式行为和错误处理；
- DeepSeek 普通对话思考模式与 4096 Token 输出预算；
- 终局摘要和恢复摘要的非思考 JSON 请求；
- Memory Engine 2.2、人物目录、终局恢复、动作语义与 CK3 写入链；
- 提示词文件、设置键、默认目录和已有用户数据格式。

## 二、拆分前职责清单

拆分前 `resources/app/out/main/main.js` 约 9477 行，主要同时承担：

1. Electron 生命周期、窗口与焦点监控；
2. 设置、提示词和安全密钥组合；
3. Provider 注册、请求转换、流式响应与连接测试；
4. LLM、Token 和用量统计编排；
5. CK3 GameData、对话、信件和摘要服务装配；
6. Memory Engine 与 Action System 依赖配置；
7. 92 个 Renderer IPC 业务入口。

其中 Provider 实现和 IPC 注册边界清晰、依赖可显式注入，适合作为 V7.7 的低耦合迁移对象。其余职责继续留在主入口，避免一次重构跨越对话、摘要和动作三个 P0 路径。

## 三、实际迁移映射

| 拆分前位置 | V7.7 位置 | 入口合同 |
| --- | --- | --- |
| `main.js` 中六个 Provider 类 | `resources/app/out/main/providers/index.js` | `registerProviderImplementations(providerRegistry)` |
| `main.js` 中 `ProviderRegistry`、`TokenCounter`、`LLMManager` | `resources/app/out/main/provider-service.js` | `new LLMManager(dependencies)` |
| `main.js` 中 92 个 `ipcMain.handle` | `resources/app/out/main/ipc/register-ipc.js` | `registerIpcHandlers(runtime)` |
| Provider/IPC 启动顺序 | 仍由 `main.js` 控制 | Provider 在信件/窗口启动前注册；IPC 在 Electron ready 后注册 |
| `chatWindow` 闭包引用 | `runtime.chatWindow` getter | IPC 执行时读取当前窗口，不捕获启动期空值 |

Provider 模块导出 `BaseProvider`、六个具体 Provider 与统一注册函数；Provider Service 接收 Settings、Registry、Usage Analytics、TokenCounter 和 PromptBuilder，继续按 UI 保存的对话、摘要、动作三类配置路由，不加入自动模型替换。IPC 模块只接收主入口显式提供的现有对象，不创建第二套 Settings、Conversation、Memory 或 Action 实例。

## 四、拆分结果

- `main.js`：约 6612 行，减少约 2865 行；
- `provider-service.js`：约 341 行；
- `providers/index.js`：约 1806 行；
- `ipc/register-ipc.js`：约 795 行；
- Provider 数量：6；
- IPC 注册数量：92；
- 新增用户数据迁移：0；
- 新增或重命名 IPC：0；
- 模型参数与提示词变更：0。

## 五、自动验证

专项门禁 `scripts/test-v7.7-main-modules.js` 验证：

1. `main.js` 不再内联 Provider 类或 IPC 注册，并保持在 7000 行以内；
2. `openrouter`、`openai-compatible`、`ollama`、`player2`、`deepseek`、`gemini` 六个 ID 按原顺序注册；
3. DeepSeek 请求仍能转发 thinking 参数，主调用链仍保留思考模式和 4096 Token；
4. 92 个 IPC 通道完整注册且无重名；
5. 设置读取和窗口切换两个代表性 IPC 保持原行为；
6. 主文件、Provider 模块、IPC 模块均通过 Node 语法检查。

第二阶段新增 `scripts/test-v7.7-provider-service.js`，以三个不同的模拟配置分别发起对话、动作和终局摘要请求，验证：

- 对话只使用 active conversation Provider，DeepSeek thinking 为 enabled，输出预算为 4096；
- 动作只使用 action Provider，thinking 为 disabled，输出预算为 512，并保留 JSON Schema；
- 摘要只使用 summary Provider，终局和恢复维持非思考 JSON Object；
- 三类用量分别记录真实 Provider 类型和模型名，不互相串线；
- 模型列表、连接测试与自定义上下文长度仍走 active Provider。

当前仓库验证结果：发布回归 33/33 组通过，动作聚合门禁 28/28 个脚本通过。`VOTC.exe` 隐藏启动后正常生成四个 Electron 进程，日志出现 IPC ready，且未发现 `ReferenceError`、`SyntaxError` 或模块加载异常。

发布级回归继续统一运行：

```powershell
node scripts\test-release.js
```

## 六、人工验证边界

自动化不会请求真实 Provider，也不会向 CK3 写入效果。发布前仍需运行 `VOTC.exe` 检查：

- 应用可启动、窗口可打开和关闭；
- 设置页可读取并保存 Provider；
- 至少一次普通对话、动作识别和终局摘要成功；
- DeepSeek、OpenRouter 或实际使用的 Provider 能完成真实流式请求；
- 摘要页、优化页和信件页的既有 IPC 均能正常响应。

## 七、后续拆分候选

后续阶段可按风险从低到高继续迁移更新器/焦点监控、提示词管理、信件服务和摘要管理。对话编排、Memory Engine 组合根及 Action System 运行时应最后处理，并在每一步保持现有发布门禁与实机冒烟。V7.7 不承诺把 `main.js` 一次压缩到 3000 行，也不以行数目标替代行为等价。

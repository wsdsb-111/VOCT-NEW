# Repository Guidelines

## 项目定位与结构

本仓库是面向 Crusader Kings III 的 Windows 打包版 VOTC（Voices of the Court）Electron 应用。当前代码基线为 V8.8.4；关系识别用户实机已通过，最新动作补丁仍待 CK3 实机复测。代码回归与隔离 Electron 冒烟不等于真实 CK3、Provider 和长时间运行 Gate，不能宣称 Full Freeze。

- resources/app/out/main/main.js 是 Electron 主进程组合根；主进程实现已按职责拆分到 actions/、conversation/、memory-system/、summaries/、worldline/、game-data/、historical-system/、letters/、providers/、ipc/、analytics/、runtime/、config/ 等目录，action-system/ 保留为历史目录结构。
- resources/app/out/main/provider-service.js、providers/index.js、ipc/register-ipc.js、window-manager.js 等是打包后的主进程服务和边界；不要把 out/ 当作可任意重打包的源代码目录。
- resources/app/out/renderer/ 是随应用交付的 Renderer 资源。world-memory-editor.js 负责世界记忆编辑器，worldline-player-presentation.js 负责世界线玩家展示；assets/ 内包含三套主题背景和打包 CSS/JS。
- ui-theme-preview.html 是本地三主题视觉预览页，主题内部键为 parchment、knight、ink，玩家可见名称为“游牧”“骑士”“水墨”。
- resources/app/default_userdata/ 保存默认 Prompt、本地化和标准 Action；它不是用户运行时数据目录。
- scripts/ 保存迁移工具、专项回归和发布门禁；scripts/test-manifest.js 是测试清单的唯一编排入口。
- docs/README.md 是文档入口，docs/V8阶段开发记录.md 是 V8 连续实施记录，docs/README_摘要系统.md 是摘要/Memory 合同；根目录 CHANGELOG.md 只维护版本索引和用户可见摘要。
- VOTC.exe 是打包应用入口；resources/app/package.json 的 Electron 包版本与 V8 功能版本是两个概念，不要混用。

## 当前稳定合同

- V8.8.4 动作区分 QUEUED、ACKNOWLEDGED 与 CONFIRMED。NPC 列表不含玩家，玩家绑定 root；金币/好感度以同命令 BEGIN—ACK 的真实前后状态确认。游戏侧同命令去重和旧会话零写入隔离不可移除；其他动作只有 ACK 时不宣称效果成功。
- Official VOTC 2.0.3 Action System 是当前唯一正式动作基线。动作必须经过确定性门禁、注册检查、结构化输出和本地校验；旧的自研 AE/Action Mode/Pending/Social Consequence 链路只作为历史资料，不得重新接入生产路径。
- 涉及游戏状态的效果以 CK3 回读为准。尤其金币转移不能乐观修改本地当前状态；同一 RunFile 的 Effect、双方实时金币和 ACK 必须形成可核对证据，只有精确匹配才可视为 CONFIRMED。
- Worldline 是 CK3 事实只读层；Current Runtime Truth、在场关系、被提及人物和 Family Fact 必须沿共享 DTO/Resolver 合同工作。历史 Definition 与 Runtime 的绑定要求一对一，冲突或缺失应 fail-closed。
- Memory Engine 的玩家可见标签为 2.6，但现有 2.5 存储合同仍需兼容。不要随意改动摘要文件夹、字段、召回顺序、缓存键或迁移边界。
- Prompt 的稳定块应位于易变对话数据之前。任何 cache anchor 或 Prompt block ID 的改变都属于兼容性变更，必须同步版本和文档。
- CK3 存档、debug.log、%APPDATA%/VOTC 下的摘要/设置/分析数据以及 API 凭据均为本地运行时数据，不得提交。

## 开发与验证

从仓库根目录在 PowerShell 中执行。先跑与改动直接相关的专项测试，再跑完整发布门禁：

~~~powershell
node scripts\test-v8.8-ui-style-backgrounds.js
node scripts\test-action-system.js
node scripts\test-release.js
node --check resources\app\out\main\main.js
node --check resources\app\out\main\provider-service.js
node --check resources\app\out\main\providers\index.js
node --check resources\app\out\main\ipc\register-ipc.js
node --check resources\app\out\main\worldline\world-presentation.js
node --check resources\app\out\renderer\world-memory-editor.js
node --check resources\app\out\renderer\worldline-player-presentation.js
git diff --check
~~~

test-release.js 通过 test-manifest.js 汇总直接和嵌套检查；新增 test-*.js 必须登记到清单并明确是发布组还是历史归档。当前基线记录为 290 个发布组、359 个已分类测试文件，测试数量变化时更新相关文档，不要把旧数量硬编码为源码合同。

修改 IPC、设置、Prompt、流式输出、动作回读、世界线或主题 UI 后，仍需启动 VOTC.exe 做对应人工冒烟。静态回归不能替代真实 CK3 存档、Provider、debug.log ACK、打包窗口和 Soak 验收。

## 编码与编辑原则

使用 JavaScript 两空格缩进、分号和 camelCase，保持现有打包文件风格。优先改动最小的现有文件，不重排或重新生成无关的 bundled 资源；保持 IPC 名称、持久化设置键、Action signature、分析字段、Prompt block ID 和主题内部键稳定。

新增或修改标准 Action 时遵循 resources/app/default_userdata/actions/standard/AGENTS.md；新增或修改测试时遵循 scripts/AGENTS.md；修改文档时遵循 docs/AGENTS.md。不要为了清理而删除历史版本文档或用户数据。

## 提交与安全

提交信息使用简短的中文版本/阶段/修复描述。提交说明应列出受影响的打包路径、验证命令和仍待人工 Gate；UI、Token、缓存或主题改动应附视觉或统计证据。

永不提交 API Key、Provider 配置、CK3 存档、日志、摘要、使用分析和 %APPDATA%/VOTC 数据。迁移或维护脚本必须先校验替代输出，再保留原始用户数据。

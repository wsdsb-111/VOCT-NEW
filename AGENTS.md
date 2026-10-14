# Repository Guidelines

## 项目定位与结构

本仓库是面向 Crusader Kings III 的 Windows 打包版 VOTC Electron 应用。当前主线 V9.3.3.1／App 9.3.3.1，按旧总路线实施 Application Boundary & JSON Repository；V9.1 f9c088f 的远端 CI 和用户功能确认已补记，证据见 docs/current/v9/V9_2_VERIFICATION_REPORT.md。既有用户验收保留；新 CK3、Provider、性能、CI 与 Soak 结果独立记录，不能宣称 Full Freeze。

V9.2.1 缓存专项目前为安全／诊断候选，证据见 docs/current/v9/V9_2_1_VERIFICATION_REPORT.md。Durable 固定 Policy 与 User 动态 limits 分离；每次请求前复核 Forget，二分及后续 chunk 不重发已忘源。GLM 保持 v813，原生收益 HOLD；按施工规格 Gate 暂不升级正式版本或自动进入 V9.3。V9.2 6026713 的远端 CI 已核验 Success，新候选仍需最终 SHA 独立核验。

- resources/app/out/main/main.js 是 Electron 主进程组合根；主进程实现已按职责拆分到 actions/、conversation/、memory-system/、summaries/、worldline/、game-data/、historical-system/、letters/、providers/、ipc/、analytics/、runtime/、config/ 等目录，action-system/ 保留为历史目录结构。
- src/app/ 是可编辑 Runtime 源；build/runtime-inputs.json 显式映射 Main/Preload/Renderer 与默认数据。先编辑源、构建并部署，再核验 resources/app 生成资源；不要单独编辑 out/。源码和构建边界遵循 src/AGENTS.md，详情见 docs/current/v9/V9_1_SOURCE_BUILD.md。
- resources/app/out/renderer/ 是随应用交付的 Renderer 资源。world-memory-editor.js 负责世界记忆编辑器，worldline-player-presentation.js 负责世界线玩家展示；assets/ 内包含三套主题背景和打包 CSS/JS。
- ui-theme-preview.html 是本地三主题视觉预览页，主题内部键为 parchment、knight、ink，玩家可见名称为“游牧”“骑士”“水墨”。
- resources/app/default_userdata/ 保存默认 Prompt、本地化和标准 Action；它不是用户运行时数据目录。
- scripts/ 保存迁移工具、专项回归和发布门禁；scripts/test-manifest.js 是测试清单的唯一编排入口。
- docs/README.md 是文档入口，docs/V8阶段开发记录.md 是 V8 连续实施记录，docs/README_摘要系统.md 是摘要/Memory 合同；根目录 CHANGELOG.md 只维护版本索引和用户可见摘要。
- VOTC.exe 是复用打包壳，Windows 文件属性版本未重写。项目／核心 V9.3.3.1／9.3.3.1，App 包 9.3.3.1，前端 `V9.3.3.1 · Mod v2.0.5`；Workshop 2.0.5、Memory 4.0／协议 3.0／存储 2.5／Official Action 2.0.3、Three-Mod 1.0.6 保留。

## 当前稳定合同

- V9.3 Provider Platform候选见 docs/current/v9/V9_3_VERIFICATION_REPORT.md。Chat/Action/Summary统一Facade；能力UNKNOWN保留证据，明确UNSUPPORTED发送前阻止；只有STOP/COMPLETE进入严格业务。SDK隐式重试为0，显式生成最多2次且未知送达/部分流不透明重发；每次真实transport前复核Forget/来源及同步预算。原生用量与估算分开，缺失字段不可当0，非法字段不可被DERIVED掩盖。七Adapter正常wire、GLM v813、DeepSeek优化、Version与原持久化writer保持；当前仅候选，不宣称Full Freeze。

- V9.2.3 候选固定退役 Memory4 Year/Life 自动模型生成及后台重建；历史合法视图可查看和手改，Detail/Legacy、Durable、Commitment、Forget与来源校验保持。跳过必须显示 `SKIPPED_DERIVED_POLICY`，不能冒充已生成。旧 Recovery 只有真实提交证据闭合才可清除；坏记录、未知状态与其他 Campaign保留。候选仍按 docs/current/v9/V9_2_3_VERIFICATION_REPORT.md 分别签署自动化、原生Provider、CI和人工Gate，正式App/UI暂保持9.2.0/V9.2。

- V8.8.4 动作区分 QUEUED、ACKNOWLEDGED 与 CONFIRMED。NPC 列表不含玩家，玩家绑定 root；金币/好感度以同命令 BEGIN—ACK 的真实前后状态确认。游戏侧同命令去重和旧会话零写入隔离不可移除；其他动作只有 ACK 时不宣称效果成功。
- V8.8.5 排队 TTL 归 RunFileManager，ACK 计时从实际写入开始；`votc.txt` 必须以 UTF-8 BOM 临时文件原子替换。新动作可在载体已安全清空后隔离旧 STALLED 动作，但绝不重放未知效果。多个金额不做确定性覆盖，好感度确认前不能使用成功文案。DeepSeek 两项 Action 优化默认开启且可关闭；OpenAI-compatible 提供 Action Schema 标准/兼容传输模式。独立 `zhipu` Provider 的 GLM 推理强度和 `clear_thinking` 不得与 DeepSeek 专属配置交叉；缓存/推理 Token 必须先归一化。流式 Provider 必须保留 usage-only 尾块，Gemini `usageMetadata` 统一记账；端点不返回 usage 时只能记录明确标记的估算 Token。空年龄保持未知；扩展亲属依赖实际家谱，伯叔与父亲比较长幼，堂表亲与主体比较长幼，旧英文模板只做动态事实接入、不扩充动作参与者。
- Official VOTC 2.0.3 Action System 是当前唯一正式动作基线。动作必须经过确定性门禁、注册检查、结构化输出和本地校验；旧的自研 AE/Action Mode/Pending/Social Consequence 链路只作为历史资料，不得重新接入生产路径。
- 涉及游戏状态的效果以 CK3 回读为准。尤其金币转移不能乐观修改本地当前状态；同一 RunFile 的 Effect、双方实时金币和 ACK 必须形成可核对证据，只有精确匹配才可视为 CONFIRMED。
- Worldline 是 CK3 事实只读层；Current Runtime Truth、在场关系、被提及人物和 Family Fact 必须沿共享 DTO/Resolver 合同工作。历史 Definition 与 Runtime 的绑定要求一对一，冲突或缺失应 fail-closed。
- 当前人物记忆的玩家可见标签为 Memory Engine 4.0；既有协议 `engineVersion: 3.0` 与摘要 2.5 存储合同仍需兼容。显示标签不得作为协议升级依据，不要随意改动摘要文件夹、字段、召回顺序、缓存键或迁移边界。
- Prompt 的稳定块应位于易变对话数据之前。任何 cache anchor 或 Prompt block ID 的改变都属于兼容性变更，必须同步版本和文档。
- CK3 存档、debug.log、%APPDATA%/VOTC 下的摘要/设置/分析数据以及 API 凭据均为本地运行时数据，不得提交。

## 开发与验证

从仓库根目录在 PowerShell 中执行。先跑与改动直接相关的专项测试，再跑完整发布门禁：

~~~powershell
node scripts\runtime-dependencies.js
node scripts\build-runtime.js
node scripts\verify-runtime-build.js
node scripts\deploy-runtime-build.js
node scripts\verify-runtime-build.js --deployed
node scripts\test-v8.8-ui-style-backgrounds.js
node scripts\test-v7.10-official-action-system.js
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

test-release.js 通过 test-manifest.js 汇总直接和嵌套检查；新增 test-*.js 必须登记到清单并明确是发布组还是历史归档。清单数量以 scripts/test-manifest.js 的实际输出为准；完整门禁结果以当前实施报告为准。测试数量变化时更新相关文档，不要把旧数量硬编码为源码合同。

修改 IPC、设置、Prompt、流式输出、动作回读、世界线或主题 UI 后，仍需启动 VOTC.exe 做对应人工冒烟。静态回归不能替代真实 CK3 存档、Provider、debug.log ACK、打包窗口和 Soak 验收。

## 编码与编辑原则

使用 JavaScript 两空格缩进、分号和 camelCase，保持现有打包文件风格。优先改动最小的现有文件，不重排或重新生成无关的 bundled 资源；保持 IPC 名称、持久化设置键、Action signature、分析字段、Prompt block ID 和主题内部键稳定。

新增或修改标准 Action 时遵循 resources/app/default_userdata/actions/standard/AGENTS.md；新增或修改测试时遵循 scripts/AGENTS.md；修改文档时遵循 docs/AGENTS.md。不要为了清理而删除历史版本文档或用户数据。

## 提交与安全

提交信息使用简短的中文版本/阶段/修复描述。提交说明应列出受影响的打包路径、验证命令和仍待人工 Gate；UI、Token、缓存或主题改动应附视觉或统计证据。

永不提交 API Key、Provider 配置、CK3 存档、日志、摘要、使用分析和 %APPDATA%/VOTC 数据。迁移或维护脚本必须先校验替代输出，再保留原始用户数据。

## Subagent Model Policy

### Root agent
- The root/main agent model is controlled by the user through the Codex client model picker.
- Do not change or override the root model selection.
- When the root model is GPT-6.1 Sol, ordinary child agents still use GPT-6 Luna with `max` reasoning.

### Default subagents
- Ordinary subagents must use GPT-6 Luna (`gpt-6-luna`) with maximum (`max`) reasoning effort, matching `.codex/config.toml`.
- When a spawn interface would inherit the root model or accepts per-agent overrides, explicitly pass `gpt-6-luna` and `max` so a GPT-6.1 Sol root does not spawn Sol subagents.
- Do not explicitly request GPT-6 Astra or GPT-6.1 Sol for ordinary subagents.
- Do not override the configured subagent model or reasoning effort unless the user explicitly requests it for that task.
- Use GPT-6 Luna for ordinary codebase exploration, implementation, debugging, documentation, tests, and review.

### Implementation and review
- GPT-6 Luna subagents may perform implementation and review work under the configured default.
- Keep independent QA in a separate agent with its own adversarial fixtures and verification evidence, even when implementation and QA use the same model.
- If a subagent cannot complete a task, return its findings and unresolved question to the root agent; do not change models automatically.
- Only spawn a GPT-6 Astra or GPT-6.1 Sol subagent when the user explicitly requests it.

### Delegation discipline
- Spawn subagents only when the work is genuinely parallelizable or delegation materially improves speed or context management.
- Keep delegated tasks narrow and concrete; have child agents return concise evidence, paths, symbols, and conclusions.

## V9.2 施工约束

用户授权的改名目录合并只按数字 Owner ID 归并、按 counterpart ID 定位对话文件；保持不同 Campaign、Legacy binding ID、手改和 Forget。先逐字节备份至 MemoryStore baseDir/renamed-summary-folders（不参与召回），共享 sidecar 冲突时保留原目录并阻止合并。目录创建/移除继续使用 version 1 summary mutation journal 恢复。不得用名字合并不同 ID。

按用户明确要求在 main 开发；未经新的用户指示不创建分支或 worktree。七域 applicationServices 由 main.js 注入，绑定现有 owner 的语义方法；ScopedJsonRepository 委托现有 Memory4Store，不拥有第二份 JSON。候选帧绑定 Campaign×Owner、revision/indexHash，输出前再验证正文及当前 Forget。恢复和只读审计不能重放未知 Action／Letter 效果；维护部署回执只在 .build，不扫描 APPDATA。

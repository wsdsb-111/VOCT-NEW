# Voices of the Court（VOTC）

VOTC 是面向《Crusader Kings III》（CK3）的 Windows Electron 宫廷对话工具。它读取游戏日志、人物资料及可选存档，将当前事实、角色知情范围、历史背景和合法记忆整理为 Prompt，通过模型服务生成角色回复，并通过官方动作及信件管线与游戏交互。

本仓库包含可编辑 JavaScript 源、确定性构建工具、已生成运行资源、锁定的运行依赖和既有 Windows 壳。

## 当前版本与进度

Core／App／UI 为 V9.3.9 代码候选，合并 V9.3.8.1 记忆方案与遗漏的 V9.3.7.1 修复任务。交付范围为代码、自动化回归与 GitHub 上传；真实 CK3、游戏内 Provider、Soak 和正式 Release 由用户后续验收。

双人／三人的全场动态摘要额度为时间 5 + 第三人 3，记忆硬上限分别为 80,000／84,000 Token；4 人以上保持 3+3，上限为 96,000 Token。成功注入并完成请求后按回应者冻结原文，放在可变对话前复用；失败候选不冻结，来源变化逐项复验。比例仍为 65%／70%／75%，窗口容量由当前配置读取；用户将自行设置 192,000，不硬编码。

本版统一亲子来源门禁与继亲标签，恢复独立人物认知 UI／服务并接入 Prompt 权限复核，提供生产 Parser 新旧日志回归和年龄分层诊断 CLI，修复 C17 测试作用域错误。Workshop Mod 2.0.5、Official Action 2.0.3、协议 3.0、存储 2.5／schema 2 保持；新 kids 公开证据字段作为独立补丁交付，不宣称已被当前游戏加载。

- [V9.3.9 合并计划](docs/current/v9/V9_3_9_IMPLEMENTATION_PLAN.md)
- [V9.3.9 实施与交付报告](docs/current/v9/V9_3_9_IMPLEMENTATION_REPORT.md)
- [V9.3.8 历史实施报告](docs/current/v9/V9_3_8_IMPLEMENTATION_REPORT.md)
- [文档索引](docs/README.md)、[版本记录](CHANGELOG.md)、[Legacy Summary 合同](docs/README_摘要系统.md)

## 主要功能与边界

- **角色对话与在场管理**：支持多人、候场、暂离和返回；缺席期间的私聊不自动成为人物知识。
- **Legacy Summary**：每位回应 NPC 的固定历史只锚定当前玩家，完整纳入最近 2 篇 Legacy、合法官方追忆和完整合法玩家关系事项簿；固定文本首次构造后冻结。若完整来源无法放入预算，系统先压缩较旧对话，仍超出时在发送前暂停并显示预算分项。
- **第三人历史检索**：L0 仅提名，不读取历史索引或原文；明确玩家历史分句可按本场累计纳入最多 5 篇（2／3 人）或 3 篇（4+ 人）时间摘要及最多 3 篇第三人历史摘要，第三人上限跨所有目标共享。来源键、修订号、Campaign 与 Forget 校验继续有效，不新增模型检索或提取请求。
- **请求预算与上下文用量**：2／3／4+ 人分别受 65%／70%／75% 配置窗口比例及 80,000／84,000／96,000 Token 上限约束，实际取 Provider 可用余量允许值。玩家界面仅显示一条“本场对话上下文”，提供本场对话当前／最近请求 usage 与 remaining，不逐 NPC 展示或跨 NPC 相加；后端仍隔离对话和回应者。容量来源明确标识，生成中暂估，结束后优先使用原生 input/output 用量并估算缺失项。
- **事项簿与来源查看**：按真实姓名展示，支持搜索、日期过滤和分页。Pair 回填先预览再明确确认，批量逐 Pair 执行。后端按 source key 和 expected revision 复验原文；未绑定或多 Campaign 歧义保持只读。
- **Worldline 与家庭事实**：CK3 当前事实优先；Checkpoint、Live 数据和历史 Definition↔Runtime 绑定分别保留来源、新鲜度和身份边界。来源缺失或冲突时拒绝推断。世界知识 Prompt 默认关闭，按设置显式启用。
- **官方动作与信件**：动作经过确定性门禁、注册检查、结构化输出及本地校验。QUEUED、ACKNOWLEDGED、CONFIRMED 分开；ACK 不等于效果成功。金币／好感度以同命令游戏回读为准，未知效果不得自动重放。信件物理投递和接收后 Legacy 归档分别记账。
- **模型服务与诊断**：支持 Player2、OpenRouter、OpenAI-compatible、Ollama、DeepSeek、Gemini 和独立智谱 GLM。Chat／Action／Summary 经统一 Facade；原生用量与估算分开，部分流、取消和未知完成不得冒充成功。
- **三主题界面**：游牧／骑士／水墨分别对应内部键 `parchment`／`knight`／`ink`。

Memory4／Durable、Year/Life 自动生成和后台重建已退役。旧 `archiveSidecar` 不扫描、不读写，保留原始字节；Legacy Forget ledger 继续使用原 index／事务。历史迁移工具不属于 Runtime，也不在正常启动、构建或测试中执行。

## 运行与首次配置

使用 Windows 10/11、CK3 与配套 Voices of the Court Workshop Mod（item `3346777360`）。文档记录 descriptor 支持 `1.20.*`，实际兼容性应以已安装 Mod 的 descriptor、配套桥文件及实机验收为准。App 与 Workshop 内容分别发布；V9.3.9 保持 Workshop 2.0.5、协议 3.0 和存储 2.5 兼容。参见[外部运行依赖](docs/EXTERNAL_RUNTIME_DEPENDENCIES.md)及 [V9.3.9 实施报告](docs/current/v9/V9_3_9_IMPLEMENTATION_REPORT.md)。

1. 下载完整发布包，或克隆仓库后拉取 Git LFS 资源：

   ```powershell
   git lfs install
   git lfs pull
   node scripts/test-release-assets.js
   ```

2. 启动 `VOTC.exe`，配置 CK3 用户目录／日志路径及配套 Mod 路径。
3. 选择模型服务，配置 API 地址、模型、参数及 Key；对话、动作、摘要可分别选择 Provider。
4. 启动 CK3 并启用配套 Mod。先通过 Prompt 预览核对人物与日期，再开始对话或信件互动。

API Key 通过 Electron `safeStorage` 加密后保存在独立本地配置；常规配置不保存明文 Key。不要提交 `%APPDATA%/VOTC` 下的设置、摘要、分析数据，或 CK3 存档、日志及凭据。`resources/app/default_userdata/` 是交付默认数据，不是用户运行数据目录。

## 项目结构与开发

| 路径 | 职责 |
|---|---|
| `src/app/main/` | 主进程；`main.js` 装配 Conversation、Memory、Worldline、Provider、Action、Letter 与 IPC |
| `src/app/preload/` | Renderer 与主进程的受限 IPC 桥 |
| `src/app/renderer/` | 既有 React bundle、独立展示脚本、CSS 与主题资产；尚未恢复完整上游组件工程 |
| `src/app/shared/` | 前后端共用事项解析等代码 |
| `src/app/default_userdata/` | 默认 Prompt、标准 Action、本地化及编辑器资产 |
| `build/` | 源到目标映射、历史字节对照和 vendor 依赖锁 |
| `resources/app/` | 校验并部署的生成资源及已锁定运行依赖 |
| `scripts/` | 构建、部署、专项验证及唯一测试清单 `test-manifest.js` |
| `docs/` | 当前合同、分版本实施／验证报告和历史记录 |
| `compatibility-patches/` | 配套桥的历史快照；不代表完整 Workshop 源工程 |

源码构建使用 Node.js >=22；完整发布门禁含要求 Node 22 的历史 A/B 检查，复验和 CI 均使用 Node 22。先阅读根及对应目录的 `AGENTS.md`。只修改 `src/app/` 源，再构建、部署、核对生成资源；不要单独编辑 `resources/app/out/`。构建仅用 Node 内置模块，不安装、升级或重建 vendor 依赖，也不重编 Electron 壳。

关闭 VOTC 后，在仓库根 PowerShell 逐条执行，前一步成功后再继续：

```powershell
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
git diff --check
```

先跑改动直接相关的专项，再跑完整发布回归。新增 `test-*.js` 必须登记到 `scripts/test-manifest.js`；数量以实际清单和本轮报告为准。构建及部署回执在忽略目录 `.build/`，不涉及用户数据。IPC、Prompt、设置、流式输出、动作、世界线或主题改动仍需对应的打包窗口及实机验证；静态测试不替代 CK3、真实 Provider、Soak 或远端 CI。

## 已知限制与历史资料

历史知识门禁不能完全消除模型幻觉；Provider 的未知事实表达和服务端缓存效果需要独立实测。当前家庭事实不能自动重建没有可信历史婚姻期间来源的过去继亲关系。来源权限、Campaign、Forget 和修订号不能由模型答案或亲属关系扩大。

Three-Mod 官职／称谓兼容已迁入独立 [CK3-Three-Mod-Compatibility](https://github.com/wsdsb-111/CK3-Three-Mod-Compatibility)，不属于本体必需依赖。V6／V7／V8 的实现和用户验收保存在[历史阶段入口](docs/README.md)，旧版本的配额、在线功能和验收结果不能覆盖当前合同。

## 许可证与致谢

模组文件遵循项目原有许可证。Voices of the Court 2.0 Mod © 2026 Durond 与 MrAndroPC，采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 授权。Electron、Chromium 及其他第三方组件遵循随附许可证，参见 `LICENSE.electron.txt`、`LICENSES.chromium.html` 和 `THIRD_PARTY_NOTICES.md`。

感谢 Voices of the Court 原作者、CK3 Mod 社区，以及参与测试、翻译、历史提示词和摘要系统改进的用户。

# Voices of the Court（VOTC）

VOTC 是面向《Crusader Kings III》（CK3）的 Windows Electron 宫廷对话工具。它读取游戏日志、人物资料及可选存档，将当前事实、角色知情范围、历史背景和合法记忆整理为 Prompt，通过模型服务生成角色回复，并通过官方动作及信件管线与游戏交互。

本仓库包含可编辑 JavaScript 源、确定性构建工具、已生成运行资源、锁定的运行依赖和既有 Windows 壳。

## 当前版本与进度

<<<<<<< Updated upstream
Core／App／UI 当前均为 **V9.3.7 候选**，基线为 V9.3.6.3。Workshop Mod 2.0.5、Official Action 2.0.3、记忆协议 3.0、摘要存储 2.5／schema 2 保持兼容。`VOTC.exe` 复用既有壳，其 Windows 文件属性版本不能代表当前应用资源版本。
=======
Core／App／UI 当前为 V9.3.9.1 本地修复候选。恢复当前对话人物之间的定向认知显示与手动特质披露，重点修复姓名、头衔、称号漏记；撤下 V9.3.9 非预期的 Worldline 认知服务接线，不为每轮构建全体人物认知。交付范围为代码、自动化及隔离窗口验证；按用户要求不连接 GitHub、不处理远端 CI，不执行真实 CK3、付费 Provider、Soak 或正式 Release。
>>>>>>> Stashed changes

V9.3.7 校准 CK3 权威年龄来源，支持有来源绑定的公开双亲、同父异母／同母异父、当前继父母及继兄弟姐妹；保留已授权且有明确来源的历史继亲 Legacy 记录。未验证的日历推算仅作诊断，未知不等于“没有”。新增 `otherParent` 事实不扩大 Memory 权限，不从前配偶推断历史继亲。

<<<<<<< Updated upstream
2026-10-17 本轮已同步文档，修复稳定资料／自定义模板的亲属来源过滤、稳定年龄与 Windows 队列原子替换短暂占用；**本地完整发布回归 444/444 PASS**，290 项构建部署一致，隔离 Electron 6 组检查和限定范围的性能复验通过。证据与失败批次保留在[后续收口报告](docs/current/v9/V9_3_7_FOLLOWUP_REPORT.md)。

原候选报告记录了 290 项映射、442/442 发布组、Pair benchmark 和 11 组隔离 Electron smoke 通过；这些是对应批次的本地证据。当前提交 `9caffe6` 的 [GitHub CI](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39004062734) 在发布回归步骤失败，不能将旧本地 PASS 当作远端通过。合成 Prompt Provider 复核为 **PARTIAL**；真实 CK3、游戏内 Provider 与 Soak 仍待独立验收，当前不宣称 Full Freeze。远端 CI 已按用户要求暂缓处理。本轮文档与遗留测试收口证据统一记录在[后续收口报告](docs/current/v9/V9_3_7_FOLLOWUP_REPORT.md)。

- [实施报告](docs/current/v9/V9_3_7_IMPLEMENTATION_REPORT.md)、[验证报告](docs/current/v9/V9_3_7_VERIFICATION_REPORT.md)、[实机清单](docs/current/v9/V9_3_7_REAL_GAME_CHECKLIST.md)
- [文档索引](docs/README.md)、[版本变更及历史阶段](CHANGELOG.md)
- [源码与构建合同](docs/current/v9/V9_1_SOURCE_BUILD.md)、[Legacy Summary 合同](docs/README_摘要系统.md)
=======
人物认知按 Campaign／听众／目标／事实与来源修订分别记录。公开发言让实际在场听众各自获知，私语只给指定对象，候场／缺席者不继承。见面自动获知只沿用外貌／身体白名单；当前公开可靠的父母子女及亲兄弟姐妹关系允许互知特质，未暴露的真实私生亲属关系不适用。称号保持公开可见。手动特质状态持久化并真实参与对应 NPC 的 Prompt 过滤。

年龄修复移除稳定资料中的旧年龄行，当前年龄由动态游戏事实提供，不统一减一；由于缺少同日期实机原始数据，昨晚 NPC 回答“年龄 +1”的根因仍未证实，不能宣称 P1 完整验收。Workshop Mod 2.0.5、Official Action 2.0.3、协议 3.0、存储 2.5／schema 2 保持。摘要配额、召回、冻结及关系来源实现沿用 V9.3.9。

- [V9.3.9.1 修复实施与验证报告](docs/current/v9/V9_3_9_1_IMPLEMENTATION_REPORT.md)
- [V9.3.9.1 跨电脑交接与剩余任务](docs/current/v9/V9_3_9_1_HANDOFF.md)：本轮因额度停止；最后源码尚未部署，全量回归未完成通过。
- [V9.3.9 合并计划](docs/current/v9/V9_3_9_IMPLEMENTATION_PLAN.md)（历史基线）
- [V9.3.9 实施与交付报告](docs/current/v9/V9_3_9_IMPLEMENTATION_REPORT.md)
- [V9.3.8 历史实施报告](docs/current/v9/V9_3_8_IMPLEMENTATION_REPORT.md)
- [文档索引](docs/README.md)、[版本记录](CHANGELOG.md)、[Legacy Summary 合同](docs/README_摘要系统.md)
>>>>>>> Stashed changes

## 主要功能与边界

- **角色对话与在场管理**：支持多人、候场、暂离和返回；缺席期间的私聊不自动成为人物知识。
- **Legacy Summary**：每位回应 NPC 的固定历史只锚定当前玩家，包含最近 1 篇 Legacy、合法官方追忆和预算内的玩家关系事项簿。固定文本首次构造后冻结。
- **第三人历史检索**：L0 仅提名，不读取历史索引或原文；明确历史关系询问为 L1，每目标至多 16 条事项、零原文；具体历史经过为 L2，共享预算内至多展开 2 篇经来源键和修订号复验的摘要。2／3／4+ 人分别使用 16%／18%／20% 和 4800／5600／6400 Token 上限，并受无记忆 Prompt、输出预留及 Provider 安全余量限制。不新增模型检索或提取请求。
- **事项簿与来源查看**：按真实姓名展示，支持搜索、日期过滤和分页。Pair 回填先预览再明确确认，批量逐 Pair 执行。后端按 source key 和 expected revision 复验原文；未绑定或多 Campaign 歧义保持只读。
- **Worldline 与家庭事实**：CK3 当前事实优先；Checkpoint、Live 数据和历史 Definition↔Runtime 绑定分别保留来源、新鲜度和身份边界。来源缺失或冲突时拒绝推断。世界知识 Prompt 默认关闭，按设置显式启用。
- **官方动作与信件**：动作经过确定性门禁、注册检查、结构化输出及本地校验。QUEUED、ACKNOWLEDGED、CONFIRMED 分开；ACK 不等于效果成功。金币／好感度以同命令游戏回读为准，未知效果不得自动重放。信件物理投递和接收后 Legacy 归档分别记账。
- **模型服务与诊断**：支持 Player2、OpenRouter、OpenAI-compatible、Ollama、DeepSeek、Gemini 和独立智谱 GLM。Chat／Action／Summary 经统一 Facade；原生用量与估算分开，部分流、取消和未知完成不得冒充成功。
- **三主题界面**：游牧／骑士／水墨分别对应内部键 `parchment`／`knight`／`ink`。

Memory4／Durable、Year/Life 自动生成和后台重建已退役。旧 `archiveSidecar` 不扫描、不读写，保留原始字节；Legacy Forget ledger 继续使用原 index／事务。历史迁移工具不属于 Runtime，也不在正常启动、构建或测试中执行。

## 运行与首次配置

使用 Windows 10/11、CK3 与配套 Voices of the Court Workshop Mod（item `3346777360`）。文档记录 descriptor 支持 `1.20.*`，实际兼容性应以已安装 Mod 的 descriptor、配套桥文件及实机验收为准。App 与 Workshop 内容分别发布；V9.3.7 的新增年龄／亲属字段需要加载更新的游戏脚本并重新导出，旧日志缺字段时保持 UNKNOWN。参见[外部运行依赖](docs/EXTERNAL_RUNTIME_DEPENDENCIES.md)及[实机清单](docs/current/v9/V9_3_7_REAL_GAME_CHECKLIST.md)。

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

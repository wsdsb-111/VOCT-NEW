# V9.0 发行版本对齐

日期：2026-10-11。按用户后续要求统一代码、前端和当前维护文档；本地修改未提交、未推送。原始设计中的 App 2.0.4 和 V8 冻结版本是历史快照，本记录覆盖当前发行版本要求。

| 对象 | 当前版本 | 依据与展示 |
|---|---|---|
| 项目／核心 | V9.0／9.0 | `out/main/version.js`；窗口标题和前端功能标签 V9.0 |
| Electron App 包 | 9.0.0 | `resources/app/package.json`，采用 SemVer；沿既有 `app:getVersion` 读取，页脚提示 `VOTC App 9.0.0` |
| VOTC Workshop Mod | 2.0.5 | Workshop item 3346777360 的两份 descriptor；页脚 `V9.0 · Mod v2.0.5` |
| 人物记忆 | Memory Engine 4.0 | 保留玩家可见版本；持久化协议仍为 3.0 |
| 摘要存储 | 2.5／schemaVersion 2 | 保留兼容、字段、目录、召回顺序、缓存键和迁移边界 |
| Official Action | official-votc-2.0.3 | 保留正式动作基线 |
| 独立 Three-Mod 兼容工程 | 1.0.6 | 与 VOTC Workshop Mod 分别维护，本次不改官职规则或兼容工程版本 |

## 改动范围

App 包元数据、核心版本、Renderer 常量／页脚／页面标题、主题预览同步。Provider 现有三处自定义 User-Agent 使用包版本，三处 X-Title 使用核心版本；OpenRouter SDK 默认 User-Agent 保留，接口、请求体和 Provider 配置不改。App 自动更新仍关闭。

同步根目录／docs／scripts／主进程的 AGENTS.md、根 README、CHANGELOG、文档索引、摘要合同、外部运行依赖及当前 V9 架构／验证入口。归档测试、历史实施报告、原始设计和冻结哈希不回写。AGENTS 验证命令改为现行 `test-v7.10-official-action-system.js`，原 `test-action-system.js` 已属历史归档。

Workshop 内容路径：`D:/SteamLibrary/steamapps/workshop/content/1158310/3346777360/descriptor.mod`；启动器路径：`E:/Documents/Paradox Interactive/Crusader Kings III/mod/ugc_3346777360.mod`。两份仅更新 `version="2.0.5"`，名称 `Voices of the Court 2.0`、item ID、supported_version 和路径保留，避免破坏依赖与启用配置。版本标签不能代替 CK3 的实际加载版本检测，本次没有新增 App／Mod 握手。

VOTC.exe 二进制未重新打包，Windows 文件属性中的旧壳版本仍为 2.0.3／2.0.3.0；实际加载资源和 `app.getVersion()` 已为 9.0.0。正式重建发行包属于后续构建工作，不能把本次资源更新称为 EXE 文件属性重写或 Steam 发布。

## 验证

- `test-v8.14.1-frontend-content.js`：版本红测后转绿；检查 UI、包版本、主题预览和 Memory 4.0／协议 3.0／存储 2.5／schema 2。
- `test-v7.7.4-stability-infrastructure.js`、`test-v7.8-main-modularization.js`、`test-v7.10-official-action-system.js`、`test-v8.8.5-zhipu-provider.js`、Manifest 检查通过。缓存测试在沙盒 TEMP 曾失败，正常 Windows 环境重跑通过，未改缓存实现或断言。
- 默认关闭／显式开启诊断的真实隔离 VOTC.exe 两次启动均 PASS、exit 0；临时配置目录，CK3 未配置、网络阻断。读回窗口标题、包版本、页脚和提示均匹配上表；默认关闭截图人工检查版本完整可见。
- 当前发布清单为 478 个分类测试文件、409 个发布组、68 个历史归档。完整原始门禁首次及最终工作树复核均 **409/409 PASS、exit 0**；最终日志哈希、35 个生产／测试／当前文档指纹与两份 descriptor、七份未变桥文件登记于[本轮证据](version-alignment-evidence.json)。
- 本轮源码语法及 `git diff --check` 通过。未改 Memory、摘要数据、Prompt／Cache、信件队列或官职脚本；本轮只核验两份 Workshop 元数据，不代替 CK3／Provider／远端 CI 验收。

实际截图与隔离诊断证据在本机 TEMP `votc-v9-performance-smoke-CTC0OD`；完整日志使用 `votc-v9-version-final-release-20261011.log`。日志、截图和运行时数据不纳入 Git。旧 [v9-local-evidence.json](v9-local-evidence.json) 是版本对齐之前的工程证据，不作为当前工作树指纹。

V9.0 总体仍按[实施与验证](V9_0_VERIFICATION_REPORT.md)记录 HOLD：本地版本对齐完成，远端 CI、真实 CK3 对照和启动卡顿现场采样仍待完成。用户已验收的 V8 功能保持原状态。

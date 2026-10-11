# V9.1 源码构建实施与验证

日期：2026-10-11。分支 `codex/v9.1-reproducible-build`；基线为干净 `main` 提交 `c819c85e6912e8531028aa13f0fd87062e36d9d9`。本地 Node 24.13.0／Windows，远端工作流 Node 22。按用户明确确认的旧总路线，本阶段只开发 Source/Build；新方案中的 Context、Memory、Provider、Prompt、UI、Bridge 重构分别移交 V9.2—V9.6。

## 已实现

建立 `src/app/` 可编辑 JavaScript 源与显式 282 文件映射，独立生成 Main/Preload/Renderer、默认数据及包元数据。原始 V9.0 首次构建逐字节等价；不可修改的对照 hash 保存于 `build/v9.0-runtime-reference.json`。构建不依赖旧 `out` 或安装依赖，重复构建的清单及 payload hash 一致。源改变能产生对应产物；源／产物篡改、未登记文件、路径／链接与 LFS 指针会被拒绝。

现有 5,981 vendor 文件、264 包、19 直接依赖固定并校验；两份 App package 声明均固定为实际已安装版本。保留全部实际许可和 native 文件，未安装、升级或重建依赖。CI 保持 LFS／全历史与历史反例，先验证依赖并从源码生成、部署 Runtime，再执行原发布门禁。

项目／核心 V9.1／9.1，App 包 9.1.0，页面标题、页脚、悬停提示、主题预览和当前文档同步；Mod 2.0.5、Memory Engine 4.0、协议 3.0／摘要 2.5／schema 2／Official Action 2.0.3／独立 Three-Mod 1.0.6 保留。

相对原始 282 文件，仅六份元数据／维护说明有差异：App package、核心 version、Renderer 版本常量、页面标题、Main AGENTS、标准 Action AGENTS 的现行验证命令。其余 276 文件（含全部业务实现、Prompt、动作定义、记忆、信件和桥接代码）原字节一致。源码、构建与部署完整 SHA-256 见[本轮证据](v9.1-build-evidence.json)。

## 验证记录

| 检查 | 已执行范围 | 结果 |
|---|---|---|
| 初始源码对照 | 282 个原始 V9.0 运行资源逐字节比对 | PASS |
| 构建专项 | 无旧 out／依赖、Prompt 换行、类型资产、确定性、源修改与篡改 | PASS |
| 干净完整源码构建 | 只复制完整 282 源和映射；重建并检查安装资源对应同一源码 | PASS |
| 运行依赖 | 5,981 文件、264 package、两份清单版本；缺失／注入／修改／版本范围反例 | PASS |
| 独立 QA | 17 项夹具，含目录 junction、悬空链接、大小写保护、语法失败、有限 rename 重试及持续失败保留旧构建 | PASS |
| 完整发布门禁 | 413 发布组；482 分类文件、68 历史归档 | 首次与最终均 413/413 PASS、exit 0；日志 hash 见证据 |
| 真实打包窗口 | 隔离 VOTC.exe 两次启动，诊断默认关闭／显式开启，实际包版本与标题／页脚／tooltip、IPC、导出与合成长任务 | PASS，exit 0 |
| 源与部署一致性 | 282 逐文件 hash 与完整目录清单 | PASS |
| V9.0 远端 CI | 指定 c819c85，Release Regression run 38112648123 | CI_PASS |
| V9.1 远端 CI | 本次未提交／未上传 | PENDING |
| CK3／Provider／启动卡顿实测 | 本轮没有操作真实游戏或调用 API | 未执行，既有用户验收保留 |

V9.0 指定 SHA 的 [GitHub Actions](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38112648123) 已核验成功；旧 V9.0 报告中的 CI_PENDING 为当时快照。本轮新增工作流是否在 GitHub 成功，必须待 V9.1 上传后按新 SHA 检查，不能套用旧绿灯。

独立红测发现并修复：manifest 文件链接／混入兄弟文件未拒绝、语法失败可能污染旧 stage、悬空链接遗漏、Windows 大小写绕过 protected path。目录 rename 在沙盒受限权限下恒定 EPERM，在正常 Windows 下仍有多次短暂占用；现仅对 Windows EPERM/EACCES/EBUSY 同路径最多重试五次，持续失败恢复旧 stage。独立注入失败夹具确认字节不丢失。文件 symlink 创建被本机权限拒绝的场景明确用 lstat 注入，目录 junction 使用真实链接；不把模拟写成真实文件链接验证。

实际窗口截图已检查，页脚版本完整可见；证据留在本机 TEMP 的 `votc-v9-performance-smoke-2Zz5gs`，不纳入 Git。网络故意阻断、CK3 未配置；这证明壳能加载源生成资源及既有 IPC，不证明真实 Provider 或 CK3 运行效果。最终构建比窗口验证时仅多标准 Action AGENTS 的文档命令调整，不改变运行逻辑。

## 限制与交接

本版重建应用资源，继续使用已锁定 vendor 与 Git LFS 壳；没有恢复原始 React 组件工程、重编译 Electron、生成安装器或改写 EXE 的 Windows 旧壳版本。多文件代码部署在应用关闭时进行，不宣称断电事务；持续中断可从源重建并重新部署。没有改变真实用户配置、摘要、队列、信件、ACK、CK3 存档或 Workshop／上游 Mod。

本地 Source/Build 交付完成；V9.1 远端 CI 需用户上传后核验。后续按[架构移交](V9_1_ARCHITECTURE_HANDOFF.md)推进 V9.2；启动卡顿仍需现场诊断，不能用本版字节等价或合成长任务宣称已解决。

操作与回退见[构建说明](V9_1_SOURCE_BUILD.md)。历史设计、冻结报告、V9.0 实施与版本证据没有回写或删除。

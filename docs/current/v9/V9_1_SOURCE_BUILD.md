# V9.1 可编辑源码与可重复构建

日期：2026-10-11。执行范围以 [V9 总路线](V9_ROADMAP.md)第 7.2 节为准。用户明确确认“按照旧总路线为主，不要一次重构完所有内容”。[重新审查方案](V9_1_REVIEWED_PROPOSAL.md)保留原文，属于后续设计输入；本版不实施其中六项业务重构。

## 当前交付

`src/app/` 是唯一可编辑 Runtime 源。从干净 V9.0 提交 `c819c85e6912e8531028aa13f0fd87062e36d9d9` 的已跟踪运行资源提取 282 个文件，首次构建与原安装资源逐文件原字节一致。主进程、Preload、Renderer 和默认数据按显式清单生成；业务 JavaScript 不引入转译或新的打包器。

| 路径 | 职责 |
|---|---|
| `src/app/main/` | 可编辑主进程 JS；`main.js` 为组合根 |
| `src/app/preload/` | 可编辑 IPC 桥 |
| `src/app/renderer/` | 可编辑页面、现有 ESM、独立 JS、CSS、图片 |
| `src/app/default_userdata/` | 默认 Prompt、Action、本地化及编辑器类型资产 |
| `src/app/package.json` | App 元数据与已安装依赖的精确版本声明 |
| `build/runtime-inputs.json` | 282 个源到目标映射；新增文件必须明确登记 |
| `build/v9.0-runtime-reference.json` | V9.0 原始字节对照，不能随源码编辑更新 |
| `build/runtime-dependencies.lock.json` | 现有 vendor 内容、包版本、许可证、native 文件锁 |
| `.build/runtime/app/` | 可重复生成的资源暂存目录，Git 忽略 |
| `.build/runtime/runtime-build-manifest.json` | 逐文件 bytes/SHA-256 与整体 payload SHA-256 |
| `resources/app/out/`、`resources/app/default_userdata/` | 校验后生成并保留的直接运行资源 |

Renderer 的既有 ESM 含已打包 React/vendor 代码。本次建立可编辑 JS 与确定性资源构建，尚未恢复上游 React 组件工程、source map 或 TypeScript 原源；组件拆分属于 V9.5。构建不会把格式化、重压缩或重新编译 vendor 作为“重建”。

## 构建与运行

Windows、Node.js >=22；CI 固定 Node 22，本轮本地工具为 Node 24.13.0。完整 clone 需要 Git LFS 拉取已有壳与 native 二进制。构建工具只用 Node 内置模块，没有构建期 npm 依赖。根 `package-lock.json` 锁定这个零依赖工具工作区；运行依赖由独立 vendor 锁核验，不通过 npm 下载替换。

关闭 VOTC 后，从仓库根执行：

~~~powershell
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
~~~

每条命令须 exit 0 后再执行下一条。也可使用根 package 的 `npm run build`、`npm run verify:build`、`npm run deploy:build`；它们对应同一套脚本。修改 `src/app` 后必须重新构建、部署和校验，不能单独改生成的 `out`。

构建从源清单读取文件，不读取旧 `out`、安装依赖、%APPDATA%、CK3 存档或日志。Main/Preload/Renderer JS 在写入暂存前做语法检查；默认数据中的 `.js` 包含 TypeScript 编辑器声明及 VM 脚本，作为原字节资产复制，其执行合同由原专项测试验证。所有资产参与完整性校验。清单没有时间戳、随机 ID、绝对机器路径；同一源产生同一 manifest 与 payload hash。

源、目标路径遍历、链接／悬空链接、未登记源、未登记产物、Git LFS 指针、受保护输出（含 Windows 大小写变体）和混入其他文件的暂存目录均被拒绝。候选目录完整校验后原子换入；语法失败保留旧有效构建。Windows 目录短暂占用时，仅对 EPERM/EACCES/EBUSY 同路径最多重试五次，持续失败恢复旧构建。`.gitattributes` 的 `src/app/** -text` 保留 Prompt 换行及原字节。

部署只改校验通过的映射资源；VOTC 正在运行时拒绝部署。改变的旧代码先备份到 Windows TEMP 的 `votc-v91-code-backup-*`，逐文件临时写入后替换并复验；普通失败会恢复已写文件。多文件部署不是断电事务，应保持应用关闭；中途掉电后重新构建并部署以恢复一致资源。用户数据不参与部署、备份或清理。

## 依赖、二进制和许可边界

运行依赖锁包含 5,981 个文件、264 个 package root、19 个直接依赖及 4 个 `.node` 路径。依赖仍是 V9.0 已安装版本，本次不执行 install、upgrade 或 native rebuild。UTF-8 严格往返成功的 vendor 文本用 CRLF→LF 的规范化校验值，其余文件使用原字节校验；这只是跨 checkout 的 hash 策略，不写回文件。允许额外空目录，拒绝额外文件。

264 个 package 的 `license` 元数据和实际许可文件路径见锁的 `packages`；其中 251 个 package root 有许可文件。Electron 壳许可保留于根 `LICENSE.electron.txt`，Chromium notices 保留于 `LICENSES.chromium.html`。清单用于追踪既有分发内容，不代表已完成未来安装器或 Workshop 分发的许可审查。

已跟踪的 Electron/Chromium 壳、DLL、LFS 二进制和 native ABI 继续复用，指纹见 [壳与构建证据](v9.1-build-evidence.json)。本版从源码重建完整应用资源并在既有壳启动；没有从 Electron 源码重编译壳，也未生成新安装器或重写 VOTC.exe 的 Windows 文件版本 2.0.3／2.0.3.0。App 包与窗口实际读回为 9.1.0／V9.1。

## CI 与回退

Release Regression 保留 Windows/Node 22、LFS 和全历史 checkout；先核验依赖，构建、校验、部署源生成资源，再运行原发布门禁。历史反例不跳过。干净源码专项测试复制完整 282 个源及映射到临时目录，证明构建不依赖旧安装输出，并验证发布测试使用的安装资源与该构建一致。

回退优先恢复整个已确认 Git 版本的源、清单、工具与锁，重建后关闭应用并部署。不要将旧 `out` 局部覆盖到新源，也不要回退、删除或重放用户记忆、信件、队列或 ACK。Three-Mod 的独立仓库、已安装 Mod 和 CK3 bridge 快照不参与本次迁移。

结果与限制见 [本轮验证](V9_1_VERIFICATION_REPORT.md)，后续重构的逐阶段归属见 [架构移交](V9_1_ARCHITECTURE_HANDOFF.md)。

## V9.2 当前部署合同

以上 V9.1 部署恢复描述为历史记录。V9.2 继续使用相同构建、校验、部署命令，但代码备份与持久 receipt 位于仓库忽略目录 `.build/runtime-deploy-state/`。部署先保存受校验的差异备份及 `IN_PROGRESS` receipt，再逐项替换资源；完成后复验并记录 `COMPLETED`。App 必须关闭。

中断部署后，`verify-runtime-build.js --deployed` 拒绝不完整状态。重新运行 `deploy-runtime-build.js` 会先完整预验证 receipt、备份哈希和所有当前目标，恢复上次一致版本，再部署新构建。恢复执行每项替换前再次检查目标哈希。未知目标内容、缺失或损坏备份会保留 receipt 并阻止写入；不能删除 receipt 强行继续。首次无 receipt 的旧安装仅允许已知一致内容或严格 UTF-8 换行差异初始化。用户记忆、信件、ACK 和队列均不属于此部署事务。

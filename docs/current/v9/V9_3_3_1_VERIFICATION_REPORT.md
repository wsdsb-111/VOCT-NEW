# V9.3.3.1 验证报告

2026-10-14。本地源码/部署已完成；远端放行状态为 **PENDING_USER_PUSH**。不得称为“修复完成且远端门禁通过”。[规格](V9_3_3_1_FIX_SPEC.md)、[实施](V9_3_3_1_FIX_REPORT.md)、[改动](V9_3_3_1_CHANGED_FILES.md)。

## 环境、基线与远端证据

| 项目 | 实际环境/结果 |
|---|---|
| 主仓库 | main，开工 HEAD `fc4f1c60a13b06d7daddac697e484db335f26647`，初始工作区干净 |
| 本机 | Windows 11 家庭版中文版 10.0.26200 / build 26200；Git 2.56.0.windows.2 |
| 日常 Node | v24.13.0（局部事件/冒烟编排） |
| 工作流复现 Node | 官方 v22.23.3 win-x64，下载执行前以官方 SHASUMS256 校验 |
| 原 CI | windows-2025-vs2026 / image 20260925.250.1，Node 22.23.3 |
| 原远端结果 | [run 38503719487](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38503719487)，[job 115656292796](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38503719487/job/115656292796)：部署 FAIL，release 未运行 |
| 本轮新远端结果 | 未推送，未产生新 SHA 的 Actions success；保留用户手动推送安排 |

本机 Windows 全新检出验证与 GitHub 托管 Windows runner 是不同证据。下述通过不能替代最终新 main SHA 的远端 success。

## 四项先红后绿

| 项目 | 旧版复现 | 修复结果 |
|---|---|---|
| FIX-01 | fc4f1c6 全新 Windows/Node22 无 `.build` 检出，原错误稳定复现 | 属性回归 13 资产通过；新鲜检出首次部署通过，三方 icon bytes/hash 一致 |
| FIX-02 | 独立 QA 8/10、2 FAIL：跨会话 ID 复用，同页谱系借证 | 独立 QA 12/12 PASS，0 FAIL；新增身份冲突/hash/revision/Forget/scope 反例 |
| FIX-03 | 95 facts offset 40 仍展示 fact 0 | 40/40/15、缓存返回、快切与失效均通过 |
| FIX-04 | 成功导航后 Loading 仍 true | 成功/异常/STALE/竞争/失效全部通过；事件组 20/20 PASS |
| 补充边界 | 缓存重新认证 throw/拒绝后旧行重新显示；真实 SDK 拒绝四段版本导致启动阻断 | 缓存撤回与新页重试通过；禁用 updater 不实例化 SDK，真实窗口正常 |

## 二进制三方证据

目标 `out/main/chunks/icon-BljXrxwL.ico`；来源 `src/app/main/chunks/icon-BljXrxwL.ico`。

| 对象 | 字节数 | SHA-256 |
|---|---:|---|
| 基线 Git blob / 原始输入 / staging | 46,292 | `19f891af71bc453177e972009db60d56549c45fecd4e9aefebf59cb756455ea8` |
| 基线强制文本 Windows checkout | 46,445 | `cbaf45ac3d45379427fe51f5f488708e6638773538128262a65e178183aa1d86` |
| 修复后 blob / fresh checkout / staging | 46,292 | `19f891af71bc453177e972009db60d56549c45fecd4e9aefebf59cb756455ea8` |

首个差异 offset 45；153 处 lone LF 被插入 CR。13 个二进制 blob 均与可信输入相等，未恢复/重写资产。Git 原生 filter fixture 同时验证文本 main.js 仍 text/CRLF，ICO/PNG/OTF 和未来二进制 -text/eol-unspecified，`.bin` LFS 独立 filter/diff/merge 保留。

## 构建与完整回归

执行原工作流六步，不关闭步骤或 continue-on-error：

```powershell
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
```

最终 runtime payload：`0a45f1a6263b0df143b9fe60b4f266259123c2618b112a05d6c41f72ffce8ddb`；App 9.3.3.1，296 项源码/构建/部署严格 parity，5981 个依赖文件/264 个包。清单实测 517 个 test 文件，443 个 release 组，73 个历史归档；两个新增发布组已登记。

主仓库最终完整发布回归 **443/443 PASS**；全新 Windows 检出原工作流六步也全部通过，完整发布回归 **443/443 PASS**。两者均以 Node 22.23.3 执行，退出码 0。干净检出使用本地隔离 Git 快照 `941e863afffdda15c3e410b4a879d7f6dbe15c8d`（不是远端提交），`core.autocrlf=true`；初始无 `.build`、receipt 或旧备份。68 个 materialized LFS 资产均按 OID 验证后复制进检出，未带入用户设置/记忆。源码及受管产物与主仓库相同，最终 payload 一致。

完整测试初轮发现两个旧版本头断言尚未同步（adapter-conformance、GLM outbound equivalence）。只更新受版本升级影响的预期；未改冻结黄金请求或跳过测试。最终 GLM paired 101 场景保持除显式版本头外的原生序列字节一致，SDK mock、network=0。

## 真实打包 Electron（匿名合成）

两个独立临时 profile，APPDATA/LOCALAPPDATA/userData 均隔离，网络阻断，真实 VOTC.exe Main/Preload/Renderer。实际 `app.getVersion`、IPC、标题、底部及 tooltip 均为 9.3.3.1；16 个关键 Main 模块源/产物 hash 一致并由打包进程加载。

诊断开/关、人物认知、Memory4 合成写入/恢复、Action 取消与未知效果保守状态、改名目录、四页签、CAPPED/UNKNOWN、1000 Detail 条目每页 40 行及三主题通过。95 fact Coverage 真实按钮依次请求 `(0,40) → (40,40) → (80,40) → (40,1) → (0,1)`，显示 40/40/15，尾页下一页禁用；详情成功后无 Loading，按钮恢复。缓存认证失败及 STALE 撤回旧页，重新认证从 offset 0 开始。

Coverage UI DTO 为匿名测试 fixture，经真实 IPC/Preload 驱动生产组件；规范 Store/ACL/source 身份另外由独立回归验证，不能把 mock DTO 数字当真实游戏覆盖率。三主题第二页截图已人工查看，能看到 fact 40 起的不同记录与 V9.3.3.1 标签；截图/诊断均在本地临时目录，不提交。

本地日志：`.build/v9331-release-final.log`、`.build/v9331-candidate-test-release.log`、`.build/v9331-clean-candidate-report.json`、`.build/v9331-independent-qa.log`、`.build/v9331-packaged-smoke.log`。只读哈希/计数汇总见 [匿名证据](v9331-verification-evidence.json)。

## 待完成 Gate

| Gate | 状态/边界 |
|---|---|
| 本地修复与匿名自动化 | PASS；完整 release 443/443，两处独立执行，源码/部署 payload 一致 |
| 远端 CI | PENDING_USER_PUSH；用户手动推送后，须核对该 SHA 的 [Release Regression](https://github.com/wsdsb-111/VOCT-NEW/actions/workflows/regression.yml) success |
| 测试存档人工验收 | 待用户在真实对话/已加载战役验证来源关联、第二页、Durable 跳转、编辑/Forget 的撤回 |
| CK3 长会话/Soak | 未执行，不能由合成或静态通过替代 |
| 原生 Provider | 本轮零调用/零费用；不对缓存收益作新结论 |
| Year/Life 历史清理 | 本轮禁止，未执行；现有数据和迁移回滚工具保留 |

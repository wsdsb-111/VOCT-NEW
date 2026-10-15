# V9.3.4 验证报告

日期：2026-10-15。本地实施提交 SHA `69ef4b272cb87238bbc1a45fe9d49c0846084c3e`；runtime payload SHA-256 `5823950499a768f97c0cf2dd483c0559e68e6b00cfe3a73cc9c5a5d81b7a2aad`，278 个 source／artifact／deployed 映射一致。App 9.3.4。

## 门禁状态

| 门禁 | 当前状态 |
|---|---|
| G0 结构与边界清单 | PASS |
| G1 Durable outbound／自动恢复归零 | PASS，合成生命周期及三类硬拒绝；零付费 |
| G2 Legacy 召回 | PASS，专项 10 项；实际 Conversation → PromptBuilder → Provider mock 输入另有有效回归 |
| G3 独立 CRUD／Forget | PASS，独立 QA 5 项、Forget 7 项、独立 CRUD 2 项；含事务失败逐字节回滚及 Letter 崩溃窗口 |
| G4 生产代码／UI 清理与部署 | PASS，runtime 21 移除／3 通用迁入，278 映射 |
| G5 统一发布、清洁 Windows、打包窗口 | PASS，清洁 Windows 全部 402／402 发布组；两个真实 Electron 隔离 profile 通过 |
| G6 最终 main SHA GitHub Release Regression | PENDING_USER_PUSH；不自动推送 |
| G7 CK3／Soak／真实模型 RP 与成本 | NOT_RUN，本轮未授权付费实验，不宣称 Full Freeze |

基线 SHA `3c1c2162e63f587bf920c8670bc88f9c263ac0f1` 的 GitHub workflow 查询没有返回 runs，因此不宣称该 SHA 远端 success；旧版本其他 SHA 的成功不替代当前验收。

## 测试清单变化

原清单 443 发布组／73 历史项；当前 **402 发布组／127 历史项**，530 个 test 文件分类。48 个 Durable／Memory4 专属旧发布脚本移为历史，6 个混合脚本保留原 Memory4 分块至独立 baseline-only 历史脚本；新增 7 个 V9.3.4 发布脚本。Legacy／Action／Provider／Worldline／通用 UI 有效部分继续执行；不会把归档等同通过。逐项名单在变更清单和 JSON 审计。

## 用户要求的实际召回数量

以下为相同 7 篇合成 Legacy 原文、单响应 NPC、1200 Token 测试预算，已断言每个计数来源确实出现在最终 recall block。正文 Token 采用夹具 ceil(chars/2) 估算，非服务商原生账单；格式注记、Chat 历史和模型输出不包括在正文估算中。

| 场景 | 固定直接摘要 | 本轮新增 Extra | 选中正文估算 Token |
| ordinary | 2 | 3 | 164 |
| obsolete-flag | 2 | 3 | 164 |
| direct-recollection | 2 | 3 | 164 |
| year-1170 | 2 | 1 | 94 |
| out-of-scene-chen | 2 | 2 | 117 |
| foreign-campaign | 0 | 0 | 0 |
| next-turn | 2 | 0 | 56 |

该夹具官方追忆与稳定事实 lane 均为 0；有合法官方数据时官方追忆独立最多 1 份。普通对话 **2＋最多3** 是每个响应人物每轮的默认上限，不是每轮强制补满3篇；已成功注入的 Extra 随会话历史保留并去重，多轮追问可复用历史原文。本场固定摘要不会每轮重新检索替换。多人场景每个直接关系最多2篇，共用预算。

“旧冲突原因／援助条件／战争传闻／时间索引／场外陈将军”均保留原文叙述；未来日期、Owner／Campaign、身份歧义、无授权来源、Forget 后本轮缓存／换会话／重启均有负测。Trace 与 JSON 只保留匿名来源 ID、哈希、字符与估算 Token，不提交真实摘要。

## Provider 与 Action

七 Adapter 39 个冻结 wire 场景通过；GLM 101 个成对场景、其中96个矩阵场景只允许显式版本字段变化；11项 GLM 前缀／隐私／usage场景及失败门禁共12项通过。通用发送前来源 guard 和配置／取消／预算／重试合同保留。Official Action 的 ACK／CONFIRMED、未知效果不重放与 CK3 回读合同保持，真实游戏效果另验。

## 证据说明

本地命令、详细日志和打包截图在忽略的 .build 或隔离临时 profile；不提交用户数据、日志和截图。构建使用 Node22.23.3、锁定依赖，无依赖升级。最终完整门禁与两个真实 Electron profile 均已收口；合成测试不能代替玩家20–30轮、80–100轮、跨存档、跨年代及成本窗口验收。

## 最终 Windows 与 Electron 证据

清洁本地检出快照 SHA `73da1495ead80c9c025098e08ec5336f019c687d`（隔离验证提交，不是 main／远端提交）。从无 .build 的工作目录开始，在 Windows、core.autocrlf=true、Node v22.23.3 下按 GitHub workflow 的同一顺序执行：

~~~powershell
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
~~~

六步全部 exit 0；锁定依赖 5981 文件／264 包、68 份 LFS 对象已验证；完整发布回归 **402／402**。生成并部署 278 映射，与主工作区 payload `5823950499a768f97c0cf2dd483c0559e68e6b00cfe3a73cc9c5a5d81b7a2aad` 一致。Windows icon Git blob、检出、staging、deployed 均为 46292 bytes，SHA-256 `19f891af71bc453177e972009db60d56549c45fecd4e9aefebf59cb756455ea8`。未关闭失败门禁、未修改 CI workflow。日志位于 .build/v934-candidate-*.log。

真实 VOTC.exe 使用两个独立合成 profile（performance off／on），设置 APPDATA、LOCALAPPDATA 与 user-data-dir 到仓内隔离目录，并阻断网络；没有打开真实用户资料。每个 profile 含 95 篇合成 Legacy 和 1 篇合成官方追忆，实际 UI → Preload → IPC → 文件 writer 编辑／删除、日期筛选（10 条）、正文展开、重要事项、分页（每页10条）、搜索通过；官方项无可写控件且主进程拒绝写入。版本 title／footer／tooltip 均9.3.4，旧 Memory4 页面／Bridge／IPC 不存在。性能诊断开关与导出隐私负例通过，模块哈希匹配部署源。两个 profile Provider、外网和 CK3 调用均0。

合计6张游牧／骑士／水墨截图保存在 `.build/v934-packaged-smoke-8ZCIh0`，三主题正文与控件已人工阅图；详尽匿名模块／截图哈希见审计 JSON。测试程序退出后不保留运行中的 VOTC 进程。原生 Electron 成功不等于 CK3 实机或长期 Soak 成功。

## 本地提交与待发布边界

实施提交 `69ef4b272cb87238bbc1a45fe9d49c0846084c3e` 位于本地 main。其后的文档回执仅补充本 SHA 与证据，不改变已测试的 Runtime；相对清洁验证快照，测试脚本另只移除一行末尾空白。主仓库最终文档提交 SHA 可由 `git rev-parse HEAD` 查询。未执行 push，GitHub CI 必须在用户推送后按最终 main SHA 重新核验，不能使用隔离快照或旧 SHA 代替。

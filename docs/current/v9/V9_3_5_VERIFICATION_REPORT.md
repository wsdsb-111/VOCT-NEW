# V9.3.5 验证报告

日期：2026-10-15。初版基线 SHA `941104063581f37de799065216ed422779460b8e`。Core／App／UI 9.3.5；Runtime 285 映射。离线确认修复后的 payload SHA-256 为 `1b6dbb788902788f20da02401a88c585fa1d33f9f3b1a58fd626b13a26a6596b`。实施与数据合同见[实施报告](V9_3_5_IMPLEMENTATION_REPORT.md)、[来源合同](V9_3_5_INDEX_AND_SOURCE_CONTRACT.md)。

## 离线确认写入修复

用户实测“提取成功但确认按钮禁用”，并确认仅打开历史摘要、未连接游戏。原 service 仅在活动 GameData 包含 Owner 时授予写入，ledger 又禁止历史预览 apply；因此提取本身成功，确认链却无法执行。不是点击样式问题，不能只移除 disabled。

现允许在所选范围具有唯一可信 Campaign 绑定时离线确认生成本地派生索引；单 Pair 按该 Pair 判定，Owner 批量按整个 Owner 判定。get／preview／apply 同一权限计算，apply 重验来源和预览 revision；未绑定、多战役歧义、来源变化、客户端注入 Campaign／path／离线权限字段仍拒绝。不修改原 Legacy，不补当前游戏日期，不增加模型请求，Durable 与旧 Sidecar 仍退役。

反例先在原代码复现 writable=false；修复后实际 IPC＋Store 回归及独立合成验证通过：离线确认原子写盘、原摘要逐字节不变、重复回填不重复、只预览／取消无写、未绑定及同 Pair 多 Campaign 拒绝、同 Owner 不同 Pair 可各自明确绑定、Owner 跨 Campaign 批量拒绝、来源或 Campaign 变更使旧确认失效。该修复增加已有测试组内的断言，manifest 仍为 407 发布组／127 历史项／535 文件。

本轮在干净 Windows 检出快照 `c430111e7595ad7fd7c9e815d2dd51a27cdede1a`（本地隔离验证提交，基于 `11f431c`）从无 `.build` 开始，Node22.23.3／core.autocrlf=true，按相同 CI 六步执行，全部 exit 0，407／407 发布组通过。68 份 LFS 对象、5981 个锁定依赖文件／264 包通过校验，285 source／artifact／deployed 映射与根工作区 payload 一致；日志为 `.build/v935-offline-candidate-*.log`。

真实隔离 VOTC.exe 离线窗口通过 UI→Preload→IPC→索引文件验收，没有注入或模拟 GameData。单 Pair 确认成功落盘；Owner 预览含 2 个关系，取消后索引和源文件均无写入，再预览确认显示 2／2 成功，重复确认无重复事项且索引哈希保持不变，两份 Legacy 文件哈希始终不变。Provider／network 调用均为 0，没有真实用户资料或 CK3 调用。证据目录 `.build/v935-offline-backfill-smoke-jHg4yH/offline-native`；`offline-owner-confirm-enabled.png` 和 `offline-owner-write-success.png` 已逐图阅查，分别显示确认启用和 2／2 成功。单 Pair 以真实索引 JSON 和文件断言证明，不把未对准的单 Pair 截图当视觉证据。测试结束无 VOTC 进程残留。

下方为初版已完成的验收快照（初版 payload `cc70be7d30fc6821c5a5112179da5008c36257d98705ea73d9d923f7add2aa8a`）；其中离线只读断言由本次用户确认的离线索引回填合同替代，不代表当前行为。真实 CK3／Soak／最终提交远端 CI 仍独立待验，不自动 push。

## 初版验收回执

## Gate 状态

| Gate | 证据／状态 |
|---|---|
| Phase 0 基线与边界 | 基线匹配、干净起点；基线远端 Release Regression success |
| Phase 1 Parser／Index／Source | 本地专项和独立反例 PASS |
| Phase 2 两级检索及兜底 | exact source、同日多场、旧全文尾部、零新增调用 PASS |
| Phase 3 UI／回填 | controller、实际 IPC 夹具、双隔离原生 Electron 只读归档窗口 PASS；活动 Campaign apply 为夹具验证 |
| Phase 4 多人／预算 | 迟到／耳语／缺席、NPC 方向、冻结切换、最终格式预算 PASS |
| Phase 5 信件 | 双向实际文件证明、崩溃恢复、Forget／旧标记拒绝 PASS；真实 CK3 待验 |
| Phase 6 构建与本地发布 | 285 source／artifact／deployed 哈希一致；最终干净 Windows 六步门禁全部 exit 0，407／407 组通过 |
| 最终 main SHA 远端 CI | PENDING_USER_PUSH，不自动推送 |
| 真实 CK3／Soak／付费 RP 质量与成本 | NOT_RUN，不宣称 Full Freeze |

基线 GitHub Actions [Release Regression run 38679591704](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38679591704) 查询为 completed／success，head_sha 精确为 `941104063581f37de799065216ed422779460b8e`。它不替代本版最终提交的远端验收。

## 自动化验收矩阵

当前 manifest：407 发布组／127 历史项／535 个 test 文件。相较基线新增 5 个发布组，无旧组降级归档。新测试均通过 Node22.23.3 执行，原有有效 Legacy／Provider／Action／Worldline／UI 回归继续执行。

| 规格 ID | 主要发布测试 | 结果与边界 |
|---|---|---|
| PAR-01、PAR-02 | pair-ledger、pair-ui | 标题、5 项续行、条件否定、无标题／空事项／歧义确认 PASS |
| IDX-01–06 | pair-ledger、independent-qa、pair-service-qa | 幂等、同日、Owner／Campaign、改删／Forget／改名、写失败、陈旧源 PASS |
| RET-01、02、04 | independent-qa | 长命锁精确源、同日正确对话、同源 5 项展开 1 次 PASS |
| RET-03、05 | independent-qa、旧 Legacy／tail 回归 | 无事项的叙事细节兜底、旧正文尾部约定和过期索引拒绝 PASS |
| RET-06、07 | independent-qa、Provider／Conversation 回归 | 原参与人数总预算及格式开销、额外 Provider 调用 0 PASS |
| RET-08 | independent-qa | 150 摘要／750 项／9 查询对照，实际数值见下；无提速保证 |
| MUL-01、02 | independent-qa | 双向 NPC、空流占位、迟到、耳语、混合可见性及离场边界 PASS |
| MUL-03 | independent-qa | 时间 3＋人物 3 可同时入选；紧预算裁剪后最终格式仍合规 PASS |
| UI-01、02 | pair-ui、pair-service-qa、pair-ledger | stale preview、逐 Pair 确认／进度／取消、损坏来源、权限 PASS |
| UI-03、04 | pair-ui、pair-service-qa、pair-ledger | 验源／修订拒绝、实名、全库筛选、真实分页、组合关键词和 41≠141 数字边界 PASS；原生范围另列 |
| LET-01–04 | letter-summary、原 Letter／Forget 回归 | 无重复效果、双方实存、已完成模型复用、缺失证明阻断 PASS；CK3 物理效果 NOT_RUN |
| REG-01 | v9.3.4 retirement／forget 等现有组 | Durable／Year／Life 未恢复，惰性 Sidecar 和事务合同 PASS |
| REG-02 | build／verify／deploy／release、原生 smoke | 本地构建／部署 PASS；最终远端 CI 待用户推送 |

上述新脚本全名均为 `scripts/test-v9.3.5-<名称>.js`：pair-ledger、pair-ui、letter-summary、independent-qa、pair-service-qa。独立 QA 共 8 项，实际调用 MemoryEngine／MemoryStore；IPC QA 注册真实 handler，不只检查源码字符串。

新增同 stat 反例固定完整文件状态签名后执行等长改写：旧索引拒绝、Legacy 缓存刷新，解析源后再次改写也在最终版本验证中丢弃。独立测试在 Node22 连续 3 次通过。Provider transport 前还有当前 Campaign／源版本守卫。

## 实际召回与预算证据

这些是合成夹具，Token 用既有估算函数计数，不是服务商原生账单；最终标题／日期／文案计入预算。

| 场景 | 观察 |
|---|---|
| 普通当前 Pair | 冻结直接基线 Recent1，旧两篇不再强制填入 |
| 切换 NPC 对象 | 原冻结前缀保留，动态包含新 Pair Recent1，即使已在 seen 集合中；最终格式 146／1000 Token |
| 时间＋场外人物，预算 1600 | Temporal 3、Entity 3，共 6 篇，最终格式 513／1600 Token |
| 密集长文，预算 1100 | 按剩余预算裁剪到 Temporal 3、Entity 0，最终格式 1051／1100 Token |
| 一个历史源含 5 项命中 | 原源只展开 1 次，避免 5 份重复正文 |
| 索引未覆盖叙事细节 | 旧 Legacy 全文／人物／时间路由仍可召回 |

每名响应 NPC 的实际额外篇数取决于命中与预算，不是每轮固定 6 篇；Pair 原源最多 2 篇也占同一预算。合法官方摘要独立最多 1 篇。模型上下文安全余量与截断合同保持。

## 性能与质量对照

匿名可复现夹具：150 篇 Legacy、750 条事项、9 个中文查询；相同源集分别用 PairIndex 与现有 MemoryRanker，比对唯一 Golden Source。两者 Recall@1 与 Recall@3 均为 9／9；Pair 候选事项平均 1.44、最多 5，长命锁的 5 项归于 1 个源且只展开 1 篇，源召回注入约 98 个估算 Token。

最终干净检出执行记录：索引构建 28.44ms；Pair warm search P50 3.06ms／P95 3.48ms；LegacyRanker P50 2.11ms／P95 3.37ms。P95 使用 nearest-rank，没有速度阈值。索引在这个小规模、安全验源夹具上略慢，不能宣称性能提升。Recall@K 只是合成定位准确率，不等于真实 RP 质量或长期记忆完整率。

## 原生窗口与最终干净检出

最终干净检出快照 SHA `65be99d47877d8f1f95f28e7de8e16eebcc96447` 是隔离验证提交，不是 main 或远端 SHA。Windows、core.autocrlf=true、Node22.23.3，从不存在 `.build` 的工作目录开始执行以下六步，全部 exit 0：

~~~powershell
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
~~~

锁定依赖 5981 文件／264 包、68 份 LFS 对象通过验证。407／407 发布组通过，285 映射及 payload 与根工作区一致。Windows icon Git blob／检出／staging／deployed 都是 46292 bytes，SHA-256 `19f891af71bc453177e972009db60d56549c45fecd4e9aefebf59cb756455ea8`。没有修改 workflow 或关闭失败门禁；预期负例日志不冒充真实事故。

日志在 `.build/v935-candidate-*.log`，性能匿名数据在清洁检出的 `.build/v935-performance-evidence.json`。

真实 VOTC.exe 在两个独立合成 profile（performance off／on）通过最终窗口验收，证据目录 `.build/v935-packaged-smoke-iceBvk`。APPDATA／LOCALAPPDATA／user-data-dir 均隔离在忽略的 `.build`，网络与 Provider 阻断；两个 profile 的记录均为 providerCalls=[]、networkAttempts=[]，CK3 未调用。模块／Renderer source 与 deployed 哈希核对通过，title／footer／tooltip 为 9.3.5。

每个 profile 含 95 篇合成 Legacy 和 1 篇只读官方摘要，真实 UI→Preload→IPC 验证原文展开、重要事项、Legacy 搜索／日期／10 条分页、编辑和删除；官方项无写控件，后端拒绝改删。Pair 目录初始 66 条、每页 20、第 2 页确实改变，组合关键词各唯一命中，日期筛选 65 条，newest／oldest 切换正确；主标签为“合成持有者 → 合成对象”。服务端复验后显示来源全文并定位到真实行，旧修订在编辑／删除后拒绝；移除一项／删除另一个源后，目录依次刷新为 65／64 条，旧事项搜索为 0。

离线归档 writable=false，预览后取消不落盘、确认禁用；没有伪造活动 CK3 会话来冒充真实回填验收。可写 apply、逐 Pair 批量确认／取消与故障路径由独立 controller／实际 IPC＋Store 夹具验证。性能开关及匿名导出隐私负例通过，Memory4／Durable Bridge、IPC 与 Provider 请求保持不存在。

每个 profile 保留 Pair 与 Legacy 各 3 张游牧／骑士／水墨截图，共 12 张；performance-on 的 6 张已经逐图阅查，人物姓名、条目、来源按钮与原摘要可读。截图按实际视口捕获。测试结束后已关闭隔离 VOTC，`Get-Process -Name VOTC` 无输出；原生离线成功不等于真实 CK3、Soak 或模型 RP 质量通过。

## 限制与提交边界

新摘要的迟到合法事项不再被修复流程误删；最终模型是否完整列出重要事件尚未做真实 Provider RP 验收。历史缺事项标题的摘要只保留 Legacy 全文兜底，不自动重发模型或补造事项。

旧 Memory4 信件 Recovery 不在本版自动转换；无精确 Legacy 证明时人工阻断。现存真实失败任务没有被本轮夹具重放。真实信件／宝物 ACK 与效果、跨存档、跨年代、20–30 轮及 80–100 轮 Soak、成本统计窗口均待用户实机验证。

本地 main 实施提交为 `3704c820ef2c53061b5bad64454495a752df82d2`，包含源码、对应构建部署资源、测试及报告。其后仅补充本提交号的文档回执，不改已测试 Runtime 或测试脚本；最终文档提交号用 `git rev-parse HEAD` 查询。未执行 push，最终 main 的 GitHub Actions 须由用户推送后按精确 SHA 核验，不能用隔离快照或基线 success 代替。

日志、截图、夹具数据与临时验证快照不提交；没有提交真实用户摘要、设置、API 凭据、CK3 存档或分析数据。工作区收口后保持干净。

# V9.3.7 文档与遗留本地验证后续收口

日期：2026-10-17。起始 HEAD：`9caffe650a7f7abbb07dcaaeccbe0237edb74935`。用户授权同步文档及复验遗留测试，随后明确要求暂缓远端 CI；本轮最终范围为文档和本地门禁。旧 058 候选记录保留，不将其 PASS 继承为本轮结果。

## 文档同步

根 README 聚焦 V9.3.7 当前功能、运行、源码与构建入口；历史版本通过 CHANGELOG 和 docs 索引保留。根、src、Main、标准 Action、scripts、docs 共 8 份 AGENTS（含 2 份生成副本）同步现行版本、Recent1／L0–L2、16%／18%／20% 与 4800／5600／6400 Token 合同、年龄来源与公开亲属边界。生成指南通过正常构建部署同步。

文档索引新增当前推荐阅读顺序，将旧“当前版本”段落明确归为历史阶段；摘要说明改为 Core／App／UI 9.3.7。原实施／验证／实机清单注明旧批次边界，修正“完整 release 仍在运行”等过时语句。没有删除历史版本文档或用户数据。

## 复现与修复

1. **公开亲属进入稳定 Prompt 的旁路**：旧实现仅在部分查询／投影中检查 otherParent，通用图仍可把 UNKNOWN、旧 Campaign 或旧 snapshot 的关系写入稳定血亲和身份知情说明。`character-kinship-graph.js` 提供派生前过滤，`kinship-graph-cache.js` 为共享展示／targeted 图核验当前公开来源；原始诊断图保留证据。直接 parents 的新 marker 同样核对来源、Owner／Child／relation、公开及知识状态、冲突和 Campaign／snapshot。旧式无 marker 的显式 direct-parent 行继续兼容。日期、天数和 normalized evidence 参与缓存失效。`relationship-resolver.js` 保留新 direct-parent 的来源证据，并拒绝缺源或 SECRET 的 otherParent 归一化。Memory 图继续排除 otherParent。
2. **稳定年龄绕过统一解析**：`character-profile-v2.js` 改用 `resolveCharacterAge`；裸数值、空年龄、来源冲突和亡者旧当前年龄不能绕过统一合同进入稳定资料。没有改变 Prompt block ID、cache anchor 或新增模型请求。
3. **Windows 队列原子替换短暂占用**：首轮 Node 22 完整门禁中，`v8.15.2-outbound-bridge-independent-qa` 在保存队列 dispatch intent 时出现 rename EPERM，关闭命令进入 BLOCKED，单独复跑通过。`run-file-manager.js` 对同一 prepared 临时文件的 EPERM／EACCES／EBUSY 最多尝试 5 次（累计等待上限 200 ms），重试相同字节，不重发 Effect。持久失败仍 BLOCKED／STALLED；awaiting_ack 仍先于物理载体替换持久化，未知送达不自动重放。

新增 `test-v9.3.7-public-kinship-cache.js` 与 `test-v9.3.7-runfile-atomic-retry.js`，已登记 manifest。独立 QA 使用另行设计的 raw／normalized／targeted／Family DTO 及故障注入 fixture 复核。

## 本轮验证

系统 Node 为 v24.13.0。首次回归停在要求 Node 22 的历史 A/B 检查，这是运行版本不符；未修改或放宽该门禁。随后从 nodejs.org 下载便携 **Node v22.23.3** 到忽略目录；官方 win-x64.zip SHA-256 为 `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`，下载值一致。运行依赖未安装、升级或重建。

当前检出缺少旧 .build 证据及部署 receipt。先从已知 HEAD 的严格构建与初始 parity 建立正常 receipt，再恢复已授权的源码指南编辑并构建部署；没有手写 receipt、接受未知目标或绕过恢复门禁。

| Gate | 本轮状态 | 证据与限制 |
|---|---|---|
| 锁定运行依赖 | PASS | `.build/v937-followup-dependencies.log`，5981 files／264 packages |
| 年龄／公开父母／继亲专项 | PASS | 原六项 V9.3.7 专项及新增公开图／原子替换检查；均为合成 fixture |
| 独立对抗 QA | PASS（限定范围） | `.build/qa/v937-stable-kinship-probe.cjs`、`v937-direct-parent-bypass-probe.cjs`、`v937-consumer-boundary-probe.cjs`、`v937-runfile-rename-probe.cjs`；合法保留、来源拒绝、缓存失效及未知效果不重放 |
| 构建／部署／parity | PASS | 290 mappings；payload `6e84fc148f3f95efd103e2f79277407c0a163afec19b486c9365e77db1e154f0`；`.build/v937-followup-build.log` 和当前 build manifest／receipt |
| 完整发布回归 | PASS | `.build/v937-followup-release-complete.log`，最终 `VOTC Release Regression: PASS (444 groups)`；572 test files 已分类，444 release groups／127 archived checks |
| Node 22 原正式性能 | PASS（限定批次） | 最终源码每臂 20 warm-up／30 samples：P95 0.8718→0.8797 ms（+0.91%），原 10% 阈值不变；普通 Prompt 2857→2857 tokens，三类 query 的 Prompt／家庭块 delta 均为 0；`.build/v937-followup-perf-comparison.json` |
| 独立暖态性能复核 | PASS（限定批次） | 固定 ABBA，每臂每 query 2000 预热／5000 样本；普通每侧共 10000 样本，P95 0.1476→0.1513 ms（+2.51%），固定种子 1000 次 bootstrap 95% 比值区间 [0.9644, 1.0739]，上限小于 1.10。前两批 HOLD 保留；见下文范围限制 |
| Pair benchmark | PASS | 22 cells／484 calls，0 gate failures、completed=true；`.build/v937-followup-pair-benchmark.json`、`v937-followup-pair-benchmark.log`；5 个核心 Pair 源哈希与 HEAD 基线一致 |
| 隔离原生 Electron smoke | PASS | 6 groups：版本、实际 Main 哈希、Renderer／IPC、设置、部署年龄与亲属边界；进程正常 exit 0。`.build/v937-followup-electron-evidence.json`、`v937-followup-electron.png`。这是隔离窗口验证，不是 CK3 实机验收 |
| 语法／文档链接／差异检查 | PASS | 根指南指定的 7 个生成 JavaScript 入口 `node --check`；当前 5 个文档入口相对链接无缺失；`git diff --check` 无错误 |
| 合成生产 Prompt Provider | PARTIAL（原批次） | 本轮未新增付费调用，不覆盖原有错答或未知表达限制 |
| CK3／游戏内 Provider／Soak | NOT_RUN | 必须分别实机签署，不宣称 Full Freeze |
| 远端 CI | DEFERRED（用户要求） | 旧 9caffe6 run 保持 FAILED；本轮不改 workflow、不提交推送或触发远端复跑 |

首轮完整门禁的 queue rename EPERM 记录保留于 `.build/v937-followup-release-node22.log`。另一次运行因本轮错误地将隔离窗口与部署测试并行，触发 build_close_votc_before_deploy，记录在 `.build/v937-followup-release-final.log`；这不作为源码回归。随后窗口、正式性能、Pair benchmark 和完整回归改为串行。完整最终结果单独记录，不混算失败尝试。

最终完整 444/444 包含两个新增专项、原 V9.3.7 六项、旧结构缓存、队列恢复、主题、官方 Action、独立构建／部署及历史兼容检查。主题与官方 Action 另有直接专项 PASS。未修改发布 runner、CI workflow 或历史阈值，也未跳过失败检查；尚未实测的 CK3／游戏内 Provider／Soak 不计入本地通过。

完整回归曾在第 375 组发现旧结构缓存合同被破坏：无新来源 marker 的旧图仅时钟推进时应复用。缓存现在仅对新 CK3 父母来源增加时间失效维度，保留旧结构身份，同时继续在来源字段、出生／死亡等实际内容变化时失效。失败保留在 `.build/v937-followup-release-cache-compat-failure.log`，历史结构缓存专项已复验通过。

稳定资料的 direct-parent 来源只保留核验元数据，不复制姓名或配偶子树；`trait-profile-selector.js` 同时过滤 normalized direct-parent evidence，以及 raw parents／otherParent，避免自定义模板从字段别名读取被拒绝的亲属姓名。原始 otherParent 的 Child 矛盾、SECRET、无效当前日期和缺源同样拒绝；合法 STEP 使用原专用门禁，旧格式无 marker 显式父母继续兼容。独立 `.build/qa/v937-trait-profile-direct-evidence-probe.cjs` 与正式专项覆盖这些旁路。为补齐 raw 别名过滤主动暂停的整轮日志另保留在 `.build/v937-followup-release-interrupted-for-alias-fix.log`，不计为最终完整通过。

继亲 spouses／children／parents 三层数组同时按 source 或 typed sourceRelation 识别新记录；删除／伪造 source 不得伪装为旧格式而跳过公开来源校验。合法当前继亲、真正无新 marker 的旧记录继续按原合同处理；独立 `.build/qa/v937-trait-profile-selector-alias-probe.cjs` 与正式 public-kinship-cache 专项覆盖合法保留和缺源／SECRET／旧快照拒绝。

性能失败证据 `.build/v937-followup-perf-regression-preserved.json`（P95 0.4999→0.6548 ms）和 `.build/v937-followup-perf-fingerprint-optimization-failure.json`（0.3723→0.5636 ms）均保留；不提高阈值、不丢弃失败批次。诊断减少了重复来源扫描与元数据临时数组，并将每人物多次字段 JSON 序列化改为一次结构化序列化，保留全部来源／人口／关系失效输入和新 parents 的配偶子树排除规则。`.build/v937-profile.cjs` 的 200 预热／4000 纯家庭调用显示总耗时约 411→389 ms，但该诊断不替代正式门禁。

独立 QA 四臂采用 baseline／candidate／candidate／baseline 串行、循环外静音，家庭构建与完整 Prompt 分阶段计时，不筛选批次。前两批每 query 200 预热／1000 样本：普通 P95 点估计分别 +7.37%、-1.45%，但固定种子 bootstrap 95% 比值区间上限分别 1.1835、1.1710，仍高于 1.10，均 HOLD；完整证据在 `.build/qa/v937-steady-performance-2026-10-17T12-31-01-811Z/`、`v937-steady-performance-2026-10-17T12-31-37-153Z/`。同臂前后分窗 P95 仍下降约 24–25%，不能证明已达稳态；复验方案在执行前固定为每 query 2000 预热／5000 样本，保留每 500 样本窗口及全部原始值，仍要求比值区间上限不超过 1.10。

该固定新队列通过，证据为 `.build/qa/v937-steady-performance-2026-10-17T12-36-10-700Z/summary.json`、四臂 raw JSON 与 `run-plan.json`；未删除异常值或选择窗口。冷建图与日期推进失效另列诊断，不混入暖态门槛。两侧仅各 2 个独立进程臂，pooled-sample bootstrap 不能充分估计臂间波动；夹具人数少，仍不覆盖真实存档规模、实机尾延迟或 Provider／Soak，不宣称普遍提速。

源码影响路径为 `src/app/main/actions/run-file-manager.js`、`game-data/relationship-resolver.js`、`prompts/character-profile-v2.js`、`prompts/trait-profile-selector.js`、`worldline/character-kinship-graph.js`、`worldline/kinship-graph-cache.js`，对应生成文件由构建部署同步。默认标准 Action 脚本、其签名及用户脚本未改动。相邻既有成人动作检查问题由独立 QA 发现，未纳入本轮修改与通过范围。

## 远端 CI 暂缓记录

公开 API 已核对 [`9caffe6`／run 39004062734](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39004062734) 与 [`2d1ecd9`／run 38991988024](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38991988024)：依赖、构建、部署一致性通过，发布回归失败。没有取得失败组详细日志，不能把本地 queue EPERM 推定为远端根因。

详细日志 API 返回 403；自动审批拒绝读取本机 GitHub 凭据，原因是该访问未获明确授权，未读取或输出凭据。GitHub 连接未成功，用户随后明确暂缓 CI；CI 专属 runner／annotation 改动已撤回，不再请求连接或进行远端操作。

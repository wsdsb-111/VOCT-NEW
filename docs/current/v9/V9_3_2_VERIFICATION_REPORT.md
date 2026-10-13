# V9.3.2 验证报告

状态：代码、完整发布门禁、隔离 Electron 冒烟及原生恢复通过。2026-10-13–14 实施；Core/UI V9.3.2、App 9.3.2，Memory/Workshop/Action 协议保持。本轮新 CK3、Soak 和远端 CI 尚未验收，不宣称 Full Freeze。

## 已核验

- 受限私有基线：1986 个业务数据文件逐文件哈希校验通过。
- Durable pipeline：5/5；独立 QA：25/25；Action lifecycle：PASS。
- Memory4 core 26 项、Durable generation incident 10 项、Forget、发送前 Forget F-01–F-06、chunking/retry/quota/cost、Year/Life 退役 8 项及恢复 8 项相关回归通过。
- 七 Adapter：39 场景，其余正常 wire 与冻结 baseline 一致，仅明确的 Core/App headers 版本升级。
- Runtime 依赖：5981 文件/264 包校验通过；最终 293 个源码/构建/部署文件哈希一致。
- 最终 payload：`e7cd7a230a9a7971492ce7724f6e7b99e35114654298e8185991993f4262330a`。`node scripts/test-release.js` 连续运行退出码 0，438/438 发布组 PASS；此前分段回归仅作迭代证据，最终通过来自完整连续执行。清单为 510 个分类文件、438 个发布组、71 个历史归档。
- 隔离 VOTC.exe 实际窗口：App 9.3.2、标题 VOTC V9.3.2、页脚 V9.3.2 · Mod v2.0.5；12 个 Inspector-loaded 模块与 source/deployed 哈希一致。两个独立临时 Profile 均通过 Durable 正确/非法候选、checkpoint、人物认知 DIRECT_RELATIONSHIP、单 Store DI、Action 取消/多 Effect、service boundary、摘要改名以及诊断 off/on 检查；Provider/CK3 调用均为 0。
- 规定的七个打包 JS 语法检查及 `git diff --check` 通过。GLM v813 的 101 项 outbound 等价检查通过；本轮未增加 GLM 付费请求。

## 最新审查会话的原生恢复

| 指标 | V9.3.1 事故记录 | V9.3.2 本轮恢复账本 |
| --- | ---: | ---: |
| 人物目标 | 4 | 4 |
| 请求数 | 4 | 28 |
| 原生输入 Token | 213,879 | 149,720 |
| 原生命中 / 未命中 Token | 2,944 / 210,935 | 76,672 / 73,048 |
| 输入缓存命中率 | 1.38% | 51.21% |
| 原生输出 Token | 5,735 | 26,202 |
| 有效 Durable 提交 / 条目 | 0 / 0 | 4 / 32 |

恢复账本包含本轮候选迭代中的失败尝试、有限修正和最终恢复，未隐藏开发期消耗。输入总量降低约 30.0%；按相同官方高峰价计算的费用上界由 USD 0.07018017 降至 USD 0.05381694，约降低 23.3%。它不是同一时段的配对 A/B，也不是未来缓存率保证或整个服务商账户的账单对账。早期请求使用本轮前置候选；最终构建重新核验四份 canonical commit、正文、来源和 Recovery 闭合，无需重新发送已提交会话。

每 Owner 沿用 8 条 Durable 上限。达到上限的记录明确标为 CAPPED 并保存实际评估数量，不能冒充全来源逐段抽取；完整 Legacy/Narrative 仍保留。Provider STOP 与校验后的业务提交分别核验。

## 全部历史恢复与费用

- 修复前共有 136 条 EXTRACTION_FAILED 和 2 条 PENDING，均位于已核验 Campaign；两条 PENDING 另获用户明确授权，仍共用 USD 1。138/138 目标最终均为 COMMITTED/STORE，保存 1,093 条 Durable；uncommitted=0、unverified=0、recoveryRemaining=0。再次扫描整个 Memory4 Recovery 目录为空。
- 130 个目标按既有 8 条额度标记 CAPPED，8 个为完整来源覆盖；未将 CAPPED 宣称为全来源逐段提取。审查主会话 4/4 提交、32 条及其来源分别重新验证。173 次保守时间元数据校正留有计数，108 项未采纳候选验证计数保持可审计。
- 两条尾部实体/结构质量失败通过一次有明确范围的人工维护指导恢复。只有先前 transport 全部已结算、有验证过的成功 checkpoint、已知质量错误且未做过此类指导时可进入；范围在账本写锁内原子占用，不同计划哈希也不能重复。指导不添加事实或扩大授权，仍经过业务校验和输入限额。此维护分支经独立只读复核及离线重复/未知费用/并发占用攻击检查。
- 原生合成 3 次全部 COMPLETE/STOP，共 323 输入、337 输出 Token；合成不计入真实业务入库数或应用使用统计。真实维护 377 次，均已取得原生 usage：输入 1,883,447、命中 942,464、未命中 940,983、输出 310,383；整体输入命中率 50.04%。其中含候选迭代失败、修正和全部历史恢复，不能作为单场正常对话成本。
- 380 个真实 transport 全部已结算，无未知费用或未结束请求。保守费用保护上界 **USD 0.66091260**，低于授权 USD 1。采用[DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/)的 Flash 高峰价上界；请求仍使用原配置的旧 Flash 别名，官方按 Flash 服务和计费。它不是控制台最终账单或整个账户总消费。
- 每次发送前以已结算费用上界 + 未明预留 + 本次最坏预留检查 USD 1；未使用的已知预留在结算后释放。累计历史预留 USD 4.55225973 是各次最坏预留之和，不是收费。初始账本 40 次 Root 自限经追加记录调整为 512 次以覆盖全部恢复，美元额度保持 1；旧账本行未重写。
- 业务数据、凭据、原文、原始日志和私有账本未纳入 Git；发布前改动文件扫描未发现私有运行时文件或凭据模式。续作捕获的 Action queue、pending letters、letter transport 三份状态在恢复期间字节哈希保持，未重放游戏效果。
- 377 次真实维护请求已通过既有 UsageAnalytics writer 记录，最早 28 次补记使用原结算时间。最终维护事件数 377、重复 ID 为 0，输入/命中/未命中/输出总数逐项与原生账本一致；原有分析行均保留。全部写入结束后串行重跑补记返回 added=0、existing=377，合成排除。

匿名汇总见 [原生与入库证据](V9_3_2_NATIVE_EVIDENCE.json)。原始账本、Profile 和受限备份只保留在本机。

## 尚未验收

- 本轮新 CK3 操作/长运行 Soak、最终 Git SHA 的远端 CI。此前 V9.3.1 Action 游戏回读证据仅作审查基线，不冒充 V9.3.2 新实机验收。
- 按用户此前选择保留手动推送，本轮未推送 GitHub。VOTC.exe 复用的壳属性版本未改写，实际 App/UI 与加载资源为 9.3.2。

实施合同见 [实施报告](V9_3_2_IMPLEMENTATION_REPORT.md)。不宣称 Full Freeze；正式版本号升级是用户明确要求。

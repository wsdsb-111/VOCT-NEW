# V9.2.2 Durable 候选验证

2026-10-12。基线 `main / edb389623ba34e8a668779b74509d8f1b2bf78cb`；[方案](V9_2_2_DURABLE_INCIDENT_PLAN.md)、[基线](V9_2_2_BASELINE.md)、[实施与原生实验](V9_2_2_IMPLEMENTATION_REPORT.md)、[台账](V9_2_2_P_ISSUE_LEDGER.md)。正式 App/UI 仍 9.2.0/V9.2。

## 已完成验证

- 修改前完整回归 422 组 PASS；基线 CI Success 独立在线确认，不能代替本候选最终 CI。
- 四个新增专项登记发布清单：lineage、attribution、presend-forget、durable-chunking。旧 Forget/额度/Scope、固定 Policy、GLM v813/native usage、原生用量 reconciliation/retention 检查保留。
- 独立 RED：能力查询等待期间的真实 tombstone 后，基线仍将 A 传至 Provider；追加 RED 发现 typed 拒绝后旧快照覆盖新的 revision。GREEN：F01–F06、新 revision 保留且一次请求恢复、坏 recovery JSON 不覆盖、七种非流式实际发送 adapter 的内部退避重试校验；无真实 API/CK3。
- 129=128+1、完整七节点二分树、所有父子 Token 计入、单片段有界失败、累计八条承诺及 superseded 索引、0/UNKNOWN、诊断关闭/上限/失败不影响业务，通过。
- 用事故实际 14 条历史 Usage 作为同一内存只读输入，对照备份版与新 Analytics：`total`、`byRequest` 逐数字完全相同；14 条旧记录均明确不可严格归因，未重写历史文件。
- 原生 DeepSeek 合成 28 次 parsed OK，全部尝试有记录；费用上界 1.00864056 元。暖相同来源 91.0627%，长首次冷请求 0。范围／日期／内容／额度变化与总量分别报告。Commitment 原生证据合法率、受控原生截断和 TTL 未验证，性能收益 HOLD。
- 最终源码构建／部署一致性 PASS：287 映射，runtime payload `969d94d2c5c9c471ffa99960f0b02850086af5e69ea206679c9e191a5b7d7895`，deployment receipt COMPLETED。依赖锁 5981 文件／264 包 PASS。

## 最终本地收口

最终部署代码完整发布回归 **426 组 PASS**；测试清单 **495 文件已分类／68 历史检查归档**。隔离实际 VOTC.exe 的诊断关闭／开启、Renderer/Preload/IPC、Memory4 拒绝边界、改名目录和日期顺序均 PASS，真实导出包含 durableTrace 安全包，截图已目视核验。语法检查、依赖锁、源码／部署哈希和 git diff --check 均通过。3791 个用户业务／配置文件、612412864 字节与私有备份完全相同，changed=0、new=0。脱敏校验清单见 [机器证据](v9.2.2-verification-evidence.json)。

中间候选回归因补齐 Provider／恢复边界而中止，不计为最终通过。一轮并行打包窗口触发了必须关闭 VOTC 的构建门禁；窗口退出后串行完整重跑通过。一次 GLM 临时夹具与清理冲突的失败已独立重跑 12/12 PASS，最终完整回归再次通过。既有 V9.2 QA 的四项原生符号链接验证受主机权限限制，为 NATIVE_UNVERIFIED，四项对应模拟拒绝通过；不将模拟结果写成原生验收。

最终候选尚未提交／推送，无法宣称最终 SHA CI；本轮 CK3 多人会话、换存档、真实 Forget、Provider/ACK 和长期 Soak 仍待用户实机验收。原先的用户验收保持，不借用为本轮新结果。

## Gate 边界

| Gate | 当前证据 |
| --- | --- |
| G0 | PASS：退出、受限备份逐字节、基线回归与 CI、事故窗口一致。 |
| G1 | 自动化 PASS；今后默认关闭可控 trace 完整性可见；历史 14 条 origin/parent/finish 缺失仍 UNKNOWN。 |
| G2 | PASS：范围链、原生汇总一致、三层报告及 UNKNOWN。 |
| G3 | 诊断／有界树 PASS；保留分块，未实施未经直接证据及质量对照支持的 Token 软阈值。 |
| G4 | 自动化发送安全 PASS；真实 CK3 操作窗口待复验。 |
| G5-CACHE | HOLD：有限重复复用已解释，广泛性能改善、完整应用工作量与质量不能签发。 |
| G6 | 本地构建／部署／426 组回归／隔离窗口 PASS；最终 CI/CK3/Soak 待验。 |

本候选未签发正式 V9.2.2、Full Freeze 或自动进入 V9.3。

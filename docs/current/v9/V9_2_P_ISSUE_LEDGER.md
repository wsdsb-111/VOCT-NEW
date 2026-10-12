# V9.2 P 级问题台账

日期：2026-10-11。V9.2 开工时承接 V9.1 Review 明确提出的三项问题，并另列实施中发现的两个 P0 和一个 P2。该表只统计这些六项，不表示对其他历史问题做了穷举审查。

| ID | 级别 | 问题与风险性质 | 当前状态 | 关闭证据 |
| --- | --- | --- | --- | --- |
| `REV91-P1-01` | P1 | 多文件 Runtime 部署遭断电或强杀可留下混合版本；这是已知的多文件部署设计边界，不是已报告的数据损坏。 | 已本地验证关闭 | deployed 286 payload 校验与 21 项独立 QA 通过；断点识别/恢复和拒绝路径已有隔离证据。远端 CI 仍属 G7，不由此行关闭。 |
| `REV91-P2-01` | P2 | `build-runtime.js` 的可配置输出路径需保护仓库源码、脚本、文档、资源和链接别名，防止误写。属防御加固，不是已证实的覆盖事故。 | 已本地验证关闭 | 正式 CLI 输出保护夹具及独立 QA 通过；deployed 286 payload 与 manifest 一致。 |
| `REV91-P2-02` | P2 | V9.1 验证报告中远端 CI 状态过期。 | 已核验关闭（V9.1 基线） | 当前确认 Release Regression run `38117263132` 对应 head `f9c088f` 为 Success。此证据只更新 V9.1 基线，不代表 V9.2 CI 通过。 |
| `NEW92-P0-01` | P0 | Memory4 候选 frame 生成与正文读取之间发生 Forget/修订时的 TOCTOU 竞态，可能让已撤销或已过期候选继续进入正文读取。 | 已本地验证关闭 | 33 个 query axis/oracle cases 与 418 groups 通过；候选 frame 的 Scope/revision/hash 变化及 Forget 后读取均 fail-closed。 |
| `NEW92-P0-02` | P0 | root、index、metadata、known entity、悬空链接与 version 1 mutation journal 路径/内容验证可能允许路径逃逸或不安全恢复。 | 已本地验证关闭（保留原生权限限制记录） | 五个 crash checkpoints 真实退出、恢复后旧树逐字节一致且二次恢复幂等；21 项 QA 通过，实际 root/journal junction PASS。4 项 native link cases 因权限限制为 NATIVE_UNVERIFIED，注入 lstat 仅验证生产 validator 且未执行外部 I/O，不伪称原生链接验证通过。 |
| `NEW92-P2-01` | P2 | Restore preflight 完成后、目标实际使用前，未知目标状态可能变化，形成 preflight-to-use race 并绕过原有路径判断。 | 已本地验证关闭 | guard 修复后两个 child-process fixtures 通过，包含在 21 PASS/418 groups 本地证据中。 |

`P0=2`、`P1=1`、`P2=3`，合计 6 项；六项均有 418 groups 与 21 项独立 QA 为基础的本地关闭证据。此状态不等于 V9.2 formal complete：G7 远端 CI 与 G8 实机仍待完成，最终 286 映射／418 groups 已重跑通过，用户新增目录合并也已通过专项与隔离打包冒烟；远端与真实游戏证据仍不由这些本地结果替代。

每项具体范围来自原 V9.2 施工规格的 V9.1 Review 收口表和本轮新增问题。证据边界、命令和结果见 [V9.2 实施与验证报告](V9_2_VERIFICATION_REPORT.md)；V9.1 原始架构约束见 [V9.1 架构移交](V9_1_ARCHITECTURE_HANDOFF.md)。

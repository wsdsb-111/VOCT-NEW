# V9.3.3 验证报告

日期：2026-10-14（Asia/Shanghai）。基线：`d397f102d4222386e7f5424a340ac6a8cd444f25`。本报告按实际证据更新，本地候选验证已完成；实际清理授权与外部人工 Gate 独立保留。

| 检查 | 状态 | 当前证据 |
|---|---|---|
| 基线工作区 / main SHA | PASS | 首次读取干净，无基线漂移 |
| 基线部署一致性 | PASS | 293 source/artifact hashes，deployed parity |
| 基线完整回归重新执行 | 初轮 BLOCKED | 当时 VOTC 有 4 个进程；随后应用退出，新版独立执行完整门禁；历史 438/438 不作为本版结果 |
| 本地规划 Golden | PASS | 43 小例 + 10 个 100–280 片段长会话；输入候选高价值召回 100%，标注寒暄误入高优先级 0% |
| 时间区间候选对照 | PASS | 每个长例早/中/晚三个重要来源：旧前 8 候选含 1 个，新含 3 个；不是模型提交质量结论 |
| 规划性能 | PASS（局部） | 10000 来源冷/暖约 14–18 ms；不代表完整实机流水线性能 |
| 来源谓词冻结 | PASS | 15/15，含 Owner/Campaign/Forget/revision/Legacy hash；旧缺 revision 兼容行为不冒充新 Coverage proof |
| V9.3.2 Durable pipeline | PASS | 5/5，合成隔离目录，实际原子 writer |
| V9.3.2 独立安全合同 | PASS | 25/25，分块、32 次限额、恢复、Forget、承诺与严格候选验证 |
| V9.3.3 Coverage/UI 专项 | PASS | 聚合、分页、未知、只读、四页签、谱系攻击；过大/重复 entryIds 在读正文前拒绝 |
| V9.3.3 独立 QA | PASS（当前源码） | 7/7，含同 projection ID 不同来源攻击、失败回滚保锁、失败恢复保留及逐字节恢复；最终全量门禁仍独立待执行 |
| V9.2.3 恢复兼容 | PASS | 8/8，旧 DERIVED_REBUILD_FAILED 只凭 canonical proof 清理，未知/损坏/跨 Campaign 保留 |
| 派生迁移 dry-run | PASS | 31 Owner / 31 Campaign；28 year + 11 life，315006 bytes，manual 0，metadata 29；用户数据零修改 |
| 实际派生文件清理 | NOT APPLIED | 应用已退出，具体范围显式确认仍未收到；没有删除历史文件 |
| 新版 candidate build | PASS | 296 文件、App 9.3.3；payload 79c12cca1869f171caa69d3180bcae6b6dda69d6d65bd6cfb4c1bf45920ebc29 |
| 新版 deploy/hash parity | PASS | 296 source/artifact/deployed hashes；仅本地候选，无远端推送 |
| 新版完整 release gate | PASS | 441/441；清单 515 文件、73 历史归档；正式从头到尾日志 .build/v933-release-final.log |
| 打包 Electron / 三主题 / 两档 Profile | PASS（最终 payload） | 实际 VOTC.exe、16 模块哈希、真实 Preload/IPC；性能开/关均通过；四页签/CAPPED/UNKNOWN 合成 UI、1000 条数据每页仅渲染 40 条、翻页及三主题截图检查；Provider/CK3 外部调用 0 |
| 原生 Provider 合成质量 | PASS（候选范围） | 4 场、7 transports；纯寒暄 0 条，早/中/晚事件 3 条、动作中事件 2 条、条件承诺 2 条；7 条合法来源全部核验，未知日期不捏造；不是新版 CK3 实机 |
| 基线远端 CI | UNVERIFIED | 连接器只返回 PR-triggered runs，无结果；公开 REST 受限流影响，没有确认 d397f10 Actions |
| 最终 SHA 远端 CI | NOT TESTED | 用户保留手动推送偏好，不自动推送 |
| 新版 CK3 / Soak | NOT TESTED | 需真实游戏回读、长会话与旧存档验收 |

Provider 费用采用 [DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/) 已核对的 Flash 高峰上界：每百万输入未命中 USD 0.30、命中 USD 0.006、输出 USD 1.20。每次真实 transport 前按保守输入字节和输出硬限同步预留；未知账单不释放预算。V9.3.2 原账本不计入新授权也不被改写。

本轮真实合成账本独立，7 次全部 SETTLED_USAGE、没有未知送达或未结算请求。输入 27540（命中 6144、未命中 21396），输出 762；费用保护上界 USD 0.00737012。实际请求输入 2535–4848 Token，保守估算 4048–7140，所有样本实际输入均低于估算。完整 280 个授权来源均被有效模型评估；本轮没有 CAPPED 的真实样本，CAPPED/UI/旧版本兼容由离线夹具核验。匿名原生证据见 [V9_3_3_NATIVE_EVIDENCE.json](V9_3_3_NATIVE_EVIDENCE.json)。

自动化、实际数据迁移、原生 Provider、Electron、CK3、远端 CI 和 Soak 独立记录；无实机与 Soak 证明前不宣布 Full Freeze。

真实用户数据盘点与部署后哈希：2989 文件全部字节相同，28 Year + 11 Life 未删除。迁移只读预检 appClosed/journalRoot/privateACL 通过。Windows junction 实际拒绝通过；旧 QA 的 4 个文件 symlink 夹具因主机权限无法创建，只有 4/4 模拟拒绝，保留 NATIVE_UNVERIFIED 标记。

原生测试使用中间构建 e77469edf4053b65018c3ef5ec0cb8854f35aa5f4de；最终候选另有 Recall/UI/迁移与 Legacy 恢复修正，未把中间原生证据冒充最终 SHA 或 CK3 实机证据。

完整门禁为一次正常 `node scripts/test-release.js` 从头到尾成功，不用专项拼接冒充。旧预检失败及修正记录保留在忽略日志；退役混合案例的安全断言全部继续执行。`runtime-dependencies.js` 5981 文件 / 264 包、三主题样式合同、Official Action parity、要求的七项 `node --check` 和 `git diff --check` 均通过。

本地提交包括 120 个代码、生成资源、测试及文档路径（含删除的派生服务文件），不包含 .build 账本、用户文件指纹、原生临时资料或截图。提交后 SHA 记录在本地回执与交付消息，不自动推送。当前历史清理状态 NOT APPLIED。

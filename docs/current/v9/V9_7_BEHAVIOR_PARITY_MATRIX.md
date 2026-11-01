# V9.7 行为等价矩阵

本轮基线 3721b925；Runtime 映射冻结 353 项。除 6 个明列文件（5 个版本标签文件与 provider-result）外，其余 347 项源码 SHA-256 必须与基线一致；不更改检索、动作、关系、数据或协议合同。下面是覆盖关系，实际结果只由 [验证报告](V9_7_VERIFICATION.md) 签署。

| 合同 | 既有发布验证 / 本轮补充 | 判定级别 |
| --- | --- | --- |
| 最终 Prompt / Role / prefix / 冻结与动态顺序 | v9.4-legacy-layout-golden、conversation-plan-main-chain、provider-effective-request、plan-schema、knowledge-forget；新增 v9.7-prompt-plan-parity 的 environment 与 description/examples/custom fallback | 字节/消息/来源及预算证据；不是服务商命中率 |
| 七 Provider / 旧 facade / finish / usage / stream | v9.3-adapter-conformance（39 frozen wire 场景、7 adapters）、result-usage、cancellation-retry、independent-qa、v9.2.3 GLM outbound；新增 v9.7-provider-compat | wire Golden 与严格结果/缺字段 UNKNOWN；D01 567 输入+7 组异常/副作用工厂等价 |
| 配置 / 自定义 Prompt / IPC | 现有 prompt/Provider 配置和 UI 回归；v9.7-reference-audit 的 184 路由/174 handler 固定及 missing-handler 负例 | 配置模块字节未变；IPC 采样/文本审计，不声称完整 handler E2E |
| 旧 Legacy / 手改 / Forget / Pair | v9.3.4-legacy-forget、legacy-retirement、independent-qa、v9.3.5-pair-ledger；新增 v9.7-legacy-data-readonly | 原文读回、owner/官方路由/撤销排除、readOnly 不落盘、重建 Store 后 10 个文件哈希不变 |
| Canon 同日确认/重启/4096/余量 | v9.6.1-world-memory-restart-budget、terra-boundary-qa | 合成 checkpoint/Campaign/branch；真实用户档不读写 |
| 五代家谱/双向关系/Presence/手动隐藏/陌生人 | v9.6.1-relationship-recognition-regression、family-visibility-independent-qa、relation-prompt-independent-qa、identity projection 与现行 Presence 检查 | 原来源/权限反例不减；没有授权扩大秘密与旧记忆 |
| Action/RunFile/Letter/恢复 | v7.10-official-action-system、rc6-rev3-run-command-recovery、v8.15.2-letter-receipt-startup-recovery、v8.14.2-letter-memory-finalization、v7.6.1-recovery-race | 原有确定性门禁、exactly-once/ACK/未知效果不重发；复用完整发布组，不复制故障框架 |
| Bridge / 独立 Mod / 安装包 | verify-ck3-mod-source、build-ck3-mod-source、既有 Bridge tests；CI materialize/verify --deployed、v9.4-windows-packaged-smoke | 隔离源码/产物/EXE；Workshop 与第三方兼容 Mod 无源码改动 |

新增 4 个 release checks；原 519 发布组和 127 归档项均不移除/降级，最终 523 发布组。651 个 test 文件分类由清单实际输出核对，不把上述摘要替代完整门禁。

Phase 3 不进行其它迁移：外部消费者未知的 strict:false、temporal 导出及 family/Legacy helper 全部保留。数据迁移不是本版行为差异。仅允许版本文案 9.6.1→9.7.0、路线当前覆盖说明和 D01 的无结果差异分支删除。

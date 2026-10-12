# V9.2.2 问题台账

| 问题 | 结果／剩余证据 |
| --- | --- |
| P0：能力查询等待期间 Forget，旧 Prompt 仍外发 | RED→GREEN；最后同步边界及 DeepSeek 非流式重试逐次校验；真实 CK3 手工操作场景仍需本轮用户复验。 |
| P0：typed 来源失效后旧恢复快照覆盖新 revision | 独立 RED→GREEN；旧请求拒绝后不回写旧来源，新 revision 可一次授权恢复，坏 JSON 保留且不发送。 |
| P1：Durable 无 responder 导致跨 Owner 本地首次差异串线 | 五哈希比较链、无关联历史 UNKNOWN 语义、A/B/A fixture PASS；原生汇总无变化。 |
| P1：14 次事故缺少 Attempt 来源／重试成本树 | 12 次准确 User 指纹匹配，2 次未追溯；origin/parent/finish UNKNOWN 保留。新的受控 recorder 补齐今后证据，不能补造历史。 |
| P1：长冷输入及截断后二分可能增加成本 | 98→49+49 强推断；真实快照有活跃承诺，禁止跳过剩余来源。保留分块，Token 软阈值 HOLD，需直接 lineage 与质量对照。 |
| P1：`memory4_invalid_event_status` | 保留日志确认两次，恢复库存有同类失败；不放宽 enum/schema，未重放真实来源或清除队列。合成原生 28 次均严格 parsed OK，真实模型输出失败率仍待追踪。 |
| P1：Durable 原生收益 | 暖相同来源 91.06%，首次长冷输入 0，固定 Policy 额度变化对照有效；样本量与真实 workload 不能签发广泛提升，G5 HOLD。 |
| P2：最终提交 CI／CK3／Soak | 基线 edb3896 CI Success 已确认；本地候选未提交／推送，最终 SHA CI 及本轮真实 CK3/Soak 待验。 |

正式 App/UI 9.2.0/V9.2；不自动进入 V9.3，不签发 Full Freeze。

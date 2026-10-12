# V9.2.1 缓存专项问题台账

日期：2026-10-12。以 [验证报告](V9_2_1_VERIFICATION_REPORT.md) 与原生 [脱敏实验](v9.2.1-cache-ab-evidence.json) 为证据；本地关闭不等于缓存效果或正式发布通过。

| ID | 级别 | 问题 | 结果及剩余 Gate |
| --- | --- | --- | --- |
| CACHE-921-P1-01 | P1 | GLM 历史 36% 与真实稳定前缀/原生零之间的差距 | **HOLD**。当前 v813 未复现静态规则抖动；96 次合成请求 A/B 同 NPC warm 均 96.07%，无改善。历史模型/会话/输入规模不同，62 个原生零异常原因仍未知。 |
| CACHE-921-P1-02 | P1 | Durable 动态额度污染长 System 前缀 | **工程修复 PASS / 效果 HOLD**。跨额度固定 hash、动态 limits 与原条款逐字保留；旧 A 组第 2 个实际响应被严格解析拒绝，未完成原生对照。 |
| CACHE-921-P2-01 | P2 | 本地断点估算被过度解释为厂商未命中原因 | **本地关闭**。只读报告分离 native / estimated / UNKNOWN / history / experiment，全样本和安排的 warm 组独立。旧统计不回写，原面板未重构。 |
| NEW921-P0-01 | P0 | Provider 等待期间 Forget 后，截断二分重试或下一 outer chunk 重发已忘正文 | **本地关闭**。真实 tombstone 红测证实 Provider payload 泄漏；每次请求前刷新并取有效片段交集，8/8 独立 QA 通过；响应后及提交前门禁保持。 |
| NEW921-P2-01 | P2 | 不同 endpoint 的原生零误标同端点大前缀异常 | **本地关闭**。sameEndpoint=false 时分类为 insufficient，原生零未改；正负例通过。 |
| NEW921-P2-02 | P2 | GLM profile 标签与实际布局容易混淆 | **本地关闭**。状态 additive 返回 layoutId=v813，原 profile 和生产路径保持；G-01 实际出站断言通过。 |

未确认的 `clear_thinking` 指纹遗漏已撤回：真实字段在 `thinking` 内，已有 canonical 指纹覆盖；不是新增缺陷。用户数据未用于真实 Provider 测试。真实 CK3、最终 SHA CI、全面 RP 质量及 Soak 继续独立验收；WP-04/G4 没有用静态绿灯替代。

最终本地 422/422、286 deployed parity、隔离打包诊断 off/on 通过；3,758 个真实用户文件无新增或变化。安全和诊断项以本地证据关闭，两个缓存收益 P1 继续 HOLD，不能用门禁组数将其写为 DONE。

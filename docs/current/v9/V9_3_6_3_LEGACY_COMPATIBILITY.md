# V9.3.6.3 旧摘要兼容说明

本版让可证明归属的旧记录参与V9.3.6.2保守候选检索，不要求先重写或迁移历史摘要。已知Pair缺少pairLedgerSources、rawSummary、digest或签名时，将对应Pair局部纳入权威复验；元数据本身不会授予可见性，也不会使过去不能解析/没有权限的记录自动成为可召回事项。

| 来源情况 | 候选处理 | 最终权威 |
|---|---|---|
| 完整且可信 | Direct及唯一别名命中 | 原PairLedger/Source |
| 缺失元数据、归属Pair可靠 | 全部对应Pair，SCOPED_DEGRADED | 原PairLedger/Source，必要时拒绝 |
| 全域归属未知 | 全量reference或安全拒绝 | 原权限，不伪装INDEX_MISS |
| 内容、身份、Forget或范围竞争 | 整轮STALE | 不注入缓存结果 |

不从摘要正文或人物名字猜授权；多Pair合并投影仍逐Pair独立。所有Pair均不确定时允许全量，诊断应显示不确定数量。Legacy正常摘要、按时间召回与场外唯一人名继续受当前历史分句、身份及来源修订检查。

非标准旧JSON纳入现有Owner来源快照，原地同stat内容变化也会使整轮失效；这不会使非标准文件直接成为PairLedger可打开的标准源。原始字节、存储2.5、协议3.0及旧Sidecar保持，不执行迁移或自动回填。

详细C01–C18和A/B证据见[验证报告](V9_3_6_3_VERIFICATION_REPORT.md)与[性能报告](V9_3_6_3_PAIR_PERFORMANCE_AB.md)，以各报告实际状态为准。GLM上下文兼容配置沿用[V9.3.6.2说明](V9_3_6_2_CONTEXT_COMPATIBILITY.md)，本版不调整扩窗或记忆预算。

补充C19：旧目录中合法life.json对象等非数组JSON被一致计算内容digest，但不会作为摘要或事项来源；它们同stat内容变化也整轮拒绝。JSON语法损坏继续fail-closed。23/23独立检查及匿名计数见[验证报告](V9_3_6_3_VERIFICATION_REPORT.md)。

发送前同样核对可信Owner快照修订与实际JSON内容，覆盖非标准旧文件作为Recent1的情况；在首次修订检查之后发生的改写会被拒绝，刷新后恢复正常。完整性读取不增加第三人PairLedger访问或模型请求，不更改源文件。

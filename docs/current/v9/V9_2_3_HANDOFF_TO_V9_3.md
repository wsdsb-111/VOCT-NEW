# V9.2.3 后续移交边界

候选沿用 V9.2 Application Boundary 与既有 JSON Repository。Year/Life 自动模型生成已退役；Detail、Legacy、Commitment、Forget、Source Revision 与历史手改仍是兼容合同，不能以新概览替代。

V9.3 Provider Platform 未在本轮展开。未来需统一 capabilities、普通／流式生成、Structured Output、Result/Usage/Reasoning/FinishReason、取消／超时及错误语义，独立实施和验证。

V9.4 PromptPlan/Cache 保留 GLM 長局前缀、供应商驻留／路由、真实原生 token 与本地前缀估算的展示分离、跨角色／日期基准。当前未证明 app regression，v813 与参数保留；GLM HOLD 不能被后续版本文案自动关闭。

若未来重新提供低成本生平摘要，须新的明确需求、显式授权、次数／费用硬预算及事实／来源校验，不能自动恢复旧 Year/Life 按年重建。新宏观概览缺失是本次接受的取舍，5／10 年原始事实召回仍要按 CK3 实机 Gate 验证。

后续开发应先阅读 [基线](V9_2_3_BASELINE.md)、[实施](V9_2_3_IMPLEMENTATION_REPORT.md)、[验证](V9_2_3_VERIFICATION_REPORT.md)、[台账](V9_2_3_P_ISSUE_LEDGER.md) 与匿名 JSON；私有备份、凭据、正文、日志和真实存档不得进入 Git。没有人工 Gate 不升级正式版本，不自动进入下一阶段。

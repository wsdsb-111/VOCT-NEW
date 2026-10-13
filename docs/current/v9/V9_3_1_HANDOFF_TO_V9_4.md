# V9.3.1 向 V9.4 的移交

本轮只收口Gemini原生Usage和Action诊断，[验证](V9_3_1_VERIFICATION_REPORT.md)与[台账](V9_3_1_P_ISSUE_LEDGER.md)明确候选范围；V9.4尚未实施。正式Core/UI V9.2、App9.2.0保持，未完成最终CI与CK3／Soak前不签FULL_FREEZE。

保留Year/Life全部自动生成退役、SKIPPED_DERIVED_POLICY、合法旧档查看和手改，以及Durable／Detail／Legacy／Commitment／Forget／来源／Owner×Campaign。不能以新PromptPlan或统计调查重新生成派生记忆。

GLM缓存继续HOLD。V9.4从可比负载和实际服务商cached字段取证，区分原生0、未报告、非法与本地估算；保留v813、推理强度和clear_thinking，缓存anchor／Prompt block ID变更另按兼容合同。旧非受控窗口不能冒充新收益或成本KPI。

Gemini原生候选、思考、缓存、工具提示和total分别保存；数字对账不等于收费桶或确认账单。流尾帧按已报告字段合并，不求和、不用缺失字段覆盖已知值。Tool-use或total差额不能推成思考；真实端点验证须新授权和准确价格／请求硬预算。V9.3 USD1许可不继承，本轮新API请求0。

Action接受不等于已执行。writeEffect异常可能已触碰载体，无有效信封不能断言明确未发送，更不能重放；已有信封、journal、pending和ACK证据必须保留。CK3效果仍需同命令权威回读；原Writer和桥接权威不更改。

回滚先完全退出应用：Gemini Adapter／Normalizer／受限消费投影作为一个单元还原；Action诊断作为独立单元还原。通过原build→verify→deploy→verify --deployed核验资源，基线586份逐字节代码备份在忽略的.build。不得覆盖用户新增业务数据，或清理Pending／Journal／ACK／Forget。

手动验收：当前主力模型一场三人CK3对话，核验安全Action与Letter回读、最终摘要／Durable保存和历史召回、取消及重开、Year/Life零新增；再记录Soak。用户自行推送后检查最终SHA CI，Gemini真实服务端单独标NOT_VERIFIED，不能把Mock写成NATIVE_PASS。

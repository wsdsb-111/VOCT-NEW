# V9.3 候选向 V9.4 的移交边界

V9.3已实现Provider平台合同并部署候选，源码输入摘要 `60ecceb1d406a83ba67ea7a23a67bfb1c8d682a3f9c889f2555dd35f70322d31`。正式Core/UI V9.2、App9.2.0保留。V9.4未开工；本轮完整结果以[验证报告](V9_3_VERIFICATION_REPORT.md)为准，最终SHA CI、CK3和Soak尚未签署，不能称Full Freeze。

后续必须保留三态能力、严格完成、原生与估算分层、usage-only尾块、单次记账、取消与有界重试。每个真实transport前再次核验固定配置、来源与Forget；网络未知送达和部分输出不能重放。Action/Letter的ACK、Effect回读及恢复权威不迁入Provider层。

Year/Life自动生成及后台重建继续固定SKIPPED_DERIVED_POLICY；合法历史可查看和手改，Durable、Detail/Legacy、Commitment、Forget与来源证明保持。不得通过新PromptPlan恢复旧派生请求。

GLM缓存问题继续HOLD。31次Chat、原生加权43.1%的旧实机窗口是非受控历史证据，不能作为V9.3或V9.4收益验收。V9.4应先冻结同类负载和原生字段，区分服务商0、未报告、非法值与本地前缀估算；对照实例、model、route、日期／角色变化及等待时长。未证明应用缺陷前保留v813及GLM参数，禁止为了命中率伪造缓存数据。每次改Prompt block ID或anchor均按兼容变更同步版本和文档。

真实端点范围见[支持矩阵](V9_3_PROVIDER_MATRIX.md)：Player2/Ollama/Gemini本轮仅Mock；DeepSeek8次原生完成，OpenRouter1次响应及修复后离线回放；GLM和自定义兼容端点因计费UNKNOWN未生成。USD1是本轮授权，不能继承为后续付费许可；未知费用保留预留，不自动续发。

回滚只在应用完全关闭后恢复经校验的源码与生成资源，使用既有build/verify/deploy流程及部署回执；基线e1c3c37和本轮私有逐字节备份保留。不得覆盖后来新增的业务数据、删除pending/ACK/journal或重放未知Action/Letter；恢复后Year/Life仍停用。任何来源错配、Forget内容出站、自动派生复活或Effect重放都应停止新发送并保存证据。

文档与本地提交由用户自行推送。完成最终SHA CI、三人CK3对话、最终摘要保存、Action/Letter回读及取消重开、Soak后再评估正式版本升级。V9.5 UI及V9.6 Bridge仍是独立阶段；既有Action失败记录的dispatched投影问题保留在[台账](V9_3_P_ISSUE_LEDGER.md)，本轮未改动作生命周期。

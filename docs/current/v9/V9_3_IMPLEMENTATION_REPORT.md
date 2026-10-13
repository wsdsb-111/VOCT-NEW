# V9.3 Provider Platform 候选实施报告

本轮按[施工方案](V9_3_IMPLEMENTATION_SPEC.md)与[V9旧总路线](V9_ROADMAP.md)的Provider阶段实施。基线、受限备份、原始RED和请求冻结见[基线](V9_3_BASELINE.md)与[Provider审计](V9_3_PROVIDER_AUDIT.md)。正式Core/UI保持V9.2、App9.2.0，其他协议与Mod版本保留；当前是V9.3候选，不签Full Freeze。

## 已实现的边界

`LLMManager`的Chat、Action、Summary统一经过`ProviderPlatformFacade`，保留既有返回字段并增加`votc_result`。配置按请求复制并固定，真正发送前复核实例／模型／端点／协议参数及凭据是否变化；旧Summary快照仍兼容，新快照携带匿名cacheKey。能力缓存保留5分钟，键覆盖实例、端点、模型、route和协议／能力revision。

Capabilities分别表达三态与证据来源。仓库支持某种传输路径，不代表未验证端点支持对应功能；缺证据保留UNKNOWN。已有显式协议可受控尝试并走原本的本地严格校验，明确UNSUPPORTED在传输前阻止。Ollama原Native映射没有新增`format`，Gemini仍只发送旧Schema子集，均不宣传完整Native Schema已验证。

统一结果区分COMPLETE、TRUNCATED、FILTERED、REFUSED、TOOL_CALLS、CANCELLED、ERROR、PARTIAL和UNKNOWN。只有明确STOP的COMPLETE可进入严格业务。Action在JSON修复／Schema校验／Effect之前验证完成；Durable、Summary手动重写及离场摘要也不能把裸正文冒充完成。Chat续写、ACK、RunFile、Letter恢复权威和Year/Life固定退役保持。

Usage保留旧flat字段，另提供原生、估算和provenance。缓存0、正值、未报告与不一致分开；无原生用量时估算不能升级为原生。GLM旧flat reasoning=0仍兼容，但原始字段缺失时canonical native reasoning=null。usage-only尾块作为无正文事件传出，正常结束、异常或提前退出仅记一次；断线前已收到的原生用量保留。复用UsageAnalytics现有writer，不引入第二份业务存储。

Reasoning仅传presence与数字；Provider层不记录完整请求、配置、错误正文或推理明文。错误只保留类别、已知公开code、HTTP状态、Retry-After与尝试信息；Memory4来源变更哨兵保持原对象及语义。诊断关闭不改变正常请求字节。

取消与调用方显式deadline贯穿目录查询、退避、SDK／fetch及流读取。没有新增任意默认生产总超时。所有SDK设置maxRetries=0；显式生成策略最多2次，仅429或502/503/504且未输出时可再试。网络未知送达、500及部分流不透明重发；Retry-After超过30秒直接交回失败，不提前重试。目录缓存缺失时最多1次取消可控GET，不占生成预算；目录失败允许UNKNOWN及既有保守Token预算，用户取消不会fallback后继续请求。

每次真实生成发送前运行来源／Forget钩子和同步预算预留。取消未读取的流也关闭上游并记账；挂起读取与不配合关闭的模拟Iterator不阻塞取消。Durable重试、分块、二分与来源回查的原权限合同保留。完整但语义越界的合成响应仍进入原来源拒绝测试。

## 验证与交付

新增6个Provider模块并登记构建映射（287→293）；新增5个发布组，旧成功mock只补明确完成证据，错误／截断／权限反例不放宽。冻结GLM旧两版签名`56a9c120bc9b334e2eadec8a75297abf3c97c55ffc1ee2fbc6f27bfb4473d747`保留；新candidate另外验证缺finish为UNKNOWN、usage-only独立事件及SDK重试关闭。

39个真实SDK序列化/fetch匿名Golden场景保持正常Body、路径和参数。独立QA18组覆盖来源竞态、严格Action、原生0/未知、尾块后断流、冲突finish、metadata与付费尝试分离、pending reader取消及ACK／gold既有合同。模型目录、真实收费与实机支持的证据不能互相替代。

本轮付费上限总计USD1。Player2/Ollama/Gemini按用户要求仅模拟；DeepSeek/OpenRouter的现有模型按官方费率、每case最多2次、总16次硬限规划，最坏合成Token预留含10%余量约USD0.119849。GLM及自定义兼容端点精确费率未验证时不发送。联网探针只检验Provider路由／完成／用量，不进行实际Effect或真实记忆提取；最终记录见[验证报告](V9_3_VERIFICATION_REPORT.md)。

## 保留与移交

实际本地提交边界为C0基线／审计／冻结、C1共享Provider合同及七Adapter集成、后续文档收口。与方案逐Adapter独立提交的要求有差异：本轮共享Facade、严格完成和流生命周期在同一代码提交内闭合，不能宣称已交付七个独立Adapter回滚点。没有合并UI或Prompt重构；回滚必须按整个候选运行时及既有数据合同执行，不能只还原某个Adapter而留下新消费者。

七Provider当前范围见[支持矩阵](V9_3_PROVIDER_MATRIX.md)，缓存及安全边界见[V9.4移交](V9_3_HANDOFF_TO_V9_4.md)。

GLM43.1%历史窗口及长局零命中继续HOLD，V9.4处理可比缓存实验；本轮不宣传命中率、TTFT或费用改善百分比。V9.5 UI及V9.6 CK3 Bridge不提前实施。新CK3三人对话、最终摘要、Action/Letter、取消重开与Soak需要本轮独立人工Gate；旧验收不撤销，当前候选CI不能借用e1c3c37结果。

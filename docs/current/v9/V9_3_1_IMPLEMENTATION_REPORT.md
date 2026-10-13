# V9.3.1 Provider Usage 与 Action 诊断修复实施

基于 `6e232091edb109ccc1e34d26c4b9a120b8a199ba`，按[施工方案](V9_3_1_IMPLEMENTATION_SPEC.md)实施两项定向修复。C0 `8219da2`冻结基线与三组RED；Gemini和Action分别形成独立代码提交，最后已观察分量下界校验另作C1补记。正式Core/UI V9.2、App9.2.0及现有协议不改，没有新Provider请求、存档或业务数据迁移。

Gemini Adapter的流／非流共用纯数值白名单投影：只保留prompt、candidates、thoughts、cached、total和tool-use六项有效非负安全整数；无效值只留下字段名标记，不存恶意字符串、未知对象或推理正文。缺失、null、undefined保持未报告，显式0保持原生零。

Normalizer保持旧native/estimated/provenance结构和completion_tokens=candidates的历史含义。Gemini可见输出直接取候选数；原生total保留不改写，按官方prompt＋thoughts＋candidates数值对账，缺thoughts不补零，未知差额记UNRECONCILED，低于已知分量或非法字段记不一致；即使输入／候选／思考只有一项报告，也检查其能证明的下界，未知项仍为null。toolUsePromptTokens单列，不加进total，不猜思考或费用；RECONCILED只说明这三项数字相等，不表示账单闭合。其他Provider的input＋output＝total门禁保留。

Gemini流内按报告字段合并部分usage-only尾帧；空尾帧不擦除已知数字，重复帧不求和。EOF、断流、Abort和冲突finish仍走V9.3终态语义和单次记账。UsageAnalytics继续唯一既有writer，ProviderDiagnostics只增加Gemini的受限canonicalUsage；字段来源、工具计数、对账枚举、推导与非法字段均按白名单持久化，未扩大正常诊断捕获范围。

Action写入尝试与本地接受分开；有效非空字符串commandId及queued／awaiting_ack才算接受，queued仍非物理dispatched，awaiting_ack仍不等于游戏确认。失败继续DISPATCH_FAILED／success=false；无有效信封不造commandId，不重放未知写入，dryRun零Effect。已有接受证据不会因后续异常丢失，结算时专用诊断DTO保留两项可选布尔事实，缺失字段的旧DTO保持原形状，非布尔值不转换为true。确认权威仍由原RunFile／ACK／CK3回读模块负责。

受影响源码限于providers/index.js、providers/usage-normalization.js、analytics/usage-analytics.js、analytics/provider-diagnostics.js、actions/action-engine.js、actions/types.js的可选诊断布尔白名单，以及对应构建资源。没有重做七Adapter、V9.3 Facade、GLM v813／thinking、DeepSeek Schema、Prompt anchor、IPC、Effect Writer或桥接协议。

原始RED与新增流尾包反例独立保留；39个冻结出站Body／Header／路径预期零变化，映射仍293。最终测试、打包与提交哈希见[验证报告](V9_3_1_VERIFICATION_REPORT.md)，已知范围与后续Gate见[台账](V9_3_1_P_ISSUE_LEDGER.md)和[移交](V9_3_1_HANDOFF_TO_V9_4.md)。

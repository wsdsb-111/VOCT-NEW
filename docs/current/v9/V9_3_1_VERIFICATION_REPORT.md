# V9.3.1 候选验证报告

基线 `6e232091edb109ccc1e34d26c4b9a120b8a199ba`；Gemini代码提交 `7e5b053edde8f5bc94ed6e24354c472081ba59fa`，Action代码提交 `c4a36ff60f098e650b1f9ed174695296f8ae597c`；Gemini部分用量下界补记 `097cf9d0793291c207bdccdbf10b410492675ea3`，Action诊断DTO补记 `cef7ea74250dce6780e01964151727e58f5adf0c`。最终源码／资源输入SHA-256 `69e4a579ca28cace8d467601fc3ad36873ff28f808824576bdb4eb6bac034565`。文档与QA收口不改变该运行时输入，当前仍CANDIDATE。

| Gate | 状态 | 本轮证据／边界 |
|---|---|---|
| G0 基线／RED | PASS | [基线](V9_3_1_BASELINE.md)、586逐字节代码备份、原始Gemini11 RED／4 PASS、Action36 RED断言、独立QA8 RED／1 PASS。新增尾帧、确认入口及Normalizer公有边界也先RED。 |
| G1 Gemini Adapter | OFFLINE_PASS | 六项原生数字白名单，非法字符串不保存；流／非流、0／缺失／null／undefined、部分及空usage-only通过。 |
| G2 Normalizer／Writer | OFFLINE_PASS | Gemini专项20/20，独立QA19/19；native/estimated与来源不混；候选20／thoughts30／input100／total150／cached40保留，visible20；tool单列、不可解释差额UNRECONCILED。 |
| G3 Action诊断 | OFFLINE_PASS | throw／FAILED／无ID／非法ID／queued／awaiting_ack／接受后sandbox错误／第二次写入错误／dryRun；零自动重放，已有信封保留，保守descriptor收到ACK仍UNCONFIRMED。 |
| G4 七Adapter／安全 | TARGETED_PASS | 39冻结出站、原V9.3独立QA18/18及能力／取消／预算／来源／隐私专项通过，旧缓存零值期望按新Gemini字段保留更新；其余失败／未知门禁保留。完整业务门禁见G5。 |
| G5 完整发布／构建／打包 | FULL_LOCAL_PASS | 最终交付输入435/435完整回归PASS、退出0；507测试文件／71历史组。5981依赖文件／264包锁定保持，293映射build／verify／deploy／deployed parity PASS；隔离真实EXE诊断开关、Gemini两条模拟生成及单次双writer、Action故障路径PASS。 |
| G6 最终SHA CI | NOT_VERIFIED | 旧6e23209 run38350638449已单独核验completed/success；未自动推送，按用户自行推送偏好处理，不能用旧CI签署新SHA。 |
| G7 CK3／Soak | NOT_VERIFIED | 本轮需用户三人对话、最终摘要／Durable持久化、Action/Letter回读、取消重开和Soak；既有验收保留，但不冒充新实机证明。 |
| G8 Gemini／其他真实端点 | NOT_VERIFIED | 本轮新真实生成与付费调用0；Gemini／Player2／Ollama仍Mock支持范围，不宣传NATIVE_PASS。 |
| G9 GLM缓存 | P1-HOLD → V9.4 | v813及参数保持，未做缓存性能A/B，不宣称命中率或费用收益。 |

## 统计与诊断语义

Gemini使用[官方UsageMetadata定义](https://ai.google.dev/api/generate-content#UsageMetadata)核对prompt、thoughts和candidates的总量；cached是输入重用维度，不能加进总量。有效total保留不改写，缺thoughts不推零，非法标记不能被数字alias掩盖。显式非Gemini provider不能因携带usageMetadata而绕过原total门禁。账单、全部计费输出与实时价格仍UNKNOWN；RECONCILED只说明已报告三项数字相等。

Action DISPATCH_FAILED描述调用／sandbox异常；dispatchAttempted、dispatchAccepted和原physical dispatched分别描述尝试、信封接受与实际写入，confirmed仍false。先接受后失败时可同时保留DISPATCH_FAILED与PENDING_CONFIRMATION；这没有成功文案，也不是“明确未送达”。已有命令保留STATE_UNVERIFIABLE确认入口，原Conversation负责等待／查journal；两个可选布尔事实通过原诊断DTO重建后仍保留（旧档缺字段不补false）；即使匹配ACK也不会冒充效果CONFIRMED。Writer／桥接协议未改。

## RED → GREEN及兼容记录

原始C0 RED不覆盖。新增真实Gemini SSE STOP主计数→部分thought/cache尾帧→空尾帧的反例先失败后通过；不把重复快照求和。独立QA另复现旧alias遮蔽INVALID、metadata使非Gemini门禁放宽、旧visible投影遮蔽有效candidates，修复后通过。

原V9.3独立QA合成Gemini响应明确有cachedContentTokenCount=0，旧Adapter丢弃时断言UNKNOWN；本轮正确保留原生0，因此只把该合成fixture的reportedCacheHit判断增加Gemini。没有改Golden或放宽缺失值断言；V9.3.1专项继续独立测试无字段／null／undefined保持未知。旧V9.3文档和冻结证据保留。

基线文档C0误将36条RED复制文件称作初始24条快照；收口已更正。初轮24仅会话观察，可靠冻结文件是最终36条RED，不能补造历史。

构建使用既有runtime-dependencies、build-runtime、verify-runtime-build、deploy-runtime-build和verify --deployed；未改锁依赖、映射或正式版本。生成资源仅6个对应文件改变（含两个可选布尔值的Action诊断DTO白名单）。主题／Official Action专项、七个要求的生成JS语法及git diff --check通过。首轮完整门禁止于旧v7.7三个flat字段的精确对象断言；已补入本轮要求的安全usageMetadata期望，旧数字断言保留。末次源码改动同时关闭partial total低于已报告单侧计数的漏检，三种反例先RED、合法partial控制PASS；20/20与19/19及39Golden复核通过。此前435组完整门禁通过；最终只新增Action专用DTO白名单的两个可选布尔字段，结算后的值先RED再GREEN，旧DTO形状及非布尔值拒绝通过。最后一次node scripts/test-release.js针对输入69e4a579…完整435/435 PASS、退出0，记录 `.build/v931-release-delivery-final.log`，SHA-256 `0b2596a78fd52fa8c948df98f27bc2a3fcb6e4ec4c2fa5cc883ba6ba9f171781`。

隔离VOTC.exe使用可丢弃profile，global fetch只回放合成Gemini，外部网络禁止；实际Main／Renderer／Preload／IPC、两个数值writer和故障注入均通过，末次部署后串行重跑同一隔离脚本也PASS，截图单独留本地，未提交日志或用户数据。此证据不等于真实Gemini或CK3效果验收。

用户已将文档与QA收口提交为 `cbf54f3a0705641b7bbc35c33b8f3e25705e4784`；本次追加只补最终本地门禁结果和证据，不改变源码／资源输入。

本轮匿名哈希、状态与用例映射见[证据](v931-conformance-evidence.json)，范围见[实施](V9_3_1_IMPLEMENTATION_REPORT.md)、[台账](V9_3_1_P_ISSUE_LEDGER.md)、[V9.4移交](V9_3_1_HANDOFF_TO_V9_4.md)。正式App/Core/UI仍9.2.0/V9.2；缺最终CI／实机不签FULL_FREEZE。

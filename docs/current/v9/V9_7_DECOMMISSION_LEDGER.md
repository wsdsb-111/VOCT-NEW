# V9.7 退役与兼容台账

审计基线：`3721b925`，冻结提交 `3674107`。本轮只退役 D01 的不可达分支；没有删除模块、IPC、配置键、数据格式或发布测试。P0/P1 路径均保留。工程方案中的“候选”不是删除批准。

## 引用证据与边界

`node scripts/v9.7-reference-audit.js` 在源码根内离线盘点 322 个 JS、504 条字面相对 require；按 `runtime-inputs.json` 解析安装相对路径。脚本不启动 Main、不加载用户脚本、不访问用户数据。184 个 Preload 路由由隔离 VM 采样（无参，listModels 另采有参），174 个 handler 由真实注册函数在空服务桩上登记，包含动态 Pair 方法循环；send 的 Main/window-manager 字面处理端单列。完整路由、处理器源文件、直接服务调用文本、Renderer 直接/可疑别名文本消费者见 `scripts/fixtures/v9.7/ipc-baseline.json`。

这不是 AST 完备调用图或 IPC E2E：serviceCalls 来自函数文本，不执行 handler；事件 on 尚须业务/EXE 测试；可能的别名、动态属性、外部插件和自定义模板无法据此排除。不存在直接文本消费者只代表 UNKNOWN，不允许删除。动态执行点为 action-registry 的 `vm.Script/runInContext`、action-sandbox 的同类调用、script-sandbox 的 Script/runInContext（六个文本命中），其输入来自用户 Action/Prompt，不能用静态零引用代替权限审查。

## 候选决策

以下 `src` 均指 `src/app/main/`；各行写明符号、入口、所有者/数据、决策和再评估条件。未实施删除的 execution 为“无变更”；风险是误删风险，不是已存在缺陷。

| ID / 符号或键 | producer → consumers / fallback / 动态入口 | writer / source-of-truth / replacement | 决策、风险与动作 | 合同证据、回滚与再评估 |
| --- | --- | --- | --- | --- |
| D01 `providers/provider-result.js::normalizeFinishReason` Gemini `max_tokens` else-if | Facade/normalizeProviderResult、generation-outcome 与外部导出 → finish DTO；非动态独立入口 | 仅纯返回值，无持久 writer；前面的通用 LENGTH 分支已包含同一值 | **RETIRE_PROVEN / P2**：仅移除不可达分支；保留旧 options 属性读取与 coercion 的求值顺序、次数和错误 | 冻结 V9.6.1 函数；567 普通输入比对 + null/getter/toString 异常反例；现行七 adapter Golden、result/usage。逆向恢复原函数即可，无数据回滚；执行提交见验证报告 |
| P01 `prompts/prompt-plan-compat.js::finalizePromptBuild` legacy/shadow/v9 与 `LEGACY_OBSERVED` | PromptBuilder → Conversation preflight；自定义 description/examples/custom 非标准消息回退 | PromptConfigManager/脚本源；无新 serializer owner | **KEEP_COMPAT / P1**，无变更 | V9.7 三类型×三模式与混合非法历史拒绝；V9.4 全消息 Golden/主链/source/Forget；只在受控 adapter 可等价表示非标准消息后复评 |
| P02 `prompt-plan-layouts::resolvePlanMode`、`orderPlanBlocks`；v5/v6/v7/v813/glm_cache_v2 | 显式 option、`VOTC_PROMPT_PLAN_MODE`、配置 profile → builder/serializer/prefix | 当前 PromptPlan pipeline；稳定/冻结在前，动态在后 | **KEEP_ACTIVE / P1**，无变更 | 环境优先级、7 布局/profile Golden、prefix/Role/budget；不能把估算改称 Provider 原生命中 |
| P03 `prompts/prompt-config-manager::PromptConfigManager`，`systemPromptTemplate`、description/examples/suffix、bundled hash | 配置 reader/manifest → PromptBuilder/脚本沙盒；旧配置和用户模板是动态消费者 | Prompt 设置及模板文件仍是权威；迁移仅既有明确路径 | **KEEP_COMPAT / P1**，无变更 | 原字节哈希受 V9.7 守卫；现行 config/Prompt 回归；旧配置未知键和升级/重启合同证明前不去键 |
| V01 `provider-platform`、`provider-result`、`generation-outcome`、`effective-request` | Chat/Action/Summary → Facade → 七厂商 adapter；legacy `votc_result` 在 toLegacyResult 边界承接 | 内部 typed status/finish/usage/error；原生 UNKNOWN 与估算分开 | **KEEP_ACTIVE / P1**，D01 外无变更 | adapter conformance 七厂商/39 wire 场景、cancellation/retry、effective-request/preflight；不再制造第二 DTO 或并行转换器 |
| V02 `generation-outcome::validateGenerationOutcome({strict:false})` | 没有静态 src 调用，但导出、历史兼容测试仍用；外部 JS 消费者未知 | 原兼容 adapter | **HOLD_UNPROVEN / P1**，不删 | result-usage 测试直接覆盖；需证明外部/动态调用为空且替代校验等价，不能只用 rg=0 |
| M01 `memory-engine::MemoryEngine`、`memory-store::MemoryStore`、`legacy-source-lineage` | main/memory-system → Conversation/GameData/LetterSummaryFinalization；source proof/Forget/恢复 | GameData 定向对写与 SummariesManager 编辑/Forget 经 MemoryStore 原事务；Legacy JSON 权威 | **KEEP_ACTIVE / P0**，无变更 | Legacy readonly/restart、legacy-forget、directed-persistence、letter-summary；禁止启动全量重写、不能把 Episode marker 当 Memory4 残留 |
| M02 `pair-long-term-ledger::{get,preview,apply,openSource}`、`pair-memory-service`、`summary-catalog` | Conversation、IPC/UI Pair 面板、owner candidate directory → 派生索引/来源回查 | 原摘要为权威；Pair schema1/algorithm1 索引可重建，apply 是确认后的唯一入口 | **KEEP_ACTIVE / P0**，无变更 | pair-ledger/source contract + V9.7 preview/readOnly 不落盘、source revision；无授权不双写/自动回填 |
| M03 `summary-folder-merge`、`summary-folder-verifier`、旧摘要 reader | Owner 改名/旧目录、同 ID 对话定位 → Store/GameData；summary-mutation journal 恢复 | 现行备份+事务；Sidecar 存在时跳过合并 | **KEEP_COMPAT / P0**，无变更 | 既有 rename/transaction/sidecar/Legacy tests；必须覆盖相同名不同 ID、歧义与回滚后才可复评 |
| M04 `MemoryExtractor/MemoryConsolidator`；`summary-date-index::{selectTemporalExtras,buildConversationTimeIndex}` | 前二者由 MemoryEngine 构造并调用；后两者导出且脚本测试消费，外部消费者不明 | 当前摘要辅助与兼容导出 | **HOLD_UNPROVEN / P1**，不删 | 不恢复 Durable/Year/Life；未证明完整替代及动态消费者为空，不凭名称退役 |
| F01 `worldline/legacy-family-presentation`、`character-family-facts`、`family-visibility` | DTO/resolver → 场内/场外身份投影、五代公开来源图 | CK3 当前有来源事实；不扩张秘密/历史记忆 ACL，manual hidden 优先 | **KEEP_ACTIVE / P1**，无变更 | V9.6.1 relationship/family/identity 独立 QA；退休需双向、Presence、继亲/前配偶/订婚与冲突完整反例 |
| A01 `actions/action-engine::createActionEngine`、`action-prompt-compatibility-overlay` | actions/index、provider-service → Official Action check/参数/schema/本地校验 | 当前官方 2.0.3 Action；不是按旧 AE 名字运行的自研系统 | **KEEP_ACTIVE / P0**，无变更 | official-action-system、overlay-stable-prefix、action-provider-parity；旧 AE 历史测试继续 ARCHIVE_ONLY |
| A02 `run-command-recovery`、RunFileManager、LetterManager/DateTracker/transport | main/actions/letters 组合根 → 队列/ACK/日期/收信/Finalization | RunFile 队列与 Letter 回执各唯一 writer；未知 Effect 不重发 | **KEEP_ACTIVE / P0**，无变更 | run-command-recovery、receipt-startup、letter-delivery、finalization、recovery-race；不得为了清理再发送 Effect |
| I01 `ipc/register-ipc`、preload、Renderer：Pair binding/summary/knowledge/Canon | 174 handlers ↔ 184 采样路由；动态方法循环、UI alias/插件仍可用 | service owner 见 IPC JSON 的 serviceCalls 文本及下方权威表 | **KEEP_ACTIVE / P1**，无删除/改名 | IPC baseline 与缺 handler 负例；现行业务 UI/EXE gate，不把文本矩阵当 E2E |
| I02 `worldline:{create,update,delete}Supplemental` | Preload 仍暴露；Renderer 仍有旧调用或别名；Main 明确拒绝旧写入 | Canon mutate 是新写入口，旧 channel 保持显式拒绝 | **KEEP_COMPAT / P0**，无变更 | legacy UI/Canon tests；不能删 handler 让旧 UI 静默失败，也不能恢复旧写旁路 |
| W01 `branch-registry`、`canon-service`、`supplemental-retriever` | WorldlineService/Conversation/Editor → list/test/formal recall/confirm continuation | Canon 与 Campaign/branch registry；4096 且取剩余预算，冲突预览只读 | **KEEP_ACTIVE / P0**，无变更 | world-memory-restart-budget、Terra boundary；同日确认/重启/跨 Campaign/不足预算拒绝均保留 |
| B01 `bridge/*`、`ck3-mod/`、`compatibility-patches/v8.15.2-letter-runner` | main/IPC/Bridge Hello、97 文件 Mod、外部安装及 `.txt` 日志 | ck3-mod 权威源码，独立发布；Bridge manifest 只升级 Runtime 标签 | **KEEP_ACTIVE / P0**，不改 Workshop 或独立兼容仓库 | Mod source/artifact verify、bridge gate、letter date/ACK；保留第三方兼容有/无场景，实机未替代 |
| H01 Memory4/Durable/Year/Life 历史测试与 V6–V9 文档 | archivedChecks/显式 scripts/archive 维护入口；非生产读取链 | 原始历史证据 | **ARCHIVE_ONLY / P2**，无删除/迁移 | 原 127 归档检查保持；本轮没有 release→archive，禁止恢复旧在线模块 |

## 数据权威与事务边界

| 数据 | 唯一业务写入边界 / 读取者 | 重建与兼容边界 |
| --- | --- | --- |
| Legacy 定向摘要 / Forget | GameData saveRecoveredSummary/saveConversationSummary；SummariesManager 的编辑/删除由 MemoryStore 事务封装；Conversation、Letter、Pair UI 读 | index 的 forgottenSummaryProjections 是来源撤销权威，不得重建丢失；旧 Summary 兼容读，不自动改正文 |
| Pair 长期事项 | PairLongTermLedger apply（显式 previewRevision/确认）；摘要文件与 source key/revision 为原文权威 | derived index 不成为第二份摘要；readOnly/get/preview 不应落盘，来源变更需复核 |
| 官方追忆 | CK3/Worldline 当前只读导出，经官方专用 route 注入 | 不混入普通 Legacy 摘要重复选择，不从历史 Definition 推写当前事实 |
| Canon / 分支 | CanonService 授权 mutation、BranchRegistry 明确确认；list/preview/test 不把歧义分支自动激活 | 同日 fingerprint 冲突先只读预览，确认延续后才恢复 NPC 召回；原记录保留 |
| RunFile / Letter / Finalization | 现有队列、Letter accepted marker、MemoryStore journal / pending finalization；每个阶段现有 writer | ACKNOWLEDGED 不等于 CONFIRMED；重启恢复不得重演未知 Effect；不增加双写 |
| Provider/Prompt 设置 | SettingsRepository / PromptConfigManager；动态脚本沙盒只读入口 | 保留旧键和厂商配置；本轮无配置迁移、无真实设置读写 |

## 执行与独立复核

冻结提交 `3674107`；D01、四个新增 release checks 及审计增强的执行提交由 Git 主线和 [验证报告](V9_7_VERIFICATION.md) 定位。其余行 execution=`NO_CHANGE`，回滚无需数据动作。Terra/high 的两次只读独立审计确认 Prompt/Memory/Action/Letter/Bridge 无可直接删除完整路径；其反例建议已加入 options getter/coercion、IPC 审计边界和 Legacy 旧格式内容断言。最终审查与准确 SHA 的 CI 状态在验证报告单列。

不以“0 RETIRE 文件”视为失败；本轮闭环的是有证据的单分支退役、兼容边界、引用/字节守卫和可追溯判定。HOLD 项交 V9.8，不暗示已删除或已验证外部消费者为空。

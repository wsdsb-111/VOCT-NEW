# V9.3.6.3 综合实施报告

状态：AGE-01、RECALL-01、REGEN-01 与 OBS-01 的本轮补充施工记录。本地候选实现、构建、部署、完整回归及隔离窗口已通过；新建Windows候选六步和完整436组复验亦通过，不代表Full Freeze。

## 范围与历史关系

本轮综合规格见[综合改进与修复施工文档](VOCT_V9.3.6.3_Integrated_Improvement_Spec.md)。此前 TwoP1 阶段的 INT-03 与 PERF-02 已作为历史交付记录在[原实施报告](V9_3_6_3_IMPLEMENTATION_REPORT.md)、[原验证报告](V9_3_6_3_VERIFICATION_REPORT.md)和[Pair 性能 A/B 报告](V9_3_6_3_PAIR_PERFORMANCE_AB.md)中；本报告只记新增的年龄、历史召回、重新生成与匿名诊断施工，不重写旧阶段的数字、哈希或结论。

## 本轮实施内容

### AGE-01：当前年龄服从可信 CK3 事实

年龄决策集中在 `worldline/character-age-service.js`。本轮保留可信当前 CK3 年龄及其来源，不让近似日数换算覆盖游戏提供的当前年龄；生日推算和去世年龄通过统一的日历日期规则计算。`game-data/character.js`、`game-data/relationship-resolver.js`、`worldline/character-temporal-facts.js`、`worldline/character-family-facts.js`、`worldline/family-entity-fact-bundle.js`、`worldline/relationship-current-truth.js`、`worldline/worldline-service.js` 与 `prompts/prompt-builder.js` 共同传递年龄来源和最终事实。不能由可信来源确认的年龄保持未知。年龄诊断使用来源、冲突和匿名身份信息，不记录人物描述。

### RECALL-01：同一可信玩家请求驱动人物与时间检索

`memory-system/pair-memory-routing.js` 从当前真实玩家消息解析意图，并使用稳定角色 ID、Owner、会话、场景和 Campaign 约束授权。`memory-system/fuzzy-temporal-resolver.js` 提供明确日期及相对时间窗；`memory-system/player-centered-memory.js` 与 `memory-system/pair-memory-source-retrieval.js` 将授权目标和窗口传入第三人历史候选与来源复验。目标、时间或来源不能唯一确认时保持受限或拒绝；摘要源在截止发送前仍要复验。原 V9.3.6 L0/L1/L2、Forget、Source Revision 与 Owner 隔离合同继续适用。

补充修复：唯一亲属即使真实姓名只有一个汉字也保留展示名，唯一别名策略不放宽；PairLedger 确认产生的 retrievalEpoch 进入会话缓存身份。明确事件时间只从当前已确认事项的本地时间锚匹配，不将整份摘要的事件引用套到其他事项；旧摘要无匹配事项时的 L2 回退仍受同一时间窗、来源修订与总计两次解析约束。

### REGEN-01：区分逻辑玩家轮与物理生成尝试

`conversation/conversation-turn-manager.js` 为真实玩家输入递增逻辑轮号；每次重新生成只递增物理 `turnEpoch`，继续引用同一条仍在对话中的真实玩家消息。`conversation/conversation.js` 使用数值 speaker ID 校验回应者，限定同一会话、玩家、场景、Campaign 与参与者；安全检查先于历史尾部裁剪。重新生成不新建 user 消息，也不重复调用参与者观察；带有动作结果或不安全尾部事件时拒绝重放。时间焦点有效期按真实玩家逻辑轮计算，连续失败重试不会消耗有效期。旧生成由响应身份、AbortSignal 和物理 epoch 守卫，只有当前成功响应才可提交动态召回 Seen。

### OBS-01：实际发送 Prompt 的匿名对照字段

`memory-system/player-memory-diagnostics.js` 生成白名单哈希、计数和比较状态；会话在来源守卫通过且响应仍为当前尝试时，将诊断写入 provider 请求 metadata。注入摘要基于最终 Prompt 中的记忆块 ID、内容哈希和 Token 数；原文、人物姓名、原始消息 ID、路径和凭据不进入这组常规诊断。`analytics/provider-diagnostics.js` 与 `analytics/usage-analytics.js` 提供诊断投影路径。该机制用于区分检索选择、来源变化和实际注入变化，不用于证明模型输出遵循了来源。

## 主要代码与专项脚本

新增或修改的主要源文件包括：

- `src/app/main/game-data/character.js`、`relationship-resolver.js`。
- `src/app/main/worldline/character-age-service.js`、`character-family-facts.js`、`character-temporal-facts.js`、`family-entity-fact-bundle.js`、`relationship-current-truth.js`、`worldline-service.js`。
- `src/app/main/memory-system/fuzzy-temporal-resolver.js`、`pair-memory-routing.js`、`pair-memory-source-retrieval.js`、`player-centered-memory.js`、`player-memory-diagnostics.js`。
- `src/app/main/conversation/conversation.js`、`conversation-turn-manager.js`、`src/app/main/analytics/provider-diagnostics.js`、`usage-analytics.js` 与 `src/app/main/prompts/prompt-builder.js`。

对应的专项脚本包括 `scripts/test-v9.3.6.3-age-authority.js`、`test-v9.3.6.3-kinship-temporal-recall.js`、`test-v9.3.6.3-regenerate-consistency.js`、`test-v9.3.6.3-recall-observability.js`、`test-v9.3.6.3-integration-release-qa.js` 和 `test-v9.3.6.3-integrated-ab.js`。脚本存在或已列入清单不代表根目录已完成独立复跑与发布门禁；最终状态以根目录补录的验证证据为准。

## 兼容与安全边界

Legacy Summary 可见标签、协议 3.0、存储 2.5、Official Action 2.0.3、现有玩家中心固定记忆基线和原摘要来源合同保持。此轮不恢复 Memory4/Durable、Year/Life 自动生成或后台重建，不改写旧摘要或 Sidecar，不迁移真实用户数据。自动化不连接真实 CK3 存档、Provider/API 或远端服务。

## 验证与待完成门禁

下表中的 PENDING 表示需由根目录在本轮最终候选上执行并记录；NOT_RUN 表示尚无真实验收证据。这里不预填最终测试数量、源码 SHA、payload SHA 或部署映射。

| 门禁 | 状态 | 备注 |
|---|---|---|
| 本轮 AGE / RECALL / REGEN / OBS 专项复跑与交叉检查 | PASS | A01–A14、20项时间/亲属用例、6组重新生成窄回归、9组独立集成QA及匿名诊断导出。 |
| 测试清单登记、完整发布测试 | PASS | 436/436组，Node22.23.3；六个新增专项已登记。 |
| 当前综合候选性能 A/B | PASS | 22格/484次，每格20次warm；见[本轮A/B](V9_3_6_3_PAIR_AB_REPORT.md)。 |
| Runtime 构建、资源核验、部署及源码/运行资源一致性 | PASS | 289项，payload `8a706fd7ab2cfb507c0f8ae52c437758c3fb42c98d950febcf56862b57e82a10`。 |
| 真实 CK3 / 存档场景 | NOT_RUN | 未做真实游戏验收。 |
| 真实 Provider/API | NOT_RUN | 未发起真实请求。 |
| 20–30 轮联调 | NOT_RUN | 未运行。 |
| 80–100 轮 Soak | NOT_RUN | 未运行。 |
| 远端 CI | NOT_RUN | 未运行。 |

真实游戏及外部验收的操作项见[实机与外部验收清单](V9_3_6_3_REAL_GAME_CHECKLIST.md)。

## 本地交付证据

App/Core/UI保持9.3.6.3；独立Three-Mod、Workshop、协议与存储版本保持。冻结的旧候选为 `5c6af27e4f502b8c2a6dfb93dc8a03dd989d5092`，payload `4a5a54504815a3482450d5e6d53c269c988759fe06619a8dc38bafbccea91673`。本轮预修复基线有310次合成采样；当前性能结论只取本轮候选同源A/B，不把旧批次9116次计入本轮。

隔离打包窗口两次启动、实际部署模块九组集成QA、重新生成记忆块比对、Legacy文件夹与姓名/日期/来源展示通过；实际网络和付费模型调用为0。完整命令、计数、源码哈希和后续干净Windows候选结果见[综合验证](V9_3_6_3_INTEGRATED_VERIFICATION_REPORT.md)。

代码提交：`b4a9e805231fffea82b4c8d6f09d56a1d7610a08`。干净Windows候选使用该提交、68项LFS校验和空.build目录完成六步；完整436组通过，289项payload与主部署一致。最终报告收口仅含文档，不改变测试代码。

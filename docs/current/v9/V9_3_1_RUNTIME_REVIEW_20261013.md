# V9.3.1 实机后只读审查（2026-10-13）

审查基线：`924e6bf`。正式版本仍为 Core/UI V9.2、App 9.2.0。本轮仅审查源码、当前部署和本地后台证据；未修改生产代码、运行时设置、记忆、队列或 Recovery，未调用模型、重放 Effect 或发起付费实验。本报告只保存匿名汇总，不包含对话正文、凭据或原始日志。

## 结论与优先级

| 优先级 | 结论 | 证据与边界 |
| --- | --- | --- |
| P1 | 最新会话的四个 Owner 均未提交 Memory4 Durable | Provider 全部 COMPLETE/STOP，但本地校验两次 `memory4_invalid_event_status`、两次 `memory4_response_no_valid_entries`；Recovery 均 EXTRACTION_FAILED/retryCount=1；对应四份 index 均无该 finalization commit。Legacy 已提交，不受这一失败回滚。 |
| P1 | Durable 动态输入被重复的实体/关系证据显著放大 | 四个请求合计输入 213,879 Token；重建动态 JSON 合计 530,500 字符，对话 fragment 正文仅 25,656 字符。entityNames/relationships 两类字段的 JSON 值合计 358,128 字符，约占动态 JSON 的 67.5%。这是字符体积占比，不能直接当成 Token 或费用节省比例。 |
| P1 | 失败恢复会重复提取已处理来源 | 已完成 chunk 的结果只在内存中；completedFragmentCount 写入但未读取，恢复从第一个 chunk 开始。旧失败快照存在 retryCount=3 的同类校验错误；最新四份 retryCount=1 仍可进入后续恢复。来源/Forget 复核仍须保留。 |
| 已解释，未证明通用缺陷 | 中途入场者并非整体缺失“需要长期记住的事项” | 两位晚入场 Owner 各已有 5/4 条 Legacy memory，在与其他成人的双人摘要中均有该段；仅与另一位开场人物的投影为空。双人投影按知情者、对话对象相关性、共同在场来源过滤。不能将所有长期事项复制进所有双人摘要。 |
| 当前可用 | Year/Life 退役未切断人物认知 | Known-entities、直观察见、disclosures、当前事实、Detail/Legacy 召回独立运行。今日 51 次 memory_recall 中 39 次存在非空 Memory4 selected IDs。四 Owner 现存 known-entity counts 为 3/18/17/28。不能据此保证每项认知都正确或最新 Durable 已成功入库。 |
| 未发现新增回归 | V9.3.1 Action 派发修复在现有实机样本中正常 | 今日保留 47 Action 命令和 3 close，均 ACK、writeAttempts=1，pending=0。最近 32 Action 的同命令 BEGIN/ACK 全部在现存 CK3 debug.log 中匹配。ACK 不等同效果确认。 |
| P2，既有问题 | 零写入旧命令取消后，Action 可仍显示 dispatched=true | epoch 取消零写入命令，Conversation 转 UNCONFIRMED；settleActionResult 只排除 QUEUE_BLOCKED/QUEUE_EXPIRED。git blame 指向 V9.3.1 之前的代码。未见本次真实样本触发；不表示游戏效果已执行。 |

## 双人摘要与中途入场

最新会话四个 Owner 的入场边界为 message 0、0、11、22。该会话共保存 11 条 Legacy memory 和 65 个叙事 segment，生成 12 份有向双人投影。

前五条 memory 的来源在 message 0/3/5/8/9，晚入场者不能继承。后六条 memory 的来源在 message 26/31/33/35/47/49，确实产生了晚入场者可知的事项。后六条为 participants 可见性，其 subjects/participants 没有形成与另一位开场人物相关的候选。因此四份涉及该人物与晚入场者的双向投影没有长期事项，其他八份有。

`perspective-projector.js:156-167` 只有 projected memories 非空才附加标题；`14-27` 校验对话对象相关性，`135-153` 校验双方来源时在场，`182-185` 分别筛选 memory 和 narrative。这里的标题来自 Legacy extraction/projection，不来自稍后独立的 memory4_durable 调用。

公开可感知发言应使用 public；若模型错误地标成 participants，确实可能缩小知情者。现有汇总不能证明这一场每个来源都应向所有人公开，更不能通过去掉 KnownBy/presence 门禁修复。后续若要改善显示，应先确定玩家要查看的是“双人共有事项”还是“该 Owner 的整场事项”，并单独验证公开/私密/晚入场边界。

## 人物认知与 Year/Life

`memory4-derived.js` 关闭的是 Year/Life 自动生成及后台重建。`Conversation.observeVisibleTraits` 与 `memory4-coordinator.js:471-489` 仍按 Campaign、日期和当前在场边界记录观察。`memory4-profile.js:74-106` 仍组合 Known-entity recognition、当前关系/currentTruth、disclosed facts、Detail/Legacy 指针。

有效历史 Year/Life 可在来源、revision/hash、Owner/Campaign 和 Forget 验证后只读召回；不再生成新 Year/Life。Durable 发请求前已写入 known evidence 并处理 disclosure 辅助状态，所以 Durable 失败不等于人物认知完全停止。但本轮四 Owner 没有获得新的 Durable Detail/commit，后续结构化检索和承诺状态可能缺少这些新内容。

## Token 统计与缓存

窗口：北京时间 2026-10-13 00:00–24:00，读取时数据最后请求为 18:14:55。现存 usage-analytics 共 284 条，全部位于该窗口。读取 Provider diagnostics 并执行现有 cache-usage-reconciliation 后，汇总不变。

| 类型 | 请求数 | 输入 Token | 输出 Token | 总 Token | 已报告缓存命中率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| memory4_durable | 17 | 804,245 | 29,578 | 833,823 | 50.28% |
| action | 50 | 246,162 | 3,432 | 249,594 | 56.57% |
| final_summary | 14 | 58,668 | 44,386 | 103,054 | 46.47% |

Durable 其中一次 ERROR 没有原生 usage；32,608 输入 Token 是明确标记的本地估算，不能当作账单。其余 16 次原生输入合计 771,637，命中 387,968、未命中 383,669。上表的缓存率仅用已报告 hit/(hit+miss)，不把未知当作零。Durable 占这三类本地总量约 70.3%，约 96.5% 的 Durable 显示总量是输入。

最新四个 Durable 输入 45,190/53,785/55,214/59,690，缓存命中 768/768/768/640；合计命中率仅 1.38%。输出 5,735 Token，四 Owner 均未 Durable commit。全天也有大量高命中恢复调用；高命中不代表条目通过校验或产生业务收益。

用户确认截图来自 **DeepSeek 服务商控制台**：显示总量 1,724,035，18:00–19:00 为 850,637（命中 431,360、未命中 377,896、输出 41,381）。现存本地三类合计为 1,186,471，该小时为 423,001。两者未完全对账；截图不能由本地保留记录完整重建。不得将本地合计冒充完整账单，亦不能直接推断差额都是 Durable、重复计费或统计错误。需服务商侧相同模型/API Key/窗口的明细才能闭合。

### Durable 做什么、为什么大

Durable 提取可长期检索的结构化 Detail、关系/事件/计划和 COMMITMENT，以及明确的履约、取消、替代证据。其输出含 status、entries、fragmentIds、entityIds、eventTime、knownBy 和 commitmentTransitions；这与可读摘要正文中的事项列表是两个阶段。每 Owner 每 chunk 最多 8 条记忆/8 个承诺转移，输出上限 4096 Token。实际模型完整响应未保留在当前匿名 telemetry 中，不能还原非法 event status 的具体字符串或展示被拒绝的原文。

请求按 Owner 单独构造。最多 128 个 fragment 一组，每个 fragment 除正文还附带可见性、授权 entity IDs、人名证据和 CK3 关系证据；并带当前活动承诺。当前按片段数量分块，不按输入 Token 分块。本次仅 69/100/111/113 个 fragment 就分别达到约 4.5–6 万输入 Token。

重建四个 snapshot 的动态 JSON 字符数为 109,252/134,040/150,688/136,520，fragment 正文仅 5,399/7,035/6,242/6,980。逐片段重复的 entityNames 与 relationships 是首要体积来源。重建是现有纯 buildPrompt 调用，未发给服务商，字符测量不是精确 tokenizer 计数。

### 输出合同与恢复缺口

`memory4-contract.js:52-55` 只接受 observed/reported/planned/unknown。Durable prompt 只给 `status:"unknown"` 示例，未列举完整合法枚举。缺省会使用 unknown，但非空非法值会拒绝整 Owner。`parseResult` 仅对 unknown_entity 做候选过滤，其他校验异常直接中断；no_valid_entries 则表示返回候选全部被实体授权校验剔除且无有效转移。

只有全部 chunk 处理成功才 `commitOwner`；Provider STOP 与 COMPLETE 均不能替代业务提交。Recovery 的 retry=1 仍可恢复，恢复不使用已处理进度继续，因而同样的错误输出合同可能反复消耗输入。不得用放宽 entity/source/Forget 校验来提高“成功率”。

### 改进顺序（本轮未实施）

1. 先补齐提示词与校验器的枚举、来源引用和片段授权实体合同；用非法 status、全部实体拒绝、合法 NO_DURABLE_CONTENT、部分合法候选建立可复现用例。保留严格来源门禁。
2. 精简发送 DTO 中重复的 Campaign/Owner/fragment 定位和人名/关系证据，采用 Owner 内、片段授权不变的受控引用；不跨 Owner 共享私密知识，不删除本地完整校验证据。变更 Prompt/cache 合同需版本化并验证实际 wire。
3. 按保守输入 Token 预算分块；成功 chunk 形成可恢复检查点，重发前再次验证 source revision、正文、Forget。减少失败恢复中的重复提取。
4. 将稳定证据放在易变 limits/承诺尾部之前，在同一 Owner/参数/来源范围内验证缓存与正确性；以每次原生未命中 Token、有效提交率和费用为目标，不能仅追求命中百分比。
5. 保留 API 账单与本地请求/attempt 的分别核算。当前 Durable trace 是默认关闭的进程内诊断，usage 中 durableTrace 均为空，无法恢复完整历史 attempt 树；不能宣称今天确有二分重试或每条恢复费用已精准归因。

DeepSeek 当前官方文档说明缓存复用匹配前缀、需先落盘且尽力而为。固定 policy 命中而大段动态证据未命中符合该机制，但本地 block 归因是估算，不是服务商断点。来源：[DeepSeek 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)。

## Action 实机证据与旧边界

今日 47 个 Action 的持久化 verification：29 ACKNOWLEDGED、15 NO_EFFECT、2 CONFIRMED、1 缺失字段。两次确认好感度为 -25→-23→-21；15 个 NO_EFFECT 均为 100→100，不应作为“动作失效”或“效果成功”处理。现存 CK3 日志覆盖最近 32 个 Action，32 个同命令 BEGIN/ACK 均匹配，其中 9 个 NO_EFFECT 仍为上限值。更早已轮转日志的命令仅有队列记录，不能宣称重新核验了全部游戏日志。47 个 Action 均单次写入、无待处理命令。

V9.3.1 dispatchAttempted/dispatchAccepted/失败后保留已接受命令的链路未见本次反向回归。旧的零写入取消仍报告 dispatched=true 可用纯函数复现；另有单 Action 多 Effect 只保留最后 accepted ID 的边界风险，尚未在本次样本复现。当前没有理由重放旧 Action。

## 验证及剩余限制

- `node scripts/verify-runtime-build.js --deployed`：293 项源码/部署哈希 PASS。
- 只读审查代理运行的 Action dispatch diagnostics、V9.3.1 independent QA（19/19）、gold confirmation、official action 专项 PASS；disclosure-profile 专项 PASS。
- 生命周期、visibility、退役/归档的部分测试因 Windows 临时目录 rename EPERM 未取得完整结果；归档另有 fixture provider/contract 不符，不能列为本轮全部 PASS。
- 未执行新模型请求、付费 A/B、完整发布门禁或新的 CK3 操作；未给出 Full Freeze 结论。
- 后台取证文件读取时 SHA-256：usage `aab17715c166e127209c6b0a9965e65174223bef2b50cadb671b545f2e18fdb4`；queue `3fe7c2fe2fb25473fa4687767fe6a4859eae32f2759542acc71edbc5aead8045`；provider diagnostics `ef34ac795202d7d1d3a6062c5c43a9f11bff8fde422c959a26b9fb387d8198d2`。仅保存指纹，无原始用户数据副本。

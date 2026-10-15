# V9.3.5 Pair Index 与 Legacy 来源合同

## 权威与作用域

Legacy 原摘要是唯一权威文本。索引仅保存事项原文、日期、路由证据、搜索词与来源指针，不保存整篇摘要副本，不改写事实或叠加 Durable 状态。

主键为 `(campaignToken, ownerId, counterpartId)`，A→B 和 B→A 完全独立。Campaign 来自后端当前 GameData／现有合法绑定，IPC 不接受客户端指定 Campaign 或磁盘路径。有 GameData 时保留当前战役／Owner 写入门禁；无游戏连接时，所选范围具有唯一可信的历史 Campaign 绑定，允许预览后明确确认生成本地派生索引。单 Pair 按该 Pair 来源判定，Owner 批量按整个 Owner 判定，未绑定或多战役歧义保持只读。离线不补造当前游戏日期，也不授予当前事实；时间未知时不注入 Pair 事项，未来摘要、无授权／歧义来源、Forget、跨战役内容不得进入当前 Prompt。

文件位置为 `MemoryStore.baseDir/pair-important-index/v1/<campaign SHA-256>/<owner>/<counterpart>.json`，不是 archiveSidecar。索引可删除后从合法 Legacy 重建，原子替换只影响该 Pair。旧 Sidecar 不扫描、不读写。

## Source Key、Revision 与解析

Source Key 包含作用域及原投影／Finalization／Conversation 等身份，Source Revision 证明当前内容和来源元数据。相同日期不能充当身份；同日两场必须分别回查。无旧 ID 的摘要使用本地指纹与可验证映射，完全相同且不能区分的行不盲选。删除／修改／重新排序后不能拿旧 Nth-row 继续打开。

每条索引带有 `sourceSummaryKey`、`sourceRevision`、`sourceMemoryId`、会话日期、条目原文及序号、interactionEvidence 等信息。`DIRECT_PAIR`、`GROUP_WITNESSED`、`UNDETERMINED` 表示来源证据，不因两人同时出现在名单中就推断私下交流。对话日期与原文所述事件日期不相互替代。

共用解析器只接受明确的“需要长期记住的事项”段落，规范 bullet、续行、空事项和歧义状态；不从普通叙事中重新总结。歧义原文仅预览，明确确认后才纳入。磁盘条目总数无 8 条配额，不因每轮 Prompt 预算丢弃历史条目。

## 更新与读时验证

新摘要在原 Legacy 事务成功后派生索引，不能把未提交投影提前入库。索引写入失败保留已保存的 Legacy，并记录待重建状态；不能回滚正确原文。手工编辑、删除、Forget、改名与作用域改变使相关缓存失效。Forget 使用原 index／journal，旧恢复任务不得复活内容。

读取和打开源时核验当前授权、日期、来源版本和记录身份。源状态缓存之外，还检查已知授权 Pair 源文件的内容摘要；即使等长修改保留时间戳也不得继续注入旧文。最终检索包返回前再验版本，transport 前守卫继续验证 Campaign、源版本和已知源内容。变化则拒绝旧包，保留 Legacy 重新检索／刷新路径。

上述安全检查可能重新解析包含多篇摘要的已知 JSON 文件；不能把“只展开 1–2 篇源摘要”宣传成完全没有其他文件 I/O。它限制最终源正文候选与注入范围，未承诺任意规模下恒定耗时。

## 检索与预算

正常 v3 直接关系基线 Recent1 在本会话冻结，官方合法摘要最多独立 1 篇；切换对象的当前 Pair 包放动态部分。事项本地检索最多 12 项、4 个候选来源，详情／追忆意图最多展开 2 篇准确源摘要。同源事项只开一次，Recent／其他通道不重复注入。无有效索引命中、无事项段落、来源不可用时继续 Legacy 全文／时间／人物兜底。

Temporal 与 Mentioned／Entity 各最多 3 篇，去重后合计最多 6；源摘要 1–2 篇不是额外预算。所有格式化文本共享按首次参与人数冻结的原有比例／硬上限：2 人 10%／3600、3 人 12.5%／4500、4+ 人 15%／5400 Token，并保留 Provider 安全余量。正文太长时可截断或省略，诊断与最终文本必须一致。

## IPC 与回填

| IPC | 允许输入 | 关键约束 |
|---|---|---|
| `conversation:getPairMemoryIndex` | ownerId、counterpartId、page、pageSize、search、fromDate、toDate、sort | page 从 0 开始；pageSize 上限 50；全索引筛选后分页 |
| `conversation:previewPairMemoryBackfill` | ownerId、可选 counterpartId | 只读，不写磁盘；返回逐 Pair 统计和 previewRevision |
| `conversation:applyPairMemoryBackfill` | ownerId、counterpartId、previewRevision | 仅当前可写作用域；逐 Pair 重验，陈旧预览拒绝；原子幂等 |
| `conversation:openPairMemorySource` | ownerId、counterpartId、sourceSummaryKey、expectedSourceRevision | 后端精确验证后返回原文与受限 locator；不接收任意路径 |

Preload 使用相应 camelCase 方法。数字 ID 范围沿现有 IPC 合同，字符串限长、未知字段拒绝。列表搜索要求所有词项命中；数字和英文使用独立词项边界，不能因全文子串把 41 匹配为 141。无词项的单汉字可作原文子串搜索。分页、排序和搜索不能让权限扩展；ID、来源键和内部路径不能成为玩家主标签。

批量由前端逐 Pair 执行预览结果中的独立 revision；每完成一 Pair 才增加真实进度，取消在 Pair 之间停止。已完成部分保留，失败部分可重新预览并续做，不伪装整批事务。取消确认不写入。离线回填的权限由后端在 get／preview／apply 一致计算；apply 重新验证源修订，内部 `allowHistoricalBackfill` 不属于 IPC 允许字段，客户端不能自行授权。写入仅限 Pair 索引，原 Legacy、Forget 及旧 Sidecar 不受修改。

来源 modal 必须先成功 open 验源，再显示原文；过期时提示刷新而不展示旧缓存正文。定位还需核对真实摘要行与返回的内容／日期。UI 首要人物标识只用真实姓名，未知显示“姓名未载入”，同名 ID 仅折叠诊断。

## 信件及维护边界

信件物理投递和 Legacy 归档分别记账。双方实际定向记录验证完成才是归档 COMPLETE；只受理、单边保存或旧标记不足不能冒充完成。重试只补摘要，复用已保存模型阶段，绝不重下发未知／已成功 CK3 Effect。Forget 后人工阻断；旧 Memory4 恢复数据惰性保留，本版不自动导入。

无标题的历史摘要继续 Legacy 兜底；本地回填不能补造不存在的事项。中途入场修复保护新摘要中合法来源事项，但模型是否完整识别所有重要事件仍需真实 RP 验收。本版索引功能新增模型请求严格为 0。

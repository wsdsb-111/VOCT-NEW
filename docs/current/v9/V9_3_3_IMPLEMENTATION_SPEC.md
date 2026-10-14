# VOTC / VOCT V9.3.3 施工规格：重要记忆覆盖、Legacy–Durable 可观测性与 Year/Life 完全退役

> **文档状态**：待施工设计（不是已实施报告）  
> **适用仓库**：`wsdsb-111/VOCT-NEW`，`main`  
> **锁定基线**：V9.3.2，commit `d397f102d4222386e7f5424a340ac6a8cd444f25`  
> **目标版本**：Core / App / UI `9.3.3`；Workshop Mod `2.0.5`、Memory Engine 对外显示 `4.0`、底层协议 `3.0`、摘要存储 `2.5`、Official Action `2.0.3` 不升级  
> **变更类型**：基于现有 Memory4 / JSON Repository / Electron Renderer 的质量增强、读侧可观测性和已退役组件物理清理；**禁止借机重构 Provider、Action、Worldline 或 Summary 主链**。  
> **成本边界**：默认纯本地测试，不能自动触发真实付费模型请求；真实 Provider A/B 须另获用户明确授权和独立费用上限。  
> **本文件位置（建议提交）**：`docs/current/v9/V9_3_3_IMPLEMENTATION_SPEC.md`

## 0. 决策摘要

V9.3.3 不再增加新的 Year/Life 体系，不修改 Legacy 摘要的叙事写入格式，也不贸然把每 Owner 单轮最多 8 条 Durable 的硬上限加倍。采用 **“整场来源零模型预筛选 → 重要事件优先且跨时间段均衡的 Durable 抽取 → 严格校验提交 → Legacy–Durable 来源证明 → UI 解释覆盖”** 的方案。

本阶段的三个交付包：

1. **A / Durable 质量**：过滤纯寒暄、重复铺垫、无事实的姿势／动作表演；保留事件、亲历、听闻、历史回忆、重要关系与承诺。先对完整可授权片段集合做确定性筛选与分桶，再在预算内覆盖开头、中段和结尾，避免旧代码早期 chunk 填满 8 条后漏掉结尾大事。硬限制、来源、知情、时间、Forget 和 checkpoint 必须保留。
2. **B / Legacy–Durable 证据与 UI**：在既有“人物记忆”页中展示每场对话摘要与 Durable 的**可证实关联**、已提交条数、实际模型评估来源量、完整或配额截断状态、排除原因统计和操作限制；不能将“同场对话”冒充“逐条语义覆盖”。支持从 Legacy 相关条目跳到相应 Detail / 查看合法来源。
3. **C / Year/Life 彻底退役**：删除前端两个页签、旧按钮和提示；删除 Year/Life 的生产生成、查询、召回、IPC 写入和持久化路径；对已有 `years/*.json` 与 `life.json` 进行一次明确确认、可审计、可恢复到迁移前状态的**最终清理迁移**，迁移完成后生产数据中不再保留 Year/Life 文件。保留按“年／一生”提问的自然语言**查询意图**和基于 Detail/Legacy 的实时答案能力。**不能误删按年检索索引**。

### 0.1 V9.3.2 已确认基线（不得错误归因于本版本）

- 每 Owner 每 finalization 最多 `MAX_DURABLE_ENTRIES_PER_OWNER = 8`，这不是 V9.3.2 新加的；V9.3.2 新增准确的 `CAPPED` 与 `evaluatedFragmentCount`。
- 成功 leaf checkpoint、分块输入预算、严格 `knownBy` / `entityIds` / `fragmentRef` / 时间及 Forget 校验继续保留。
- 最近 4 Owner 的 32 条 Durable 和历史 138 份恢复目标已有 V9.3.2 账本；其中 130 份 `CAPPED` **不是数据删除或全部来源已经完整提取**。
- Legacy 中 `【需要长期记住的事项】` 由 `perspective-projector.js` 根据 Legacy `extraction.memories` 加入双人可读摘要；**不是**由稍后运行的 `memory4_durable` 自动回填。
- Year/Life 自 V9.2.3 仅禁止生成，但 UI、IPC、读者与老数据尚在。V9.3.3 要完成与“仅停止生成”不同的物理清理。

## 1. 不可突破的边界和非目标

1. **记忆权威**：V9.2 的 `ScopedJsonRepository` → `Memory4Store` 是唯一 Durable 写入路径；不增设第二套事实数据库或隐藏的自动概要 Store。
2. **私密与时序**：逐 `campaignToken × ownerId` 隔离，所有关联和 UI 读取均沿用当前 Context / Scope / `knownBy` / source proof / `Forget` / `revision` / `bodyHash` 门禁。中途入场的角色不能获知入场前未授权的谈话。
3. **证据效力**：听闻/传言/历史转述保留 `reported` 或 `rumor` 证据身份，不提升为 `observed`、CK3 当下事实或已确认 Action 效果；未知日期仍为未知。
4. **数据保护**：不得静默改写 Legacy 原文、玩家手工编辑的 Durable、已保存原始对话、Detail、承诺状态、官方追忆、信件、Action 队列、Forget tombstone、已提交 Recovery proof。
5. **删除边界**：Year/Life 数据删除是专门授权的升级迁移，不是“打开应用即顺手删掉用户资料”；必须先备份/可核验清单、提示范围、显式确认、执行校验。历史源码文档和历史 Git 记录保留为审计资料，不能把“从仓库历史抹掉所有字样”当成可实现的清理目标。
6. **模型行为**：不得为了“生成更满”放宽候选合法性、承诺履约条件、实体引用或来源校验；不能用模型自述“全覆盖”作为提交证明。
7. **回归**：Provider / GLM v813 outbound 合同、V9.3.1 Action 生命周期证据、V9.3.2 记忆安全/回收链、Summary 稳定前缀及 Block IDs 不随意改动。
8. **V9 总路线**：此版本只做范围内清债和记忆质量改进，不提前承诺 V9.4 的完整 Context Architecture，也不宣称 Full Freeze。

## 2. 现有源码定位与影响清单

| 子系统 | V9.3.2 实际入口 | V9.3.3 变更 |
|---|---|---|
| Durable 输入、分块、checkpoint | `src/app/main/memory-system/memory4-coordinator.js`：`orderFragments`、`chunkFragments`、`buildPrompt`、`finishOwner`、`restoreDurableCheckpoint` | 增加全文扫描/重要性规划；继续调用原 `parseResult` / `commitOwner` / checkpoint |
| 写入与来源索引 | `memory4-store.js`：`commitOwner`、`reindex`、`readEntry`、`queryCandidates` | 扩展带版本的只读覆盖证明/抽取状态字段；不改变已有索引轴含义 |
| 事实、事件时间、授权 | `memory4-contract.js`：`validateEntry` | 保留严格合同；如需扩充元数据用显式兼容可选字段 |
| Legacy 重要事项 | `perspective-projector.js:156–205`、`memory4-coordinator.js:getLegacyCoverage` | 用来源身份证据关联，不直接改写原摘要格式 |
| 人物摘要服务 | `src/app/main/summaries/summaries-manager.js:getMemory4OwnerData` | 接入分页、只读 Coverage DTO；清掉 `derived` 暴露与 Year/Life 操作 |
| Renderer | `src/app/renderer/memory4-manager.js` + `.css` | 删除 year/life 页签；增设“覆盖情况”及 Legacy→Durable 链接 |
| 安全边界 | `src/app/main/ipc/register-ipc.js` + `src/app/preload/preload.js` | 如需新查询则新增只读 IPC 且沿用现有验证；废止派生写操作 |
| 原 Year/Life | `memory4-derived.js` | 移出生产 Year/Life 生成、读写、清理和选择；抽离仍必需的 `sourceValid` 等来源校验 |
| 跨年代召回 | `memory4-recall-planner.js` | 移除磁盘 `year`/`life` ref 与派生切片；**保留** `LIFE` / `YEAR` 查询意图与合法 Detail/Legacy 召回 |
| Profile/Recovery | `memory4-profile.js`、`memory4-coordinator.js`、`memory4-store.js` | 去除 `yearKeys` / `lifeItemIds` / `rawYears`；已提交证明与恢复仍不依赖旧派生服务 |
| 测试与构建 | `scripts/test-manifest.js`、`scripts/test-release.js`、`scripts/build-runtime.js`、`scripts/verify-runtime-build.js` | 新测覆盖率、UI、清理迁移、召回和哈希一致性；历史已退役用例如需归档逐条说明 |

**必须使用 `rg` 执行全仓生产引用清单**，关键词：`memory4-derived`、`years/`、`life.json`、`yearKeys`、`lifeItemIds`、`getPointers`、`derivedDirty`、`derivedRevision`、`DERIVED_REBUILD_FAILED`、`SKIPPED_DERIVED_POLICY`、`kind === "year"`、`kind === "life"`、`memory4_year`、`memory4_life`、`updateYear`、`updateLife`、`cancelDerived`、`keepManual`、`conversation_year`。区分 **Year/Life 磁盘派生链** 和 **仍有效的年份查询/按年索引/历史测试文档**，不可“一键删除含 year 的全部代码”。

## 3. A 包：Durable 重要性筛选与整场覆盖

### 3.1 要解决的问题

当前 `orderFragments()` 主要按已知关系变化优先、其余按原顺序；`finishOwner()` 在达到 8 条额度后可能提前停止。长会话里，早段的 8 条一般事实可能占满配额，晚段的重大事件/旧约兑现/历史回忆却尚未评估。简单设为 16 条只能扩大成本和冗余，**不能保证重要性优先**。

### 3.2 提议算法：Global Evidence Planner（纯本地，零额外模型调用）

新增独立纯函数模块（建议）`memory4-evidence-planner.js`，调用点在完成 Owner 投影并完成 `filterForgottenSnapshot()` **之后、调用 `chunkFragments()` 之前**。只处理当前 Owner 可知且来源已授权的 fragments。其输出是排序/去重后的原始 `fragmentId` 列表及保守统计，**永不生成新事实，绝不改写 `fragment.text`、授权或 source revision**。

#### Step A — 全量本地浏览（不调用模型）

- 对每个可用 fragment 提取仅用于排序的特征：`sourceType`、role、文字长度、位置百分位、speakers/recipients、日期证据、合法实体引用、关系变化证明、是否与有效活动承诺的**精确绑定核心**相符、是否存在语义线索、来源可见性等。
- 用**正向线索**（不是只靠关键词黑名单）优先标记：事件/决定/战事/出行/死亡/婚姻/任务结果、某人亲历、历史回忆、转述/听闻/谣言、具名人物关系或态度变化、提出的明确计划、承诺与条件、兑现/取消/替代证据、改变后续剧情的秘密披露。
- 默认低优先级：`你好`/`再见`等独立寒暄；只有“点头、微笑、挠头、转身”等无事件结果的舞台动作；无事实的新旧重复表达；纯粹语气/环境装饰。
- **必须保守**：短句中若含日期、否定、秘密、金额、身份、承诺、转折、特殊行动、明确听闻或指名人物事件，即使出现动作动词也不得直接丢弃；“他拔刀刺伤了某人”属于候选事件，“他摸了摸剑柄”一般是描写。纯文本对 CK3 执行动作的效果不能当游戏事实，仍由原证据合同裁定。
- 识别精确重复句可降排序，但不通过仅有 `text` 相等删除多个来源；同一文字在不同 Owner、日期、speaker、知情范围或消息上出现，保留各自来源身份。
- 无法确定的片段放入 `UNCERTAIN`，不能冒充 `NOISE_CONFIRMED`；不能只因为“短/没有强关键词”就排除历史要事。

#### Step B — 按来源时间轴均衡分桶

- 对当前 Owner 的可授权原始序列按 `messageId` / 源片段顺序划分为若干区间（建议 4～6 桶，具体由片段量和预算决定），至少有**尾部事件保障**；同一段重复的聊天不能自动吞掉全部预算。
- 每桶按 `P0`（承诺/已证实关系变化/重大事件等）、`P1`（有具体人物及事件/回忆/听闻/时间证据）、`P2`（背景或无法判断）、`NOISE_LIKELY` 分类；**这只是送给模型的优先级，不是持久事实级别**。
- 在 `MAX_FRAGMENTS_PER_REQUEST=128` 和 V9.3.2 的 8192 保守常规输入预算内，先锁定各桶的高价值候选，随后增加相关上下文；上下文需标明来源并仍由原门禁验证。
- 顺序可按优先级组块，但必须保留可审计的原序号映射，必要时在同事件分组中按时间顺序发送，避免把“先发生/后发生”搅乱。
- **8 条额度针对整个 Owner finalization**，不是每桶各 8 条。达到上限仍停止，不自动追加付费；模型评估的 source coverage 必须按实际发送与 checkpoint 计数。

#### Step C — 少量模型指导，不新增预审调用

在 V9.3.2 的 Durable system policy 中增加正反例及优先级（**仅改变现有 Durable 请求**）：

- 保存**有持久后果的事件、听闻、回忆、人物关系变化、含条件承诺/目标/秘密**，尤其记录谁在何时知道了什么、事件发生时间是否被证实。
- 纯寒暄、无事实姿态和重复铺垫一般不生成 Durable；如果举动本身已构成有后果的事件、明确观察到的人物行为或承诺执行证据，则不可因为“动作”二字而排除。
- “某人说 X”不能转为“X 为真”；亲历、传闻与不确定性用现有 sourceType/eventTime 保守保存。
- 一句复杂信息可产生少量不同的事实，但不得为填满配额编造条目；同义重复尽量合并为一条，保留所有可验证来源 IDs。
- 正常返回可以少于 8 条。禁止将 `NO_DURABLE_CONTENT` 用于全部被校验拒绝的响应。

#### Step D — 配额与 Coverage 的诚实语义

**不要声称“扫描过所有来源 = 模型理解并记住全部来源”。** 分离下列统计：

- `authorizedSourceCount`：本次 Owner 经 Forget 和知情校验后可用的来源总量。
- `screenedSourceCount`：本地 Evidence Planner 实际检查的来源数；通常等于上项，但不代表模型处理。
- `plannedSourceCount`：被选入模型送审计划的来源数；`NOISE_LIKELY` 被排除的量另记。
- `modelEvaluatedSourceCount`：至少一次成功完成模型生成并通过来源检查的 chunk/leaf 覆盖的**不同片段数**；不能从“已发送”直接推断业务有效。
- `committedEntryCount`：成功提交且当前仍有效的 Durable 条目数。
- `capReached`：本次是否因 8 条额度停止；`unmodeledSourceCount` 代表尚未经过有效模型评估的来源数量。
- `coverageState`：`FULL_MODEL_EVALUATED` / `CAPPED` / `LOCAL_FILTERED` / `PARTIAL_SOURCE` / `NO_DURABLE_CONTENT_VERIFIED` / `FAILED` / `UNVERIFIED_LEGACY`。`NO_DURABLE_CONTENT_VERIFIED` 仅适用于全部授权来源完整经过合法模型评估并返回真实空结果；只通过本地规则筛掉低价值片段时，一律显示 `LOCAL_FILTERED` / `PARTIAL_SOURCE`，**不能**标“模型确认全文无记忆”。
- 所有计数有分母、Policy version、source revision、checksum；无法可靠从旧记录还原时显示 `UNKNOWN`，不得填 0。

**必须先解决的提交证明兼容性**：V9.3.2 的 `inspectCommittedSnapshot()` 只接受 `evaluatedFragmentCount == snapshot.fragments.length` 的完整提交，或确实提交 **8 条**且 `CAPPED` 的早停提交。**所以 V9.3.3 绝不能简单从待评估数组删除寒暄、在未满 8 条时仍调用旧 `commitOwner()` 并将少处理的片段当作 FULL**；这样会造成 `COMMITTED` 记录无法通过恢复证明。

实现有两个有序选项：

1. **首选安全方案**：Planner 仅“优先排序与跨时间桶选样”，不把中低优先级来源从 `snapshot.fragments` 永久移除；非常明确的纯寒暄片段可降至最后，并记录 `NOISE_LIKELY`，只有完成全部来源的有效模型评估才写 `FULL`。优先级不足以证明零记忆的来源不应被标成已覆盖。这样可以最大限度沿用 V9.3.2 的 `FULL/CAPPED` commit proof，且前 8 条优先占重要事实。
2. **可选的真正零模型过滤**：若一定要为明显寒暄节省 Provider Token，则增加单独的、版本化的 `LOCAL_FILTERED` coverage proof：精确记录原始授权来源集合哈希、逐条跳过的来源 ID+哈希与允许跳过的窄规则编号、实际模型覆盖集合、Policy version 和原始全文快照 hash；`commitOwner`、`inspectCommittedSnapshot`、Recovery、Forget 必须协同核验，且只能以 `LOCAL_FILTERED` 呈现。规则只允许完全独立、无引用、无实体/事件/计划/承诺线索的极窄白名单短句；一旦上下文依赖或疑义则不能本地硬排除。严格禁止将 `LOCAL_FILTERED` 偷换为 `FULL`，也不可把本地硬排除的内容记为“模型评估”。**若无法建立证明合同，本轮不得启用硬过滤，只上线优先排序。**

V9.3.3 修改布局时应新增带版本的可选 coverage proof / report，严格区分新旧记录，不改旧 `m4_...` entryId 和 finalizationId，不重提取已经合法 COMMITTED 的历史目标。对历史 130 条 CAPPED，只显示原始已知 count；若无 source plan 则不推断“被筛掉多少寒暄”。

### 3.3 实现防线：不要为了优先级破坏 V9.3.2 成果

- `restoreDurableCheckpoint()` 的 leaf 必须包含或验证规划版本、source digest、顺序映射；Plan 改变不能把老 leaf 当新计划完成；旧 9.3.2 checkpoint 允许读，若不能证明安全则 fail-closed / 按范围重新规划，不重复已证明合法提交。
- `beforeSendGuard` / post-send Forget / source revision / scope 验证保持。若 Forget 删除任一已发送 leaf 的来源，整 leaf 作废，不能仅重用该 leaf 中另一个未忘事实。
- 优先级只决定**发送次序**，不能决定谁的 `knownBy` 或 `allowedEntityIds`。仍使用请求局部 `fragmentRef` 恢复原始来源 ID。
- 8 个名额内的条目应独立严格校验；不新增“LLM 分数可以覆盖校验器”的后门。
- `COMMITMENT` 状态变更的 evidence binding 及 replacement index remapping 必须原样有效；短语同义召回若引入，也只能提高“待检查旧承诺”的候选量，**不得成为完成/取消证明**。本版默认不改精确承诺变更校验。
- 为防止输入膨胀，继续使用 V9.3.2 去重 DTO、8192/16384 保守输入限额、每 Owner 最多 32 次生成和每 chunk 一次修正。超过预算时 fail closed 并保留 Recovery，不能截断原始来源正文制造假完整事实。
- 性能上 Planner 避免 O(N²) 对每个 fragment 扫全部证据；预建授权实体表、承诺索引、分桶索引；给出大场景 profiler。

### 3.4 质量验收样例（至少放进 Golden fixtures）

| 对话片段（示意） | 预期规划 | Durable 预期 |
|---|---|---|
| “你好，今日天气不错。” | 低优先级 | 通常无 Durable |
| “我挠挠头，端起茶杯。” | 低优先级 | 通常无 Durable |
| “听闻襄阳三日前失守，消息尚未证实。” | 高优先级 / 听闻 | 保留为听闻，不能当已证实历史 |
| “我十年前曾随父亲逃离汴京，具体日子不记得了。” | 高优先级 / 回忆 | 保存回忆；不能伪造精确日期 |
| “朕答应你，若北伐成功便恢复兵权。” | 高优先级 / 有条件承诺 | 保留条件，不可提前判定履行 |
| “（摸了摸刀柄）昨晚我在城门看到刺客。” | 高优先级 / 事件证据 | 保留后半句，动作描写不应占单独名额 |
| “他拔刀刺伤使臣，当场被捕。” | 高优先级 / 重大事件 | 允许成为事件候选，证据身份仍按来源判断 |
| “没想到是你……旧约已正式取消，连同此前全部条件。” | 高优先级 / 否定与旧约 | 不能因寒暄前缀忽略取消事件；后续须精确校验 |
| 开头有大量重复寒暄，最后发生婚约破裂 | 结尾保障 | 后段重大事件有机会进入前 8 条 |
| Owner 晚入场，前段发生重大秘密 | 不可授权 | 晚入场 Owner 不能从规划／UI 得到前段秘密 |

上述是设计期的**预期**而非现有测试结果。须构造至少 40 个小夹具 + 10 个 100～300 fragment 的长会话 fixture，包括中文/英文、同义转述、日期未知、角色晚入场、矛盾陈述与 Forget 中断。

## 4. B 包：Legacy–Durable 来源关联与覆盖证明

### 4.1 正确的关系模型

Legacy 的 `【需要长期记住的事项】` 源于 `perspective-projector.js` 对 `extraction.memories` 的定向投影；Durable 从 Owner 授权的 fragment/Legacy 转换中独立抽取。二者**不要求逐字同文，也不保证条数相等**。因此需要两种不同层次的指标：

1. **来源覆盖（可确定）**：某个 Legacy 事项所引用的 source memory IDs / `messageIds` / `segmentIds` / `projectionLineages` 是否被某条有效 Durable 的合法来源证明覆盖；这是证据链接，不自动证明文字语义完全相同。
2. **事实等价覆盖（不能仅由同源推出）**：两个条目是否表达了同一事实、条件、否定或知情状态；本版不添加第二次付费语义判断，最多显示“来源有关联，语义未验证”。不得以字符串相似度或“同一 finalization”冒充等价。

### 4.2 Proof-of-coverage 关联器（服务端只读）

新增建议模块 `src/app/main/memory-system/memory4-coverage.js`，只从已提交 Memory4 Index / entry、Legacy provenance 和合法 Scope 计算；无 Provider 调用，不写 Memory4 Canonical 或 Legacy 文本。支持：

- `LEGACY_SOURCE_EXACT`：Legacy 事项的 `memoryId/sourceHash` 与 Durable 的 `legacyRefs` 可逐条验证；可靠说明同一 Legacy 原始事实的**来源对应**。若 `legacyRefs.complete` 可额外显示“完整迁移证明”；仅转换了部分事实不能记作完整。
- `SHARED_FRAGMENT_SOURCE`：相同 Owner × Campaign × finalization 且双方有可验证的原始 segment/message provenance 交集；标签说明“共享来源”，**不写成逐条事实已覆盖**。
- `RELATED_FINALIZATION_ONLY`：只有相同 finalization，没有精确来源映射，只能写“同场相关”，不加入覆盖成功分子。
- `LEGACY_ONLY`：Legacy 仍保存，但没有可证明的 Durable 对应；不能自动认定提取故障，可能是配额、过滤、无效证据、旧版本缺映射。旧摘要没有独立可验证的 `perspectiveMemoryIds` 时，不能仅靠标题正文行数计算所谓“已确认重要事项数”，应为 `UNKNOWN`。
- `DURABLE_ONLY`：Durable 已保存，但可读 Legacy 不存在对应事项；可能来源是原话/witnessed/独立历史记录，不应偷偷向 Legacy 添加条目。
- `UNVERIFIED`：旧摘要缺 `perspectiveMemoryIds`、来源 hash 失效、跨版本、不完整 provenance 或当前 context 不足；**未知不记零**。
- `FORGOTTEN` / `REVOKED`：只记录匿名撤销数量或当事 Owner 允许看到的状态，不重新暴露已 Forget 正文；`deleted` / tombstone 不得进入有效覆盖。

每条关联必须检查 `ownerId`、`campaignToken`、双方合法读取、`sourceRevision`、`knownBy`、现存 `ForgottenProjection` 和 `entry/bodyHash`；不能跨 Owner 合并，看不到的关联不返回任何正文。可在 snapshot 一致性读取期间计算。**不预先将动态 UI 映射永久持久化为第二份权威**；必要缓存仅按 Index revision + summary source hash + Forget generation，更新或删除立刻失效。

### 4.3 推荐 Coverage DTO（供 Codex 进一步落地，不强制新增 Schema 版本）

```json
{
  "ownerId": 100,
  "campaignToken": "<current-campaign>",
  "indexRevision": 123,
  "finalizationId": "<authorized-id>",
  "durable": {
    "commitState": "COMMITTED",
    "coverageState": "CAPPED",
    "committed": 8,
    "sourceCounts": {
      "authorized": 100,
      "screened": null,
      "planned": null,
      "modelEvaluated": 38,
      "unmodeled": 62
    },
    "sourceCountPrecision": "LEGACY_PARTIAL"
  },
  "legacy": {
    "importantItemCount": 5,
    "provenSourceLinkedCount": 3,
    "sourceRelatedOnlyCount": 1,
    "legacyOnlyCount": 1,
    "unverifiedCount": 0
  },
  "links": [
    {
      "legacyMemoryId": "<valid-id>",
      "relation": "LEGACY_SOURCE_EXACT",
      "durableEntryIds": ["m4_<64hex>"],
      "semanticEquivalence": "NOT_ASSERTED"
    }
  ]
}
```

> 仅是 API 结构示意；字段中的 `100/38/62/5/3` 都是假数据。实现时应支持 `null` / `UNKNOWN` 而非补零，确保链接数不能大于授权的 Legacy 条数，`modelEvaluated` 不大于 `authorized`。若老记录只保存 `evaluatedFragmentCount` 但未保存真实每条筛选/分桶计划，则仅报告其原始计数和旧策略版本。

### 4.4 UI 设计：复用现有 `Memory4Manager`

建议页签收敛为 **`人物认知` / `官方追忆` / `详细长期记忆` / `Legacy 对话摘要`**（四个）；在 `详细长期记忆` 顶部加入只读**“Durable 状态”**小摘要，在 `Legacy 对话摘要` 的现有 `memory4-coverage` 展开区域显示关联：

```text
人物记忆  [人物认知] [官方追忆] [详细长期记忆] [Legacy 对话摘要]

Legacy 对话摘要                    [刷新]
当前人物：角色甲 / 当前战役

  本场 Legacy 重要事项：5 条
  Durable：已提交 8 条        提取状态：达到配额（CAPPED）
  来源：100 个授权片段；38 个经过模型评估；62 个未评估
  Legacy 来源可证实关联：3 / 5
  另有：同源但不确定 1，Legacy 单独保留 1
  注：来源关联不等于两份文字语义等价；未评估并不等于内容丢失。

  [展开来源覆盖详情]
    - 原事项 A    关联来源已验证   [查看 Durable]
    - 原事项 B    同源但语义未验证
    - 原事项 C    仅 Legacy 保留
    - 原事项 D    无可靠来源映射（旧格式）

  [显示对应详细长期记忆]  （只读导航，不触发模型）
```

最低 UI 行为合同：

- 默认只显示当前 Owner + Campaign 的**授权聚合**；用户展开时才加载最多一页关联（建议 20～40 个）。历史归档模式为只读，不能用跨 Campaign 数据“补全缺失”。
- 明确区别 `8/8 已满`、`0 条合法内容`、`请求失败`、`尚在恢复`、`没有证明`、`历史记录未知`；不能只显示一个成功徽标。
- 保持既有 Legacy `getLegacyCoverage()` 的“可重压缩/部分覆盖/保留原文”数据，不与新 `source coverage` 混用。两种覆盖指标必须分别标注。
- `查看 Durable` 复用现有 `getMemory4Entry` / `detail` 视图的验证读取；UI 不直接读取用户 JSON。相关条目已删、手改、切换角色或 Forget 后，应返回过时态并允许刷新，不闪现旧正文。
- 不新增自动“补提取”按钮；V9.3.3 仅显示原因。需要新的人工补提取操作时，先另行制定费用授权、来源校验和防重复提交合同；不能直接复用 `recompressLegacy` 盲目重新花钱。
- 三主题（`parchment`、`knight`、`ink`）排版均适配，小窗、换行、长人名及 1000+ 条目采用分页／虚拟化；没有可用数据时提供明确的说明。
- 不在日志、UI telemetry、匿名覆盖汇总中写入完整私密正文；详细内容仅由授权详情接口按需返回。

### 4.5 UI / IPC 集成方案

首选在 `summaries-manager.js:getMemory4OwnerData` 增加 `coverageSummary`（当前页聚合，不额外读取所有正文），并通过**新的只读 `memory4:getCoverage`** 获取按 finalization/Legacy memory ID 分页的关联明细。`register-ipc.js` 增加请求校验，`preload/preload.js` 暴露受限方法。也可沿用 `getOwnerData` 的分页字段，但无论哪种设计都要：

- 由 Main Process 重新解析 `ownerId/campaignToken/contextId`，拒绝客户端自由选择其他 Owner 私密 Scope；复用 `getMemory4ReadContext`、`assertCurrentMemory4ReadContext`。
- 限制 `offset`、`limit`、`finalizationId` 长度/格式及响应体上限；禁止一次 IPC 发送 1,000 条包含正文的 Durable。
- 使用 `indexRevision` 与 Legacy 来源摘要哈希验证响应；分页时如发生编辑、战役切换、Forget 或索引 revision 变化，返回 STALE，不展示旧快照。
- 原有正常 Provider outbound payload 不因 UI 新字段而发生变化。

## 5. C 包：Year/Life 从代码、UI、磁盘完全退役

### 5.1 清除目标

**终态：** 不再有 Year/Life 专门生成服务、条目浏览 UI、手工编辑接口、`memory4_year/memory4_life` API 请求、合法生产读写 `years/*.json` / `life.json`，不从旧磁盘派生视图召回。用户问“此人一生经历”或“1181 年发生了什么”时，仍应通过 Durable Detail + Legacy 事实检索作答。**保留 `byEventYear`、`byConversationYear`、`byAcquiredYear` 时间索引，因为这些是 Detail 的正常检索轴。**

### 5.2 具体代码清理顺序（不要先删文件）

1. **抽离通用来源权限**：将 `memory4-derived.js:sourceValid` 迁入独立的 `memory4-source-validity.js`（或合适的现有 authority 服务）；使用相同单一实现，更新 `coordinator.inspectCommittedSnapshot`、Legacy coverage、Recall planner 和其他调用。抽离 `isCampaignCurrent`、`requestExtraction/getProviderSnapshot` 配置调用至 Coordinator 原有服务端口，而非继续借用 `derived.options`。以冻结单测保证旧授权语义一致。
2. **保留安全兼容的退役收尾语义**：`finishCommittedDerived()` 原先负责将 `SKIPPED_DERIVED_POLICY` 当成完成并清除已证实 Recovery；替换为直接执行**Canonical commit proof → clearVerifiedRecovery** 的纯流程。旧 `DERIVED_REBUILD_FAILED` 记录只能在 Canonical 已提交且证明有效时清理；无法证明则保留为 `RECOVERY_UNVERIFIED` 或受控人工处理，不能将旧数据全部强制 COMPLETE。
3. **切断读取/召回**：`memory4-recall-planner.js` 不再调用 `derived.selectSlice`；`validateHistory` 遇旧 `year/life` SourceRef 时返回 invalid 并重选 Detail/Legacy，不能继续使用旧缓存字符串。保留 `conversation_year` **运行时临时摘要** 或换成中性 `conversation_period_overview`，因为它是由有效 Detail 即时构造、不是 Year 文件；对应校验移到通用 source authority。`LIFE` 和 `YEAR` **语言查询 granularity 必须保留**，否则“生平/某年”的 Recall 功能会倒退。
4. **去掉 Profile/上下文派生指针**：删除 `yearKeys`、`lifeItemIds`、`rawYears`、`readContext.derived`；角色认知 `detailIds`、Legacy coverage、disclosure、官方追忆等保持；旧期望响应测试按显式接口版本调整。
5. **移除生产 Year/Life 服务**：`memory4-derived.js` 中 Year/Life 生成、压缩、rebuild、list、edit、persist、selectSlice、jobs 等均退出生产构建；如果通用函数被其他模块依赖，则迁移到语义正确的独立模块后删除旧文件。停止 `derived.markDirty`/`forgetEntries` 对 old view 写盘；Memory4 Store 仍正常维护 index、metadata、sourceRevision、Forget 和 tombstone，不允许剥离安全门禁。
6. **摘要/信件流程兼容**：`summaries-manager.js`、`memory4-coordinator.js`、`letter-memory-finalization.js`、`memory-engine.js` 搜索 `derivedGenerationStatus`、`SKIPPED_DERIVED_POLICY`、`rebuildDerived` 等遗留 API；将 completion 判断改为只基于 Narrative / Durable / 已经有证据的 Recovery terminal，**不得使 Durable 失败被误标摘要完整**。历史结果 DTO 若需可读兼容，仅作只读翻译，不保留实际 Year/Life 任务。
7. **删除 Renderer / Preload / IPC**：`memory4-manager.js` 移除 `year` / `life` Tabs、生成/重生成、编辑、冲突、来源按钮和退役告警；`memory4-manager.css` 删除无用专属样式、保留复用于 Detail 的样式；服务端 `mutateMemory4` 不再接受 `updateYear`、`updateLife`、`keepManual`、`rebuild`、`cancelDerived`，`getMemory4Sources` 不再接受 `kind:year/life`；旧 IPC 必须明确安全拒绝或兼容只读错误，不能悄悄接到别的操作。
8. **修改文档和测试**：当前入口 `README.md`、`docs/README_摘要系统.md`、`CHANGELOG.md` 标注 V9.3.3 退役；V8/V9 历史验证文档保持历史快照不回写。静态/真实 UI 页面不得再显示 Year/Life 记忆按钮，英文文案也需检查。生成 `resources/app/out/main` 与 `resources/app/out/renderer` 以后必须做部署一致性校验。

### 5.3 真正删除已有磁盘文件：一次性安全迁移

**这是破坏性操作。用户在本方案中提出彻底清除，但应用执行时仍需对具体用户数据做一次显式确认，以保护已手工编辑的历史条目。**

推荐 `scripts/retire-year-life-v933.js` + 可被 Main Service 调用的作用域限定迁移器（不能仅靠一个 `rm -rf`）：

1. **预检/枚举**：遍历受控的 Memory4 Sidecar 路径；检查真实路径仍在摘要根目录、不得跟随 symlink/junction；逐 Campaign/Owner 识别确切 `years/[1-9][0-9]{0,3}.json`、`life.json`，并逐字节 SHA-256 记录待删数量、大小、是否含 manual_override；原有 `entries` / `index` / `known-entities` / Forget 等只能只读取证。
2. **dry-run 默认**：展示“将删除 X 个人物、Y 份年度 JSON、Z 份人生 JSON，含 W 份手工编辑”，不输出私密正文；对损坏 JSON、权限错误、冲突目录、外部符号链接、未知派生路径应停止、报告，不跳过后宣称全部已清。
3. **明确确认**：单独说明这会删除**历史 Year/Life 手工文字和展示**，不是删除原始 Detail/Legacy；如果有用户专属文字且不见于 Detail/Legacy，删后不可从它们自动还原。允许用户取消升级迁移/暂不执行，但新版本仍绝不能重新加载旧派生数据。
4. **可恢复事务**：与现有 summary-mutation journal/锁协调，冻结相关 Owner 数据写入，先把原文件内容放入权限受限的**临时事务隔离区**并哈希验证，再删除生产视图文件；迁移中断可恢复原文件。提交完成后按显式清理策略**删除临时 Year/Life 数据副本**，只保留无正文的审计记录（数量、文件哈希/不可逆标识、迁移版本、状态）。不要建立长期 Year/Life“隐藏备份”，这与彻底退役目标相冲突。
5. **幂等/多 Scope**：迁移记录使用版本与路径清单摘要；同一 Scope 重启不得误删新数据或二次执行。跨 Campaign 的合法 Sidecar 分别处理；无法解锁或校验的 Scope 标 `INCOMPLETE`，在 UI 显示“历史派生清理未完成”，不能自动回退去读旧数据。
6. **收尾**：精确删除空 `years/` 目录；清掉与 Year/Life 专属的元数据 key/老任务文件仅当证明其不为 Canonical/Recovery 所需，事务性更新 metadata/index hash；不要碰 `memory_recovery` 中仍用于 Durable 恢复的合法 snapshot，也不碰玩家其他备份目录。再次扫描零剩余生产派生文件，核对 Durable、Legacy、disclosure、Forget、Action/Letters 的逐文件哈希或经授权的字段差异。
7. **回滚**：在迁移事务尚未提交并销毁隔离区前可完整回滚；提交并执行彻底删除后，回滚旧程序版本**不能保证恢复已删的 Year/Life**，须在确认文案中直说。若用户需要可长期找回旧手工 Year/Life，应先自行选择离线导出；程序不能偷偷永久保留。

**审计成功标准**：受管的生产数据根目录内没有 `years/*.json` / `life.json`，没有活跃调用其 API 或响应正文；历史 Git 与用户其他外部备份不属于本迁移可删除范围。禁止宣称能够删除 Windows 历史备份、Git 历史和用户自己的拷贝。

## 6. Durable–Legacy UI 指标的判读合同

建议 UI 使用下列四个独立视角，避免“覆盖率”一个词造成误导：

| 面向玩家的名称 | 分子/分母 | 可以断言 | 不能断言 |
|---|---|---|---|
| **Durable 当前保留** | 有效 entry 数 / 本场提交 entry 数 | 仍可检索的条目规模 | NPC 已理解或会记起每项来源 |
| **模型来源评估** | 经模型有效处理的唯一 fragment 数 / 授权来源总数 | 这部分来源进入成功提取叶 | 全部内容都有可用条目 |
| **Legacy 来源关联** | 精确或同源有证据的 Legacy 事项数 / 具备合法来源的 Legacy 事项数 | 可审计的来源对应 | 两份文本逐字/语义等价 |
| **排除与待处理** | 按 NOISE_LIKELY / UNCERTAIN / 未被计划 / 额度未评估 / 校验拒绝分别计数 | 为什么未覆盖 | 低优先级片段不可能有重要内容 |

### 不同状态下 UI 文案要求

- `COMMITTED + FULL_MODEL_EVALUATED`：**“全部计划来源已通过模型评估；已保存 N 条”**，不得保证每个片段都有记忆。
- `COMMITTED + CAPPED`：**“8 条配额已满；仍有 X 个来源片段未经过模型评估，原对话/Legacy 保留”**。
- `NO_DURABLE_CONTENT + 完整评估`：**“本次模型评估后没有符合存储条件的长期事项”**（仍保留 Legacy）；若仅本地规则跳过部分来源，显示 `LOCAL_FILTERED`，不写成模型已确认全文。
- `FAILED / RECOVERY_PENDING / FAILED_MANUAL`：**“Durable 尚未成功写入／等待恢复”**；摘要正常不改变该状态。
- `UNVERIFIED_LEGACY`：**“旧记录没有足够来源证据，无法计算覆盖率”**；不把未知显示为 0%。
- `FORGOTTEN`：已撤销内容不进入当前有效计数；明细不泄露旧文本。

## 7. 施工顺序与 Gate（不准大爆炸式一次修改）

### Phase 0 — 基线与引用冻结

- 锁定 `d397f10` 的发布测试、UI 截图、选取若干真实匿名统计、源/部署哈希；建立 Year/Life 引用台账和待清数据盘点；**只读**，不修改用户数据。
- 验证 V9.3.2 完整 CI 状态，以截图绿色成功为线索，但施工报告应关联实际 final SHA 的 Actions run URL 和结论，不复用旧 SHA 结果。
- 完成统计口径说明与 Golden fixtures，冻结 `memory4-conformance` 来源权限行为。

### Phase 1 — 来源规划与追踪（先可测试，后接生产）

- 加入纯函数 Planner、测试与离线统计，先不改变正式送模型排序；输出 A/B 对照：开头/中段/尾段来源覆盖和预计输入 Token。
- 经 Golden 和安全测试通过再切换实际 `finishOwner` 入口；保存/恢复 checkpoint plan version 与 source digest，保留现有 V9.3.2 发送预算和错误路径。
- 新策略的 commit、CAPPED、NO_DURABLE_CONTENT 与失败状态分开计数；无模型请求或账单变化归因不得臆造。

### Phase 2 — Legacy–Durable Coverage 服务与 UI

- 先实现只读 proof-of-coverage 和 `OwnerCoverageDTO`，在数据层用隐私攻击 fixtures 验证。
- 新增分页只读 IPC / preload；Renderer 增加状态、图例、Legacy 来源关联、跳转 Detail 和错误/空态；测试变更/Forget/角色切换时 stale response 被拒绝。
- **不得**通过 UI 点击读取其他 Owner 的私密 JSON，也不能为了 UI 生成新的模型请求。

### Phase 3 — Year/Life 依赖解耦与删除

- 抽离 `sourceValid`，先确保所有 Detail、Legacy、Recall、Profile、Recovery 测试与旧线等价，再移除 derived 实现。
- 移除 Year/Life UI、IPC、召回来源、旧生成/编辑/文件读写；保留跨年代查询解析和 `conversation_year` 等**无磁盘派生视图**能力。
- 单独做迁移 dry-run、人工确认、故障注入与恢复；只有通过完整保护测试才允许在受控 Scope 执行数据删除。

### Phase 4 — 全量发布与实机验收

- 添加 `test-v9.3.3-evidence-planner.js`、`test-v9.3.3-coverage-proof.js`、`test-v9.3.3-retirement-migration.js`、`test-v9.3.3-recall-without-year-life.js`、`test-v9.3.3-memory-ui.js`、`test-v9.3.3-independent-qa.js`（命名可遵循实际 test manifest）。
- 完整 `node scripts/test-release.js` 连续 PASS；已退役历史纯 Year/Life 生成 tests 分类为 ARCHIVED，混合测试中的安全/Recall/Forget 部分必须迁移保留，不得通过删除失败断言伪造通过率；更新 release group 总数，不沿用“438/438”作为新提交结果。
- `node scripts/verify-runtime-build.js --deployed`，`src/app` / `resources/app/out` 文件 hash parity，启动真实隔离 VOTC.exe 与两档 Profile，三主题 UI 冒烟，Provider/CK3 调用次数为 0 的离线测试。远端 CI 使用最终 SHA 独立证明。
- 需要用户提供新版 CK3 实机：至少一场中长对话、一次 Legacy 摘要、一次 Durable commit、跨会话召回、一个仅寒暄场景、一个晚段重要事件、一个 Owner 晚入场、一次手工编辑与 Forget、一份旧存档升级。实际请求数/Token/费用分别报告，**真实调用先单独授权**。

## 8. 验收门禁（必须逐项满足）

### G1 — 事实质量与筛选

- [ ] 纯寒暄、无后果姿势、重复口头禅不为了凑配额生成 Durable；含事件的复杂句不能因含动作/寒暄被整体丢弃。
- [ ] “听闻/据说/回忆/计划”不提升为游戏事实；事件时间未知不填当前会话日期；否定和承诺条件保留。
- [ ] 使用人工标注的正反 Golden（不少于 40 小例与 10 长会话）给出：高价值事件候选召回率、低价值误入率、晚段事件覆盖、每条提交来源有效率；先建立基线再定阈值。**不承诺 8 条配额可保存超过 8 个互不重叠的重要事实**。
- [ ] 8 条硬限、128 fragment、8192/16384 保守 Token 限额、32 生成上限、一次修正及严格 checkpoint/Forget 回归通过；尤其验证 **未达 8 条但有本地跳过来源** 时，旧 FULL/CAPPED proof 不会被误用。
- [ ] Planner 冷/暖耗时、Token 估算偏差和长会话性能有可对比报告；不能因为新的 CPU 预处理重现 V9.0 首轮卡顿。

### G2 — Provenance、Legacy 与可观测性

- [ ] 相同 exact source 的 Legacy→Durable 可导航；只凭相同 finalization 不计算为事实等价或精确覆盖。
- [ ] 8 条 `CAPPED` 的 UI 明确展示已评估/未评估，旧记录缺项显示 `UNKNOWN`，不会输出错误百分比。
- [ ] Legacy 重要事项和 Durable 条目可以数量不同；无自动双向回填，Legacy 正文不被修改。
- [ ] 更新、删除、Forget、手工覆盖、战役切换、角色退出、UI 并发请求不会泄露过期正文或其他 Owner 资料。
- [ ] 只读归档、旧存档缺 provenance、无合法摘要来源、`NO_DURABLE_CONTENT`、Failure / Pending / CAPPED 均有正确中文文案和分页空态。

### G3 — Year/Life 物理退役

- [ ] Renderer 不存在 Year/Life 页签、按钮、修改/重生成/停止任务、剩余退役提示；三主题完全一致。
- [ ] 生产 Main/Renderer/IPC/Preload 不再有可执行 `memory4_year` / `memory4_life` 请求和视图文件写入；旧请求显式拒绝，不能旁路触发。
- [ ] 迁移 dry-run / confirm / journal rollback / symlink / 断电中断 / 多 Campaign / 已手改记录 / 重复运行安全通过。
- [ ] 用户确认清理后，受管生产 Sidecar 中 `years/*.json` / `life.json` 为零；Durable entries/index、Legacy 摘要、官方追忆、信件、Action、Forget/Recovery 不受误删。
- [ ] `LIFE`、`YEAR` 时间/生平问句依旧从 Detail/Legacy 得到有来源支持的回答；旧 `year/life` SourceRef 不再被读入。
- [ ] `byEventYear`、`byConversationYear`、`byAcquiredYear` 索引仍正常；Year/Life 存储文件删除不影响事件时间精度和历史追溯。

### G4 — 发布质量

- [ ] 所有新增功能与删除边界在 `docs/current/v9/V9_3_3_IMPLEMENTATION_REPORT.md`、`V9_3_3_VERIFICATION_REPORT.md` 中给出实际证据与未完成项。
- [ ] 最终全量本地 release gate、打包 Electron、source/deploy hash、最终 SHA 远端 CI 分别记录 PASS/FAIL/NOT TESTED，不混为一谈。
- [ ] 没有把用户数据、对话正文、凭据、付费原始账本或私有备份提交到 Git。
- [ ] `CHANGELOG`、根 `README`、`docs/README_摘要系统.md`、运行版本号、App/UI 标签完成同步；不回写历史测试数字。
- [ ] 无实机与 Soak 证明前不宣布 Full Freeze。

## 9. 不要实施的“省事方案”

1. **不要**直接改 `MAX_DURABLE_ENTRIES_PER_OWNER` 为 16/32 然后宣称“不会漏记忆”。
2. **不要**靠黑名单正则删除所有带“微笑、点头、拔刀”的片段；含有重大事件的叙事会被误伤。
3. **不要**在模型筛选前让 Legacy 全体参与人可见，从而提高“覆盖率”。知情边界优先于完整性。
4. **不要**将同源或高相似度文本直接等同于事实已转换，也不要把失败状态显示成“0 条重要事项”。
5. **不要**在 UI 中通过扫描原始文件拼接另一套记忆；所有查询必须走 Main 的 Canonical / 只读服务。
6. **不要**只删除 Renderer 两个按钮却保留 Year/Life 后台生成、磁盘读取、旧 IPC 写入。
7. **不要**按文件名递归粗暴删除整个 `memory4` 目录或所有包含 `year/life` 的模块；年份索引和正常历史问题依然重要。
8. **不要**自动对旧的 130 份 CAPPED 批量发起再提取；历史事实回填属于需独立费用和授权的新任务。
9. **不要**将任何成功 Provider STOP 直接当成 Durable commit；必须通过 `Memory4Store` 的 finalization 及索引/正文校验。

## 10. 建议的最终交付清单

- 生产源码与对应 `resources/app/out` 构建资源。
- 全量清债台账：Year/Life 生产引用删除项、保留项及理由、迁移结果（匿名计数）。
- 纯本地 Evidence Planner 和 Golden fixtures，变更前后对比报告。
- Legacy–Durable 来源关联服务及 Memory4Manager UI，所有状态明确区分。
- 一次性 Year/Life 安全清理工具，`--dry-run` 和交互确认/受控执行模式；包含失败回滚测试。
- `V9_3_3_IMPLEMENTATION_REPORT.md`、`V9_3_3_VERIFICATION_REPORT.md` 与最终 SHA、CI URL、打包哈希。
- 清晰的 `NOT TESTED` 列表：真实 CK3、长时间 Soak、真实 Provider、跨机器与用户旧存档（未实际运行不得写 PASS）。

## 11. 提供给 Codex 的执行指令

> 请以本规格为施工合同，先只读核验 `d397f10` 后的 main 是否有新提交；若有差异，列出会影响本规格的变更并先提交实施差异表。按 Phase 0→4 逐关执行，不允许绕过 Gate。优先以最小变更完成全部来源筛选与 Coverage DTO；Year/Life 先解耦权限校验与召回引用，再移除功能和数据。任何删除已有玩家 Year/Life 资料的实际操作须在明确列出精确范围、备份/事务条件、不可恢复后果后取得授权；不得自动调用付费 Provider、清空 Recovery 或批量重提历史 CAPPED。保持 V9.3.2 Durable 数据、Legacy、Forget、Action、Letter、GLM v813 以及正式 CK3 Mod 不变。施工完成后给出：修改文件列表、关键接口差异、测试命令与输出、残余风险、未验收事项、完整本地/远端 CI 与部署哈希；不得自行宣称 Full Freeze。

---

### 参考源码（固定到审查基线）

- [V9.3.2 Durable Coordinator](https://github.com/wsdsb-111/VOCT-NEW/blob/d397f102d4222386e7f5424a340ac6a8cd444f25/src/app/main/memory-system/memory4-coordinator.js)
- [Memory4 Store / Canonical Commit](https://github.com/wsdsb-111/VOCT-NEW/blob/d397f102d4222386e7f5424a340ac6a8cd444f25/src/app/main/memory-system/memory4-store.js)
- [Memory4 Derived / Year-Life Legacy](https://github.com/wsdsb-111/VOCT-NEW/blob/d397f102d4222386e7f5424a340ac6a8cd444f25/src/app/main/memory-system/memory4-derived.js)
- [Perspective Projector](https://github.com/wsdsb-111/VOCT-NEW/blob/d397f102d4222386e7f5424a340ac6a8cd444f25/src/app/main/memory-system/perspective-projector.js)
- [Renderer Memory4 Manager](https://github.com/wsdsb-111/VOCT-NEW/blob/d397f102d4222386e7f5424a340ac6a8cd444f25/src/app/renderer/memory4-manager.js)
- [Memory4 Recall Planner](https://github.com/wsdsb-111/VOCT-NEW/blob/d397f102d4222386e7f5424a340ac6a8cd444f25/src/app/main/memory-system/memory4-recall-planner.js)
- [V9.3.2 Verification Report](https://github.com/wsdsb-111/VOCT-NEW/blob/d397f102d4222386e7f5424a340ac6a8cd444f25/docs/current/v9/V9_3_2_VERIFICATION_REPORT.md)

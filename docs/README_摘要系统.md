# 对话摘要与人物记忆：Memory Engine 4.0（3.0 协议、2.5 存储兼容）

## V8.15.2 年度与人生获知日期归档（2026-10-09）

[本轮审查与修复](v8.15.2-derived-acquisition-hotfix-report.md)：事件日期明确的 Detail 继续按发生年份归档；事件日期未知且有有效获知日期时，按用户确认的获知年份归档并显示“本年获知，事件日期未知”。原始事件日期保持未知，计划不做回退。Year/Life 压缩保留该标注；召回区分 event/acquired/mixed，不能把获知年用于证明未知事件发生在指定窗口。无合格来源时显示原因，原有授权、遗忘、修订及手工覆盖保护保留；4.0 显示、3.0 协议与 2.5 存储保持兼容。隔离按钮验证通过，已有真实记忆重建仍待本轮用户验收。

## V8.15.2 旧信件计时管道退役（2026-10-08）

[本轮报告](v8.15.2-letter-timer-retirement-report.md)：旧 runner、`letters.txt` 主动执行与 stale/close ACK 日期 rearm 停用，原生 DATE 与正式 RunFile/收信回执仍负责投递和归档。关闭旧路线不清理待投递、未知 Effect、恢复任务或摘要；双方归档、逐 Owner 隔离、协议 3.0/存储 2.5 保持。需要完全重启 App/CK3，真实收信摘要与流畅度仍须验收。

## V8.15.2 信件投递后归档热修（2026-10-08）

[本轮报告](v8.15.2-letter-memory-receipt-hotfix-report.md)：新信使用游戏创建宝物后的精准日志回执，逐信件 token、Campaign、双方 ID、日期与到期日共同校验。归档读取发信时保存的姓名/双方关系来源，不要求当前日志仍为原收件人；双方摘要、Detail、Year/Life 保持既有幂等恢复链。普通 ACK 或裸剪贴板不能启动新信归档，摘要失败不重新发信；可核对的回信披露与摘要归档分别处理。旧信件仅在明确实机确认和授权下单封补建，真实模型生成待验收；4.0 显示、3.0 协议与 2.5 存储不升级。

## V8.15.2 实时日期链路修复（2026-10-08）

[本轮报告](v8.15.2-live-date-producer-hotfix-report.md)：正式 init 的日期/日数读取固定字段；持续 DATE 可选日历字段供世界记忆 CURRENT_DATE 使用，信件原数字字段保持。LOAD 前旧日期不沿用，非法非空 live 日期仍拒绝；不按 Gregorian serial 猜测 CK3 totalDays。Mod 使用独立命名子钩子追加，日期推进不撤销信件接受/摘要门禁，不重发未知 Effect。用户确认本次陌生 NPC 没有先前私聊内容，完整隐私/Provider/Soak 仍按各报告边界验收。

## V8.15.2 隐私与信件日期后续修复（2026-10-08）

[后续报告](v8.15.2-privacy-letter-world-memory-followup-report.md)：人物的头衔/控制者字符串别名从唯一已投影角色重建，无源和歧义 fail-closed；远程 Letter 不读取发送方现场地点，正文明确披露的地点与收件人 Self 完整资料保留。信件日期按日志身份及物理 LOAD_SESSION 边界隔离，重复 epoch 不能沿用旧日；Mod runner 不在对话时自毁，自举移至玩家已确定的 after-lobby 入口。待发队列不清空、不盲重发，官方接收确认后才生成摘要。世界记忆保存就地反馈、全名查询/当前玩家选择与各范围 ACL 单列验证，不改人物记忆协议、生命周期或缓存锚点。

## V8.15.2 陌生角色记忆授权防护（2026-10-08）

[排查与修复报告](v8.15.2-stranger-memory-isolation-report.md)：人物范围内部召回同时要求知情索引与原始 `knownBy` 授权，Worldline 个人记忆适配器同样复核。显式转述必须由两份证据均授权的来源角色发起；只写错误索引不能读内容或转授。旧摘要兼容字段按准确玩家/NPC ID 与非空当前 Campaign 过滤，防止同名异人或跨战役加载。正常授权、逐条转述及全球维护查询保留。

非本人 Prompt 资料不再无条件注入 `capitalLocation`，Self 仍完整，原始 GameData 与 Worldline 的 LOCATION 授权不变，不把首都等同于当前行踪。现有动态身份知识提示明确私聊/信件不会自动成为全球传闻，`public` 不自动授予未听见的陌生人；无来源不能编造传播渠道。事故首轮指纹只匹配 D 自身官方追忆，未证实 ABC 摘要注入或缓存串场。生成层约束与确定性 ACL 分开验证，真实 Provider / CK3 Gate 待用户。不改 4.0 显示、3.0 协议、2.5 存储、IPC、Block IDs、Cache Anchor 或 GLM 配置。

## V8.15.2 摘要日期显示热修（2026-10-07）

[热修报告](v8.15.2-world-memory-summary-date-hotfix-report.md)：每个对话文件的摘要默认按游戏日期降序显示，最近在上；“按日期排序”可切换回原文件顺序，失败摘要重试后刷新沿用所选模式。同日稳定，无日期/非法日期在最后。只排序显示投影，编辑、删除和模型整理传原文件索引；不重排持久化 JSON，不改变召回、遗忘、恢复或 Derived 的合同。世界记忆同期修复后台更新吞掉保存结果的竞态，分支 token 与服务端日期核验保持。

## V8.15.2 修复2（2026-10-07）

[实施报告](v8.15.2-fix2-implementation-report.md)：Future Modal 与 Future Time 在当前谓词之前否决，包含主体前的“明天我是”及将是/将为。合法裸年龄回答允许真实 user/assistant，不改变目标、CK3 数值、听众与 Presence 验证。投影附带仅消息 ID 的 spokenMessageIds，覆盖完整私密注解和已验证 Finalization 来源；与 withheldMessageIds 一起拒绝问答中间的发言或未验证来源，不暴露隐藏正文。系统 trace 及已标注非 spoken 来源不打断，完整自报不依赖 prior question。sourceRevision 纳入 ID 边界；问答双证明、per-owner knownBy、Forget、当前/历史年龄及协议合同保持，不改观察白名单或主架构。

## V8.15.2 修复1（2026-10-07）

[实施报告](v8.15.2-fix1-implementation-report.md)：未来/意图先于当前谓词拥有否决权，即使后台头衔或特质相同也不授权。年龄省主语问答不再要求 Owner 本人提问；听见完整问答且被问者也听见问题的 Owner，可获得唯一目标的 AGE。具名优先，双人无名按唯一另一在场者绑定；多人无可靠被问者归属时 fail-closed，不把 recipientIds 听众集合当作当轮目标。沿用紧邻有效 spoken 消息、问答双证据和 per-owner knownBy；遗忘来源撤销授权，当前 CK3 年龄与历史值/日期分离。未改变 Recall/Forget/Recovery/Derived、Fact Epoch/Presence、42 项白名单、协议 3.0、存储 2.5、App 2.0.4 或 Mod 发布结构。

## V8.15.2（2026-10-07）

[实施报告](v8.15.2-implementation-report.md)：42 项可观察特质在首次 Provider 前由实际在场人物两两观察，持久化为独立 DIRECT_OBSERVATION/VISIBLE_TRAIT，不依赖对白或长期抽取。Self 仍保留完整特质，性格/秘密/模糊健康类别不因同场自动公开。当前观察高于手工未知，离场恢复手工控制；动态特质消失即撤出当前 Profile，历史来源仍保留。观察按日期保留真实证明，回退不读未来来源；对白遗忘不删除独立观察。新变化清理对应冻结/前缀快照，未变化保持缓存。其他对白新知情的下一场生效、Fact Epoch、Presence、Owner/Campaign、协议 3.0/存储 2.5 和 App 2.0.4 保持。年龄问答省主语与比较后缀漏记已修复；年龄合法披露后，为对应 Owner 授权当前 CK3 真实年龄的 UI/Prompt 投射，数据刷新自动更新，但不改历史披露或生成新公开记录。未授权、来源已撤销、未来证明及只读归档均不提供实时年龄，Self 不受此门禁限制。

## V8.15.1（2026-10-06）

[实施报告](v8.15.1-implementation-report.md)：姓名继续作为角色绑定标识，由 Prompt 限制陌生人的身份认知，不新增 NAME 披露类型。当前身份使用现有 TITLE 的主要头衔、等级和职位候选，特质使用 TRAIT，年龄沿用披露时 AGE 与获知日期。保存真实 sourceRole，区分玩家原话、NPC 可绑定直接对白及严格第一人称肯定自报；他人直接公开也可记录，旁白/内心/传闻/否认/歧义与不在场片段不授权。已验证披露在叙事提交、遗忘过滤和来源校验后持久保存，不依赖长期抽取成功；新知情仍下一场生效，手工隐藏、Fact Epoch 与删除撤销保持优先。

叙事 Recovery 保留到逐 Owner 的可验证终态或持久任务交接，提交过的 Detail 不重新抽取，dirty Year/Life 完成或保留可重试任务后才清理恢复材料。canonical-only 与 Legacy 目录共用 Store 解析合同；详情响应绑定列表请求世代，刷新后不接纳旧正文/错误。未知事件日期不借交谈日期补年，旧正文不自动改写。完全离线且无可信会话/Campaign 时的独立档案浏览仍未新增。显示 4.0、协议 3.0、存储 2.5、App 2.0.4、Prompt Block IDs、Cache Anchor 与 Owner/Campaign 授权保持兼容。

## V8.15 修复1.1（2026-10-06）

[小修报告](v8.15-fix1.1-implementation-report.md)：没有 `legacyParentId` 的完整 Narrative 在命中显式目标时，可替换非目标 overview；已命中目标的 Derived/Legacy 不被另一个目标强制覆盖。无显式目标与普通 Legacy 保持原行为；超长正文仍走已有 excerpt，Packet ≤1200，协议/存储、授权、持久遗忘、Orphan 与缓存合同不变。真实 L5-L9、Provider/Soak 仍待用户验收。

## V8.15 修复1（2026-10-06）

[实施报告](v8.15-fix1-implementation-report.md)：显式人物优先级延续至 Canonical/Legacy/Derived 的最终选择与预算裁剪，必要时只替换最低分非目标 Detail；清除无关预算后再次尝试超长目标 Legacy 片段。Detail 数量、1200 token 上限及无显式目标行为保持。

持久遗忘不确定时返回 `MEMORY4_FORGET_INCOMPLETE` 并回滚；运行时计算的 folder-summary ID 不证明持久来源。只有明确 Campaign/Owner/人物对、无来源引用、合法 sidecar 均不存在且无相关 Recovery 时允许 `SKIPPED_SAFE_NO_FOOTPRINT`。旧残留只读审计返回 ID、来源和状态，不返回正文；来源不明、正在生成、共享正文无法分离或可见映射不确定均为 UNKNOWN。必须重新审计并核对 token、逐条明确确认后才复用既有遗忘链路；归档审计不绕过当前写门禁，没有自动启动清理。Owner/Campaign、知情、时间、协议和冻结前缀合同不放宽。

## V8.15 召回与删除一致性（2026-10-06）

[实施报告](v8.15-memory-recall-forget-implementation-report.md)：明确查询人物时独立传递 `explicitTargetEntityIds`，不因其已在 `activeParticipantIds` 中而排除。搜索回应者自己的全部人物摘要，不读取目标的私人目录；Entity/Topic/Lexical 命中任一可建立候选，唯一完整姓名优先于相邻歧义称号。泛问不自动把所有在场者变成检索目标，Owner/Campaign/knownBy/未来日期门禁不放宽。

摘要编辑/删除按稳定 `projectionId` 在 Campaign/Owner 的 `forgotten-projections.json` 持久记录，与现有多文件 mutation journal 一同提交或回滚；联动 Base、Canonical、Year/Life 正文、Disclosure、Recovery 和实际 Frozen Prefix。多人同 finalization 的各人物对分别遗忘，共享来源仍保留未删除人物对的真实证据；信件也以可信来源定位并阻止迟到归档复活。无法精确映射的相关旧证据拒绝修改，不整场猜测删除，也不宣称已成功。

部分迁移、未知标题、缺失来源及过时哈希不 suppress 整篇 Legacy；超长摘要可召回相关中段，旧承诺仅证明历史，不单独证明当前有效。摘要 mutation 清理冻结记忆前缀，普通召回继续保持其稳定；当前消息、滚动摘要和角色快照不自动删除，冻结披露只撤销旧授权，不添加本场新知情。新增有限 ID/计数诊断，不增加完整正文日志。显示 4.0、协议 `engineVersion: 3.0`、摘要 2.5、目录、Prompt Block IDs 和 Cache Anchor 均保持兼容；实机 Gate 待用户。

## V8.14.2 收口修复（2026-10-05）

[实施报告](v8.14.2-closeout-fix-implementation-report.md)：Assistant 第三人披露只采信安全直接对白；唯一昵称可绑定当前 Fact，但不授予真名。Owner/Campaign 的旁路 Fact Epoch 区分同头衔/特质连续存在与消失后再出现，旧 AUTO 与 MANUAL_KNOWN 不跨生命周期，MANUAL_HIDDEN 继续优先。旧无编号记录只在尚未观察到中断的首段兼容迁移；更早/同日冲突恢复快照不回退事实状态。显式刷新和冻结来源传递已接线，普通 getter/归档不写数据，新知情仍下一场生效。完整门禁 367/367、独立 QA、隔离 UI 38 张截图通过；协议 3.0、存储 2.5、Recent2、Recall 与 Cache Anchor 不变，真实 CK3/Provider/cache telemetry/Soak 待用户 Gate。

## V8.14.2 信件与摘要重试（2026-10-05）

[实施报告](v8.14.2-letter-memory-retry-hotfix-report.md)：完整信件交换仅在可信游戏接受后归档，以冻结来源生成双向 Legacy 与逐 Owner Detail，再重建 Year/Life；失败只补未完成阶段，不重发 Effect。不虚构物理在场或消息 ID；明确时间词由真实 letter ID/正文哈希验证，相对时间使用原信日期。模型整理所选摘要也联动重建；失败进入已有恢复队列，手工版本保留，无长期事实/未知事件日期不补造。结束对话的可信 read snapshot 可用于恢复与来源证明重建，不开放任意归档写入。协议、存储与召回兼容合同未升级，下方为既有阶段记录。

## V8.14.2 姓名、关系与披露热修（2026-10-05）

[热修报告](v8.14.2-entity-naming-disclosure-hotfix-report.md)：长期抽取接入现有关系回读及来源姓名，按 Owner/Campaign/片段/日期限定；Owner 是记忆持有人，不是“主人”。明确原话中的唯一姓名或已确认直接关系可帮助归档区分人物，同名、泛称和未知真名不猜测。当前关系不制造历史关系变化，恢复沿用原始关系快照。用户已确认长期记忆正常生成 PASS；本次新姓名及披露规则仍待实机复测，旧错误正文不自动重写。

原生 Finalization 的 `finalization_source_paragraph` 保留可重验原话，不要求摘要整段逐字复述；已有 annotation、私语/小组边界与消息 0 保留。没有 native flag 的旧未标注消息不扩权，伪造摘要和 assistant 第三人称旁白不自动披露。`AGE` 只记录与当时 CK3 年龄相符的本人当前年龄明示，人物认知展示“披露时年龄 + 获知日期”，始终 `current:false`，以后变龄不重算，不开放手工当前年龄按钮。头衔/特质当前事实校验、手动覆盖、归档只读和信件 Gate 继续保留。

内部抽取 `entityNames`/`relationships` 与原话证据纳入 source revision；不改变显示 4.0、协议 3.0、存储 2.5、IPC、Recent2、Recall 顺序、Cache Anchor 或 Prompt Block ID。当前本地完整发布 359/359、独立 QA 14/14、隔离 UI 38 张截图通过；下方各阶段数字和“摘要逐字”限制为历史快照，最新原话桥接以上述合同为准。

## V8.14.2 摘要编辑与长期抽取事故热修（2026-10-04）

[热修报告](v8.14.2-summary-memory-incident-hotfix-report.md)：普通 Legacy 摘要的手工编辑/删除不要求活动对话，也不受 Memory4 归档只读包装限制；Official 保护及 Memory4 的活动 Owner/Campaign/revision 写入门禁保留。下方历史“只读页禁止修改”范围应理解为 Memory4 操作，不再延伸至普通 Legacy 内容。

长期抽取以引用片段的 `knownBy` 证明 Owner 知情后，允许该 Owner 成为相关实体；`allowedEntityIds` 与出席 `participantIds` 分开，不向其他在场者授予未知实体信息。所有候选因实体引用非法被拒且没有其他有效结果时，记录抽取失败并保留恢复快照；真实空结果仍正常保留 Legacy。旧误记空归档不自动回填；有有效 Detail 才派生年度/人生。显示 4.0、协议 3.0、存储 2.5 及冻结/召回合同不变，真实 Provider 生成率待用户复测。

## V8.14.2 Owner-scoped Disclosure（本地回归与 UI 通过；实机 Gate 待验收）

[实施报告](v8.14.2-owner-scoped-disclosure-implementation-report.md)将明确说出的当前头衔/特质作为 Owner × Campaign × Entity × Fact 范围的 Known Entity evidence。扫描只读取经过可见性与来源校验的 spoken fragments，限于当前结构化事实候选；不确定、否定、假设、传闻或歧义绑定均拒绝。手动已知/未知使用 revision 与 tombstone 管理，当前 Profile 仍从 CK3 GameData 校验事实是否存在。Nickname 默认可见，姓名继续走身份识别。

披露在本场 Finalization 后对下一场生效。收到的游戏原信 payload 通过校验后、回复生成前记录为玩家 → 收件 NPC 的 recipient-only 事实；NPC 回信仅在 CK3 `LETTER_ACCEPTED` effect 已写、接受回调清理载体并复核原 payload 后写给玩家 Owner。用户已确认 V8.14.1 完整信件往返实机 PASS；该确认不改写历史报告形成时的 `NOT TESTED`。完整发布 `352/352`、Letter 专项 `7/7`、独立 adversarial QA `31 PASS/0 FAIL`；隔离 UI Smoke `34` 张截图、startup smoke `36/36` 通过。Disclosure CK3/Provider、cache telemetry 与 Soak 仍待用户实测。

Memory Engine 4.0 是当前可见标签，不升级 `engineVersion: 3.0` 或摘要 2.5 存储，也不改 Recent2、Recall 顺序、Cache Anchor、Prompt Block ID 或 GLM 静态布局。V8.14.2 尚不满足 Acceptance 或 Full Freeze。

## V8.14.1 前端显示同步（2026-10-04）

[前端内容同步报告](v8.14.1-frontend-content-update-implementation-report.md)区分当前 Memory4 可见名称、协议 `engineVersion: 3.0`、旧摘要 2.5 兼容及 App 包版本。摘要/优化/世界书展示现行分层、Recent2、动态召回与归档只读说明；没有改召回顺序、Prompt 块或持久键。信件实机验收与 GLM V8.14.2 延期状态保留，既有旧版本报告不回写为新测试结果。

## V8.14.1 归档读取热修（2026-10-04，本地通过，新热修实机待验收）

[事故热修报告](v8.14.1-runtime-incident-hotfix-report.md)记录已保存人物认知被活动对话角色表错误拦截的问题。读取与写入上下文已分开：真实结束对话前只保留最小 Owner 标签、Campaign、规范日期与 Context 快照；活动 getter 仍清空。明确战役内的既有侧车经 Owner、索引、metadata 哈希及 revision 核验后可只读查看，不从其他战役回退；新对话优先，非法新上下文结束时清除旧快照。归档认知按已加载日期与来源版本过滤，不宣称当前 CK3 人物状态。

只读页保留导航、刷新与来源查看，禁止编辑、删除、绑定、重压缩及派生重建；服务端继续要求活动上下文与预期版本。没有长期内容的抽取不会强制生成 Detail/Year/Life，Official 必须来自 CK3 导出。实际结束对话与跨战役等独立回归 10/10，完整发布门禁 346/346；415 个分类测试文件、68 个历史归档。用户确认首次身份边界与本次特质展示 PASS，信件 NOT TESTED；Provider 生成和新热修待实机复测。

## V8.14.1 Trait 知识通道与 Memory4 边界（本地回归，实机待验收）

Trait Profile 只改变每请求 Prompt 投影，不修改 CK3 `character.traits` 原值，也不更改 Memory Engine 可见版本、2.5 存储字段、人物目录、Recall 顺序、Cache Anchor 或 Prompt Block ID。回应者的 Self Profile 保留自身全部 Trait；Observed Profile 只允许 V1 明确列入的 CK3 Trait ID 与本地化可观察标签。性格、生活方式、活动、统兵、压力应对等私密类别以及未知 Mod Trait 均不经人物描写向观察者公开。

Known Profile 只能以当前 Owner、Campaign、实体、游戏日期、获得日期、`knownBy`、可见性、来源类型、认知状态和可校验源引用共同授权某个具体 Trait。原文须有具名目标的正向 Trait 断言；否定、假设、未来、谣言、转述、自称、引用和玩笑不会解锁隐藏 Trait，但原记忆正文仍保留正常 Recall。收件信件同样只读取收信者自己的合规知识范围，不把发件方私人摘要或原始记忆移交给收信者。

Known Entity 中来源不完整的旧记录显式保留 `legacy_partial`，不会误判为“从未认识”，也不丢弃已有识别次数；完整 Presence/Visibility/Finalization 证据仍可标为 `complete`。

Trait Routing 14 项、身份知识 13 项、Memory closeout 18 项及承诺绑定修复后的 production pipeline 16 PASS / 0 FAIL（独立 QA 确认）。旧信件 fixture 已由 `scripts/letter-pipeline-test-helper.js` 按真实 PromptBuilder 调用适配，payload-race PASS；完整 `test-release.js` 344/344 发布组通过。真实 CK3 / Provider、Mod Trait 可观察证据、完整信件流程与 Soak 仍待验收；GLM 缓存 A/B 已延期至 V8.14.2。详见 [V8.14.1 改进与收口报告](v8.14.1-improvement-closeout-implementation-report.md)。

## V8.14-D/E 派生与管理（本地发布与独立 QA/UI 通过，实机待验收）

[D/E 施工记录](v8.14-de-year-life-management-implementation-report.md)说明 Year/Life 的来源版本、dirty/revision、异步重建、取消和 `manual_override` 保护，以及人物认知、Official、Life、Year、Detail、Legacy 分层管理。派生视图可重建，不能替代 Canonical Detail；dirty 或来源失效的片段不进入有效召回，手工保留不会把旧来源重新标为有效。编辑/删除需要当前 Campaign/Owner 和 expected revision，旧页面不能覆盖新版本；Legacy 重压缩按单篇来源核验，原摘要保留，不强制全量迁移。

本轮同时增加动态玩家身份知情边界：后台标签不等于 NPC 已知身份；同场、刚开始交谈与高好感不授予姓名或头衔。明确当前关系、实际血亲、本角色获准记忆、公开事实及正文介绍仍可提供具体知识；介绍一项身份不解锁整包玩家资料。身份专项 13 项、D 专项 17 项、E 管理专项、独立 QA 37 项以及三主题/窄窗口 27 张隔离打包截图通过。完整发布 **339/339** 组、408 分类文件、68 历史归档；真实 CK3/Provider/Cache/Soak 与 Bulk Binding 存档提交仍待验收。

Memory Engine 3.0 可见标签、2.5 存储兼容、Recent2、官方追忆、C 的多实体共用 2+1/整包预算与 V8.13 Cache Anchor 保持原合同。以下 C 与旧阶段记录保留原施工时点及证据范围。

## V8.14-C 正式动态召回（本地实现，独立及实机 Gate 待验收）

2026-10-03 用户确认 A/B 收口并进入 C。[进度与施工报告](v8.14-c-recall-planner-implementation-report.md)记录正式 Memory4/Legacy 动态读取接线：四种 Axis、六种 Granularity；所有实体共用 Overview≤1、Detail≤2（LIFE 代表细节≤1，精确日期无概览），整包包含来源/认知说明并受 `min(1200, Memory 剩余额度, Provider 安全余量)` 限制。EVENT 不借用对话日期，明确年份不补错年，第三人只读回应者自己的知情空间。

冻结 Recent2、官方追忆与缓存锚点不变。成功回复并验证实际动态 block/ID/token 后提交 responder-private 历史、Seen 和最多三轮的同实体/话题/事件链 Focus；失败不提交。压缩移出、来源变更、Campaign 切换或时间倒退撤销旧块。Legacy 只有能重验完整独立来源事实时才拆分/抑制，未知边界不猜测。Year/Life 生成仍属于 D，不在本轮强制迁移旧摘要。运行时版本常量与现有可见标签未更改，下方为前置阶段合同。

V8.12 Part 3 将可见标签及 `MEMORY_ENGINE_VERSION` 更新为 3.0；底层 `schemaVersion: 2`、2.5 人物目录、字段和写入合同保持兼容，不迁移用户摘要。系统仍以人物摘要文件夹作为玩家可见、可搜索、可编辑的长期记忆层。旧 2.3/2.4/2.5 摘要继续读取。V8.6.2 的 2.6 可见标签属于下述历史阶段。

2026-09-24，用户明确确认 **V8.12 Part 3 实机 Gates 验收通过（用户报告）**，并授权 V8.12.1 实施。未回填逐项实测指标，既有自动化与隔离冒烟仍保持原证据范围；该确认不代表 V8.12.1 已验收或全局 V8 Full Freeze。详见 [Part 3 验收记录](v8.12-part3-memory-engine-3.0-implementation-report.md)。

## V8.13 会话级 Prompt 缓存布局（本地发布组通过，实机待验收）

- 所有 Chat Provider 共用 `v813` 布局与 `VOTC_CACHE_ANCHOR_v8.13`。稳定规则和本场日期／身份先于动态区；回应者的官方追忆、直接记忆、近期摘要及开场世界线视图在其首个实际 Prompt 后冻结，后续轮次仍原文发送以复用前缀缓存。不同回应者不共享个人冻结前缀。
- 开场按**已选角色**预取各自世界线，不按当时是否在场筛选；候场角色尚未入场时不获得现场直接观察。开场后已确认 CK3 动作、实时人物状态、在场关系、当前消息、时间／他人召回（含被提及场外人物摘要）与显式历史查询均在动态尾部。冻结世界线代表开场知情背景，不压过经 CK3 回读的新事实。人物摘要文件与 3.0 共享预算、2.5 存储格式和 Extra≤3 不变。真实 Provider 缓存命中率及 CK3 对话行为待实机验证。

## V8.13.2.1 Acceptance Hotfix（321/321 本地发布组通过，实机待验收）

- MEMORY_RECALL 的 Direct Conversation 保底使用实际提问者 `querySpeakerId`；仅在其缺失/无效时，才回退到其他直接对话对象。其余多人 NPC 仍可作为候选，但不再抢玩家提问对应的保底位。
- 旧摘要默认保持 Campaign unresolved/fail-closed。摘要管理器每篇显示独立的“绑定当前战役”操作，二次确认后由主进程验证当前加载 Campaign、Owner/Counterpart 均在场景角色集合、摘要仍未绑定且目标键未过期；只修改用户选择项，已有 Campaign 与同文件其他记录不动。元数据继续处于动态数据侧，不进入 Stable Prefix。
- Retrieval 使用原始摘要目录快照，Memory Engine 内部统一按 Campaign 过滤并统计 Accepted/Rejected/Legacy Rejected；Mention Profile 与候选发现仍用 scoped 视图，不扩大跨战役可见范围。新的终局 Episode 提交会清理对应人物的“已尝试迁移”标记并失效摘要缓存，使恢复证据可在同进程重试。
- Coverage Patch 增加 `patchCandidateCount`、`patchSelectedCount`、`patchTruncated`。只要获准候选因 16 条/Token 预算而被裁剪，动态 Header 即声明“仅为部分获准事实，不代表完整列表”；任何无获准事实或未选入的情形都不推断事实不存在。Patch 上限与冻结前缀不变。
- 保持 Memory Engine 3.0 / schemaVersion 2、Recent2、Extra≤3、官方追忆、V8.13 Cache Anchor 和 Provider Prompt Block Ordering。CK3/Provider Gate 与真实缓存命中率仍待实机。

## V8.13.2 时间召回与冻结覆盖收口（320/320 本地发布组通过，实机待验收）

- 新建摘要保留原生 Campaign Token；缺失 Token 时显式标记 `campaignBinding.status=unresolved`。旧摘要仅在同一 `finalizationId`、Owner/Counterpart 参与证据以及唯一非空 Episode Campaign 同时匹配时迁移绑定，标记来源 `migration`；证据缺失或有冲突时维持 null/unresolved，不能跨入已知 Campaign。此迁移不改 Memory Engine 3.0 / `schemaVersion: 2` 存储合同。
- “记得/记不记得/回忆/想起/印象”等无明确事件/对话轴的时间问句使用 `MEMORY_RECALL`，Conversation-Time 与 Event-Time 在目标时间窗内共同竞争；有目标年份的当前 Direct Counterpart 对话摘要时，优先保留至少一篇。明确战争等事件仍为 EVENT，明确“我们聊过”仍为 CONVERSATION；Exact-Time miss 不由其他年份 Topic/Important 摘要补位。
- 每轮 Recall 诊断记录解析轴与目标年份、Owner/Direct Counterpart、目录和 Campaign 接受/拒绝数、双时间候选/命中、Budget/Seen 抑制及选中的摘要 ID；只记录时间表达片段，不记录完整玩家问题。Broad WAR 与 WORLD_EVENT 只有 Lane 完整时才能由冻结 Manifest 命中；人物概况必须覆盖 IDENTITY、ALIVE、PRIMARY_TITLE，合法 `false`/`0` 事实仍计入覆盖。Coverage Patch Cache Revision 包含游戏资料版本、Checkpoint、Campaign、在场人物、场景/地点与已确认动作指纹；Patch 语义明确允许包含本轮直接观察。
- 所有 Temporal Extra 与 Coverage Patch 继续放在 V8.13 冻结缓存边界之后；不改变冻结 Prefix、Recent2、官方追忆、Extra≤3 或 GLM/Provider 稳定块布局。自动化通过不等于真实 CK3/Provider Gate 或缓存收益验收。

## V8.12.1 双时间记忆合同（自动 Gate 通过，实机待验收）

- 在 `schemaVersion: 2` 下增量增加摘要对象顶层 `temporalRefs`，从原始消息的 `messageIds` 确定性解析时间表达，按 Owner 可见 Segment 投影后映射到内部 `memory.provenance.temporalRefs`；区分对话记录日期与被谈及事件日期，不改写既有 `summary.date`，旧摘要缺少新字段仍兼容读取。
- 相对时间查询继续以本场 CK3 当前游戏日期为锚点；双时间召回应区分“何时谈过”和“事件何时发生”，不能借用电脑时间或冻结摘要日期推算当前日期。时间引用仅随有权知情的 Owner 投影传递，保持 Campaign 隔离，不因同名或相同人物 ID 跨战役召回。
- Event Time 与 Conversation Time 双索引依时间意图选择目标；精确时间查询只允许目标窗口命中的摘要进入 **Extra ≤3**，多轮时间焦点在成功回复后才提交。既有预算及动态尾部、Recent2 冻结、GLM Stable Prefix、Prompt Block ID 与 Cache Anchor 保持不变。314/314 自动发布组通过；真实 CK3/Provider 与缓存命中待验收，详见 [V8.12.1 实施记录](v8.12.1-dual-temporal-memory-implementation-report.md)。

## V8.12 Part 3 已验收基线召回合同

- 直接关系最近两篇摘要按 `owner × counterpart` 在会话内冻结，与该 NPC 的一篇官方追忆、内部稳定记忆共用 Memory Engine 预算。多人会话保留每条直接关系的两篇候选，在总预算内分配；不同在场投影不能被同一终局的旁人投影替代。Temporal、场外人物、Topic、Important 从回应者自己的目录选择，共享 **Extra ≤3**，与冻结摘要去重，位于用户消息后的动态尾部。
- Extra 只有请求成功且实际进入 Prompt 才标记已使用，并保存在该 NPC 对应回复之前的私有 Prompt 历史位置。后续不作为新召回重复添加；不写入可见聊天正文或终局摘要来源，不向其他 NPC 共享。历史压缩/删除移除该位置后允许再次召回；摘要编辑/遗忘会清除旧副本。请求失败可重试。时间检索以本场 CK3 当前游戏日期为锚点；`totalDays` 可用时仅辅助对齐时间轴，缺失时仍可按游戏历日期检索。
- 明确年份/日期查询（如“五年前”）只允许该时间窗命中的直接关系或被提及场外人物的 Owner 目录摘要占用动态 Extra；不以 Topic/Important 的近年摘要补足空位。“五年前”按当前游戏年份减五，查询该目标游戏历年的 1 月 1 日至 12 月 31 日，不再采用 `5×365 天 ± 半年`；同日更新的摘要目录也会刷新时间索引。冻结的最近两篇与官方追忆仍保留以维护缓存，但不提供时间计算基准；动态尾部显示当前游戏日期与目标年份，无可引用摘要时不准拿其他年份代答。索引优先使用摘要落盘时由游戏提供的对话日期，不解析模型正文；摘要中转述的更早事件不会自动按事件日重建索引。
- 主预算按本场首次生成时的实际在场人数（包含玩家）冻结：二人 **10% / 上限 3600 Token**，三人 **12.5% / 上限 4500**，四人及以上 **15% / 上限 5400**；取上下文比例与绝对上限的较小值。中途入离场不重算，本场所有回应者使用同一额度，各自只读取自己的记忆。冻结通道最多使用 65%，活跃直接关系/内部稳定通道按 55:15 分配；直接关系通道内官方追忆最多占三分之一，没有近期摘要时可使用该通道全部额度。未用额度回流给动态 Extra；所有入选内容合计受主预算约束，完整请求另受 Provider 输入/输出预留和安全余量校验。
- 摘要分块上限统一为 **64 块**，而不是旧阶段的 12 或前置工程一度实现的 512；Provider 单次输出预算和失败恢复仍是独立限制。关闭 `v812MemoryEngine3Enabled` 可回退旧召回路由，不删除 3.0 所读的存储数据。
- 每场新对话读取 CK3 原生 `log_memories` 导出的本地化追忆，在对应 NPC 目录覆盖同一份 `官方追忆摘要.json`；在摘要页可查看、编辑、删除，不显示生成时间，正文保留事件日期。无需剪贴板操作或模型生成；模组原生描述也可接入。存储继续采用 schemaVersion 2 的摘要数组，标记 `CK3_OFFICIAL_RECOLLECTION`，以 Owner ID、战役和捕获会话校验。完整文本落盘，Prompt 副本按完整事件裁剪；下场对话重新覆盖，当前场冻结。原存档解析保留为只读 Shadow 诊断（默认 800 / 上限 1000 Token），不再独立注入或额外计费。详见 [Part 3 施工记录](v8.12-part3-memory-engine-3.0-implementation-report.md)。
- GLM 稳定块仍随请求发送相同内容，以复用缓存；“冻结”不表示无状态接口能自行记住未发送的内容。原有块 ID 与稳定前缀/动态尾部分界保留。Part 3 实机 Gate 已按用户确认记录通过，但未回填真实 `cached_tokens` 指标，不据此承诺具体缓存命中率。

## V8.12 Part 3 前置：对话上下文与摘要可靠性（待实机 Gate）

本节标题与下列待验收表述保留前置施工时点。前置验收后续已由用户确认，Part 3 本体验收另于 2026-09-24 获用户确认；均不将本节自动化证据重新分类为实机证据。

- GLM Chat 不再固定只送最近 12 条。活动历史按原顺序追加；只有按当前 Chat Provider 的上下文、单次输出预留和安全余量计算出压力时才压缩旧消息。每次保留至少最近 6 条原文，并记录压缩后的 cache epoch。既有 Prompt Block ID、Stable Prefix、动态 Worldline/Memory 尾部位置未改。
- Chat、Summary 分别读取所选 Provider/模型能力；元数据不可用时使用保守回退并在实际发请求前校验输入预算。最终摘要根据源消息、参与者及在场窗口估计单次输出需求，仍尊重摘要设置中的单次最大输出 Token；整场超限则先按 Presence 边界和 Token 预算分块，不再先发一次注定不安全的整场请求。分块保留原 `messageId`，过滤无关参与者，完成块写入 recovery checkpoint；续跑复用已完成块，合并后继续原有结构化/来源/在场质量门禁。余额不足、截断、上下文超限和暂时错误采用不同处理。
- 多人滚动摘要按在场签名保存 Segment，回应者仅看到自己在场时的 Segment 与剩余原文；临时离开期间的内容不因压缩而泄露。流式和非流式 NPC 回复均检查最终 `finish_reason`；`length` 的部分文本在续写完成前不提交、不可触发 Action、不可进入历史或摘要。续写仍不完整则显示失败，不把半句当成完成回复。
- 新增 `test-v8.12-context-summary-reliability.js`，连同摘要事故恢复、Memory 回归与 GLM Cache 回归做自动验证。此项为 Part 3 前置可靠性工程，**不等于 Memory Engine 3.0 正式发布**；可见 2.6 标签和底层 2.5 存储/人物目录合同均不变。真实 GLM 30–50 轮、多人 50+ 轮、100+ 消息终局摘要、低输出模型、截断回复及缓存/TTFT 仍需实机验证，尚未签发前置 Gate PASS。

## Memory Engine 2.6 历史召回说明（兼容 2.5 合同）

- Session Topic Anchor 只在每名回应者首次命中时选取 Top1，随后整场冻结并放在历史前稳定区，不因后续问题重新排序。
- Turn Recall 以当前用户消息为主查询，最近 1–2 条仅提供辅助信号；明确回忆意图或明确人物指向、且主查询相关度达到阈值后才触发。
- Turn Recall 每轮最多 Top1，默认 256 Token、硬上限 320 Token；同一回合、回应者和查询指纹复用结果，避免重复检索。
- Turn Recall 位于当前用户消息之后、最终回复指令之前。它只能读取当前回应角色自己的目录和内部 `knownBy` 记录；当前 CK3 数据表示现在，摘要表示过去，冲突时不得用旧摘要覆盖当前游戏事实。
- Prompt 距上下文上限不足 192 Token 时跳过 Turn Recall，并写入 `memory_recall` 诊断，不挤占核心人物资料与当前历史。

## 存储结构

### V8.12 第一部分 Pair 隔离与 Episode 清理

Legacy fallback 必须同时匹配 Finalization、Owner 知情和 Counterpart 主题相关性；同一多人终局的另一配对不受影响。没有明确 projection Segment IDs 时，Segment 也须能证明 Pair 相关性；多人且元数据不足时失败关闭。删除/编辑后清理不存在的 Memory ID 和 `knownBy=[]` 的无用 Segment；活动 Finalization、Recovery、明确 Audit/Recovery 保留标记不清理。继续使用既有日志事务和 2.6 可见标签 / 2.5 存储合同，详见 [V8.12 第一部分实施报告](v8.12-part1-implementation-report.md)。

### V8.11.1 编辑与遗忘一致性

摘要编辑同步重建所选 Owner 的 Projection Memory、Episode Segment、Knowledge 和 Consolidation，并清除当前会话 Recall/Character 缓存；以编辑原文形成可召回记录，不调用模型重新推断事实。原共享记忆仍为其他知情者保留，其他配对的正文不自动改写。旧摘要缺少 perspectiveMemoryIds 时尝试通过 finalizationId 与 Episode 精确映射；不能证明映射时报告 `LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE`，不静默删除或扩大失忆范围。

编辑和 UI 删除在受影响文件间使用可回滚日志 `memory/summary-mutation.json`；正常提交删除日志，中断后启动先回滚。正在最终保存或有未提交恢复快照的同一摘要暂不接受修改。全量遗忘清除 `source=memory` 的 owner-status，但保留游戏来源及旧版死亡标记，避免“清记忆”改变角色生死判定。Memory Engine 可见 2.6 / 底层 2.5 合同不变，详见 [V8.11.1 实施记录](v8.11.1-consistency-implementation-report.md)。

```text
%APPDATA%/VOTC/votc_data/
├─ conversation_summaries/
│  ├─ 100_角色A/
│  │  ├─ 与角色B的对话.json
│  │  └─ 与角色C的对话.json
│  └─ 200_角色B/
│     └─ 与角色A的对话.json
├─ memory/
│  ├─ episodes/
│  ├─ characters/
│  ├─ pairs/
│  ├─ knowledge/
│  ├─ owner-status/
│  └─ index.json
└─ memory_recovery/
```

`conversation_summaries` 是玩家在 UI 中管理的正文；`memory` 是系统内部索引，不应手工混入人物摘要目录。

V7.6 集中定义数据契约：当前 Memory/摘要写入版本均为 `schemaVersion: 2`，最低可读取 Memory 版本为 1。版本 1 Memory 在读取时升级为版本 2；没有版本字段的既有人物摘要按版本 1 读取，并在该文件下一次正常写入时补齐版本 2。高于当前版本的文件失败关闭且保持原文件不动，禁止静默猜测或降级覆盖。

## 人物身份与动态称谓

- 数字角色 ID 是唯一身份主键。目录固定使用 `ID_本名`，对话文件固定使用 `与本名的对话.json`；头衔变化不会产生新的角色身份。
- `firstName` 优先作为存储本名；当前 `fullName`、主要头衔、称号、宫廷职位可以写入摘要正文和参与者元数据，但不进入目录名或文件名。
- 人名、完整称号、主要头衔、绰号和官职都可作为提及别名。`陛下`、`皇帝`、`殿下`等派生称谓只绑定当前资料或该目录中最近观察到的唯一持有人。
- 同一别名对应多人、最近观察日期并列或无法确定人物 ID 时失败关闭，不向任何人物注入猜测得到的记忆。
- 场外人物不在当前 CK3 场景资料中时，可以使用回应者本人目录内保存的参与者 ID 与称号完成解析；解析后仍只从回应者自己的目录召回该 ID 的摘要。

## 2.x 历史召回规则（3.0 以上述当前合同为准）

每次 NPC 回应使用直接关系、被提及场外人物和内部稳定记忆三条通道，并为一个可选话题补丁预留少量预算。没有候选的通道不占预算，其额度回流到实际命中的通道。总预算为模型上下文约 8%，下限 800、上限 2400 token。

曾评估的独立 1200 Token 官方追忆额度已由上述共享预算方案替代。`v812OfficialRecollectionPromptEnabled` 保留为旧配置兼容字段，不再决定 3.0 的原生追忆摘要注入。

同一场对话内，内部长期稳定记忆、直接关系最近 3 条与预算内钉住记忆、场外人物首次召回快照均固定内容和顺序。只有结束当前对话并开始新会话时，系统才读取刚生成的最新终局记忆。主题明显变化时允许选择至多 1 条话题补丁，并将其放在历史消息之后、当前用户消息之前，不破坏前缀缓存。

### A 与 B 直接对话

- A 回应时，优先读取 A 自己目录中与 B 最近的 3 条摘要；为更早的钉住记录预留预算（单对象最多额外 1 条，多对象共最多额外 2 条）。
- 多人会话对每条直接关系同样执行最近 3 条基线；条数以可用候选和总预算为限。超长摘要只在召回副本中将 `【需要长期记住的事项】` 前置，再在预算内裁剪；不改写磁盘正文，极长事项列表仍可能超出预算。
- B 回应时，只读取 B 自己目录中的对应内容。
- A 的私人目录不会直接注入 B 的 Prompt，反之亦然。

### 对话中提到 C

- A 回应时，从 A 的目录检索 C 相关摘要。
- B 回应时，从 B 的目录检索 C 相关摘要。
- 相关性同时使用人物 ID、姓名、文件名、participants、摘要正文和当前问题。
- 首次命中时通常锁定最近或最相关的 1 条，预算允许时补充第 2 条；后续轮次不重复排序，避免缓存前缀抖动和人物记忆口径变化。
- 玩家与任一 NPC 的发言都会被扫描。唯一绑定的头衔或称号可以指代人物；同一别名对应多个角色时不猜测；长名覆盖短名；会话只保存处理游标，不保留无限增长的消息 key 数组。

### 多人会话提到 E

ABCD 同时参与并提到 E 时，每个实际回应者分别按自己的目录执行检索。系统不设置参与者或提及人物数量硬上限；为避免 Prompt 无限膨胀，最终入选摘要仍受当前模型上下文的动态 token budget 约束。

信件与对话使用同一个 Engine 2.4 路由。收信人从自己目录读取与发信人的直接摘要，信件正文提到场外人物时，也从收信人自己的目录检索相关摘要。

## 候场、入内与离场窗口

- 创建多人会话时，CK3 当前主要对话对象默认在场，其余已选择 NPC 在首句发送前直接列为候场并显示“请入内”。只有实际入内者才会进入回复队列和终局参与者列表。
- 候场人物不进入回应队列、不读取当前对话记忆，也不写入 `knownBy`；若整场从未入内，则不属于本场摘要参与者。
- “请入内”插入 `【人物入内】` 系统消息，并从该消息 ID 打开人物窗口；入内当轮不热插队回复，从下一轮正常参与。
- “请离场”插入 `【人物离场】` 系统消息，以该消息 ID 关闭人物窗口并立即保存可恢复的原始会话快照。窗口使用 `[joinedAtMessageId, leftAtMessageId)`，所以离场标记本身及后续对话都不会进入离场人物的摘要。人物目录中的正式摘要仍由整场结束时唯一一次结构化摘要请求统一生成；旧的离场散文摘要请求已经停用。
- 同一角色离场后不能在当前会话重新入内；至少保留一名在场 NPC，防止会话进入无回应者状态。角色通过动作脚本自然离席时也会关闭同一人物窗口。
- 每轮提示词中的“当前在场人物”位于历史之后，不改变 history 前的冻结缓存指纹；候场和已离场人物不会出现在当前关系上下文或动作回应候选中。

## 会话结束写入

V8.5.1 摘要事故热修及 V8.12 重试修正：正常成功路径一场一次结构化请求；请求失败最多两次整场调用。整场截断或质量重试失败后，可按实际入离场边界及消息数量分段生成，再合并为同一个 finalization。此处历史版本最多 12 个片段；**Part 3 当前统一上限为 64 块**。各请求仍使用用户设置的输出 Token 上限。所有片段、来源 ID、在场边界与有向投影通过校验后才提交，不保存残缺 JSON。Provider 异常或无效输出最终失败时，仅保留原始消息恢复快照，不生成本地转录式“摘要”，不提交 Episode。自动恢复由下一场对话初始化触发；摘要页“重试失败摘要”不依赖活动 CK3 对话，可越过自动重试上限重新调用当前摘要模型，使用同一精简正文、重点记忆、在场隔离与落盘校验流程。余额不足必须充值或配置可用摘要模型，重试本身不能修复账户状态。手动重试单航班、跳过正在进行的对话和终局，清空记忆后不能复活旧快照；已成功提交或手工编辑的摘要不自动覆盖。底层 2.5 存储合同不变。长会话失败恢复的请求数可能增加，详见 [事故修复报告](v8.5.1-summary-incident-review.md)及 [V8 阶段记录](V8阶段开发记录.md)。

`Source-ID contract v2` 在最终指令中列出当前输入允许的消息和人物 ID，禁止模型按切片重新编号。仅含程序生成入离场标记的片段保留原始标记与准确来源，不要求模型臆造一段对话。此调整仅影响摘要请求，不改变 Chat 的冻结 Prompt 前缀。

Memory Engine 以 participant presence 记录整场会话中实际出现过的人物。一场会话结束后，只发起一次结构化最终摘要请求；本地计算每条记忆的 `knownBy`，再为所有参与者的有向配对文件生成目录所有者视角投影。投影记录 `perspectiveOwnerId`、所引用的记忆 ID 和哈希，写入后还会校验这些字段。

例如 A、B、C 三人参与时会写入：

```text
A/与B的对话.json
B/与A的对话.json
A/与C的对话.json
C/与A的对话.json
B/与C的对话.json
C/与B的对话.json
```

每条记录包含稳定的 `finalizationId`。恢复重试不会重复追加；召回仅合并同一目录、同一 finalizationId 且正文完全相同的配对镜像。正文不同的 `owner × counterpart` 在场/主题投影分别保留，不能用先读到的旁人关系摘要替代双方完整记忆。

## 摘要管理 UI

V8.6.2 状态面板标记 Memory Engine 2.6；人物目录、缓存、来源消息校验、多段在场窗口、最终摘要 Token 设置与底层 2.5 合同保持不变。摘要管理操作仍统一为同一标题栏中的“刷新 / 打开摘要文件夹 / 清除全部摘要”。

暂时离场不会发起中途摘要请求。人物原窗口在暂离系统消息处关闭，返回状态消息处再开启新窗口；缺席区间的原始消息不会进入该人物 Prompt 历史、共享 rolling summary、knownBy 或 `owner → counterpart` 投影。返回提示只让人物知道自己刚才曾昏迷、睡着或暂时离开，不会补发缺席期间内容。Knowledge Service 按人物聚合全部窗口，因此人物对缺席前与返回后都实际见证的来源消息仍可正确知情，但任一来源落在窗口间隙时会失败关闭。

终局 Provider 将完整叙事写为带原始 `messageIds` 的 `summarySegments`，应用本地拼成最终摘要，并按双方共同知情、共同在场的窗口投影到 `owner → counterpart` 文件。场景、在场人物或知情范围变化时必须拆分；角色睡着、昏迷、离场、独处、自言自语、默想或实施未被他人察觉的行动时，相关片段必须使用正确的私密可见性和实际知情人物，不能仅因仍在同一房间就向其泄漏内容。这样详细正文不再只留在内部 episode，也不会被长期记忆索引压缩成一两句话。摘要与单条长期记忆均不设置固定字数或段落数；模型根据原始信息量使用摘要管理页配置的 256–16384 Token Provider 输出预算（默认 4096），并将同一上限用于质量重试和恢复。第四层可信校验会同时检查每个叙事分段和每条长期记忆的来源 ID：ID 必须为真实 history 中严格递增且不重复的整数，且任何显式 `speakerId` 必须是本场参与者；缺失、错报、串场或畸形 ID 会拒绝整个抽取并进入质量重试，连续失败则保留 recovery snapshot，不再静默过滤错误 ID 后提交。摘要必须逐人归属言行、观点与情绪，保留时间地点、数字物件、承诺条件、秘密计划、关系转折和未决事项，不得以“双方讨论了某事”等泛化句替代具体事实。

人物目录只在某角色首次召回时扫描并解析；同一进程内后续读取复用该角色缓存。终局生成、摘要编辑、单条删除、对话文件删除、人物目录删除和全量清理完成后会使相关角色或全部缓存失效，下一次召回才重新读取磁盘。缓存不改变人物所有权、会话冻结快照或新会话边界。

每场终局写入会逐一核验全部有向人物文件都包含相同的 `finalizationId`。2 人会有 2 个文件，N 人会有 `N × (N−1)` 个文件；缺失任一人物目录或对话文件即进入 recovery，不会把不完整保存标记为成功。人物目录是独立所有权边界：在摘要管理页编辑或删除李师师目录中的“与燕青的对话”，不会修改或删除燕青目录中的“与李师师的对话”。

摘要页只保留一套层级：

```text
角色A的人物摘要目录
└─ 与角色B的对话
   ├─ 摘要 1（可编辑/删除）
   └─ 摘要 2（可编辑/删除）
```

搜索姓名或 ID 时：

1. 该人物自己的目录排在最前；
2. 其次显示其他人与该人物的直接对话；
3. 最后显示 participants 或正文中涉及该人物的摘要。

玩家修改摘要时，系统使用原子文件替换；双向镜像优先按 `finalizationId` 更新同一记录，避免数组顺序不同导致改错摘要。

## 失败恢复与边界

- V8.5.1 起，后台恢复不阻塞新会话的激活和入场按钮；同一 Engine 的并发恢复合并为一个任务。恢复使用快照中的参与者、日期与 totalDays，不自动加入当前存档的新玩家。
- 游戏场景关闭指令失败不再中断 Memory Finalization；诊断记录保留 success、error、attempt、durationMs。已耗尽三次自动恢复的记录不被无限重试，可在备份后使用明确指定会话的维护工具恢复。
- Final Summary 请求发出前即保存包含原始消息和参与者的 recovery snapshot；Provider 挂起或进程被强制结束后，下次启动仍可恢复。
- 退出程序最多等待终局队列 15 秒。超时会允许窗口退出，未完成任务依赖预请求快照恢复，不会无限卡住主进程。
- 人物目录写入必须返回明确成功；参与者不足、返回 `undefined` 或写盘失败都会保留恢复快照，不会把终局误报为成功。
- Provider 已返回成功内容后，磁盘重试不会再次请求模型。
- Final Summary 优先预留 Summary Provider 与摘要页设置允许的完整输出 Token 上限；估算输出不能把模型可用 `max_tokens` 截短。仅当输入与完整输出上限无法同时装入上下文时，才缩到上下文可容纳的最大输出预留，并据此决定是否分块。
- 长摘要递归分块对每个已完成子块与拆分决策即时检查点，失败恢复复用已完成子块。手动恢复最新记录优先、最多两场并行；启动时自动恢复仍串行。
- 分块摘要的覆盖率修补对每个缺失分块使用独立检查点；任一至少 8 字符的对话消息漏引时尝试修补。修补仍缺失则剔除失败块、保留其他成功块与失败快照；恢复继续走分块并只重试失败块，不把不完整摘要作为成功结果。此校验不替代真实模型的叙事准确性测试。
- 恢复最多自动尝试三次，且 Memory、Episode 与人物目录写入均依赖稳定 ID 保持幂等。
- 内部 Knowledge Index 决定角色可访问哪些结构化秘密、承诺和事实；人物目录召回始终限定为当前回应角色自己的目录。
- 清理或迁移前请备份 `conversation_summaries`。UI 的“清除全部摘要”不可撤销。

## NPC 死亡生命周期

- `characterIsKilled` 实际写入 CK3 成功后，死亡 NPC 会退出会话，并在 `memory/owner-status` 写入墓碑；历史人物摘要目录不再物理删除。
- 其他人物目录中的 `与死者本名的对话.json` 不删除，它们表示生者对死者的回忆。
- 死亡发生在当前会话中时，终局摘要仍会写入生者拥有的方向，但跳过死者作为目录拥有者的方向；恢复快照保存这一排除集合，重启恢复也不会重新创建死者目录。
- 读档或复活流程可以解除墓碑，恢复该角色作为目录所有者的后续记忆生命周期。

## 验证

从程序目录运行：

```powershell
node scripts\test-v7.1-memory-engine.js
node scripts\test-v7.2-memory-routing.js
node scripts\test-v7.2-sequential-finalization.js
node scripts\test-v7.2.1-stability.js
node scripts\test-v7.3-identity-lifecycle.js
node scripts\test-v7.5-memory-action-retirement.js
node scripts\test-v7.6-architecture-security.js
node scripts\test-v7.6-semantic-golden-set.js
node scripts\test-v7.6.1-directed-summary-persistence.js
node scripts\test-v7.6.1-recovery-race.js
node scripts\test-memory-ui.js
node scripts\test-release.js
node --check resources\app\out\main\main.js
```

自动回归不连接真实 CK3 或摘要 Provider。连续会话、多人长期游玩、Provider 挂起后重启恢复和动作实际写入 CK3 仍需实机验收；代码级 source/target 锁定、死亡目录清理和错误目标拒绝已纳入 V7.3 门禁。

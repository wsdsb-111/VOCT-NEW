# V9.3.7.1 原修复方案（导入留档）

本文件保存用户提供的历史施工提案，不代表已实施结果。V9.3.9 按最新用户要求仅交付代码与自动化验证并上传 GitHub；原方案中的实机、Provider、Soak 和多分支发布步骤由 [V9.3.9 合并计划](V9_3_9_IMPLEMENTATION_PLAN.md) 标明交付边界，不自动执行。

---

# VOCT V9.3.7.1 修复施工文档

-   **目标版本：** V9.3.7.1
-   **基线提交：** `37df16e5763d4764c451268ad96356fa9bfda848`（V9.3.7
    遗留修复）
-   **仓库：** `wsdsb-111/VOCT-NEW`
-   **审查分支：** `tangBranches`；截至本方案编写时，`main` 与
    `tangBranches` 均指向上述提交
-   **文档性质：** 施工方案，不代表代码已修复或验收通过
-   **优先级原则：** 先关闭来源可信度与亲属关系图的
    P1，再修正亲属标签、年龄偏差、人物认知 UI，最后完成完整
    CI、部署和实机验收

------------------------------------------------------------------------

## 0. 版本目标与边界

V9.3.7.1 是 V9.3.7 的修复版本，综合此前代码 Review、最新 CK3
实机反馈和远程 GitHub Actions
失败记录。本版不得只修复单个显示问题，也不得以放宽证据校验换取"看起来能回答"。

### 0.1 本版必须完成

1.  关闭 `currentDirectParentFilter()` 对未知来源父母记录的 fail-open
    路径。
2.  让
    `parents`、`children`、`evidence.relations`、`otherParentRelations`
    等所有亲属图建边入口共用等价的来源与公开性校验，避免绕过 `UNKNOWN`
    拒绝规则。
3.  确认 `UNKNOWN` 的父母与 `otherParent`
    不能进入当前亲属图、家庭事实块或最终 Prompt。
4.  修正继子女识别后被错误表述为亲生父母／亲生子女的问题；亲属身份可以被识别，但不得因此生成错误的生物学亲子边。
5.  排查并修复实机中"当前年龄比 CK3
    实际年龄大一岁"的问题；必须定位偏差第一次出现的层级，不允许对所有年龄统一减一。
6.  恢复「摘要 →
    个人摘要」中的「人物认知」查看功能，至少能够查看可信的已知人物特质、头衔、来源与获知时间。
7.  修复远程 CI 的测试脚本作用域错误，使完整 Release Regression
    能运行到结束。
8.  补齐真实 `createLogParser()`
    旧日志兼容测试、亲属冲突测试、部署一致性测试，并完成真实 CK3 验收。

### 0.2 必须保留的 V9.3.7 成果

-   `resolveCharacterAge()` 作为唯一年龄选择入口。
-   当前年龄来源绑定、`CK3_CURRENT_AGE` / `CK3_LIVE_RELATIVE_AGE`
    的权威来源区分。
-   `otherParentRelations` 等证据参与亲属图缓存指纹与失效判断。
-   Windows 文件原子替换对 `EPERM` / `EACCES` 等情况的有限重试。
-   Owner、Target、Pair、Campaign、来源快照、Forget 与 Source Revision
    的权限边界。
-   Pair 记忆检索的低延迟与缓存收益。
-   未验证的日期推算不作为确定年龄；未知亲属信息不能被补造。
-   旧摘要的授权、时间边界和局部回退规则。

### 0.3 明确禁止

-   禁止对所有年龄结果 `-1`。
-   禁止将 `UNKNOWN`
    当作"确定没有亲属关系"，也禁止将其当作"确定存在亲属关系"。
-   禁止仅因为 A 与 B 结婚，就将 B 连接为 A 子女的亲生父母。
-   禁止将妻子与妾室互相强制建立配偶或其他亲属边。
-   禁止用姓名相同、数组顺序、单纯的提及或缺少来源的记录确认亲属身份。
-   禁止重新启用已经退役的 Durable 自动提取、Year/Life
    生成、后台重建或旧 Memory4 运行时召回。
-   禁止为了恢复人物认知而恢复整个旧 Memory4/Durable 管线。
-   禁止在未确认 CK3 导出器实际生效的情况下，将仓库中的 `.patch`
    文件视为已部署。
-   禁止以"本地测试通过"替代远程 CI、真实 CK3 存档与真实游戏内 Provider
    验收。

------------------------------------------------------------------------

## 1. 当前基线与实机状态

### 1.1 已知代码基线

-   V9.3.7 遗留修复提交：`37df16e5763d4764c451268ad96356fa9bfda848`
-   `main` 与 `tangBranches` 当前远程指向同一提交。
-   该提交已改善年龄来源统一、亲属缓存失效覆盖和文件原子替换重试，但尚未关闭所有亲属来源校验漏洞。
-   仓库中存在
    `docs/current/v9/patches/V9_3_7_RELATIVE_EXPORT.patch`，但
    `VOCT-NEW` 当前 Git 树中只有补丁文档，没有补丁目标
    `common/scripted_effects/log_character_v2_effect.txt`
    的活动源文件。因此，必须核实实际运行的 CK3 Workshop/Mod
    源文件是否已应用该补丁；不能仅凭仓库中有补丁文件就认定游戏端已更新。

### 1.2 最新实机反馈

实机测试已出现以下进展：

-   继子已经能够识别继母。
-   妾室所生子女能够识别父亲的正妻。
-   但识别成功后，关系表述疑似把继母／正妻直接当成亲生母亲。
-   年龄识别仍存在实际年龄加一岁的情况。
-   「摘要 →
    个人摘要」里的「人物认知」入口消失，原先可以查看披露过的人物特质、头衔等。

以上说明"是否识别到目标人物"与"关系语义是否正确"是两个独立验收项。V9.3.7.1
必须保留已经改善的识别能力，同时纠正关系类型和方向标签，不得回退到完全无法识别继亲的状态。

------------------------------------------------------------------------

## 2. P 级问题清单与修复要求

### P1-01：`currentDirectParentFilter()` 对未知来源存在 fail-open

**文件：** `src/app/main/worldline/kinship-graph-cache.js`\
**函数：** `currentDirectParentFilter(gameData)`

当前过滤器的风险路径：

-   记录没有 `publicStatus` 时，可能通过第一层判断。
-   `source` 不是 `CK3_DIRECT_PARENT` 时，函数会直接返回 `true`。
-   因此，带有 `source: "UNVERIFIED"`、缺少 `publicStatus`
    或其他非白名单来源的对象，可能被当作可用父母证据继续处理。

**修复要求：**

1.  改成
    fail-closed：当前关系图中的父母边必须命中明确的可信来源分支；未知来源、缺少必要元数据或来源不匹配均拒绝。
2.  对 `CK3_DIRECT_PARENT` 严格验证：
    -   `publicStatus === "PUBLIC_LEGAL_PARENT"`
    -   `knowledgeStatus === "UNKNOWN"`（该字段在此处是证据知识状态，不代表允许忽略公开性）
    -   `relationType === "parent"`
    -   `sourceRelation === "parents"`
    -   `sourceOwnerId`、`childId` 与当前子女 Runtime ID 一致
    -   `campaignToken` 与当前战役一致
    -   `sourceSnapshotId` 与当前日期／`totalDays` 快照一致
    -   `evidenceConflict !== true`
3.  若为兼容旧日志保留兼容分支，必须单独命名并限定使用范围；旧记录不能自动升级成可信的当前公开亲子事实。
4.  对 `source: "UNVERIFIED"`、空来源、缺失 `publicStatus`、错误
    Owner、错误 Child、过期快照、跨 Campaign 等情况逐一增加反例测试。

**验收：** 未知来源不生成 `PARENT_OF` / `CHILD_OF`
边，不进入家庭事实块或最终
Prompt；可信、来源完整的当前父母记录仍可正常查询。

### P1-02：`children` 与 `relationType: "child"` 建边路径绕过父母过滤

**文件：** `src/app/main/worldline/character-kinship-graph.js`\
**相关入口：** `buildKinshipGraph()` 中的 `character.children`
循环，以及 `character.evidence.relations` 中的
`relationType === "child"` 分支。

当前代码对 `character.parents` 使用
`directParentEvidenceFilter`，但另一些路径可以直接建立 `PARENT_OF` /
`CHILD_OF` 边，未复用相同的可信度检查。这会导致一条路径拒绝的 `UNKNOWN`
或冲突关系，被另一条路径重新建立。

**修复要求：**

1.  提取统一的当前亲子证据验证函数，覆盖所有可能生成 `PARENT_OF` /
    `CHILD_OF` 的入口。
2.  不得只修复 `parents` 数组；必须同时检查：
    -   `parents[]`
    -   `children[]`
    -   `evidence.relations[]` 的 parent/child 关系
    -   `evidence.otherParentRelations[]`
    -   `children[].otherParent`
    -   `siblings[].otherParent`
    -   canonical profile 合并后的父母记录
3.  验证函数应接收方向、子女 ID、父母 ID、来源类型、Owner
    ID、Campaign、快照和公开性标记，避免把"同一对 ID"当成充分证据。
4.  对同一关系通过多个来源进入图的情况，必须合并证据并保留冲突状态；一条可信记录不能静默覆盖另一条不可信或冲突记录。
5.  只允许来源明确、当前、公开且绑定正确的关系形成当前事实；不能通过反向记录绕过拒绝规则。

**验收：** 对同一组人物分别构造 `parents`、`children` 和
`relationType: "child"`
三种输入，所有不可信输入都必须得到一致结果；有效输入仍能生成唯一、无重复的亲子边。

### P1-03：`UNKNOWN otherParent` 不得进入关系图或家庭事实推断

**涉及文件：**

-   `src/app/main/game-data/log-parser.js`
-   `src/app/main/game-data/relationship-resolver.js`
-   `src/app/main/worldline/character-kinship-graph.js`
-   `src/app/main/worldline/kinship-graph-cache.js`
-   `src/app/main/worldline/family-entity-fact-bundle.js`
-   `src/app/main/worldline/character-family-facts.js`

此前 Review 已指出，未知父母／`otherParent`
可能沿其他路径进入关系图或家庭事实。V9.3.7
已有来源绑定与公开性标记，但仍须确认所有消费路径统一执行过滤。

**修复要求：**

1.  `CK3_OTHER_PARENT` 只有在当前导出明确标记 `PUBLIC_LEGAL_PARENT`，且
    Campaign、来源 Owner、Child
    ID、关系类型、来源路径和快照全部匹配时，才允许形成当前父母边。
2.  `UNKNOWN`、秘密、来源不完整、错误挂接、跨战役、旧快照或冲突的
    `otherParent` 只能保留为不可用于当前事实推断的诊断记录。
3.  `kid_other_parent` 必须绑定到该 `kids`
    行所对应的子女；`sibling_other_parent` 必须绑定到该 sibling
    目标，而不是错误挂接到当前回应者。
4.  "另一位家长"证据只能补足该子女的另一位家长，不得凭此把另一位家长连接到其他子女。
5.  共享父亲只证明同父关系；不能推出两位母亲互为配偶，也不能把一位母亲推成另一位孩子的母亲。
6.  家庭事实块在输出前再次执行来源与快照验证，不能仅依赖早期解析阶段的过滤。

**验收：** 覆盖有效公开 `otherParent`、`UNKNOWN`、错误 Child ID、错误
Owner ID、秘密、重复来源、同父异母、同母异父、同名不同 ID、跨 Campaign
和过期快照。所有未知或错误挂接案例均不得泄漏到 Prompt。

### P1-04：CK3 相对人物导出补丁必须确认真实生效

**补丁文档：** `docs/current/v9/patches/V9_3_7_RELATIVE_EXPORT.patch`\
**补丁目标：** `common/scripted_effects/log_character_v2_effect.txt`

补丁内容涉及：

-   `parents` 导出 `GetAge`、代词和 `PUBLIC_LEGAL_PARENT` / `UNKNOWN`。
-   `kids`、`siblings` 导出 `GetAge`。
-   输出 `kid_other_parent` / `sibling_other_parent` 的公开性标记。
-   输出当前父母配偶、配偶的子女以及这些子女的完整双亲证据，用于继父母／继子女识别。
-   为导出行绑定正确的当前人物作用域，避免错误地把其他人物作为关系来源。

**现状判断：**
仓库中目前可见的是补丁文件，未包含补丁目标的活动源文件。最新实机已证明部分继亲识别路径可工作，但这并不能证明年龄字段和全部公开性标记已经从正确的活动导出器输出。

**修复要求：**

1.  找到真实运行的 CK3 Workshop/Mod
    源文件，核对其实际路径、版本和当前安装位置。
2.  将补丁应用到活动源文件，而不是只保留 `.patch`。
3.  核对 CK3 脚本中的 scope、`PREV`、保存的 scope、`mother` /
    `father`、`every_spouse`、`every_child` 的引用对象，避免作用域漂移。
4.  检查每一种新日志行的字段数量、字段顺序和结束标记，与
    `createLogParser()` 的解析索引逐列一致。
5.  重新加载／重启 CK3 对应 Mod 并重新导出全新
    `debug.log`。不能用旧日志证明新导出器有效。
6.  保存脱敏的导出样本与字段检查报告，证明
    `parents`、`kids`、`siblings`、`kid_other_parent`、`sibling_other_parent`、`parent_spouse`、`parent_spouse_child`
    的新格式确实存在。
7.  若活动导出器属于独立 Mod 仓库，需记录其仓库、提交 SHA
    和安装版本；VOCT-NEW 的 CI
    不会自动验证另一个仓库中未纳入构建的脚本。

**验收：** 新导出的日志能被生产 `createLogParser()`
正确解析；旧日志仍安全降级，不猜年龄、不补造亲属、不把缺失公开性标记升级为可信关系。

### P1-05：继亲识别成功，但关系标签错误地指向亲生父母

**涉及文件：**

-   `src/app/main/worldline/character-kinship-graph.js`
-   `src/app/main/worldline/kinship-label-resolver.js`
-   `src/app/main/worldline/step-family-facts.js`
-   `src/app/main/worldline/character-family-facts.js`
-   `src/app/main/worldline/family-entity-fact-bundle.js`
-   `src/app/main/prompts/prompt-builder.js`

实机反馈：继子能识别继母；妾室所生子女能识别父亲的正妻。但识别到对方后，模型可能直接把对方称为亲生母亲。该问题不能通过删除继亲识别来解决。

**修复要求：**

1.  将"生物学／法律亲子关系"与"因父母婚姻产生的继亲关系"作为不同关系类型处理。优先使用明确的
    `relationshipKind` 或独立的 `STEP_PARENT_OF` / `STEP_CHILD_OF`
    表达，不得将继亲边伪装成普通 `PARENT_OF` / `CHILD_OF`。
2.  `kinship-label-resolver.js` 必须支持方向正确的继亲标签，不能让所有
    `PARENT_OF`
    一律只映射为"父亲／母亲"，也不能把继亲边送进普通生物学父母标签分支。
3.  对继子女视角：
    -   父母的当前配偶、但并非已验证的亲生父母：显示"继母／继父"或"父亲的正妻（非生母）"等明确标签。
    -   对方视角：显示"继子／继女／继子女"，不能直接显示"亲生儿子／亲生女儿"。
4.  对"妾室所生子女识别父亲正妻"的场景，关系显示应明确区分"正妻---庶子女"，并注明该正妻不是该子女的已验证生母。不要只输出模糊的"母亲"。
5.  "继父母／继子女"是关系类型；"正妻／庶子女"是婚姻与家庭身份标签。两者可按已证实的
    CK3
    婚姻身份和家庭设定选择最精确标签，但不得互相推导出未经验证的生物学关系。
6.  只有在当前、来源绑定、公开且无冲突的婚姻与双亲证据齐备时，才能生成当前继亲事实。前配偶、已故配偶、过期婚姻或未知生命状态不得自动升级为当前继亲。
7.  如果人物确实是已验证的亲生母亲／父亲，原有亲子关系应保留；不能因其同时具有"正妻"身份就覆盖真实父母关系。
8.  Prompt
    应明确写出关系类型和排除项，例如"她是父亲当前的正妻，但不是此人的已知生母；当前证据支持正妻---庶子女关系，不支持亲生母女关系"。不要依赖模型自行猜测标签语义。

**验收：**

-   继子视角：回答"谁是你的继母？"能识别正确人物，并称为继母，而不是亲生母亲。
-   继母视角：能称对方为继子／继女，而不是无条件称为亲生子女。
-   妾室所生子女视角：能识别父亲的正妻，但不将她当成生母。
-   正妻视角：能识别丈夫妾室所生的庶子女，不能把其母亲替换成自己。
-   同父异母／同母异父仍正确；不能将半兄弟姐妹误标成继兄弟姐妹。
-   若缺少可靠婚姻或父母证据，输出未知／证据不足，而不是补造关系。

### P1-06：实机年龄仍出现 `实际年龄 + 1`

**主要文件：**

-   `src/app/main/game-data/character.js`
-   `src/app/main/game-data/log-parser.js`
-   `src/app/main/game-data/relationship-resolver.js`
-   `src/app/main/worldline/character-age-service.js`
-   `src/app/main/worldline/character-temporal-facts.js`
-   `src/app/main/worldline/character-family-facts.js`
-   `src/app/main/worldline/family-entity-fact-bundle.js`
-   `src/app/main/prompts/prompt-builder.js`

当前 `resolveCharacterAge()` 在通过来源验证后会优先使用
`CK3_CURRENT_AGE` 或绑定完整的
`CK3_LIVE_RELATIVE_AGE`。当可信年龄与日历推算不同，代码会保留
`calendarEstimateDiffers` /
诊断信息，但不会自动纠正可信年龄。这是当前架构的保护机制，不应直接改成无条件相信日历推算。

**本次目标不是先假设根因，而是定位"+1"首次出现在哪一层。**

#### 6.1 必须采集的分层证据

对同一位实机人物、同一战役、同一游戏日期，逐层记录：

1.  CK3 人物面板显示年龄。
2.  活动导出器写入的原始 `character` 行年龄。
3.  `parents` / `kids` / `siblings` 相对人物行年龄及其字段来源。
4.  `Character` 解析出的 `age` / `ageSource`。
5.  `relationship-resolver` 合并后的年龄与来源绑定。
6.  `resolveCharacterAge()` 返回的
    `rawAge`、`calculatedCalendarAge`、`age`、`diagnosticCode`。
7.  `character-family-facts` / `family-entity-fact-bundle`
    选择的最终年龄。
8.  最终 Prompt 中的年龄。
9.  模型最终回答的年龄。

诊断记录应对 Runtime ID
做哈希，不记录原始对话、秘密内容或完整关系图。诊断只观察，不改变来源选择和
Prompt。

#### 6.2 根因分类与对应修复

  -----------------------------------------------------------------------------------------------------------------------
  首次出现偏差的位置               诊断                              修复方向
  -------------------------------- --------------------------------- ----------------------------------------------------
  CK3                              `RAW_CK3_AGE_MISMATCH`            检查活动 CK3 导出器、`GetAge` 调用、字段顺序、scope
  人物面板与原始导出字段已不一致                                     和日志是否重新导出

  原始年龄正确，但 `Character`     `PARSER_AGE_MISMATCH`             修正 `log-parser.js`
  解析错误                                                           字段索引、整数校验或旧／新格式识别

  解析正确，但 canonical profile   `PROFILE_AGE_MISMATCH`            修复 Runtime ID 合并、来源
  变成另一年龄                                                       Owner、Campaign、快照或权威优先级

  `resolveCharacterAge()`          `AGE_SOURCE_SELECTION_MISMATCH`   修复可信来源判定；不得绕过 `trustedCurrentAge()`
  选择值错误                                                         

  最终家庭事实块年龄错误           `FAMILY_BUNDLE_AGE_MISMATCH`      修复 profile 选择或重复事实合并

  家庭事实块正确、Prompt 错误      `PROMPT_AGE_MISMATCH`             检查 Prompt Builder 的其他区块是否仍注入冲突年龄

  Prompt 正确、模型回答 `n+1`      `MODEL_ANSWER_MISMATCH`           检查上下文中的其他冲突年龄与指令优先级，再进行真实
                                                                     Provider 验收；不要继续乱改日期算法
  -----------------------------------------------------------------------------------------------------------------------

#### 6.3 年龄修复约束

1.  `resolveCharacterAge()` 继续作为唯一年龄选择入口。
2.  可信当前年龄优先于尚未验证的 Gregorian 日历推算。
3.  不允许在 Parser、Family Bundle、Prompt Builder 中各写一套年龄算法。
4.  不允许对所有年龄统一减一，也不允许因为一次实机案例就把所有来源都降级。
5.  检查 `V9_3_7_RELATIVE_EXPORT.patch` 是否已应用到活动 CK3
    导出器；重新导出日志后再判断相对人物的年龄字段是否存在且准确。
6.  对生日之前、生日当天、生日之后、跨年、闰日、缺失日期、旧快照、缓存刷新等边界建立专项测试。
7.  对同一人物的完整人物记录与亲属相对记录进行 ID
    级合并；旧快照不能覆盖较新的可信当前年龄。
8.  如果 CK3
    原始年龄本身已经比游戏面板大一岁，先修导出字段或字段语义；不能在应用层用
    `-1` 掩盖。
9.  如果 Prompt
    正确但模型仍答错，问题归为模型回答／上下文冲突，不得宣称年龄数据层已失败或继续修改已正确的年龄值。

**验收：** 对至少 3 个不同年龄的真实人物完成 CK3
面板---原始日志---解析对象---家庭事实块---最终
Prompt---回答的端到端对照；每个年龄都与同一日期的 CK3
面板一致。年龄来源未知时必须明确未知，不能猜测。

### P1-07：恢复「摘要 → 个人摘要 → 人物认知」

**历史依据：** 旧版 `Memory4Manager`
曾有「人物认知」「官方追忆」「详细长期记忆」「Legacy
对话摘要」四个标签。人物认知区域可展示认知对象、认识方式、直接交谈／共同场景／提及计数、首次／最近记录、证据完整度，以及特质、头衔和相应披露状态。该
UI 在 V9.3.4 退役 Memory4 时被一并移除。

参考旧版实现： - `src/app/renderer/memory4-manager.js`（历史提交
`3c1c2162e63f587bf920c8670bc88f9c263ac0f1`） -
`src/app/renderer/memory4-manager.css`

**目标：恢复人物认知这一独立用户功能，不恢复整个旧 Memory4/Durable
系统。**

#### 7.1 UI 要求

在「摘要 → 个人摘要」恢复「人物认知」入口。每个目标人物至少展示：

-   人物身份：Runtime ID 绑定的姓名；不能只按姓名匹配。
-   认识方式与证据完整度。
-   已知／未知的特质。
-   已知／未知的头衔。
-   信息来源与获知时间。
-   当前事实与历史事实的区分。
-   支持的人工状态切换操作及操作结果。
-   无记录、来源失效、数据加载失败等状态提示；不能把整个区域静默隐藏。

不得展示未授权的秘密内容、内部诊断、原始关系图或原始 Prompt。

#### 7.2 数据与架构要求

1.  新建独立、最小化的 Character Knowledge / Disclosure
    数据服务，不依赖已经退役的 Memory4 Coordinator、Memory4
    Store、Durable Planner 或旧 Sidecar 运行时召回。
2.  认知记录至少按
    `campaignToken + ownerRuntimeId + targetRuntimeId + factType + factKey`
    隔离。
3.  特质、头衔记录至少包含：
    -   `factType` / `factKey`
    -   事实的当前值或受控显示值
    -   `status`（如 `KNOWN` / `UNKNOWN` / `MANUAL_KNOWN` /
        `MANUAL_HIDDEN`）
    -   `source` / `sourceSnapshotId` / `campaignToken`
    -   `firstAcquiredDate` 或 `manualMarkedDate`
    -   `current` / `stale` 状态
    -   `updatedAt` 与 schema 版本
4.  每个 Owner 的认知状态彼此独立。NPC A 已知某特质，不能自动推出 NPC B
    也知道。
5.  只有明确披露、可信公开信息或经过验证的直接观察证据，才能把事实标记为已知。不能仅因特质存在于完整人物对象中，就假设所有
    NPC 都知道。
6.  手动标记必须通过校验后的 IPC/API 完成；不能允许 Renderer
    直接写任意路径或绕过 Campaign/Owner 绑定。
7.  读取和写入前验证当前战役、Owner、Target、来源修订和数据
    schema；战役切换后不得显示上一个战役的认知数据。
8.  若当前来源已变化或失效，应标为过期／未验证，不得静默把旧状态覆盖为当前事实。
9.  已退役 Memory4 Sidecar 不得成为新 UI
    的运行时依赖。若未来确有旧数据迁移需求，应使用显式、可审计、只读源、先预览再执行的一次性迁移工具；必须验证
    Campaign/Owner
    归属、生成迁移报告、不删除旧文件，且迁移失败不影响当前运行。
10. 人物认知 UI 的恢复不得重新接入 Durable
    自动提取、Year/Life、旧历史重建或额外的模型调用。

#### 7.3 与对话 Prompt 的边界

-   UI 展示"玩家手动标记为已知"不等于所有 NPC 都知道；记录必须有明确
    Owner。
-   任何面向 NPC
    的特质／头衔注入都必须从当前回应者的认知状态读取，并再次验证来源与权限。
-   未知或未披露的秘密特质不得因恢复 UI 而进入 Prompt。
-   UI 不得改变既有关系系统、历史召回或 Legacy 摘要权限。
-   如果当前版本无法可靠恢复某条旧披露事实，应显示"来源未验证／无可信记录"，不能伪造历史披露记录。

**验收：** UI
可打开；有效特质／头衔正确显示；已知与未知状态可以按权限管理并持久化；重启后仍正确；Owner
A 的认知不会泄漏给 Owner
B；秘密、旧战役、失效来源和未披露事实不会变成已知；Durable
仍处于退役状态。

------------------------------------------------------------------------

## 3. P2 问题与测试缺口

### P2-01：旧日志兼容测试必须经过生产 `createLogParser()` 路径

此前 Review 指出，部分旧日志兼容测试没有真正经过生产
`createLogParser()`，不能证明生产解析器会按预期安全降级。

**修复要求：**

1.  使用真实 `createLogParser()` 和生产 `Character`
    类构造旧格式日志夹具。
2.  夹具分别覆盖旧
    `parents`、`kids`、`siblings`、`kid_other_parent`、`sibling_other_parent`
    行。
3.  对旧格式缺少的
    `GetAge`、`publicStatus`、Campaign、快照或关系绑定字段，必须保持未知／不可信；不能从新字段的位置误读旧行的其他数据。
4.  新旧格式都必须验证字段结束标记、字段数量和数字转换边界。
5.  测试不得用只实现最少字段的 Stub Parser 替代生产 Parser；若使用 Stub
    `GameData`，Parser 与 `Character` 仍必须是生产实现。

### P2-02：亲属关系双向冲突与缓存回归

增加测试确保：

-   A 记录 B 是父母，但 B 的反向记录与之冲突时，不静默选择一边。
-   同一事实由多个可信来源提供时合并来源；由可信与不可信来源同时提供时保留冲突状态。
-   `otherParentRelations`、婚姻变化、当前日期、`totalDays`、Campaign
    切换都能使相关缓存失效。
-   旧档兼容不触发无界全量扫描，不破坏 V9.3.6.2 / V9.3.6.3 的 Pair
    检索性能。

------------------------------------------------------------------------

## 4. 远程 GitHub Actions / CI 失败分析与修复

### 4.1 已确认的失败记录

工作流：`Release Regression`\
工作流文件：`.github/workflows/regression.yml`\
执行环境：`windows-latest`、Node.js 22

-   `tangBranches`：Run `39035019592`，失败时间为
    2026-10-17；[查看运行记录](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39035019592)。
-   `main`：Run `39037509854`，失败时间为
    2026-10-17；[查看运行记录](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39037509854)。
-   两次运行使用相同提交 `37df16e5763d4764c451268ad96356fa9bfda848`。

### 4.2 已定位的直接原因

以下阶段通过：

1.  Checkout。
2.  Node.js 初始化。
3.  锁定运行时依赖校验。
4.  从源码构建运行时。
5.  生成资源校验与部署。

失败发生在 `Run release regression` 阶段：

-   测试文件：`scripts/test-v9.3.6.3-legacy-scoped-coverage.js`
-   测试场景：`C17 source symlinks fail closed or static guards are verified`
-   失败信息：`ReferenceError: legacyRaceDirectory is not defined`
-   失败位置：当前文件约第 1163 行，`runC17()` 收尾处调用
    `attachDirectoryObservation("safe-candidate-directory", legacyRaceDirectory)`。
-   `legacyRaceDirectory` 是另一个测试函数内部的局部变量，不在
    `runC17()` 的作用域中。
-   `runC17()` 前面已经使用 `safeMeasured.counts.directory`
    记录该测试的目录观察值，因此结尾这条引用是重复且错误的测试代码。

**结论：当前可见的远程 CI
失败原因是回归测试自身的作用域错误，不是依赖安装、源码构建、生成资源部署或网络失败。**
C08 对损坏 JSON 的 `SyntaxError`
是测试预期的失败关闭场景，随后该检查通过；它不是此次 CI 的最终失败点。

### 4.3 CI 修复要求

1.  删除 `runC17()` 结尾对越界局部变量 `legacyRaceDirectory`
    的错误引用；或者明确使用 C17 自己捕获的
    `safeMeasured.counts.directory`。由于前面已经记录过，优先删除重复调用。
2.  检查 `scripts/test-v9.3.6.3-legacy-scoped-coverage.js`
    中是否还有其他从不同测试函数复制过来的局部变量引用。
3.  保留 C17 的真实符号链接测试；不能为了让 CI
    通过而跳过符号链接场景或移除静态安全断言。
4.  修复后在本地重新执行对应测试文件，再运行
    `node scripts/test-release.js`。
5.  推送新提交后，分别检查 `tangBranches` 与 `main` 上新 SHA 的 GitHub
    Actions 结果；旧 SHA 的失败记录不得被标记为已修复。
6.  记录失败前后 SHA、完整测试结果、失败用例和重新运行链接。
7.  必须确认整个 Release Regression 执行结束，不仅是 C17
    通过；同时检查后续测试是否全部运行。

**CI Gate：** 新 SHA 的 `Release Regression` 必须为
`success`，且完整发布回归无失败用例。

------------------------------------------------------------------------

## 5. 施工阶段与建议顺序

  -------------------------------------------------------------------------------------------------------------
  阶段                    工作内容                                         主要交付
  ----------------------- ------------------------------------------------ ------------------------------------
  0                       固定基线，记录当前实机年龄和亲属错误；确认活动   基线 SHA、脱敏日志样本、活动脚本路径
                          CK3 导出器                                       

  1                       修复 C17 测试变量作用域错误                      C17 单测通过，完整 Release
                                                                           Regression 可继续执行

  2                       统一所有亲子边入口的可信来源过滤                 亲属图安全修复与 P1 反例测试

  3                       修复继亲与正妻／庶子女标签语义                   方向正确的关系标签、无虚构亲生关系

  4                       核对 CK3 导出器，重导出并定位年龄 `+1`           活动导出器证据、年龄端到端诊断
                          的第一处偏差                                     

  5                       修复人物认知独立数据链路与 UI                    人物认知面板、隔离和持久化测试

  6                       补齐旧日志、冲突、缓存和部署回归                 测试报告、源码／生成资源一致性报告

  7                       真实 CK3 与 Provider 验收、远程 CI、Soak         独立 Gate
                                                                           记录；全部通过后才可宣告完成
  -------------------------------------------------------------------------------------------------------------

P1-01 至 P1-05 和 CI
阻断应优先处理；年龄修复必须按分层诊断推进，不能以猜测代替定位。人物认知可以并行设计，但合并前必须遵守本版的数据与权限合同。

------------------------------------------------------------------------

## 6. 必须新增或补强的测试矩阵

### 6.1 亲属图来源与公开性

-   `source: "UNVERIFIED"` 且无 `publicStatus`：拒绝。
-   `publicStatus: "UNKNOWN"`：拒绝当前事实。
-   来源字段为空、缺失或不在白名单：拒绝。
-   Owner ID、Child ID、关系类型不一致：拒绝。
-   Campaign 或 `sourceSnapshotId` 不匹配：拒绝。
-   父母已死亡、当前婚姻过期、证据冲突：不能推导当前继亲。
-   同一不可信关系分别从
    `parents`、`children`、`evidence.relations`、`otherParentRelations`
    进入：所有路径均拒绝。
-   合法公开亲子关系仍能被正常查询。
-   同一人物同名但 Runtime ID 不同：不得合并。
-   未知父母不能通过"兄弟的母亲是谁"之类的查询被补造成确定人物。

### 6.2 继亲、正妻与庶子女

-   继子女能识别继父母，但标签不能显示为亲生父母。
-   继父母能识别继子女，但标签不能显示为亲生子女。
-   妾室子女能识别父亲正妻；标签应为"正妻---庶子女"或"父亲的正妻（非生母）"，而不是无条件"母亲"。
-   正妻能识别丈夫妾室所生子女；不得覆盖子女的真实生母。
-   同父异母、同母异父与继兄弟姐妹必须区分。
-   妻子和妾室之间不因共同子女自动生成配偶边。
-   当前婚姻、历史婚姻、已故配偶、未知状态分别验证。
-   关系标签按回应者视角反转，不能只测试单一方向。
-   自定义模板与标准模板都必须保留可信的关系类型，并过滤未知和失效证据。

### 6.3 年龄 `+1`

-   CK3 面板、原始导出、Parser、canonical
    profile、`resolveCharacterAge()`、家庭事实块、Prompt、模型回答逐层对照。
-   至少覆盖三个不同年龄人物及一个场外亲属。
-   生日之前、生日当天、生日之后与跨年边界。
-   新旧日志格式及缺失年龄字段。
-   当前年龄与日历估算相差一岁时，诊断可见且不自动减一。
-   当前年龄来源正确时，不得被旧摘要或旧缓存覆盖。
-   Prompt 中不能出现两个未标记时间的冲突年龄。
-   Prompt 已正确但模型回答错误时，单独记录 `MODEL_ANSWER_MISMATCH`。

### 6.4 人物认知 UI 与数据

-   查看已知特质、头衔、来源和获知时间。
-   `KNOWN`、`UNKNOWN`、`MANUAL_KNOWN`、`MANUAL_HIDDEN` 的显示与写入。
-   Owner A 的认知不泄漏给 Owner B。
-   同一人物不同 Campaign 的认知隔离。
-   重启后数据仍正确。
-   来源失效、快照过期、事实被删除或隐藏时正确刷新。
-   未披露的秘密特质不能被显示为 NPC 已知。
-   UI 加载失败应显示错误／空状态，不能静默删除入口。
-   运行时不依赖退役的 Memory4/Durable Sidecar。
-   恢复人物认知不得改变 Legacy 摘要读取、Pair 检索和 Token 预算。

### 6.5 旧日志与发布门禁

-   使用生产 `createLogParser()` + `Character` 解析旧日志。
-   旧日志缺少新字段时安全降级为未知。
-   `scripts/test-v9.3.6.3-legacy-scoped-coverage.js` 全部检查通过。
-   `node scripts/test-release.js` 完整通过。
-   `node scripts/build-runtime.js`、`node scripts/verify-runtime-build.js`、部署后的
    parity 检查全部通过。
-   源码与 `resources/app/out` 生成资源一致。
-   远程 GitHub Actions 新 SHA 为绿色。

------------------------------------------------------------------------

## 7. 真实 CK3 验收清单

测试必须在重新加载已更新导出脚本、重新导出的日志和明确记录的战役日期下进行。

1.  **年龄：** 选择至少三个年龄不同的人物，记录 CK3
    面板年龄并完成全链路对照。若不一致，记录首次偏差层级。
2.  **继母：**
    让继子询问继母身份，确认回答识别正确人物，且关系标签不是亲生母亲。
3.  **正妻与庶子女：** 让妾室所生子女询问父亲正妻；确认 NPC
    能识别正妻身份，但不把她当成生母。
4.  **反向视角：**
    从正妻视角询问丈夫妾室所生子女，确认标签为庶子女／继子女等正确关系，不误称亲生子女。
5.  **亲生母亲保护：**
    对确有生物学母亲证据的角色，确认不会因正妻身份覆盖真实母亲。
6.  **半兄弟姐妹：**
    验证同父异母、同母异父仍然准确，不误标为继兄弟姐妹。
7.  **未知／秘密：** 移除公开性标记或构造未知父母证据，确认 NPC
    不泄露、不补造。
8.  **人物认知：**
    打开个人摘要中的人物认知面板，检查特质／头衔与披露状态；验证不同认知主体相互隔离。
9.  **旧档：**
    加载旧格式日志或旧存档导出，确认缺失字段只导致未知，不导致崩溃或错误亲属边。
10. **长程稳定性：**
    多轮对话后重复询问年龄、母亲、继母、正妻与庶子女，确认缓存不会继续返回旧关系或旧年龄。

真实 CK3 Gate 不得由合成日志测试代替。合成测试、远程 CI、实机 Provider
和 Soak 必须分别记录。

------------------------------------------------------------------------

## 8. 发布验收标准

V9.3.7.1 只有同时满足以下条件才可宣告完成：

-   [ ] P1-01：未知来源父母记录 fail-closed。
-   [ ] P1-02：所有亲子建边路径使用等价的可信证据验证。
-   [ ] P1-03：`UNKNOWN otherParent` 不进入关系图、家庭事实或 Prompt。
-   [ ] P1-04：活动 CK3
    导出器及重新导出的新日志已核验；补丁不再只是仓库中的文档文件。
-   [ ]
    P1-05：继亲、正妻、庶子女标签正确；没有将继亲边伪装成亲生亲子边。
-   [ ] P1-06：年龄 `+1` 的首次偏差层级已定位并修复；没有全局 `-1`。
-   [ ] P1-07：人物认知 UI 与独立数据链路恢复；不重新启用 Durable。
-   [ ] P2-01：旧日志兼容测试使用生产 `createLogParser()` 路径。
-   [ ] P2-02：双向冲突、缓存失效、Campaign 隔离和旧档兼容测试通过。
-   [ ] C17 测试作用域问题已修复，保留符号链接安全检查。
-   [ ] 完整本地 Release Regression 通过。
-   [ ] 构建、部署、生成资源 parity 通过。
-   [ ] 远程 `main` 和目标开发分支的新 SHA 的 GitHub Actions 均成功。
-   [ ] 真实 CK3 存档与游戏内 Provider 验收通过。
-   [ ] Soak
    测试完成，未出现亲属事实泄漏、年龄陈旧、缓存污染或记忆主体串线。

任何一项未通过都必须明确标记 `BLOCKED`、`PARTIAL` 或
`NOT_RUN`，不得用其他测试的 PASS 代替。

------------------------------------------------------------------------

## 9. 关键参考

-   V9.3.7
    遗留修复提交：<https://github.com/wsdsb-111/VOCT-NEW/commit/37df16e5763d4764c451268ad96356fa9bfda848>
-   V9.3.7
    施工方案：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/docs/current/v9/V9_3_7_IMPLEMENTATION_PLAN.md>
-   V9.3.7
    相对人物导出补丁：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/docs/current/v9/patches/V9_3_7_RELATIVE_EXPORT.patch>
-   亲属图：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/src/app/main/worldline/character-kinship-graph.js>
-   亲属图缓存与过滤器：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/src/app/main/worldline/kinship-graph-cache.js>
-   亲属标签：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/src/app/main/worldline/kinship-label-resolver.js>
-   继亲事实：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/src/app/main/worldline/step-family-facts.js>
-   年龄选择：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/src/app/main/worldline/character-age-service.js>
-   生产解析器：<https://github.com/wsdsb-111/VOCT-NEW/blob/tangBranches/src/app/main/game-data/log-parser.js>
-   失败的 `tangBranches`
    CI：<https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39035019592>
-   失败的 `main`
    CI：<https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39037509854>
-   历史人物认知
    UI：<https://github.com/wsdsb-111/VOCT-NEW/blob/3c1c2162e63f587bf920c8670bc88f9c263ac0f1/src/app/renderer/memory4-manager.js>

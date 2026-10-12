# V9.2 JSON 权威、候选读取与恢复边界

日期：2026-10-11。V9.2 延续 JSON 与 Memory Engine 3.0 / 摘要存储 2.5 合同。本文记录已通过本地 418 groups/21 项独立 QA 快照的实现责任与权限边界；新加的 Summary folder 自动合并需求仍在开发中，尚未包含于该快照。本文不授权迁移文件格式或自动修复用户数据。

## Scope 与唯一权威

Memory4 的授权最小单位仍为 `Campaign × Owner`。Scope 必须先经既有 `assertScope` 和 Store 校验；缺 Campaign、非法 Owner、歧义目录、损坏 index/metadata 或不安全路径均 fail-closed，不回退到 global/all。Campaign Token 与 Owner ID 只在内存调用和原有存储合同中使用，不进入匿名审计输出。

| 责任 | 权威对象 | V9.2 边界 |
| --- | --- | --- |
| Memory4 entry、index、metadata、known entity、Forget projection | 既有 `Memory4Store` 与校验合同 | Entry 正文和来源校验是事实依据；index 是带 hash/revision 的候选定位结构。既有 `commitOwner`、tombstone、Disclosure 与 Forget 写入继续生效。 |
| Legacy/episode/summary mutation 与恢复 journal | 原 `MemoryStore` | 保持 journal `version: 1` 与现有事务/恢复入口。新增 Repository 不能自行恢复、重写或清理 journal。路径及 base64 内容须在恢复写入前预验证。 |
| 候选定位、授权正文读取、匿名诊断 | `ScopedJsonRepository` | Repository 是同一 Store 实例的适配/协调层；不持有第二份 Memory4 数据，也不取代 Memory Engine。 |
| Conversation Finalization、人工遗忘、Legacy 孤儿审计 | `Memory4Coordinator`、`MemoryEngine`、`Memory4OrphanAudit` | 继续由现有协调器提交和恢复。Orphan Audit 仍是 Legacy 来源的人工核查依据；Repository 的诊断不能取代它或授权删除。 |

组合根将 `Memory4Coordinator.repository` 连接到同一 `Memory4Store`/`MemoryStore`；不再构造第二个 Store。原写入者仍负责正式提交，Repository 的 `commitOwner` 委托到 Store；Memory Recall Planner 的候选读取使用候选 frame 后按需读取正文。`forgetSummaryProjection` 和 `recoverPendingFinalizations` 保持 Memory Engine authority，不暴露成 Repository 恢复能力。

## 按施工规格 §4.3 的数据权威映射

以下八类逐项填写 `logicalKey`、`canonicalOwner`、`writer`、`scope`、`schemaVersion`、`revision`、`hash`、`indexType`、`recoveryAuthority`、`legacyReader`、`cleanupPolicy` 和 `proof`。某类没有统一持久字段时明确记为“无统一字段”，不把运行时序号或校验摘要伪称为存储合同。

1. **Memory4 entry、index、metadata、known-entities**：`logicalKey=campaignToken×ownerId×entryId（aggregate 文件按 owner）`；`canonicalOwner=Memory4Store（数据文件）/ Memory4Coordinator（协调提交）`；`writer=既有 Memory4Store 写方法，经 Memory4Coordinator/MemoryEngine/Forget/Disclosure 调用`；`scope=Campaign×Owner`；`schemaVersion=entry memory4SchemaVersion 1、metadata memory4SchemaVersion 1；index/known 由 Store 字段校验`；`revision=entry.revision、index.revision、metadata/known.revision`；`hash=entry body/source hash、indexHash`；`indexType=byCampaign/byOwner/byEntity/byTopic/byEventYear/byEventDate/byConversationYear/byAcquiredYear/byCounterpart/byMemoryType/byState/bySourceFinalization`；`recoveryAuthority=Memory4Store 与 Memory4Coordinator；Forget/finalization 恢复仍由 MemoryEngine/Coordinator`；`legacyReader=Memory4Store 与 MemoryEngine 的兼容读取路径`；`cleanupPolicy=Forget/Tombstone 先过滤；重建 index 不得复活已撤销项`；`proof=queryCandidates frame 的 Scope/revision/hash/entryIds 与 readEntry 当前授权校验`。
2. **Legacy summary、Episode、Memory、Knowledge**：`logicalKey=ownerId×counterpartId（summary）或 episodeId/memoryId/knowledge owner`；`canonicalOwner=MemoryStore / SummariesManager`；`writer=SummariesManager、MemoryEngine、FinalizationCoordinator 经 MemoryStore 的既有写入路径`；`scope=Owner×Counterpart；Campaign 绑定必须有证据`；`schemaVersion=摘要存储合同 2.5；memory schema 当前 2（兼容读取 1）；episode 按现存记录 schema`；`revision=无统一单调 revision；逐条保留来源/时间字段，显式迁移 preview 使用 previewRevision`；`hash=无统一文件 hash；需要来源证明时由 legacySourceHash/迁移校验计算`；`indexType=MemoryStore memories/episodes 索引与既有摘要查找`；`recoveryAuthority=MemoryStore version 1 mutation journal 与现有 Finalization/Memory 恢复入口`；`legacyReader=SummariesManager、MemoryStore、MemoryEngine 既有读者`；`cleanupPolicy=UNKNOWN Campaign 不按目录名绑定；只按既有 Owner/Forget 证据处理，不批量清理`；`proof=33 个 query axis/oracle cases；Legacy mapping 检查 Owner、Campaign binding、knownBy 与来源`。
3. **Year/Life 派生**：`logicalKey=campaignToken×ownerId×kind(year/life)×period`；`canonicalOwner=Memory4DerivedService（memory4-derived.js）`；`writer=Memory4DerivedService，经 baseStore 写入并在 canonical mutation journal 内标脏`；`scope=Campaign×Owner，来源 entry 与日期范围`；`schemaVersion=无独立统一 schemaVersion；view 以既有字段验证`；`revision=view.revision、indexRevision、metadata.derivedRevision`；`hash=sourceHash、sourceRevisionSet、source entry/body hashes`；`indexType=sourceRevisionSet（entry ID@revision）及 life segment 对 year view 的引用，不是 Detail 搜索索引`；`recoveryAuthority=MemoryStore canonical journal；Memory4DerivedService 重验/标脏`；`legacyReader=Memory4DerivedService 的 Year/Life 提示读取路径`；`cleanupPolicy=脏派生作为受控可重建视图；保留手动覆盖，绝不替代或删除 Detail`；`proof=sourceValid/validView 校验来源、Forget、权限、sourceHash 与 revision set`。
4. **Finalization / 恢复快照**：`logicalKey=finalizationId×ownerId×sourceRevision；letter job 另以 jobId 标识`；`canonicalOwner=FinalizationCoordinator / LetterMemoryFinalization / MemoryEngine`；`writer=现有 Finalization/Memory 服务，经 Memory4Coordinator/MemoryStore 正式提交`；`scope=Campaign×Owner 与双方来源证明；letter job 绑定收发双方`；`schemaVersion=letter finalization job schemaVersion 1；生成 episode schemaVersion 2；快照沿用当前记录字段`；`revision=sourceRevision 与 finalizationId 幂等键`；`hash=payloadHash、sourceRevision`；`indexType=Memory4 index.finalizations 与 MemoryStore version 1 journal files`；`recoveryAuthority=MemoryEngine.recoverPendingFinalizations 及既有 Finalization coordinator；Repository 不恢复`；`legacyReader=MemoryEngine/MemoryStore 当前摘要与 episode 读者`；`cleanupPolicy=持久交接且来源证明匹配后清理恢复记录；重启不得重复请求或归档`；`proof=同一 finalizationId/sourceRevision 的写入与完成证明`。
5. **Worldline checkpoint/archive**：`logicalKey=campaignId×branchId×gameDate×checkpointId/entityId`；`canonicalOwner=WorldlineService / WorldlineStore（历史事实存储）`；`writer=WorldlineStore、checkpoint/index 与 branch registry 的既有 owner`；`scope=Campaign×Branch×时间点，Runtime entity 绑定`；`schemaVersion=各 artifact 独立版本（历史 projection/index 与 branch registry 各自校验），无统一跨文件版本`；`revision=archiveRevision、branch/supplemental revision 与 checkpoint identity`；`hash=checkpoint sha256/sourceFingerprint`；`indexType=historical checkpoint nodes、branch registry 与既有实体索引`；`recoveryAuthority=WorldlineStore/对应 Canon 与 Registry 现有校验流程`；`legacyReader=WorldlineService、WorldlineStore 及历史 projection 读者`；`cleanupPolicy=Current Truth 只读；显式分支/归档操作通过 revision 校验，不能写回 CK3`；`proof=一对一身份绑定、节点文件名/date/checkpointId 与 SHA-256 校验`。
6. **pending-letters.json**：`logicalKey=letterId`；`canonicalOwner=LetterManager`；`writer=LetterManager 现有 pending-letter 保存与状态转换`；`scope=本地安装实例、发件人/收件人及可验证 Campaign binding`；`schemaVersion=pending letters version 4`；`revision=无独立统一 revision；以现有 pipeline sequence 和受证据状态推进`；`hash=仅使用现有 payload/source proof；无 Repository 共用 hash`；`indexType=LetterManager storedLetters Map（内存按 letterId 查找），无通用磁盘索引`；`recoveryAuthority=LetterManager 的 pending load、锁、Effect/ACK/receipt 协调`；`legacyReader=LetterManager 现有 version 4 loader 与状态查询`；`cleanupPolicy=Effect、ACK、收信证明及归档分别校验；未知效果不得重寄`；`proof=版本 4 持久状态、游戏 Effect/ACK 和收信/归档证明各自对应`。
7. **RunFile 队列/ACK**：`logicalKey=commandId`；`canonicalOwner=RunFileManager`；`writer=RunFileManager`；`scope=owner/runtime/session epoch`；`schemaVersion=沿用现有 queue 与 RunFile/ACK 协议，无 V9.2 新 schema`；`revision=无统一文件 revision；生命周期状态按 commandId/ACK 证据推进`；`hash=无 Repository hash；命令载荷与写入/ACK 证据按原合同核对`；`indexType=命令队列及 ACK/cursor 状态`；`recoveryAuthority=RunFileManager 与既有 ACK reader`；`legacyReader=Action/RunFileManager 现有消费路径`；`cleanupPolicy=安全清空载体后才隔离旧状态；无 ACK 的未知写入保持 STALLED，绝不盲目重放`；`proof=同命令 BEGIN—ACK、载体原子写入与游戏回读合同`。
8. **用户配置 / Provider Key / Prompt**：`logicalKey=既有设置 key、secret identity 或 Prompt document identity`；`canonicalOwner=SettingsRepository / SecureProviderSecrets / PromptConfig 各自服务`；`writer=对应 Config、Secrets 或 Prompt owner`；`scope=用户安装实例与 provider/config namespace`；`schemaVersion=各自既有合同，无统一 schema`；`revision=各自既有更新字段；无跨 owner 公共 revision`；`hash=无通用明文 hash；Secret 由安全存储 owner 处理`；`indexType=既有 key/document lookup，无通用索引`；`recoveryAuthority=对应 owner 的既有安全读写流程`；`legacyReader=Settings、Provider 与 Prompt 当前 loaders`；`cleanupPolicy=通用 Repository/audit 不读 Key、不扫描凭据、不批量改写定制 Prompt`；`proof=组合根注入原 owner；显式匿名 audit schema 不含 key、原文或绝对路径`。

## 候选 frame 与正文读取

`queryCandidates(scope, filters)` 校验 Scope 与 index，沿已有 `INDEX_KEYS` 筛出候选 ID，不打开 entry 正文。返回的只读 frame 只含 Scope、index revision、index hash 和 `entryIds`。候选 frame 是短期授权上下文，不是正文或独立真相。

正文读取必须重新核验 frame 的 Scope、revision 与 index hash，再核验 entry ID 属于本次候选集合、正文 revision/hash、Owner/knownBy/visibility、来源修订以及当前 Forget projection。选定的有限 ID 才触发正文 I/O。原 `Memory4Store.query()` 保留兼容语义，由候选查询与逐条验证读取组成；合法结果及排序需与旧路径一致。

frame 生成与正文读取之间存在并发 Forget/改写窗口，因此不能仅凭曾经有效的 frame 放行正文。`NEW92-P0-01` 的候选后撤销/Forget 竞态由当前校验 fail-closed；33 个 query axis/oracle cases 与 418 groups 已通过，本地关闭状态见 [P 级问题台账](V9_2_P_ISSUE_LEDGER.md)。

## 多文件修改与 journal

用户追加的改名目录合并由 `MemoryStore.mergeRenamedSummaryFolders` 委托 `summary-folder-merge.js` 规划，仍使用原 Store 的 writer 和 mutation journal。摘要列表及 GameData 读取／保存路径自动检测数字 Owner ID；唯一目录直接复用，不因改名另建目录。多个目录且有可靠当前姓名时采用当前姓名，否则依据最近有效摘要姓名确定合并目标。对话文件按数字 counterpart ID 定位，避免名字改变另建文件，也避免同名不同 ID 混入同一文件。

相同 Campaign 的共享 sidecar 只接受已校验的独立来源或一致内容；同 entry、finalization、source revision、手动披露／派生修改冲突时拒绝迁移。不同 Campaign 分开保存，未知 Campaign 不推断绑定。未绑定记录在移动前保存原 `legacyBindingId`，正文不重写；绑定且完整语义相同的镜像才去重。摘要日期从新到旧，年度条目与人生阶段按时间先后；合并的派生视图标为 dirty，保留原来源和手改规则。

迁移前原目录及 canonical sidecar 原字节备份在 Store `baseDir/renamed-summary-folders`，不参与召回。备份逐字节核对，计划至备份期间源内容变化时停止。version 1 journal 增加可选 `createdDirectories` 和 `removedDirectories`，旧无目录字段 journal 仍可恢复；恢复前校验全部目录、文件路径和内容，再恢复原文件／目录，最后只移除本事务创建且已为空的目录，避免新空 canonical sidecar 造成旧记忆定位歧义。

`MemoryStore` 现有 version 1 summary mutation journal 是已建立的恢复机制。本阶段兼容原 files 字段并增加可选目录记录，沿用原子临时文件替换和原 Store recovery；新增边界需要在写入前拒绝越出受控 root、通过 symlink/junction/dangling link 逃逸，或通过 journal `files` 项把恢复写到根外。编码后的旧文件内容必须是规范、有效的 base64，所有目标路径与内容均应完成预验证后才开始恢复写入。

这类预验证不改变 journal 版本、不把逐文件 rename 宣称为跨文件事务，也不自动删除或重建无法证明安全的数据。发生未知损坏时停止并保留原 journal 供诊断。独立 QA 的五个 crash checkpoints 均真实退出；恢复后旧树逐字节一致，第二次恢复幂等。实际 root/journal junction 用例通过；另有四项真实文件链接受执行权限限制，生产 validator 已运行且没有外部 I/O，详见 [验证报告](V9_2_VERIFICATION_REPORT.md)。`NEW92-P0-02` 的本地关闭以 418 groups 与 21 PASS 独立 QA 为依据；四项 NATIVE_UNVERIFIED 限制仍保留，不能描述为原生文件链接通过。

## 显式、匿名、有界的审计

`ScopedJsonRepository.audit(scope)` 是只读诊断，不在启动时自动运行。显式 `memory4:integrityAudit` IPC 通过 `SummariesManager.auditMemory4Integrity` 先取得当前 Campaign/只读 archive 证明，再调用注入的 `persistence.audit`；Renderer 只得到匿名报告。报告固定使用匿名 Scope 标签，提供有限原因码与计数，不包含 Campaign Token、Owner ID、原始正文或绝对路径；entry 检查上限为 1,000。达到上限时报告 degraded；Forget 候选可计数为 degraded，其他完整性/授权失败保持 blocked。Legacy 项明确提示需走既有 OrphanAudit。该报告不能把 UNKNOWN 来源升级为可删除证据。

Legacy orphan 的来源链仍由现有 `Memory4OrphanAudit` 核验，实际 Forget 仍须用户确认并通过最新 audit token。新的 IPC 入口只提供显式 audit 查询和现有 Forget 调用，不在窗口启动、会话创建或后台定时器中自行触发。

## 验证状态

源码实现范围、独立 QA 结果、性能样本及剩余反例以 [V9.2 实施与验证报告](V9_2_VERIFICATION_REPORT.md) 为准。最终 deployed 286 映射上的 418 groups、21 项 QA 与改名目录合并专项／实际窗口冒烟通过；远端 CI 和真实 CK3／Provider／Soak 仍待验收。旧 285／417 为追加需求前的历史快照。

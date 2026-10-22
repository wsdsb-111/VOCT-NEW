export default {
  common: { unavailable: "暂不可用", noResults: "暂无结果", loading: "正在加载…", refreshing: "正在刷新…", stale: "此视图已过期，请刷新后继续。", error: "无法加载此视图。", page: "第 {{page}} 页，共 {{total}} 页", previous: "上一页", next: "下一页", refresh: "刷新", close: "关闭", cancel: "取消", detail: "详情", source: "查看来源", edit: "编辑", approve: "审查", select: "选择", filter: "筛选", unknown: "未知" },
  navigation: { conversation: "对话", memory: "Legacy Summary", knowledge: "人物认知", worldline: "世界线", letters: "信件", actions: "动作", provider: "服务商", settings: "设置" },
  conversation: { title: "对话", player: "玩家", npc: "人物", system: "系统", streaming: "正在生成…", empty: "尚无对话消息。" },
  memory: { title: "Legacy Summary", verified: "来源已核验", empty: "此范围内暂无摘要。" },
  knowledge: { title: "人物认知", empty: "暂无获授权的事实。" },
  worldline: { title: "世界线", empty: "暂无当前事实。", readOnly: "只读" },
  letters: { title: "信件", empty: "此范围内暂无信件。" },
  actions: { title: "动作记录", empty: "此范围内暂无动作。", reviewRequired: "需要审查" },
  provider: { title: "服务商", unavailable: "服务商暂不可用" },
  diagnostics: { title: "服务商诊断", empty: "暂无用量报告。", native: "服务商原生报告", estimated: "估算", unknown: "未报告", cacheRate: "缓存命中率" },
  settings: { title: "设置", empty: "暂无可用设置。", uiLanguage: "界面语言", promptLanguage: "既有动作语言", gameLanguage: "游戏语言", languageHelp: "切换界面语言不会改变提示词或游戏语言。", chinese: "简体中文", english: "English", presentation: "V9.5 展示层" },
  status: { IDLE: "空闲", LOADING: "加载中", REFRESHING: "刷新中", READY: "就绪", EMPTY: "暂无内容", ERROR: "错误", STALE: "已过期", QUEUED: "已排队", DISPATCHED: "已派发", ACKNOWLEDGED: "已收到回执", CONFIRMED: "已由游戏回读确认", UNCONFIRMED: "效果未确认", UNKNOWN: "未知", SOURCE_BOUND: "来源已核验", BLOCKED: "已阻止", STALLED: "等待可靠确认" },
  errors: { STALE_CONTEXT: "上下文已改变，请刷新此视图。", CAMPAIGN_CHANGED: "战役已改变，请重新加载。", CONVERSATION_CHANGED: "对话已改变，请重新加载。", REVISION_CONFLICT: "来源已变化，请刷新后编辑。", SOURCE_REVOKED: "此来源已不再可用。", PERMISSION_DENIED: "未获授权查看此信息。", PROVIDER_UNAVAILABLE: "服务商不可用，请检查配置。", REQUEST_CANCELLED: "请求已取消。", EFFECT_UNKNOWN: "效果未知，请先回读后端状态。", IPC_UNAVAILABLE: "应用连接暂不可用。", VALIDATION_ERROR: "提交的值无效。", UNKNOWN_ERROR: "请求失败，请刷新或查看诊断。" },
  legacyKnowledge: {
    common: { unknownName: "姓名未载入" },
    kinds: { name: "姓名", nickname: "称号", title: "头衔", trait: "特质" },
    statuses: { known: "已知", autoDisclosed: "对话已披露", manualKnown: "人工标记已知", manualHidden: "人工设为未知", unknown: "未确认", stale: "来源已变化", directKnown: "直接可知", unavailable: "状态未载入" },
    sources: { stale: "对应的原始对话来源已变化", conversationDisclosure: "原始对话披露记录", undisclosed: "原始对话没有披露记录", manual: "人工认知设置", gameDataKnownSecret: "运行数据的披露记录", inPersonObservation: "在场可见的外貌／身体白名单特质", publicCloseFamily: "已公开的父母子女／亲兄弟姐妹关系", publicNickname: "公开称号", unknown: "来源未分类" },
    ui: {
      factValue: "{{kind}}：{{value}}", hasDisclosureRecord: "已有对话披露记录", acquiredAt: "获知时间：{{date}}", setUnknown: "设为未知", markKnown: "标记已知",
      setUnknownTooltip: "只改变“谁知道”所选人物对这项特质的认知", markKnownTooltip: "只将“谁知道”所选人物标记为明确知道这项特质",
      choosePerson: "选择人物姓名", title: "人物认知 · 当前对话", intro: "认知按“谁知道谁”分别记录。公开披露让实际在场的听众获知；私语只传给指定对象，候场和缺席人物不会获知。",
      refreshing: "正在刷新…", refresh: "刷新本场", help: "分别选择“谁知道”和“关于谁”。姓名、头衔显示披露记录，称号保持公开可见。外貌／身体白名单及已公开的父母子女、亲兄弟姐妹关系可直接提供特质信息；其他特质可逐人手动设为已知或未知。",
      loadingParticipants: "正在读取本场对话参与者…", campaignUnavailable: "当前对话缺少可验证的战役信息，暂不能查看人物认知。", noConversation: "当前没有活动对话。开始对话后，可查看本场人物之间的一对一披露。",
      notEnoughParticipants: "当前会话还没有其他参与者，暂时没有可查看的一对一披露。", ownerLabel: "谁知道", ownerAria: "选择谁知道", targetLabel: "关于谁", targetAria: "选择关于谁",
      loadingOwner: "正在读取所选方向的对话披露…", loadingTarget: "正在读取这组人物的认知记录…", chooseOwner: "请选择一位本场听众，再独立选择披露内容涉及的人物。", chooseTarget: "请选择一位与所选听众不同的人物；不会自动反转或配对披露方向。",
      targetHeading: "对{{owner}}而言，关于{{target}}的披露记录", noFacts: "这组人物之间没有可显示的姓名、头衔或特质披露记录。", recordsAsOf: "记录截至：{{date}}", saving: "正在保存这组人物之间的特质认知…", saved: "已更新“{{owner}} → {{target}}”的特质认知；只影响这个方向。"
    },
    errors: {
      conversationChanged: "当前对话已切换，请重新选择人物。", campaignChanged: "当前战役已切换，请刷新人物认知后重试。", campaignUnavailable: "当前对话缺少可验证的战役信息，暂不能管理人物认知。",
      sourceChanged: "原始对话证据已变化，请重新载入人物认知。", revisionConflict: "这项认知刚刚发生变化，请刷新后重试。", conversationUnavailable: "当前没有可读取的活动对话。",
      stateInvalid: "人物认知数据无法验证，已停止读取或写入。", automaticAccess: "此特质由可见白名单或公开直系亲属关系提供，请刷新查看。", generic: "人物认知暂时不可用，请刷新本场对话后重试。"
    }
  },
  legacyPair: {
    common: { unknownName: "姓名未载入" },
    counts: {
      scannedSummaries: "扫描摘要", scannedSummaryCount: "扫描摘要", titledSummaries: "含事项标题", titledSummaryCount: "含事项标题", recognizedTitleCount: "含事项标题",
      candidateItems: "候选事项", candidateItemCount: "候选事项", candidateCount: "候选事项", newCount: "预计新增", addedCount: "预计新增", updatedCount: "预计更新",
      unchangedCount: "预计保持", existingCount: "预计保持", removedCount: "移除旧索引", skippedCount: "跳过", invalidCount: "格式错误", completedPairs: "已处理关系", totalPairs: "关系总数", finalItems: "最终事项"
    },
    errors: {
      previewStale: "预览期间摘要发生变化，旧方案已作废。已重新扫描，请检查新预览后再次确认。", sourceStale: "来源已变化或当前不可访问。事项簿已刷新，请重新打开来源。",
      campaignNotLoaded: "历史摘要的所属战役尚未绑定或存在歧义；可以查看，暂不能写入事项簿。", ownerNotVerified: "当前战役无法验证此 Owner，未写入事项簿。",
      gameDataUnavailable: "当前游戏数据尚未准备好；只读内容仍可查看，请稍后重试。", readOnly: "当前档案为只读状态，可以查看事项，不能写入。",
      previewFailed: "预览失败，请刷新摘要后重试。", applyFailed: "写入失败。原始摘要未修改；请刷新后检查已完成的关系。", generic: "操作失败，请刷新摘要后重试；原始摘要不会被此操作修改。"
    },
    reasons: {
      noImportantMatters: "摘要没有重要事项", noTitle: "没有事项标题", missingDate: "缺少对话日期", campaignUnbound: "Campaign 尚未绑定", campaignMismatch: "摘要属于其他 Campaign",
      campaignUnresolved: "Campaign 身份无法验证", unauthorizedOwner: "Owner 未获授权", sourceAuthorizationUnverified: "摘要来源授权无法验证", officialSummary: "官方追忆摘要不参与回填",
      forgotten: "内容已被 Forget 撤销", sourceIdentityAmbiguous: "摘要来源身份不明确", sourceIdentityConflict: "摘要来源身份冲突", sourcePairMismatch: "摘要关系与当前 Pair 不一致",
      sourceRevisionUnverified: "摘要版本无法验证", sourceFileUnverified: "摘要文件无法验证", memoryScopeMismatch: "摘要记忆范围不匹配", invalidSummaryFormat: "摘要文件格式错误",
      invalidSummaryContent: "摘要正文格式错误", futureDate: "摘要日期晚于当前游戏日期", ambiguousItemBoundary: "事项边界含糊，需在预览中人工核对", sourceStale: "来源已变化或不可访问", other: "其他跳过原因"
    },
    evidence: { directPair: "直接交流", groupWitnessed: "共同见证", undetermined: "无法判定", unrecorded: "交流方式未记录" },
    ui: {
      invalidScope: "当前摘要关系缺少有效身份信息。", apiUnavailable: "长期事项簿接口尚未连接，请确认应用版本后刷新。", previewApiUnavailable: "长期事项预览接口尚未连接，请确认应用版本后刷新。",
      previewRefreshed: "原预览已过期，已重新扫描。请检查新结果后再次确认。", previewCancelled: "预览已取消，未写入事项簿。", cancelRequested: "已请求取消；当前关系完成后将停止后续写入。",
      missingPreviewRevision: "预览缺少可用版本，未执行写入；请重新预览。", updatingPair: "正在更新此关系的长期事项簿…", previewExpired: "预览已过期，正在重新扫描；旧方案未写入。",
      pairUpdated: "此关系的长期事项簿已更新。", missingPreviewPairs: "批量预览没有可执行的 Pair 或预览版本；请重新预览。", invalidPreviewPair: "批量预览缺少有效关系身份或预览版本，未执行写入。请重新预览。",
      updatingBatch: "正在逐个关系更新。可取消后续关系；当前关系完成后停止。", batchCancelled: "已处理 {{completed}}/{{total}} 个关系；已取消剩余关系。", batchFinished: "已处理 {{completed}}/{{total}} 个关系：成功 {{successes}}，失败 {{failures}}。",
      batchPreviewStale: "部分关系的预览已过期；已完成的关系保留，本次未写入的关系正在重新预览。", sourceVersionMissing: "此事项缺少可验证的来源版本，无法安全打开原摘要。",
      sourceApiUnavailable: "原摘要来源验证接口尚未连接，请确认应用版本后重试。", sourceStale: "来源已变化或已删除，未显示缓存内容。事项簿正在刷新，请重新打开。", sourceContentMissing: "已验证来源没有可显示的摘要正文。",
      skippedReasons: "跳过原因", verifiedSourceAria: "已验证的 Legacy 摘要来源", sourceSummary: "来源摘要", close: "关闭", verifiedSourceTitle: "已验证的 Legacy 摘要",
      verifyingSource: "正在向主进程验证来源身份与版本…", refreshLedger: "刷新事项簿", matchedItem: "对应事项：", locateAndEdit: "定位到此摘要并编辑",
      sourceNavigationFailed: "源摘要已刷新，但无法在当前摘要列表中唯一定位。请刷新后重试。", sourceLocatorDetails: "来源定位详情", readFailedExpand: "读取失败 · 请展开查看", reading: "读取中…",
      itemCount: "{{count}} 条事项", viewItems: "查看事项", relationshipCount: "{{count}} 个关系", noRelationships: "暂无可浏览的人物关系。", maintenance: "生成与更新",
      folderTitle: "长期事项簿", pairFolderTitle: "{{owner}} → {{counterpart}} · 长期事项", updateOwnerLedger: "更新 {{owner}} 的长期事项簿", batchProgress: "批量进度：{{completed}}/{{total}} 个关系已处理。",
      completed: "已完成", failed: "失败：{{error}}", stoppingBatch: "正在停止后续关系…", cancelRemaining: "取消后续关系", attentionRequired: "需要处理 · 请展开查看", notCompleted: "未完成 · 请展开查看",
      resultDetails: "本次处理详情", updated: "已更新", itemTotal: "共 {{count}} 条", loadingLedger: "正在读取长期事项簿…", readOnlyArchive: "只读归档：可以查看事项和来源，不能回填。",
      sortAria: "事项日期排序", newestFirst: "由新到旧", oldestFirst: "由旧到新", searchPlaceholder: "搜索人物、物品、事件或年份", searchAria: "搜索长期事项",
      fromDatePlaceholder: "起始日期，如 1090.01.01", fromDateAria: "事项开始日期", toDatePlaceholder: "结束日期，如 1099.12.31", toDateAria: "事项结束日期", filter: "筛选",
      noItems: "当前筛选范围没有长期事项。没有事项不代表没有其他 Legacy 叙事记忆。", dateUnrecorded: "日期未记录", viewOriginalSummary: "查看原摘要", expandSourceEvidence: "展开来源与证据",
      sourceDateAndEvidence: "来源日期：{{date}} · {{evidence}}", unrecorded: "未记录", sourceDiagnostics: "来源诊断详情", source: "来源", paginationAria: "长期事项分页", previousPage: "上一页",
      pageCount: "第 {{page}} / {{total}} 页", nextPage: "下一页", generateOwnerLedger: "批量生成长期事项簿（仅当前合法战役）", rescanLedger: "重新扫描并更新长期事项簿", extractLedger: "自动提取长期事项",
      readOnlyPreviewLoading: "正在只读预览…", backfillPreview: "回填预览（尚未写入）", previewReadOnly: "当前来源仅可查看：所属战役未绑定、存在歧义或当前角色无法验证，不能确认写入。",
      offlineBackfill: "已验证历史摘要的唯一战役绑定，无需连接游戏；确认后只生成本地事项簿。", skippedDiagnosticsHint: "有摘要被跳过；请展开诊断详情查看服务端返回的原因。",
      sourceSummaryPreview: "来源摘要：{{summary}}", candidatePreview: "候选事项预览", candidatePreviewLimited: "候选事项预览（前 {{limit}} 条）", relationshipScope: "关系范围：{{count}}", previewDiagnostics: "预览诊断详情",
      cancelNoWrite: "取消（不写入）", executing: "正在执行…", confirmOwnerLedger: "确认生成此 Owner 的长期事项簿", confirmPairLedger: "确认生成此关系的长期事项簿"
    }
  },
  worldMemoryEditor: {
    common: { unknown: "未知", unknownType: "未知类型", unknownScope: "未知范围", unknownReason: "未知原因", unknownField: "未知状态" },
    types: { PLAYER_CANON: "普通剧情事实", RP_POLITICAL_DECISION: "政治决定", SECRET_AGREEMENT: "秘密约定", NARRATIVE_EVENT: "剧情事件", WORLD_ANNOTATION: "长期世界规则", PLANNED_DECISION: "未来计划", MANUAL_CORRECTION: "开发者纠正（兼容旧记录）" },
    typeHelp: { PLAYER_CANON: "已经发生、但 CK3 没有记录的剧情事实。", RP_POLITICAL_DECISION: "玩家确认过的政治安排或决定。", SECRET_AGREEMENT: "只有授权人物可以知道的约定。", NARRATIVE_EVENT: "一件需要长期保留的剧情事件。", WORLD_ANNOTATION: "长期有效的世界规则，不代表某个角色的当前状态。", PLANNED_DECISION: "已经计划但尚未发生的事情。", MANUAL_CORRECTION: "旧版本或开发者维护记录。" },
    visibility: { PUBLIC_WORLD: "所有人都知道", REALM_PUBLIC: "同一领地的人知道", COURT_PUBLIC: "同一宫廷的人知道", PERSONAL: "指定人物知道", SECRET: "秘密" },
    visibilityHelp: { PUBLIC_WORLD: "任何 NPC 都可以在问题相关时知道。", REALM_PUBLIC: "只对与范围人物同一领地的 NPC 开放。", COURT_PUBLIC: "只对与范围人物同一宫廷的 NPC 开放。", PERSONAL: "只对“知情人物”列表中的 NPC 开放。", SECRET: "按知情人物列表严格授权，不会因相关问题泄露。" },
    importance: { LOW: "低", NORMAL: "普通", HIGH: "重要", CRITICAL: "关键" },
    status: { ACTIVE: "生效", HIDDEN: "已隐藏", RETIRED: "已恢复自动来源", SUPERSEDED: "已被替代", CONFLICTED: "冲突", TEMPORAL_BLOCKED: "时间未满足", UNKNOWN: "未知状态", currentSave: "当前存档", npcMemory: "NPC 世界记忆", enabled: "已开启", disabled: "未开启", savedMemories: "已保存记忆", count: "{{count}} 条" },
    temporalModes: { CURRENT_DATE: "当前游戏日期", SPECIFIC_DATE: "指定日期", TIMELESS: "长期规则（无日期）", PLANNED: "未来计划" },
    recallReasons: { RECALL_DISABLED: "当前对话召回尚未开启", QUERY_NOT_RELEVANT: "问题与这条记忆没有明显关联", NPC_NOT_AUTHORIZED: "这个 NPC 没有权限知道", TEMPORAL_BLOCKED: "这条记忆在当前时间尚未生效或已失效", CURRENT_TRUTH_CONFLICT: "这条记忆与 CK3 当前事实冲突", RECORD_NOT_ACTIVE: "这条记忆当前未生效", NOT_SELECTED: "候选已找到，但未进入本次召回", RELEVANT_ENTITY_MATCH: "问题涉及这条记忆中的人物", RELEVANT_TEXT_MATCH: "问题与这条记忆的文字相关" },
    claimFields: { location: "所在地", alive: "是否在世", faith: "信仰", culture: "文化", liege: "直属领主", courtEmployer: "所在宫廷" },
    picker: { searchPlaceholder: "搜索人物姓名", searchAria: "搜索人物姓名", searching: "搜索中…", search: "搜索", chooseCurrentPlayer: "选择当前玩家", removePersonAria: "移除{{name}}", currentlyPresent: "当前场景", recentlyMentioned: "最近提及", unavailable: "当前版本没有角色选择接口。", genericError: "人物列表暂时无法读取，请稍后重试。", testHelp: "可以搜索当前存档人物。" },
    errors: {
      branch_write_blocked_reload_editor: "存档分支已变化，这次操作未保存。请在刷新后的存档中重新核对后提交。",
      supplemental_date_invalid: "日期格式无效，请重新选择日期。", supplemental_current_date_invalid: "无法识别当前游戏日期，请刷新存档后重试。", supplemental_specific_date_invalid: "指定日期无效，请输入例如 1175.8.23。", supplemental_specific_date_required: "指定日期无效，请填写日期。", supplemental_planned_date_invalid: "计划日期无效，请输入例如 1175.8.23。", supplemental_current_date_unavailable: "当前游戏日期暂不可用，请刷新存档后重试。", supplemental_scope_character_required: "请先选择范围人物，或选择当前玩家，再保存宫廷或领地记忆。", supplemental_known_by_required: "请先选择明确知情的人物，再保存个人记忆或秘密。",
      titleAndContentRequired: "请填写标题和希望世界长期记住的内容。", currentTruthEntityRequired: "当前状态需要先选择一名涉及人物。", entityRequired: "请先选择一名涉及人物。", currentTruthMustBeRead: "请先读取并确认 CK3 当前事实；当前值不允许手动填写。", testResponderRequired: "请先选择要测试的 NPC。", testQueryRequired: "请填写一个测试问题。", testUnavailable: "当前版本没有召回测试接口。", currentTruthUnavailable: "当前版本没有 CK3 当前事实读取接口。", historyBranchRequired: "请先选择历史分支。", legacyMigrationUnavailable: "当前版本没有旧版 Supplemental 迁移接口。", legacyRecordRequired: "请先选择一条旧版 Supplemental。", migrationKnownByRequired: "请重新选择至少一名明确知情人物。", migrationScopeRequired: "请重新选择宫廷或领地范围人物。", supplemental_current_state_needs_structured_confirmation: "正文可能包含人物当前状态。若是历史叙述，请明确写出过去的时间语境；若确实要记录当前状态，请勾选当前状态选项，选择人物和状态，读取 CK3 事实后再保存。", supplemental_current_claim_required: "当前状态声明缺少结构化状态。请勾选当前状态选项，选择人物和状态，再读取 CK3 事实。", supplemental_current_claim_semantics_invalid: "当前状态声明与记忆类型不一致。请关闭当前状态选项，或按提示重新选择人物、状态并读取 CK3 事实。", supplemental_current_claim_requires_current_date: "当前状态必须绑定当前游戏日期。请刷新存档后重新读取 CK3 事实。", supplemental_current_claim_character_required: "无法验证所选人物。请重新从当前存档选择人物，并再次读取 CK3 事实。", supplemental_current_claim_value_mismatch: "CK3 当前值与上次读取的值不同。请重新读取当前事实并核对后再保存。", supplemental_current_claim_checkpoint_unavailable: "当前存档事实暂不可用。请连接或刷新存档，再读取 CK3 当前事实。", supplemental_current_claim_invalid: "当前状态声明无法验证。请重新选择人物和状态，并读取 CK3 当前事实。", supplemental_current_truth_field_unsupported: "所选状态不受当前事实校验支持。请重新选择所在地、生死、信仰、文化、领主或所在宫廷。", supplemental_current_truth_character_unavailable: "所选人物不在当前存档中。请重新选择人物后再读取 CK3 当前事实。", supplemental_current_truth_life_status_conflict: "CK3 对人物生死状态的信息存在冲突，无法安全保存当前状态。请刷新存档并核对人物资料。", supplemental_current_truth_value_unavailable: "CK3 当前存档没有可验证的这项状态。请检查人物和状态选择，或将内容改为历史叙述。", supplemental_current_truth_value_invalid: "CK3 返回的当前状态格式无法验证。请刷新存档并重新读取。", generic: "请求失败，请刷新或重试。"
    },
    success: { revisionSaved: "世界记忆修订已保存。", saved: "世界记忆已保存。" },
    ui: { title: "世界记忆", intro: "记录 CK3 没有保存、但希望世界长期承认的 RP 事实。", currentBranch: "当前分支", thisMemory: "这条世界记忆", confirmDelete: "确定永久删除“{{title}}”吗？这会移除这条记忆及其修订记录；如果只是暂时不召回，请使用“隐藏”。", processing: "正在处理，请稍候……", errorPrefix: "操作未完成：", close: "关闭", cancel: "取消", edit: "编辑", hide: "隐藏", restore: "恢复生效", restoreAutomatic: "恢复自动来源", delete: "删除", viewHistory: "查看修订", developerDetails: "开发者详情", loadEarlier: "加载更早版本", previousPage: "上一页", nextPage: "下一页", noDate: "无日期", revision: "修订 {{revision}}", historySummary: "修订记录 · {{count}} 条", historyLine: "#{{revision}} · {{updatedAt}} · {{reason}} · {{status}}：{{content}}", testMemory: "测试这条记忆", refresh: "刷新", open: "打开世界记忆" },
    test: { willRecall: "这条记忆会被召回", willNotRecall: "这条记忆不会被召回", reason: "原因：{{reason}}", metricPermission: "权限：{{value}}", metricTime: "时间：{{value}}", metricBranch: "分支：{{value}}", metricTruth: "CK3 当前事实：{{value}}", metricTokens: "Token：{{count}}", allowed: "允许", blocked: "阻止", safe: "安全", match: "一致", mismatch: "不一致", conflict: "冲突", noConflict: "无冲突", truthConflict: "当前状态与 CK3 冲突，回答将服从 CK3。", claimValues: "CK3 当前状态：{{current}} · 世界记忆：{{memory}}", unavailableValue: "无法读取", pastEventHelp: "改为过去事件时，请同时把正文中的“现在 / 目前”等措辞改成过去时。", promptPreview: "查看最终召回预览", responder: "测试 NPC", query: "测试问题", queryPlaceholder: "输入角色可能提出的问题", run: "运行召回测试", help: "选择一个 NPC，输入它可能会问的问题；测试只读，不会修改存档或记忆。", convertToPast: "改为过去事件", cancelCurrentClaim: "取消当前状态声明", hideRecord: "隐藏此记录" },
    form: { editTitle: "编辑世界记忆", newTitle: "新增长期记忆", intro: "用玩家能理解的语言描述这件事。", hideTemplates: "收起模板", showTemplates: "从模板开始", title: "标题", content: "希望世界长期记住的内容", contentHelp: "写清楚发生了什么、涉及谁、达成了什么约定；不要覆盖 CK3 当前地点、生死、领主等状态。", temporalMode: "这件事从什么时候成立？", currentDateHelp: "当前状态必须使用当前游戏日期，并由 CK3 核对。", dateHelp: "当前游戏日期会随当前检查点写入；长期规则不绑定日期。", type: "记忆类型", specificDate: "具体日期", specificDateHelp: "格式如 1171.9.20 或 1171年9月20日", plannedDate: "计划日期（可选）", plannedDateHelp: "留空表示尚未确定日期；也可输入 1171年9月20日。", visibility: "谁可以知道？", importance: "重要性", importanceHelp: "重要 / 关键记忆更适合固定在本次对话中提醒。", entities: "涉及人物（可选）", entitiesCurrentHelp: "当前状态至少需要选择一名人物。", entitiesHelp: "搜索并选择这条记忆涉及的人物；不选择也可以保存。", currentState: "这是人物当前状态，需要用 CK3 核对", currentStateHelp: "只支持所在地、生死、信仰、文化、领主和所在宫廷。状态值由 CK3 只读返回，不能手动填写；过去事件不要开启。", claimPerson: "要核对哪个人物？", choosePerson: "请先选择涉及人物", claimField: "要核对哪项状态？", readCurrentTruth: "读取 CK3 当前事实", truthPreview: "当前事实只读预览", truthValue: "CK3 当前{{field}}：{{value}}", truthHelp: "保存时由服务端再次核验；不会接受手动填写的当前值。", truthUnavailable: "暂时无法读取当前事实", truthRecheck: "编辑已有记录时需要重新读取 CK3 当前事实。", truthEmptyHelp: "选择人物和状态后，点击“读取 CK3 当前事实”生成只读预览。", knownBy: "谁明确知道？", knownByHelp: "个人记忆和秘密必须用人物列表授权；不会自动把正文共享给其他 NPC。", scopePerson: "范围以谁为准？", defaultScopePerson: "默认使用第一个涉及人物", conversationReminder: "对话提醒", keepInConversation: "在本次对话中持续提醒 NPC", conversationReminderHelp: "仍受权限、时间和 CK3 当前事实限制。", conversationReminderIneligible: "仅适合重要 / 关键级别的长期世界规则或政治决定。", conflictKey: "冲突标识（通常留空）", conflictKeyHelp: "系统会按人物、类型和标题自动生成；只有需要合并同一事项时才覆盖。", saveRevision: "保存修订", confirmCreate: "确认新增", supersede: "以新记录替代", currentDateNote: "将以当前游戏日期 {{date}} 成立。", readingDate: "读取中的日期", titlePlaceholder: "输入记忆标题", contentPlaceholder: "用自己的语言描述事实；保存后正文保持原文。", datePlaceholder: "例如 1171.9.20", conflictKeyPlaceholder: "通常留空" },
    templates: { promise: "某人答应过一件事", secret: "两个人达成秘密约定", event: "世界发生了一件 CK3 没记录的事件", rule: "长期世界规则", plan: "未来计划" },
    branch: { unconnected: "未连接当前存档", rollback: "检测到存档回档", forkDetected: "检测到复制存档 / 新分支", chooseResume: "需要选择要恢复的分支", confirmLoadBoundary: "需要确认载入边界", bound: "已安全绑定", resumeTitle: "选择要恢复的存档分支", newLoadSession: "检测到新的 CK3 载入会话", continuityConfirm: "存档连续性需要确认", notBound: "当前存档尚未安全绑定", resumeAria: "选择要恢复的分支", chooseHistorical: "选择历史分支", resumeSelected: "恢复所选分支", continueCurrent: "继续当前分支", confirmContinuity: "确认延续当前分支", createIndependent: "建立独立分支（不继承旧 Canon）", rollbackHelp: "当前存档看起来回到了更早的检查点。请确认是否继续原分支；在确认前不会写入世界记忆。", ambiguousHelp: "检测到多个可能的历史分支，请明确选择；系统不会自动猜测。", loadBoundaryHelp: "检测到 CK3 重新载入或新的游戏会话。请明确选择继续当前分支，或建立不继承旧 Canon 的独立分支；系统不会自动把两段存档接在一起。", continuityHelp: "只有确定这是原分支的继续游玩时才确认；复制存档应建立独立分支。", rebindHelp: "请重新读取存档，或明确建立不继承旧 Canon 的独立分支。", renamedQuestion: "存档只是重命名？", renamedHelp: "只有内容指纹相同、且当前分支从未写入时，才保留原分支记忆。复制存档请保持独立。", renameAria: "重命名前的存档", chooseSource: "选择原存档", confirmRename: "确认重命名", developerInfo: "分支技术信息" },
    recall: { disabled: "NPC 暂时不会读取世界记忆。", hideSteps: "收起开启步骤", openSteps: "前往开启", stepsIntro: "请开启以下两项：", stepsHelp: "只会改变世界书召回设置，不会改变模型，也不会修改 CK3 存档。", enableRecommended: "一键开启推荐设置" },
    legacy: { found: "发现 {{count}} 条旧版补充知识（只读）", help: "这些是旧版本留下的兼容记录，只能查看；迁移为 Canon 前不会修改原文，也不会自动覆盖当前 CK3 事实。", reviewTitle: "迁移审阅", confirmTitle: "迁移确认", reviewHelp: "这条记录包含非公开可见范围，请确认迁移后的权限和知情人物；确认后才会进入 Canon。", migrationMeta: "可见范围：{{visibility}} · 重要性：{{importance}}", knownBy: "重新选择明确知情人物", knownByHelp: "旧记录不会自动沿用可能不准确的权限；请按当前存档重新授权。", scopePerson: "重新选择范围人物", scopeHelp: "系统会按该人物当前所属宫廷或领地判断可见范围。", migrated: "这条旧记录已经迁移为 Canon。", confirmMigration: "确认迁移为 Canon", untitled: "无标题", statusMigrated: "已迁移", readOnly: "只读", migratedAsMemory: "已迁移为世界记忆", viewDraft: "查看迁移草稿" },
    list: { title: "已有世界记忆", count: "{{shown}} / {{total}}", empty: "当前存档还没有长期记忆。" },
    developer: { record: "记录：{{id}}", recordBranch: "分支：{{branch}} · 修订：{{revision}}", entities: "涉及人物：{{entities}} · 知情人物：{{knownBy}}", conflictKey: "冲突标识：{{value}}", entitiesRuntimeId: "涉及人物 Runtime ID：{{ids}}", knownByRuntimeId: "知情人物 Runtime ID：{{ids}}", scopeRuntimeId: "范围人物 Runtime ID：{{id}}", branch: "Campaign：{{campaign}} · Branch：{{branch}} · Revision：{{revision}}" },
    warnings: { duplicateCanon: "同事项存在不同 Canon，召回时禁止随机选边", currentTruthUnverified: "当前状态声明必须经过 CK3 验证；缺少结构化证据时不注入", planned: "未来计划将以“尚未发生”的方式召回", future: "未来记录：当前不可召回", generic: "这条记忆当前无法召回。" }
  },
  legacyUi: {
    nav: { optimization: "优化", worldline: "世界书", providerDiagnostics: "诊断", themeGroup: "界面风格", themeParchment: "游牧风格", themeKnight: "骑士纹章风格", themeInk: "水墨画卷风格" },
    conversation: {
      generating: "正在生成回复", thinking: "正在思考",
      presence: {
        titleBefore: "选择入场人物", titleAfter: "会话人物", busyUpdating: "正在更新在场名单…", busyLocked: "正在生成回复或处理队列，人物切换暂不可用。",
        join: "请入内", setWaiting: "设为候场", alreadyPresent: "已在场", deceased: "已故", left: "已离场",
        temporaryLeave: "暂时离场…", unconscious: "昏迷", asleep: "睡着", temporarilyAway: "暂时离开",
        inviteBack: "请回来", leave: "请离场", mustKeepOne: "须保留一人"
      },
      usage: {
        recentMemory: "最近记忆", officialRecollections: "官方追忆", playerLedger: "玩家关系事项簿", stableMemory: "稳定记忆", timeMemory: "时间记忆", thirdPartyMemory: "第三人记忆",
        provider: "服务商提供", providerModel: "服务商模型信息", providerCapped: "受服务商上限限制", userSetting: "用户设置", userUnverified: "用户设置，未经服务商确认", safeFallback: "保守回退", invalidFallback: "配置无效，保守回退",
        requestSnapshot: "请求快照", generatingPhase: "生成中", completed: "已完成", stopped: "已停止", failed: "请求失败",
        inputProvider: "服务商用量", inputEstimate: "估算（含 1.1 系数）", outputProvisional: "生成中暂估", estimate: "估算", mixedEstimate: "混合估算",
        unknown: "未知", nameUnavailable: "姓名未载入", sourceUnknown: "来源未知", configuredContextLength: "已配置上下文长度", sceneCapacity: "本场场景容量：{{capacity}} Token（{{source}}）", knownMaxUsage: "已知最大占用", maxUsage: "最大占用",
        usedByResponder: "{{name}} · {{tokens}} Token · {{phase}}", sceneRemaining: "本场配置窗口余量：{{tokens}} Token", peakProvider: "峰值请求 Provider：{{provider}} · 模型：{{model}}",
        providerWindow: "该请求服务商有效窗口：{{tokens}} Token（{{source}}）", inputOutput: "本次请求输入（完整 Prompt）：{{inputSource}} {{inputTokens}} Token · 本次输出：{{outputSource}} {{outputTokens}} Token",
        providerRemaining: "该请求 Provider 窗口余量：{{tokens}} Token", headroom: "该请求发送前可追加输入估算：{{headroom}} Token（有效输入预算 {{budget}}，已扣输出预留 {{reserved}}、协议开销 {{overhead}}、安全余量 {{margin}}）",
        responderRecent: "各 NPC 最近请求：{{rows}}", responderRow: "{{name}}：{{tokens}} Token · {{phase}} · Provider 窗口 {{window}} Token",
        sceneMaxExplanation: "本场占用取各 NPC 最近请求中的最大单次用量，不把不同 NPC 的请求相加。", unknownUsageWarning: "部分 NPC 的最近请求用量未知，因此峰值只覆盖已知用量。",
        ariaLabel: "上下文用量", heading: "本场对话上下文", subtitle: "各 NPC 最近请求的最大占用", knownMax: "已知最大", max: "最大",
        rowSummary: "{{maxLabel}} · {{source}} {{used}} / {{capacity}} Token · 场景余量 {{remaining}}"
      }
    },
    summary: {
      retrying: "正在重试摘要…", retryFailed: "重试失败摘要/信件归档", sortTitleRecent: "最近日期在上；点击切换为原文件顺序", sortTitleFile: "点击按日期排序，最近日期在上", sortByDate: "按日期排序",
      retryConfirmation: "将使用当前摘要模型重试失败的对话摘要或信件归档，可能产生 API 费用。不会重新发送信件。请先确认模型配置和余额可用。继续？",
      regenerateConfirmation: "将把“{{owner}} ↔ {{counterpart}}”的 {{date}} 摘要正文发送给当前摘要模型整理，可能产生 API 费用。手工版本保留，其他人物摘要不变；正文生成失败时保留原文。继续？",
      overviewHelp: "查看、筛选、编辑和删除本地人物摘要；CK3 官方追忆保持只读同步。", localSummaries: "本地摘要", characterDirectories: "人物摘要目录", conversationFiles: "对话摘要文件", summaryRecords: "摘要记录",
      searchPlaceholder: "输入人物姓名：定位本人目录，并列出其他人涉及此人的摘要", clear: "清除", dateFilterAria: "摘要日期筛选", startDate: "开始日期", endDate: "结束日期", clearDateFilter: "清除日期筛选",
      bindingScan: "预扫描/绑定中…", bindOwner: "绑定此人物全部旧摘要（{{count}}）", bindConversation: "绑定本对话全部旧摘要（{{count}}）", officialTag: "官方追忆摘要（随新对话更新）",
      binding: "绑定中…", bindCurrentCampaign: "绑定当前战役", regenerateTitle: "通过当前摘要模型重新整理本篇摘要", regenerating: "模型整理中…", regenerate: "模型整理",
      showFullText: "查看全文", importantMatters: "重要事项", paginationAria: "摘要分页", previous: "上一页", pageStatus: "第 {{page}} / {{total}} 页 · {{count}} 篇", next: "下一页",
      recallDiagnostics: "记忆召回诊断（最近实际请求）", recoveryDiagnostics: "摘要恢复诊断", providerCacheDiagnostics: "Provider 缓存诊断", noDate: "无日期"
    },
    letters: { retrying: "重试中…", retryGeneration: "手动重试回复生成", rereading: "重新读取中…", rereadData: "重新读取信件数据", cleared: "已清除" },
    provider: {
      userLimitVerified: "用户设置的限制；服务商报告上下文长度：{{context}} Token。", userLimitUnverified: "用户设置的限制；服务商上下文尚未核实。",
      mode: "模式：", invalid: "无效", source: "来源：", configured: "已配置：", verifiedNative: "服务商原生已验证：", unknownUnverified: "未知／未核实", effective: "有效值：",
      savedModeInvalid: "已保存的上下文模式无效；修正前，请求预算会安全回退到 8,192 tokens。", enterWholeNumber: "请输入 256 到 2,000,000 之间的整数。",
      glmUnknownContext: "当前 GLM 未提供经验证的上下文窗口。Auto 按 8,192 Token 保守回退；此前兼容设置为 90,000 Token，未经原生验证。", exceedsNative: "⚠️ 请求上下文超过服务商报告的模型上下文（{{context}}）；有效上限将按服务商值截断。",
      useCompatibility: "使用 90K 兼容设置", keepAuto: "保持 Auto", custom: "自定义", availableInput: "可用输入（空消息预算估算）: ", outputReserve: "输出预留: ",
      budgetRecheck: "实际消息仍会由完整请求预算守卫复核。", noAvailableInput: "此设置无法为当前输出预留、安全余量和协议开销留下可用输入；请提高 Custom 值或降低输出上限。发送时仍会由预算守卫阻止不合适的请求。"
    }
  }
};

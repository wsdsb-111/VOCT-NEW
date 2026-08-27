"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const memorySystem = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const { MemoryEngine, MemoryExtractor, MentionTracker, buildPerspectiveSummaryMap, validatePerspectiveSummaryMap } = memorySystem;
const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "action-system", "conversation"));

const participants = [
  { id: 1, name: "甲", shortName: "甲" },
  { id: 2, name: "乙", shortName: "乙" },
  { id: 3, name: "丙", shortName: "丙" }
];
const extraction = {
  sessionSummary: "全知摘要不得直接复制。",
  summarySegments: [
    { segmentId: "shared_scene", content: "甲、乙共同听见丙说明城中粮草只够三日，三人随后逐项商定守门、运粮和次日复核账册的安排。", participants: [1, 2, 3], knownBy: [1, 2, 3], provenance: { messageIds: [1, 2, 3], speakerIds: [3] } },
    { segmentId: "private_scene_segment", content: "甲独自想到丙可能另藏了一把钥匙，但没有把这项猜测告诉乙。", participants: [1], knownBy: [1], provenance: { messageIds: [4], speakerIds: [1] } }
  ],
  memories: [
    { memoryId: "public", type: "event", content: "三人公开商定明日议事。", participants: [1, 2, 3], subjects: [], knownBy: [1, 2, 3], status: null, importance: 0.6 },
    { memoryId: "private_a", type: "secret", content: "甲心里知道密道位于东门。", participants: [1], subjects: [3], knownBy: [1], status: "open", importance: 0.95 },
    { memoryId: "private_scene", type: "secret", content: "甲在三人场合想到丙藏着另一把钥匙。", participants: [1, 2, 3], subjects: [3], knownBy: [1], status: "open", importance: 0.95, provenance: { speakerIds: [1] } },
    { memoryId: "promise_b", type: "promise", content: "乙答应替甲守住城门。", participants: [1, 2], subjects: [1], knownBy: [2], status: "open", importance: 0.9 }
  ]
};
const projections = buildPerspectiveSummaryMap({ participants, excludedSummaryOwnerIds: [] }, extraction);
assert.strictEqual(validatePerspectiveSummaryMap({ participants }, extraction, projections).success, true);
assert(!projections.get("1->2").content.includes("密道位于东门"), "甲对乙的档案不得混入只与丙有关的秘密");
assert(!projections.get("1->2").content.includes("另一把钥匙"), "共同在场不能让只以丙为主题的记忆串入甲对乙档案");
assert(projections.get("1->2").content.includes("粮草只够三日"), "共同知晓的多人场景细节必须进入共同在场人物的有向摘要");
assert(!projections.get("1->2").content.includes("没有把这项猜测告诉乙"), "仅 owner 知道的叙事片段不得写入与不知情 counterpart 的共同摘要");
assert(projections.get("1->3").content.includes("密道位于东门"), "甲对丙的档案应保留甲知道且与丙相关的秘密");
assert(!projections.get("2->1").content.includes("密道位于东门"), "乙的投影不得出现只有甲知道的秘密");
assert(!projections.get("3->1").content.includes("密道位于东门"), "丙的投影不得出现只有甲知道的秘密");
assert(projections.get("2->1").pinned, "承诺、秘密和未决事项必须钉住");
assert.notStrictEqual(projections.get("1->2").content, projections.get("1->3").content, "同一 owner 的不同 counterpart 文件不得复制同一段全量正文");
const sleepBoundaryExtraction = {
  sessionSummary: "甲睡着前与乙交谈；甲睡着后，乙独自为甲掖被并在心中决定继续照顾甲。",
  summarySegments: [
    { segmentId: "before_sleep", content: "甲睡着前与乙共同谈到夜间休息。", participants: [1, 2], knownBy: [1, 2], provenance: { messageIds: [10], speakerIds: [1, 2] } },
    { segmentId: "after_sleep_private", content: "甲睡着后，乙独自为甲掖被并在心中决定继续照顾甲。", participants: [2], knownBy: [2], provenance: { messageIds: [11], speakerIds: [2] } }
  ],
  memories: [
    { memoryId: "private_after_sleep_plan", type: "plan", content: "乙在甲睡着后独自决定继续照顾甲。", participants: [2], subjects: [1], knownBy: [2], status: "open", importance: 0.9, provenance: { messageIds: [11], speakerIds: [2] } }
  ]
};
const sleepBoundaryProjections = buildPerspectiveSummaryMap({ participants: participants.slice(0, 2) }, sleepBoundaryExtraction);
assert(sleepBoundaryProjections.get("1->2").content.includes("共同谈到夜间休息"), "睡着前共同知情的内容必须保留");
assert(!sleepBoundaryProjections.get("1->2").content.includes("独自为甲掖被"), "睡着者视角不得获得睡着后的私密行动和内心决定");
assert(sleepBoundaryProjections.get("2->1").content.includes("独自决定继续照顾甲"), "知情者自己的有向摘要必须保留睡着后的私密长期事项");
const tampered = new Map(projections);
tampered.set("1->2", { ...projections.get("1->2"), memoryIds: [...projections.get("1->2").memoryIds, "private_a"], content: `${projections.get("1->2").content}\n- 甲心里知道密道位于东门。` });
assert.strictEqual(validatePerspectiveSummaryMap({ participants }, extraction, tampered).success, false, "配对校验必须拒绝 owner 已知但与 counterpart 无关的串主题记忆");
for (let participantCount = 2; participantCount <= 6; participantCount++) {
  const group = Array.from({ length: participantCount }, (_, index) => ({ id: index + 20, name: `人物${index + 1}` }));
  const groupExtraction = {
    sessionSummary: "多人对话",
    memories: [{ memoryId: `group_${participantCount}`, type: "event", content: `${participantCount}人共同议事。`, participants: group.map((entry) => entry.id), subjects: [], knownBy: group.map((entry) => entry.id), importance: 0.6 }]
  };
  const groupProjections = buildPerspectiveSummaryMap({ participants: group }, groupExtraction);
  assert.strictEqual(groupProjections.size, participantCount * (participantCount - 1), `${participantCount}人对话必须为每个有向人物目录生成投影视图`);
  assert.strictEqual(validatePerspectiveSummaryMap({ participants: group }, groupExtraction, groupProjections).success, true);
}

const ambiguous = [];
const tracker = new MentionTracker({ onUnresolved: (entry) => ambiguous.push(entry) });
const ambiguousProfiles = [
  { id: 10, shortName: "赵王", mentionAliases: ["殿下"] },
  { id: 11, shortName: "太子", mentionAliases: ["殿下"] }
];
assert.deepStrictEqual(tracker.findMentionedCharacterIds([{ content: "殿下对此有何看法？" }], { candidates: ambiguousProfiles }), []);
assert(ambiguous.some((entry) => entry.alias === "殿下" && entry.reason === "ambiguous_alias"), "同称号失败关闭时必须留下可观察记录");
const longest = tracker.findMentionedCharacterIds([{ content: "李师师今日入宫。" }], {
  candidates: [{ id: 12, shortName: "李师" }, { id: 13, shortName: "李师师" }]
});
assert.deepStrictEqual(longest, [13], "中文最长唯一名称必须压过短名");
const mentionState = tracker.createState();
assert.deepStrictEqual(tracker.update(mentionState, {
  history: [{ id: 1, content: "昨日见过诸葛亮。" }, { id: 2, content: "那个人后来去了江南。" }],
  candidates: [{ id: 14, shortName: "诸葛亮" }]
}), [14], "那个人必须绑定本场最近的明确第三人称对象");

function writeSummary(summaryRoot, owner, counterpart, values) {
  const folder = path.join(summaryRoot, `${owner.id}_${owner.name}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `与${counterpart.name}的对话.json`), JSON.stringify(values.map((value) => ({
    schemaVersion: 3,
    playerId: owner.id,
    playerName: owner.name,
    characterId: counterpart.id,
    characterName: counterpart.name,
    participants: [owner, counterpart],
    ...value
  }))), "utf8");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v771-memory-23-"));
try {
  const summaryRoot = path.join(tempRoot, "conversation_summaries");
  const A = { id: 1, name: "甲" };
  const B = { id: 2, name: "乙" };
  const X = { id: 9, name: "诸葛亮" };
  writeSummary(summaryRoot, B, A, [
    { finalizationId: "recent_3", totalDays: 30, content: "乙与甲最近谈过茶宴。" },
    { finalizationId: "recent_2", totalDays: 20, content: "乙与甲最近商量巡城。" },
    { finalizationId: "pinned_old", totalDays: 1, content: "乙答应甲永远守住城门。", pinned: true, open: true }
  ]);
  writeSummary(summaryRoot, B, X, [
    { finalizationId: "x_2", totalDays: 25, content: "诸葛亮曾向乙谈起北伐。" },
    { finalizationId: "x_1", totalDays: 5, content: "诸葛亮与乙讨论粮草运输。" }
  ]);
  const engine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory"), summaryFoldersDir: summaryRoot, trace: { record() {} } });
  const sessionRecallCache = new Map();
  const common = {
    characterId: B.id,
    directCounterpartIds: [A.id],
    mentionedEntityIds: [X.id],
    mentionedEntityNames: { [X.id]: [X.name] },
    sessionRecallCache,
    tokenBudget: 1200,
    currentTotalDays: 40,
    estimateTokens: (text) => String(text).length
  };
  const first = engine.retrieveForResponder({ ...common, query: "诸葛亮北伐" });
  const second = engine.retrieveForResponder({ ...common, query: "粮草运输" });
  assert.strictEqual(first.engineVersion, "2.5");
  assert.strictEqual(first.stableText, second.stableText, "稳定长期记忆必须整场字节冻结");
  assert.strictEqual(first.directStableText, second.directStableText, "直接关系最近两条与钉住记忆必须整场冻结");
  assert.strictEqual(first.mentionedSnapshotText, second.mentionedSnapshotText, "场外人物快照的内容和顺序必须整场冻结");
  assert.strictEqual(first.topicPatchText, second.topicPatchText, "一场对话最多锁定一次话题补丁正文");
  assert(first.directStableText.includes("永远守住城门"), "旧承诺不得被近期闲聊挤掉");
  assert(first.topicPatch.length <= 1, "直接关系和场外人物必须共用一个后缀补丁预算");

  const ownerFolder = path.join(summaryRoot, "2_乙");
  const beforeFiles = fs.readdirSync(ownerFolder).sort();
  engine.markSummaryOwnerDeceased(B.id, { totalDays: 40 });
  assert.strictEqual(engine.isSummaryOwnerDeceased(B.id), true);
  assert.deepStrictEqual(fs.readdirSync(ownerFolder).sort(), beforeFiles, "死亡只能写墓碑，不能删除人物摘要目录");
  engine.reviveSummaryOwner(B.id);
  assert.strictEqual(engine.isSummaryOwnerDeceased(B.id), false, "读档或复活后必须能够揭除墓碑");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const promptRuntimeSource = [
  "config/settings-repository.js",
  "prompts/prompt-builder.js",
  "analytics/usage-analytics.js"
].map((relativePath) => fs.readFileSync(path.join(root, "resources", "app", "out", "main", ...relativePath.split("/")), "utf8")).join("\n");
const providerServiceSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "provider-service.js"), "utf8");
const extractionPrompt = new MemoryExtractor().buildPrompt({ participants })[0].content;
assert(!providerServiceSource.includes('thinking: { type: "enabled" }, max_tokens: 12288'), "DeepSeek 终局摘要必须彻底关闭思考");
assert(providerServiceSource.includes('thinking: { type: "disabled" }, max_tokens: structuredSummaryMaxTokens'), "终局摘要、重试与恢复必须统一关闭思考并使用配置的输出上限");
assert(providerServiceSource.includes('metadata?.maxTokens') && providerServiceSource.includes('requestedMaxTokens >= 256 && requestedMaxTokens <= 16384'), "终局摘要输出上限必须由受限的用户配置传入请求");
assert(extractionPrompt.includes("Do not copy every scene participant into subjects"), "摘要提取必须明确区分参与者与主题人物，避免多人场景把所有人复制为同一主题");
assert(extractionPrompt.includes("There is no fixed character or word count"), "终局摘要不得再设置固定字数范围");
assert(extractionPrompt.includes("attribute every action, statement, belief and emotion to the correct named character"), "摘要必须逐人归属言行、观点和情绪");
assert(extractionPrompt.includes("Never replace concrete details with generic phrases"), "摘要不得用泛化措辞替代具体对话事实");
assert(extractionPrompt.includes("exact numbers, dates, locations, titles, objects and quoted terms"), "摘要必须保留可核验的数字、日期、地点、头衔、物件和关键措辞");
assert(extractionPrompt.includes("at most 10 high-value durable memories"), "结构化记忆条目必须限制为最多 10 条以保护 4096 Token JSON");
assert(extractionPrompt.includes("as concise as possible without losing substantive content"), "终局摘要必须要求精简表达但不得丢失实质内容");
assert(extractionPrompt.includes("knowledge audience materially changes"), "终局摘要必须在知情范围变化时拆分叙事片段");
assert(extractionPrompt.includes("asleep, unconscious, absent or has left"), "睡着、昏迷、不在场或离场人物不得获得无法感知的内容");
assert(extractionPrompt.includes("private thoughts, silent intentions, self-talk and unobserved actions"), "私密想法、自言自语和未被观察的行动必须与共享事件分段");
assert(extractionPrompt.includes("Do not impose a fixed character count on an individual memory"), "单条长期记忆也不得设置固定字数范围");
assert(extractionPrompt.includes('"summarySegments"'), "终局输出必须包含可按在场窗口投影的详细叙事片段");
assert(extractionPrompt.toLowerCase().includes("do not repeat the same narrative in a separate sessionsummary"), "叙事正文不得在 JSON 中重复占用输出预算");
assert(promptRuntimeSource.includes("摘要不设置固定字数或段落数量"), "默认终局摘要提示词必须取消固定字数限制");
assert(promptRuntimeSource.includes("在不遗漏实质内容、人物归属、因果关系和关键细节的前提下尽量精简"), "默认终局摘要提示词必须要求精简但不失内容");
assert(promptRuntimeSource.includes("知情范围发生变化时必须分段"), "默认终局摘要提示词必须防止睡着或独处内容泄漏给不知情角色");
assert(promptRuntimeSource.includes("不得笼统写成“双方讨论了某事”"), "默认终局摘要提示词必须禁止泛化压缩");
assert(promptRuntimeSource.indexOf('label: "Frozen Direct Relationship Memory"') < promptRuntimeSource.lastIndexOf('case "history"'), "直接关系冻结块必须位于带 Token 统计的 history 前");
assert(promptRuntimeSource.includes('label: "Turn Topic Memory Patch"'), "话题补丁必须作为独立可观测块放在 history 后");
assert(promptRuntimeSource.includes("prefixFingerprintMatchesPrevious"), "缓存统计必须记录并核验 history 前稳定区块指纹");
assert(promptRuntimeSource.includes('entry.characterId ?? entry.character ?? ""'), "缓存前缀比较必须按回应人物 ID 隔离，不能跨 NPC 误判");
Conversation.configure({ createPromptFingerprint: (value) => require("crypto").createHash("sha256").update(String(value)).digest("hex").slice(0, 16) });
const prefixBase = [
  { block: { id: "anchor", label: "Anchor", type: "cache_anchor" }, content: "stable", tokens: 2 },
  { block: { id: "direct", label: "Frozen Direct Relationship Memory", type: "memory_direct_frozen" }, content: "same direct", tokens: 3 },
  { block: { id: "history", label: "History", type: "history" }, content: "old turn", tokens: 2 },
  { block: { id: "current", label: "Current User Message", type: "current_user" }, content: "first question", tokens: 2 }
];
const firstPromptContract = Conversation.buildPromptBlockMetadata({ blocks: prefixBase });
const secondPromptContract = Conversation.buildPromptBlockMetadata({ blocks: prefixBase.map((entry) => entry.block.type === "history" ? { ...entry, content: "old turn plus reply" } : entry.block.type === "current_user" ? { ...entry, content: "second question" } : entry) });
assert.strictEqual(firstPromptContract.prefixFingerprint, secondPromptContract.prefixFingerprint, "history 和当前问题变化不得改变 history 前区块指纹");
assert.strictEqual(firstPromptContract.historyStartPosition, 2, "首个允许变化点必须从 history 开始");
const changedPrefixContract = Conversation.buildPromptBlockMetadata({ blocks: prefixBase.map((entry) => entry.block.id === "direct" ? { ...entry, content: "changed direct" } : entry) });
assert.notStrictEqual(firstPromptContract.prefixFingerprint, changedPrefixContract.prefixFingerprint, "history 前任一字节变化必须反映到前缀指纹");

(async () => {
  const strictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v771-structured-retry-"));
  try {
    const strictEngine = new MemoryEngine({ baseDir: path.join(strictRoot, "memory"), summaryFoldersDir: path.join(strictRoot, "summaries"), trace: { record() {} } });
    let attempts = 0;
    const requestOptions = [];
    const requestPrompts = [];
    const longMessages = Array.from({ length: 18 }, (_, index) => ({
      id: index + 1,
      role: index % 2 === 0 ? "user" : "assistant",
      name: index % 2 === 0 ? "甲" : "乙",
      content: `第${index + 1}轮围绕粮草、守门、家人安危和次日安排展开了具体交谈。`.repeat(3)
    }));
    const detailedSegment = "甲先说明粮草不足和城门守备的风险，乙逐项回应并提出运粮、换岗与次日核对账册的办法；两人还谈到家人安危、彼此顾虑和未决条件，最后明确了执行顺序与再次确认的时间。".repeat(7);
    const strictResult = await strictEngine.finalizeConversation({
      conversationId: "structured-retry",
      participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 0 }],
      messages: longMessages,
      buildPrompt: () => [],
      requestSummary: async (prompt, options) => {
        requestPrompts.push(prompt);
        requestOptions.push(options);
        attempts += 1;
        return attempts === 1
          ? { content: JSON.stringify({ sessionSummary: "虽然请求没有截断，但只给出三句话的过短摘要。", memories: [] }), finish_reason: "stop" }
          : { content: JSON.stringify({
            summarySegments: [{ content: detailedSegment, participants: [1, 2], visibility: "participants", messageIds: longMessages.map((message) => message.id), speakerIds: [1, 2] }],
            memories: [{ type: "plan", content: "甲乙商定先运粮换岗，次日再核对账册并确认家人安置。", participants: [1, 2], subjects: [1, 2], messageIds: [1, 2, 17, 18], speakerIds: [1, 2] }]
          }), finish_reason: "stop" };
      },
      persistCharacterFolders: async () => ({ success: true })
    });
    assert.strictEqual(strictResult.success, true);
    assert.strictEqual(attempts, 2, "未截断但严重过短的终局正文也必须重试，不能提交低质量结果");
    assert.deepStrictEqual(requestOptions.map((options) => options.attempt), [1, 2], "终局摘要应保留两次非思考重试机会");
    assert(requestPrompts[1].some((message) => String(message.content || "").includes("quality correction")), "第二次请求必须明确告知模型修复详细度和分段结构");
    assert(strictResult.finalSummary.includes("执行顺序"), "修复重试后的终局摘要必须保留具体事件细节");
    assert(strictResult.directedSummaries.get("1->2").content.includes("执行顺序"), "详细叙事片段必须真正进入人物有向摘要文件");
    assert(requestOptions.every((options) => !("forceNonThinking" in options)), "Memory Engine 不应再请求思考摘要");

    const pairRoot = path.join(strictRoot, "two-person-boundary");
    const pairSummaryRoot = path.join(pairRoot, "summaries");
    const pairEngine = new MemoryEngine({ baseDir: path.join(pairRoot, "memory"), summaryFoldersDir: pairSummaryRoot, trace: { record() {} } });
    const pairMessages = Array.from({ length: 10 }, (_, index) => ({
      id: index,
      role: index % 2 === 0 ? "user" : "assistant",
      name: index % 2 === 0 ? "甲" : "乙",
      content: "双方围绕具体事件、人物态度、承诺条件与后续安排继续交谈。".repeat(4).slice(0, 120)
    }));
    let pairRequests = 0;
    const pairResult = await pairEngine.finalizeConversation({
      conversationId: "two-person-1200-char-boundary",
      participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 0 }],
      messages: pairMessages,
      buildPrompt: () => [],
      requestSummary: async () => {
        pairRequests += 1;
        return {
          content: JSON.stringify({
            summarySegments: [{ content: "详".repeat(452), participants: [1, 2], visibility: "participants", messageIds: pairMessages.map((message) => message.id), speakerIds: [1, 2] }],
            memories: [{ type: "plan", content: "甲乙确认后续安排。", participants: [1, 2], subjects: [1, 2], messageIds: [8, 9], speakerIds: [1, 2] }]
          }),
          finish_reason: "stop"
        };
      },
      persistCharacterFolders: async (_summary, context) => {
        assert.strictEqual(context.directedSummaries.size, 2, "双人终局必须产生 A→B 与 B→A 两份投影");
        for (const [key, projection] of context.directedSummaries) {
          const filePath = path.join(pairSummaryRoot, `${key.replace("->", "_to_")}.json`);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, JSON.stringify(projection), "utf8");
        }
        return { success: true };
      }
    });
    assert.strictEqual(pairResult.success, true, `双人有效结构化摘要不得因任何固定字数门槛丢失全部人物目录: ${pairResult.error?.message || "unknown"}`);
    assert.strictEqual(pairRequests, 1, "达到自适应质量底线的双人摘要不应白白重复请求 Provider");
    assert(fs.existsSync(path.join(pairSummaryRoot, "1_to_2.json")) && fs.existsSync(path.join(pairSummaryRoot, "2_to_1.json")), "双人摘要必须实际生成两个方向的角色文件");

    const recoveryRoot = path.join(strictRoot, "obsolete-length-recovery");
    const recoveryEngine = new MemoryEngine({ baseDir: path.join(recoveryRoot, "memory"), summaryFoldersDir: path.join(recoveryRoot, "summaries"), trace: { record() {} } });
    const recoveryContext = recoveryEngine.prepareFinalizationContext({
      conversationId: "obsolete-fixed-length-failure",
      participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 0 }],
      messages: pairMessages
    });
    recoveryEngine.writeRecoverySnapshot(recoveryContext, {
      finalizationStage: "request",
      finalizationStatus: "failed_manual",
      retryCount: 3,
      lastError: "final_summary_quality_failed:detailed narrative has 452 chars; require at least 500"
    });
    const recovered = await recoveryEngine.recoverPendingFinalizations({
      buildPrompt: () => [],
      requestSummary: async () => ({
        content: JSON.stringify({
          summarySegments: [{ content: "恢复后的双人详细摘要。", participants: [1, 2], visibility: "participants", messageIds: pairMessages.map((message) => message.id), speakerIds: [1, 2] }],
          memories: []
        }),
        finish_reason: "stop"
      }),
      persistCharacterFolders: async (_summary, context) => ({ success: context.directedSummaries.size === 2 }),
      resolveParticipantProfiles: (snapshot) => snapshot.participants
    });
    assert.strictEqual(recovered.length, 1, "旧固定字数门槛造成的 failed_manual 双人快照必须自动恢复一次");
    assert.strictEqual(recovered[0].success, true, "取消字数门槛后旧双人失败快照必须完成双向提交");
    console.log("VOTC v7.7.1 Memory Engine 2.3: PASS (pair perspectives, leak checks, prefix fingerprints, strict summary retry, mentions, snapshots and tombstones)");
  } finally {
    fs.rmSync(strictRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

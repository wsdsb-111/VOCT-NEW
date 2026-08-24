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
assert(projections.get("1->3").content.includes("密道位于东门"), "甲对丙的档案应保留甲知道且与丙相关的秘密");
assert(!projections.get("2->1").content.includes("密道位于东门"), "乙的投影不得出现只有甲知道的秘密");
assert(!projections.get("3->1").content.includes("密道位于东门"), "丙的投影不得出现只有甲知道的秘密");
assert(projections.get("2->1").pinned, "承诺、秘密和未决事项必须钉住");
assert.notStrictEqual(projections.get("1->2").content, projections.get("1->3").content, "同一 owner 的不同 counterpart 文件不得复制同一段全量正文");
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
  assert.strictEqual(first.engineVersion, "2.3");
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
const providerServiceSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "provider-service.js"), "utf8");
const extractionPrompt = new MemoryExtractor().buildPrompt({ participants })[0].content;
assert(providerServiceSource.includes('isDeepseekStructuredSummary ? { thinking: { type: "enabled" }, max_tokens: 4096'), "DeepSeek 终局摘要必须恢复思考并保留结构化输出预算");
assert(extractionPrompt.includes("Do not copy every scene participant into subjects"), "摘要提取必须明确区分参与者与主题人物，避免多人场景把所有人复制为同一主题");
assert(mainSource.indexOf('label: "Frozen Direct Relationship Memory"') < mainSource.lastIndexOf('case "history"'), "直接关系冻结块必须位于带 Token 统计的 history 前");
assert(mainSource.includes('label: "Turn Topic Memory Patch"'), "话题补丁必须作为独立可观测块放在 history 后");
assert(mainSource.includes("prefixFingerprintMatchesPrevious"), "缓存统计必须记录并核验 history 前稳定区块指纹");
assert(mainSource.includes('entry.characterId ?? entry.character ?? ""'), "缓存前缀比较必须按回应人物 ID 隔离，不能跨 NPC 误判");
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
    const strictResult = await strictEngine.finalizeConversation({
      conversationId: "structured-retry",
      participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 0 }],
      messages: [{ id: 1, role: "user", name: "甲", content: "记住此事。" }],
      buildPrompt: () => [],
      requestSummary: async () => ({ content: ++attempts === 1 ? "非 JSON 思考残片" : JSON.stringify({ sessionSummary: "甲请乙记住此事。", memories: [] }) }),
      persistCharacterFolders: async () => ({ success: true })
    });
    assert.strictEqual(strictResult.success, true);
    assert.strictEqual(attempts, 2, "非结构化终局正文必须立即重试，不能按 prose fallback 提交");
    console.log("VOTC v7.7.1 Memory Engine 2.3: PASS (pair perspectives, leak checks, prefix fingerprints, strict summary retry, mentions, snapshots and tombstones)");
  } finally {
    fs.rmSync(strictRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

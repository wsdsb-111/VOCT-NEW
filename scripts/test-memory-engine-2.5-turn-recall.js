"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { MemoryEngine, turnRecall } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory-25-recall-"));
const makeMemory = (id, content, subjects, participants, totalDays, tags = []) => ({
  memoryId: id,
  type: "folder_summary",
  epistemicStatus: "known",
  content,
  canonicalText: content,
  tags,
  subjects,
  participants,
  importance: 0.8,
  confidence: 1,
  totalDays,
  eventDate: "1010年3月2日",
  provenance: { folderOwnerId: 2, finalizationId: id }
});

try {
  const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), summaryFoldersDir: path.join(tempDir, "summaries"), recoveryDir: path.join(tempDir, "recovery"), trace: { record() {} } });
  const memories = [
    makeMemory("relevant", "李师师与玩家曾在御花园约定春末商议婚事。", [1, 2], [1, 2], 990, ["约定", "婚约", "花园"]),
    makeMemory("kaifeng", "李师师与玩家曾在开封城门处理遗失玉佩事件。", [1, 2], [1, 2], 995, ["开封", "玉佩", "事件"]),
    makeMemory("letter", "李师师与玩家曾互通书信，约定妥善保存来信。", [1, 2], [1, 2], 992, ["信件", "书信", "来信"]),
    makeMemory("luoyang", "李师师与玩家曾在洛阳共同平息一场旧日纠纷。", [1, 2], [1, 2], 988, ["洛阳", "旧事", "纠纷"]),
    makeMemory("noise", "李师师昨日更换了琴弦。", [2], [2], 999, ["琴弦"])
  ];
  const cache = new Map();
  const input = {
    characterId: 2,
    query: "你还记得我们上次在花园约定的婚事吗？",
    assistContext: "此前二人谈到春末。",
    entityIds: [1],
    entityNames: ["玩家"],
    participantIds: [1],
    ownerFolderMemories: memories,
    currentTotalDays: 1000,
    tokenBudget: 256,
    estimateTokens: (text) => Math.ceil(String(text).length / 2),
    cache,
    turnEpoch: 3
  };
  const first = engine.retrieveTurnRecall(input);
  assert.strictEqual(first.triggered, true);
  assert.strictEqual(first.selected.length, 1, "Turn Recall must inject Top1 only");
  assert.strictEqual(first.selected[0].memory.memoryId, "relevant");
  assert(first.selected[0].tokens <= 256 && first.selected[0].tokens <= 320, "Turn Recall memory content must obey its independent cap");
  assert.strictEqual(first.tokens, input.estimateTokens(first.text), "analytics must count the complete Turn Recall prompt block");
  assert.match(first.text, /当前回应角色真实可知/);
  assert.match(first.text, /当前 CK3 数据表示现在/);
  assert.match(first.text, /不得编造/);

  const second = engine.retrieveTurnRecall(input);
  assert.strictEqual(second.cacheHit, true, "same turn + responder + query must reuse Turn Recall");
  assert.strictEqual(second.text, first.text);

  for (let turnEpoch = 4; turnEpoch <= 11; turnEpoch++) {
    const unrelated = engine.retrieveTurnRecall({ ...input, query: ["今天天气如何？", "你怎么看？", "继续说。", "坐吧。"][(turnEpoch - 4) % 4], turnEpoch });
    assert.strictEqual(unrelated.triggered, false, "ordinary dialogue must not inject Turn Recall");
    assert.strictEqual(unrelated.reason, "no_recall_intent");
  }
  for (const query of ["你是谁？", "你为什么生气？", "这里是哪里？", "今天是谁值守？", "为什么不坐下？"]) {
    const intent = turnRecall.detectIntent(query);
    assert.strictEqual(intent.triggered, false, `${query}: ordinary question words must not open the recall gate`);
  }
  for (const query of ["你还记得洛阳那次吗？", "你以前答应过我什么？", "当时是谁陪你去的？", "之前那封信是谁写的？", "你曾经为什么离开开封？", "还记得我们的婚约吗？"]) {
    assert.strictEqual(turnRecall.detectIntent(query).triggered, true, `${query}: explicit past-memory wording must open the recall gate`);
  }
  for (const [query, turnEpoch] of [["李师师，喝杯茶吗？", 20], ["赵甲，你怎么看？", 21]]) {
    const namedOnly = engine.retrieveTurnRecall({ ...input, query, entityNames: [query.split(/[，,]/)[0]], turnEpoch });
    assert.strictEqual(namedOnly.triggered, false, `${query}: a character name alone must not inject Turn Recall`);
    assert.strictEqual(namedOnly.reason, "no_recall_intent");
  }
  const letterRecall = engine.retrieveTurnRecall({ ...input, query: "你还记得之前那封信吗？", assistContext: "", turnEpoch: 22 });
  assert.strictEqual(letterRecall.triggered, true, "explicit recall with relevant memory must trigger");
  assert.strictEqual(letterRecall.selected[0].memory.memoryId, "letter");
  assert.strictEqual(letterRecall.reason, "explicit_recall_intent");

  const missingRecall = engine.retrieveTurnRecall({ ...input, query: "你还记得我小时候养的那匹白马吗？", assistContext: "", turnEpoch: 23 });
  assert.strictEqual(missingRecall.triggered, false, "explicit recall must not force an unrelated Top1 memory");
  assert.strictEqual(missingRecall.selected.length, 0);
  assert.strictEqual(missingRecall.reason, "explicit_recall_no_relevant_memory");

  const assistRecall = engine.retrieveTurnRecall({ ...input, query: "当时到底发生了什么？", assistContext: "你方才提到洛阳旧事。", turnEpoch: 24 });
  assert.strictEqual(assistRecall.triggered, true, "relevant assist context may satisfy the explicit recall threshold");
  assert.strictEqual(assistRecall.selected[0].memory.memoryId, "luoyang");
  assert.strictEqual(assistRecall.reason, "explicit_recall_intent");

  const later = engine.retrieveTurnRecall({ ...input, query: "那开封那次遗失玉佩事件呢？", turnEpoch: 12 });
  assert.strictEqual(later.selected[0].memory.memoryId, "kaifeng", "a later turn may select a different Top1 memory");
  const similarityOnly = engine.retrieveTurnRecall({ ...input, query: "开封城门那块玉佩后来怎么样？", assistContext: "", turnEpoch: 13 });
  assert.strictEqual(similarityOnly.reason, "similarity_threshold", "high primary-query similarity is a secondary local trigger");
  assert.strictEqual(similarityOnly.selected[0].memory.memoryId, "kaifeng");
  console.log("Memory Engine 2.5 Turn Recall: PASS (intent gate, Top1, authority, budget, cache)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

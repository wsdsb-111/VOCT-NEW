"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { extractCharacterDisclosures } = require("../src/app/main/conversation/character-disclosure-extraction");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { sourceParagraphSegments, validateSourceItem, presentIds } = require("../src/app/main/memory-system/finalization-visibility");

const cases = [
  ["N01", "我叫赵元宁。", true],
  ["N02", "我的名字是赵元宁。", true],
  ["N03", "在下名叫赵元宁。", true],
  ["N04", "My name is 赵元宁.", true],
  ["N05", "我叫赵元宁，我微笑着坐下。", true],
  ["N06", "我叫赵元宁。随后我看向窗外。", true],
  ["N07", "我叫赵元宁。“很高兴认识你。”", true],
  ["N08", "“你好。”我叫赵元宁。", true],
  ["N09", "我说：“我叫赵元宁。”", true],
  ["N10", "我微笑着说：“我叫赵元宁。”", true],
  ["N11", "我在心里想：我叫赵元宁。", false],
  ["N12", "有人说：“我叫赵元宁。”", false],
  ["N13", "纸条上写着：“我叫赵元宁。”", false],
  ["N14", "如果我叫赵元宁，你会如何称呼我？", false],
  ["N15", "我不是赵元宁。", false],
  ["N16", "我叫赵元宁吗？", false],
  ["N17", "我叫阿青。", false],
  ["N18", "我叫赵元宁", false],
  ["N19", "只对阿乙低声说：“我叫赵元宁。”", true],
  ["N20", "我叫赵元宁。", false],
  ["N21", "我叫赵元宁。“他心想自己已经知道我的名字。”", true],
  ["N22", "“有人说我叫赵元宁。”", false],
  ["N23", "我叫赵元宁。", true],
  ["N24", "我叫赵元宁。", false],
  ["guard-conditional", "如果明天有机会，我叫赵元宁，我微笑着坐下。", false],
  ["independent-question", "我叫赵元宁，你确定吗？", true],
  ["guard-reported", "我听他微笑着说：“我叫赵元宁。”", false],
  ["guard-private", "我在心里想：“你好。”我叫赵元宁。", false],
  ["guard-attribution", "他微笑着说：『我叫赵元宁。』", false],
  ["guard-ask", "我问道：“我叫赵元宁。”", false],
  ["guard-unattributed-quote", "“我叫赵元宁。”", false],
  ["guard-conditional-quote", "如果我微笑着说：“我叫赵元宁。”", false],
  ["guard-trailing-negation", "我叫赵元宁，不过那只是玩笑。", false],
  ["guard-unknown-speaker", "我叫赵元宁。", false],
  ["guard-mislabeled-player", "我叫赵元宁。", false],
  ["guard-temporarily-absent", "我叫赵元宁。", false]
];
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v974-name-"));
const errors = [];
try {
  for (const [key, content, expected] of cases) {
    const character = (id, shortName) => ({ id, shortName, fullName: shortName, traits: [] });
    const participants = [character(1, key === "N24" ? "赵新名" : "赵元宁"), character(2, "阿乙"),
      character(3, ["N20", "N23", "guard-mislabeled-player"].includes(key) ? "赵元宁" : "阿丙")];
    const gameData = { playerID: 1, date: "1190.5.2", totalDays: 100, campaignToken: "name-fixture",
      characters: new Map(participants.map(person => [person.id, person])) };
    const message = { id: 10, role: key === "N20" ? "assistant" : "user",
      speakerCharacterId: ["N20", "guard-mislabeled-player"].includes(key) ? 3 : key === "guard-unknown-speaker" ? undefined : 1,
      name: "赵元宁", content };
    const bPresent = key !== "N18" && key !== "guard-temporarily-absent";
    const cPresent = ["N19", "N20", "guard-mislabeled-player"].includes(key);
    const conversation = { id: key, gameData, isActive: true, selectedCharacterIds: new Set([2, 3]),
      presentCharacterIds: new Set([...(bPresent ? [2] : []), ...(cPresent ? [3] : [])]), messages: [message] };
    const context = { conversationId: key, date: gameData.date, campaignToken: gameData.campaignToken,
      participants, messages: conversation.messages, participantPresence: participants.map(({ id }) => ({
        characterId: id, joinedAtMessageId: id === 2 && !bPresent || id === 3 && !cPresent ? 20 : 0
      })) };
    if (key === "guard-temporarily-absent") context.participantPresence.push({ characterId: 2, joinedAtMessageId: 0, leftAtMessageId: 5 });
    const source = { conversationId: key, messageId: message.id, gameDate: gameData.date, campaignToken: context.campaignToken,
      messageRevision: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
    const extract = () => extractCharacterDisclosures({ gameData, speakerId: message.speakerCharacterId, role: message.role,
      text: content, source, candidateTargetIds: [1, 2, 3], audienceIds: presentIds(context, message.id) }).disclosures;
    const parsed = extract().filter(fact => fact.factType === "NAME");
    const proofs = (sourceParagraphSegments(context, message) || []).map(segment => validateSourceItem(segment, context));
    const diagnostics = [];
    const store = new ConversationDisclosureStore({ dataDir: path.join(root, key), getCurrentConversation: () => conversation,
      nameDiagnosticSink: event => diagnostics.push(event) });
    const result = store.recordConversation({ conversation, context });
    const profile = (ownerRuntimeId, targetRuntimeId = 1) => store.getDisclosureProfile({ ownerRuntimeId, targetRuntimeId });
    const known = profile(2).facts.some(fact => fact.factType === "NAME" && fact.effectiveKnown);
    const evidence = JSON.parse(fs.readFileSync(store.filePath, "utf8")).records.filter(fact => fact.factType === "NAME");
    const found = parsed.some(fact => fact.ownerRuntimeId === 2 && fact.targetRuntimeId === 1);
    console.log(JSON.stringify({ key, content, proof: proofs.map(row => [row.success, row.source, row.audience]),
      parsed: parsed.map(fact => [fact.ownerRuntimeId, fact.targetRuntimeId]), recorded: result.recorded, stored: evidence.length,
      profile: profile(2).status, known }));
    try {
      assert.equal(found, expected, "extraction");
      assert.equal(known, expected, "Store readback");
      assert.equal(evidence.some(row => row.ownerRuntimeId === "2" && row.targetRuntimeId === "1"), expected, "persisted evidence");
      assert.equal(profile(3).facts.some(fact => fact.factType === "NAME"), false, "no disclosure to C");
      assert.equal(profile(2, 3).facts.some(fact => fact.factType === "NAME"), key === "N20",
        "the authenticated speaker's self-introduction never identifies another character");
      if (key === "N17") assert(diagnostics.some(event => event.reason === "NO_NAME_CANDIDATE"));
      if (key === "N11") assert(diagnostics.some(event => event.reason === "NOT_SPOKEN"));
      if (key === "N18") assert(diagnostics.some(event => event.code === "NAME_AUDIENCE_REJECTED"));
      if (key === "N19") assert.deepEqual(evidence[0].evidence[0].audienceIds, [1, 2]);
      if (key === "N01") {
        assert.equal(store.recordConversation({ conversation, context }).recorded, 0);
        assert(diagnostics.some(event => event.code === "NAME_EVIDENCE_UNCHANGED"));
        assert(diagnostics.some(event => /^[a-f0-9]{64}$/.test(event.evidenceHash ?? "")));
        Object.assign(participants[2], { shortName: "赵元宁", fullName: "赵元宁" });
        gameData.playerID = 3;
        assert(!profile(2, 3).facts.some(fact => fact.factType === "NAME"), "switching to a same-name player ID does not carry over proof");
        gameData.playerID = 1;
        fs.writeFileSync(store.filePath, "{ malformed");
        assert.deepEqual(profile(2), { status: "BLOCKED", facts: [], reason: "character_knowledge_state_invalid" });
        assert.throws(() => store.recordConversation({ conversation, context }), /state_invalid/);
        assert.equal(fs.readFileSync(store.filePath, "utf8"), "{ malformed", "corrupt state is left intact");
        assert(diagnostics.some(event => event.code === "NAME_PROFILE_BLOCKED" && event.reason === "INVALID_STATE"));

        const failingStore = new ConversationDisclosureStore({ dataDir: path.join(root, "failed-write"),
          getCurrentConversation: () => conversation, nameDiagnosticSink: event => diagnostics.push(event),
          fs: { ...fs, writeFileSync() { throw new Error("synthetic private failure text"); } } });
        assert.throws(() => failingStore.recordConversation({ conversation, context }));
        assert(diagnostics.some(event => event.code === "NAME_WRITE_FAILED" && event.reason === "WRITE_FAILED"));
        assert(!fs.existsSync(failingStore.filePath));
      }
      assert.doesNotMatch(JSON.stringify(diagnostics), /赵元宁|阿青|synthetic private failure text/u);
    } catch (error) { errors.push(`${key} ${error.message}`); }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
assert.deepEqual(errors, []);
console.log("PASS V9.7.4 NAME disclosure RP and audience cases");

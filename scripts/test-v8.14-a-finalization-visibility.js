"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { validateSourceItem, validateVisibilityBoundaries, repairVisibilityBoundaries } = require("../resources/app/out/main/memory-system/finalization-visibility");
const { KnowledgeService } = require("../resources/app/out/main/memory-system/knowledge-service");
const { MemoryExtractor } = require("../resources/app/out/main/memory-system/memory-extractor");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v814-finalization-"));
const folders = path.join(root, "summaries");
for (const id of [1, 2, 3]) fs.mkdirSync(path.join(folders, `${id}_NPC`), { recursive: true });
const store = new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: folders });
const people = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }];
const presence = people.map((person) => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null }));
const base = { campaignToken: "finalization-test", conversationId: "conversation-test", finalizationId: "finalization-test",
  episodeId: "episode-test", date: "1164.1.1", participants: people, participantPresence: presence,
  messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content: "A笑着说：“当然可以。”A心里决定明天背叛C。" }] };
const item = (content, visibility, participants = [1, 2, 3], messageIds = [1]) => ({ content, visibility,
  source: "spoken", participants, provenance: { messageIds, speakerIds: [1] } });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

async function run() {
  try {
    await check("mixed public/private must split", () => {
      const publicPart = item("A笑着说：“当然可以。”", "participants");
      const privatePart = item("A心里决定明天背叛C。", "private", [1]);
      assert.equal(validateVisibilityBoundaries(base, { summarySegments: [publicPart, privatePart] }).success, true);
      assert.deepEqual(validateSourceItem(publicPart, base).audience, [1, 2, 3]);
      assert.deepEqual(validateSourceItem(privatePart, base).audience, [1]);
    });
    await check("mixed shared segment is rejected", () => {
      assert.match(validateSourceItem(item(base.messages[0].content, "participants"), base, { segment: true }).reason, /boundary/);
    });
    await check("whisper only reaches supported recipient", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A只对B低声说秘密。" }] };
      const whisper = item("A只对B低声说秘密。", "known_group", [1, 2]);
      assert.deepEqual(validateSourceItem(whisper, scene).audience, [1, 2]);
      assert.equal(validateSourceItem({ ...whisper, participants: [1, 2, 3] }, scene).success, false);
      assert.equal(validateSourceItem({ ...whisper, visibility: "participants" }, scene).success, false);
    });
    await check("unsupported known_group fails closed", () => {
      assert.equal(validateSourceItem(item("A说秘密。", "known_group", [1, 2]), base).success, false);
    });
    await check("private thought stays with author", () => {
      assert.deepEqual(validateSourceItem(item("A心想背叛C。", "private", [1]), base).audience, [1]);
    });
    await check("silent intention never becomes shared", () => {
      assert.equal(validateSourceItem(item("A暗自决定背叛C。", "participants"), base).success, false);
    });
    await check("unobserved action never becomes shared", () => {
      assert.equal(validateSourceItem(item("A趁人不注意偷走文书。", "participants"), base).success, false);
    });
    await check("participants is not everybody present", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A答应B。" }] };
      assert.deepEqual(validateSourceItem(item("A答应B。", "participants", [1, 2]), scene).audience, [1, 2]);
    });
    await check("speaker-only participants remain author-only without failing summary", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A说自己的安排。" }] };
      assert.deepEqual(validateSourceItem(item("A说自己的安排。", "participants", [1]), scene, { segment: true }).audience, [1]);
    });
    await check("two-person early private paragraph is split without losing later public speech", () => {
      const scene = { ...base, participants: people.slice(0, 2), participantPresence: presence.slice(0, 2),
        messages: [{ ...base.messages[0], content: "A心里决定背叛B。\nA公开说：“我们守城。”" }] };
      const extraction = { summarySegments: [item("A决定背叛B，然后说我们守城。", "participants", [1, 2])],
        memories: [item("A决定背叛B。", "participants", [1, 2])] };
      assert.equal(repairVisibilityBoundaries(scene, extraction).repairedMessageIds.length, 1);
      assert.equal(validateVisibilityBoundaries(scene, extraction).success, true);
      assert.deepEqual(extraction.summarySegments.map((segment) => segment.visibility), ["private", "public"]);
      assert.deepEqual(extraction.summarySegments.map((segment) => validateSourceItem(segment, scene).audience), [[1], [1, 2]]);
      assert.equal(extraction.memories.length, 0);
    });
    await check("repair replaces malformed claims with source-bounded private and public paragraphs", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A心里决定背叛B。\nA公开说：“守城。”" }] };
      const privateOnly = { summarySegments: [{ ...item("A心里决定背叛B。", "private", [1]),
        provenance: { messageIds: [1], speakerIds: [2] } }], memories: [] };
      assert.deepEqual(repairVisibilityBoundaries(scene, privateOnly).repairedMessageIds, [1]);
      assert.equal(validateVisibilityBoundaries(scene, privateOnly).success, true);
      assert.deepEqual(validateSourceItem(privateOnly.summarySegments[0], scene).audience, [1]);
      assert.deepEqual(privateOnly.summarySegments[0].provenance.speakerIds, [1]);
    });
    await check("three-person whisper paragraph reaches B but not C", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A只对B低声说秘密。\nA对众人说：“开始。”" }] };
      const extraction = { summarySegments: [item("A低声说了秘密，然后宣布开始。", "participants")], memories: [] };
      repairVisibilityBoundaries(scene, extraction);
      assert.equal(validateVisibilityBoundaries(scene, extraction).success, true);
      assert.deepEqual(extraction.summarySegments.map((segment) => segment.visibility), ["known_group", "public"]);
      assert.deepEqual(extraction.summarySegments.map((segment) => validateSourceItem(segment, scene).audience), [[1, 2], [1, 2, 3]]);
    });
    await check("two and three participant Finalization commits after conservative paragraph repair", async () => {
      for (const count of [2, 3]) {
        const engine = new MemoryEngine({ store, trace: { record() {} } });
        const participants = people.slice(0, count);
        const messages = [
          { id: 1, role: "user", speakerCharacterId: 2, content: "B向众人提出守城方案，并说明粮草已经准备妥当。" },
          { id: 2, role: "assistant", speakerCharacterId: 1, content: count === 2
            ? "A心里盘算背叛B。\nA公开回应：“我同意守城，明日带兵出发。”"
            : "A只对B低声说秘密。\nA转向众人宣布：“我同意守城，明日带兵出发。”" },
          { id: 3, role: "user", speakerCharacterId: 2, content: "B明确答应提供粮草，并请A确认出发日期与守城位置。" },
          { id: 4, role: "assistant", speakerCharacterId: 1, content: "A面向众人确认明日出发，并指定城门作为会合地点。" }
        ];
        const output = JSON.stringify({ summarySegments: messages.map((message) => ({
          content: message.id === 2 ? "A说明了自己的想法，并同意守城。" : message.content,
          participants: participants.map((person) => person.id), visibility: "public", source: "spoken",
          messageIds: [message.id], speakerIds: [message.speakerCharacterId]
        })), memories: [] });
        let summaryRequests = 0, durableCalls = 0;
        const context = { campaignToken: `commit-${count}`, conversationId: `commit-${count}`,
          finalizationVisibilityV1: true, participants, messages,
          participantPresence: participants.map((person) => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null })),
          buildPrompt: () => [], requestSummary: async () => { summaryRequests++; return { content: output, finish_reason: "stop" }; },
          requestDurable: async () => { durableCalls++; throw new Error("retired_durable_callback_must_not_run"); },
          persistCharacterFolders: async () => ({ success: true }) };
        const result = await engine.finalizeConversation(context);
        assert.equal(result.success, true, result.error?.message);
        assert.equal(summaryRequests, 1, "deterministic source repair must satisfy visibility validation without a redundant model retry");
        assert.equal(durableCalls, 0, "finalization must not invoke the retired Durable callback");
        assert.equal(Object.hasOwn(result, "durable"), false, "finalization result must not expose Durable state");
        const episode = engine.isCommitted({ ...context, finalizationId: engine.getFinalizationId(context) });
        assert.equal(episode.visibilityValidationVersion, 1);
        const restricted = episode.summarySegments.find((segment) => segment.visibility === (count === 2 ? "private" : "known_group"));
        assert(restricted);
        assert.deepEqual(restricted.knownBy, count === 2 ? [1] : [1, 2]);
        if (count === 3) assert.equal(result.directedSummaries.get("3->1").content.includes("秘密"), false);
      }
    });
    await check("two- and three-person visibility snapshots reuse locally repaired saved output", async () => {
      for (const count of [2, 3]) {
        const engine = new MemoryEngine({ store, trace: { record() {} } });
        const participants = people.slice(0, count);
        const messages = [
          { id: 1, role: "user", speakerCharacterId: 2, content: "B提议守城。" },
          { id: 2, role: "assistant", speakerCharacterId: 1, content: "A心里另有打算。\nA只对B低声说：“暗号竹叶。”\nA转向众人宣布：“我同意守城。”" }
        ];
        if (count === 3) messages.push({ id: 3, role: "user", speakerCharacterId: 3, content: "C也同意守城。" });
        const context = { campaignToken: `retry-visibility-${count}`, conversationId: `retry-visibility-${count}`, finalizationVisibilityV1: true,
          participants, participantPresence: participants.map(person => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null })), messages };
        const prepared = engine.prepareFinalizationContext(context);
        const failedOutput = JSON.stringify({ summarySegments: [
          { content: messages[0].content, participants: participants.map(person => person.id), visibility: "public", source: "spoken", messageIds: [1], speakerIds: [2] },
          { content: "A心里打定主意，并向众人表示同意守城。", participants: participants.map(person => person.id), visibility: "public", source: "spoken", messageIds: [2], speakerIds: [1] },
          ...(count === 3 ? [{ content: messages[2].content, participants: participants.map(person => person.id), visibility: "public", source: "spoken", messageIds: [3], speakerIds: [3] }] : [])
        ], memories: [] });
        const file = engine.writeRecoverySnapshot(prepared, { finalizationStage: "request", finalizationStatus: "failed_retryable",
          providerOutput: failedOutput,
          lastError: "final_summary_quality_failed:summary_segment_crosses_visibility_boundary" });
        let requests = 0;
        const result = await engine.recoverFailedFinalization(file, { buildPrompt: () => [],
          requestSummary: async () => { requests++; throw new Error("saved_provider_output_should_be_repaired_locally"); },
          persistCharacterFolders: async () => ({ success: true }) });
        assert.equal(result.success, true, result.error?.message);
        assert.equal(requests, 0, "a saved failed response should be repaired and recovered without another model call");
        assert.equal(engine.isCommitted(prepared).visibilityValidationVersion, 1);
        assert.equal(result.directedSummaries.get(`${count}->1`).content.includes("心里另有打算"), false, "source-repaired private content must not leak to another participant");
        if (count === 3) assert.equal(result.directedSummaries.get("3->1").content.includes("暗号竹叶"), false, "a third participant must not receive a whisper addressed to B");
      }
    });
    await check("multi-person chunked Presence marker keeps verifiable game source", async () => {
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      const scene = { ...base, conversationId: "chunked-presence", finalizationVisibilityV1: true,
        participantPresence: [{ ...presence[0] }, { ...presence[1] }, { characterId: 3, joinedAtMessageId: 2, leftAtMessageId: null }],
        messages: [{ id: 2, role: "system", kind: "presence_join", characterId: 3, content: "【C入内】" }] };
      const output = await engine.requestChunkedSummary(scene, { providerId: "fixture", providerType: "fixture",
        modelId: "fixture", contextWindow: 8192, maxOutputTokens: 2048 });
      const parsed = engine.extractor.parseOutput(output, scene);
      assert.equal(parsed.structured, true);
      assert.equal(parsed.summarySegments[0].source, "game_fact");
      assert.equal(engine.evaluateFinalSummaryQuality(scene, parsed).success, true);
    });
    await check("reported event cannot become witnessed", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A听说D已经死了。" }] };
      assert.equal(validateSourceItem({ ...item("A听说D已经死了。", "participants"), source: "witnessed" }, scene).success, false);
    });
    await check("late join and early leave narrow access", () => {
      const scene = { ...base, participantPresence: [{ ...presence[0] }, { ...presence[1] },
        { characterId: 3, joinedAtMessageId: 2, leftAtMessageId: 3 }], messages: [
        { id: 1, role: "assistant", speakerCharacterId: 1, content: "A说一。" },
        { id: 2, role: "assistant", speakerCharacterId: 1, content: "A说二。" },
        { id: 3, role: "assistant", speakerCharacterId: 1, content: "A说三。" }] };
      assert.equal(validateSourceItem(item("A说一。", "participants", [1, 3], [1]), scene).success, false);
      assert.deepEqual(validateSourceItem(item("A说二。", "participants", [1, 3], [2]), scene).audience, [1, 3]);
      assert.equal(validateSourceItem(item("A说三。", "participants", [1, 3], [3]), scene).success, false);
    });
    await check("KnowledgeService ignores proposed knownBy", () => {
      const knowledge = new KnowledgeService();
      const segment = { ...item("A笑着说：“当然可以。”", "participants", [1, 2]), knownBy: [1, 2, 3] };
      assert.deepEqual(knowledge.resolveKnownBy(segment, { finalizationVisibilityV1: true, sourceContext: base }), [1, 2]);
    });
    await check("Narrative persistence writes locally bounded audiences and versioned source", () => {
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      const scene = { ...base, conversationId: "persist-visibility", finalizationId: "persist-visibility",
        finalizationVisibilityV1: true };
      const output = JSON.stringify({ summarySegments: [
        { content: "A笑着说：“当然可以。”", participants: [1, 2, 3], visibility: "participants", source: "spoken", messageIds: [1], speakerIds: [1] },
        { content: "A心里决定明天背叛C。", participants: [1], visibility: "private", source: "spoken", messageIds: [1], speakerIds: [1] }], memories: [] });
      const extraction = engine.assignStableMemoryIds(scene, engine.extractor.parseOutput(output, scene));
      assert.equal(engine.evaluateFinalSummaryQuality(scene, extraction).success, true);
      const episode = engine.persistExtraction(scene, extraction).episode;
      assert.equal(episode.visibilityValidationVersion, 1);
      assert.deepEqual(episode.summarySegments.map((segment) => segment.knownBy), [[1, 2, 3], [1]]);
      assert.deepEqual(episode.summarySegments.filter(segment => segment.knownBy.includes(2)).map(segment => segment.content),
        ["A笑着说：“当然可以。”"]);
    });
    await check("Legacy summaries remain recallable through the native route", () => {
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      store.writeJson(path.join(folders, "2_NPC", "与1的对话.json"), [{ playerId: 2, playerName: "B", characterId: 1,
        characterName: "A", perspectiveOwnerId: 2, knownBy: [2], date: "1160.1.1", totalDays: 420000,
        content: "旧摘要仍可读取。", campaignToken: base.campaignToken, campaignBinding: { status: "bound", source: "fixture" } }]);
      const ownerMemories = engine.loadOwnerFolderMemories(2);
      const recalled = engine.retrieveForResponder({ characterId: 2, query: "上次谈了什么？", querySpeakerId: 1,
        directCounterpartIds: [1], activeParticipantIds: [1, 2], ownerFolderMemories: ownerMemories,
        currentGameDate: "1164.1.1", currentTotalDays: 424000, campaignToken: base.campaignToken,
        memoryEngine3Enabled: true, tokenBudget: 1000, estimateTokens: () => 10, sessionRecallCache: new Map() });
      assert(recalled.direct.some(entry => entry.memory.content === "旧摘要仍可读取。"));
    });
    await check("invalid narrative remains recoverable and never calls Durable", async () => {
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      const messages = [
        { id: 1, role: "user", speakerCharacterId: 2, content: "B提出守城。" },
        { id: 2, role: "assistant", speakerCharacterId: 1, content: "A答应守城。" }
      ];
      let summaryCalls = 0, durableCalls = 0;
      const context = { campaignToken: base.campaignToken, conversationId: "invalid-narrative", finalizationId: "invalid-narrative",
        participants: people.slice(0, 2), participantPresence: presence.slice(0, 2), messages, finalizationVisibilityV1: true,
        buildPrompt: () => [],
        requestSummary: async () => { summaryCalls++; return { content: '{"summarySegments":[],"memories":[]}', finish_reason: "stop" }; },
        requestDurable: async () => { durableCalls++; throw new Error("retired_durable_callback_must_not_run"); },
        persistCharacterFolders: async () => ({ saved: true }) };
      const result = await engine.finalizeConversation(context);
      assert.equal(result.success, false);
      assert(summaryCalls > 0);
      assert.equal(durableCalls, 0);
      assert.equal(engine.isCommitted(context), null);
    });
    await check("rumor remains told in Narrative perspectives", () => {
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      const scene = { ...base, conversationId: "rumor-perspective", finalizationId: "rumor-perspective",
        finalizationVisibilityV1: true, messages: [{ ...base.messages[0], content: "A听说D已经死了。" }] };
      const content = "A听说D已经死了。";
      const output = JSON.stringify({ summarySegments: [{ content, participants: [1, 2], visibility: "participants",
        source: "rumor", messageIds: [1], speakerIds: [1] }], memories: [{ type: "rumor", content,
        participants: [1, 2], subjects: [1], visibility: "participants", source: "rumor", messageIds: [1], speakerIds: [1] }] });
      const extraction = engine.assignStableMemoryIds(scene, engine.extractor.parseOutput(output, scene));
      assert.equal(engine.evaluateFinalSummaryQuality(scene, extraction).success, true);
      const episode = engine.persistExtraction(scene, extraction).episode;
      assert.deepEqual(episode.perspectives.map((entry) => entry.awareness), ["told", "told"]);
    });
    await check("Finalization schema requires source without touching chat Prompt", () => {
      const extractor = new MemoryExtractor();
      const prompt = extractor.buildPrompt({ ...base, finalizationVisibilityV1: true });
      assert.match(prompt[1].content, /Finalization visibility gate/);
      const parsed = extractor.parseOutput(JSON.stringify({ summarySegments: [
        { content: "A说一。", participants: [1, 2], visibility: "participants", messageIds: [1], speakerIds: [1] }], memories: [] }),
      { finalizationVisibilityV1: true });
      assert.equal(parsed.structured, true);
      assert.equal(validateSourceItem(parsed.summarySegments[0], base).success, false, "missing source stays invalid until source repair");
      const live = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
      assert.equal(live.includes("<votc-private>"), false);
      assert.equal(live.includes("<votc-group>"), false);
    });
    console.log(`V8.14-A Finalization visibility: ${passed} PASS`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

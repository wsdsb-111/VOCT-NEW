"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4Store } = require("../resources/app/out/main/memory-system/memory4-store");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { validateEntry } = require("../resources/app/out/main/memory-system/memory4-contract");
const { validateSourceItem, validateVisibilityBoundaries, repairVisibilityBoundaries } = require("../resources/app/out/main/memory-system/finalization-visibility");
const { KnowledgeService } = require("../resources/app/out/main/memory-system/knowledge-service");
const { MemoryExtractor } = require("../resources/app/out/main/memory-system/memory-extractor");
const { buildLegacyBridge } = require("../resources/app/out/main/memory-system/memory4-legacy-bridge");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v814-finalization-"));
const folders = path.join(root, "summaries");
for (const id of [1, 2, 3]) fs.mkdirSync(path.join(folders, `${id}_NPC`), { recursive: true });
const store = new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: folders });
const coordinator = new Memory4Coordinator(store);
const memory4 = new Memory4Store(store);
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
    await check("repair never promotes malformed private or speaker-invalid claims", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A心里决定背叛B。\nA公开说：“守城。”" }] };
      const privateOnly = { summarySegments: [{ ...item("A心里决定背叛B。", "private", [1]),
        provenance: { messageIds: [1], speakerIds: [2] } }], memories: [] };
      assert.deepEqual(repairVisibilityBoundaries(scene, privateOnly).repairedMessageIds, []);
      assert.equal(validateVisibilityBoundaries(scene, privateOnly).success, false);
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
        const context = { campaignToken: `commit-${count}`, conversationId: `commit-${count}`,
          finalizationVisibilityV1: true, participants, messages,
          participantPresence: participants.map((person) => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null })),
          buildPrompt: () => [], requestSummary: async () => ({ content: output }),
          requestDurable: async (prompt, options) => {
            if (count === 2 && options.ownerId === 2) assert.equal(JSON.stringify(prompt).includes("背叛"), false);
            if (count === 3 && options.ownerId === 3) assert.equal(JSON.stringify(prompt).includes("秘密"), false);
            return { content: '{"status":"NO_DURABLE_CONTENT","entries":[]}' };
          },
          persistCharacterFolders: async () => ({ success: true }) };
        const result = await engine.finalizeConversation(context);
        assert.equal(result.success, true, result.error?.message);
        assert.equal(result.durable.status, "COMPLETE");
        const episode = engine.isCommitted({ ...context, finalizationId: engine.getFinalizationId(context) });
        assert.equal(episode.visibilityValidationVersion, 1);
        const restricted = episode.summarySegments.find((segment) => segment.visibility === (count === 2 ? "private" : "known_group"));
        assert(restricted);
        assert.deepEqual(restricted.knownBy, count === 2 ? [1] : [1, 2]);
        if (count === 3) assert.equal(result.directedSummaries.get("3->1").content.includes("秘密"), false);
      }
    });
    await check("failed two-person visibility snapshot retries without forced chunking", async () => {
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      const messages = [
        { id: 1, role: "user", speakerCharacterId: 2, content: "B提议守城。" },
        { id: 2, role: "assistant", speakerCharacterId: 1, content: "A心里另有打算。\nA对B说：“我同意守城。”" }
      ];
      const context = { campaignToken: "retry-visibility", conversationId: "retry-visibility", finalizationVisibilityV1: true,
        participants: people.slice(0, 2), participantPresence: presence.slice(0, 2), messages };
      const prepared = engine.prepareFinalizationContext(context);
      const file = engine.writeRecoverySnapshot(prepared, { finalizationStage: "request", finalizationStatus: "failed_retryable",
        lastError: "final_summary_quality_failed:summary_segment_crosses_visibility_boundary" });
      let requests = 0;
      const result = await engine.recoverFailedFinalization(file, { buildPrompt: () => [],
        requestSummary: async () => { requests++; return { content: JSON.stringify({ summarySegments: [
          { content: messages[0].content, participants: [1, 2], visibility: "public", source: "spoken", messageIds: [1], speakerIds: [2] },
          { content: "A同意守城。", participants: [1, 2], visibility: "public", source: "spoken", messageIds: [2], speakerIds: [1] }
        ], memories: [] }) }; }, persistCharacterFolders: async () => ({ success: true }) });
      assert.equal(result.success, true, result.error?.message);
      assert.equal(requests, 1);
      assert.equal(engine.isCommitted(prepared).visibilityValidationVersion, 1);
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
      assert.deepEqual(coordinator.buildOwnerSnapshot({ ...scene, verifiedSummarySegments: episode.summarySegments }, 2)
        .fragments.map((fragment) => fragment.text), ["A笑着说：“当然可以。”"]);
    });
    await check("Memory4 uses verified segment but not private material for observer", () => {
      const publicPart = { ...item("A笑着说：“当然可以。”", "participants", [1, 2, 3]), segmentId: "public-1", knownBy: [1, 2, 3] };
      const privatePart = { ...item("A心里决定明天背叛C。", "private", [1]), segmentId: "private-1", knownBy: [1] };
      const scene = { ...base, verifiedSummarySegments: [publicPart, privatePart] };
      const observer = coordinator.buildOwnerSnapshot(scene, 2);
      const author = coordinator.buildOwnerSnapshot(scene, 1);
      assert.equal(observer.fragments.length, 1);
      assert.equal(author.fragments.length, 3);
      assert.equal(JSON.stringify(coordinator.buildPrompt(observer, observer.fragments)).includes("背叛"), false);
      assert.throws(() => coordinator.buildOwnerSnapshot({ ...scene, verifiedSummarySegments: [{ ...privatePart, knownBy: [1, 2] }] }, 2), /known_by_mismatch/);
    });
    await check("Known Entity receives co-presence but no private mention", () => {
      const privatePart = { ...item("A心里决定明天背叛C。", "private", [1]), segmentId: "private-2", knownBy: [1] };
      const observer = coordinator.buildOwnerSnapshot({ ...base, verifiedSummarySegments: [privatePart] }, 2);
      memory4.recordKnownEvidence(observer);
      assert.equal(memory4.getKnownEntityEvidence(observer, 3).mentionCount, 0);
      assert.equal(memory4.getKnownEntityEvidence(observer, 1).sharedSceneCount, 1);
      assert.equal(memory4.getKnownEntityEvidence(observer, 1).directConversationCount, 0);
    });
    await check("public speech alone does not imply direct conversation", () => {
      const publicPart = { ...item("A笑着说：“当然可以。”", "participants", [1, 2, 3]),
        segmentId: "public-evidence", knownBy: [1, 2, 3] };
      const observer = coordinator.buildOwnerSnapshot({ ...base, conversationId: "public-evidence",
        verifiedSummarySegments: [publicPart] }, 3);
      memory4.recordKnownEvidence(observer);
      assert.equal(memory4.getKnownEntityEvidence(observer, 1).directConversationCount, 0);
      assert.equal(memory4.getKnownEntityEvidence(observer, 1).sharedSceneCount, 1);
    });
    await check("Legacy remains readable without inferred observer Detail", () => {
      const observer = coordinator.buildOwnerSnapshot(base, 2);
      assert.equal(observer.fragments.length, 0);
      assert.equal(observer.completeness, "partial");
      assert.equal(buildLegacyBridge([{ memoryId: "legacy-one", type: "folder_summary", content: "旧摘要", knownBy: [2],
        provenance: { campaignToken: base.campaignToken, folderOwnerId: 2 } }], { campaignToken: base.campaignToken, ownerId: 2 }).memories.length, 1);
    });
    await check("invalid extraction does not become NO_DURABLE_CONTENT", async () => {
      const publicPart = { ...item("A笑着说：“当然可以。”", "participants", [1, 2]), segmentId: "public-3", knownBy: [1, 2] };
      const scene = { ...base, conversationId: "failed-extraction", finalizationId: "failed-extraction",
        verifiedSummarySegments: [publicPart] };
      const result = await coordinator.finalizeCommitted(scene, null, { isNarrativeCommitted: true });
      assert.equal(result.status, "PARTIAL_FAILURE");
      assert.equal(result.owners[1].status, "EXTRACTION_FAILED");
    });
    await check("source IDs and epistemic status survive Durable gate", () => {
      const segment = { ...item("A笑着说：“当然可以。”", "participants", [1, 2]), segmentId: "public-4", knownBy: [1, 2] };
      const snapshot = coordinator.buildOwnerSnapshot({ ...base, verifiedSummarySegments: [segment] }, 2);
      const candidate = { memoryType: "COMMITMENT", text: "A答应。", fragmentIds: [snapshot.fragments[0].fragmentId],
        entityIds: [], participantIds: [1, 2], eventTime: { status: "reported" } };
      const entry = validateEntry(candidate, snapshot);
      assert.deepEqual(entry.source.messageIds, [1]);
      assert.equal(entry.evidence.epistemicStatus, "reported");
      assert.equal(entry.evidence.sourceType, "spoken");
      assert.throws(() => validateEntry({ ...candidate, eventTime: { status: "observed" } }, snapshot), /unverified_observation/);
    });
    await check("rumor source remains rumor in Canonical evidence", () => {
      const scene = { ...base, messages: [{ ...base.messages[0], content: "A听说D已经死了。" }] };
      const segment = { ...item("A听说D已经死了。", "participants", [1, 2]), source: "rumor",
        segmentId: "rumor-1", knownBy: [1, 2] };
      const snapshot = coordinator.buildOwnerSnapshot({ ...scene, verifiedSummarySegments: [segment] }, 2);
      const entry = validateEntry({ memoryType: "DURABLE_KNOWLEDGE", text: "A听说D已死。",
        fragmentIds: [snapshot.fragments[0].fragmentId], entityIds: [], participantIds: [1, 2],
        eventTime: { status: "reported" } }, snapshot);
      assert.equal(entry.evidence.sourceType, "rumor");
      assert.equal(entry.evidence.epistemicStatus, "reported");
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
      assert.equal(extractor.parseOutput(JSON.stringify({ summarySegments: [
        { content: "A说一。", participants: [1, 2], visibility: "participants", messageIds: [1], speakerIds: [1] }], memories: [] }),
      { finalizationVisibilityV1: true }).structured, false);
      const live = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
      assert.equal(live.includes("<votc-private>"), false);
      assert.equal(live.includes("<votc-group>"), false);
    });
    console.log(`V8.14-A Finalization visibility: ${passed} PASS`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

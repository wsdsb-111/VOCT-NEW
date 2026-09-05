"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-summary-incident-"));
  try {
    const participants = [{ id: 1, name: "旧玩家", shortName: "旧玩家" }, { id: 2, name: "甲", shortName: "甲" }];
    const GameData = createGameData({ fs, path, memorySystem, summariesDir: path.join(root, "summaries"), getHistoricalReferenceByYear: () => "" });
    const data = Object.create(GameData.prototype);
    Object.assign(data, { playerID: 99, date: "1200.1.1", totalDays: 900, characters: new Map([...participants, { id: 99, shortName: "新玩家" }].map(p => [p.id, p])) });
    const projections = new Map(memorySystem.buildDirectedParticipantPairs(participants).map(({ owner, counterpart }) => [`${owner.id}->${counterpart.id}`, { ownerId: owner.id, counterpartId: counterpart.id, content: "旧会话投影", projectionHash: "test", memoryIds: [], summarySegmentIds: [] }]));
    const options = { finalizationId: "old", participantProfiles: participants, directedSummaries: projections, date: "1100.1.1", totalDays: 100 };
    assert.equal(data.saveCharactersSummaries("旧摘要", [1, 2], options).directedFilesWritten, 2, "a new player must not be injected into old recovery pairs");
    data.saveCharactersSummaries("旧摘要", [1, 2], options);
    const files = fs.readdirSync(path.join(root, "summaries"), { recursive: true }).filter(file => file.endsWith(".json"));
    assert.equal(files.length, 2);
    for (const file of files) {
      const rows = JSON.parse(fs.readFileSync(path.join(root, "summaries", file)));
      assert.equal(rows.length, 1, "recovery is idempotent");
      assert.equal(rows[0].date, "1100.1.1");
      assert.equal(rows[0].totalDays, 100);
      assert.ok(!rows[0].participants.some(p => p.id === 99));
    }
    const engine = new memorySystem.MemoryEngine({ baseDir: path.join(root, "memory"), trace: new memorySystem.MemoryTrace({ logger: { log() {} } }) });
    const context = { conversationId: "long", date: "1100.1.1", totalDays: 100, participants, participantPresence: [], messages: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, role: i % 2 ? "assistant" : "user", name: i % 2 ? "甲" : "旧玩家", content: "原始对话信息" })), buildPrompt: c => c.messages };
    let calls = 0;
    context.requestSummary = async messages => {
      calls++;
      if (messages.length > 3) return { content: '{"summarySegments":[', finish_reason: "length" };
      return { content: JSON.stringify({ summarySegments: [{ content: "完整且有来源的片段", participants: [1, 2], messageIds: messages.map(m => m.id) }], memories: [] }), finish_reason: "stop" };
    };
    const result = await engine.requestFinalSummary(context);
    const parsed = engine.extractor.parseOutput(result, context);
    assert.equal(engine.evaluateFinalSummaryQuality(context, parsed).success, true);
    assert.deepEqual(parsed.summarySegments.flatMap(s => s.provenance.messageIds), context.messages.map(m => m.id));
    assert.equal(calls, 6, "two whole requests plus four bounded chunks, never unbounded recursion");
    const boundaryContext = { ...context, preferChunkedSummary: true, participantPresence: [{ characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null }, { characterId: 2, joinedAtMessageId: 2, leftAtMessageId: 8 }] };
    boundaryContext.requestSummary = async messages => {
      assert.ok(![2, 8].some(boundary => messages[0].id < boundary && messages.at(-1).id >= boundary), "input chunks themselves cannot cross presence boundaries");
      return { content: JSON.stringify({ summarySegments: [{ content: "边界内的完整叙事", participants: [1], messageIds: messages.map(m => m.id) }], memories: [] }) };
    };
    const boundaryOutput = await engine.requestFinalSummary(boundaryContext);
    assert.equal(engine.evaluateFinalSummaryQuality(boundaryContext, engine.extractor.parseOutput(boundaryOutput, boundaryContext)).success, true);
    const markerContext = { ...boundaryContext, participantPresence: [{ characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null }, { characterId: 2, joinedAtMessageId: 4, leftAtMessageId: 5 }], messages: context.messages.map(message => message.id === 4 ? { ...message, role: "system", kind: "presence_join", content: "【甲入内】" } : message) };
    markerContext.requestSummary = async messages => {
      assert.ok(!messages.every(message => message.kind === "presence_join"), "system-only boundary events must not provoke invented dialogue");
      return { content: JSON.stringify({ summarySegments: [{ content: "边界内叙事", participants: [1], messageIds: messages.map(m => m.id) }], memories: [] }) };
    };
    const markerOutput = await engine.requestFinalSummary(markerContext);
    assert.ok(engine.extractor.parseOutput(markerOutput, markerContext).summarySegments.some(segment => segment.content === "【甲入内】"));
    assert.ok(engine.buildFinalizationPrompt({ ...context, messages: context.messages.slice(5) }).at(-1).content.includes("[6,7,8,9,10,11,12]"));
    const trace = new memorySystem.MemoryTrace({ logger: { log() {} } }).record("summary_provider", { success: false, error: "truncated_final_summary_response", attempt: 2 });
    assert.equal(trace.error, "truncated_final_summary_response", "incident diagnostics must not discard the actual failure");
    assert.equal(trace.success, false);

    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const events = [];
    Conversation.configure({ settingsRepository: { getCK3DebugLogPath: () => "fixture.log" }, runFileManager: { isAvailable: () => true }, parseLog: async () => ({ characters: new Map(), loadCharactersSummaries() {} }) });
    const conversation = Object.create(Conversation.prototype);
    Object.assign(conversation, { captureSummaryParticipantProfiles() {}, initializePresence() { events.push("presence"); }, recoverPendingMemories() { events.push("recover"); return pending; }, emitUpdate() { events.push("ready"); }, isActive: false });
    const initialized = conversation.initializeGameData();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(conversation.isActive, true, "entry buttons cannot wait for network recovery");
    assert.ok(events.indexOf("ready") < events.indexOf("recover"));
    release([]);
    await initialized;
    Conversation.configure({ runFileManager: { write() { throw new Error("fixture_close_failure"); } } });
    const finalizing = Object.create(Conversation.prototype);
    Object.assign(finalizing, { messages: [{ role: "user" }, { role: "assistant" }], createFinalSummary: async () => ({ success: true, finalSummary: "safe" }), end() {} });
    assert.equal((await finalizing.finalizeConversation()).success, true, "game close failure must not prevent summary generation");
    let rejectedWrites = 0, rejectedCalls = 0;
    const failure = await engine.finalizeConversation({ ...context, conversationId: "still-truncated", requestSummary: async () => { rejectedCalls++; return { finish_reason: "length", content: "{" }; }, persistCharacterFolders: async () => { rejectedWrites++; } });
    assert.equal(failure.success, false);
    assert.equal(rejectedWrites, 0, "failed chunks cannot commit partial summaries");
    assert.equal(rejectedCalls, 4, "a failing chunk stops further expensive requests");
    assert.ok(fs.existsSync(failure.recoveryPath), "failed chunk recovery retains source messages");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log("Summary incident: PASS (old-player isolation, original date, idempotency, bounded long-summary recovery, presence startup and error telemetry)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

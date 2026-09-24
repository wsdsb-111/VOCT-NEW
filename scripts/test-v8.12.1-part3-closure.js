"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { MemoryRanker } = require("../resources/app/out/main/memory-system/memory-ranker");
const { buildOfficialRecollectionSummary, compileOfficialRecollection } = require("../resources/app/out/main/memory-system/official-recollection-provider");

function testOfficialEvents() {
  const summary = buildOfficialRecollectionSummary({
    character: { id: 2, shortName: "角色二", memories: [
      { creationDate: "1152年1月1日", creationDateTotalDays: 5000, desc: "完整长事件。".repeat(300) },
      { creationDate: "1151年1月1日", creationDateTotalDays: 4635, desc: "我与角色一成为朋友。\n\n随后共同守城。" },
      { creationDate: "1150年1月1日", creationDateTotalDays: 4270, desc: "我履行了约定，归还书籍。" }
    ] },
    gameData: { date: "1152.1.1", totalDays: 5000 }, sessionId: "closure", schemaVersion: "2.5", engineVersion: "3.0"
  });
  const [header, longEvent, firstPart, secondPart, laterEvent] = summary.content.split("\n\n");
  const shortEvent = `${firstPart}\n\n${secondPart}`;
  const storedBytes = Buffer.from(JSON.stringify(summary), "utf8");
  const ranker = new MemoryRanker();
  for (const importance of [0.65, 0.99]) {
    const memory = { ...summary, type: "folder_summary", subtype: "official_recollection", importance };
    const originalBytes = Buffer.from(memory.content, "utf8");
    const ranked = [{ memory, score: 1 }];
    for (const allowTruncate of [false, true]) {
      const expected = [header, shortEvent, laterEvent].join("\n\n");
      const selected = ranker.selectWithinBudget(ranked, { tokenBudget: expected.length, estimateTokens: text => text.length, allowTruncate });
      assert.equal(selected.length, 1);
      assert.equal(selected[0].memory.content, expected, "skip an overlong event and continue selecting later complete events");
      assert.equal(selected[0].tokens, expected.length);
      assert(!selected[0].memory.content.includes(longEvent));
      assert.deepEqual(Buffer.from(memory.content, "utf8"), originalBytes, "recall clipping must leave the stored string byte-identical");
      const partialBudget = [header, firstPart].join("\n\n").length;
      const withoutPartial = ranker.selectWithinBudget(ranked, { tokenBudget: partialBudget, estimateTokens: text => text.length, allowTruncate });
      assert(!withoutPartial.some(entry => entry.memory.content.includes(firstPart)), "never split an event at an internal paragraph break");
      assert.equal(ranker.selectWithinBudget(ranked, { tokenBudget: header.length, estimateTokens: text => text.length, allowTruncate }).length, 0,
        "never return a header alone or a partial event, even for critical memories");
      const full = ranker.selectWithinBudget(ranked, { tokenBudget: memory.content.length, estimateTokens: text => text.length, allowTruncate });
      assert.deepEqual(Buffer.from(full[0].memory.content, "utf8"), originalBytes, "an exact fit preserves the complete document");
    }
  }
  assert.deepEqual(Buffer.from(JSON.stringify(summary), "utf8"), storedBytes);

  const snapshot = { gameDate: "1152.1.1", characters: {
    "2": { alive: true, officialMemoryIds: ["long", "short"] }
  }, officialMemoryDatabase: {
    long: { memoryId: "long", memoryType: "long", creationDate: "1151.1.1", holderCharacterIds: ["2"] },
    short: { memoryId: "short", memoryType: "short", creationDate: "1150.1.1", holderCharacterIds: ["2"] }
  } };
  const snapshotBytes = Buffer.from(JSON.stringify(snapshot));
  const compiled = compileOfficialRecollection({ snapshot, ownerCharacterId: 2, tokenBudget: 200, estimateTokens: text => text.length,
    localize: (_, key) => ({ confidence: "CONFIRMED", localizedValue: key === "long" ? "完整事件".repeat(300) : "后来发生的完整短事件。" }) });
  assert.deepEqual(compiled.entries.map(entry => entry.memoryId), ["short"]);
  assert.equal(compiled.trimmedMemoryCount, 1);
  assert(compiled.renderedSummary.endsWith("1150年1月1日：后来发生的完整短事件。"));
  assert.deepEqual(Buffer.from(JSON.stringify(snapshot)), snapshotBytes);
}

function testEditorHint() {
  const renderer = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
  const handlerStart = renderer.indexOf("  const handleEditSummary =");
  const handler = renderer.slice(handlerStart, renderer.indexOf("  const handleSaveEdit =", handlerStart));
  const hint = renderer.match(/editingEntry\.sourceType === "CK3_OFFICIAL_RECOLLECTION" &&[^\n]+/);
  assert(hint, "the official hint must render conditionally inside the summary editor");
  const expected = "官方追忆来自 CK3。本页修改作用于当前同步副本；开始新对话后，系统可能根据最新 CK3 日志重新覆盖。";
  for (const sourceType of ["CK3_OFFICIAL_RECOLLECTION", undefined]) {
    let editingEntry;
    const context = { metadata: { playerId: 2, characterId: 2, ownerName: "角色二", summaries: [{ sourceType }] },
      setEditingEntry: value => { editingEntry = value; } };
    vm.runInNewContext(`${handler}\nhandleEditSummary(metadata, 0, "原文");`, context);
    assert.equal(editingEntry.sourceType, sourceType);
    const rendered = vm.runInNewContext(hint[0].replace(/,\s*$/, ""), {
      editingEntry, jsxRuntimeExports: { jsx: (type, props) => ({ type, ...props }) }
    });
    if (sourceType) {
      assert.equal(rendered.type, "p");
      assert.equal(rendered.className, "help-text");
      assert.equal(rendered.children, expected);
    } else assert.equal(rendered, false, "ordinary summaries must not display the official overwrite warning");
  }
  const editor = renderer.slice(renderer.indexOf('className: "modal-content summary-edit-modal"'));
  assert(editor.indexOf(expected) >= 0 && editor.indexOf(expected) < editor.indexOf('"textarea"'), "show the hint above the editor input");
}

// Reuse the real-engine / deterministic Provider / on-disk checkpoint pattern
// from test-v8.12-context-summary-reliability.js, without invoking a live API.
async function testChunkBoundaries(root) {
  const capabilities = { providerId: "closure", providerType: "fixture", modelId: "fixture", contextWindow: 90000, maxOutputTokens: 4096 };
  for (const count of [63, 64, 65]) {
    const baseDir = path.join(root, String(count));
    let engine = new MemoryEngine({ baseDir, trace: { record() {} } });
    const messages = Array.from({ length: count }, (_, index) => ({ id: index + 1, role: "user", name: "角色一", speakerCharacterId: 1,
      content: `第${index + 1}条：双方确认具体事件及后续履行约定。` }));
    const participantPresence = [{ characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
      ...messages.filter(message => message.id % 2 === 1).map(message => ({ characterId: 2, joinedAtMessageId: message.id, leftAtMessageId: message.id + 1 }))];
    const calls = [];
    let failureId = count === 64 ? 17 : null;
    let context = engine.prepareFinalizationContext({ conversationId: `closure-${count}`, messages, participantPresence,
      participants: [{ id: 1, name: "角色一" }, { id: 2, name: "角色二" }], preferChunkedSummary: true,
      getSummaryCapabilities: async () => capabilities,
      buildPrompt: chunk => engine.buildFinalizationPrompt(chunk), requestSummary: async prompt => {
        const ids = JSON.parse(prompt.at(-1).content.match(/allowed messageIds are (\[[^\]]+\])/)[1]);
        assert.equal(ids.length, 1, "each real presence transition must create a separate chunk");
        calls.push(ids[0]);
        if (ids[0] === failureId) throw new Error("fixture_network_failure");
        return { finish_reason: "stop", content: JSON.stringify({ summarySegments: [{
          content: `第${ids[0]}条具体事件已确认，并约定后续履行次序。`, participants: [1], messageIds: ids
        }], memories: [] }) };
      }
    });
    if (count === 65) {
      await assert.rejects(engine.requestFinalSummary(context), /summary_chunk_hard_limit_exceeded/);
      assert.equal(calls.length, 0, "65 chunks must be rejected before any Provider request");
      continue;
    }
    assert.equal(engine.partitionSummaryMessages(context, capabilities).length, count);
    for (const failedId of count === 64 ? [17, 49] : []) {
      failureId = failedId;
      await assert.rejects(engine.requestFinalSummary(context), /fixture_network_failure/);
      const snapshot = JSON.parse(fs.readFileSync(path.join(baseDir, "recovery", `conversation_closure-${count}.json`), "utf8"));
      assert.equal(Object.keys(snapshot.summaryChunkState.outputs).length, failedId - 1);
      assert.equal(snapshot.summaryChunkState.outputs[String(failedId - 1)], undefined, "failed output must not be checkpointed as complete");
      for (let id = 1; id < failedId; id++) {
        assert.deepEqual(snapshot.summaryChunkState.outputs[String(id - 1)].summarySegments[0].messageIds, [id]);
        if (id !== 17) assert.equal(calls.filter(value => value === id).length, 1, "completed chunks must never be regenerated after restart");
      }
      engine = new MemoryEngine({ baseDir, trace: { record() {} } });
      context = engine.prepareFinalizationContext({ ...context, messages: snapshot.rawMessages,
        summaryProviderSnapshot: snapshot.summaryProviderSnapshot, summaryChunkState: snapshot.summaryChunkState });
    }
    failureId = null;
    const parsed = engine.extractor.parseOutput(await engine.requestFinalSummary(context), context);
    assert.deepEqual(parsed.summarySegments.flatMap(segment => segment.provenance.messageIds), messages.map(message => message.id),
      "all chunks must survive ordered recovery, with no missing or duplicated events");
    assert.equal(engine.evaluateFinalSummaryQuality(context, parsed).success, true);
    assert.equal(Object.keys(context.summaryChunkState.outputs).length, count);
    for (let id = 1; id <= count; id++) {
      if (count === 64 && [17, 49].includes(id)) assert(calls.filter(value => value === id).length > 1);
      else assert.equal(calls.filter(value => value === id).length, 1);
    }
  }
}

async function main() {
  testOfficialEvents();
  testEditorHint();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-part3-closure-"));
  try {
    await testChunkBoundaries(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("V8.12.1 Part3 closure: PASS (complete events, editor hint, 63/64/65 chunks, restart checkpoints)");
}

main().catch(error => { console.error(error); process.exitCode = 1; });

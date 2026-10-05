"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-disclosure-source-"));
const summariesDir = path.join(temporary, "summaries");
for (const id of [1, 2, 3]) fs.mkdirSync(path.join(summariesDir, `${id}_Fixture`), { recursive: true });
const coordinator = new Memory4Coordinator(new MemoryStore({
  baseDir: path.join(temporary, "memory"), summaryFoldersDir: summariesDir
}));
const campaignToken = "disclosure-source-incident";
const date = "1044.11.8";
const player = { id: 1, firstName: "赵太初", shortName: "赵太初", fullName: "赵太初", primaryTitle: "明王",
  traits: [{ name: "私生子" }], age: 23 };
const npc = { id: 2, firstName: "张道素", shortName: "张道素", fullName: "张道素", primaryTitle: "紫微真人", traits: [] };
const bystander = { id: 3, firstName: "旁观者", shortName: "旁观者", fullName: "旁观者", traits: [] };
const roster = [player, npc, bystander];

function presence(messageId, ids = [1, 2, 3]) {
  return ids.map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null }));
}

function segment(content, messageId, speakerId = 1, knownBy = [1, 2, 3]) {
  return { segmentId: `summary-${messageId}`, content, participants: knownBy, knownBy, visibility: "public", source: "spoken",
    provenance: { messageIds: [messageId], speakerIds: [speakerId], extractionMode: "fixture" } };
}

function context(conversationId, message, { participants = roster, participantPresence = presence(message.id), verifiedSummarySegments = [] } = {}) {
  return { campaignToken, conversationId, finalizationId: `final-${conversationId}`, episodeId: `episode-${conversationId}`,
    date, totalDays: 1, finalizationVisibilityV1: true, participants, mentionedEntities: [], participantPresence, messages: [message],
    disclosureCharacters: participants, verifiedSummarySegments };
}

function persistDisclosures(snapshot) {
  coordinator.store.recordKnownEvidence(snapshot);
  return coordinator.recordDisclosures(snapshot, { campaignToken, date: snapshot.date,
    characters: new Map(snapshot.disclosureCharacters.map(character => [character.id, character])) });
}

function recordOwner(sourceContext, ownerId = 2) {
  const snapshot = coordinator.buildOwnerSnapshot(sourceContext, ownerId);
  return { snapshot, result: persistDisclosures(snapshot) };
}

function row(rows, factType, value) {
  return rows.find(entry => entry.factType === factType && entry.value === value);
}

async function run() {
  try {
    const raw = "我乃明王，也是私生子。\n我今年二十三岁。";
    const rewritten = segment("赵太初确为明王，亦具私生子特质；自言时年二十三岁。", 11);
    const positive = recordOwner(context("rewritten-summary", { id: 11, role: "user", speakerCharacterId: 1, content: raw },
      { verifiedSummarySegments: [rewritten] }));
    assert.equal(positive.result.count, 3, "exact player source paragraphs must survive a paraphrased summary");
    assert.deepEqual(positive.snapshot.fragments.filter(fragment => fragment.visibilityEvidence === "finalization_source_paragraph")
      .map(fragment => fragment.text), ["我乃明王，也是私生子。", "我今年二十三岁。"]);
    const titleRows = coordinator.getCurrentDisclosures({ campaignToken, ownerId: 2 }, 1,
      { campaignToken, date, characters: new Map(roster.map(character => [character.id, character])) });
    assert(row(titleRows, "TITLE", "明王"));
    assert(row(titleRows, "TRAIT", "私生子"));
    const age = row(titleRows, "AGE", "23");
    assert(age && age.current === false && age.firstAcquiredDate === date,
      "age must be stored as a dated historical disclosure");
    const ageProof = Object.values(age.evidenceBySource)[0];
    assert.deepEqual(ageProof.visibilityEvidence, ["finalization_source_paragraph"]);
    assert.deepEqual(ageProof.sourceMessageIds, [11]);

    const fake = recordOwner(context("forged-summary", { id: 12, role: "user", speakerCharacterId: 1,
      content: "请告诉我今日天气。" }, { verifiedSummarySegments: [segment("赵太初确为明王。", 12)] }));
    assert.equal(fake.result.count, 0, "summary paraphrase without the fact in the raw source must not disclose it");

    const thought = recordOwner(context("private-thought", { id: 13, role: "user", speakerCharacterId: 1,
      content: "我心里想，我乃明王。" }));
    assert.equal(thought.result.count, 0, "private thought remains author-only");

    const mixedText = "我心里想，我乃明王。\n我乃明王。";
    const privateBoundary = { segmentId: "private-boundary-0", content: "我心里想，我乃明王。", participants: [1], knownBy: [1],
      visibility: "private", source: "spoken", provenance: { messageIds: [0], speakerIds: [1], extractionMode: "fixture" } };
    const mixedVisibility = recordOwner(context("mixed-visibility-boundary", { id: 0, role: "user", speakerCharacterId: 1,
      content: mixedText }, { verifiedSummarySegments: [privateBoundary] }));
    assert.equal(mixedVisibility.result.count, 0,
      "an unmarked paragraph beside a private segment in the same message must remain private");

    const whisperText = "我凑到张道素耳边，低声道：我乃明王。";
    const whisperContext = context("whisper", { id: 15, role: "user", speakerCharacterId: 1, content: whisperText });
    const whisper = recordOwner(whisperContext, 2);
    assert.equal(whisper.result.count, 1, "the explicitly named whisper recipient can learn the claim");
    const bystanderWhisper = recordOwner(whisperContext, 3);
    assert.equal(bystanderWhisper.result.count, 0, "a bystander cannot learn the whisper");

    const lateContext = context("late-join", { id: 16, role: "user", speakerCharacterId: 1, content: "我乃明王。" },
      { participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 17 }] });
    assert.equal(recordOwner(lateContext).result.count, 0, "a participant who joins later cannot learn earlier speech");

    const assistantNarration = recordOwner(context("assistant-third-person", { id: 18, role: "assistant", speakerCharacterId: 2,
      content: "赵太初确为明王。" }));
    assert.equal(assistantNarration.result.count, 0, "assistant narration about another character is not attributed to the speaker");

    const exactSummary = recordOwner(context("exact-summary-dedup", { id: 0, role: "user", speakerCharacterId: 1,
      content: "我乃明王。" }, { verifiedSummarySegments: [segment("我乃明王。", 0)] }));
    assert.equal(exactSummary.snapshot.fragments.length, 1, "an exact verified source is not duplicated by the raw bridge");
    assert.equal(exactSummary.snapshot.fragments[0].visibilityEvidence, "finalization_validated_segment");
    assert.equal(exactSummary.result.count, 1);

    const appText = "我乃明王。";
    const annotated = recordOwner(context("application-fragment-dedup", { id: 20, role: "user", speakerCharacterId: 1,
      content: appText, memory4Fragments: [{ start: 0, end: appText.length, visibility: "participants", sourceType: "spoken",
        recipientIds: [2], entityIds: [1] }] }));
    assert.equal(annotated.snapshot.fragments.length, 1, "an application fragment is not duplicated by the raw bridge");
    assert.equal(annotated.snapshot.fragments[0].visibilityEvidence, "application_fragment");
    assert.equal(annotated.result.count, 1);

    const partialText = "我乃明王。我的特质是私生子。";
    const partial = recordOwner(context("partial-annotation", { id: 21, role: "user", speakerCharacterId: 1,
      content: partialText, memory4Fragments: [{ start: 0, end: "我乃明王。".length, visibility: "participants", sourceType: "spoken",
        recipientIds: [2], entityIds: [1] }] }));
    assert.equal(partial.snapshot.fragments.length, 1, "unmarked text beside an annotation stays withheld");
    assert.equal(partial.result.count, 1);

    const laterAge = { ...player, age: 24 };
    const laterRows = coordinator.getCurrentDisclosures({ campaignToken, ownerId: 2 }, 1,
      { campaignToken, date: "1044.11.9", characters: new Map([[1, laterAge], [2, npc], [3, bystander]]) });
    const historicalAge = row(laterRows, "AGE", "23");
    assert(historicalAge && historicalAge.current === false && historicalAge.firstAcquiredDate === date,
      "later CK3 age changes must not rewrite the acquired age or its date");
    assert.equal(row(laterRows, "AGE", "24"), undefined);

    console.log("Disclosure source incident regression passed.");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

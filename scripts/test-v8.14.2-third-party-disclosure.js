"use strict";

const assert = require("node:assert/strict");
const { scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { directSpeechSpans } = require("../resources/app/out/main/memory-system/memory4-entity-context");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const campaignToken = "v8.14.2-third-party-disclosure";
const characters = [
  { id: 1, firstName: "甲", shortName: "甲", fullName: "甲", primaryTitle: "明王", traits: [{ id: "bastard", name: "私生子" }] },
  { id: 2, firstName: "乙", shortName: "乙", fullName: "乙", traits: [] },
  { id: 3, firstName: "丙", shortName: "丙", fullName: "丙", primaryTitle: "枢密使", traits: [] },
  { id: 4, firstName: "丁", shortName: "丁", fullName: "丁", traits: [] }
];
const gameData = { campaignToken, date: "1170.1.1", characters: new Map(characters.map(character => [character.id, character])) };

function snapshot(text, { ownerId = 2, knownBy = [ownerId], sourceRole = "assistant", entityIds = [1, 2, 3, 4] } = {}) {
  return { campaignToken, ownerId, conversationId: "conversation-1", finalizationId: "finalization-1",
    date: gameData.date, sourceRevision: hash("source-revision"), disclosureCharacters: characters,
    fragments: [{ fragmentId: "fragment-1", sourceMessageIds: [12], messageId: 12, text,
      speakerId: 3, sourceRole, entityIds, knownBy, visibility: "public", sourceType: "spoken",
      sourceTextVerified: true, visibilityEvidence: "finalization_validated_segment" }] };
}

function disclosures(text, options) {
  return scanVisibleDisclosures(snapshot(text, options), gameData).disclosures;
}

function hasDisclosure(rows, entityId, factType, value) {
  return rows.some(row => row.entityId === entityId && row.factType === factType && row.value === value);
}

const speech = "旁白。“甲是明王。”之后「甲是私生子。」";
const expectedSpans = [
  { start: speech.indexOf("甲是明王"), end: speech.indexOf("甲是明王") + "甲是明王。".length,
    text: "甲是明王。", source: "DIRECT_SPEECH" },
  { start: speech.indexOf("甲是私生子"), end: speech.indexOf("甲是私生子") + "甲是私生子。".length,
    text: "甲是私生子。", source: "DIRECT_SPEECH" }
];
assert.deepEqual(directSpeechSpans(speech), expectedSpans, "balanced quote spans preserve their original content offsets");
assert.deepEqual(directSpeechSpans("“甲” ‘乙’ 「丙」 『丁』 \"戊\"").map(span => span.text),
  ["甲", "乙", "丙", "丁", "戊"], "all supported quote pairs yield direct speech spans");
assert.deepEqual(directSpeechSpans("“甲是明王。’"), [], "mismatched quotes fail closed");
assert.deepEqual(directSpeechSpans("“甲是明王。"), [], "an unclosed quote fails closed");
assert.deepEqual(directSpeechSpans("“我听闻‘甲是明王。’”"), [], "nested reported speech is not a direct utterance");

const mixedNarration = "丙看着甲，心知甲正是明王。“甲是明王。”";
const mixedRows = disclosures(mixedNarration);
assert(hasDisclosure(mixedRows, 1, "TITLE", "明王"), "a direct third-person title assertion is disclosed to its listener");
assert.deepEqual(mixedRows.find(row => row.factType === "TITLE").evidence.sourceTextHashes, [hash(mixedNarration)],
  "disclosure evidence hashes the original fragment, not an extracted speech span");
assert(hasDisclosure(disclosures("“甲是私生子。”"), 1, "TRAIT", "私生子"),
  "a current third-person Trait assertion can be disclosed");

const audience = disclosures("“甲是明王。”", { ownerId: 2, knownBy: [2, 4] });
assert(hasDisclosure(audience, 1, "TITLE", "明王"), "a public direct assertion reaches its first listener");
assert(hasDisclosure(disclosures("“甲是明王。”", { ownerId: 4, knownBy: [2, 4] }), 1, "TITLE", "明王"),
  "a public direct assertion reaches other authorized listeners");
assert.deepEqual(disclosures("“甲是明王。”", { ownerId: 4, knownBy: [2] }), [],
  "an undisclosed whisper cannot reach a bystander");

assert.deepEqual(disclosures("丙看着甲，心知甲正是明王。"), [], "assistant narration cannot disclose a fact");
assert.deepEqual(disclosures("丙向明王甲行了一礼。"), [], "assistant action description cannot disclose a fact");
assert.deepEqual(disclosures("丙心想：“甲是明王。”"), [], "a quote attributed to the speaker's thoughts is not spoken aloud");
assert.deepEqual(disclosures("乙说道：“甲是明王。”"), [], "a quote attributed to another speaker is not the assistant speaker's utterance");
assert(hasDisclosure(disclosures("丙说道：“甲是明王。”"), 1, "TITLE", "明王"),
  "an explicitly attributed utterance by the assistant speaker remains eligible");
assert.deepEqual(disclosures("“有人说甲是明王。”"), [], "quoted third-person attribution cannot disclose a fact");
assert.deepEqual(disclosures("“我听说甲是明王。”"), [], "quoted hearsay cannot disclose a fact");
assert.deepEqual(disclosures("“甲不是明王。”"), [], "a direct negation cannot disclose the denied fact");
assert.deepEqual(disclosures("“甲是明王。”", { sourceRole: "mixed" }), [], "mixed-role fragments fail closed");
assert.deepEqual(disclosures("我乃枢密使。"), [], "unquoted assistant self-claims remain ineligible");
assert(hasDisclosure(disclosures("“我是枢密使。”"), 3, "TITLE", "枢密使"),
  "a self-claim remains eligible inside direct speech");
assert(hasDisclosure(disclosures("甲是明王。", { sourceRole: "user" }), 1, "TITLE", "明王"),
  "user source text keeps its existing whole-fragment scan contract");

console.log("V8.14.2 third-party direct-speech disclosure: PASS");

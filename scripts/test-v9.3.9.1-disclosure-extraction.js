"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getDisclosureFactCandidates, extractCharacterDisclosures } = require("../src/app/main/conversation/character-disclosure-extraction");

const campaignToken = "v9.3.9.1-disclosure-fixture";
const gameDate = "1164.5.20";
const characters = new Map([
  [1, { id: 1, fullName: "安娜", firstName: "安娜", shortName: "甲", primaryTitle: "女王", traits: [] }],
  [2, { id: 2, fullName: "赵太初", firstName: "赵太初", shortName: "乙", primaryTitle: "皇帝",
    traits: [{ id: "brave", name: "勇敢" }, { id: "bastard", name: "私生子" }], knownSecrets: [] }],
  [3, { id: 3, fullName: "丙", firstName: "丙", shortName: "丙", primaryTitle: "伯爵", traits: [] }],
  [4, { id: 4, fullName: "丁", firstName: "丁", shortName: "丁", primaryTitle: "伯爵",
    traits: [{ id: "bastard", name: "私生子" }] }]
]);

function gameData(rows = characters) {
  return { campaignToken, date: gameDate, characters: rows };
}

function source(overrides = {}) {
  return { conversationId: "conversation-1", messageId: 17, messageRevision: "a".repeat(64),
    campaignToken, gameDate, ...overrides };
}

function extract(text, options = {}) {
  return extractCharacterDisclosures({ gameData: options.gameData || gameData(), speakerId: options.speakerId ?? 2,
    text, audienceIds: options.audienceIds || [1], candidateTargetIds: options.candidateTargetIds || [2, 4],
    knownFacts: options.knownFacts || [], source: options.source || source() }).disclosures;
}

function fact(rows, ownerRuntimeId, targetRuntimeId, factType, value) {
  return rows.find(row => row.ownerRuntimeId === ownerRuntimeId && row.targetRuntimeId === targetRuntimeId
    && row.factType === factType && row.value === value);
}

const candidates = getDisclosureFactCandidates(characters.get(2));
assert.deepEqual(candidates.filter(row => row.factType === "NAME").map(row => row.factKey), ["name_乙", "name_赵太初"]);
assert(candidates.some(row => row.factType === "TITLE" && row.factKey === "title_皇帝"));
assert(candidates.some(row => row.factType === "TRAIT" && row.factKey === "trait_brave"));
assert(candidates.every(row => !/AGE/.test(row.factType)), "the candidate helper excludes age");
assert.deepEqual(getDisclosureFactCandidates({ id: 9, age: 42, facts: [{ factType: "AGE", value: 42 }] })
  .filter(row => row.factType === "AGE"), [], "the candidate helper never turns age into a disclosure fact");

const ck3CharacterShape = { id: 5, shortName: "隼", fullName: "安德烈·德·蒙特福特", firstName: "安德烈",
  nickname: "雄狮", primaryTitle: "奥尔良公爵领", titleRankConcept: "title_rank_duchy",
  heldCourtAndCouncilPositions: "宰相", facts: [{ factType: "TRAIT", value: "勇敢" }], traits: [] };
const ck3Candidates = getDisclosureFactCandidates(ck3CharacterShape);
assert(ck3Candidates.some(row => row.factType === "NAME" && row.value === "安德烈·德·蒙特福特"),
  "actual CK3 fullName is represented as a NAME fact");
assert(ck3Candidates.some(row => row.factType === "NAME" && row.value === "隼"),
  "actual CK3 shortName is represented as a NAME fact");
assert(!ck3Candidates.some(row => row.factType === "NAME" && row.value === "雄狮"),
  "nickname never leaks into NAME candidates");
assert(ck3Candidates.some(row => row.factType === "NICKNAME" && row.factKey === "nickname_雄狮" && row.value === "雄狮"),
  "actual CK3 nickname is a separate stable NICKNAME candidate");
assert(ck3Candidates.some(row => row.factType === "TITLE" && row.value === "奥尔良公爵领")
  && ck3Candidates.some(row => row.factType === "TITLE" && row.value === "公爵"),
  "actual CK3 primaryTitle and title_rank_* survive alongside a facts array as title candidates");
assert(ck3Candidates.some(row => row.factType === "TITLE" && row.value === "宰相"),
  "actual Character.heldCourtAndCouncilPositions is represented as a TITLE candidate");

const selfFacts = extract("我乃皇帝，生性勇敢。", { audienceIds: [1, 1, 2, 0, "bad"] });
assert(fact(selfFacts, 1, 2, "TITLE", "皇帝"), "a direct current self-title assertion is recorded to the listener");
assert(fact(selfFacts, 1, 2, "TRAIT", "勇敢"), "a direct current self-trait assertion is recorded to the listener");
assert.equal(selfFacts.some(row => row.ownerRuntimeId === 2 || row.targetRuntimeId === row.ownerRuntimeId), false,
  "the speaker and self-pairs are excluded");
const nameRows = extract("我的名字是赵太初。");
assert(fact(nameRows, 1, 2, "NAME", "赵太初"), "an explicit name disclosure is extracted as a current NAME fact");
assert.equal(nameRows[0].factKey, "name_赵太初");
assert.deepEqual(nameRows[0].sourceIdentity, { conversationId: "conversation-1", messageId: 17,
  messageRevision: "a".repeat(64), campaignToken, gameDate, speakerRuntimeId: 2 }, "the caller's source identity is retained");
for (const text of ["我叫赵太初。", "我名叫赵太初。", "在下赵太初。", "我是赵太初。", "吾名为赵太初。"])
  assert(fact(extract(text), 1, 2, "NAME", "赵太初"), `an exact direct self-name statement is extracted: ${text}`);
for (const text of ["吾乃赵太初。", "臣名赵太初。", "臣名为赵太初。"])
  assert(fact(extract(text), 1, 2, "NAME", "赵太初"), `an exact classical self-name statement is extracted: ${text}`);
for (const text of ["我是不是赵太初？", "我不是赵太初。", "我将改名为赵太初。", "别人说我叫赵太初。"])
  assert.deepEqual(extract(text), [], `question, denial, future or reported name claims are rejected: ${text}`);
for (const text of ["吾乃赵太初吗？", "吾非赵太初。", "臣名不是赵太初。", "听说，吾乃赵太初。", "听说臣名赵太初。"])
  assert.deepEqual(extract(text), [], `classical name syntax keeps question, denial and hearsay boundaries: ${text}`);

const audienceRows = extract("我乃皇帝。", { audienceIds: [1, 3, 4, 2] });
assert.deepEqual([...new Set(audienceRows.map(row => row.ownerRuntimeId))], [1, 3, 4],
  "only the caller's frozen audience receives directed listener rows");
assert.equal(fact(audienceRows, 99, 2, "TITLE", "皇帝"), undefined, "an absent listener never receives a row");

const knownThirdPersonTitle = [{ ownerRuntimeId: 2, targetRuntimeId: 4, factType: "TITLE",
  factKey: "title_伯爵", value: "伯爵", status: "KNOWN" }];
const thirdPerson = extract("丁是伯爵。", { candidateTargetIds: [4], knownFacts: knownThirdPersonTitle });
assert(fact(thirdPerson, 1, 4, "TITLE", "伯爵"), "a previously known current third-person fact may be disclosed");
assert.equal(thirdPerson.length, 1, "the fact is emitted only to the one supplied listener");
assert.deepEqual(extract("丁是伯爵。", { candidateTargetIds: [4] }), [],
  "current game data alone does not authorize third-person disclosure");
assert.deepEqual(extract("丁是伯爵。", { candidateTargetIds: [4], knownFacts: [{ ...knownThirdPersonTitle[0], ownerRuntimeId: 1 }] }), [],
  "another owner's pair fact cannot authorize the speaker");
assert.deepEqual(extract("丁是伯爵。", { candidateTargetIds: [4], knownFacts: [{ ...knownThirdPersonTitle[0], status: "MANUAL_HIDDEN" }] }), [],
  "hidden or revoked speaker knowledge cannot authorize a disclosure");
assert.deepEqual(extract("丙是伯爵。", { candidateTargetIds: [4], knownFacts: knownThirdPersonTitle }), [],
  "a character outside candidateTargetIds is never resolved even when it exists in GameData");

const secretSpeaker = new Map(characters);
secretSpeaker.set(2, { ...characters.get(2), knownSecrets: [{ type: "secret_bastard", ownerId: 4 }] });
const disclosedSecret = extract("丁是私生子。", { gameData: gameData(secretSpeaker), candidateTargetIds: [4] });
assert(fact(disclosedSecret, 1, 4, "TRAIT", "私生子"), "a speaker's own matching knownSecret permits a third-person secret disclosure");
const wrongSecretOwner = new Map(secretSpeaker);
wrongSecretOwner.set(2, { ...secretSpeaker.get(2), knownSecrets: [{ type: "secret_bastard", ownerId: 3 }] });
assert.deepEqual(extract("丁是私生子。", { gameData: gameData(wrongSecretOwner), candidateTargetIds: [4] }), [],
  "a secret known about another target cannot authorize this target");
const listenerSecret = new Map(characters);
listenerSecret.set(1, { ...characters.get(1), knownSecrets: [{ type: "secret_bastard", ownerId: 4 }] });
assert.deepEqual(extract("丁是私生子。", { gameData: gameData(listenerSecret), candidateTargetIds: [4] }), [],
  "a listener's knownSecret cannot be borrowed as the speaker's knowledge");
assert(fact(extract("我乃私生子。"), 1, 2, "TRAIT", "私生子"),
  "a character may directly disclose their own current secret trait");

const ambiguousCharacters = new Map(characters);
ambiguousCharacters.set(3, { ...characters.get(3), fullName: "丁", firstName: "丁", shortName: "丁" });
assert.deepEqual(extract("丁是伯爵。", { gameData: gameData(ambiguousCharacters), candidateTargetIds: [3, 4], knownFacts: knownThirdPersonTitle }), [],
  "same-name targets fail closed");
assert.deepEqual(extract("丁是皇帝。", { candidateTargetIds: [4], knownFacts: knownThirdPersonTitle }), [],
  "a statement that conflicts with the target's current candidate is not recorded");

const identityClaimCharacters = new Map(characters);
identityClaimCharacters.set(2, { ...characters.get(2), fullName: "赵太初", firstName: "赵太初", shortName: "乙",
  nickname: "铁腕", primaryTitle: "奥尔良公爵领", titleRankConcept: "concept_duchy",
  heldCourtAndCouncilPositions: "宰相" });
const identityClaim = (text) => extract(text, { gameData: gameData(identityClaimCharacters), speakerId: 2,
  audienceIds: [1], candidateTargetIds: [2, 4] });
for (const text of ["我叫赵太初。", "我的名字是赵太初。", "在下赵太初。", "我是赵太初。"])
  assert(fact(identityClaim(text), 1, 2, "NAME", "赵太初"), `real-field NAME claim is extracted: ${text}`);
for (const text of ["吾乃赵太初。", "臣名赵太初。", "臣名为赵太初。"])
  assert(fact(identityClaim(text), 1, 2, "NAME", "赵太初"), `real-field classical NAME claim is extracted: ${text}`);
for (const text of ["我是公爵。", "我的头衔是公爵。"])
  assert(fact(identityClaim(text), 1, 2, "TITLE", "公爵"), `real-field TITLE claim is extracted: ${text}`);
assert(fact(identityClaim("我的头衔是奥尔良公爵领。"), 1, 2, "TITLE", "奥尔良公爵领"),
  "exact current primaryTitle can be disclosed with an explicit title label");
const nameTitleIntro = identityClaim("我叫赵太初，现任公爵。");
assert(fact(nameTitleIntro, 1, 2, "NAME", "赵太初") && fact(nameTitleIntro, 1, 2, "TITLE", "公爵"),
  "a direct NAME clause followed by an explicit current title clause is extracted from one introduction");
const nameQuestionIntro = identityClaim("我叫赵太初，你愿意与我结盟吗？");
assert(fact(nameQuestionIntro, 1, 2, "NAME", "赵太初") && nameQuestionIntro.length === 1,
  "a direct name clause survives a separate trailing question without extracting question content");
const compoundIntro = identityClaim("在下赵太初，人称我铁腕，如今是宰相。");
assert(fact(compoundIntro, 1, 2, "NAME", "赵太初") && fact(compoundIntro, 1, 2, "NICKNAME", "铁腕")
  && fact(compoundIntro, 1, 2, "TITLE", "宰相"), "a direct NAME/NICKNAME/current-office introduction yields only its proven facts");
assert.deepEqual(identityClaim("听说，我叫赵太初。"), [],
  "a fronted hearsay clause still blocks the following labeled name claim");
const deniedCompound = identityClaim("我叫赵太初，现任不是公爵。");
assert(fact(deniedCompound, 1, 2, "NAME", "赵太初") && !deniedCompound.some(row => row.factType === "TITLE"),
  "a separate denied title clause does not cancel a direct name clause or disclose the denied title");
const futureCompound = identityClaim("我叫赵太初，如今会是公爵。");
assert(fact(futureCompound, 1, 2, "NAME", "赵太初") && !futureCompound.some(row => row.factType === "TITLE"),
  "a direct name clause does not turn a future title claim into a current fact");
const reportedCompound = identityClaim("我叫赵太初，听说如今是公爵。");
assert(fact(reportedCompound, 1, 2, "NAME", "赵太初") && !reportedCompound.some(row => row.factType === "TITLE"),
  "a trailing hearsay title clause is rejected independently");
assert.deepEqual(identityClaim("我叫赵太初吗？"), [], "a question in the NAME claim itself remains rejected");
for (const text of ["我的称号是铁腕。", "我的绰号是铁腕。", "人称我为铁腕。"])
  assert(fact(identityClaim(text), 1, 2, "NICKNAME", "铁腕"), `explicit current nickname claim is extracted: ${text}`);
for (const text of ["我的称号不是铁腕。", "我的称号会是铁腕。", "据说人称我为铁腕。", "我是不是人称铁腕？"])
  assert.deepEqual(identityClaim(text), [], `denied, future, hearsay or question nickname claim is rejected: ${text}`);
assert.equal(identityClaim("我是铁腕。").some(row => row.factType === "NICKNAME"), false,
  "nickname is not inferred from an unlabeled name/title mention");

const ambiguousNameCharacters = new Map(identityClaimCharacters);
ambiguousNameCharacters.set(3, { ...characters.get(3), fullName: "赵太初", firstName: "赵太初", shortName: "赵太初" });
assert.deepEqual(extract("赵太初的名字是赵太初。", { gameData: gameData(ambiguousNameCharacters), speakerId: 1,
  audienceIds: [1], candidateTargetIds: [2, 3], knownFacts: [
    { ownerRuntimeId: 1, targetRuntimeId: 2, factType: "NAME", factKey: "name_赵太初", value: "赵太初" },
    { ownerRuntimeId: 1, targetRuntimeId: 3, factType: "NAME", factKey: "name_赵太初", value: "赵太初" }
  ] }), [], "ambiguous same-name target fails closed for labeled name claims");

for (const text of ["我不是皇帝。", "我可能是皇帝。", "我将成为皇帝。", "我是不是皇帝？", "我听说自己是皇帝。",
  "听说，丁是伯爵。", "丁曾是伯爵。", "丁将成为伯爵。", "丁是伯爵的朋友。", "乙看着丁，丁是伯爵。", "乙心想：‘丁是伯爵。’",
  "乙把话写在纸上：“丁是伯爵。”"]) {
  assert.deepEqual(extract(text, { candidateTargetIds: [4], knownFacts: knownThirdPersonTitle }), [],
    `uncertain, reported, future, relational, or action narration is rejected: ${text}`);
}
assert(fact(extract("乙说道：“丁是伯爵。”", { candidateTargetIds: [4], knownFacts: knownThirdPersonTitle }),
  1, 4, "TITLE", "伯爵"), "an explicitly attributed direct quote from the speaker is retained");
assert.deepEqual(extract("丙说道：“丁是伯爵。”", { candidateTargetIds: [4], knownFacts: knownThirdPersonTitle }), [],
  "a direct quote attributed to another in-scene candidate is rejected");

const whisperCharacters = new Map(characters);
whisperCharacters.set(1, { ...characters.get(1), fullName: "阿甲", firstName: "阿甲", shortName: "阿甲",
  traits: [{ traitId: "witch", name: "巫师" }] });
whisperCharacters.set(2, { ...characters.get(2), fullName: "阿乙", firstName: "阿乙", shortName: "阿乙" });
const whispered = extract("只对阿乙低声说：“我是巫师。”", { gameData: gameData(whisperCharacters), speakerId: 1,
  audienceIds: [1, 2, 3], candidateTargetIds: [1, 2, 3] });
assert(fact(whispered, 2, 1, "TRAIT", "巫师"), "a source-validated whispered self-disclosure reaches its named addressee");
assert.equal(whispered.some(row => row.ownerRuntimeId === 3), false,
  "a whisper addressed only to one listener never transfers to another in-scene listener");
assert.deepEqual(extract("丙说道：“我是巫师。”", { gameData: gameData(whisperCharacters), speakerId: 1,
  audienceIds: [1, 2, 3], candidateTargetIds: [1, 2, 3] }), [],
  "a quote attributed to another character is not relabeled as the message speaker's disclosure");
assert.deepEqual(extract("只对阿乙低声说：“我听说我是巫师。”", { gameData: gameData(whisperCharacters), speakerId: 1,
  audienceIds: [1, 2], candidateTargetIds: [1, 2, 3] }), [],
  "recipient-directed quotes still reject hearsay");
assert.deepEqual(extract("只对阿乙低声说：“我是巫师。”", { gameData: gameData(whisperCharacters), speakerId: 1,
  audienceIds: [1, 3], candidateTargetIds: [1, 2, 3] }), [],
  "a named whisper recipient absent from the frozen audience receives no disclosure");
const whisperNicknameCharacters = new Map(whisperCharacters);
whisperNicknameCharacters.set(1, { ...whisperCharacters.get(1), nickname: "铁腕" });
const whisperedNickname = extract("只对阿乙低声说：“我的称号是铁腕。”", { gameData: gameData(whisperNicknameCharacters), speakerId: 1,
  audienceIds: [1, 2, 3], candidateTargetIds: [1, 2, 3] });
assert(fact(whisperedNickname, 2, 1, "NICKNAME", "铁腕"), "private nickname fact reaches its explicitly addressed listener");
assert.equal(whisperedNickname.some(row => row.ownerRuntimeId === 3), false,
  "private nickname fact never reaches a different listener");

const enumerationGuard = new Map(characters);
enumerationGuard.values = () => { throw new Error("full character enumeration is forbidden"); };
const scoped = extract("我乃皇帝。", { gameData: gameData(enumerationGuard), candidateTargetIds: [4] });
assert(fact(scoped, 1, 2, "TITLE", "皇帝"), "candidate and speaker lookup uses explicit IDs only");
assert.deepEqual(extract("我乃皇帝。", { gameData: { ...gameData(), characters: [...characters.values()] } }), [],
  "array character registries fail closed instead of scanning all GameData characters");

for (const invalidSource of [source({ messageRevision: "bad" }), source({ campaignToken: "other" }),
  source({ gameDate: "1164.5.21" }), source({ conversationId: "" }), source({ messageId: null })]) {
  assert.deepEqual(extract("我乃皇帝。", { source: invalidSource }), [], "invalid or stale source identity fails closed");
}
assert.deepEqual(extract("我乃皇帝。", { gameData: { ...gameData(), date: "1164.5.21" } }), [],
  "source identity must match the current GameData campaign and date");

const sourceText = fs.readFileSync(path.join(__dirname, "../src/app/main/conversation/character-disclosure-extraction.js"), "utf8");
assert(!/memory4|sidecar|durable|worldline/i.test(sourceText), "the extraction module has no retired storage or Worldline dependency");

console.log("V9.3.9.1 disclosure extraction: PASS (directed facts, assertion gates, source identity, candidate scope and secret knowledge)");

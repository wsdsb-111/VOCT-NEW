"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { id: versionPath, filename: versionPath, loaded: true, exports: { MEMORY_ENGINE_VERSION: "3.0" } };
const { Character } = require("../src/app/main/game-data/character");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { computeAgeAtDate } = require("../src/app/main/worldline/character-temporal-facts");
const { buildFamilyEntityFactBundle } = require("../src/app/main/worldline/family-entity-fact-bundle");
const { getCachedKinshipGraph } = require("../src/app/main/worldline/kinship-graph-cache");

const TokenCounter = { estimateTokens: () => 1, calculateTotalTokens: () => 1 };
const GameData = createGameData({ fs, path, memorySystem: {}, summariesDir: "", getHistoricalReferenceByYear: () => null });
const PromptBuilder = createPromptBuilder({ TemplateEngine: class {}, PromptScriptLoader: class {}, settingsRepository: {
  getPromptSettings: () => ({ blocks: [{ id: "history", type: "history", enabled: true }], suffix: { enabled: false } }),
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: false })
}, path, TokenCounter, createPromptFingerprint: () => "", defaultChatInstruction: "" });

function makeCharacter(id, name, { age = null, gender = "male", birthDate = null, birthDateTotalDays = null, alive = true, deathDate = null } = {}) {
  const raw = Array(28).fill("");
  raw[0] = id;
  raw[1] = name;
  raw[2] = name;
  raw[4] = gender === "female" ? "she" : gender === "male" ? "he" : "";
  raw[5] = age === null ? "" : age;
  const character = new Character(raw);
  character.alive = alive;
  if (birthDate) character.birthDate = birthDate;
  if (birthDateTotalDays !== null) character.birthDateTotalDays = birthDateTotalDays;
  if (deathDate) character.deathDate = deathDate;
  return character;
}

function fixture(date = "1190年5月2日") {
  const responder = makeCharacter(1, "回应者", { age: 40 });
  const gameData = new GameData([99, "玩家", responder.id, responder.fullName, date, "___________talk_scene", "", "", 106575]);
  gameData.date = date;
  gameData.campaignToken = "votc8c-123456789012";
  gameData.characters = new Map([[responder.id, responder]]);
  gameData.getActiveParticipantRelationshipInfo = () => "";
  return { gameData, responder };
}

function makeAgeEvidence(sample, age, { ownerId = sample.responder.id, relationType, source } = {}) {
  return {
    value: age,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    sourceOwnerId: ownerId,
    relationType,
    source,
    campaignToken: sample.gameData.campaignToken,
    sourceSnapshotId: `${sample.gameData.date}/${sample.gameData.totalDays}`
  };
}

function addRelativeAgeEvidence(sample, entry, field, { ownerId = sample.responder.id, relationType, source } = {}) {
  const relation = relationType || ({ parents: "parent", children: "child", siblings: "sibling", spouses: "spouse" })[field];
  const evidenceSource = source || `${ownerId}.${field}`;
  entry.ageSource = "CK3_LIVE_RELATIVE_AGE";
  entry.evidence = {
    ...entry.evidence,
    age: [makeAgeEvidence(sample, Number(entry.age), { ownerId, relationType: relation, source: evidenceSource })]
  };
  return entry;
}

function makeCurrentDirectParentEvidence(sample, childId, parentId = sample.responder.id) {
  return {
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: childId,
    childId,
    parentId,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: sample.gameData.campaignToken,
    sourceSnapshotId: `${sample.gameData.date}/${sample.gameData.totalDays}`
  };
}

function link(relative, sample, field) {
  const relationType = ({ parents: "parent", children: "child", siblings: "sibling", spouses: "spouse" })[field];
  const age = Number.isInteger(relative.age) && relative.age >= 0 ? relative.age : null;
  return {
    id: relative.id,
    name: relative.fullName,
    gender: relative.gender,
    age,
    ageSource: age === null ? null : "CK3_LIVE_RELATIVE_AGE",
    ...(field === "children" ? { directParentEvidence: makeCurrentDirectParentEvidence(sample, relative.id) } : {}),
    evidence: age === null ? undefined : {
      age: [makeAgeEvidence(sample, age, { relationType, source: `${sample.responder.id}.${field}` })]
    },
    birthDate: relative.birthDate || null,
    birthDateTotalDays: relative.birthDateTotalDays ?? null,
    alive: relative.alive,
    deathDate: relative.deathDate || null
  };
}

function addCanonicalRelative(sample, relative, relationshipField = "children") {
  sample.gameData.characters.set(relative.id, relative);
  if (!Array.isArray(sample.responder[relationshipField])) sample.responder[relationshipField] = [];
  sample.responder[relationshipField].push(link(relative, sample, relationshipField));
  return relative;
}

function buildPrompt(sample, query, memory = {}) {
  const context = {
    subjectiveWorldPolicyActive: true,
    activeParticipantIds: [sample.responder.id],
    stableText: "",
    ...memory
  };
  const previousLog = console.log;
  console.log = () => {};
  try {
    return PromptBuilder.buildMessagesWithTokenCount([{ role: "user", content: query }], sample.responder, sample.gameData, "", context);
  } finally {
    console.log = previousLog;
  }
}

function familyFacts(result) {
  return result.blocks.find(entry => entry.block.id === "responder-family-facts")?.content || "";
}

function ageDiagnostic(result) {
  assert(Array.isArray(result.ageDiagnostics), "prompt build must return the privacy-safe age diagnostic list");
  return result.ageDiagnostics[0] || null;
}

function assertAgeDiagnostic(result, { id, source, rawAge, calendarAge, conflict, sourceConflict }) {
  const diagnostic = ageDiagnostic(result);
  assert(diagnostic, "a unique explicit age query records one age decision");
  assert.strictEqual(diagnostic.characterIdHash, crypto.createHash("sha256").update(String(id)).digest("hex"));
  assert.strictEqual(diagnostic.ageSource, source);
  assert.strictEqual(diagnostic.rawAge, rawAge);
  assert.strictEqual(diagnostic.calculatedCalendarAge, calendarAge);
  assert.strictEqual(diagnostic.ageConflict, conflict);
  if (sourceConflict !== undefined) assert.strictEqual(diagnostic.sourceConflict, sourceConflict);
  assert.strictEqual(diagnostic.asOfGameDate, "1190.5.2");
  assert(!JSON.stringify(diagnostic).includes("儿子"), "diagnostics contain no person name or message text");
  assert.strictEqual(Object.hasOwn(diagnostic, "characterId"), false, "diagnostics contain no raw runtime ID field");
  return diagnostic;
}

// A01: the real PromptBuilder receives both conflicting sources and must inject CK3's current integer age.
{
  const sample = fixture();
  const son = makeCharacter(2, "儿子", { age: 17, birthDate: "1172年5月2日", birthDateTotalDays: 100000 });
  son.primaryTitle = "未披露头衔";
  son.personality = "未披露性格";
  son.traits = [{ name: "secret_witch", category: "secret", desc: "未披露特质" }];
  son.secrets = [{ name: "未披露秘密" }];
  addCanonicalRelative(sample, son);
  const result = buildPrompt(sample, "你儿子今年多大了？", { stableText: "旧 Memory：儿子18岁。" });
  assert.match(familyFacts(result), /目标人物：儿子（[^\n]*17岁/);
  assert.doesNotMatch(familyFacts(result), /18岁/);
  assert.match(result.messages.map(message => message.content).join("\n"), /旧 Memory：儿子18岁。/);
  assert.doesNotMatch(result.messages.map(message => message.content).join("\n"), /未披露头衔|未披露性格|未披露特质|未披露秘密/,
    "passing source data for a current-age fact must not bypass trait, title or secret disclosure projection");
  assertAgeDiagnostic(result, { id: 2, source: "CK3_CURRENT_AGE", rawAge: 17, calendarAge: 18, conflict: true, sourceConflict: false });
}

// A02: matching date evidence keeps the current CK3 age without a false conflict.
{
  const sample = fixture();
  addCanonicalRelative(sample, makeCharacter(2, "儿子", { age: 18, birthDate: "1172年5月2日" }));
  const result = buildPrompt(sample, "你儿子现在几岁？");
  assert.match(familyFacts(result), /18岁/);
  assertAgeDiagnostic(result, { id: 2, source: "CK3_CURRENT_AGE", rawAge: 18, calendarAge: 18, conflict: false, sourceConflict: false });
}

// A03: Gregorian age arithmetic remains observable, but is not a CK3 age fact until verified in game.
for (const [date, expected] of [["1190年5月1日", 17], ["1190年5月2日", 18], ["1190年5月3日", 18]]) {
  const sample = fixture(date);
  addCanonicalRelative(sample, makeCharacter(2, "儿子", { birthDate: "1172年5月2日" }));
  const result = buildPrompt(sample, "你儿子今年多大了？");
  assert.doesNotMatch(familyFacts(result), /\d+岁/, date);
  assert.match(familyFacts(result), /当前年龄未知/);
  assert.strictEqual(ageDiagnostic(result).ageSource, "UNKNOWN");
  assert.strictEqual(ageDiagnostic(result).calculatedCalendarAge, expected);
  assert.strictEqual(ageDiagnostic(result).sourceConflict, false);
  assert.strictEqual(ageDiagnostic(result).diagnosticCode, "CALENDAR_AGE_UNVERIFIED");
}

// A04: a trusted age is sufficient without any birth date.
{
  const sample = fixture();
  addCanonicalRelative(sample, makeCharacter(2, "儿子", { age: 7 }));
  const result = buildPrompt(sample, "你儿子几岁了？");
  assert.match(familyFacts(result), /7岁/);
  assertAgeDiagnostic(result, { id: 2, source: "CK3_CURRENT_AGE", rawAge: 7, calendarAge: null, conflict: false, sourceConflict: false });
}

// A05: a complete birth date still cannot establish CK3's calendar rule without live age evidence.
{
  const sample = fixture();
  addCanonicalRelative(sample, makeCharacter(2, "儿子", { birthDate: "1172年5月3日" }));
  const result = buildPrompt(sample, "你儿子今年多大了？");
  assert.doesNotMatch(familyFacts(result), /\d+岁/);
  assert.match(familyFacts(result), /当前年龄未知/);
  assert.strictEqual(ageDiagnostic(result).ageSource, "UNKNOWN");
  assert.strictEqual(ageDiagnostic(result).calculatedCalendarAge, 17);
  assert.strictEqual(ageDiagnostic(result).sourceConflict, false);
  assert.strictEqual(ageDiagnostic(result).diagnosticCode, "CALENDAR_AGE_UNVERIFIED");
}

// A06: ordinal days without a verified calendar mapping cannot become exact years.
{
  const sample = fixture();
  sample.responder.children.push({ id: 2, name: "儿子", gender: "male", birthDateTotalDays: 100000,
    directParentEvidence: makeCurrentDirectParentEvidence(sample, 2) });
  const result = buildPrompt(sample, "你儿子今年多大了？");
  assert.doesNotMatch(familyFacts(result), /\d+岁/);
  assert.match(familyFacts(result), /当前年龄未知/);
  assert.strictEqual(ageDiagnostic(result).ageSource, "UNKNOWN");
  assert.strictEqual(ageDiagnostic(result).calculatedCalendarAge, null);
}

// A07: canonical ages flow consistently; offscreen ages require same-snapshot owner-bound evidence.
{
  const cases = [
    { name: "son", query: "你儿子今年几岁？", field: "children", relative: { id: 2, name: "儿子", age: 17, gender: "male" }, expected: "17岁" },
    { name: "daughter", query: "你女儿今年几岁？", field: "children", relative: { id: 3, name: "女儿", age: 12, gender: "female" }, expected: "12岁" },
    { name: "sibling", query: "你兄弟今年几岁？", field: "siblings", relative: { id: 4, name: "兄弟", age: 35, gender: "male" }, expected: "35岁" },
    { name: "spouse", query: "你妻子今年几岁？", field: "spouses", relative: { id: 5, name: "妻子", age: 31, gender: "female" }, expected: "31岁" }
  ];
  for (const test of cases) {
    const sample = fixture();
    const relative = makeCharacter(test.relative.id, test.relative.name, test.relative);
    addCanonicalRelative(sample, relative, test.field);
    const result = buildPrompt(sample, test.query);
    assert.match(familyFacts(result), new RegExp(test.expected), test.name);
  }
  const offscreen = fixture();
  offscreen.responder.children.push({ id: 76, name: "生日已知的场外儿子", gender: "male", birthDate: "1174年5月2日",
    directParentEvidence: makeCurrentDirectParentEvidence(offscreen, 76) });
  const offscreenDateResult = buildPrompt(offscreen, "你儿子今年几岁？");
  assert.doesNotMatch(familyFacts(offscreenDateResult), /\d+岁/);
  assert.strictEqual(ageDiagnostic(offscreenDateResult).ageSource, "UNKNOWN");
  assert.strictEqual(ageDiagnostic(offscreenDateResult).calculatedCalendarAge, 16);
  assert.strictEqual(ageDiagnostic(offscreenDateResult).sourceConflict, false);
  assert.strictEqual(ageDiagnostic(offscreenDateResult).diagnosticCode, "CALENDAR_AGE_UNVERIFIED");
  offscreen.responder.children = [];
  offscreen.responder.children.push({
    ...addRelativeAgeEvidence(offscreen, { id: 77, name: "场外儿子", gender: "male", age: 16 }, "children"),
    directParentEvidence: makeCurrentDirectParentEvidence(offscreen, 77)
  });
  const offscreenResult = buildPrompt(offscreen, "你儿子今年几岁？");
  assert.match(familyFacts(offscreenResult), /16岁/);
  assert.strictEqual(ageDiagnostic(offscreenResult).ageSource, "CK3_LIVE_RELATIVE_AGE");
  const offscreenSpouse = fixture();
  offscreenSpouse.responder.spouses = [addRelativeAgeEvidence(offscreenSpouse, { id: 88, name: "场外妻子", gender: "female", age: 22, alive: true }, "spouses", { source: "spouse.spouses" })];
  const offscreenSpouseResult = buildPrompt(offscreenSpouse, "你妻子今年几岁？");
  assert.match(familyFacts(offscreenSpouseResult), /22岁/);
  assert.strictEqual(ageDiagnostic(offscreenSpouseResult).ageSource, "CK3_LIVE_RELATIVE_AGE");
  const unrelated = fixture();
  unrelated.responder.children.push({ id: 77, name: "场外儿子", gender: "male",
    directParentEvidence: makeCurrentDirectParentEvidence(unrelated, 77) });
  const otherOwner = makeCharacter(8, "另一位亲属", { age: 45 });
  otherOwner.children.push(addRelativeAgeEvidence(unrelated, { id: 77, name: "场外儿子", age: 16 }, "children", { ownerId: otherOwner.id }));
  unrelated.gameData.characters.set(otherOwner.id, otherOwner);
  const unrelatedResult = buildPrompt(unrelated, "你儿子今年几岁？");
  assert.doesNotMatch(familyFacts(unrelatedResult), /16岁/);
  assert.strictEqual(ageDiagnostic(unrelatedResult).ageSource, "UNKNOWN", "relative age evidence owned by someone outside the resolved kinship path is not used");
}

// A08: two sons cannot yield one person's private age by selection or recency.
{
  const sample = fixture();
  addCanonicalRelative(sample, makeCharacter(2, "甲", { age: 17 }));
  addCanonicalRelative(sample, makeCharacter(3, "乙", { age: 18 }));
  const result = buildPrompt(sample, "你儿子多大了？");
  assert.match(familyFacts(result), /多个候选/);
  assert.doesNotMatch(familyFacts(result), /17岁|18岁|甲|乙/);
  assert.strictEqual(result.ageDiagnostics.length, 0);
}

// A09: an unverified birth/death calendar estimate cannot be stated as age at death.
{
  const sample = fixture();
  const son = makeCharacter(2, "儿子", { birthDate: "1160年4月1日", alive: false, deathDate: "1185年3月31日" });
  addCanonicalRelative(sample, son);
  const first = buildPrompt(sample, "你儿子今年多大了？");
  assert.doesNotMatch(familyFacts(first), /终年\s*\d+\s*岁/);
  assert.match(familyFacts(first), /去世年龄未知/);
  assert.strictEqual(ageDiagnostic(first).ageSource, "AGE_AT_DEATH_UNAVAILABLE");
  assert.strictEqual(ageDiagnostic(first).calculatedCalendarAge, 24);
  assert.strictEqual(ageDiagnostic(first).sourceConflict, false);
  sample.gameData.date = "1195年5月2日";
  sample.responder.children[0].directParentEvidence = makeCurrentDirectParentEvidence(sample, 2);
  const later = buildPrompt(sample, "你儿子今年多大了？");
  assert.doesNotMatch(familyFacts(later), /终年\s*\d+\s*岁/);
  assert.match(familyFacts(later), /去世年龄未知/);
  assert.doesNotMatch(familyFacts(later), /终年25岁/);
}

// A10: preserve pure Gregorian arithmetic tests; corresponding CK3 leap-day semantics remain unverified.
assert.strictEqual(computeAgeAtDate("1160年2月29日", "1180年2月28日"), 19);
assert.strictEqual(computeAgeAtDate("1160年2月29日", "1180年2月29日"), 20);
assert.strictEqual(computeAgeAtDate("1160年2月29日", "1180年3月1日"), 20);

// A11: changing the raw current age invalidates the family graph's demographic fingerprint.
{
  const sample = fixture();
  const son = makeCharacter(2, "儿子", { age: 17 });
  addCanonicalRelative(sample, son);
  assert.match(familyFacts(buildPrompt(sample, "你儿子今年几岁？")), /17岁/);
  son.age = 18;
  assert.match(familyFacts(buildPrompt(sample, "你儿子今年几岁？")), /18岁/);
}

// A12: the current CK3 age is present in the final family block and explicitly outranks conflicting Memory.
{
  const sample = fixture();
  addCanonicalRelative(sample, makeCharacter(2, "儿子", { age: 17, birthDate: "1172年5月2日" }));
  const result = buildPrompt(sample, "你儿子今年多大了？", { stableText: "Memory 记录：儿子18岁。" });
  assert.match(familyFacts(result), /17岁/);
  assert.match(familyFacts(result), /Memory.*不得覆盖这些事实/);
  assert.match(result.messages.map(message => message.content).join("\n"), /Memory 记录：儿子18岁。/);
}

// A13: the resolver-to-bundle path preserves source, raw value, calendar diagnostic and conflict.
{
  const sample = fixture();
  const son = makeCharacter(2, "儿子", { age: 17, birthDate: "1172年5月2日" });
  addCanonicalRelative(sample, son);
  sample.responder.children[0].age = 19;
  addRelativeAgeEvidence(sample, sample.responder.children[0], "children");
  const conflictDiagnostic = buildPrompt(sample, "你儿子今年多大了？");
  assertAgeDiagnostic(conflictDiagnostic, { id: 2, source: "CK3_CURRENT_AGE", rawAge: 17, calendarAge: 18, conflict: true, sourceConflict: true });
  const previousLog = console.log;
  console.log = () => {};
  let profile;
  let bundle;
  try {
    profile = sample.gameData.getMentionableCharacterProfiles().get(2);
    const graph = getCachedKinshipGraph(sample.gameData);
    bundle = buildFamilyEntityFactBundle({ graph, responderId: 1, relationAnchorId: 1, targetRuntimeId: 2, relationTypes: ["CHILD_OF"], temporal: { currentGameDate: sample.gameData.date } });
  } finally {
    console.log = previousLog;
  }
  assert.strictEqual(profile.age, 17);
  assert.strictEqual(profile.ageSource, "CK3_CURRENT_AGE");
  assert.strictEqual(profile.ageEvidenceConflict, true);
  assert.strictEqual(bundle.age, 17);
  assert.strictEqual(bundle.ageSource, "CK3_CURRENT_AGE");
  assert.strictEqual(bundle.rawAge, 17);
  assert.strictEqual(bundle.calculatedCalendarAge, 18);
  assert.strictEqual(bundle.ageConflict, true);

  const conflict = fixture();
  conflict.responder.children.push(
    { ...addRelativeAgeEvidence(conflict, { id: 77, name: "场外儿子", gender: "male", age: 16 }, "children"),
      directParentEvidence: makeCurrentDirectParentEvidence(conflict, 77) },
    { ...addRelativeAgeEvidence(conflict, { id: 77, name: "场外儿子", gender: "male", age: 17 }, "children"),
      directParentEvidence: makeCurrentDirectParentEvidence(conflict, 77) }
  );
  const conflictResult = buildPrompt(conflict, "你儿子今年几岁？");
  assert.match(familyFacts(conflictResult), /年龄来源冲突，当前年龄未知/);
  assert.doesNotMatch(familyFacts(conflictResult), /16岁|17岁/);
  assert.strictEqual(ageDiagnostic(conflictResult).ageSource, "AGE_SOURCE_CONFLICT");
  assert.strictEqual(ageDiagnostic(conflictResult).ageConflict, true);
  assert.strictEqual(ageDiagnostic(conflictResult).sourceConflict, true);
}

// A14: partial relative data and unbound age markers cannot invent an age or confirm an ID-less relation.
{
  const sample = fixture();
  sample.responder.children.push({ id: 77, name: "残缺儿子", gender: "male", birthDateTotalDays: 100000,
    directParentEvidence: makeCurrentDirectParentEvidence(sample, 77) });
  const result = buildPrompt(sample, "你儿子今年多大了？");
  assert.doesNotMatch(familyFacts(result), /\d+岁/);
  assert.match(familyFacts(result), /当前年龄未知/);
  assert.strictEqual(ageDiagnostic(result).ageSource, "UNKNOWN");
  const noId = fixture();
  noId.responder.children.push({ name: "未绑定儿子", age: 17, ageSource: "CK3_LIVE_RELATIVE_AGE" });
  const unresolved = buildPrompt(noId, "你儿子今年多大了？");
  assert.match(familyFacts(unresolved), /未完成解析/);
  assert.doesNotMatch(familyFacts(unresolved), /17岁|未绑定儿子/);
  assert.strictEqual(unresolved.ageDiagnostics.length, 0);
  const unmarked = fixture();
  assert.strictEqual(require("../src/app/main/worldline/character-age-service").resolveCharacterAge({ age: 17, ageSource: "CK3_LIVE_RELATIVE_AGE" }).age, null,
    "a relative-age marker without source-owner evidence is not trusted");
}

// Public close-family ages remain current facts outside the narrow age-query diagnostic path.
{
  const sample = fixture();
  addCanonicalRelative(sample, makeCharacter(2, "儿子", { age: 17, birthDate: "1172年5月2日" }));
  const ordinary = buildPrompt(sample, "你儿子最近怎么样？");
  assert.match(familyFacts(ordinary), /17岁/);
  assert.strictEqual(ordinary.ageDiagnostics.length, 0);
  const historical = buildPrompt(sample, "你儿子去年几岁？");
  assert.match(familyFacts(historical), /当前结构化家庭事实[\s\S]*17岁/);
  assert.doesNotMatch(familyFacts(historical), /16岁|18岁/, "a historical query does not replace the current raw age with a guessed past or calendar age");
  assert.strictEqual(historical.ageDiagnostics.length, 0);
}

console.log("V9.3.6.3 AGE-01: PASS (A01-A14 Prompt authority, ambiguity, disclosure, provenance and temporal boundary fixtures; Gregorian calendar behavior only)");

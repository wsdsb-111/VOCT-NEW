"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = {
  id: versionPath,
  filename: versionPath,
  loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" }
};

const { Character } = require("../src/app/main/game-data/character");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { resolveCharacterAge } = require("../src/app/main/worldline/character-age-service");
const { computeAgeAtDate } = require("../src/app/main/worldline/character-temporal-facts");

const PLAYER_ID = 81001;
const RESPONDER_ID = 81002;
const CHILD_ID = 81003;
const CAMPAIGN = "votc8c-123456789012";
const BASE_DATE = "1104年8月3日";
const BASE_TOTAL_DAYS = 403175;
const BIRTH_DATE = "1093年9月1日";
const BIRTH_TOTAL_DAYS = 399000;
const CHILD_NAME = "Child";

const GameData = createGameData({
  fs,
  path,
  memorySystem: {},
  memoryEngine: {},
  summariesDir: "",
  getHistoricalReferenceByYear: () => null
});

const TokenCounter = {
  estimateTokens: value => Math.ceil(String(value ?? "").length / 4),
  estimateMessageTokens: message => Math.ceil(String(message?.content ?? "").length / 4),
  calculateTotalTokens: messages => (messages || []).reduce((total, message) => total + Math.ceil(String(message?.content ?? "").length / 4), 0)
};

const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V9.3.9.3 synthetic age prompt",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true }
    ],
    suffix: { enabled: false }
  }),
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: false }),
  getChatPromptV813Layout: () => true
};

const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(value) {
      return String(value ?? "");
    }
  },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "", resolvePath: value => value },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => crypto.createHash("sha256").update(String(value ?? "")).digest("hex"),
  defaultChatInstruction: ""
});

function characterRow(id, name, pronoun, age) {
  const row = Array(28).fill("");
  row[0] = String(id);
  row[1] = name;
  row[2] = name;
  row[4] = pronoun;
  row[5] = String(age);
  row[6] = "0";
  row[7] = "0";
  row[8] = "unknown";
  row[9] = "synthetic";
  row[10] = "0";
  return row;
}

function logLine(type, fields) {
  return `VOTC:IN/;/${type}/;/${fields.join("/;/")}/;/`;
}

function makeFixture({ date = BASE_DATE, totalDays = BASE_TOTAL_DAYS, age = "9", status, duplicateAge = null,
  birthDate = BIRTH_DATE, birthTotalDays = BIRTH_TOTAL_DAYS } = {}) {
  const init = logLine("init", [PLAYER_ID, "Fixture Player", RESPONDER_ID, "Fixture Responder", date,
    "___________talk_scene", "Fixture Location", "Fixture Controller", totalDays]);
  const player = logLine("character", characterRow(PLAYER_ID, "Fixture Player", "he", 30));
  const responder = logLine("character", characterRow(RESPONDER_ID, "Fixture Responder", "she", 38));
  const childFields = [RESPONDER_ID, CHILD_ID, CHILD_NAME, "he", birthTotalDays, birthDate, age];
  if (status !== undefined) childFields.push(status);
  const child = logLine("kids", childFields);
  const duplicate = duplicateAge === null ? "" : logLine("kids", [
    RESPONDER_ID, CHILD_ID, CHILD_NAME, "he", birthTotalDays, birthDate, duplicateAge, status ?? "PUBLIC_LEGAL_PARENT"
  ]);
  return `${init}\nVOTC:CAMPAIGN/${CAMPAIGN}\n${player}\n${responder}\n${child}\n${duplicate}`;
}

async function parseFixture(text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v9393-age-fixture-"));
  const file = path.join(directory, "synthetic-debug.log");
  fs.writeFileSync(file, text, "utf8");
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return await createLogParser({ GameData, Character })(file);
  } finally {
    Object.assign(console, original);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function buildPrompt(gameData, query) {
  const responder = gameData.characters.get(RESPONDER_ID);
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return PromptBuilder.buildMessagesWithTokenCount([{ role: "user", content: query }], responder, gameData, "", {
      activeParticipantIds: [PLAYER_ID, RESPONDER_ID],
      subjectiveWorldPolicyActive: true,
      cacheV2FrozenSnapshots: { responders: new Map(), prefixByResponder: new Map() }
    });
  } finally {
    Object.assign(console, original);
  }
}

function block(prompt, id) {
  return prompt.blocks.find(entry => entry.block?.id === id)?.content || "";
}

function allPromptText(prompt) {
  return prompt.messages.map(message => String(message.content ?? "")).join("\n");
}

function withoutConsole(callback) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return callback();
  } finally {
    Object.assign(console, original);
  }
}

function assertNoGuessedAge(prompt, label) {
  const text = allPromptText(prompt);
  assert(!text.includes(`${CHILD_NAME}（Runtime ID：${CHILD_ID}`), `${label}: an untrusted relative is not selected`);
  assert(!text.includes("9岁") && !text.includes("10岁"), `${label}: neither raw nor calendar-estimated age may leak`);
  assert.equal(prompt.ageDiagnostics.length, 0, `${label}: no age selection diagnostic is produced for an unresolved relation`);
}

async function run() {
  // The calendar calculation is diagnostic only; CK3's raw age must remain authoritative.
  assert.equal(computeAgeAtDate("1172年5月2日", "1190年5月1日"), 17, "one day before birthday");
  assert.equal(computeAgeAtDate("1172年5月2日", "1190年5月2日"), 18, "on birthday");
  assert.equal(computeAgeAtDate("1172年5月2日", "1190年5月3日"), 18, "after birthday");
  assert.equal(computeAgeAtDate("1172年12月31日", "1190年1月1日"), 17, "new calendar year before birthday");
  assert.equal(computeAgeAtDate("1172年2月29日", "1192年2月28日"), 19, "leap-year eve");
  assert.equal(computeAgeAtDate("1172年2月29日", "1192年2月29日"), 20, "leap birthday");
  assert.equal(computeAgeAtDate("1172年2月29日", "1193年3月1日"), 21, "post-leap-year birthday boundary");
  assert.equal(computeAgeAtDate("bad date", BASE_DATE), null, "invalid birth date stays unknown");
  assert.equal(computeAgeAtDate(BIRTH_DATE, ""), null, "missing game date stays unknown");

  const missingMarker = await parseFixture(makeFixture());
  const unmarkedProfile = withoutConsole(() => missingMarker.getMentionableCharacterProfiles().get(CHILD_ID));
  assert.equal(unmarkedProfile.age, 9, "the parser retains the raw relative GetAge in its mentionable profile");
  assert.equal(unmarkedProfile.ageSource, "CK3_LIVE_RELATIVE_AGE");
  const missingMarkerPrompt = buildPrompt(missingMarker, "你儿子今年多少岁了？");
  assertNoGuessedAge(missingMarkerPrompt, "missing exporter marker");

  const unknownMarker = await parseFixture(makeFixture({ status: "UNKNOWN" }));
  assertNoGuessedAge(buildPrompt(unknownMarker, "你儿子今年多少岁了？"), "UNKNOWN exporter marker");

  const legalMarker = await parseFixture(makeFixture({ status: "PUBLIC_LEGAL_PARENT" }));
  const legalProfile = withoutConsole(() => legalMarker.getMentionableCharacterProfiles().get(CHILD_ID));
  assert.equal(legalProfile.age, 9, "the legal parent row retains the raw CK3 relative GetAge");
  const projectedAge = withoutConsole(() => createTraitProfileView(legalMarker, legalMarker.characters.get(RESPONDER_ID))
    .gameData.getMentionableCharacterProfiles().get(CHILD_ID).age);
  assert.equal(projectedAge, 9,
    "a publicly verified parent retains the off-scene child's raw age in the projected view");
  const agePrompt = buildPrompt(legalMarker, "你儿子今年多少岁了？");
  const familyFacts = block(agePrompt, "responder-family-facts");
  assert(familyFacts.includes(CHILD_NAME), `the explicitly queried, publicly verified child resolves through FamilyFact: ${familyFacts}`);
  assert.match(familyFacts, /9岁/u, "FamilyFact uses the raw GetAge value");
  assert.doesNotMatch(familyFacts, /10岁/u, "the calendar estimate does not replace CK3 GetAge");
  assert(!block(agePrompt, "responder-game-facts").includes(CHILD_NAME),
    "the targeted family fact is not duplicated as a general current-truth fact");
  assert.equal(agePrompt.ageDiagnostics.length, 1);
  assert.equal(agePrompt.ageDiagnostics[0].ageSource, "CK3_LIVE_RELATIVE_AGE");
  assert.equal(agePrompt.ageDiagnostics[0].rawAge, 9);
  assert.equal(agePrompt.ageDiagnostics[0].calculatedCalendarAge, 10);
  assert.equal(agePrompt.ageDiagnostics[0].selectedAge, 9);
  assert.equal(agePrompt.ageDiagnostics[0].promptAge, 9);
  assert.equal(agePrompt.ageDiagnostics[0].diagnosticCode, "CALENDAR_AGE_UNVERIFIED");

  const noAgeQuery = buildPrompt(legalMarker, "请介绍一下你自己。");
  assert(!allPromptText(noAgeQuery).includes("10岁"),
    "a non-age query must not turn a public relative's raw age into a calendar estimate");

  const invalidAge = await parseFixture(makeFixture({ age: "not-an-integer", status: "PUBLIC_LEGAL_PARENT" }));
  const invalidAgePrompt = buildPrompt(invalidAge, "你儿子今年多少岁了？");
  assert(!block(invalidAgePrompt, "responder-family-facts").includes("10岁"), "invalid GetAge does not fall back to a guessed calendar age");
  assert(invalidAgePrompt.ageDiagnostics.some(item => item.selectedAge === null), "invalid relative age remains unknown in diagnostics");

  const missingAge = await parseFixture(makeFixture({ age: "", status: "PUBLIC_LEGAL_PARENT" }));
  const missingAgePrompt = buildPrompt(missingAge, "你儿子今年多少岁了？");
  assert(!block(missingAgePrompt, "responder-family-facts").includes("10岁"), "missing GetAge does not fall back to a guessed calendar age");
  assert(missingAgePrompt.ageDiagnostics.some(item => item.selectedAge === null), "missing relative age remains unknown in diagnostics");

  const conflictingAge = await parseFixture(makeFixture({ status: "PUBLIC_LEGAL_PARENT", duplicateAge: "8" }));
  const conflictPrompt = buildPrompt(conflictingAge, "你儿子今年多少岁了？");
  assert(!block(conflictPrompt, "responder-family-facts").includes("8岁"), "conflicting raw ages fail closed");
  assert(!block(conflictPrompt, "responder-family-facts").includes("9岁"), "conflicting raw ages do not select one value");
  assert(!block(conflictPrompt, "responder-family-facts").includes("10岁"), "conflicting raw ages do not fall back to the calendar estimate");
  assert(conflictPrompt.ageDiagnostics.some(item => item.ageSource === "AGE_SOURCE_CONFLICT" && item.selectedAge === null),
    "conflicting GetAge rows are recorded as an unknown source, not one chosen age");

  const beforeBirthday = await parseFixture(makeFixture({ date: "1104年8月31日", totalDays: BASE_TOTAL_DAYS + 28,
    age: "8", status: "PUBLIC_LEGAL_PARENT", birthDate: "1095年9月1日", birthTotalDays: 399917 }));
  const onBirthday = await parseFixture(makeFixture({ date: "1104年9月1日", totalDays: BASE_TOTAL_DAYS + 29,
    age: "9", status: "PUBLIC_LEGAL_PARENT", birthDate: "1095年9月1日", birthTotalDays: 399917 }));
  assert.match(block(buildPrompt(beforeBirthday, "你儿子今年多少岁了？"), "responder-family-facts"), /8岁/u);
  assert.match(block(buildPrompt(onBirthday, "你儿子今年多少岁了？"), "responder-family-facts"), /9岁/u,
    "a refreshed game date uses the newly exported relative GetAge");
  const staleRelative = beforeBirthday.getMentionableCharacterProfiles().get(CHILD_ID);
  assert.equal(resolveCharacterAge(staleRelative, {
    currentGameDate: onBirthday.date,
    currentTotalDays: onBirthday.totalDays,
    currentCampaignToken: onBirthday.campaignToken
  }).age, null, "a previous-date relative age cannot be reused against a refreshed snapshot");

  process.stdout.write("V9.3.9.3 age family prompt: PASS (parser-to-Prompt raw GetAge, masked-view boundary, fail-closed marker/invalid/conflict cases, birthday/date refresh, calendar diagnostics)\n");
}

run().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

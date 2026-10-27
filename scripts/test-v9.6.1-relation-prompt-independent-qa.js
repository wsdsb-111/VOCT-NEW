"use strict";

const assert = require("node:assert/strict");
const util = require("node:util");
const {
  makeFamilyFixtureLines,
  loadRuntime,
  parseFixture,
  makeMemoryContext,
  line,
  characterLine,
  FIXTURE_DATE,
  FIXTURE_TOTAL_DAYS,
  FIXTURE_CAMPAIGN
} = require("./test-v9.3.7-family-performance");
const { makeStepFamilyLines } = require("./test-v9.3.7-step-family-independent-qa");

const ROOT = require("node:path").resolve(__dirname, "..");
const RESPONDER_ID = 10;
const PLAYER_ID = 1;
const DAUGHTER_ID = 70;
const BETROTHED_ID = 80;
const FORMER_SPOUSE_ID = 90;
const BETROTHED_NAME = "V961_OFFSCENE_BETROTHED_NAME";
const FORMER_SPOUSE_NAME = "V961_FORMER_SPOUSE_NAME";
const PRIVATE_TITLE = "V961_NONFAMILY_PRIVATE_TITLE";
const PRIVATE_TRAIT = "V961_NONFAMILY_PRIVATE_TRAIT";
const PRIVATE_TRAIT_DESC = "V961_NONFAMILY_PRIVATE_TRAIT_DESC";

function capturePrompt(runtime, gameData, query, memoryContext = makeMemoryContext(), historyName = null) {
  const responder = gameData.characters.get(RESPONDER_ID);
  assert.ok(responder, "fixture responder must be present in parsed GameData");
  const captured = [];
  const originals = Object.fromEntries(["log", "warn", "error"].map(key => [key, console[key]]));
  for (const key of Object.keys(originals)) {
    console[key] = (...args) => captured.push(args.map(value => typeof value === "string"
      ? value
      : util.inspect(value, { depth: 5, maxArrayLength: 100, breakLength: 120 })).join(" "));
  }
  let result;
  try {
    result = runtime.PromptBuilder.buildMessagesWithTokenCount(
      [{ role: "user", ...(historyName ? { name: historyName } : {}), content: query }], responder, gameData, null, memoryContext
    );
  } finally {
    for (const key of Object.keys(originals)) console[key] = originals[key];
  }
  const familyBlock = result.blocks.find(entry => entry?.block?.id === "responder-family-facts");
  return {
    result,
    text: result.messages.map(message => message.content).join("\n"),
    familyText: familyBlock?.content || "",
    diagnostics: captured.join("\n")
  };
}

function currentProfileMarkers(target, age) {
  target.age = age;
  target.ageSource = "CK3_CURRENT_AGE";
  target.primaryTitle = PRIVATE_TITLE;
  target.titleRankConcept = `${PRIVATE_TITLE}_RANK`;
  target.heldCourtAndCouncilPositions = `${PRIVATE_TITLE}_OFFICE`;
  target.traits = [{ traitId: "v961_private_trait", name: PRIVATE_TRAIT, desc: PRIVATE_TRAIT_DESC }];
}

function assertNoUnauthorizedProfileMarkers(rendered, age, label) {
  assert.ok(!rendered.text.includes(PRIVATE_TITLE), `${label} must not expose a nonfamily title in Prompt content`);
  assert.ok(!rendered.text.includes(PRIVATE_TRAIT), `${label} must not expose a nonfamily trait in Prompt content`);
  assert.ok(!rendered.text.includes(PRIVATE_TRAIT_DESC), `${label} must not expose a nonfamily trait description`);
  assert.ok(!rendered.text.includes(`${age}岁`), `${label} must not expose a nonfamily age in Prompt content`);
}

function manualHiddenNameFact(targetId, value) {
  return {
    campaignToken: FIXTURE_CAMPAIGN,
    ownerId: RESPONDER_ID,
    entityId: targetId,
    factType: "NAME",
    factKey: "name",
    value,
    current: true,
    effectiveKnown: false,
    status: "MANUAL_HIDDEN",
    firstAcquiredDate: FIXTURE_DATE
  };
}

function makeOffsceneBetrothalLines({ includeCanonicalTarget = false } = {}) {
  const lines = makeFamilyFixtureLines({ siblingCount: 0 });
  if (includeCanonicalTarget) lines.push(characterLine({ id: BETROTHED_ID, name: BETROTHED_NAME, gender: "male", age: 71 }));
  lines.push(line("kids", RESPONDER_ID, [DAUGHTER_ID, "V961_OFFSCENE_DAUGHTER", "she", 10000, "1163年5月2日", 17, "PUBLIC_LEGAL_PARENT"]));
  lines.push(line("kid_betrothed", RESPONDER_ID, [DAUGHTER_ID, BETROTHED_ID, BETROTHED_NAME, "he"]));
  lines.push(line("kid_eob", RESPONDER_ID, [DAUGHTER_ID, ""]));
  return lines;
}

function addNonfamilyFormerSpouse(lines) {
  lines.push(characterLine({ id: FORMER_SPOUSE_ID, name: FORMER_SPOUSE_NAME, gender: "female", age: 83 }));
  lines.push(line("former_spouse", RESPONDER_ID, [FORMER_SPOUSE_ID, FORMER_SPOUSE_NAME, "she"]));
  return lines;
}

function makeFirstMeetingLines() {
  return [
    line("init", PLAYER_ID, ["V961_FIRST_MEETING_PLAYER", RESPONDER_ID, "V961_FIRST_MEETING_RESPONDER", FIXTURE_DATE,
      "V961_FIRST_MEETING_PLAYER entered V961_FIRST_MEETING_SCENE", "长安", "长安", FIXTURE_TOTAL_DAYS]),
    `VOTC:CAMPAIGN/${FIXTURE_CAMPAIGN}`,
    characterLine({ id: PLAYER_ID, name: "V961_FIRST_MEETING_PLAYER", gender: "female", age: 34 }),
    characterLine({ id: RESPONDER_ID, name: "V961_FIRST_MEETING_RESPONDER", gender: "male", age: 40 })
  ];
}

async function main() {
  const runtime = loadRuntime(ROOT);

  const offsceneData = await parseFixture(runtime, makeOffsceneBetrothalLines());
  const offsceneDaughter = offsceneData.characters.get(RESPONDER_ID).children.find(child => Number(child.id) === DAUGHTER_ID);
  assert.ok(offsceneDaughter, "the parser must attach the queried daughter to the responder's current record");
  assert.equal(offsceneData.characters.has(DAUGHTER_ID), false, "the daughter remains outside the canonical character directory");
  assert.equal(offsceneData.characters.has(BETROTHED_ID), false, "the betrothed remains off-scene and unbound");
  assert.equal(offsceneDaughter.betrothed?.source, "CK3_CURRENT_BETROTHAL");
  assert.equal(offsceneDaughter.betrothed?.sourceOwnerId, RESPONDER_ID);
  assert.equal(offsceneDaughter.betrothed?.sourceRelation, "kids.betrothed");
  assert.equal(offsceneDaughter.betrothed?.targetBound, false);
  assert.equal(offsceneDaughter.betrothed?.campaignToken, FIXTURE_CAMPAIGN);
  assert.equal(offsceneDaughter.betrothed?.sourceSnapshotId, `${FIXTURE_DATE}/${FIXTURE_TOTAL_DAYS}`);
  const offsceneContext = makeMemoryContext();
  assert.equal(offsceneContext.disclosureProfiles, undefined, "the positive off-scene relation test has no injected knownNAME facts");
  const offsceneBetrothal = capturePrompt(runtime, offsceneData, "你女儿的未婚夫是谁？", offsceneContext);
  assert.match(offsceneBetrothal.familyText, /未婚夫/u, "a source-bound child-to-betrothal chain resolves the queried relation");
  assert.match(offsceneBetrothal.familyText, new RegExp(BETROTHED_NAME), "the public betrothal source supplies its off-scene target label");

  const boundBetrothalData = await parseFixture(runtime, makeOffsceneBetrothalLines({ includeCanonicalTarget: true }));
  const betrothedProfile = boundBetrothalData.characters.get(BETROTHED_ID);
  currentProfileMarkers(betrothedProfile, 71);
  const betrothalPrompt = capturePrompt(runtime, boundBetrothalData, "你女儿的未婚夫是谁？");
  assert.match(betrothalPrompt.familyText, new RegExp(BETROTHED_NAME), "the relation-specific fact may identify the proven betrothed");
  assertNoUnauthorizedProfileMarkers(betrothalPrompt, 71, "nonfamily betrothed");

  const formerLines = addNonfamilyFormerSpouse(makeFamilyFixtureLines({ siblingCount: 0 }));
  const formerData = await parseFixture(runtime, formerLines);
  const formerRecord = formerData.characters.get(RESPONDER_ID).formerSpouses.find(record => Number(record.id) === FORMER_SPOUSE_ID);
  assert.ok(formerRecord, "the fresh parser must retain the former-spouse record");
  assert.equal(formerRecord.source, "CK3_FORMER_SPOUSE");
  assert.equal(formerRecord.sourceOwnerId, RESPONDER_ID);
  assert.equal(formerRecord.sourceRelation, "formerSpouses");
  assert.equal(formerRecord.publicStatus, "FORMER_SPOUSE");
  assert.equal(formerRecord.historicalStatus, "FORMER");
  assert.equal(formerRecord.targetBound, true);
  assert.equal(formerRecord.campaignToken, FIXTURE_CAMPAIGN);
  assert.equal(formerRecord.sourceSnapshotId, `${FIXTURE_DATE}/${FIXTURE_TOTAL_DAYS}`);
  const formerProfile = formerData.characters.get(FORMER_SPOUSE_ID);
  currentProfileMarkers(formerProfile, 83);
  const formerPrompt = capturePrompt(runtime, formerData, "你前妻是谁？");
  assert.match(formerPrompt.familyText, /前妻/u, "the parsed former-spouse proof resolves the requested relation");
  assert.match(formerPrompt.familyText, new RegExp(FORMER_SPOUSE_NAME), "the relation-specific fact may identify its proven former spouse");
  assertNoUnauthorizedProfileMarkers(formerPrompt, 83, "nonfamily former spouse");

  const stepData = await parseFixture(runtime, makeStepFamilyLines({
    marriages: [{ parentId: 2, spouseId: 50, name: "沈承安", gender: "male" }]
  }));
  const stepContext = makeMemoryContext();
  assert.equal(stepContext.disclosureProfiles, undefined, "the positive step-family test has no injected knownNAME facts");
  const stepPrompt = capturePrompt(runtime, stepData, "你继父是谁？", stepContext);
  assert.match(stepPrompt.familyText, /当前继父：沈承安/u, "the current public step-parent proof identifies the stepfather without knownNAME injection");
  assert.match(stepPrompt.text, /沈承安/u, "the default Prompt includes the minimal relation answer");

  const hiddenContext = makeMemoryContext();
  hiddenContext.disclosureProfiles = new Map([[50, [manualHiddenNameFact(50, "沈承安")]]]);
  const hiddenStepPrompt = capturePrompt(runtime, stepData, "你继父是谁？", hiddenContext);
  assert.match(hiddenStepPrompt.familyText, /当前继父/u, "manual-hidden identity does not erase the proven relation category");
  assert.doesNotMatch(hiddenStepPrompt.text, /沈承安/u, "manual-hidden names never enter the final default Prompt");
  assert.doesNotMatch(hiddenStepPrompt.diagnostics, /沈承安/u, "manual-hidden names never enter console diagnostics");

  const firstMeetingData = await parseFixture(runtime, makeFirstMeetingLines());
  const firstMeetingPlayer = firstMeetingData.characters.get(PLAYER_ID);
  firstMeetingPlayer.name = "V961_FIRST_MEETING_PLAYER";
  firstMeetingPlayer.firstName = "V961_FIRST_MEETING_PLAYER";
  firstMeetingPlayer.shortName = "V961_FIRST_MEETING_PLAYER";
  firstMeetingPlayer.fullName = "V961_FIRST_MEETING_PLAYER";
  firstMeetingPlayer.primaryTitle = "V961_FIRST_MEETING_PRIVATE_TITLE";
  firstMeetingPlayer.titleRankConcept = "V961_FIRST_MEETING_PRIVATE_RANK";
  firstMeetingPlayer.heldCourtAndCouncilPositions = "V961_FIRST_MEETING_PRIVATE_OFFICE";
  firstMeetingPlayer.house = "V961_FIRST_MEETING_PRIVATE_HOUSE";
  firstMeetingPlayer.traits = [{ traitId: "v961_first_meeting_trait", name: "V961_FIRST_MEETING_PRIVATE_TRAIT", desc: "V961_FIRST_MEETING_PRIVATE_TRAIT_DESC" }];
  firstMeetingData.playerName = firstMeetingPlayer.fullName;
  firstMeetingData.scene = "V961_FIRST_MEETING_PLAYER entered V961_FIRST_MEETING_SCENE";
  const firstMeetingContext = makeMemoryContext();
  assert.equal(firstMeetingContext.disclosureProfiles, undefined, "first-meeting masking is checked without injected knownNAME facts");
  const firstMeeting = capturePrompt(runtime, firstMeetingData, "阁下好。", firstMeetingContext, firstMeetingPlayer.fullName);
  for (const marker of ["V961_FIRST_MEETING_PLAYER", "V961_FIRST_MEETING_PRIVATE_TITLE", "V961_FIRST_MEETING_PRIVATE_RANK",
    "V961_FIRST_MEETING_PRIVATE_OFFICE", "V961_FIRST_MEETING_PRIVATE_HOUSE", "V961_FIRST_MEETING_PRIVATE_TRAIT",
    "V961_FIRST_MEETING_PRIVATE_TRAIT_DESC"]) {
    assert.ok(!firstMeeting.text.includes(marker), `first-meeting Prompt masks ${marker}`);
  }
  assert.match(firstMeeting.text, /阁下好。/u, "first-meeting masking preserves the spoken user text");
  assert.match(firstMeeting.text, /V961_FIRST_MEETING_SCENE/u, "ordinary scene text carries no hidden identity and remains visible");

  process.stdout.write(JSON.stringify({
    status: "PASS",
    campaignToken: FIXTURE_CAMPAIGN,
    snapshot: `${FIXTURE_DATE}/${FIXTURE_TOTAL_DAYS}`,
    assertions: [
      "default Prompt resolves a fresh-parser, off-scene daughter-to-betrothal query without NAME injection",
      "relation-only betrothed and former-spouse answers do not expose nonfamily age, title, or traits",
      "fresh-parser former-spouse proof is source-bound to owner, campaign, and snapshot",
      "current stepfather name is available without injected knownNAME facts",
      "MANUAL_HIDDEN suppresses the name in Prompt content and console diagnostics while retaining relation category",
      "first-meeting identity, title, trait, and scene metadata remain masked"
    ]
  }, null, 2) + "\n");
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

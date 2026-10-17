"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { Character } = require("../src/app/main/game-data/character");
const { createLogParser } = require("../src/app/main/game-data/log-parser");
const { resolveCharacterAge } = require("../src/app/main/worldline/character-age-service");

function characterLine({ id, age }) {
  const fields = Array(28).fill("");
  fields[0] = String(id);
  fields[1] = `角色${id}`;
  fields[2] = `角色${id}全名`;
  fields[3] = "头衔";
  fields[4] = "he";
  fields[5] = age;
  return `VOTC:IN/;/character/;/${fields.join("/;/")}`;
}

async function parseSyntheticLog(lines) {
  const buildRoot = path.join(__dirname, "..", ".build");
  fs.mkdirSync(buildRoot, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(buildRoot, "v9.3.7-age-calibration-"));
  const fixturePath = path.join(fixtureRoot, "debug.log");
  fs.writeFileSync(fixturePath, `${lines.join(os.EOL)}${os.EOL}`, "utf8");
  class TestGameData {
    constructor(data) {
      this.playerID = Number(data[0]);
      this.date = data[4];
      this.totalDays = Number(data[8]);
      this.characters = new Map();
    }
  }
  const parseLog = createLogParser({ GameData: TestGameData, Character });
  const previousLog = console.log;
  console.log = () => {};
  try {
    return await parseLog(fixturePath);
  } finally {
    console.log = previousLog;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function main() {
  const calendarOnly = resolveCharacterAge({ birthDate: "1174.1.1" }, { currentGameDate: "1190.1.1" });
  assert.strictEqual(calendarOnly.age, null, "unverified CK3 calendar arithmetic must not become a factual age");
  assert.strictEqual(calendarOnly.ageSource, "UNKNOWN");
  assert.strictEqual(calendarOnly.calculatedCalendarAge, 16, "retain calendar arithmetic for diagnostics only");
  assert.strictEqual(calendarOnly.diagnosticCode, "CALENDAR_AGE_UNVERIFIED");

  const canonicalCurrentAge = resolveCharacterAge({
    age: 17,
    ageSource: "CK3_CURRENT_AGE",
    birthDate: "1172.5.2"
  }, { currentGameDate: "1190.5.2" });
  assert.strictEqual(canonicalCurrentAge.age, 17, "trusted current age must beat an unverified calendar estimate");
  assert.strictEqual(canonicalCurrentAge.calculatedCalendarAge, 18);
  assert.strictEqual(canonicalCurrentAge.calendarEstimateDiffers, true);
  assert.strictEqual(canonicalCurrentAge.conflict, true, "keep the disagreement observable for compatible diagnostics");
  assert.strictEqual(canonicalCurrentAge.sourceConflict, false, "an unverified estimate is not authoritative source conflict");

  const relativeEvidence = {
    age: 14,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    evidence: { age: [{
      value: 14,
      ageSource: "CK3_LIVE_RELATIVE_AGE",
      sourceOwnerId: 1,
      relationType: "child",
      source: "1.children",
      campaignToken: "votc8c-123456789012",
      sourceSnapshotId: "1190.5.2/100"
    }] }
  };
  const relativeAge = resolveCharacterAge(relativeEvidence, {
    currentGameDate: "1190.5.2",
    currentTotalDays: 100,
    currentCampaignToken: "votc8c-123456789012"
  });
  assert.strictEqual(relativeAge.age, 14,
    "current relative age requires owner, relation type, and source evidence");
  assert.strictEqual(relativeAge.sourceOwnerId, 1);
  assert.strictEqual(relativeAge.currentAgeSourceOwnerIdHash.length, 64);
  assert.strictEqual(relativeAge.currentAgeRelationType, "child");
  assert.strictEqual(relativeAge.currentAgeEvidenceSourceType, "children");
  for (const invalidEvidence of [
    { ...relativeEvidence.evidence.age[0], sourceOwnerId: 0 },
    { ...relativeEvidence.evidence.age[0], relationType: "canonical" },
    { ...relativeEvidence.evidence.age[0], source: "" },
    { ...relativeEvidence.evidence.age[0], source: "9.children" },
    { ...relativeEvidence.evidence.age[0], value: 13 },
    { ...relativeEvidence.evidence.age[0], campaignToken: "votc8c-999999999999" },
    { ...relativeEvidence.evidence.age[0], sourceSnapshotId: "1189.5.2/99" }
  ]) {
    assert.strictEqual(resolveCharacterAge({ ...relativeEvidence, evidence: { age: [invalidEvidence] } }, {
      currentGameDate: "1190.5.2",
      currentTotalDays: 100,
      currentCampaignToken: "votc8c-123456789012"
    }).age, null,
      "relative age evidence with a missing or mismatched binding must fail closed");
  }

  const invalidRawCharacter = Array(28).fill("");
  invalidRawCharacter[0] = "10";
  invalidRawCharacter[1] = "人物";
  invalidRawCharacter[2] = "人物全名";
  invalidRawCharacter[4] = "he";
  invalidRawCharacter[5] = "age 17";
  const invalidCharacter = new Character(invalidRawCharacter);
  assert.strictEqual(invalidCharacter.age, null, "non-numeric text must not be promoted to an authoritative integer age");
  assert.strictEqual(invalidCharacter.ageSource, null);

  const parsed = await parseSyntheticLog([
    "VOTC:IN/;/init/;/1/;/玩家/;/1/;/回应者/;/1190年5月2日/;/___________talk_scene/;/无/;/无/;/100",
    characterLine({ id: 1, age: "40" }),
    "VOTC:CAMPAIGN/votc8c-123456789012",
    "VOTC:IN/;/parents/;/1/;/2/;/父亲/;/900/;/1160.1.1/;/60",
    "VOTC:IN/;/kids/;/1/;/3/;/子女/;/they/;/1050/;/1178.4.1/;/14",
    "VOTC:IN/;/siblings/;/1/;/4/;/兄弟姐妹/;/she/;/1070/;/1179.1.1/;/13",
    "VOTC:IN/;/kids/;/1/;/5/;/旧档子女/;/he/;/1090/;/1181.1.1"
  ]);
  const owner = parsed.characters.get(1);
  assert.strictEqual(owner.parents[0].age, 60);
  assert.strictEqual(owner.parents[0].ageSource, "CK3_LIVE_RELATIVE_AGE");
  assert.deepStrictEqual(owner.parents[0].evidence.age[0], {
    value: 60,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    sourceOwnerId: 1,
    relationType: "parent",
    source: "1.parents",
    campaignToken: "votc8c-123456789012",
    sourceSnapshotId: "1190年5月2日/100"
  });
  assert.strictEqual(owner.children[0].age, 14);
  assert.strictEqual(owner.children[0].ageSource, "CK3_LIVE_RELATIVE_AGE");
  assert.strictEqual(owner.children[0].evidence.age[0].relationType, "child");
  assert.strictEqual(owner.children[0].evidence.age[0].source, "1.children");
  assert.strictEqual(resolveCharacterAge(owner.children[0], {
    currentGameDate: parsed.date,
    currentTotalDays: parsed.totalDays,
    currentCampaignToken: parsed.campaignToken
  }).age, 14, "a parsed relative age is trusted only in the same campaign and game snapshot");
  assert.strictEqual(owner.siblings[0].age, 13);
  assert.strictEqual(owner.siblings[0].ageSource, "CK3_LIVE_RELATIVE_AGE");
  assert.strictEqual(owner.siblings[0].evidence.age[0].relationType, "sibling");
  assert.strictEqual(owner.siblings[0].evidence.age[0].source, "1.siblings");
  assert.strictEqual(owner.children[1].age, null, "legacy relative records without an appended age remain unknown");
  assert.strictEqual(owner.children[1].ageSource, null);
  console.log("V9.3.7 age calibration: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

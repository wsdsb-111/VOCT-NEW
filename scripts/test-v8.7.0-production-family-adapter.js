"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Character, inferGenderFromPronoun } = require("../resources/app/out/main/game-data/character");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { createRelationshipResolver } = require("../resources/app/out/main/game-data/relationship-resolver");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
const { computeAgeAtDate, formatDeathFact } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { CK3LogProductionFixture, productionFamilyLogLines } = require("./v8.7-production-fixtures");

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v870-family-"));
  const logPath = path.join(tempDir, "debug.log");
  try {
    fs.writeFileSync(logPath, `${productionFamilyLogLines().join("\n")}\n`, "utf8");
    const parseLog = createLogParser({ GameData: CK3LogProductionFixture, Character });
    const gameData = await parseLog(logPath);
    const profiles = createRelationshipResolver({ onDiagnostic: () => false }).buildCanonicalProfiles(gameData.characters, gameData.totalDays, inferGenderFromPronoun);
    for (const [id, reason] of [[10, "MURDER"], [11, "DISEASE"], [12, "BATTLE"]]) {
      const profile = profiles.get(id);
      assert(profile, `production relative ${id} must survive canonicalization`);
      assert.equal(profile.alive, false);
      assert.equal(profile.deathDateTotalDays, 428000);
      assert.equal(profile.deathDate, "1171年9月2日");
      assert.equal(profile.deathReason, reason);
      assert.equal(profile.age, null, "deceased profile must not store a derived current age");
      const ageAtDeath = resolveCharacterAge(profile, { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays });
      assert.equal(ageAtDeath.age, null, "unverified CK3 calendar arithmetic is diagnostic, not a factual age at death");
      assert.equal(ageAtDeath.calculatedCalendarAge, computeAgeAtDate(profile.birthDate, profile.deathDate));
      assert.equal(ageAtDeath.ageSource, "AGE_AT_DEATH_UNAVAILABLE");
      assert.equal(ageAtDeath.diagnosticCode, "CALENDAR_AGE_UNVERIFIED");
    }
    const explicitDeath = {
      id: 13,
      fullName: "明确年龄的亡者",
      alive: false,
      birthDate: "1100.1.1",
      deathDate: "1150.1.1",
      ageAtDeath: 49,
      ageAtDeathSource: "CK3_AGE_AT_DEATH"
    };
    const explicitAgeAtDeath = resolveCharacterAge(explicitDeath, { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays });
    assert.equal(explicitAgeAtDeath.age, 49, "explicit CK3 age at death remains factual even when the unverified calendar estimate differs");
    assert.equal(explicitAgeAtDeath.ageSource, "CK3_AGE_AT_DEATH");
    const explicitDeathPresentation = formatDeathFact(explicitDeath, { currentGameDate: gameData.date, currentTotalDays: gameData.totalDays });
    assert.match(explicitDeathPresentation.text, /终年49岁/);
    console.log("V8.7.0 Production Family Adapter: PASS (parser-shaped parent/child/sibling death passthrough)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

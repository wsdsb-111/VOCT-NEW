"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { getCurrentTruth } = require("../resources/app/out/main/worldline/current-truth-adapter");
const { classifySelectedWorldFacts } = require("../resources/app/out/main/worldline/world-knowledge-classifier");
const { buildSubjectiveWorldPrompt } = require("../resources/app/out/main/worldline/subjective-prompt-context");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8151-independent-qa-"));
const campaignToken = "votc-v8151-independent-qa-campaign";
const fixtureDate = "1164.5.20";
let checks = 0;

async function check(name, run) {
  await run();
  checks++;
  console.log("PASS " + name);
}

async function testWorldlineNormalization() {
  const currentSave = [
    "date=1066.1.1",
    "played_character=1",
    "living={",
    "  1={ first_name=\"甲\" culture=0 rite=34 family_data={ spouse=0 real_father=0 real_mother=0 } landed_data={ liege=0 } }",
    "}",
    "rites={ database={ 34={ faith=100 } } }",
    "faiths={ database={ 100={ faith_type=taoism } } }",
    "culture_manager={ cultures={ 0={ name=han culture_template=han_group } } }"
  ].join("\n");
  const snapshot = parseGameState(currentSave);
  const character = snapshot.characters["1"];
  const candidate = { id: "character:1", kind: "CHARACTER", sourceTier: "GAME_TRUTH",
    gameDate: snapshot.gameDate, payload: { id: "1", character } };
  const facts = classifySelectedWorldFacts({ gameTruth: [candidate] }, snapshot.gameDate, snapshot);
  const prompt = buildSubjectiveWorldPrompt({ promptFacts: facts });
  const faith = getCurrentTruth(snapshot, "1", "faith");
  const culture = getCurrentTruth(snapshot, "1", "culture");
  assert(faith.available, "rite -> faith -> faith type must normalize to an available Current Truth");
  assert(culture.available, "culture runtime ID zero is valid when the save maps it");
  assert(!/^\d+$/.test(String(faith.rawValue)), "a faith runtime ID must not be exposed as a faith name");
  assert(!/^\d+$/.test(String(culture.rawValue)), "a culture runtime ID must not be exposed as a culture name");
  assert(/taoism|道教/i.test(prompt), "the final world-fact prompt should use the canonical faith key: " + prompt);
  assert(/han|漢|汉/i.test(prompt), "the final world-fact prompt should use the canonical culture key: " + prompt);
  assert(!/当前文化为0|当前信仰为100|#0/.test(prompt), "runtime IDs and zero relationship sentinels must not become facts");
  assert(!facts.some(fact => fact.field === "PARENTS" || fact.field === "SPOUSE"), "zero relationship references are empty");
  assert.equal(character.parents.father, null);
  assert.equal(character.spouse, null);
  assert.equal(character.liege, null);

  const unresolved = parseGameState(currentSave.replace("culture=0 rite=34", "culture=77 rite=99"));
  const unresolvedFacts = classifySelectedWorldFacts({ gameTruth: [{ ...candidate,
    payload: { id: "1", character: unresolved.characters["1"] } }] }, unresolved.gameDate, unresolved);
  const unresolvedPrompt = buildSubjectiveWorldPrompt({ promptFacts: unresolvedFacts });
  assert(!unresolvedFacts.some(fact => (fact.field === "CHARACTER_FAITH" || fact.field === "CHARACTER_CULTURE")
    && /\b(?:77|99)\b/.test(fact.value || "")), "unmapped runtime IDs cannot be presented as canonical facts");
  assert(!/\b(?:77|99)\b/.test(unresolvedPrompt), "unresolved culture and rite IDs remain unknown in the prompt");

  const legacy = parseGameState("date=1066.1.1 played_character=1 living={ 1={ first_name=\"甲\" culture=han faith=taoism } }");
  assert.equal(getCurrentTruth(legacy, "1", "faith").rawValue, "taoism", "direct legacy faith fields remain compatible");
  assert.equal(getCurrentTruth(legacy, "1", "culture").rawValue, "han", "direct legacy culture fields remain compatible");
}

async function testWorldlineIdentityNameDoesNotBecomeLegacyMemory() {
  const save = "date=1066.1.1 played_character=1 living={ 1={ first_name=\"甲\" culture=han faith=taoism } }";
  const snapshot = parseGameState(save);
  const character = snapshot.characters["1"];
  const candidate = { id: "character:1", kind: "CHARACTER", sourceTier: "GAME_TRUTH",
    gameDate: snapshot.gameDate, payload: { id: "1", character } };
  const identityFacts = classifySelectedWorldFacts({ gameTruth: [candidate] }, snapshot.gameDate, snapshot);
  assert(identityFacts.some(fact => fact.field === "NAME" && fact.value === "甲"),
    "the CK3 name remains available as a scoped Worldline identity fact");

  const summariesDir = path.join(root, "summaries");
  fs.mkdirSync(summariesDir, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const statement = "我名叫甲，如今是皇帝。";
  const context = { campaignToken, conversationId: "identity-name-test", finalizationId: "identity-name-final",
    summaryRequestId: "identity-name-request", date: fixtureDate, totalDays: 425000,
    participants: [{ id: 1, name: "甲", fullName: "甲" }, { id: 2, name: "乙", fullName: "乙" }],
    participantPresence: [{ characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: null }],
    messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, name: "甲", content: statement }] };
  const extraction = engine.extractor.parseOutput(JSON.stringify({ summarySegments: [{ content: statement,
    participants: [1], visibility: "private", source: "spoken", messageIds: [1], speakerIds: [1] }], memories: [] }), context);
  assert.equal(extraction.memories.length, 0, "an identity mention in the narrative does not synthesize a typed memory");
  engine.persistExtraction(context, extraction);
  const episode = engine.store.findEpisodeByFinalization(context.conversationId, context.finalizationId, campaignToken);
  assert.equal(episode.sessionSummary, statement, "the Legacy episode still retains the source narrative");
  assert.deepEqual(episode.memoryIds, [], "the name statement does not become an automatically stored memory");
  assert.deepEqual(engine.store.listAllMemories(), [], "Worldline identity facts do not spill into Legacy memory storage");
}

async function main() {
  const cases = [
    [testWorldlineNormalization, "Worldline normalization, zero relationship sentinels, unresolved IDs and legacy fields"],
    [testWorldlineIdentityNameDoesNotBecomeLegacyMemory, "CK3 identity names stay Worldline facts and do not become automatic Legacy memories"]
  ];
  const failures = [];
  try {
    for (const [run, label] of cases) {
      try { await check(label, run); }
      catch (error) { failures.push({ label, error }); console.error("FAIL " + label + ":", error); }
    }
  } finally {
    const target = path.resolve(root);
    assert(!target.startsWith(path.resolve(__dirname) + path.sep), "temporary fixture cleanup must remain in OS temp");
    fs.rmSync(target, { recursive: true, force: true });
  }
  if (failures.length) throw new Error(failures.length + " of " + cases.length + " independent QA groups failed");
  console.log("V8.15.1 independent QA: PASS (" + checks + " groups; temporary fixtures only)");
}

main().catch(error => { console.error(error); process.exitCode = 1; });

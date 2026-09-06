"use strict";

const assert = require("assert");
const { analysisTextMatches, analyzeSharedQuery } = require("../resources/app/out/main/worldline/shared-query-analyzer");

const snapshot = {
  characters: {
    "100": { id: "100", firstName: "npc_name", alive: true, location: "8841" },
    "101": { id: "101", firstName: "han_name", alive: true, location: "8841" }
  },
  nameToCharacterIds: {
    npc_name: ["100"],
    han_name: ["101"]
  },
  indexes: {
    verifiedFullNameToRuntimeIds: { "李小明": ["100"], "韩世忠": ["101"] },
    givenNameToRuntimeIds: { npc_name: ["100"], han_name: ["101"] }
  },
  definitionToRuntime: {
    nansong_yue_085: "100"
  },
  runtimeToDefinitions: {
    "100": ["nansong_yue_085"]
  },
  titles: {
    "500": { id: "500", key: "c_nf_zhuojun_zhao", holder: "100" }
  }
};

function localize(type, rawKey) {
  const values = {
    "character:npc_name": "李小明",
    "character:han_name": "韩世忠",
    "title:c_nf_zhuojun_zhao": "涿郡"
  };
  return { rawKey, localizedValue: values[`${type}:${rawKey}`] || rawKey, confidence: values[`${type}:${rawKey}`] ? "CONFIRMED" : "NOT_FOUND" };
}

function findLocalizedKeys(type, value) {
  const values = {
    "character:李小明": [{ rawKey: "npc_name" }],
    "title:涿郡": [{ rawKey: "c_nf_zhuojun_zhao" }]
  };
  return values[`${type}:${value}`] || [];
}

const localizedOnlySnapshot = { ...snapshot, definitionToRuntime: {}, runtimeToDefinitions: {} };
const chineseCharacter = analyzeSharedQuery({ snapshot: localizedOnlySnapshot, query: "李小明现在在哪里", localize, findLocalizedKeys });
assert.deepEqual(chineseCharacter.characters.map((item) => item.id), ["100"], "a Chinese sentence must resolve the localized character entity rather than use the whole sentence as one term");
assert.ok(chineseCharacter.terms.includes("李小明"), "CJK 2-gram terms must retain the character name");
assert.ok(!chineseCharacter.terms.includes("李小明现在在哪里"), "the complete Chinese sentence must never become the only query term");
assert.equal(chineseCharacter.characters[0].displayName, "李小明", "localized character display text must remain separate from raw identity");
assert.ok(chineseCharacter.characters[0].matchSources.includes("runtime_native_name"), "a verified localized full-name index must disclose its Runtime-native match source");
assert.ok(analysisTextMatches(chineseCharacter, "李小明已抵达前线"), "Supplemental matching must reuse the analyzed entity terms");

assert.equal(analyzeSharedQuery({ snapshot, query: "岳飞现在在哪里", localize, findLocalizedKeys }).characters.length, 0, "historical candidates cannot use localization to bypass missing identity evidence");

const chineseTitle = analyzeSharedQuery({ snapshot, query: "涿郡现在归谁", localize, findLocalizedKeys });
assert.deepEqual(chineseTitle.titles.map((item) => item.id), ["500"], "a localized title query must resolve the title identity");
assert.equal(chineseTitle.titles[0].displayName, "涿郡", "localized title display text must be retained for projection");

const definitionId = analyzeSharedQuery({ snapshot, query: "nansong_yue_085", localize, findLocalizedKeys });
assert.deepEqual(definitionId.characters.map((item) => item.id), ["100"], "historical definition IDs must resolve directly to runtime characters");

const runtimeId = analyzeSharedQuery({ snapshot, query: "#100", localize, findLocalizedKeys });
assert.deepEqual(runtimeId.characters.map((item) => item.id), ["100"], "runtime IDs must resolve directly to snapshot characters");

const sharedMemoryEntity = analyzeSharedQuery({ snapshot, query: "他现在在哪里", mentionedEntityIds: ["100"], localize, findLocalizedKeys });
assert.deepEqual(sharedMemoryEntity.characters.map((item) => item.id), ["100"], "already-resolved memory entities must be shared with Worldline instead of requiring a second name parse");
assert.ok(sharedMemoryEntity.characters[0].matchSources.includes("shared_memory_entity"), "shared memory entities must retain their provenance");

const unrelated = analyzeSharedQuery({ snapshot, query: "现在在哪里", localize, findLocalizedKeys });
assert.equal(unrelated.characters.length, 0, "an entity-free Chinese question must not invent a character candidate");

console.log("V8.4.1 Worldline Chinese Query: PASS (CJK entities, localized aliases, runtime and historical identity)");

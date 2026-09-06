"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildHistoricalDefinitionIndex, lookup } = require("../resources/app/out/main/worldline/historical-definition-index");
const { resolveHistoricalIdentity } = require("../resources/app/out/main/worldline/historical-identity-resolver");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v86-source-policy-"));
function source(name, { birth = "1089.1.1", gender = "no", father = "father_a", surname = "韩" } = {}) {
  const base = path.join(root, name);
  const files = {
    "history/characters/han.txt": `han_001 = { name = "世忠" dynasty = han_dyn culture = han female = ${gender} father = ${father} ${birth} = { birth = yes } }\n`,
    "common/dynasties/han.txt": "han_dyn = { name = han_surname }\n",
    "localization/simp_chinese/han_l_simp_chinese.yml": `l_simp_chinese:\nhan_surname:0 "${surname}"\n`
  };
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(base, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value, "utf8");
  }
  return { root: base, sourceId: name, modId: name === "base" ? null : name };
}
function runtimeSnapshot() {
  return {
    characters: { "100": { id: "100", firstName: "世忠", gender: "male" } },
    definitionToRuntime: { han_001: "100" },
    runtimeToDefinitions: { "100": ["han_001"] }
  };
}

try {
  const variants = buildHistoricalDefinitionIndex({ sources: [
    source("base"),
    source("metadata_override", { birth: "1090.1.1", father: "father_b" })
  ] });
  const record = lookup(variants, "韩世忠").candidates[0];
  assert.deepEqual(record.conflicts, [], "birth and family variants are not identity hard conflicts");
  assert.deepEqual(record.sourceVariants.map((item) => item.code).sort(), ["BIRTH_SOURCE_VARIANT", "FATHER_SOURCE_VARIANT"]);
  assert.equal(record.metadata.birthDate, null, "a conflicting source value cannot be selected as unique metadata");
  assert.equal(record.metadata.parents.father, null);
  const resolved = resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["han_001"], definitionRecords: [record], snapshot: runtimeSnapshot() });
  assert.equal(resolved.status, "RESOLVED", "metadata variants cannot reject an otherwise proven identity");
  assert.equal(resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["han_001"], definitionRecords: [record], snapshot: runtimeSnapshot(), sourceComplete: false }).status, "REJECTED", "an incomplete source set remains fail-closed");

  const genderConflict = buildHistoricalDefinitionIndex({ sources: [source("gender_base"), source("gender_override", { gender: "yes" })] });
  const genderRecord = lookup(genderConflict, "韩世忠").candidates[0];
  assert(genderRecord.conflicts.includes("GENDER_SOURCE_CONFLICT"));
  assert.equal(resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["han_001"], definitionRecords: [genderRecord], snapshot: runtimeSnapshot() }).status, "REJECTED");

  const nameConflict = buildHistoricalDefinitionIndex({ sources: [source("name_base"), source("name_override", { surname: "张" })] });
  const nameRecord = nameConflict.byId.han_001;
  assert(nameRecord.conflicts.includes("NAME_SOURCE_CONFLICT"));
  assert.equal(resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["han_001"], definitionRecords: [nameRecord], snapshot: runtimeSnapshot() }).status, "REJECTED");

  const brokenBinding = runtimeSnapshot();
  brokenBinding.runtimeToDefinitions = {};
  assert.equal(resolveHistoricalIdentity({ alias: "韩世忠", candidateDefinitionIds: ["han_001"], definitionRecords: [record], snapshot: brokenBinding }).status, "REJECTED", "bidirectional binding conflicts remain identity-hard");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("V8.6 Historical Source Conflict Policy: PASS (identity conflicts separated from metadata variants)");

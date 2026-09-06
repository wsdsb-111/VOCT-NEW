"use strict";

const assert = require("assert");
const { classifySelectedWorldFacts } = require("../resources/app/out/main/worldline/world-knowledge-classifier");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");
const { createSharedCandidatePool } = require("../resources/app/out/main/worldline/shared-candidate-pool");

const candidate = { id: "supplemental:s", sourceTier: "PLAYER_SUPPLEMENTAL", gameDate: "1170.6.6", visibility: "SECRET", entityRefs: { characters: ["1"] }, payload: { id: "s", title: "密令", body: "只给甲的正文" } };
const [secret] = classifySelectedWorldFacts({ supplemental: [candidate] }, "1170.6.6");
assert.deepEqual(secret.knownBy, ["1"]);
assert.equal(buildSubjectiveWorldView({ responder: { id: "1" }, candidates: [secret], scope: { asOf: "1170.6.6", completeness: "COMPLETE" } }).allowedFacts.length, 1);
assert.equal(buildSubjectiveWorldView({ responder: { id: "2" }, candidates: [secret], scope: { asOf: "1170.6.6", completeness: "COMPLETE" } }).allowedFacts.length, 0);
const shared = createSharedCandidatePool({ cache: new Map(), key: "s", build: () => [secret] });
assert(!JSON.stringify(shared).includes("只给甲的正文"), "shared cache must not retain secret supplemental bodies");
assert(!JSON.stringify(shared).includes("knownBy") && !JSON.stringify(shared).includes("ownerId"), "shared cache must not retain responder authorization metadata");
const personal = { ...secret, factId: "world:supplemental:p:SUPPLEMENTAL", contentRef: "p", knowledgeLevel: "PERSONAL_MEMORY", knownBy: ["1"], ownerId: "1", value: "仅甲的个人补充" };
const sharedPersonal = createSharedCandidatePool({ cache: new Map(), key: "p", build: () => [personal] });
assert(!JSON.stringify(sharedPersonal).includes("仅甲的个人补充") && !JSON.stringify(sharedPersonal).includes("knownBy") && !JSON.stringify(sharedPersonal).includes("ownerId"), "Personal Supplemental must use the same body/ACL redaction boundary as Secret");
assert.equal(classifySelectedWorldFacts({ supplemental: [{ ...candidate, entityRefs: { characters: [] } }] }, "1170.6.6").length, 0, "scoped secrets without verified runtime recipients fail closed");
console.log("V8.6.1 Scoped Supplemental: PASS (recipient authorization and shared-cache redaction)");

"use strict";

const assert = require("assert");
const { classifyKnowledge, canKnow, resolveKnowledgeConflict } = require("../resources/app/out/main/worldline/character-knowledge-policy");

const responder = { id: "10" };
const evaluate = (fact, context = {}) => classifyKnowledge(fact, responder, context);

assert.equal(evaluate({ factId: "self:title", entityId: "10", field: "PRIMARY_TITLE", knowledgeLevel: "SELF" }).decision, "ALLOW");
assert.equal(evaluate({ factId: "self:father", entityId: "10", field: "BIOLOGICAL_FATHER", knowledgeLevel: "SELF" }).decision, "UNKNOWN", "private biological truth is not automatically self-known");
assert.equal(evaluate({ factId: "observed", knowledgeLevel: "DIRECT_OBSERVATION", directObserverIds: ["10"] }).decision, "ALLOW");

assert.equal(evaluate({ factId: "memory", knowledgeLevel: "PERSONAL_MEMORY", ownerId: "10" }).decision, "ALLOW");
assert.equal(evaluate({ factId: "legacy", knowledgeLevel: "PERSONAL_MEMORY", participantIds: ["10"] }).decision, "UNKNOWN", "unverified legacy participation cannot grant knowledge");

assert.equal(evaluate({ factId: "court", knowledgeLevel: "COURT_PUBLIC", public: true }, { sameCourt: true }).decision, "ALLOW");
assert.equal(evaluate({ factId: "court", knowledgeLevel: "COURT_PUBLIC", public: true }, { sameCourt: false }).decision, "DENY");
assert.equal(evaluate({ factId: "realm", knowledgeLevel: "REALM_PUBLIC", public: true }, { sameRealm: true }).decision, "ALLOW");
assert.equal(evaluate({ factId: "world", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: true }).decision, "ALLOW");
assert.equal(evaluate({ factId: "history", knowledgeLevel: "PUBLIC_WORLD", sourceTier: "HISTORICAL_BASELINE", public: true }).decision, "UNKNOWN", "historical background needs affirmative temporal safety");

const secret = { factId: "secret", field: "PRIVATE_PLAN", body: "受保护正文", knowledgeLevel: "SECRET", sourceTier: "GAME_TRUTH", knownBy: ["11"], authorizationComplete: true };
const secretDenied = evaluate(secret, { sameCourt: true, sameRealm: true, queryFingerprint: "same-query", checkpointId: "same-checkpoint" });
assert.equal(secretDenied.decision, "DENY", "source authority, query/checkpoint equality and shared scope cannot reveal a secret");
assert.equal(secretDenied.fact.body, undefined, "a denied secret result cannot retain protected content");
assert.equal(evaluate({ ...secret, knownBy: ["10"] }).decision, "ALLOW");
assert.equal(evaluate({ ...secret, knownBy: [], participantIds: ["10"], participationVerified: true }).decision, "ALLOW");
assert.equal(evaluate({ ...secret, hidden: true, knownBy: ["10"] }).decision, "DENY");
assert.equal(canKnow(responder, { ...secret, knownBy: ["10"] }), true);
assert.equal(evaluate({ ...secret, knownBy: [] }).decision, "DENY", "revoking knownBy must revoke access on the next policy evaluation");
assert.equal(evaluate({ factId: "partial", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: true, sourceComplete: false }).decision, "UNKNOWN");

const contractShape = evaluate({ factId: "shape", entityId: "10", field: "PRIMARY_TITLE", knowledgeLevel: "SELF", evidenceRefs: ["checkpoint:title"], asOf: "1170.1.1", verificationMode: "CHECKPOINT" });
assert.deepEqual(contractShape.evidenceRefs, ["checkpoint:title"]);
assert.equal(contractShape.asOf, "1170.1.1");
assert.equal(contractShape.verificationMode, "CHECKPOINT");

const winner = resolveKnowledgeConflict([
  evaluate({ factId: "old", entityId: "10", field: "PRIMARY_TITLE", value: "旧头衔", knowledgeLevel: "PERSONAL_MEMORY", ownerId: "10" }),
  evaluate({ factId: "current", entityId: "10", field: "PRIMARY_TITLE", value: "当前头衔", knowledgeLevel: "SELF" })
]);
assert.equal(winner.decision, "ALLOW");
assert.equal(winner.fact.value, "当前头衔");

const secretShadow = resolveKnowledgeConflict([
  { fact: secret, ...evaluate(secret) },
  { fact: { value: "低置信度猜测" }, ...evaluate({ factId: "guess", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: true }) }
]);
assert.equal(secretShadow.decision, "UNKNOWN", "an unavailable secret cannot be replaced by a lower-priority guess for the same fact");

console.log("V8.6 Character Knowledge Policy: PASS (self, observation, memory, scope, secret and conflict rules)");

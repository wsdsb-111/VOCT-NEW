"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Memory4Coordinator } = require("../src/app/main/memory-system/memory4-coordinator");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");

const coordinator = Object.create(Memory4Coordinator.prototype);
coordinator.sourcePositions = new WeakMap();
const fragment = { fragmentId: "source-1", text: "甲告知乙明年会继续研究历法。", speakerId: 1,
  entityIds: [1], presentIds: [1, 2], knownBy: [1, 2], sourceType: "spoken", visibility: "participants",
  visibilityEvidence: "application_fragment", sourceTextVerified: true, sourceMessageIds: [1] };
const snapshot = { ownerId: 2, campaignToken: "policy-campaign", date: "1164.1.1", completeness: "complete",
  counterpartIds: [1], fragments: [fragment], activeCommitments: [], entityNameEvidence: [], relationshipEvidence: [] };
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const completeResult = payload => ({ content: JSON.stringify(payload), finish_reason: "stop" });
const PromptBuilder = createPromptBuilder({ TemplateEngine: class {}, PromptScriptLoader: class {},
  TokenCounter: { estimateMessageTokens: message => message.content.length }, createPromptFingerprint: hash });
const first = coordinator.buildPrompt(snapshot, [fragment], 8, 8);
const limited = coordinator.buildPrompt(snapshot, [fragment], 6, 3);
assert.equal(hash(first[0].content), hash(limited[0].content), "D-01 fixed Durable policy must not depend on remaining limits");
assert.notEqual(first[1].content, limited[1].content, "D-01 dynamic User must retain changing limits");
assert.deepEqual(JSON.parse(limited[1].content).limits, { maxEntries: 6, maxCommitmentTransitions: 3 });
assert.equal(PromptBuilder.prepareSummaryMessages(first)[0].content, PromptBuilder.buildSummaryCacheAnchor(), "D-01 existing anchor bytes stay intact");
assert.equal(PromptBuilder.prepareSummaryMessages(first).length, 3);
const blocks = PromptBuilder.getSummaryPromptBlocks(PromptBuilder.prepareSummaryMessages(first), "memory4_durable");
assert.equal(blocks[1].type, "summary_stable");
assert.equal(blocks[2].type, "summary_dynamic");
assert.equal(blocks[1].id, "memory4_durable-1", "existing diagnostic block IDs stay intact");

const otherFragment = { ...fragment, fragmentId: "private-other", text: "另战役的私有记录。", knownBy: [1, 3], presentIds: [1, 3] };
const other = coordinator.buildPrompt({ ...snapshot, ownerId: 3, campaignToken: "other-campaign", fragments: [otherFragment] }, [otherFragment], 1, 0);
assert.equal(first[0].content, other[0].content, "D-02 policy stays public across scopes");
assert.equal(JSON.parse(other[1].content).ownerId, 3);
assert.equal(JSON.parse(other[1].content).campaignToken, "other-campaign");
assert(!other[1].content.includes(fragment.text), "D-02 no foreign source appears in dynamic request");
assert(!first[1].content.includes(otherFragment.text));
assert.equal(first[1].content, coordinator.buildPrompt(snapshot, [fragment], 8, 8)[1].content, "D-03 repeat serialization is byte stable");

const empty = coordinator.buildPrompt(snapshot, [], 0, 1);
assert.deepEqual(JSON.parse(empty[1].content).fragments, []);
assert.deepEqual(JSON.parse(empty[1].content).limits, { maxEntries: 0, maxCommitmentTransitions: 1 }, "D-05 zero entry allowance stays zero");
const entry = { memoryType: "LONG_TERM_GOAL", text: fragment.text, fragmentIds: [fragment.fragmentId], entityIds: [1],
  participantIds: [1, 2], topics: [], eventTime: { status: "unknown" } };
assert.throws(() => coordinator.parseResult(completeResult({ status: "STORE", entries: [entry] }), [fragment], snapshot, 0, 1), /invalid_shape/, "D-06 local entry limit remains authoritative");
assert.throws(() => coordinator.parseResult(completeResult({ status: "NO_DURABLE_CONTENT", entries: [], commitmentTransitions: [{}] }), [fragment], snapshot, 0, 0), /invalid_transitions/);
const unknown = coordinator.parseResult(completeResult({ status: "STORE", entries: [{ ...entry, entityIds: [999] }] }), [fragment], snapshot);
assert.equal(unknown.entries.length, 0, "D-07 unknown entity remains rejected");
assert.equal(unknown.rejectedUnknownEntityCount, 1);
assert.throws(() => coordinator.parseResult({ content: "not json", finish_reason: "stop" }, [fragment], snapshot), /invalid_json/, "D-10 malformed result stays a failure");
assert.throws(() => coordinator.parseResult("not json", [fragment], snapshot), /generation_incomplete/, "bare strings do not carry terminal evidence");
assert.throws(() => coordinator.parseResult({ content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }) }, [fragment], snapshot), /generation_incomplete/, "missing finish reason is incomplete");
assert.throws(() => coordinator.parseResult({ content: "{}", finish_reason: "length" }, [fragment], snapshot), /generation_incomplete/);

const baselinePolicy = fs.readFileSync(path.join(__dirname, "fixtures/v9.2-durable-policy.txt"), "utf8");
const oldLimits = "Return no more than 8 entries and 8 commitment transitions for this owner in this request.";
const newLimits = "Follow the dynamic request limits: return no more than limits.maxEntries entries and limits.maxCommitmentTransitions commitment transitions for this owner in this request.";
assert(baselinePolicy.includes(oldLimits), "D-11 historical V9.2 policy evidence stays intact");
const currentPolicy = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v933-durable-policy.json"), "utf8")).policy;
assert.equal(first[0].content, currentPolicy, "D-11 V9.3.3 compact evidence/schema policy is explicitly versioned");
assert(first[0].content.includes(newLimits), "D-11 changing limits remain outside the policy prefix");
console.log("Durable policy: PASS (V9.3.3 versioned prefix, dynamic scopes/limits, deterministic bytes, strict validation)");

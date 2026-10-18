"use strict";

const assert = require("node:assert/strict");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");

const owner = { id: 2, shortName: "观察者", traits: [], parents: [], children: [] };
const target = { id: 1, shortName: "对象", traits: [{ traitId: "brave", name: "勇敢" }, { traitId: "witch", name: "巫师" }],
  primaryTitle: "测试公爵", titleRankConcept: "concept_duchy", parents: [], children: [] };
const data = { date: "1200.1.1", totalDays: 100, campaignToken: "disclosure-campaign",
  playerID: 1, characters: new Map([[1, target], [2, owner]]) };
let status = "MANUAL_KNOWN";
let sourceDate = data.date;
let boundOwner = 2;
let revision = 1;
const service = { getDisclosureProfile: () => ({
  status: "READY", scope: { campaignToken: data.campaignToken, ownerRuntimeId: boundOwner,
    targetRuntimeId: 1, sourceSnapshotId: "checkpoint-one" }, checkpointAsOf: sourceDate,
  facts: [
    { factType: "TRAIT", factKey: "trait_brave", value: "勇敢", status,
      effectiveKnown: status !== "MANUAL_HIDDEN", revision, sourceSnapshotId: "checkpoint-one" },
    { factType: "TITLE", factKey: "100", value: "测试公爵", aliases: ["concept_duchy"], status,
      effectiveKnown: status !== "MANUAL_HIDDEN", revision, sourceSnapshotId: "checkpoint-one" }
  ]
}) };
const build = () => buildCharacterDisclosureContext({ service, gameData: data, responderId: 2, targetIds: [1] });
const known = build();
const view = createTraitProfileView(data, owner, known).gameData.characters.get(1);
assert.deepEqual(view.traits.map(trait => trait.traitId), ["brave"], "only this Owner's legal known trait may enter Prompt");
assert.equal(view.primaryTitle, "测试公爵");
assert.equal(view.titleRankConcept, "concept_duchy");
assert(!JSON.stringify(view).includes("witch"), "unmentioned secret traits stay outside the projected Prompt");
status = "MANUAL_HIDDEN";
revision++;
const hidden = build();
assert.notEqual(hidden.characterKnowledgeRevision, known.characterKnowledgeRevision, "same-checkpoint manual changes invalidate the transport/prefix signature");
const hiddenView = createTraitProfileView(data, owner, hidden).gameData.characters.get(1);
assert.equal(hiddenView.traits.length, 0);
assert.equal(hiddenView.primaryTitle, "");
assert.equal(hiddenView.titleRankConcept, "");
boundOwner = 3;
assert.equal(build().disclosureProfiles.size, 0, "a profile for a different Owner cannot authorize this responder");
boundOwner = 2;
sourceDate = "1199.1.1";
assert.equal(build().disclosureProfiles.size, 0, "old checkpoint facts cannot silently become current Prompt disclosure");
assert.notEqual(build().characterKnowledgeRevision, hidden.characterKnowledgeRevision);
console.log("PASS V9.3.9 character knowledge Prompt filtering, manual hiding, source freshness and exact responder scope");

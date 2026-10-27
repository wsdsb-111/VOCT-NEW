"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createTraitProfileView, isPublicCloseFamily } = require("../src/app/main/prompts/trait-profile-selector");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");

const date = "1102.4.27";
const campaignToken = "v9392-family-fixture";
const proof = (childId, parentId) => ({ id: parentId, childId, parentId, sourceOwnerId: childId,
  source: "CK3_DIRECT_PARENT", sourceRelation: "parents", relationType: "parent",
  publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken, sourceSnapshotId: `${date}/100` });
const person = (id, name, parents = []) => ({ id, name, shortName: name, fullName: `公子，${name}`, age: 11,
  primaryTitle: "公爵", titleRankConcept: "concept_duchy", heldCourtAndCouncilPositions: "宰相、宫廷医师",
  traits: [{ traitId: "witch", name: "巫师" }], parents, secrets: [{ type: "secret_witch" }], knownSecrets: [] });
const characters = new Map([[1, person(1, "父亲")], [2, person(2, "长子", [proof(2, 1)])],
  [3, person(3, "幼子", [proof(3, 1)])], [4, person(4, "旁人")]]);
const gameData = { playerID: 1, date, totalDays: 100, campaignToken, characters };
const root = fs.mkdtempSync(path.resolve(__dirname, "../.build/v9392-family-"));
try {
  const conversation = { id: "family-scene", isActive: true, gameData, selectedCharacterIds: new Set([2, 3, 4]),
    presentCharacterIds: new Set([2, 3, 4]), messages: [], departedCharacterIds: new Set(), inactiveParticipantIds: new Map() };
  const store = new ConversationDisclosureStore({ dataDir: root, getCurrentConversation: () => conversation });
  for (const [observerId, targetId] of [[1, 2], [2, 1], [2, 3], [3, 2]]) {
    assert.equal(isPublicCloseFamily(observerId, targetId, gameData), true);
    const raw = characters.get(targetId);
    const target = createTraitProfileView(gameData, characters.get(observerId)).gameData.characters.get(targetId);
    for (const field of ["name", "shortName", "fullName", "primaryTitle", "titleRankConcept", "heldCourtAndCouncilPositions", "traits"]) {
      assert.deepEqual(target[field], raw[field], `family ${observerId}->${targetId} preserves ${field}`);
    }
    assert.equal(target.age, raw.age, "current public close family preserves known CK3 ages");
    assert.deepEqual(target.secrets, [], "the whitelist does not disclose raw secret records");
    assert.deepEqual(target.knownSecrets, [], "the whitelist does not disclose another person's secret knowledge");
    const view = store.getTargetView({ ownerRuntimeId: observerId, targetRuntimeId: targetId });
    for (const factType of ["NAME", "TITLE", "TRAIT"]) {
      const facts = view.facts.filter(fact => fact.factType === factType);
      assert(facts.length > 0 && facts.every(fact => fact.effectiveKnown && fact.currentDirectObservation
        && fact.source === "PUBLIC_CLOSE_FAMILY"), `UI and Prompt agree on ${factType}`);
    }
    const trait = view.facts.find(fact => fact.factType === "TRAIT");
    assert.throws(() => store.setManualStatus({ ...view.scope, factType: "TRAIT", factKey: trait.factKey,
      factSourceSnapshotId: trait.factSourceSnapshotId, expectedRevision: trait.revision, status: "MANUAL_HIDDEN" }), /automatic_access/);
  }
  const outsider = createTraitProfileView(gameData, characters.get(4)).gameData.characters.get(2);
  assert.equal(outsider.primaryTitle, "");
  assert.equal(outsider.heldCourtAndCouncilPositions, "");
  assert.deepEqual(outsider.traits, []);
  const nonSpeakingParent = characters.get(1);
  characters.delete(1);
  assert.equal(isPublicCloseFamily(2, 3, gameData), true,
    "current public shared-parent proofs remain valid when the parent is not a conversation character");
  assert.equal(createTraitProfileView(gameData, characters.get(2)).gameData.characters.get(3).heldCourtAndCouncilPositions,
    "宰相、宫廷医师", "actual sibling-only scenes retain the full whitelist");
  characters.set(1, nonSpeakingParent);
  const siblingProof = ownerId => ({ ageSource: "CK3_LIVE_RELATIVE_AGE", sourceOwnerId: ownerId,
    relationType: "sibling", source: `${ownerId}.siblings`, campaignToken, sourceSnapshotId: `${date}/100` });
  const savedParents = [characters.get(2).parents, characters.get(3).parents];
  characters.get(2).parents = [];
  characters.get(3).parents = [];
  characters.get(2).siblings = [{ id: 3, evidence: { age: [siblingProof(2)] } }];
  assert.equal(isPublicCloseFamily(2, 3, gameData), true, "a parser-bound current sibling row independently confirms close family");
  assert.equal(isPublicCloseFamily(3, 2, gameData), true);
  assert.equal(createTraitProfileView(gameData, characters.get(2)).gameData.characters.get(3).primaryTitle, "公爵");
  characters.get(2).siblings[0].evidence.age[0].sourceSnapshotId = "old";
  assert.equal(isPublicCloseFamily(2, 3, gameData), false, "a stale sibling row grants no whitelist");
  characters.get(2).siblings[0].evidence.age[0] = siblingProof(4);
  assert.equal(isPublicCloseFamily(2, 3, gameData), false, "another owner's parser proof grants no sibling whitelist");
  characters.get(2).siblings = [];
  [characters.get(2).parents, characters.get(3).parents] = savedParents;
  const child = characters.get(2);
  for (const traitId of ["bastard", "legitimized_bastard"]) {
    child.traits.push({ traitId, name: "私生子" });
    assert.equal(isPublicCloseFamily(1, 2, gameData), true, "V9.6.1 public legal parentage is not revoked by a child's trait");
    assert.equal(isPublicCloseFamily(2, 1, gameData), true);
    assert.equal(createTraitProfileView(gameData, characters.get(1)).gameData.characters.get(2).primaryTitle, "公爵");
    assert.equal(createTraitProfileView(gameData, characters.get(1)).gameData.characters.get(2).heldCourtAndCouncilPositions, "宰相、宫廷医师");
    assert.equal(isPublicCloseFamily(2, 3, gameData), true, "verified public sibling relation remains separate");
    child.traits.pop();
  }
  for (const patch of [{ knowledgeStatus: "SECRET" }, { campaignToken: "other-campaign" },
    { sourceSnapshotId: "old-snapshot" }, { evidenceConflict: true }, { relationshipKind: "STEP" }]) {
    const original = child.parents[0];
    child.parents = [{ ...original, ...patch }];
    assert.equal(isPublicCloseFamily(1, 2, gameData), false, "invalid parent evidence grants no whitelist");
    assert.equal(isPublicCloseFamily(2, 3, gameData), false);
    child.parents = [original];
  }
  assert.equal(fs.existsSync(store.filePath), false, "intrinsic family knowledge requires no persistent write");
  console.log("V9.3.9.2 family whitelist: PASS (bidirectional names, offices, traits, UI parity and excluded sources)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

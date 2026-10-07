"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Store } = require("../resources/app/out/main/memory-system/memory4-store");

const temporary = fs.mkdtempSync(path.join(__dirname, ".votc-v8152-direct-observation-"));
const campaignToken = "v8.15.2-direct-observation-fixture";
const date = "1164.5.20";
const scope = { campaignToken, ownerId: 1 };
const visibleTrait = { traitId: "beauty_good_3", id: "beauty_good_3", category: "appearance", name: "倾国倾城" };
const dynamicTrait = { traitId: "one_eyed", id: "one_eyed", category: "physical", name: "独眼" };
const laterTrait = { traitId: "wounded_2", id: "wounded_2", category: "health", name: "重伤" };
const hiddenTrait = { traitId: "brave", id: "brave", category: "personality", name: "勇敢" };
const unknownTrait = { traitId: "mod_custom_trait", id: "mod_custom_trait", category: "custom", name: "未知特质" };
const target = traits => ({ id: 2, firstName: "乙", shortName: "乙", fullName: "乙", traits });
const gameData = (traits = [visibleTrait, dynamicTrait, hiddenTrait, unknownTrait], token = campaignToken, currentDate = date) => ({ campaignToken: token, date: currentDate,
  characters: new Map([[1, { id: 1, firstName: "甲", traits: [] }], [2, target(traits)]]) });
const sceneContext = (conversationId = "scene-one", messageBoundary = 0, presence = [1, 2], currentDate = date) => ({ conversationId,
  campaignToken, gameDate: currentDate, messageBoundary,
  participantPresence: presence.map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })) });

function fact(rows, key) {
  return rows.find(row => row.factKey === key);
}

function createMemory4(baseDir, summaryFoldersDir) {
  return new Memory4Store(new MemoryStore({ baseDir, summaryFoldersDir }));
}

async function run() {
  const summaryFoldersDir = path.join(temporary, "summaries");
  fs.mkdirSync(path.join(summaryFoldersDir, "1_甲"), { recursive: true });
  const baseDir = path.join(temporary, "memory");
  const memory4 = createMemory4(baseDir, summaryFoldersDir);
  try {
    assert.equal(typeof memory4.observeVisibleTraits, "function", "Memory4Store exposes direct visible-trait observation");
    memory4.ensureDisclosureScope(scope);

    const initial = gameData();
    const observed = memory4.observeVisibleTraits(scope, 2, initial, { conversationId: "scene-one", messageBoundary: 0 });
    assert.equal(observed.status, "OBSERVED");
    assert(observed.observedFactKeys.includes("trait_beauty_good_3"));
    assert(observed.observedFactKeys.includes("trait_one_eyed"));
    assert(!observed.observedFactKeys.includes("trait_brave"), "personality traits are not directly observed");
    assert(!observed.observedFactKeys.includes("trait_mod_custom_trait"), "unknown mod traits fail closed");
    assert(observed.diagnostics.some(row => row.reason === "visible_trait_unknown_policy"));

    const rows = memory4.getCurrentDisclosures(scope, 2, initial);
    const beauty = fact(rows, "trait_beauty_good_3");
    const eye = fact(rows, "trait_one_eyed");
    assert.equal(beauty.effectiveKnown, true);
    assert.equal(beauty.sourceKind, "DIRECT_OBSERVATION");
    assert.equal(beauty.acquisitionKind, "VISIBLE_TRAIT");
    const beautyProof = Object.values(beauty.evidenceBySource).find(proof => proof.sourceKind === "DIRECT_OBSERVATION");
    assert.equal(beautyProof.sourceConversationId, "scene-one");
    assert.equal(beautyProof.observedGameDate, date);
    assert.equal(beautyProof.observerId, scope.ownerId);
    assert.equal(beautyProof.targetId, 2);
    assert.equal(beautyProof.current, true);
    for (const key of ["sourceMessageIds", "sourceFragmentIds", "sourceTextHashes", "visibilityEvidence", "speakerId"]) {
      assert.equal(Object.hasOwn(beautyProof, key), false, `direct observation does not invent speech evidence: ${key}`);
    }
    assert.equal(fact(rows, "trait_brave").effectiveKnown, false);
    const noChange = memory4.observeVisibleTraits(scope, 2, initial, { conversationId: "scene-one", messageBoundary: 3 });
    assert.equal(noChange.status, "NO_CHANGE");
    assert.equal(noChange.changed, false, "a later turn does not rewrite an unchanged observation proof");
    assert.equal(Object.values(fact(memory4.getCurrentDisclosures(scope, 2, initial), "trait_beauty_good_3").evidenceBySource)
      .find(proof => proof.sourceKind === "DIRECT_OBSERVATION").messageBoundary, 0);

    const nextDay = gameData([visibleTrait, dynamicTrait, hiddenTrait, unknownTrait, laterTrait], campaignToken, "1164.5.21");
    const confirmed = memory4.observeVisibleTraits(scope, 2, nextDay, { conversationId: "scene-one", messageBoundary: 3 });
    assert.equal(confirmed.status, "OBSERVED");
    const nextDayBeauty = fact(memory4.getCurrentDisclosures(scope, 2, nextDay), "trait_beauty_good_3");
    assert.equal(nextDayBeauty.firstAcquiredDate, date, "the first observation date remains stable across refreshes");
    assert.equal(nextDayBeauty.lastConfirmedDate, "1164.5.21", "the latest observation date advances");
    const beautyProofs = Object.values(nextDayBeauty.evidenceBySource).filter(proof => proof.sourceKind === "DIRECT_OBSERVATION");
    assert.equal(beautyProofs.length, 2, "each observed game date retains independent evidence");
    const firstDayProof = beautyProofs.find(proof => proof.observedGameDate === date);
    const nextDayProof = beautyProofs.find(proof => proof.observedGameDate === "1164.5.21");
    assert.equal(firstDayProof.acquiredDate, date);
    assert.equal(nextDayProof.acquiredDate, "1164.5.21", "each dated proof starts on its observation date");
    assert.equal(nextDayProof.observedGameDate, "1164.5.21");
    const nextDayNoChange = memory4.observeVisibleTraits(scope, 2, nextDay, { conversationId: "scene-one", messageBoundary: 4 });
    assert.equal(nextDayNoChange.status, "NO_CHANGE");
    assert.equal(Object.values(fact(memory4.getCurrentDisclosures(scope, 2, nextDay), "trait_beauty_good_3").evidenceBySource)
      .find(proof => proof.sourceKind === "DIRECT_OBSERVATION" && proof.observedGameDate === "1164.5.21").messageBoundary, 3);
    const rollback = gameData(undefined, campaignToken, date);
    memory4.observeVisibleTraits(scope, 2, rollback, { conversationId: "scene-one", messageBoundary: 5 });
    rollback.directObservationContext = sceneContext("scene-one", 5, [1, 2], date);
    const rollbackRows = memory4.getCurrentDisclosures(scope, 2, rollback);
    const rollbackBeauty = fact(rollbackRows, "trait_beauty_good_3");
    assert.equal(rollbackBeauty.effectiveKnown, true, "the earlier dated observation remains valid after a date rollback");
    assert.equal(rollbackBeauty.firstAcquiredDate, date);
    assert.equal(rollbackBeauty.lastConfirmedDate, date, "future confirmation dates are excluded after rollback");
    assert.equal(rollbackBeauty.currentDirectObservation, false,
      "a retained earlier proof is historical when a later observation exists for this epoch");
    assert.equal(fact(rollbackRows, "trait_wounded_2"), undefined,
      "a trait first introduced on a later game date is absent after rollback");
    const beforeFirstObservation = memory4.getCurrentDisclosures(scope, 2, gameData(undefined, campaignToken, "1164.5.19"));
    assert.equal(fact(beforeFirstObservation, "trait_beauty_good_3").effectiveKnown, false,
      "an observation cannot be claimed before its first observed date");

    const hidden = memory4.updateManualDisclosure(scope, 2, nextDayBeauty, "MANUAL_HIDDEN", nextDay.date, nextDayBeauty.revision);
    assert.equal(hidden.status, "MANUAL_HIDDEN");
    const offScene = memory4.getCurrentDisclosures(scope, 2, nextDay);
    assert.equal(fact(offScene, "trait_beauty_good_3").status, "MANUAL_HIDDEN");
    assert.equal(fact(offScene, "trait_beauty_good_3").effectiveKnown, false,
      "a persisted observation does not bypass manual hiding outside its scene");
    const sameScene = { ...nextDay, directObservationContext: sceneContext("scene-one", 3, [1, 2], nextDay.date) };
    const visibleAgain = fact(memory4.getCurrentDisclosures(scope, 2, sameScene), "trait_beauty_good_3");
    assert.equal(visibleAgain.status, "AUTO_DISCLOSED");
    assert.equal(visibleAgain.effectiveKnown, true);
    assert.equal(visibleAgain.currentDirectObservation, true);
    const absentObserver = { ...nextDay, directObservationContext: sceneContext("scene-one", 3, [2], nextDay.date) };
    assert.equal(fact(memory4.getCurrentDisclosures(scope, 2, absentObserver), "trait_beauty_good_3").status, "MANUAL_HIDDEN",
      "the scene override requires both observer and target to be present");

    const removed = gameData([visibleTrait, hiddenTrait], campaignToken, "1164.5.22");
    const removal = memory4.observeVisibleTraits(scope, 2, removed, { conversationId: "scene-one", messageBoundary: 5 });
    assert(removal.removedCurrentFactKeys.includes("trait_one_eyed"));
    assert(removal.diagnostics.some(row => row.reason === "visible_trait_removed_current"));
    assert.equal(fact(memory4.getCurrentDisclosures(scope, 2, removed), "trait_one_eyed"), undefined,
      "removed current traits do not remain in the current projection");
    const historical = memory4.getDisclosedFacts(scope, 2).find(row => row.factKey === "trait_one_eyed");
    assert(historical, "the prior direct observation remains durable history after current-truth removal");
    const reintroduced = gameData(undefined, campaignToken, "1164.5.23");
    memory4.refreshCurrentFactState(scope, reintroduced);
    assert.equal(fact(memory4.getCurrentDisclosures(scope, 2, reintroduced), "trait_one_eyed").effectiveKnown, false,
      "an observation from an expired fact epoch cannot authorize a reintroduced trait");

    const restarted = createMemory4(baseDir, summaryFoldersDir);
    const persisted = fact(restarted.getCurrentDisclosures(scope, 2, nextDay), "trait_beauty_good_3");
    assert.equal(persisted.status, "MANUAL_HIDDEN", "manual state and its observation proof survive restart");
    assert.equal(persisted.currentDirectObservation, false, "the active-scene marker is not persisted as a permanent flag");
    restarted.revokeProjectionDisclosures(scope, { conversationId: "scene-one", sourceMessageIds: [0], sourceSegmentIds: ["speech-only"] });
    assert(restarted.getDisclosedFacts(scope, 2).find(row => row.factKey === "trait_beauty_good_3")
      .evidenceBySource && Object.values(restarted.getDisclosedFacts(scope, 2).find(row => row.factKey === "trait_beauty_good_3")
        .evidenceBySource).some(proof => proof.sourceKind === "DIRECT_OBSERVATION"),
    "projection Forget does not delete independently supported observations");
    const otherOwnerScope = { campaignToken, ownerId: 3 };
    restarted.ensureDisclosureScope(otherOwnerScope);
    assert.equal(fact(restarted.getCurrentDisclosures(otherOwnerScope, 2, initial), "trait_beauty_good_3").effectiveKnown, false,
      "observation remains isolated to its Owner");
    assert.equal(fact(restarted.getCurrentDisclosures({ campaignToken: "other-campaign", ownerId: 1 }, 2,
      gameData(undefined, "other-campaign")), "trait_beauty_good_3").effectiveKnown, false,
    "observation remains isolated to its Campaign");
    console.log("V8.15.2 direct observation: PASS (visible-trait persistence, non-observable exclusion, scene-scoped manual-hide override, current epochs, history and isolation)");
  } finally {
    const targetPath = path.resolve(temporary);
    assert(targetPath.startsWith(path.resolve(__dirname) + path.sep));
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

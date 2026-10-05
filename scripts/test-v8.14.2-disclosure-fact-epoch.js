"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-fact-epoch-"));
const summaries = path.join(root, "summaries");
for (const id of [1, 2, 3]) fs.mkdirSync(path.join(summaries, `${id}_Fixture`), { recursive: true });
const coordinator = new Memory4Coordinator(new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: summaries }));
const scope = { campaignToken: "epoch-campaign", ownerId: 2 };
const target = { id: 1, fullName: "赵太初", primaryTitle: "明王", traits: [{ id: "bastard", name: "私生子" }] };
const owner = { id: 2, fullName: "张道素", traits: [] };
const data = (date, character = target, campaignToken = scope.campaignToken) => ({ campaignToken, date,
  characters: new Map([[1, character], [2, owner]]) });
const record = (date, letterId, current = target) => coordinator.recordLetterDisclosures({ ...scope, date,
  senderId: 1, recipientId: 2, letterId, text: "我乃明王，也是私生子。", characters: data(date, current).characters });
const row = (current, type = "TITLE") => coordinator.getCurrentDisclosures(scope, 1, current).find(item => item.factType === type);
const refresh = current => coordinator.refreshCurrentFactState?.(scope, current);

try {
  record("1164.1.1", "initial");
  assert.equal(row(data("1164.1.1")).effectiveKnown, true);
  refresh(data("1164.1.2", { ...target, primaryTitle: "None", traits: [] }));
  refresh(data("1164.1.3"));
  assert.equal(row(data("1164.1.3")).effectiveKnown, false, "a restored title must not revive prior disclosure");
  assert.equal(row(data("1164.1.3"), "TRAIT").effectiveKnown, false, "a restored trait must not revive prior disclosure");
  assert.equal(row(data("1164.1.3")).factEpoch, 2);
  record("1164.1.3", "initial");
  assert.equal(row(data("1164.1.3")).effectiveKnown, false, "the same old letter ID cannot be rebound to a new epoch or acquisition date");
  record("1164.1.3", "fresh-second-epoch");
  assert.equal(row(data("1164.1.3")).effectiveKnown, true);
  assert.equal(Object.values(row(data("1164.1.3")).evidenceBySource)[0].factEpoch, 2);
  const revision = coordinator.store.loadIndex(scope).revision;
  refresh(data("1164.1.3"));
  assert.equal(coordinator.store.loadIndex(scope).revision, revision, "repeat refresh must be idempotent");

  const manual = row(data("1164.1.3"));
  coordinator.updateManualDisclosure(scope, 1, manual, "MANUAL_KNOWN", data("1164.1.3"), { expectedRevision: manual.revision });
  refresh(data("1164.1.4", { ...target, primaryTitle: "None", traits: [] }));
  refresh(data("1164.1.5"));
  assert.equal(row(data("1164.1.5")).effectiveKnown, false, "MANUAL_KNOWN belongs to its fact epoch");
  const hiddenRef = row(data("1164.1.5"));
  coordinator.deleteDisclosure(scope, 1, hiddenRef, data("1164.1.5"), { expectedRevision: hiddenRef.revision });
  refresh(data("1164.1.6", { ...target, primaryTitle: "None", traits: [] }));
  refresh(data("1164.1.7"));
  record("1164.1.7", "fresh-hidden");
  assert.equal(row(data("1164.1.7")).status, "MANUAL_HIDDEN", "manual hiding spans epochs");

  const stateBefore = coordinator.store.readKnownEntities(scope).currentFactState;
  refresh(data("1164.1.4", { ...target, primaryTitle: "None", traits: [] }));
  assert.deepEqual(coordinator.store.readKnownEntities(scope).currentFactState, stateBefore, "old runtime snapshots cannot roll back state");
  refresh({ ...data("1164.1.8"), characters: new Map([[2, owner]]) });
  assert.equal(row(data("1164.1.8")).factEpoch, 4, "a missing DTO is not an absent fact");
  const beforeRead = coordinator.store.loadIndex(scope).revision;
  coordinator.getCurrentDisclosures(scope, 1, data("1164.1.9", { ...target, traits: [] }));
  assert.equal(coordinator.store.loadIndex(scope).revision, beforeRead, "UI/read getters must be side-effect free");
  assert.equal(coordinator.getCurrentDisclosures({ ...scope, campaignToken: "other-campaign" }, 1, data("1164.1.9", target, "other-campaign"))[0].effectiveKnown, false);

  // Simulate legacy records created before epochs, without touching real data.
  const legacyScope = { campaignToken: "legacy-epoch", ownerId: 2 };
  coordinator.recordLetterDisclosures({ ...legacyScope, date: "1164.1.1", senderId: 1, recipientId: 2,
    letterId: "legacy", text: "我乃明王。", characters: data("1164.1.1").characters });
  const directory = coordinator.store.directory(legacyScope);
  const known = coordinator.store.readKnownEntities(legacyScope);
  delete known.currentFactState;
  for (const fact of Object.values(known.entities[1].disclosedFacts)) {
    for (const proof of Object.values(fact.evidenceBySource)) delete proof.factEpoch;
  }
  fs.writeFileSync(path.join(directory, "known-entities.json"), JSON.stringify(known));
  coordinator.refreshCurrentFactState(legacyScope, data("1164.1.2", target, legacyScope.campaignToken));
  assert.equal(coordinator.getCurrentDisclosures(legacyScope, 1, data("1164.1.2", target, legacyScope.campaignToken))[0].effectiveKnown, true);
  coordinator.refreshCurrentFactState(legacyScope, data("1164.1.3", { ...target, primaryTitle: "None" }, legacyScope.campaignToken));
  coordinator.refreshCurrentFactState(legacyScope, data("1164.1.4", target, legacyScope.campaignToken));
  assert.equal(coordinator.getCurrentDisclosures(legacyScope, 1, data("1164.1.4", target, legacyScope.campaignToken))[0].effectiveKnown, false);
  console.log("PASS V8.14.2 fact epochs: continuity, reappearance, manual priority, migration, isolation, stale snapshots and pure reads");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

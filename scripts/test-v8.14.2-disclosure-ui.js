"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const memorySystem = require("../resources/app/out/main/memory-system");

const root = path.join(__dirname, "..");
const managerSource = fs.readFileSync(path.join(root, "resources/app/out/main/summaries/summaries-manager.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "resources/app/out/renderer/memory4-manager.js"), "utf8");
const rendererCss = fs.readFileSync(path.join(root, "resources/app/out/renderer/memory4-manager.css"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "resources/app/out/preload/preload.js"), "utf8");
const ipcSource = fs.readFileSync(path.join(root, "resources/app/out/main/ipc/register-ipc.js"), "utf8");

assert(managerSource.includes("updateManualDisclosure(scope, entityId,"),
  "Memory4 mutation must use the owner-scoped manual disclosure API");
assert(managerSource.includes("deleteDisclosure(scope, entityId,"),
  "Memory4 mutation must support disclosure removal through the scoped store");
assert(managerSource.includes("expectedRevision"), "disclosure writes must preserve the candidate revision gate");
assert(/已知头衔|头衔/.test(rendererSource));
assert(/已知特质|特质/.test(rendererSource));
assert(/获知日期|获知时间/.test(rendererSource));
assert(rendererSource.includes("对话公开"));
assert(rendererSource.includes("MANUAL_HIDDEN"));
assert(rendererSource.includes("MANUAL_KNOWN"));
assert(rendererSource.includes("disclosedFacts"));
assert(rendererSource.includes("披露时年龄"));
assert(rendererSource.includes("历史披露记录"));
assert(rendererSource.includes('fact.factType !== "AGE" && !data.readOnlyArchive'), "historical ages must not expose current/manual fact controls");
assert(rendererSource.includes("readOnlyArchive"), "archive cognition must retain the existing read-only control gate");
assert(preloadSource.includes('mutateMemory4: (request) => electron.ipcRenderer.invoke("memory4:mutate", request)'),
  "disclosure changes should reuse the existing Memory4 IPC bridge");
assert(ipcSource.includes('["memory4:mutate", "mutateMemory4"]'),
  "disclosure changes should reuse the existing validated Memory4 mutation channel");
assert(rendererCss.includes(".memory4-disclosure-row"), "disclosure rows need responsive layout rules");

(async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-disclosure-ui-"));
  try {
    const fixture = await createMemoryUiFixture(profileDir);
    const { engine, scope, summariesDir, conversation } = fixture;
    const target = conversation.gameData.characters.get(1);
    target.primaryTitle = "明王";
    target.nickname = "北地之虎";
    target.traits = [{ category: "personality", name: "私生子", desc: "私生子" }];
    const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
      getCurrentConversation: () => conversation, requestSummary: async () => { throw new Error("disclosure UI must not call a model"); } });
    const request = { ownerId: scope.ownerId, expectedCampaignToken: scope.campaignToken, expectedContextId: conversation.id };
    const data = await manager.getMemory4OwnerData(request);
    const profile = data.known.items.find(item => item.entityId === 1);
    assert.equal(profile.nickname, "北地之虎", "Nickname must remain visible independently of title knowledge");
    assert(Array.isArray(profile.disclosedFacts), "the known profile must expose the owner's current candidates");
    const title = profile.disclosedFacts.find(fact => fact.factType === "TITLE" && fact.value === "明王");
    const trait = profile.disclosedFacts.find(fact => fact.factType === "TRAIT" && fact.value === "私生子");
    assert(title && trait, "exact current title and trait candidates must be available to the UI");
    assert.equal(title.effectiveKnown, false);
    assert.equal(title.revision, 0);

    const factRef = { factType: title.factType, factKey: title.factKey, value: title.value };
    const marked = await manager.mutateMemory4({ ...request, operation: "setManualDisclosure", entityId: 1, factRef,
      status: "MANUAL_KNOWN", expectedRevision: title.revision });
    assert.equal(marked.success, true);
    const current = engine.memory4.getCurrentDisclosures(scope, 1, conversation.gameData).find(fact => fact.factKey === title.factKey);
    assert.equal(current.status, "MANUAL_KNOWN");
    assert.equal(current.effectiveKnown, true);

    await assert.rejects(manager.mutateMemory4({ ...request, operation: "deleteDisclosure", entityId: 1, factRef,
      expectedRevision: title.revision }), /revision|stale|changed/i, "a stale UI revision must not overwrite a newer choice");
    const hiddenResult = await manager.mutateMemory4({ ...request, operation: "deleteDisclosure", entityId: 1, factRef,
      expectedRevision: current.revision });
    assert.equal(hiddenResult.success, true);
    const hidden = engine.memory4.getCurrentDisclosures(scope, 1, conversation.gameData).find(fact => fact.factKey === title.factKey);
    assert.equal(hidden.status, "MANUAL_HIDDEN", "deleting a disclosure must preserve a hidden tombstone");
    assert.equal(hidden.effectiveKnown, false);
    const restoredResult = await manager.mutateMemory4({ ...request, operation: "setManualDisclosure", entityId: 1, factRef,
      status: "MANUAL_KNOWN", expectedRevision: hidden.revision });
    assert.equal(restoredResult.success, true);
    const restored = engine.memory4.getCurrentDisclosures(scope, 1, conversation.gameData).find(fact => fact.factKey === title.factKey);
    assert.equal(restored.effectiveKnown, true);
    conversation.isActive = false;
    await assert.rejects(manager.mutateMemory4({ ...request, operation: "deleteDisclosure", entityId: 1, factRef,
      expectedRevision: restored.revision }), /conversation_not_active/i, "an archive must stay read-only at the manager boundary");
    const afterArchiveAttempt = engine.memory4.getCurrentDisclosures(scope, 1, conversation.gameData).find(fact => fact.factKey === title.factKey);
    assert.equal(afterArchiveAttempt.status, "MANUAL_KNOWN", "rejected archive mutations must not alter the disclosure record");
    const archiveData = await manager.getMemory4OwnerData(request);
    const archivedProfile = archiveData.known.items.find(item => item.entityId === 1);
    const archivedFact = archivedProfile.disclosedFacts.find(fact => fact.factKey === title.factKey);
    assert.equal(archivedFact.current, false, "archive readback must not claim saved disclosure is a current truth");
    assert.equal(archivedFact.status, "MANUAL_KNOWN");
    console.log("V8.14.2 disclosure UI contract: PASS (candidate display, nickname, manual fact scope, revision conflict and archive read-only)");
  } finally {
    const targetPath = path.resolve(profileDir);
    assert(targetPath.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

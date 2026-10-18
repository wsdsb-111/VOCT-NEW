"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");

const root = fs.mkdtempSync(path.resolve(__dirname, "../.build/v9391-disclosure-store-"));
try {
  const characters = new Map([
    [1, { id: 1, shortName: "阿甲", traits: [{ traitId: "witch", name: "巫师" }], primaryTitle: "公爵" }],
    [2, { id: 2, shortName: "阿乙", traits: [{ traitId: "brave", name: "勇敢" }], knownSecrets: [] }],
    [3, { id: 3, shortName: "阿丁", traits: [], knownSecrets: [] }],
    [999, { id: 999, shortName: "场外人物", traits: [] }]
  ]);
  const data = { playerID: 1, date: "1200.1.1", totalDays: 100, campaignToken: "pair-campaign", characters };
  const conversation = { id: "pair-scene", conversationEpoch: 1, isActive: true, selectedCharacterIds: new Set([2, 3]), gameData: data,
    messages: [], departedCharacterIds: new Set(), inactiveParticipantIds: new Map() };
  const create = () => new ConversationDisclosureStore({ dataDir: root, getCurrentConversation: () => conversation });
  let service = create();
  assert.deepEqual(service.getConversationView().participants.map(person => person.runtimeId), ["1", "2", "3"]);
  assert.throws(() => service.getOwnerView({ ownerRuntimeId: 999 }), /pair_unavailable/);
  const target = (ownerRuntimeId, targetRuntimeId) => service.getTargetView({ ...service.getOwnerView({ ownerRuntimeId }).scope, targetRuntimeId });
  assert.throws(() => target(2, 999), /pair_unavailable/);
  assert.throws(() => target(2, 2), /pair_unavailable/);
  assert.equal(target(2, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false);
  assert.equal(target(2, 1).facts.find(fact => fact.factType === "TITLE").effectiveKnown, false, "no realm-derived automatic title disclosure");
  const manual = (owner, status) => {
    const view = target(owner, 1);
    const fact = view.facts.find(entry => entry.factKey === "trait_witch");
    return service.setManualStatus({ ...view.scope, factType: fact.factType, factKey: fact.factKey,
      factSourceSnapshotId: fact.factSourceSnapshotId, expectedRevision: fact.revision, status });
  };
  manual(2, "MANUAL_KNOWN");
  service = create();
  assert.equal(target(2, 1).facts.find(fact => fact.factKey === "trait_witch").status, "MANUAL_KNOWN", "restart retains directed manual disclosure");
  assert.equal(target(3, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false, "A -> B never grants C");
  const context = owner => buildCharacterDisclosureContext({ service, gameData: data, responderId: owner, targetIds: [1, 2, 3] });
  const traits = owner => createTraitProfileView(data, characters.get(owner), context(owner)).gameData.characters.get(1).traits;
  assert.equal(traits(2).length, 1);
  assert.equal(traits(3).length, 0);
  characters.get(2).knownSecrets = [{ ownerId: 1, type: "secret_witch" }];
  manual(2, "MANUAL_HIDDEN");
  assert.equal(traits(2).length, 0, "manual hidden continues to override original knownSecrets proof");
  const stale = target(2, 1);
  const staleFact = stale.facts.find(fact => fact.factKey === "trait_witch");
  manual(2, "MANUAL_KNOWN");
  assert.throws(() => service.setManualStatus({ ...stale.scope, factType: "TRAIT", factKey: staleFact.factKey,
    factSourceSnapshotId: staleFact.factSourceSnapshotId, expectedRevision: staleFact.revision, status: "MANUAL_HIDDEN" }), /revision_conflict/);

  // Use a fresh state to verify evidence ACL independently of the manual path.
  service = new ConversationDisclosureStore({ dataDir: path.join(root, "spoken"), getCurrentConversation: () => conversation });
  characters.get(2).knownSecrets = [];
  const sourceContext = () => ({ conversationId: conversation.id, campaignToken: data.campaignToken, date: data.date,
    participants: [1, 2, 3].map(id => ({ id, name: characters.get(id).shortName })), messages: conversation.messages,
    participantPresence: [1, 2, 3].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })) });
  conversation.messages.push({ id: 1, role: "user", speakerCharacterId: 1, name: "阿甲", content: "只对阿乙低声说：“我是巫师。”" });
  assert(service.recordConversation({ conversation, context: sourceContext() }).recorded > 0, "verified whisper is extracted");
  assert.equal(target(2, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, true);
  assert.equal(target(3, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false, "bystander does not hear a whisper");
  assert.equal(service.recordConversation({ conversation, context: sourceContext() }).recorded, 0, "source replay is idempotent");
  conversation.messages.push({ id: 2, role: "assistant", speakerCharacterId: 2, name: "阿乙", content: "阿甲是巫师。" });
  service.recordConversation({ conversation, context: sourceContext() });
  assert.equal(target(3, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, true, "a knowledgeable speaker may explicitly relay a fact");
  characters.get(1).traits[0].name = "秘法师";
  assert.equal(target(2, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false, "changed fact content invalidates old automatic proof");
  characters.get(1).traits[0].name = "巫师";
  conversation.messages[0].content = "今天天气很好。";
  assert.equal(target(2, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false, "edited source is rejected before next transport");
  assert.equal(target(3, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false, "a relay cannot outlive its edited knowledge source");
  service.recordConversation({ conversation, context: sourceContext() });
  conversation.id = "next-scene";
  conversation.messages = [];
  assert.equal(target(2, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false, "old edited evidence never revives across scenes");

  const before = service.getOwnerView({ ownerRuntimeId: 2 });
  data.campaignToken = "different-campaign";
  assert.throws(() => service.getTargetView({ ...before.scope, targetRuntimeId: 1 }), /campaign_changed/);
  assert.equal(target(2, 1).facts.find(fact => fact.factKey === "trait_witch").effectiveKnown, false);
  data.campaignToken = "pair-campaign";
  // The complete message -> extraction -> persistence -> UI/Prompt path must
  // retain the names and titles that previously disappeared, for every hearer.
  service = new ConversationDisclosureStore({ dataDir: path.join(root, "identity"), getCurrentConversation: () => conversation });
  conversation.id = "public-introduction";
  characters.get(1).nickname = "铁腕";
  conversation.selectedCharacterIds.add(999);
  conversation.presentCharacterIds = new Set([2, 3]);
  conversation.messages = [{ id: 10, role: "user", speakerCharacterId: 1, name: "阿甲",
    content: "我叫阿甲，人称我铁腕，如今是公爵。" }];
  const publicContext = () => ({ ...sourceContext(), participants: [1, 2, 3, 999].map(id => ({ id, name: characters.get(id).shortName })),
    participantPresence: [...sourceContext().participantPresence, { characterId: 999, joinedAtMessageId: 100, leftAtMessageId: null }] });
  service.recordConversation({ conversation, context: publicContext() });
  for (const owner of [2, 3]) {
    const view = target(owner, 1);
    for (const factType of ["NAME", "TITLE", "NICKNAME"]) assert(view.facts.some(fact => fact.factType === factType && fact.hasDisclosureRecord),
      `the public introduction persists ${factType} for each actual listener`);
    const projected = createTraitProfileView(data, characters.get(owner), context(owner)).gameData.characters.get(1);
    assert.equal(projected.primaryTitle, "公爵", "a recorded current title actually reaches the intended listener's Prompt");
  }
  const waiting = target(999, 1);
  assert.equal(waiting.facts.some(fact => ["NAME", "TITLE"].includes(fact.factType) && fact.effectiveKnown), false,
    "a waiting participant does not inherit another pair's public introduction");
  assert.equal(waiting.facts.find(fact => fact.factType === "NICKNAME").source, "PUBLIC_NICKNAME",
    "a nickname stays on the public whitelist independently of recorded disclosure");
  characters.get(2).primaryTitle = "伯爵";
  conversation.messages.push({ id: 11, role: "assistant", speakerCharacterId: 2, name: "阿乙", content: "我叫阿乙。我的头衔是伯爵。" });
  service.recordConversation({ conversation, context: publicContext() });
  service = new ConversationDisclosureStore({ dataDir: path.join(root, "identity"), getCurrentConversation: () => conversation });
  for (const factType of ["NAME", "TITLE"]) assert(target(3, 2).facts.some(fact => fact.factType === factType && fact.hasDisclosureRecord),
    `NPC -> NPC ${factType} survives restart`);
  assert.equal(target(2, 3).facts.some(fact => fact.hasDisclosureRecord), false, "disclosure is not automatically reversed");
  // Enumeration traps verify pair reads do not depend on total character count.
  data.characters = new Proxy(characters, { get(map, key) {
    if (["keys", "values", "entries"].includes(key) || key === Symbol.iterator) throw new Error("whole_roster_scan");
    const value = Reflect.get(map, key, map);
    return typeof value === "function" ? value.bind(map) : value;
  } });
  target(2, 1);
  context(2);
  service.getConversationView();
  conversation.isActive = false;
  assert.equal(service.getConversationView().available, false);
  assert.throws(() => service.getOwnerView({ ownerRuntimeId: 2 }), /conversation_unavailable/);
  console.log("V9.3.9.1 pair disclosure store: PASS (ACL, persistence, Prompt, source/revision and bounded lookup)");
} finally {
  assert(path.dirname(root) === path.resolve(__dirname, "../.build"));
  fs.rmSync(root, { recursive: true, force: true });
}

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getAutomaticTraitAccess, createTraitProfileView } = require("../src/app/main/prompts/trait-profile-selector");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");

const CAMPAIGN = "v9.3.9.1-independent-qa";
const DATE = "1190.5.2";
const SNAPSHOT = `${DATE}/100`;
const root = fs.mkdtempSync(path.resolve(__dirname, "../.build/v9391-independent-qa-"));

function directProof(childId, parentId, patch = {}) {
  return {
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: childId,
    childId,
    parentId,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    ...patch
  };
}

function otherParent(childId, parentId, sourceOwnerId, patch = {}) {
  return {
    id: parentId,
    parentId,
    otherParentId: parentId,
    childId,
    sourceOwnerId,
    relationType: "parent",
    source: "CK3_OTHER_PARENT",
    sourceRelation: "kids.otherParent",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    ...patch
  };
}

function familyFixture() {
  const father = { id: 1, children: [] };
  const mother = { id: 2, traits: [] };
  const child = { id: 3, traits: [{ traitId: "witch", name: "巫师" }],
    parents: [{ id: 1, ...directProof(3, 1) }] };
  father.children = [{ id: 3, directParentEvidence: directProof(3, 1),
    otherParent: otherParent(3, 2, 1) }];
  return { father, mother, child, gameData: { campaignToken: CAMPAIGN, date: DATE, totalDays: 100,
    characters: new Map([[1, father], [2, mother], [3, child]]) } };
}

function testStepEvidenceCannotUpgradeParentAccess() {
  const baseline = familyFixture();
  assert.equal(getAutomaticTraitAccess(baseline.father, baseline.child, baseline.gameData).source, "PUBLIC_CLOSE_FAMILY");

  const mutations = [
    ["outer parent reference", fixture => { fixture.child.parents[0].relationshipKind = "STEP"; }],
    ["nested proof", fixture => {
      fixture.child.parents[0] = { id: fixture.father.id, directParentEvidence: directProof(fixture.child.id, fixture.father.id, { parentage: "STEP" }) };
    }],
    ["other-parent row", fixture => { fixture.father.children[0].otherParent.kinshipType = "STEP"; }],
    ["conflicting duplicate direct proof", fixture => {
      fixture.father.evidence = { relations: [{ ownerId: fixture.child.id, relationType: "parent",
        kind: "STEP", directParentEvidence: directProof(fixture.child.id, fixture.father.id) }] };
    }]
  ];
  for (const [label, mutate] of mutations) {
    const fixture = familyFixture();
    mutate(fixture);
    const observer = label === "other-parent row" ? fixture.mother : fixture.father;
    assert.deepEqual(getAutomaticTraitAccess(observer, fixture.child, fixture.gameData), { source: null, traitKeys: [] },
      `${label} cannot override or supplement valid direct-parent evidence`);
  }
}

function conversationFixture(directory, { campaignToken = CAMPAIGN, id = "scene-one" } = {}) {
  const characters = new Map([
    [1, { id: 1, shortName: "甲", firstName: "甲", fullName: "甲真名", nickname: "铁腕", primaryTitle: "公爵",
      traits: [{ traitId: "witch", name: "巫师" }], knownSecrets: [] }],
    [2, { id: 2, shortName: "乙", firstName: "乙", fullName: "乙", traits: [], knownSecrets: [] }],
    [3, { id: 3, shortName: "丙", firstName: "丙", fullName: "丙", traits: [], knownSecrets: [] }],
    [4, { id: 4, shortName: "丁", firstName: "丁", fullName: "丁", traits: [], knownSecrets: [] }],
    [999, { id: 999, shortName: "场外", fullName: "场外", traits: [], knownSecrets: [] }]
  ]);
  const data = { playerID: 1, date: DATE, totalDays: 100, campaignToken, characters };
  const conversation = { id, conversationEpoch: 1, isActive: true, selectedCharacterIds: new Set([2, 3, 4]),
    presentCharacterIds: new Set([2, 3]), temporarilyAbsentCharacterIds: new Set(), departedCharacterIds: new Set(),
    inactiveParticipantIds: new Map(), gameData: data, messages: [] };
  const store = new ConversationDisclosureStore({ dataDir: directory, getCurrentConversation: () => conversation });
  const sourceContext = () => ({ conversationId: conversation.id, campaignToken: data.campaignToken, date: data.date,
    participants: [...characters.values()].map(person => ({ id: person.id, name: person.shortName, fullName: person.fullName })),
    messages: conversation.messages,
    participantPresence: [1, 2, 3, 4].map(characterId => ({ characterId, joinedAtMessageId: characterId === 4 ? 20 : 0,
      leftAtMessageId: null })) });
  const record = () => store.recordConversation({ conversation, context: sourceContext() });
  const targetView = (ownerRuntimeId, targetRuntimeId) => store.getTargetView({ ownerRuntimeId, targetRuntimeId });
  const known = (ownerRuntimeId, targetRuntimeId, factKey) => store.getDisclosureProfile({ campaignToken: data.campaignToken,
    ownerRuntimeId, targetRuntimeId }).facts.some(fact => fact.factKey === factKey && fact.effectiveKnown);
  return { characters, data, conversation, store, sourceContext, record, targetView, known };
}

function testOwnerIsolationAndManualRevision() {
  const fixture = conversationFixture(path.join(root, "owner"));
  const { characters, data, conversation, store, targetView, known } = fixture;
  characters.get(2).knownSecrets = [{ ownerId: 1, type: "secret_witch" }];
  assert.equal(known(2, 1, "trait_witch"), true, "the original Owner -> Target knownSecrets proof remains usable");
  assert.equal(known(3, 1, "trait_witch"), false, "a second Owner cannot borrow the first Owner's knownSecrets");

  const contextFor = ownerRuntimeId => buildCharacterDisclosureContext({ service: store, gameData: data,
    responderId: ownerRuntimeId, targetIds: [1] });
  const visibleTraits = ownerRuntimeId => createTraitProfileView(data, characters.get(ownerRuntimeId), contextFor(ownerRuntimeId))
    .gameData.characters.get(1).traits.map(trait => trait.traitId);
  assert.deepEqual(visibleTraits(2), ["witch"], "the Owner's native directed proof reaches that NPC's Prompt");
  assert.deepEqual(visibleTraits(3), [], "another NPC's Prompt does not inherit the directed proof");

  const staleOwnerThreeView = targetView(3, 1);
  const setStatus = (ownerRuntimeId, targetRuntimeId, status, view = targetView(ownerRuntimeId, targetRuntimeId)) => {
    const fact = view.facts.find(row => row.factKey === "trait_witch");
    return store.setManualStatus({ ...view.scope, factType: fact.factType, factKey: fact.factKey,
      factSourceSnapshotId: fact.factSourceSnapshotId, expectedRevision: fact.revision, status });
  };
  setStatus(2, 1, "MANUAL_HIDDEN");
  assert.equal(known(2, 1, "trait_witch"), false, "Owner-specific manual hide revokes an otherwise valid native proof");
  assert.equal(known(3, 1, "trait_witch"), false, "the manual hide is not written onto another Owner's pair");
  setStatus(3, 1, "MANUAL_KNOWN");
  assert.deepEqual(visibleTraits(2), [], "the hidden Owner remains hidden after the other Owner opts in");
  assert.deepEqual(visibleTraits(3), ["witch"], "the second Owner's own manual disclosure reaches only that Prompt");
  assert.throws(() => setStatus(3, 1, "MANUAL_HIDDEN", staleOwnerThreeView), /revision_conflict/,
    "an older Pair revision cannot overwrite a later manual status");

  const oldScope = targetView(2, 1).scope;
  conversation.id = "scene-two";
  assert.throws(() => targetView(2, 1) && store.getTargetView({ ...oldScope, targetRuntimeId: 1 }), /conversation_changed/,
    "a saved current-scene view cannot be reused after the conversation changes");
  assert.equal(targetView(2, 1).facts.find(row => row.factKey === "trait_witch").status, "MANUAL_HIDDEN",
    "campaign and Pair state survives scene changes without reusing the old scene token");
}

function testListenersAndRelayRevocation() {
  const fixture = conversationFixture(path.join(root, "relay"));
  const { characters, conversation, store, sourceContext, record, known } = fixture;
  conversation.messages.push({ id: 10, role: "user", speakerCharacterId: 1, name: "甲",
    content: "只对乙低声说：“我是巫师。”" });
  conversation.messages.push({ id: 11, role: "assistant", speakerCharacterId: 2, name: "乙", content: "甲是巫师。" });
  record();
  assert.equal(known(2, 1, "trait_witch"), true, "the private source reaches its named listener");
  assert.equal(known(3, 1, "trait_witch"), true, "a listener who learned the fact may relay it in this scene");
  assert.equal(known(4, 1, "trait_witch"), false, "a participant joining after both source messages gains no history");

  conversation.messages[0].content = "只对乙低声说：“今天天气很好。”";
  record();
  assert.equal(known(2, 1, "trait_witch"), false, "editing the original disclosure revokes its direct proof");
  assert.equal(known(3, 1, "trait_witch"), false, "editing the original disclosure revokes the dependent relay");

  conversation.messages = [conversation.messages[1]];
  record();
  assert.equal(known(3, 1, "trait_witch"), false, "deleting the original source cannot revive a relay");
}

function testCurrentRequestTargetsAndIdentitySignature() {
  const fixture = conversationFixture(path.join(root, "identity"));
  const { characters, data, conversation, store, record } = fixture;
  conversation.messages.push({ id: 10, role: "user", speakerCharacterId: 1, name: "甲",
    content: "我叫甲真名，如今是公爵，人称我铁腕。" });
  record();

  const targetCalls = [];
  const countedStore = { getDisclosureProfile(payload) {
    targetCalls.push([Number(payload.ownerRuntimeId), Number(payload.targetRuntimeId)]);
    return store.getDisclosureProfile(payload);
  } };
  const build = () => buildCharacterDisclosureContext({ service: countedStore, gameData: data, responderId: 2,
    targetIds: [3, 1, 3, 2, 0, "invalid"] });
  const initial = build();
  assert.deepEqual(targetCalls, [[2, 1], [2, 3]], "the current request queries only its deduplicated explicit targets for this responder");
  assert.deepEqual(initial.disclosureTargetIds, [1, 3], "the returned query scope cannot expand to unrequested participants or the roster");
  const identityFacts = initial.disclosureProfiles.get(1);
  assert(identityFacts.some(fact => fact.factType === "NAME" && fact.value === "甲真名" && fact.effectiveKnown),
    "the current, heard name claim enters the responder's scoped Prompt facts");
  assert(identityFacts.some(fact => fact.factType === "NICKNAME" && fact.value === "铁腕" && fact.effectiveKnown),
    "the public nickname is a distinct Prompt fact");
  const initialRevision = initial.characterKnowledgeRevision;

  conversation.messages[0].content = "我今日不愿报出姓名，如今是公爵，人称我铁腕。";
  record();
  const withoutName = build();
  assert.equal(withoutName.disclosureProfiles.get(1).some(fact => fact.factType === "NAME" && fact.effectiveKnown), false,
    "an edited name claim is absent from the next request context");
  assert.notEqual(withoutName.characterKnowledgeRevision, initialRevision,
    "the before-send knowledge signature changes when NAME evidence is revoked");

  characters.get(1).nickname = "雄狮";
  const renamedNickname = build();
  const nicknameFacts = renamedNickname.disclosureProfiles.get(1).filter(fact => fact.factType === "NICKNAME");
  assert.deepEqual(nicknameFacts.map(fact => fact.value), ["雄狮"], "the current public nickname replaces the stale value");
  assert.notEqual(renamedNickname.characterKnowledgeRevision, withoutName.characterKnowledgeRevision,
    "a public NICKNAME candidate change updates the same pre-send signature");

  const invalidScopeService = { getDisclosureProfile(payload) {
    const profile = store.getDisclosureProfile(payload);
    if (Number(payload.targetRuntimeId) === 3) return { ...profile,
      scope: { ...profile.scope, ownerRuntimeId: 999 } };
    return profile;
  } };
  const invalidScope = buildCharacterDisclosureContext({ service: invalidScopeService, gameData: data, responderId: 2, targetIds: [1, 3] });
  assert.equal(invalidScope.disclosureProfiles.has(3), false, "a profile returned for another Owner is blocked");

  const rawCharacters = data.characters;
  data.characters = new Proxy(rawCharacters, { get(target, property) {
    if (["keys", "values", "entries", Symbol.iterator].includes(property)) throw new Error("whole_roster_scan");
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  assert(build().characterKnowledgeRevision, "the live disclosure path uses bounded Map.get access, not full-roster enumeration");
}

try {
  testStepEvidenceCannotUpgradeParentAccess();
  testOwnerIsolationAndManualRevision();
  testListenersAndRelayRevocation();
  testCurrentRequestTargetsAndIdentitySignature();
  console.log("V9.3.9.1 independent QA: PASS (STEP denial, Owner ACL/revision, audience/relay revocation, current targets and identity signature)");
} finally {
  assert.equal(path.dirname(root), path.resolve(__dirname, "../.build"));
  fs.rmSync(root, { recursive: true, force: true });
}

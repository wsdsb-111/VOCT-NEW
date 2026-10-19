"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = {
  id: versionPath,
  filename: versionPath,
  loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" }
};

const { Character } = require("../src/app/main/game-data/character");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { buildFamilyFactBlock } = require("../src/app/main/worldline/character-family-facts");

const TokenCounter = {
  estimateTokens: value => Math.ceil(String(value ?? "").length / 4),
  estimateMessageTokens: message => Math.ceil(String(message?.content ?? "").length / 4),
  calculateTotalTokens: messages => (messages || []).reduce((total, message) => total + Math.ceil(String(message?.content ?? "").length / 4), 0)
};

const GameData = createGameData({
  fs,
  path,
  memorySystem: {},
  summariesDir: "",
  getHistoricalReferenceByYear: () => null
});

const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V9.3.9.2 synthetic kinship prompt",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true }
    ],
    suffix: { enabled: false }
  }),
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: false }),
  getChatPromptV813Layout: () => true
};

const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(template) {
      return String(template ?? "");
    }
  },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "", resolvePath: value => value },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => String(value ?? ""),
  defaultChatInstruction: ""
});

const CAMPAIGN = "v9392-kinship-campaign";
const DATE = "1190年5月2日";
const TOTAL_DAYS = 106575;
const SNAPSHOT = `${DATE}/${TOTAL_DAYS}`;

function makeCharacter(id, name, age, gender = "male", extra = {}) {
  const row = Array(28).fill("");
  row[0] = String(id);
  row[1] = name;
  row[2] = name;
  row[4] = gender === "female" ? "she" : "he";
  row[5] = age == null ? "" : String(age);
  const character = new Character(row);
  character.ageSource = age == null ? null : "CK3_CURRENT_AGE";
  character.birthDate = extra.birthDate ?? null;
  character.alive = true;
  Object.assign(character, extra);
  return character;
}

function makeGameData(characters, { playerId = 1, responderId = 2 } = {}) {
  const player = characters.find(character => Number(character.id) === playerId);
  const responder = characters.find(character => Number(character.id) === responderId);
  const gameData = new GameData([
    playerId,
    player?.fullName || "玩家",
    responderId,
    responder?.fullName || "回应者",
    DATE,
    "___________talk_scene",
    "",
    "",
    TOTAL_DAYS
  ]);
  gameData.date = DATE;
  gameData.totalDays = TOTAL_DAYS;
  gameData.campaignToken = CAMPAIGN;
  gameData.relationFingerprint = "v9392-synthetic-relation-revision";
  gameData.characters = new Map(characters.map(character => [Number(character.id), character]));
  return gameData;
}

function redactCurrentDemographics(gameData) {
  const characters = [...gameData.characters.values()].map(character => {
    const projected = Object.assign(Object.create(Object.getPrototypeOf(character)), character);
    projected.age = null;
    projected.ageSource = null;
    projected.birthDate = null;
    projected.birth = null;
    projected.birthDateTotalDays = null;
    projected.birthTotalDays = null;
    return projected;
  });
  return makeGameData(characters);
}

function makeCache() {
  return { conversation: null, responders: new Map(), prefixByResponder: new Map() };
}

function buildPrompt(characters, {
  responderId = 2,
  activeParticipantIds = characters.map(character => Number(character.id)),
  mentionedIds = null,
  userQuery = "请按当前关系回应。",
  subjectiveWorldPolicyActive = true
} = {}) {
  const gameData = makeGameData(characters, { responderId });
  if (mentionedIds) gameData.findMentionedCharacterIdsInHistory = () => new Set(mentionedIds);
  const responder = gameData.characters.get(responderId);
  const result = PromptBuilder.buildMessagesWithTokenCount([
    { role: "user", content: mentionedIds ? "我想起了第三位人物。" : userQuery }
  ], responder, gameData, "", {
    activeParticipantIds,
    subjectiveWorldPolicyActive,
    cacheV2FrozenSnapshots: makeCache()
  });
  const block = id => result.blocks.find(entry => entry.block?.id === id)?.content || "";
  return {
    result,
    relationship: block("live-relationships") || block("active-participant-relationship"),
    responderFacts: block("responder-game-facts"),
    familyFacts: block("responder-family-facts"),
    allPromptText: result.messages.map(message => message.content).join("\n")
  };
}

function testUncleSeniorityUsesPublicFatherAge() {
  const player = makeCharacter(1, "玩家甲", 9);
  const uncle = makeCharacter(2, "叔父乙", 40);
  const father = makeCharacter(3, "父亲丙", 50);
  const grandparent = makeCharacter(4, "祖父丁", 70);
  addPublicParent(player, father);
  addPublicParent(father, grandparent);
  addPublicParent(uncle, grandparent);
  Object.assign(player.parents[0], {
    age: father.age,
    ageSource: father.ageSource,
    siblings: [{ id: uncle.id, name: uncle.fullName, gender: "male" }]
  });
  uncle.siblings.push({ id: father.id, name: father.fullName, gender: "male" });

  const prompt = buildPrompt([player, uncle, father, grandparent], { activeParticipantIds: [1, 2] });
  assert.match(prompt.relationship, /叔父乙是玩家甲的叔父/u,
    "an uncle is ranked against the public parent on the relation path, not the child");
  assert.doesNotMatch(prompt.relationship, /伯父/u,
    "the aunt/uncle label uses the graph reference father's age even when he is not an active speaker");
}

function testVerifiedBirthOrdinalBreaksEqualAgeTieOnly() {
  const older = makeCharacter(1, "年长者甲", 9, "male", { birthDateTotalDays: 5000 });
  const younger = makeCharacter(2, "年幼者乙", 9, "male", { birthDateTotalDays: 5100 });
  const parent = makeCharacter(3, "共同父母丙", 38);
  addPublicParent(older, parent);
  addPublicParent(younger, parent);
  older.siblings.push({ id: younger.id, name: younger.fullName, gender: "male" });
  younger.siblings.push({ id: older.id, name: older.fullName, gender: "male" });
  const ordered = buildPrompt([older, younger, parent], { activeParticipantIds: [1, 2] }).relationship;
  assert.match(ordered, /年长者甲年长于年幼者乙/u, "verified current birth ordinals may break a same-age tie without showing dates");
  assert.match(ordered, /年长者甲是年幼者乙的哥哥/u);

  const uncertainOlder = makeCharacter(1, "人物甲", 9);
  const uncertainYounger = makeCharacter(2, "人物乙", 11);
  const uncertainParent = makeCharacter(3, "共同父母丙", 38);
  addPublicParent(uncertainOlder, uncertainParent);
  addPublicParent(uncertainYounger, uncertainParent);
  uncertainOlder.siblings.push(
    { id: uncertainYounger.id, name: uncertainYounger.fullName, gender: "male", birthDateTotalDays: 1000 },
    { id: uncertainYounger.id, name: uncertainYounger.fullName, gender: "male", birthDateTotalDays: 9000 }
  );
  const conflictingBirth = buildPrompt([uncertainOlder, uncertainYounger, uncertainParent], { activeParticipantIds: [1, 2] }).relationship;
  assert.match(conflictingBirth, /人物乙年长于人物甲/u, "conflicting birth ordinals fall back to trusted different current ages");
  assert.match(conflictingBirth, /人物乙是人物甲的哥哥/u);
}

function testSameNameMentionAnchorsUseRuntimeIds() {
  const player = makeCharacter(1, "同名人物", 7);
  const responder = makeCharacter(2, "同名人物", 11);
  const mentioned = makeCharacter(3, "提及人物丙", 9);
  const playerParent = makeCharacter(4, "玩家父母丁", 38);
  const responderParent = makeCharacter(5, "回应者父母戊", 40);
  addPublicParent(player, playerParent);
  addPublicParent(mentioned, playerParent);
  addPublicParent(responder, playerParent);
  addPublicParent(responder, responderParent);
  addPublicParent(mentioned, responderParent);
  player.siblings.push({ id: mentioned.id, name: mentioned.fullName, gender: "male" });
  responder.siblings.push({ id: mentioned.id, name: mentioned.fullName, gender: "male" });
  mentioned.siblings.push({ id: player.id, name: player.fullName, gender: "male" });
  mentioned.siblings.push({ id: responder.id, name: responder.fullName, gender: "male" });

  const prompt = buildPrompt([player, responder, mentioned, playerParent, responderParent], { activeParticipantIds: [1, 2], mentionedIds: [3], subjectiveWorldPolicyActive: false });
  assert.match(prompt.allPromptText, /【提及人物丙】[\s\S]*?- 与同名人物的关系：哥哥[\s\S]*?- 与同名人物的关系：弟弟/u,
    "the player-then-responder anchor lines retain distinct IDs when display names are identical");
}

function testCloseFamilyIdentityRuleIsNarrowAndCurrent() {
  const player = makeCharacter(1, "玩家甲", 9, "male", { traits: [{ name: "brave" }], primaryTitle: "公爵" });
  const parent = makeCharacter(2, "父亲乙", 38);
  addPublicParent(player, parent);
  const familyPrompt = buildPrompt([player, parent], { activeParticipantIds: [1, 2] });
  assert.match(familyPrompt.responderFacts, /当前可靠公开的亲属关系允许双方依本轮可信人物资料白名单互知姓名、头衔与特质/u,
    "the actual Prompt authorizes the family whitelist from current public parentage");
  assert.match(familyPrompt.responderFacts, /不授权秘密、过往记忆或其他人物资料/u);

  const secretPlayer = makeCharacter(1, "玩家甲", 9, "male", { traits: [{ name: "bastard" }] });
  const secretParent = makeCharacter(2, "父亲乙", 38);
  secretPlayer.parents.push({
    id: secretParent.id, name: secretParent.fullName, source: "CK3_SECRET_PARENT", sourceOwnerId: secretPlayer.id,
    childId: secretPlayer.id, relationType: "parent", sourceRelation: "parents", publicStatus: "UNKNOWN",
    knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN, sourceSnapshotId: SNAPSHOT
  });
  const nonFamilyPrompt = buildPrompt([secretPlayer, secretParent], { activeParticipantIds: [1, 2] });
  assert.doesNotMatch(nonFamilyPrompt.responderFacts, /当前可靠公开的亲属关系允许双方依本轮可信人物资料白名单互知/u,
    "secret parentage and bastard status do not unlock the family identity whitelist");
  assert.match(nonFamilyPrompt.responderFacts, /玩家姓名、全名、家族、头衔与官职都是后台标签/u,
    "the non-family identity restriction remains in the actual Prompt");
}

function addPublicParent(child, parent) {
  child.parents.push({
    id: parent.id,
    name: parent.fullName,
    gender: parent.gender,
    source: "CK3_DIRECT_PARENT",
    sourceOwnerId: child.id,
    childId: child.id,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    evidenceConflict: false
  });
}

function addCurrentSiblingEvidence(owner, sibling, overrides = {}) {
  const age = overrides.value ?? sibling.age;
  const evidence = {
    value: age,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    sourceOwnerId: owner.id,
    relationType: "sibling",
    source: `${owner.id}.siblings`,
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT,
    ...overrides
  };
  owner.siblings.push({ id: sibling.id, name: sibling.fullName, gender: sibling.gender,
    age, ageSource: "CK3_LIVE_RELATIVE_AGE", evidence: { age: [evidence] } });
}

function testBidirectionalSiblingAndPrivacy() {
  const player = makeCharacter(1, "玩家甲", 9);
  const brother = makeCharacter(2, "兄长乙", 11);
  const parent = makeCharacter(3, "共同父母丙", 38);
  addPublicParent(player, parent);
  addPublicParent(brother, parent);
  player.siblings.push({ id: brother.id, name: brother.fullName, gender: "male" });
  brother.siblings.push({ id: player.id, name: player.fullName, gender: "male" });

  const prompt = buildPrompt([player, brother, parent]);
  assert.match(prompt.relationship, /兄长乙年长于玩家甲/u, "a trusted current sibling pair carries a direction marker without showing numeric ages");
  assert.match(prompt.relationship, /兄长乙是玩家甲的哥哥/u,
    "the older brother receives the correct title");
  assert.match(prompt.relationship, /玩家甲是兄长乙的弟弟/u,
    "the younger player receives the reverse title");
  assert.doesNotMatch(prompt.relationship, /(?:9|11)岁|1190年|106575/u, "the pair facts contain no raw ages or dates");
}

function testBidirectionalCousins() {
  const player = makeCharacter(1, "玩家甲", 9);
  const cousin = makeCharacter(2, "堂兄乙", 11);
  const playerParent = makeCharacter(3, "父亲丙", null);
  const cousinParent = makeCharacter(4, "叔父丁", null);
  const grandparent = makeCharacter(5, "祖父戊", 65);
  addPublicParent(player, playerParent);
  addPublicParent(cousin, cousinParent);
  addPublicParent(playerParent, grandparent);
  addPublicParent(cousinParent, grandparent);
  player.parents[0].siblings = [{ id: cousinParent.id, name: cousinParent.fullName, gender: "male" }];
  cousin.parents[0].siblings = [{ id: playerParent.id, name: playerParent.fullName, gender: "male" }];
  playerParent.siblings.push({ id: cousinParent.id, name: cousinParent.fullName, gender: "male" });
  cousinParent.siblings.push({ id: playerParent.id, name: playerParent.fullName, gender: "male" });
  playerParent.children.push({ id: player.id, name: player.fullName, directParentEvidence: player.parents[0] });
  cousinParent.children.push({ id: cousin.id, name: cousin.fullName, directParentEvidence: cousin.parents[0] });

  const prompt = buildPrompt([player, cousin, playerParent, cousinParent], { activeParticipantIds: [1, 2] });
  assert.match(prompt.relationship, /堂兄乙是玩家甲的堂哥/u,
    "the older first cousin receives the correct title");
  assert.match(prompt.relationship, /玩家甲是堂兄乙的堂弟/u,
    "the younger first cousin receives the reverse title");
  assert.doesNotMatch(prompt.relationship, /(?:9|11)岁|1190年|106575/u, "cousin seniority does not disclose raw ages or dates");
}

function testOffSceneSiblingQueryUsesPreRedactionAge() {
  const player = makeCharacter(1, "玩家甲", 30);
  const responder = makeCharacter(2, "回应者乙", 9);
  const brother = makeCharacter(3, "兄长丙", 14);
  const father = makeCharacter(4, "父亲丁", 38);
  addPublicParent(responder, father);
  addPublicParent(brother, father);
  responder.siblings.push({ id: brother.id, name: brother.fullName, gender: "male" });
  brother.siblings.push({ id: responder.id, name: responder.fullName, gender: "male" });

  const prompt = buildPrompt([player, responder, brother, father], {
    activeParticipantIds: [1, 2],
    userQuery: "你哥哥是谁？"
  });
  assert.match(prompt.familyFacts, /查询关系：哥哥；目标人物：兄长丙/u,
    "an off-scene older sibling is resolved from current source ages after profile redaction");
  assert.doesNotMatch(prompt.familyFacts, /(?:9|14|38)岁|1190年|106575/u,
    "pre-redaction seniority does not disclose source ages or dates");

  const untrustedBrother = makeCharacter(3, "未核实兄长", 14);
  untrustedBrother.ageSource = "UNVERIFIED";
  responder.siblings[0] = { id: untrustedBrother.id, name: untrustedBrother.fullName, gender: "male" };
  untrustedBrother.siblings.push({ id: responder.id, name: responder.fullName, gender: "male" });
  const unresolved = buildPrompt([player, responder, untrustedBrother, father], {
    activeParticipantIds: [1, 2],
    userQuery: "你哥哥是谁？"
  });
  assert.match(unresolved.familyFacts, /当前无法可靠确定具体关系主体或目标 Runtime ID/u,
    "untrusted current age does not resolve a family query");
  assert.doesNotMatch(unresolved.familyFacts, /未核实兄长/u);
}

function testSeniorityRequiresMatchingProjectionSnapshotAndPath() {
  const player = makeCharacter(1, "玩家甲", 30);
  const responder = makeCharacter(2, "回应者乙", 9);
  const brother = makeCharacter(3, "兄长丙", 14);
  const father = makeCharacter(4, "父亲丁", 38);
  addPublicParent(responder, father);
  addPublicParent(brother, father);
  responder.siblings.push({ id: brother.id, name: brother.fullName, gender: "male" });
  brother.siblings.push({ id: responder.id, name: responder.fullName, gender: "male" });

  const authority = makeGameData([player, responder, brother, father]);
  const projected = redactCurrentDemographics(authority);
  const query = "你哥哥是谁？";
  const build = source => buildFamilyFactBlock(projected.characters.get(2), projected, {
    query,
    ageAuthorityGameData: source
  });
  assert.match(build(authority), /查询关系：哥哥；目标人物：兄长丙/u,
    "matching raw ages may resolve a relationship already present in the projected graph");

  for (const [field, staleValue] of [["campaignToken", "another-campaign"], ["date", "1190年5月3日"], ["totalDays", TOTAL_DAYS + 1]]) {
    const stale = makeGameData([player, responder, brother, father]);
    stale[field] = staleValue;
    const facts = build(stale);
    assert.match(facts, /当前无法可靠确定具体关系主体或目标 Runtime ID/u,
      `a mismatched ${field} keeps seniority unresolved`);
    assert.doesNotMatch(facts, /兄长丙/u, `a mismatched ${field} does not disclose a selected candidate`);
  }

  const relativeCandidate = makeCharacter(3, "外部年龄来源兄长", null);
  relativeCandidate.ageSource = "CK3_LIVE_RELATIVE_AGE";
  const outsider = makeCharacter(5, "投影外来源人物", 38);
  const relativeEvidence = {
    value: 14,
    ageSource: "CK3_LIVE_RELATIVE_AGE",
    sourceOwnerId: outsider.id,
    relationType: "sibling",
    source: `${outsider.id}.siblings`,
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT
  };
  outsider.siblings.push({ id: relativeCandidate.id, name: relativeCandidate.fullName, gender: "male",
    age: 14, ageSource: "CK3_LIVE_RELATIVE_AGE", evidence: { age: [relativeEvidence] } });
  const rawResponder = makeCharacter(2, "回应者乙", 9);
  const sharedFather = makeCharacter(4, "父亲丁", 38);
  addPublicParent(rawResponder, sharedFather);
  addPublicParent(relativeCandidate, sharedFather);
  rawResponder.siblings.push({ id: relativeCandidate.id, name: relativeCandidate.fullName, gender: "male" });
  relativeCandidate.siblings.push(
    { id: rawResponder.id, name: rawResponder.fullName, gender: "male" },
    { id: outsider.id, name: outsider.fullName, gender: "male" }
  );
  const relativeAuthority = makeGameData([rawResponder, relativeCandidate, sharedFather, outsider]);
  const projectedRelative = redactCurrentDemographics(makeGameData([rawResponder, relativeCandidate, sharedFather]));
  projectedRelative.characters.get(3).siblings = projectedRelative.characters.get(3).siblings.filter(entry => Number(entry.id) !== outsider.id);
  const unresolved = buildFamilyFactBlock(projectedRelative.characters.get(2), projectedRelative, {
    query,
    ageAuthorityGameData: relativeAuthority
  });
  assert.match(unresolved, /当前无法可靠确定具体关系主体或目标 Runtime ID/u,
    "relative age supported only by a raw relation absent from the projected graph cannot resolve the query");
  assert.doesNotMatch(unresolved, /外部年龄来源兄长|投影外来源人物/u,
    "raw-only relationship paths do not add a person to the projected answer");
}

function testExtendedKinshipSeniorityUsesTheCorrectParent() {
  const responder = makeCharacter(2, "回应者乙", 9);
  const father = makeCharacter(3, "父亲丙", 50);
  const mother = makeCharacter(4, "母亲丁", 48, "female");
  const olderUncle = makeCharacter(5, "伯父戊", 55);
  const youngerUncle = makeCharacter(6, "叔父己", 40);
  const paternalAunt = makeCharacter(7, "姑母庚", 53, "female");
  const maternalUncle = makeCharacter(8, "舅父辛", 53);
  const maternalAunt = makeCharacter(9, "姨母壬", 43, "female");
  addPublicParent(responder, father);
  responder.parents[1] = {
    id: mother.id, name: mother.fullName, gender: "female", source: "CK3_DIRECT_PARENT",
    sourceOwnerId: responder.id, childId: responder.id, relationType: "parent", sourceRelation: "parents",
    publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN", campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT, evidenceConflict: false
  };
  father.siblings.push(...[olderUncle, youngerUncle, paternalAunt].map(item => ({ id: item.id, name: item.fullName, gender: item.gender })));
  mother.siblings.push(...[maternalUncle, maternalAunt].map(item => ({ id: item.id, name: item.fullName, gender: item.gender })));
  for (const relative of [olderUncle, youngerUncle, paternalAunt]) relative.siblings.push({ id: father.id, name: father.fullName, gender: "male" });
  for (const relative of [maternalUncle, maternalAunt]) relative.siblings.push({ id: mother.id, name: mother.fullName, gender: "female" });

  const authority = makeGameData([responder, father, mother, olderUncle, youngerUncle, paternalAunt, maternalUncle, maternalAunt]);
  const projected = redactCurrentDemographics(authority);
  const familyQuery = query => buildFamilyFactBlock(projected.characters.get(responder.id), projected, { query, ageAuthorityGameData: authority });
  assert.match(familyQuery("你伯父是谁？"), /查询关系：伯父（比父亲年长）；目标人物：伯父戊/u,
    "伯父 is compared with the father, even when the father is off scene");
  assert.match(familyQuery("你叔父是谁？"), /查询关系：叔父（比父亲年幼）；目标人物：叔父己/u,
    "叔父 is compared with the father, even when the father is off scene");
  assert.match(familyQuery("你姑母是谁？"), /姑母（比父亲年长）/u,
    "a paternal aunt gets an age direction relative to the father");
  assert.match(familyQuery("你舅父是谁？"), /舅父（比母亲年长）/u,
    "a maternal uncle gets an age direction relative to the mother");
  assert.match(familyQuery("你姨母是谁？"), /姨母（比母亲年幼）/u,
    "a maternal aunt gets an age direction relative to the mother");
  for (const query of ["你伯父是谁？", "你叔父是谁？", "你姑母是谁？", "你舅父是谁？", "你姨母是谁？"]) {
    assert.doesNotMatch(familyQuery(query), /(?:9|40|43|48|50|53|55)岁|1190年|106575/u,
      "kinship labels and relative-age text do not reveal raw ages or dates");
  }
}

function testCurrentKinshipAndResponderKnowledgeGate() {
  const player = makeCharacter(1, "玩家甲", 9);
  const responder = makeCharacter(2, "回应者乙", 11);
  const third = makeCharacter(3, "第三人丙", 15);
  const unrelated = buildPrompt([player, responder, third], { activeParticipantIds: [1, 2, 3] }).relationship;
  assert.doesNotMatch(unrelated, /长幼：|年长于/u,
    "unrelated active characters do not generate seniority or unknown markers");

  const siblingPlayer = makeCharacter(1, "玩家甲", 9);
  const sibling = makeCharacter(3, "兄长丙", 15);
  const sharedParent = makeCharacter(4, "共同父母丁", 38);
  addPublicParent(siblingPlayer, sharedParent);
  addPublicParent(sibling, sharedParent);
  const unrelatedResponder = makeCharacter(2, "无关回应者乙", 11);
  const thirdParty = buildPrompt([siblingPlayer, unrelatedResponder, sibling, sharedParent], {
    responderId: unrelatedResponder.id,
    activeParticipantIds: [1, 2, 3]
  }).relationship;
  assert.doesNotMatch(thirdParty, /玩家甲年长于兄长丙|兄长丙年长于玩家甲|长幼：/u,
    "an unrelated responder does not learn a public sibling pair's relative age from co-presence");

  const parentResponder = makeCharacter(5, "父亲戊", 40);
  addPublicParent(siblingPlayer, parentResponder);
  addPublicParent(sibling, parentResponder);
  const informedThirdParty = buildPrompt([siblingPlayer, parentResponder, sibling, sharedParent], {
    responderId: parentResponder.id,
    activeParticipantIds: [1, 5, 3]
  }).relationship;
  assert.match(informedThirdParty, /兄长丙年长于玩家甲/u,
    "a responder with current public close-family knowledge may receive the pair order");

  const unknown = makeCharacter(2, "回应者乙", 11);
  unknown.ageSource = "UNVERIFIED";
  const unknownParent = makeCharacter(4, "共同父母丁", 38);
  addPublicParent(player, unknownParent);
  addPublicParent(unknown, unknownParent);
  const unknownPrompt = buildPrompt([player, unknown, unknownParent]).relationship;
  assert.match(unknownPrompt, /长幼：未能可靠确认，不得推测/u, "untrusted age does not create a seniority marker");
  assert.doesNotMatch(unknownPrompt, /回应者乙年长于玩家甲/u);

  const conflict = makeCharacter(2, "回应者乙", null);
  const ageReporter = makeCharacter(5, "年龄来源戊", null);
  addCurrentSiblingEvidence(player, conflict, { value: 12 });
  addCurrentSiblingEvidence(ageReporter, conflict, { value: 10 });
  const conflictPrompt = buildPrompt([player, conflict, unknownParent, ageReporter]).relationship;
  assert.match(conflictPrompt, /长幼：未能可靠确认，不得推测/u, "conflicting age evidence fails closed");
  assert.doesNotMatch(conflictPrompt, /回应者乙年长于玩家甲/u);

  const sameAge = makeCharacter(2, "回应者乙", 9);
  addPublicParent(sameAge, unknownParent);
  const sameAgePrompt = buildPrompt([player, sameAge, unknownParent]).relationship;
  assert.match(sameAgePrompt, /长幼：未能可靠确认，不得推测/u, "equal integer ages do not guess a birthday order");
}

function testUntrustedSiblingRowsDoNotAuthorizeSeniority() {
  const invalidProofs = [
    ["stale snapshot", { sourceSnapshotId: "old-snapshot" }],
    ["wrong campaign", { campaignToken: "another-campaign" }],
    ["wrong owner", { sourceOwnerId: 2 }]
  ];
  for (const [label, overrides] of invalidProofs) {
    const player = makeCharacter(1, "玩家甲", 9);
    const brother = makeCharacter(2, "兄长乙", 11);
    addCurrentSiblingEvidence(player, brother, overrides);
    const prompt = buildPrompt([player, brother]).relationship;
    assert.doesNotMatch(prompt, /长幼：|年长于/u,
      `${label} sibling evidence cannot authorize relative age, even though the graph contains a reciprocal edge`);
  }
}

function testSecretParentDoesNotCreateKinship() {
  const player = makeCharacter(1, "玩家甲", 9);
  const other = makeCharacter(2, "人物乙", 11);
  const hiddenParent = makeCharacter(9, "未公开父亲", null);
  const secretParentRecord = child => ({
    id: hiddenParent.id,
    name: hiddenParent.fullName,
    source: "CK3_SECRET_PARENT",
    sourceOwnerId: child.id,
    childId: child.id,
    relationType: "parent",
    sourceRelation: "parents",
    publicStatus: "UNKNOWN",
    knowledgeStatus: "UNKNOWN",
    campaignToken: CAMPAIGN,
    sourceSnapshotId: SNAPSHOT
  });
  player.parents.push(secretParentRecord(player));
  other.parents.push(secretParentRecord(other));

  const prompt = buildPrompt([player, other, hiddenParent], { activeParticipantIds: [1, 2] }).relationship;
  assert.doesNotMatch(prompt, /- 双向亲属称谓：|亲属关系.*(?:伯父|叔父|哥哥|弟弟|兄弟|姐妹|堂|表)/u,
    "shared secret parentage alone does not authorize a current kinship label");
}

function testMentionedTargetPairAndFrozenPrefixScope() {
  const player = makeCharacter(1, "玩家甲", 9);
  const responder = makeCharacter(2, "回应者乙", 11);
  const mentioned = makeCharacter(3, "提及人物丙", 13);
  const sharedParent = makeCharacter(4, "公开父母丁", 38);
  addPublicParent(player, sharedParent);
  addPublicParent(responder, sharedParent);
  addPublicParent(mentioned, sharedParent);
  mentioned.siblings.push({ id: player.id, name: player.fullName, gender: "male" });
  player.siblings.push({ id: mentioned.id, name: mentioned.fullName, gender: "male" });
  const prompt = buildPrompt([player, responder, mentioned, sharedParent], {
    activeParticipantIds: [1, 2],
    mentionedIds: [3],
    subjectiveWorldPolicyActive: false
  });
  assert.match(prompt.allPromptText, /提及人物丙相对玩家甲为哥哥/u,
    "an admitted mentioned target receives the pre-redaction pair label in the actual Prompt");

  const scope = {
    sourcePairIds: [1, 2],
    playerAnchorId: 1,
    baselineSnapshotId: "snapshot",
    sourceCampaignToken: CAMPAIGN,
    sourceFolderRevision: 3,
    budgetPolicyRevision: "budget-v1",
    conversationId: "conversation-1",
    frozenDynamicText: "stable"
  };
  const initial = PromptBuilder.getFrozenPrefixScopeSignature(responder, { ...scope, characterKnowledgeRevision: "knowledge-a" });
  const changedDisclosure = PromptBuilder.getFrozenPrefixScopeSignature(responder, { ...scope, characterKnowledgeRevision: "knowledge-b" });
  assert.equal(changedDisclosure, initial,
    "per-request Character Knowledge revisions do not invalidate the frozen historical-memory prefix");
}

testBidirectionalSiblingAndPrivacy();
testBidirectionalCousins();
testOffSceneSiblingQueryUsesPreRedactionAge();
testSeniorityRequiresMatchingProjectionSnapshotAndPath();
testExtendedKinshipSeniorityUsesTheCorrectParent();
testUncleSeniorityUsesPublicFatherAge();
testVerifiedBirthOrdinalBreaksEqualAgeTieOnly();
testCurrentKinshipAndResponderKnowledgeGate();
testUntrustedSiblingRowsDoNotAuthorizeSeniority();
testSameNameMentionAnchorsUseRuntimeIds();
testSecretParentDoesNotCreateKinship();
testCloseFamilyIdentityRuleIsNarrowAndCurrent();
testMentionedTargetPairAndFrozenPrefixScope();

console.log("V9.3.9.2 pre-redaction kinship Prompt: PASS (current public kinship path, responder knowledge scope, stale/campaign/owner sibling proof rejection, bidirectional sibling/cousin titles, redaction, query scope and frozen prefix)");

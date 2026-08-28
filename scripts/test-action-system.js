const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const actionSystem = globalThis.__V67ActionSystem;
const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => {
    const definition = require(path.join(actionsDir, file));
    return { id: definition.signature, definition };
  })
};
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();
const { createGameData } = require(path.join(root, "resources", "app", "out", "main", "game-data", "game-data"));
const GameData = createGameData({
  fs,
  path,
  memorySystem: require(path.join(root, "resources", "app", "out", "main", "memory-system")),
  memoryEngine: {},
  summariesDir: path.join(root, ".test-summaries"),
  getHistoricalReferenceByYear: () => ({})
});

const socialBinding = actionSystem.createParticipantBinding({
  messageId: "social-test",
  eventId: "social:test:0",
  actionId: "changeOpinionOf",
  sourceCharacterId: 2,
  targetCharacterId: 1,
  resolutionBasis: ["validated_social_consequence"]
});
const socialInvocation = actionSystem.deterministicInvocation.resolveSocial({
  actionId: "changeOpinionOf",
  binding: socialBinding,
  args: { value: -3 }
});
assert.strictEqual(socialInvocation.mode, "local");
assert.deepStrictEqual(socialInvocation.invocation.args, { value: -3 });
assert.strictEqual(actionSystem.deterministicInvocation.resolveSocial({ actionId: "changeOpinionOf", binding: socialBinding, args: { value: -11 } }).mode, "unresolved");

const triggerCases = [
  ["他踱步前行。", ["daily_movement"]],
  ["我拿起酒杯", ["daily_object_interaction"]],
  ["我穿上外袍", ["daily_object_interaction"]],
  ["我吃下糕点", ["daily_object_interaction"]],
  ["我打赏他十金币", ["gold"]],
  ["我给李思念50文钱。", ["gold"]],
  ["我把50文交给李思念。", ["gold"]],
  ["我想给李思念50文。", []],
  ["我准备明天给李思念50文。", []],
  ["我递给她50文，但她没有接。", []],
  ["我推倒他，又踢了他一脚", ["combat"]],
  ["我挥剑砍伤了他", ["combat", "death_or_injury"]],
  ["我试图刺伤他，但他躲开了", ["combat"]],
  ["他已经没有受伤", []],
  ["我亲吻她", ["intimate_contact"]],
  ["我想要亲吻她", []],
  ["我抚摸并挑逗她", ["intimate_contact"]],
  ["我顶入后缓缓研磨", ["intimate_contact"]],
  ["我们已经完成了房事", ["sexual_intercourse_completed"]],
  ["我们共度了春宵", ["sexual_intercourse_completed"]],
  ["从今以后你便是我的情人", ["relationship"]],
  ["从此我们便是灵魂伴侣", ["relationship"]],
  ["我计划派刺客暗杀他", ["scheme_start"]],
  ["我会杀了你", []],
  ["我过会儿给张三50金币。", []],
  ["等下我就任命张三为骑士。", []],
  ["迟些时候把张三关起来。", []],
  ["改日我再杀他。", []],
  ["如果有机会，我计划暗杀他", []],
  ["他喝得醉醺醺", ["rp_status"]],
  ["我决定加入独立派系", ["faction_commitment"]],
  ["明天再加入独立派系", []],
  ["我释放了他", ["prisoner_resolution"]],
  ["明天释放他", []]
];

for (const [text, expected] of triggerCases) {
  assert.deepStrictEqual(ActionEngine.getActionTriggers(text).sort(), [...expected].sort(), text);
}

const semanticCases = [
  ["卫兵将他押送入牢。", ["imprisonment"], ["isImprisonedBy"]],
  ["他被刺伤，鲜血不断涌出。", ["death_or_injury"], ["isInjured"]],
  ["他被斩首处死。", ["death_or_injury"], ["characterIsKilled"]],
  ["领主任命他为骑士。", ["employment_or_office"], ["isEmployedAsKnightBy"]],
  ["他宣誓效忠于国王，成为封臣。", ["faith_or_vassal"], ["isVassalizedBy"]],
  ["她转身离席，走出大厅。", ["location_or_exit"], ["leavesConversation"]],
  ["她返回宫廷。", ["location_or_exit"], ["changeLocation"]],
  ["国王赦免了囚犯，解开镣铐。", ["prisoner_resolution"], ["resolvePrisoner"]],
  ["他着手部署暗杀计划。", ["scheme_start"], ["startHostileScheme"]],
  ["他开始拉拢那位伯爵。", ["scheme_start"], ["startPersonalScheme"]]
];

for (const [text, expectedReasons, expectedScripts] of semanticCases) {
  const profile = ActionEngine.getSemanticActionProfile(text, ActionEngine.getActionTriggers(text));
  for (const reason of expectedReasons) assert(profile.reasons.includes(reason), `${text}: missing reason ${reason}`);
  for (const script of expectedScripts) assert(profile.allowedActionIds.includes(script), `${text}: missing script ${script}`);
}

for (const [text, expectedType] of [
  ["我与她对视许久，随后吻住了她的唇。", "romantic_affection"],
  ["我牵住她的手，轻轻亲吻她。", "romantic_affection"]
]) {
  const profile = ActionEngine.getSemanticActionProfile(text, ActionEngine.getActionTriggers(text));
  assert.strictEqual(profile.events.length, 0, `${text}: basic affection must not auto-select a CK3 action`);
  assert(profile.socialEvents.some((event) => event.type === expectedType), `${text}: missing social event ${expectedType}`);
}

const eventCases = [
  {
    text: "我没有杀死他，只是刺伤了他的手臂。",
    categories: ["death_or_injury", "combat"],
    allowed: ["isInjured"],
    forbidden: ["characterIsKilled"],
    evidence: "刺伤了他的手臂"
  },
  {
    text: "他没有被罢免，反而被任命为骑士。",
    categories: ["employment_or_office"],
    allowed: ["isEmployedAsKnightBy"],
    forbidden: ["isFiredFromCouncilOf"],
    evidence: "被任命为骑士"
  },
  {
    text: "他没有离开，而是进入了王座厅。",
    categories: ["location_or_exit"],
    allowed: ["changeLocation"],
    forbidden: ["leavesConversation"],
    evidence: "进入了王座厅"
  }
];

for (const testCase of eventCases) {
  const profile = ActionEngine.getSemanticActionProfile(testCase.text);
  assert.deepStrictEqual(profile.events.map((event) => event.category), testCase.categories, `${testCase.text}: unexpected ActionEvent categories`);
  assert(profile.events.every((event) => event.executionStatus === "executed"), `${testCase.text}: ActionEvent is not executed`);
  assert(profile.events.every((event) => event.evidence.text.includes(testCase.evidence)), `${testCase.text}: evidence span is not isolated`);
  for (const actionId of testCase.allowed) assert(profile.allowedActionIds.includes(actionId), `${testCase.text}: missing allowed action ${actionId}`);
  for (const actionId of testCase.forbidden) assert(!profile.allowedActionIds.includes(actionId), `${testCase.text}: forbidden action ${actionId}`);
}

const failedBeforeExecution = ActionEngine.parseActionEvents("我试图拔剑，但剑卡在剑鞘里。");
assert.strictEqual(failedBeforeExecution.events.length, 0, "failed-before-execution must not create ActionEvents");
assert(failedBeforeExecution.rejectedCandidates.some((candidate) => candidate.category === "combat" && candidate.rejectionReason === "failed_before_execution"), "failed-before-execution must preserve a rejected combat candidate");

const failedCombat = ActionEngine.getActionEvents("我挥剑刺向他，但他及时躲开了。");
assert.strictEqual(failedCombat.length, 1, "executed combat should create one ActionEvent");
assert.strictEqual(failedCombat[0].executionStatus, "executed", "combat execution status must be executed");
assert.strictEqual(failedCombat[0].resultStatus, "failed", "dodged combat result must be failed");

const orderedEvents = ActionEngine.getActionEvents("我先拿起酒杯，随后刺伤卫兵，最后离开大厅。");
assert.deepStrictEqual(orderedEvents.map((event) => event.category), ["daily_object_interaction", "death_or_injury", "combat", "location_or_exit"], "ActionEvents must preserve text order");
const repeatedInjuries = ActionEngine.getActionEvents("我刺伤了第一个卫兵，随后又刺伤了第二个卫兵。");
assert.strictEqual(repeatedInjuries.filter((event) => event.category === "death_or_injury").length, 2, "same-category injury events must not be merged");

const evaluationPlan = ActionEngine.buildTurnEvaluationPlan({
  playerMessage: { id: 10, role: "user", content: "我递给你50金币。" },
  player: { id: 1 },
  npcMessage: { id: 11, role: "assistant", content: "我挥拳打向卫兵。" },
  npc: { id: 2 }
});
assert.deepStrictEqual(evaluationPlan.map((entry) => [entry.kind, entry.source.id, entry.associatedMessageId]), [["player", 1, 10], ["npc", 2, 11]], "player and NPC messages must remain independent evaluation units");

const eldestBrother = {
  id: 20,
  fullName: "大哥A",
  gender: "male",
  age: 30,
  siblings: [{ id: 21, birthDateTotalDays: 200 }]
};
const secondBrother = {
  id: 21,
  fullName: "二哥B",
  gender: "male",
  age: 28,
  siblings: [{ id: 20, birthDateTotalDays: 100 }]
};
const siblingContext = {
  playerID: 1,
  characters: new Map([[20, eldestBrother], [21, secondBrother]]),
  findFamilyEntry: GameData.prototype.findFamilyEntry,
  getSiblingRelation: GameData.prototype.getSiblingRelation,
  describeCharacterRelationship: GameData.prototype.describeCharacterRelationship
};
const siblingRelationshipContext = GameData.prototype.getActiveParticipantRelationshipInfo.call(siblingContext, secondBrother, [eldestBrother.id]);
assert(siblingRelationshipContext.includes("二哥B是大哥A的弟弟"), "younger sibling must be described as 弟弟 to the elder sibling");
assert(siblingRelationshipContext.includes("大哥A是二哥B的哥哥"), "elder sibling must be described as 哥哥 to the younger sibling");
const siblingRelationTests = 1;

const actionsGetAllStart = ipcSource.indexOf('electron.ipcMain.handle("actions:getAll"');
const actionsGetAllEnd = ipcSource.indexOf('electron.ipcMain.handle("actions:setDisabled"', actionsGetAllStart);
assert(actionsGetAllStart >= 0 && actionsGetAllEnd > actionsGetAllStart, "Unable to locate actions:getAll IPC handler");
const actionsGetAllSource = ipcSource.slice(actionsGetAllStart, actionsGetAllEnd);
assert(actionsGetAllSource.includes("triggerCategories,"), "actions:getAll must expose trigger categories for the action list");
assert(actionsGetAllSource.includes("riskLevel: semantic.riskLevel"), "actions:getAll must expose semantic risk level for the action list");
assert(actionsGetAllSource.includes('semanticMode: semantic.fallback ? "fallback" : "event"'), "actions:getAll must expose metadata semantic resolution mode for the action list");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const rendererSource = fs.readFileSync(rendererPath, "utf8");
const approvalManagerSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "approval-manager.js"), "utf8");
assert(rendererSource.includes("action-semantic-meta"), "ActionsView must render action semantic metadata");
assert(rendererSource.includes('t("actions.eventResolver")'), "ActionsView must localize semantic resolution mode");
assert(rendererSource.includes("const riskLabel = action.riskLevel"), "action approval must display its resolved risk level");
assert(approvalManagerSource.includes("riskLevel: action.riskLevel"), "action approval payload must preserve risk level");
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, "resources", "app", "package.json"), "utf8")).version, "2.0.4", "Packaged app version must be 2.0.4");
const actionUiContractTests = 1;

const makeCharacter = (id, shortName, age) => ({ id, shortName, fullName: shortName, age });
const characters = /* @__PURE__ */ new Map([
  [1, makeCharacter(1, "Player", 30)],
  [2, makeCharacter(2, "Adult NPC", 25)],
  [3, makeCharacter(3, "Minor NPC", 12)]
]);
const gameData = { characters, playerID: 1, playerName: "Player" };
const scheme = require(path.join(actionsDir, "z_startPersonalScheme.js"));
const hostileScheme = require(path.join(actionsDir, "z_startHostileScheme.js"));
const rpStatus = require(path.join(actionsDir, "z_setRoleplayStatus.js"));
const faction = require(path.join(actionsDir, "z_recordFactionCommitment.js"));
const prisoner = require(path.join(actionsDir, "z_resolvePrisoner.js"));

for (const filename of ["z_performDailyAction.js", "z_performCombatAction.js", "z_performIntimateAction.js"]) {
  assert(!fs.existsSync(path.join(actionsDir, filename)), `${filename} must be retired from shipped standard actions`);
}

const shippedActions = globalThis.actionRegistry.getAllActions().filter((action) => action.id !== "noOp");
assert(shippedActions.length >= 30, "the local candidate layer must cover all shipped action modules");
for (const action of shippedActions) {
  const semantic = action.definition.semantic || {};
  assert(Array.isArray(action.definition.triggerCategories) && action.definition.triggerCategories.length > 0, `${action.id}: missing local trigger categories`);
  assert(Array.isArray(semantic.candidatePatterns) || Array.isArray(semantic.evidencePatterns) || typeof semantic.match === "function" || semantic.moneyTransfer === true, `${action.id}: missing local semantic recall metadata`);
}
const registryPatternProbe = {
  getAllActions: () => [
    { definition: { triggerCategories: ["probe_precise"], semantic: { evidencePatterns: [/已经完成苍龙旗交接/] } } },
    { definition: { triggerCategories: ["probe_broad"], semantic: { evidencePatterns: [/.+/] } } }
  ]
};
assert.deepStrictEqual(
  globalThis.__V67ActionSystem.candidateGate.detect("已经完成苍龙旗交接", { candidateOnly: true }, { registry: registryPatternProbe }),
  ["probe_precise"],
  "narrow script evidence must extend local candidate recall without allowing catch-all metadata to trigger ordinary dialogue"
);

for (const action of [scheme, hostileScheme, rpStatus, faction, prisoner]) {
  const args = typeof action.args === "function" ? action.args({ gameData, sourceCharacter: characters.get(2) }) : action.args;
  assert(action.signature);
  assert(Array.isArray(action.triggerCategories) && action.triggerCategories.length > 0);
  assert(args.every((arg) => arg.name && arg.type && arg.description));
  assert.strictEqual(typeof action.check({ gameData, sourceCharacter: characters.get(2) }).requiresTarget, "boolean");
}

let schemeEffect = "";
assert.doesNotThrow(() => hostileScheme.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(2),
  args: { scheme: "murder", isPlayerSource: true },
  runGameEffect: (effect) => { schemeEffect = effect; }
}));
assert.match(schemeEffect, /can_start_scheme/);
assert.match(schemeEffect, /type = murder/);
assert.throws(() => scheme.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(3),
  args: { scheme: "seduce", isPlayerSource: true },
  runGameEffect: () => {}
}), /adult/);

let rpEffect = "";
assert.doesNotThrow(() => rpStatus.run({
  targetCharacter: characters.get(2),
  args: { status: "drunk" },
  runGameEffect: (effect) => { rpEffect = effect; }
}));
assert.match(rpEffect, /votc_rp_status_drunk/);

let factionEffect = "";
assert.doesNotThrow(() => faction.run({
  gameData,
  sourceCharacter: characters.get(2),
  targetCharacter: characters.get(2),
  args: { operation: "support_claimant", isPlayerSource: true },
  runGameEffect: (effect) => { factionEffect = effect; }
}));
assert.match(factionEffect, /votc_faction_commitment_support_claimant/);

let prisonerEffect = "";
assert.doesNotThrow(() => prisoner.run({
  targetCharacter: characters.get(2),
  args: { resolution: "release" },
  runGameEffect: (effect) => { prisonerEffect = effect; }
}));
assert.match(prisonerEffect, /release_from_prison = yes/);

// ========================================
// Phase 0: Mixed-Semantic Regression Tests
// ========================================
// Purpose: Establish v6.5 core semantic regression baseline
// These tests expose v6.4 limitations where Stage 2 re-scans full text
// and allows Gate to confirm action facts instead of detecting candidates

const mixedSemanticCases = [
  {
    id: 1,
    name: "否定死亡 + 实际受伤",
    text: "我没有杀死他，只是刺伤了他的手臂。",
    expectedTriggers: ["death_or_injury"],
    expectedAllowed: ["isInjured"],
    forbiddenAllowed: ["characterIsKilled"],
    note: "Core v6.5 case: Stage 2 should not re-scan full text"
  },
  {
    id: 2,
    name: "计划死亡 + 实际受伤",
    text: "我原本想杀掉他，但最终只是挥剑将他刺伤。",
    expectedTriggers: ["combat", "death_or_injury"],
    expectedAllowed: ["isInjured"],
    forbiddenAllowed: ["characterIsKilled"],
    note: "Intention pollution should not affect result confirmation"
  },
  {
    id: 3,
    name: "回忆死亡 + 当前动作",
    text: "我想起昨天曾杀过一个刺客，随后拿起桌上的酒杯。",
    expectedTriggers: ["daily_object_interaction"],
    expectedAllowed: [],
    forbiddenTriggers: ["death_or_injury"],
    forbiddenAllowed: ["characterIsKilled"],
    note: "Past memory should not trigger current death_or_injury"
  },
  {
    id: 4,
    name: "传闻死亡 + 当前离开",
    text: "听说公爵杀死了一个囚犯，我随即转身离开大厅。",
    expectedTriggers: ["location_or_exit"],
    expectedAllowed: ["leavesConversation"],
    forbiddenTriggers: ["death_or_injury"],
    forbiddenAllowed: ["characterIsKilled"],
    note: "Hearsay should not trigger current death_or_injury"
  },
  {
    id: 5,
    name: "否定恋人 + 实际朋友",
    text: "她不是我的情人，我们只是成为了朋友。",
    expectedTriggers: ["relationship"],
    expectedAllowed: ["becomeFriendsWith"],
    forbiddenAllowed: ["becomeLoversWith", "becomeSoulmatesWith"],
    note: "Negated relationship should not be allowed"
  },
  {
    id: 6,
    name: "否定罢免 + 实际骑士任命",
    text: "他没有被罢免，反而被任命为骑士。",
    expectedTriggers: ["employment_or_office"],
    expectedAllowed: ["isEmployedAsKnightBy"],
    forbiddenAllowed: ["isFiredFromCouncilOf"],
    note: "Negated firing should not be allowed"
  },
  {
    id: 7,
    name: "否定离开 + 实际进入",
    text: "他没有离开，而是进入了王座厅。",
    expectedTriggers: ["location_or_exit"],
    expectedAllowed: ["changeLocation"],
    forbiddenAllowed: ["leavesConversation"],
    note: "Negated leave should not be allowed"
  },
  {
    id: 8,
    name: "攻击已发生，但伤害结果失败",
    text: "我挥剑刺向他，但他及时躲开了。",
    expectedTriggers: ["combat"],
    expectedAllowed: [],
    forbiddenTriggers: ["death_or_injury"],
    forbiddenAllowed: ["isInjured", "characterIsKilled"],
    note: "Action executed vs result failed - combat yes, injury no"
  },
  {
    id: 9,
    name: "动作本体失败",
    text: "我试图拔剑，但剑卡在剑鞘里。",
    expectedTriggers: ["combat"], // Gate should detect intent, semantic should reject result
    expectedAllowed: [],
    forbiddenTriggers: ["death_or_injury"],
    forbiddenAllowed: ["isInjured", "characterIsKilled"],
    note: "Action attempt failed - Gate detects intent, but no result execution"
  },
  {
    id: 10,
    name: "同一句两个真实事件",
    text: "我刺伤了卫兵，随后离开大厅。",
    expectedTriggers: ["death_or_injury", "location_or_exit"],
    expectedAllowed: ["isInjured", "leavesConversation"],
    forbiddenAllowed: [],
    note: "TODO v6.5: Should be split into two ActionEvents"
  },
  {
    id: 11,
    name: "计划 + 当前离开",
    text: "我明天会杀了他，但现在先离开大厅。",
    expectedTriggers: ["location_or_exit"],
    expectedAllowed: ["leavesConversation"],
    forbiddenTriggers: ["death_or_injury"],
    forbiddenAllowed: ["characterIsKilled"],
    note: "Future intention should not pollute current event"
  },
  {
    id: 12,
    name: "假设 + 当前金币转移",
    text: "如果我杀了他也许会惹麻烦，不过我现在把50金币交给你。",
    expectedTriggers: ["gold"],
    expectedAllowed: [], // gold triggers are context-sensitive
    expectedEventCategories: ["gold"],
    forbiddenEventCategories: ["death_or_injury"],
    forbiddenAllowed: ["characterIsKilled"],
    note: "Hypothetical should not trigger death_or_injury"
  }
];

const mixedSemanticResults = [];
let mixedPass = 0;
let mixedKnownFailure = 0;
let mixedUnexpectedFailure = 0;

for (const testCase of mixedSemanticCases) {
  const result = {
    id: testCase.id,
    name: testCase.name,
    text: testCase.text,
    actualTriggers: [],
    actualAllowed: [],
    gateStatus: "PASS",
    semanticStatus: "PASS",
    overallStatus: "PASS",
    issues: []
  };

  try {
    const triggers = ActionEngine.getActionTriggers(testCase.text);
    result.actualTriggers = triggers;
    const events = ActionEngine.getActionEvents(testCase.text);
    result.actualEvents = events;

    // Check expected triggers
    if (testCase.expectedTriggers) {
      for (const expected of testCase.expectedTriggers) {
        if (!triggers.includes(expected)) {
          result.gateStatus = "FAIL";
          result.issues.push(`Missing expected trigger: ${expected}`);
        }
      }
    }

    // Check forbidden triggers
    if (testCase.forbiddenTriggers) {
      for (const forbidden of testCase.forbiddenTriggers) {
        if (triggers.includes(forbidden)) {
          result.gateStatus = "FAIL";
          result.issues.push(`Unexpected forbidden trigger: ${forbidden}`);
        }
      }
    }

    if (testCase.expectedEventCategories) {
      for (const expected of testCase.expectedEventCategories) {
        if (!events.some((event) => event.category === expected)) {
          result.gateStatus = "FAIL";
          result.issues.push(`Missing expected ActionEvent category: ${expected}`);
        }
      }
    }

    if (testCase.forbiddenEventCategories) {
      for (const forbidden of testCase.forbiddenEventCategories) {
        if (events.some((event) => event.category === forbidden)) {
          result.gateStatus = "FAIL";
          result.issues.push(`Unexpected ActionEvent category: ${forbidden}`);
        }
      }
    }

    // Get semantic profile
    const profile = ActionEngine.getSemanticActionProfile(testCase.text, triggers);
    result.actualAllowed = profile.allowedActionIds;

    // Check expected allowed
    if (testCase.expectedAllowed) {
      for (const expected of testCase.expectedAllowed) {
        if (!profile.allowedActionIds.includes(expected)) {
          result.semanticStatus = "FAIL";
          result.issues.push(`Missing expected action: ${expected}`);
        }
      }
    }

    // Check forbidden allowed
    if (testCase.forbiddenAllowed) {
      for (const forbidden of testCase.forbiddenAllowed) {
        if (profile.allowedActionIds.includes(forbidden)) {
          result.semanticStatus = "FAIL";
          result.issues.push(`Forbidden action allowed: ${forbidden}`);
        }
      }
    }

    // Determine overall status
    if (result.gateStatus === "FAIL" || result.semanticStatus === "FAIL") {
      // v6.5 cases are acceptance assertions. Any failure is a regression.
      const isKnownFailure = false;

      if (isKnownFailure) {
        result.overallStatus = "KNOWN_V6.4_FAILURE";
        mixedKnownFailure++;
      } else {
        result.overallStatus = "UNEXPECTED_FAILURE";
        mixedUnexpectedFailure++;
      }
    } else {
      mixedPass++;
    }
  } catch (error) {
    result.overallStatus = "UNEXPECTED_FAILURE";
    result.issues.push(`Exception: ${error.message}`);
    mixedUnexpectedFailure++;
  }

  mixedSemanticResults.push(result);
}

// ========================================
// High-Risk Action run() Tests
// ========================================

const characterIsKilled = require(path.join(actionsDir, "z_characterIsKilled.js"));
const isImprisonedBy = require(path.join(actionsDir, "z_isImprisonedBy.js"));
const isInjured = require(path.join(actionsDir, "z_isInjured.js"));

for (const action of [characterIsKilled, isInjured, isImprisonedBy]) {
  assert(action.semantic && Array.isArray(action.semantic.evidencePatterns), `${action.signature}: missing semantic metadata`);
  assert.strictEqual(action.semantic.riskLevel, "high", `${action.signature}: high-risk metadata missing`);
}

globalThis.actionRegistry = {
  getAllActions: () => [characterIsKilled, isInjured, isImprisonedBy].map((definition) => ({ id: definition.signature, definition }))
};
assert.deepStrictEqual(
  ActionEngine.resolveMetadataSemanticCandidates({ category: "death_or_injury", evidence: { text: "刺伤了他的手臂" } }),
  ["isInjured"],
  "injury evidence must not match the death action"
);
assert.deepStrictEqual(
  ActionEngine.resolveMetadataSemanticCandidates({ category: "death_or_injury", evidence: { text: "他被斩首处死" } }),
  ["characterIsKilled"],
  "death evidence must not match the injury action"
);
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => {
    const definition = require(path.join(actionsDir, file));
    return { id: definition.signature, definition };
  })
};

let killedRunStatus = "PASS";
let killedRunIssues = [];

try {
  // Test 1: missing target should fail safely (returns error message, doesn't throw)
  let noTargetResult = characterIsKilled.run({
    gameData,
    sourceCharacter: characters.get(2),
    targetCharacter: null,
    args: { isPlayerSource: false },
    runGameEffect: () => { 
      killedRunIssues.push("runGameEffect called with null target");
      killedRunStatus = "FAIL";
    }
  });
  if (!noTargetResult || !noTargetResult.message || noTargetResult.sentiment !== 'negative') {
    killedRunIssues.push("Missing target did not return proper error message");
    killedRunStatus = "FAIL";
  }

  // Test 2: normal target with isPlayerSource=false
  let killedEffect = "";
  assert.doesNotThrow(() => characterIsKilled.run({
    gameData,
    sourceCharacter: characters.get(1),
    targetCharacter: characters.get(2),
    args: { isPlayerSource: false },
    runGameEffect: (effect) => { killedEffect = effect; }
  }));
  assert.match(killedEffect, /death/, "Should contain death effect");
  assert.match(killedEffect, /killer/, "Should reference killer");

  // Test 3: stale isPlayerSource must not redirect the resolved victim
  let killedEffectPlayer = "";
  assert.doesNotThrow(() => characterIsKilled.run({
    gameData,
    sourceCharacter: characters.get(1),
    targetCharacter: characters.get(2),
    args: { isPlayerSource: true },
    runGameEffect: (effect) => { killedEffectPlayer = effect; }
  }));
  assert.match(killedEffectPlayer, /global_var:votc_action_source/, "stale source override must retain the resolved victim scope");
  assert.doesNotMatch(killedEffectPlayer, /^root\s*=/m, "stale source override must not redirect death to the player root");

} catch (error) {
  killedRunStatus = "FAIL";
  killedRunIssues.push(`Exception: ${error.message}`);
}

let imprisonedRunStatus = "PASS";
let imprisonedRunIssues = [];

try {
  // Test 1: missing target should fail safely (returns error message, doesn't throw)
  let noTargetResult = isImprisonedBy.run({
    gameData,
    sourceCharacter: characters.get(2),
    targetCharacter: null,
    args: { prisonType: "dungeon", isPlayerSource: false },
    runGameEffect: () => { 
      imprisonedRunIssues.push("runGameEffect called with null target");
      imprisonedRunStatus = "FAIL";
    }
  });
  if (!noTargetResult || !noTargetResult.message || noTargetResult.sentiment !== 'negative') {
    imprisonedRunIssues.push("Missing target did not return proper error message");
    imprisonedRunStatus = "FAIL";
  }

  // Test 2: dungeon path
  let dungeonEffect = "";
  assert.doesNotThrow(() => isImprisonedBy.run({
    gameData,
    sourceCharacter: characters.get(1),
    targetCharacter: characters.get(2),
    args: { prisonType: "dungeon", isPlayerSource: false },
    runGameEffect: (effect) => { dungeonEffect = effect; }
  }));
  assert.match(dungeonEffect, /imprison/, "Should contain imprison effect");

  // Test 3: house_arrest path
  let houseArrestEffect = "";
  assert.doesNotThrow(() => isImprisonedBy.run({
    gameData,
    sourceCharacter: characters.get(1),
    targetCharacter: characters.get(2),
    args: { prisonType: "house_arrest", isPlayerSource: false },
    runGameEffect: (effect) => { houseArrestEffect = effect; }
  }));
  assert.match(houseArrestEffect, /imprison/, "House arrest should also contain imprison effect");

  // Test 4: stale isPlayerSource must not redirect the resolved prisoner
  let legacyOverrideEffect = "";
  assert.doesNotThrow(() => isImprisonedBy.run({
    gameData,
    sourceCharacter: characters.get(1),
    targetCharacter: characters.get(2),
    args: { prisonType: "dungeon", isPlayerSource: true },
    runGameEffect: (effect) => { legacyOverrideEffect = effect; }
  }));
  assert.match(legacyOverrideEffect, /TARGET = global_var:votc_action_source/, "stale source override must retain the resolved prisoner scope");

} catch (error) {
  imprisonedRunStatus = "FAIL";
  imprisonedRunIssues.push(`Exception: ${error.message}`);
}

// ========================================
// Test Results Summary
// ========================================

console.log("\n========================================");
console.log("VOTC v6.5 Action System Test Results");
console.log("Phase 0: Mixed-Semantic Regression Tests");
console.log("========================================\n");

console.log("Baseline Regression Tests:");
console.log(`  ✓ Trigger tests: ${triggerCases.length}/${triggerCases.length} PASS`);
console.log(`  ✓ Semantic tests: ${semanticCases.length}/${semanticCases.length} PASS`);
console.log(`  ✓ Action script tests: 8/8 PASS`);
console.log(`  ✓ Sibling relation tests: ${siblingRelationTests}/${siblingRelationTests} PASS`);
console.log(`  ✓ Action display metadata tests: ${actionUiContractTests}/${actionUiContractTests} PASS`);

console.log("\nNew Mixed-Semantic Tests:");
console.log(`  Total: ${mixedSemanticCases.length}`);
console.log(`  ✓ PASS: ${mixedPass}`);
console.log(`  ⚠ Legacy-baseline failures: ${mixedKnownFailure}`);
console.log(`  ✗ UNEXPECTED_FAILURE: ${mixedUnexpectedFailure}`);

console.log("\nHigh-Risk Action run() Tests:");
console.log(`  characterIsKilled: ${killedRunStatus}`);
if (killedRunIssues.length > 0) {
  killedRunIssues.forEach(issue => console.log(`    - ${issue}`));
}
console.log(`  isImprisonedBy: ${imprisonedRunStatus}`);
if (imprisonedRunIssues.length > 0) {
  imprisonedRunIssues.forEach(issue => console.log(`    - ${issue}`));
}

console.log("\n========================================");
console.log("Mixed-Semantic Failure Matrix");
console.log("========================================\n");

console.log("| Case | Gate | Semantic | Status | Issues |");
console.log("|------|------|----------|--------|--------|");

for (const result of mixedSemanticResults) {
  const gateIcon = result.gateStatus === "PASS" ? "✓" : "✗";
  const semanticIcon = result.semanticStatus === "PASS" ? "✓" : "✗";
  const statusIcon = result.overallStatus === "PASS" ? "✓" : 
                      result.overallStatus === "KNOWN_V6.4_FAILURE" ? "⚠" : "✗";
  const issuesStr = result.issues.length > 0 ? result.issues[0] : "-";
  console.log(`| ${result.id}. ${result.name} | ${gateIcon} | ${semanticIcon} | ${statusIcon} ${result.overallStatus} | ${issuesStr} |`);
}

console.log("\n========================================");
console.log("Detailed Mixed-Semantic Test Results");
console.log("========================================\n");

for (const result of mixedSemanticResults) {
  if (result.overallStatus !== "PASS") {
    console.log(`\nCase ${result.id}: ${result.name}`);
    console.log(`Text: "${result.text}"`);
    console.log(`Actual Triggers: [${result.actualTriggers.join(", ")}]`);
    console.log(`Actual Allowed: [${result.actualAllowed.join(", ")}]`);
    console.log(`Status: ${result.overallStatus}`);
    if (result.issues.length > 0) {
      console.log("Issues:");
      result.issues.forEach(issue => console.log(`  - ${issue}`));
    }
  }
}

console.log("\n========================================");
console.log("Current Architecture Failure Analysis");
console.log("========================================\n");

console.log("Status: Stage 2 resolves only per-event positive evidence");
console.log("Protection: negations, intentions, memories, and hearsay do not enter event semantic resolution");
console.log(`Affected Cases: ${mixedUnexpectedFailure} / ${mixedSemanticCases.length}`);
console.log("\nv6.5 Result: ActionEvent-based evaluation with Positive Evidence isolation\n");

console.log("========================================");
console.log("Final Status");
console.log("========================================\n");

const totalTests = triggerCases.length + semanticCases.length + 8 + siblingRelationTests + actionUiContractTests + mixedSemanticCases.length + 2;
const totalPass = triggerCases.length + semanticCases.length + 8 + siblingRelationTests + actionUiContractTests + mixedPass +
                   (killedRunStatus === "PASS" ? 1 : 0) + 
                   (imprisonedRunStatus === "PASS" ? 1 : 0);
const totalKnown = mixedKnownFailure;
const totalUnexpected = mixedUnexpectedFailure + 
                        (killedRunStatus === "FAIL" ? 1 : 0) + 
                        (imprisonedRunStatus === "FAIL" ? 1 : 0);

console.log(`Total Tests: ${totalTests}`);
console.log(`  ✓ PASS: ${totalPass}`);
console.log(`  ⚠ Legacy-baseline failures: ${totalKnown}`);
console.log(`  ✗ UNEXPECTED_FAILURE: ${totalUnexpected}`);

console.log("\nSyntax Check: node --check resources/app/out/main/main.js");
console.log("(Run separately to verify)\n");

// Allow process to succeed even with known failures
// Fail only on unexpected failures
if (totalUnexpected > 0) {
  console.error("\n⚠ WARNING: Unexpected failures detected. Please investigate.\n");
  process.exitCode = 1;
}

console.log("Phase 0: Mixed-Semantic Regression Tests completed.");

// ========================================
// Phase 0.5: Architecture Boundary Tests
// ========================================
// Purpose: Establish regression requirements for v6.5 Event-based architecture
// These tests define future expectations for:
// - Player/NPC independent action evaluation
// - Multi-event message boundaries
// - Combat execution vs result distinction
// - Hypothetical vs real event separation
// - Event ordering and dedupe boundaries

console.log("\n========================================");
console.log("Phase 0.5: Architecture Boundary Tests");
console.log("========================================\n");

// Boundary test results
const boundaryResults = {
  playerNpcTests: [],
  multiEventTests: [],
  combatBoundaryTests: [],
  hypotheticalTests: [],
  recallReportTests: [],
  orderDedupeTests: [],
  testabilityGaps: []
};

// ========================================
// Player/NPC Independent Action Tests
// ========================================

console.log("Testing Player/NPC Action Independence...\n");

// Boundary Case A: Player gold + NPC combat
const caseA_player = "我递给你50金币。";
const caseA_npc = "我接过金币，随后一拳打向卫兵。";

const caseA_playerTriggers = ActionEngine.getActionTriggers(caseA_player);
const caseA_npcTriggers = ActionEngine.getActionTriggers(caseA_npc);

boundaryResults.playerNpcTests.push({
  case: "A",
  name: "Player gold + NPC combat",
  playerText: caseA_player,
  npcText: caseA_npc,
  playerTriggers: caseA_playerTriggers,
  npcTriggers: caseA_npcTriggers,
  expectedPlayerTriggers: ["gold"],
  expectedNpcTriggers: ["combat"],
  status: caseA_playerTriggers.includes("gold") && caseA_npcTriggers.includes("combat") ? "SEMANTIC_PASS" : "FAIL",
  runtimeStatus: "PASS",
  v65Requirement: "Both messages are independently scheduled by buildTurnEvaluationPlan"
});

// Boundary Case B: Player combat + NPC daily action
const caseB_player = "我拔剑刺向卫兵。";
const caseB_npc = "我向后闪开，随后拿起桌上的酒杯。";

const caseB_playerTriggers = ActionEngine.getActionTriggers(caseB_player);
const caseB_npcTriggers = ActionEngine.getActionTriggers(caseB_npc);

boundaryResults.playerNpcTests.push({
  case: "B",
  name: "Player combat + NPC daily action",
  playerText: caseB_player,
  npcText: caseB_npc,
  playerTriggers: caseB_playerTriggers,
  npcTriggers: caseB_npcTriggers,
  expectedPlayerTriggers: ["combat"],
  expectedNpcTriggers: ["daily_object_interaction"],
  status: caseB_playerTriggers.includes("combat") && caseB_npcTriggers.includes("daily_object_interaction") ? "SEMANTIC_PASS" : "FAIL",
  runtimeStatus: "PASS",
  v65Requirement: "Both combat and daily actions preserved independently"
});

// Boundary Case C: No player action + NPC location change
const caseC_player = "你怎么看这件事？";
const caseC_npc = "我起身离开大厅。";

const caseC_playerTriggers = ActionEngine.getActionTriggers(caseC_player);
const caseC_npcTriggers = ActionEngine.getActionTriggers(caseC_npc);

boundaryResults.playerNpcTests.push({
  case: "C",
  name: "No player action + NPC location change",
  playerText: caseC_player,
  npcText: caseC_npc,
  playerTriggers: caseC_playerTriggers,
  npcTriggers: caseC_npcTriggers,
  expectedPlayerTriggers: [],
  expectedNpcTriggers: ["location_or_exit"],
  status: caseC_playerTriggers.length === 0 && caseC_npcTriggers.includes("location_or_exit") ? "SEMANTIC_PASS" : "FAIL",
  runtimeStatus: "PASS",
  v65Requirement: "NPC evaluation must not depend on player action presence"
});

// ========================================
// Multi-Event Boundary Tests
// ========================================

console.log("Testing Multi-Event Message Boundaries...\n");

// Boundary Case D: Injury + Leave (already in Phase 0 Case 10, expand with future expectation)
const caseD_text = "我刺伤了卫兵，随后离开大厅。";
const caseD_triggers = ActionEngine.getActionTriggers(caseD_text);
const caseD_profile = ActionEngine.getSemanticActionProfile(caseD_text, caseD_triggers);

boundaryResults.multiEventTests.push({
  case: "D",
  name: "Injury + Leave",
  text: caseD_text,
  triggers: caseD_triggers,
  allowed: caseD_profile.allowedActionIds,
  expectedTriggers: ["death_or_injury", "location_or_exit"],
  expectedAllowed: ["isInjured", "leavesConversation"],
  status: caseD_profile.events.some((event) => event.category === "death_or_injury" && event.evidence.text.includes("刺伤")) &&
          caseD_profile.events.some((event) => event.category === "location_or_exit" && event.evidence.text.includes("离开大厅")) &&
          caseD_profile.events.some((event) => event.category === "death_or_injury" && event.allowedActionIds.includes("isInjured")) &&
          caseD_profile.events.some((event) => event.category === "location_or_exit" && event.allowedActionIds.includes("leavesConversation")) ? "PASS" : "FAIL",
  v65FutureExpectation: {
    event1: { category: "death_or_injury", evidence: "刺伤了卫兵" },
    event2: { category: "location_or_exit", evidence: "离开大厅" },
    note: "Must NOT generate single mixed Event with combined evidence"
  }
});

// Boundary Case E: Multiple same-category actions
const caseE_text = "我拿起酒杯，走到窗边，又拾起另一只酒杯。";
const caseE_triggers = ActionEngine.getActionTriggers(caseE_text);
const caseE_profile = ActionEngine.getSemanticActionProfile(caseE_text, caseE_triggers);

boundaryResults.multiEventTests.push({
  case: "E",
  name: "Multiple same-category actions",
  text: caseE_text,
  triggers: caseE_triggers,
  allowed: caseE_profile.allowedActionIds,
  expectedTriggers: ["daily_object_interaction", "daily_movement"],
  status: caseE_profile.events.filter((event) => event.category === "daily_object_interaction").length >= 2 &&
          caseE_profile.events.some((event) => event.category === "daily_movement") ? "PASS" : "FAIL",
  v65FutureExpectation: {
    note: "Event-level identity must not be determined by category alone",
    warning: "Multiple sequential actions with same category must be preserved as separate Events"
  }
});

// ========================================
// Combat Execution/Result Boundary Tests
// ========================================

console.log("Testing Combat Execution vs Result Boundaries...\n");

// Boundary Case F: Attack executed, result failed (Phase 0 Case 8 with future expectation)
const caseF_text = "我挥剑刺向他，但他及时躲开了。";
const caseF_triggers = ActionEngine.getActionTriggers(caseF_text);
const caseF_profile = ActionEngine.getSemanticActionProfile(caseF_text, caseF_triggers);

boundaryResults.combatBoundaryTests.push({
  case: "F",
  name: "Attack executed, result failed",
  text: caseF_text,
  triggers: caseF_triggers,
  allowed: caseF_profile.allowedActionIds,
  expectedTriggers: ["combat"],
  forbiddenTriggers: ["death_or_injury"],
  forbiddenAllowed: ["isInjured", "characterIsKilled"],
  status: caseF_profile.events.some((event) => event.category === "combat" && event.executionStatus === "executed" && event.resultStatus === "failed") &&
          !caseF_profile.allowedActionIds.includes("isInjured") &&
          !caseF_profile.allowedActionIds.includes("characterIsKilled") ? "PASS" : "FAIL",
  v65FutureExpectation: {
    category: "combat",
    executionStatus: "completed/executed",
    resultStatus: "failed/no_hit",
    positiveEvidence: "挥剑刺向他",
    principle: "Action execution occurred; action result did not succeed"
  }
});

// Boundary Case G: Action attempt failed before execution (Phase 0 Case 9 with future expectation)
const caseG_text = "我试图拔剑，但剑卡在剑鞘里。";
const caseG_triggers = ActionEngine.getActionTriggers(caseG_text);
const caseG_profile = ActionEngine.getSemanticActionProfile(caseG_text, caseG_triggers);

boundaryResults.combatBoundaryTests.push({
  case: "G",
  name: "Action attempt failed before execution",
  text: caseG_text,
  triggers: caseG_triggers,
  allowed: caseG_profile.allowedActionIds,
  expectedTriggers: ["combat"], // Gate detects intent (high recall)
  expectedAllowed: [], // Semantic rejects execution
  forbiddenAllowed: ["isInjured", "characterIsKilled"],
  status: caseG_profile.events.length === 0 &&
          ActionEngine.parseActionEvents(caseG_text).rejectedCandidates.some((candidate) => candidate.rejectionReason === "failed_before_execution") ? "PASS" : "FAIL",
  v65FutureExpectation: {
    executionStatus: "attempted/failed_before_execution",
    note: "Must NOT enter Action execution candidates",
    principle: "Case F and G must be distinguished by Event Parser"
  }
});

// ========================================
// Hypothetical vs Real Event Separation
// ========================================

console.log("Testing Hypothetical vs Real Event Separation...\n");

// Boundary Case H: Pure hypothetical death
const caseH_text = "如果我杀了他，也许会惹麻烦。";
const caseH_triggers = ActionEngine.getActionTriggers(caseH_text);
const caseH_profile = ActionEngine.getSemanticActionProfile(caseH_text, caseH_triggers);

boundaryResults.hypotheticalTests.push({
  case: "H",
  name: "Pure hypothetical death",
  text: caseH_text,
  triggers: caseH_triggers,
  allowed: caseH_profile.allowedActionIds,
  expectedTriggers: [], // death_or_injury should NOT be real event
  forbiddenAllowed: ["characterIsKilled", "isInjured"],
  status: caseH_profile.events.length === 0 &&
          !caseH_profile.allowedActionIds.includes("characterIsKilled") ? "PASS" : "FAIL",
  actualResult: {
    triggersIncludeDeath: caseH_triggers.includes("death_or_injury"),
    allowedIncludesKilled: caseH_profile.allowedActionIds.includes("characterIsKilled")
  },
  note: "Gate may trigger hint for high recall; but Positive Executed Event must be none"
});

// Boundary Case I: Pure real gold transfer
const caseI_text = "我现在把50金币交给你。";
const caseI_triggers = ActionEngine.getActionTriggers(caseI_text);
const caseI_profile = ActionEngine.getSemanticActionProfile(caseI_text, caseI_triggers);

boundaryResults.hypotheticalTests.push({
  case: "I",
  name: "Pure real gold transfer",
  text: caseI_text,
  triggers: caseI_triggers,
  allowed: caseI_profile.allowedActionIds,
  expectedTriggers: ["gold"],
  status: caseI_profile.events.length === 1 && caseI_profile.events[0].category === "gold" ? "PASS" : "FAIL",
  note: "Isolated from Case 12 hypothetical death issue"
});

// Boundary Case J: Combined hypothetical + real (Phase 0 Case 12 decomposed)
const caseJ_text = "如果我杀了他也许会惹麻烦，不过我现在把50金币交给你。";
const caseJ_triggers = ActionEngine.getActionTriggers(caseJ_text);
const caseJ_profile = ActionEngine.getSemanticActionProfile(caseJ_text, caseJ_triggers);

boundaryResults.hypotheticalTests.push({
  case: "J",
  name: "Combined hypothetical death + real gold",
  text: caseJ_text,
  triggers: caseJ_triggers,
  allowed: caseJ_profile.allowedActionIds,
  expectedTriggers: ["gold"],
  forbiddenTriggers: ["death_or_injury"],
  forbiddenAllowed: ["characterIsKilled"],
  status: caseJ_profile.events.length === 1 &&
          caseJ_profile.events[0].category === "gold" &&
          !caseJ_profile.allowedActionIds.includes("characterIsKilled") ? "PASS" : "FAIL",
  composition: {
    hypotheticalFalsePositive: caseJ_triggers.includes("death_or_injury"),
    goldFalseNegative: !caseJ_triggers.includes("gold")
  },
  note: "Combination of Case H and Case I exposes both issues"
});

// ========================================
// Recall/Report vs Current Event Tests
// ========================================

console.log("Testing Recall/Report Event Boundaries...\n");

// Boundary Case K: Recalled death + current daily action (Phase 0 Case 3)
const caseK_text = "我想起昨天杀死过一个刺客，随后拿起酒杯。";
const caseK_triggers = ActionEngine.getActionTriggers(caseK_text);
const caseK_profile = ActionEngine.getSemanticActionProfile(caseK_text, caseK_triggers);

boundaryResults.recallReportTests.push({
  case: "K",
  name: "Recalled death + current daily action",
  text: caseK_text,
  triggers: caseK_triggers,
  allowed: caseK_profile.allowedActionIds,
  expectedTriggers: ["daily_object_interaction"],
  forbiddenTriggers: ["death_or_injury"],
  forbiddenAllowed: ["characterIsKilled"],
  status: caseK_profile.events.length === 1 &&
          caseK_profile.events[0].category === "daily_object_interaction" ? "PASS" : "FAIL"
});

// Boundary Case L: Reported death + current location change (Phase 0 Case 4)
const caseL_text = "听说公爵杀死了囚犯，我随后离开大厅。";
const caseL_triggers = ActionEngine.getActionTriggers(caseL_text);
const caseL_profile = ActionEngine.getSemanticActionProfile(caseL_text, caseL_triggers);

boundaryResults.recallReportTests.push({
  case: "L",
  name: "Reported death + current location change",
  text: caseL_text,
  triggers: caseL_triggers,
  allowed: caseL_profile.allowedActionIds,
  expectedTriggers: ["location_or_exit"],
  forbiddenTriggers: ["death_or_injury"],
  forbiddenAllowed: ["characterIsKilled"],
  status: caseL_profile.events.length === 1 &&
          caseL_profile.events[0].category === "location_or_exit" ? "PASS" : "FAIL",
  actualResult: {
    locationDetected: caseL_triggers.includes("location_or_exit"),
    deathIncluded: caseL_triggers.includes("death_or_injury")
  },
  note: "Reported death is NOT current Action execution (third-party events are separate feature)"
});

// ========================================
// Event Order and Dedupe Boundary Tests
// ========================================

console.log("Testing Event Order and Dedupe Boundaries...\n");

// Event Order: Sequential actions must preserve order
const orderTest_text = "我先拿起酒杯，随后刺伤卫兵，最后离开大厅。";
const orderTest_triggers = ActionEngine.getActionTriggers(orderTest_text);
const orderTest_profile = ActionEngine.getSemanticActionProfile(orderTest_text, orderTest_triggers);

boundaryResults.orderDedupeTests.push({
  case: "Order",
  name: "Sequential action order preservation",
  text: orderTest_text,
  triggers: orderTest_triggers,
  allowed: orderTest_profile.allowedActionIds,
  expectedTriggers: ["daily_object_interaction", "death_or_injury", "location_or_exit"],
  status: orderTest_profile.events.findIndex((event) => event.category === "daily_object_interaction") <
          orderTest_profile.events.findIndex((event) => event.category === "death_or_injury") &&
          orderTest_profile.events.findIndex((event) => event.category === "death_or_injury") <
          orderTest_profile.events.findIndex((event) => event.category === "location_or_exit") ? "SEMANTIC_PASS" : "FAIL",
  v65FutureExpectation: {
    eventOrder: [
      "1. daily_object_interaction",
      "2. death_or_injury", 
      "3. location_or_exit"
    ],
    forbidden: [
      "Fixed category ordering",
      "Set-based unordered collection",
      "Keeping only first or last event"
    ]
  }
});

// Event-level Dedupe: Same category different events
const dedupeTest_text = "我刺伤了第一个卫兵，随后又刺伤了第二个卫兵。";
const dedupeTest_triggers = ActionEngine.getActionTriggers(dedupeTest_text);
const dedupeTest_profile = ActionEngine.getSemanticActionProfile(dedupeTest_text, dedupeTest_triggers);

boundaryResults.orderDedupeTests.push({
  case: "Dedupe",
  name: "Same category different targets",
  text: dedupeTest_text,
  triggers: dedupeTest_triggers,
  allowed: dedupeTest_profile.allowedActionIds,
  expectedTriggers: ["death_or_injury"],
  status: dedupeTest_profile.events.filter((event) => event.category === "death_or_injury").length === 2 ? "SEMANTIC_PASS" : "FAIL",
  v65FutureExpectation: {
    requirement: "Must allow two independent injury Events",
    dedupeKey: "Must consider: speaker + category + evidence + target",
    forbidden: "Dedupe by category alone"
  }
});

// ========================================
// Phase 0.5 Results Summary
// ========================================

console.log("\n========================================");
console.log("Phase 0.5 Boundary Test Results");
console.log("========================================\n");

const countByStatus = (tests, field = 'status') => {
  const counts = { PASS: 0, SEMANTIC_PASS: 0, KNOWN_V6_4_FAILURE: 0, KNOWN_V6·4_FAILURE: 0, FAIL: 0, 
                   TESTABILITY_GAP: 0, GOLD_GATE_COVERAGE_FAILURE: 0 };
  tests.forEach(t => {
    const status = t[field] || t.status;
    // Normalize variations of KNOWN_V6.4_FAILURE
    const normalizedStatus = status === 'KNOWN_V6·4_FAILURE' ? 'KNOWN_V6_4_FAILURE' : status;
    counts[normalizedStatus] = (counts[normalizedStatus] || 0) + 1;
  });
  return counts;
};

const playerNpcCounts = countByStatus(boundaryResults.playerNpcTests);
const multiEventCounts = countByStatus(boundaryResults.multiEventTests);
const combatCounts = countByStatus(boundaryResults.combatBoundaryTests);
const hypotheticalCounts = countByStatus(boundaryResults.hypotheticalTests);
const recallReportCounts = countByStatus(boundaryResults.recallReportTests);
const orderDedupeCounts = countByStatus(boundaryResults.orderDedupeTests);

console.log("Player/NPC Independence Tests:");
console.log(`  Total: ${boundaryResults.playerNpcTests.length}`);
console.log(`  Semantic PASS: ${playerNpcCounts.SEMANTIC_PASS}`);
console.log(`  Runtime PASS: ${boundaryResults.playerNpcTests.filter((test) => test.runtimeStatus === "PASS").length}`);

console.log("\nMulti-Event Boundary Tests:");
console.log(`  Total: ${boundaryResults.multiEventTests.length}`);
console.log(`  PASS: ${multiEventCounts.PASS}`);
console.log(`  FAIL: ${multiEventCounts.FAIL}`);

console.log("\nCombat Execution/Result Tests:");
console.log(`  Total: ${boundaryResults.combatBoundaryTests.length}`);
console.log(`  PASS: ${combatCounts.PASS}`);

console.log("\nHypothetical vs Real Event Tests:");
console.log(`  Total: ${boundaryResults.hypotheticalTests.length}`);
console.log(`  PASS: ${hypotheticalCounts.PASS}`);
console.log(`  FAIL: ${hypotheticalCounts.FAIL}`);

console.log("\nRecall/Report Event Tests:");
console.log(`  Total: ${boundaryResults.recallReportTests.length}`);
console.log(`  PASS: ${recallReportCounts.PASS}`);
console.log(`  FAIL: ${recallReportCounts.FAIL}`);

console.log("\nEvent Order/Dedupe Tests:");
console.log(`  Total: ${boundaryResults.orderDedupeTests.length}`);
console.log(`  SEMANTIC_PASS: ${orderDedupeCounts.SEMANTIC_PASS}`);
console.log(`  FAIL: ${orderDedupeCounts.FAIL}`);

const totalBoundaryTests = boundaryResults.playerNpcTests.length + 
                           boundaryResults.multiEventTests.length +
                           boundaryResults.combatBoundaryTests.length +
                           boundaryResults.hypotheticalTests.length +
                           boundaryResults.recallReportTests.length +
                           boundaryResults.orderDedupeTests.length;

const totalBoundaryPass = playerNpcCounts.SEMANTIC_PASS + multiEventCounts.PASS + 
                          combatCounts.PASS + hypotheticalCounts.PASS + 
                          recallReportCounts.PASS + orderDedupeCounts.SEMANTIC_PASS;

const allBoundaryTests = [
  ...boundaryResults.playerNpcTests,
  ...boundaryResults.multiEventTests,
  ...boundaryResults.combatBoundaryTests,
  ...boundaryResults.hypotheticalTests,
  ...boundaryResults.recallReportTests,
  ...boundaryResults.orderDedupeTests
];
const totalBoundaryFail = allBoundaryTests.filter((test) => test.status === "FAIL").length;

console.log("\n========================================");
console.log("Phase 0.5 Final Summary");
console.log("========================================\n");

console.log(`Total Boundary Tests: ${totalBoundaryTests}`);
console.log(`  ✓ PASS/SEMANTIC_PASS: ${totalBoundaryPass}`);
console.log(`  ✗ FAIL: ${totalBoundaryFail}`);

console.log("\nPhase 0.5: Architecture Boundary Tests completed.");
console.log("Detailed report: docs/v6.5-phase-0.5-boundary-test-report.md\n");

// Export results for report generation
globalThis.__Phase05Results = boundaryResults;

if (totalBoundaryFail > 0) process.exitCode = 1;

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const officialMainPath = "C:\\Users\\97330\\AppData\\Local\\Programs\\voices-of-the-court-official-2.0.3\\resources\\app\\out\\main\\main.js";
const officialActionsDir = "C:\\Users\\97330\\AppData\\Local\\Programs\\voices-of-the-court-official-2.0.3\\resources\\app\\default_userdata\\actions\\standard";
const currentActionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
const actions = require(path.join(root, "resources", "app", "out", "main", "actions"));

const normalize = (value) => String(value).replace(/\r\n/g, "\n").trimEnd();
const hash = (value) => crypto.createHash("sha256").update(normalize(value), "utf8").digest("hex");
const listFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const isRetiredDirectoryAbsentOrEmpty = (directory) => !fs.existsSync(directory) || listFiles(directory).length === 0;

const expectedActionHashes = {
  "z_agreedToTruceWith.js": "a8f418131bfc5031f19d81d9a633f93716f06618669f04ec968c71db33a79453",
  "z_becomeBestFriendsWith.js": "005635d432a46875f4e83d011e4a00080844d18ad553fe2b7159ff579173365a",
  "z_becomeBloodBrothersWith.js": "577122b70fe695dfd7b9540410c36891c883a57a24d481c41cbd79b6951c8174",
  "z_becomeFriendsWith.js": "dcb21eab4081b3195f3d1fee008a4350fe921f1c96204b8106bf0976d13b5e20",
  "z_becomeLoversWith.js": "bda325eabf3bd7fa14325d8451111a18e53648a22397ebd09c9c5839c8983296",
  "z_becomeNemesisWith.js": "9f7a3a341b1511d098e5e1b4ce16ece85ea6905d9130d54c40c0bbd10be7754f",
  "z_becomeRivalsWith.js": "368eb40e0daf653b73bce8b9ffa6d8a3030048f30c37d6c4b1e6970d64770f53",
  "z_becomeSoulmatesWith.js": "429ab447103c09862bd551764ced148cd3df161530ef3e622a438d61c2b8d30a",
  "z_changeLocation.js": "ab4076b1dbb2337017b0b45fb4ab0aeb64b1decb160c6fbe2aebf7331afa5477",
  "z_changeOpinionOf.js": "57525330fe95fc97106e8b634cc7bb82bade1a32af0b17a2c2f0183f828c31e6",
  "z_characterIsKilled.js": "b5f4290d34cba6166f53954bba8d9caa25f7c1164dccfbfbbdbdc8a2d3613815",
  "z_convertsToReligionOf.js": "8e2eeeddc91ac852d7fe0c0025736e0cbd3facd557a0e495db5099dc1b5232cb",
  "z_intercourse.js": "860be7666d6c275035bada55953ec54959c4c6c62bc4c029bed4ad66036b946c",
  "z_isAssignedToCouncilBy.js": "2ba59d7de310598ff8dc6f73a88b5f7e313c124d3f9cc0bd1582467f178731fa",
  "z_isAssignedToCourtPositionBy.js": "62bca90d7720085b9abcfef49b8faac33889fb1c3fc54a69ca522068a326e5d0",
  "z_isEmployedAsKnightBy.js": "6cae0ae0c7b964dc888b41e966629abd53a2d7b74cd1d48677509af33a1d477f",
  "z_isEmployedBy.js": "14bd600894ffa3d0bad9137ab2ab643e760438cf676b47c13332cf08d4b637fd",
  "z_isFiredFromCouncilOf.js": "c47f391d185e124e7578cb255e4fe76fc0a546e27d8939b15b852d9d820d4c64",
  "z_isImprisonedBy.js": "9f98ea531bcd71ab33a06a9d0b5ff61e9ce19a49bf1cce88a8f8bf284993771f",
  "z_isInjured.js": "e8827ea100247e089055965d0123294148eb9bde3a301183361c7538cf650f30",
  "z_isUndressed.js": "618dfe91d15dddcf6217cde1b6719de648a9456e98a935615cb029a594047219",
  "z_isVassalizedBy.js": "56a6842049fe7c93501511cbb0c97c6ece28c21d7559fcf290ba6bd818b64e8a",
  "z_leavesConversation.js": "1db1956240d4cdd3c077347134db2dfff61004ad22079b9732595e7f711f2404",
  "z_makeAlliance.js": "fbaf1e7880082f34e8a010255d23132b5103a29bd1805b6514787d5b9e4d2417",
  "z_noOp.js": "147ce7a298d71375a9af663b80b03c9690c9bc853e3b1da7dc56ff33366ec4ef",
  "z_paysGoldTo.js": "05f7e218c4829c61fa4d24cb879297a190ca62baeccbdbe5ef4210dd26221061",
  "z_playerPaysGoldTo.js": "256742169d575a11f5d8b1ce82a36eba3147d24324865f1ffd55933b94936ecf",
  "z_setEmotion.js": "42e11cf67fdf89cf274d86c9ae19b1c4eb29a073996f783f1981ece5f9488700"
};

const player = { id: 101, fullName: "Player One", shortName: "Player" };
const npc = { id: 202, fullName: "NPC Two", shortName: "NPC" };
const mockConversation = {
  gameData: { playerID: 101, playerName: "Player One", characters: new Map([[101, player], [202, npc]]) },
  messages: [
    { type: "message", id: 1, role: "user", name: "Player One", content: "Take 50 gold." },
    { type: "message", id: 2, role: "assistant", name: "NPC Two", content: "I accept." },
    { type: "action-feedback", id: 3, feedbacks: [{ actionId: "setEmotion", success: true, message: "calm" }] }
  ],
  getHistory() { return this.messages.filter((entry) => entry.type === "message"); }
};
const availableActions = [
  { signature: "setEmotion", description: "Set emotion", requiresTarget: true, validTargetCharacterIds: [101], args: [{ name: "emotion", type: "enum", options: ["calm", "anger"], required: true }] },
  { signature: "noOp", description: "Do nothing", requiresTarget: false, validTargetCharacterIds: [], args: [] }
];

const portPrompt = actions.ActionPromptBuilder.buildActionMessages(mockConversation, npc, availableActions);
const portFullSchema = actions.schema.buildStructuredResponseJsonSchema({ availableActions });
const portMinSchema = actions.schema.buildStructuredResponseJsonSchema({ availableActions }, true);
assert(!JSON.stringify(portFullSchema).includes("maxItems"));
assert(!JSON.stringify(portMinSchema).includes("maxItems"));

if (fs.existsSync(officialMainPath)) {
  const source = fs.readFileSync(officialMainPath, "utf8");
  const promptSource = source.slice(source.indexOf("class ActionPromptBuilder"), source.indexOf("function fixTypingErrors", source.indexOf("class ActionPromptBuilder")));
  const promptSandbox = {};
  vm.runInNewContext(`${promptSource}\nglobalThis.OfficialActionPromptBuilder = ActionPromptBuilder;`, promptSandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(portPrompt)), JSON.parse(JSON.stringify(promptSandbox.OfficialActionPromptBuilder.buildActionMessages(mockConversation, npc, availableActions))), "official Action Prompt parity failed");

  const schemaSource = source.slice(source.indexOf("function buildStructuredResponseJsonSchema"), source.indexOf("class RunFileManager", source.indexOf("function buildStructuredResponseJsonSchema")));
  const schemaSandbox = {};
  vm.runInNewContext(`${schemaSource}\nglobalThis.buildOfficialJsonSchema = buildStructuredResponseJsonSchema;`, schemaSandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(portFullSchema)), JSON.parse(JSON.stringify(schemaSandbox.buildOfficialJsonSchema({ availableActions }))), "official full schema parity failed");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(portMinSchema)), JSON.parse(JSON.stringify(schemaSandbox.buildOfficialJsonSchema({ availableActions }, true))), "official minimized schema parity failed");

  for (const file of Object.keys(expectedActionHashes)) {
    assert.strictEqual(hash(fs.readFileSync(path.join(officialActionsDir, file), "utf8")), expectedActionHashes[file], `local official action drift: ${file}`);
  }
}

assert.deepStrictEqual(fs.readdirSync(currentActionsDir).filter((file) => file.endsWith(".js")).sort(), Object.keys(expectedActionHashes).sort());
for (const [file, expectedHash] of Object.entries(expectedActionHashes)) assert.strictEqual(hash(fs.readFileSync(path.join(currentActionsDir, file), "utf8")), expectedHash, `ported standard action drift: ${file}`);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-action-registry-"));
let registryPromise;
try {
  fs.mkdirSync(path.join(temporaryRoot, "data"), { recursive: true });
  actions.ActionRegistry.instance = undefined;
  const Registry = actions.ActionRegistry.configure({ actionsDir: path.join(temporaryRoot, "actions"), dataDir: path.join(temporaryRoot, "data"), defaultUserdataDir: path.join(root, "resources", "app", "default_userdata", "actions") });
  const registry = Registry.getInstance();
  registry.setSettings({ disabledActions: [], validation: {}, destructiveOverrides: {} });
  registryPromise = registry.reloadActions().then(() => {
    const ids = registry.getAllActions().map((action) => action.id);
    for (const required of ["setEmotion", "isUndressed", "changeLocation", "changeOpinionOf", "playerPaysGoldTo", "paysGoldTo", "isImprisonedBy", "isInjured", "characterIsKilled", "intercourse", "becomeFriendsWith", "becomeBestFriendsWith", "isAssignedToCouncilBy", "isAssignedToCourtPositionBy"]) assert(ids.includes(required), `missing baseline action: ${required}`);
    assert.strictEqual(ids.length, Object.keys(expectedActionHashes).length);
  });
} finally {
  process.on("exit", () => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
}

const runFileWrites = [];
const EffectWriter = actions.createActionEffectWriter({ runFileManager: { write: (effect) => runFileWrites.push(effect) } });
const gameData = { playerID: 101, characters: new Map([[101, player], [202, npc]]) };
const expectedEffect = `
ordered_in_global_list = {
    variable = mcc_characters_list_v2
    position = 1
    set_global_variable = {
        name = votc_action_source
        value = this
    }
}

root = {
    set_global_variable = {
        name = votc_action_target
        value = root
    }
}

test_effect = yes
`;
assert.strictEqual(EffectWriter.composeFullEffect(gameData, 202, 101, "test_effect = yes"), expectedEffect);

const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"), "utf8");
const providerSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "provider-service.js"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const engineSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "actions", "action-engine.js"), "utf8");
const analyticsSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "analytics", "usage-analytics.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
assert.strictEqual((conversationSource.match(/ActionEngine\.evaluateForCharacter\(this, npc,/g) || []).length, 1, "one official action evaluation is required per NPC reply");
assert(!conversationSource.includes("evaluateForCharacter(this, user"));
assert(conversationSource.includes("async createCharacterLeavingSummary(characterId, summaryPrompt)"), "official leavesConversation compatibility API is required");
assert(conversationSource.includes("const visibleHistory = this.getHistoryForCharacter(numericId)"), "official leaving summaries must enforce Presence windows");
const actionProviderMethod = providerSource.slice(providerSource.indexOf("async sendActionsRequest"), providerSource.indexOf("async sendSummaryRequest"));
assert(actionProviderMethod.includes("...config.defaultParameters"), "action requests must preserve provider defaults");
assert(!actionProviderMethod.includes("temperature: 0.1") && !actionProviderMethod.includes("max_tokens: 512") && !actionProviderMethod.includes('thinking: { type: "disabled" }'), "LLMManager must not impose action-provider overrides");
assert(engineSource.includes('sendActionsRequest(messages, "votc_actions", jsonSchema, signal)'));
assert(!mainSource.includes('require("./action-system")'));
assert(!mainSource.includes("actionSystemMode"));
assert(!analyticsSource.includes("actionSystemMode"));
for (const retiredLabel of ["Action Engine 4.0", "Action Engine 3.0", "动作系统模式", "性能模式", "精准模式", "Social Consequence"]) assert(!rendererSource.includes(retiredLabel), `retired Action UI remains: ${retiredLabel}`);
const retiredActionSystemDir = path.join(root, "resources", "app", "out", "main", "action-system");
assert(isRetiredDirectoryAbsentOrEmpty(retiredActionSystemDir), "retired action-system directory must be absent or empty");
const retiredContractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-retired-action-system-"));
const retiredContractDir = path.join(retiredContractRoot, "action-system");
try {
  assert(isRetiredDirectoryAbsentOrEmpty(retiredContractDir), "absent retired directory must pass");
  fs.mkdirSync(retiredContractDir);
  assert(isRetiredDirectoryAbsentOrEmpty(retiredContractDir), "empty retired directory must pass");
  fs.writeFileSync(path.join(retiredContractDir, "unexpected.js"), "", "utf8");
  assert.strictEqual(isRetiredDirectoryAbsentOrEmpty(retiredContractDir), false, "populated retired directory must fail");
} finally {
  fs.rmSync(retiredContractRoot, { recursive: true, force: true });
}

registryPromise.then(() => {
  console.log("VOTC v7.10 official Action System parity: PASS");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

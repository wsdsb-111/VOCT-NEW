"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Handlebars = require("../resources/app/node_modules/handlebars").create();
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { PromptScriptLoader } = require("../resources/app/out/main/prompts/prompt-script-loader");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { TokenCounter } = require("../resources/app/out/main/provider-service");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4RecallPlanner } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");

const promptsDir = path.resolve(__dirname, "../resources/app/default_userdata/prompts");
const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, defaultPromptsDir: promptsDir,
  promptsHelpersDir: path.join(promptsDir, "helpers"), PromptScriptSandbox });
const GameData = createGameData({ fs, path, summariesDir: "", memorySystem: null, memoryEngine: null,
  getHistoricalReferenceByYear: () => null });
const hidden = ["Genius", "Deceitful", "Bastard", "Kinslayer", "Blademaster"];
const trait = (name, category = "Other", owner = "other") => ({ name, category, desc: `${owner}-${name}-detail` });
const person = (id, shortName) => Object.assign(Object.create(Character.prototype), { id, shortName, firstName: shortName, fullName: shortName,
  gender: "male", sheHe: "he", age: 30, gold: 10, prowess: 5, titleRankConcept: "concept_none",
  traits: ["Beautiful", ...hidden, "One-eyed"].map(name => trait(name, name === "Deceitful" ? "Personality Trait" : "Other")),
  personality: `${shortName}-private-personality`, boldness: 83, greed: 72, compassion: 44, energy: 31,
  honor: -50, rationality: 55, sociability: 62, vengefulness: 81, zeal: 42,
  secrets: [{ name: `${shortName}-private-secret` }], knownSecrets: [], modifiers: [],
  parents: [], children: [], siblings: [], relationsToCharacters: [], relationsToPlayer: [],
  opinions: [], opinionBreakdowns: [] });
function fixture() {
  const player = person(1, "Target");
  const responder = person(2, "Responder");
  responder.traits = responder.traits.map(value => ({ ...value, desc: `self-${value.name}-detail` }));
  const data = Object.assign(Object.create(GameData.prototype), { playerID: 1, playerName: "Target", aiID: 2,
    aiName: "Responder", campaignToken: "trait-campaign", date: "1164.1.1", year: 1164, totalDays: 425000,
    scene: "garden", location: "Garden", locationController: "Target", characters: new Map([[1, player], [2, responder]]),
    mentionedCharactersInContext: new Set(), findMentionedCharacterIdsInHistory: () => [] });
  return { player, responder, data };
}
let layout = "v813";
let script = null;
let mainTemplate = "SELF={{#each traits}}{{name}},{{/each}}\nOTHER={{#each (otherCharacters gameData.characters id)}}{{shortName}}:{{#each traits}}{{name}},{{/each}}|{{personality}}|{{#each secrets}}{{name}}{{/each}}{{/each}}";
const settingsRepository = {
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: layout !== "v5", chatPromptV89RuntimeProfileSplit: layout === "v7",
    chatPromptV810ProviderAdapter: true }),
  getChatPromptV813Layout: () => layout === "v813",
  getPromptSettings: () => ({ mainTemplate, blocks: [
    { id: "main", type: "main", enabled: true },
    { id: "description", type: "description", enabled: !!script, scriptPath: script },
    { id: "history", type: "history", enabled: true },
    { id: "instruction", type: "instruction", enabled: true, template: "Reply" }
  ] })
};
const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository,
  promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => mainTemplate }, path,
  TokenCounter, createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
  defaultChatInstruction: "Reply" });
const memoryContext = () => ({ activeParticipantIds: [1, 2], stableDescriptionCache: new Map(), stableProfileCache: new Map(),
  cacheV2FrozenSnapshots: { responders: new Map(), prefixByResponder: new Map() } });
const build = (sample, memory = memoryContext()) => PromptBuilder.buildMessagesWithTokenCount([], sample.responder,
  sample.data, "", memory, layout === "glm_cache_v2" ? { providerType: "zhipu", defaultModel: "glm-5.3-flash" } : null);
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
check("production custom template preserves all self traits and withholds others' private profile", () => {
  const sample = fixture();
  const before = JSON.stringify([...sample.data.characters]);
  const result = build(sample);
  const text = result.blocks.find(item => item.content.startsWith("SELF=")).content;
  assert(text.includes(`SELF=Beautiful,${hidden.join(",")},One-eyed,`));
  assert(text.includes("OTHER=Target:Beautiful,One-eyed,||"), text);
  assert.equal(JSON.stringify([...sample.data.characters]), before, "prompt routing must not alter runtime character data");
});

const selector = require("../resources/app/out/main/prompts/trait-profile-selector");
check("V1 aliases, ALL categories and unknown Mod traits stay out of observed profiles", () => {
  const sample = fixture();
  sample.player.traits.push(trait("天才"), trait("聪慧"), trait("敏锐"), trait("Dynastic Kinslayer"),
    trait("Mystery Mod Mind"), trait("Beautiful", "Personality Trait"), trait("FUTURE COMMANDER", "Commander Trait"));
  assert.deepEqual(selector.getTraitsForObservedProfile(sample.player).map(value => value.name), ["Beautiful", "One-eyed"]);
  assert.deepEqual(selector.getTraitsForSelfProfile(sample.player), sample.player.traits);
});
check("nested family and custom script receive the same scoped profile", () => {
  const sample = fixture();
  sample.responder.children = [{ ...sample.player, id: 3, shortName: "Relative", firstName: "Relative", fullName: "Relative" }];
  const view = selector.createTraitProfileView(sample.data, sample.responder);
  assert.equal(Object.getPrototypeOf(view.gameData), GameData.prototype);
  assert.deepEqual(view.character.children[0].traits.map(value => value.name), ["Beautiful", "One-eyed"]);
  assert.equal(view.character.children[0].personality, undefined);
  assert.deepEqual(view.character.children[0].secrets, []);
  assert.equal(view.character.personality, sample.responder.personality);
  assert.equal(view.character.boldness, 83);
  assert.equal(view.gameData.getPlayer().personality, undefined);
});
check("custom VM description scripts and prototype methods cannot recover raw other-person data", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-trait-script-"));
  try {
    script = path.join(temporary, "custom.js");
    fs.writeFileSync(script, "module.exports = data => JSON.stringify({self: data.getAi().hasTrait('Genius'), other: data.getPlayer().hasTrait('Genius'), personality: data.getPlayer().personality, secrets: data.getPlayer().secrets, traits: data.getPlayer().traits.map(t => t.name)});", "utf8");
    const result = build(fixture());
    const description = result.blocks.find(item => item.block.id === "description-live");
    assert.deepEqual(JSON.parse(description.content), { self: true, other: false, secrets: [], traits: ["Beautiful", "One-eyed"] });
  } finally {
    script = null;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
for (const value of ["v5", "v6", "v7", "glm_cache_v2", "v813"]) {
  check(`${value}: shipped description scripts cannot expose hidden others' traits`, () => {
    layout = value;
    for (const name of ["pListMccTest2.js", "pListMccTest2JE.js", "pListMccTest2_ZH.js", "pListMccTest2JE_ZH.js"]) {
      script = path.join(promptsDir, "character_description/standard", name);
      const text = build(fixture()).messages.map(message => message.content).join("\n");
      for (const name of hidden) assert(!text.includes(`other-${name}-detail`), `${value}: ${script}: ${name}`);
      assert(!text.includes("Target-private-personality") && !text.includes("Target-private-secret"));
      assert(text.includes("self-Genius-detail") || text.includes("Genius"), "Self traits remain available");
    }
    script = null;
  });
}
layout = "v813";
function evidence(text = "Target is a Bastard.") {
  return { campaignToken: "trait-campaign", ownerId: 2, entityIds: [1], acquiredDate: "1163.1.1",
    conversationDate: "1163.1.1", text, evidence: { knownBy: [2], visibility: "private", sourceType: "witnessed", epistemicStatus: "observed" },
    source: { conversationId: "trait-source", finalizationId: "trait-final", messageIds: [4] } };
}
const knownContext = value => ({ ...memoryContext(), memory4Packet: { details: [{ traitKnowledgeEvidence: value }] } });
check("Known Profile requires one concrete trait claim rather than recognition or relationships", () => {
  const sample = fixture();
  sample.responder.relationsToPlayer = ["friend"];
  const known = selector.createTraitProfileView(sample.data, sample.responder, knownContext(evidence()));
  assert.deepEqual(known.gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "Bastard", "One-eyed"]);
  const recognition = selector.createTraitProfileView(sample.data, sample.responder, { knownEntities: [{ entityId: 1, recognition: "DIRECT_RELATIONSHIP" }] });
  assert.deepEqual(recognition.gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "One-eyed"]);
});
check("specific proof can restore an unknown Mod trait without declaring it observable", () => {
  const sample = fixture();
  sample.player.traits.push(trait("Mod Lineage"));
  const view = selector.createTraitProfileView(sample.data, sample.responder, knownContext(evidence("Target has Mod Lineage.")));
  assert.deepEqual(view.gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "One-eyed", "Mod Lineage"]);
  assert(!selector.getTraitsForObservedProfile(sample.player).some(value => value.name === "Mod Lineage"));
});
check("only responder-owned current CK3 known secrets restore their exact trait", () => {
  const sample = fixture();
  sample.responder.knownSecrets = [{ type: "secret_bastard", ownerId: 1 }];
  sample.player.knownSecrets = [{ type: "secret_witch", ownerId: 2 }];
  const view = selector.createTraitProfileView(sample.data, sample.responder);
  assert.deepEqual(view.gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "Bastard", "One-eyed"]);
  assert.deepEqual(view.gameData.getPlayer().knownSecrets, []);
  sample.data.date = "invalid";
  assert.deepEqual(selector.createTraitProfileView(sample.data, sample.responder).gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "One-eyed"]);
});
check("wrong Owner/Campaign/date/visibility, negation, hypotheses and hearsay cannot promote raw traits", () => {
  const sample = fixture();
  const cases = [
    { ...evidence(), ownerId: 3 }, { ...evidence(), campaignToken: "other" }, { ...evidence(), acquiredDate: "1165.1.1" },
    { ...evidence(), acquiredDate: null }, { ...evidence(), source: {} },
    { ...evidence(), evidence: { ...evidence().evidence, knownBy: [3] } },
    { ...evidence(), evidence: { ...evidence().evidence, visibility: "unknown" } },
    evidence("Target is not a Bastard."), evidence("Target might be a Bastard."), evidence("据说 Target 是 Bastard。"),
    evidence("Target is a Bastard someday."), evidence("Target is a Bastard?"), evidence("Target 是 Bastard，将来才会确定。"),
    evidence("Target 是 Bastard，并不属实。"), evidence("Target 是 Bastard。这是谣言。"), evidence("Target is a Bastard. That is false."),
    evidence('我听某人说 "Target 是 Bastard"。'), evidence('有人声称："Target 是 Bastard"。'), evidence('Target 自称是 Bastard。'),
    evidence("Target 是 Bastard，这只是玩笑。"), evidence("Target 是 Bastard，这只是虚构。"), evidence("Target 是 Bastard，这只是误传。"),
    { ...evidence(), evidence: { ...evidence().evidence, sourceType: "reported", epistemicStatus: "reported" } }
  ];
  for (const source of cases) assert.deepEqual(selector.createTraitProfileView(sample.data, sample.responder,
    knownContext(source)).gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "One-eyed"]);
});
check("production Memory4 detail verifies scope, then only its witnessed trait enters the prompt view", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-trait-routing-"));
  try {
    const folders = path.join(temporary, "summaries");
    fs.mkdirSync(path.join(folders, "2_Responder"), { recursive: true });
    const store = new MemoryStore({ baseDir: path.join(temporary, "memory"), summaryFoldersDir: folders });
    const coordinator = new Memory4Coordinator(store);
    const sample = fixture();
    const text = "Target is a Bastard.";
    const context = { campaignToken: sample.data.campaignToken, conversationId: "trait-history", finalizationId: "trait-final",
      date: "1163.1.1", totalDays: 424635, participants: [{ id: 1 }, { id: 2 }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 0 }],
      messages: [{ id: 1, role: "assistant", speakerCharacterId: 2, content: text,
        memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType: "game_fact", entityIds: [1], recipientIds: [1] }] }] };
    const projection = projectVisibleTranscript(context, 2);
    const snapshot = { ...context, ...projection, ownerId: 2, counterpartIds: [1] };
    coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType: "DURABLE_KNOWLEDGE", text,
      fragmentIds: [projection.fragments[0].fragmentId], entityIds: [1], participantIds: [1, 2], topics: ["Bastard"], eventTime: { status: "unknown" } }] });
    const packet = new Memory4RecallPlanner(coordinator).plan({ campaignToken: sample.data.campaignToken, ownerId: 2,
      query: "1163年我们聊过什么？", querySpeakerId: 1, entityIds: [1], gameData: sample.data, currentGameDate: sample.data.date,
      currentTotalDays: sample.data.totalDays, memoryEngineRemainingBudget: 1200 });
    assert.equal(packet.details.length, 1);
    assert.equal(packet.details[0].traitKnowledgeEvidence.ownerId, 2);
    const result = build(sample, { ...memoryContext(), memory4Packet: packet, temporalExtraText: packet.text });
    assert(result.blocks.find(item => item.content.startsWith("SELF=")).content.includes("OTHER=Target:Beautiful,Bastard,One-eyed,||"));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
console.log(`V8.14.1 Trait Profile Routing: ${checks} PASS (offline production prompts and verified Memory4 details)`);

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
const selector = require("../resources/app/out/main/prompts/trait-profile-selector");
function directObservationContext(sample, base = memoryContext()) {
  const facts = sample.player.traits.map(trait => ({ trait, policy: selector.resolveTraitVisibility(trait) }))
    .filter(item => item.policy.status === "OBSERVABLE")
    .map(({ trait, policy }) => ({ campaignToken: sample.data.campaignToken, ownerId: sample.responder.id,
      entityId: sample.player.id, factType: "TRAIT", factKey: `trait_${policy.canonicalKey}`, value: trait.name,
      status: "AUTO_DISCLOSED", current: true, effectiveKnown: true, currentDirectObservation: true,
      sourceKind: "DIRECT_OBSERVATION", acquisitionKind: "VISIBLE_TRAIT", firstAcquiredDate: sample.data.date }));
  return { ...base, disclosureProfiles: new Map([[sample.player.id, facts]]) };
}
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
check("production custom template includes only scoped direct observations for others", () => {
  const sample = fixture();
  const before = JSON.stringify([...sample.data.characters]);
  const result = build(sample, directObservationContext(sample));
  const text = result.blocks.find(item => item.content.startsWith("SELF=")).content;
  assert(text.includes(`SELF=Beautiful,${hidden.join(",")},One-eyed,`));
  assert(text.includes("OTHER=未获知姓名的人物:Beautiful,One-eyed,||"), text);
  assert.equal(JSON.stringify([...sample.data.characters]), before, "prompt routing must not alter runtime character data");
});
check("raw observable traits remain absent without actual presence or disclosure", () => {
  const sample = fixture();
  const view = selector.createTraitProfileView(sample.data, sample.responder);
  assert.deepEqual(view.gameData.getPlayer().traits, []);
});
check("V1 aliases, ALL categories and unknown Mod traits stay out of observed profiles", () => {
  const sample = fixture();
  sample.player.traits.push(trait("天才"), trait("聪慧"), trait("敏锐"), trait("Dynastic Kinslayer"),
    trait("Mystery Mod Mind"), trait("Beautiful", "Personality Trait"), trait("FUTURE COMMANDER", "Commander Trait"));
  assert.deepEqual(selector.getTraitsForObservedProfile(sample.player).map(value => value.name), ["Beautiful", "One-eyed"]);
  assert.deepEqual(selector.getTraitsForSelfProfile(sample.player), sample.player.traits);
});
check("nested family and custom script receive the same scoped profile", () => {
  const sample = fixture();
  sample.responder.children = [{ ...sample.player, id: 3, shortName: "Relative", firstName: "Relative", fullName: "Relative",
    directParentEvidence: { source: "CK3_DIRECT_PARENT", sourceOwnerId: 3, childId: 3, parentId: 2,
      relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT", knowledgeStatus: "UNKNOWN",
      campaignToken: sample.data.campaignToken, sourceSnapshotId: `${sample.data.date}/${sample.data.totalDays}` } }];
  const view = selector.createTraitProfileView(sample.data, sample.responder);
  assert.equal(Object.getPrototypeOf(view.gameData), GameData.prototype);
  assert.deepEqual(view.character.children[0].traits, [], "a relative absent from current character bindings does not inherit observations");
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
    const sample = fixture();
    const result = build(sample, directObservationContext(sample));
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
      const sample = fixture();
      const text = build(sample, directObservationContext(sample)).messages.map(message => message.content).join("\n");
      for (const name of hidden) assert(!text.includes(`other-${name}-detail`), `${value}: ${script}: ${name}`);
      assert(!text.includes("Target-private-personality") && !text.includes("Target-private-secret"));
      assert(text.includes("self-Genius-detail") || text.includes("Genius"), "Self traits remain available");
    }
    script = null;
  });
}
layout = "v813";
check("retired Memory4 Packet evidence is never read or used to restore traits", () => {
  const sample = fixture();
  const memory4Packet = { get details() { throw new Error("retired Memory4 Packet must not be read"); } };
  const view = selector.createTraitProfileView(sample.data, sample.responder, { ...memoryContext(), memory4Packet });
  assert.deepEqual(view.gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "One-eyed"],
    "the existing in-person whitelist is independent of the unread retired Packet");
  sample.responder.relationsToPlayer = ["friend"];
  const relationshipOnly = selector.createTraitProfileView(sample.data, sample.responder, { ...memoryContext(), memory4Packet });
  assert.deepEqual(relationshipOnly.gameData.getPlayer().traits.map(value => value.name), ["Beautiful", "One-eyed"],
    "friendship adds no hidden traits beyond the actual-presence whitelist");
});
check("current-log known secrets retain exact responder-target proof independently of Worldline", () => {
  const sample = fixture();
  sample.responder.knownSecrets = [{ type: "secret_bastard", ownerId: 1 }];
  sample.player.knownSecrets = [{ type: "secret_witch", ownerId: 2 }];
  assert.deepEqual(selector.createTraitProfileView(sample.data, sample.responder).gameData.getPlayer().traits.map(value => value.name), ["Bastard"],
    "the restored pre-V9.3.9 native proof grants only its exact trait to this owner");
  const verifiedKnowledge = { disclosureProfiles: new Map([[1, [{ campaignToken: sample.data.campaignToken,
    ownerId: 2, entityId: 1, factType: "TRAIT", factKey: "trait_bastard", status: "AUTO_DISCLOSED",
    current: true, effectiveKnown: true, firstAcquiredDate: sample.data.date }]]]) };
  const view = selector.createTraitProfileView(sample.data, sample.responder, verifiedKnowledge);
  assert.deepEqual(view.gameData.getPlayer().traits.map(value => value.name), ["Bastard"]);
  assert.deepEqual(view.gameData.getPlayer().knownSecrets, []);
  sample.data.date = "invalid";
  assert.deepEqual(selector.createTraitProfileView(sample.data, sample.responder).gameData.getPlayer().traits, []);
});
console.log(`V8.14.1 Trait Profile Routing: ${checks} PASS (offline prompts, CK3 observation, and retired Packet boundary)`);

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mainDir = path.resolve(__dirname, "../resources/app/out/main");
const Handlebars = require("../resources/app/node_modules/handlebars");
const { MemoryEngine } = require(path.join(mainDir, "memory-system/memory-engine"));
const { createLetterPromptBuilder } = require(path.join(mainDir, "prompts/letter-prompt-builder"));
const { createPromptBuilder } = require(path.join(mainDir, "prompts/prompt-builder"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8141-letter-knowledge-"));
try {
  const summaryFoldersDir = path.join(tempRoot, "summaries");
  const traceEntries = [];
  const engine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory"), summaryFoldersDir,
    recoveryDir: path.join(tempRoot, "recovery"), trace: { record(stage, details) { traceEntries.push({ stage, details }); } } });
  const folder = path.join(summaryFoldersDir, "2_Recipient");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "with-sender.json"), JSON.stringify([
    { totalDays: 90, date: "1162.4.1", content: "RECIPIENT_LEGAL_PAIR", campaignToken: "letter-campaign", pinned: true },
    { totalDays: 130, date: "1162.6.1", content: "FUTURE_PAIR_ONE", campaignToken: "letter-campaign", pinned: true },
    { totalDays: 140, date: "1162.7.1", content: "FUTURE_PAIR_TWO", campaignToken: "letter-campaign", pinned: true },
    { totalDays: 140, date: "1162.7.1", content: "FUTURE_ACQUISITION_OLD_EVENT_1150", campaignToken: "letter-campaign", pinned: true,
      temporalRefs: [{ fromGameDate: "1150.1.1", toGameDate: "1150.1.1", precision: "day", status: "reported" }] },
    { totalDays: null, date: null, content: "UNKNOWN_ACQUISITION_PAIR", campaignToken: "letter-campaign", pinned: true },
    { totalDays: 80, date: "1162.3.1", content: "OTHER_CAMPAIGN_PAIR", campaignToken: "another-campaign", pinned: true },
    { totalDays: 70, date: "1162.2.1", content: "UNBOUND_PAIR", campaignToken: null, pinned: true }
  ].map((entry, index) => ({ playerId: 2, characterId: 1, finalizationId: `letter-pair-${index}`, ...entry }))));
  const playerFolder = path.join(summaryFoldersDir, "1_Sender");
  fs.mkdirSync(playerFolder, { recursive: true });
  fs.writeFileSync(path.join(playerFolder, "private.json"), JSON.stringify([{ playerId: 1, characterId: 3, totalDays: 60,
    date: "1162.1.1", content: "PLAYER_PRIVATE_FOLDER", campaignToken: "letter-campaign" }]));
  fs.writeFileSync(path.join(folder, "with-third-party.json"), JSON.stringify([{ playerId: 2, characterId: 3, totalDays: 70,
    date: "1162.3.1", content: "THIRD_PARTY_LEGAL_PAIR", campaignToken: "letter-campaign", participants: [{ id: 3, name: "ThirdParty" }] }]));
  const save = (id, text, knownBy, days, campaign = "letter-campaign", acquiredAt = days) => {
    engine.store.saveMemory({ memoryId: id, type: "secret", content: text, visibility: "private", knownBy,
      importance: 0.99, totalDays: days, eventDate: "1162.4.1", provenance: { campaignToken: campaign } });
    engine.store.markKnownBy(2, id, { awareness: "told", acquiredAt });
  };
  save("legal", "RECIPIENT_LEGAL_INTERNAL", [2], 80);
  save("wrong-owner", "PLAYER_ONLY_INTERNAL_WITH_STALE_INDEX", [1], 70);
  save("future", "FUTURE_INTERNAL", [2], 130);
  save("future-acquisition", "FUTURE_ACQUISITION", [2], 60, "letter-campaign", 120);
  save("unknown-acquisition", "UNKNOWN_ACQUISITION_INTERNAL", [2], 60, "letter-campaign", null);
  save("empty-acquisition", "UNKNOWN_ACQUISITION_EMPTY", [2], 60, "letter-campaign", "");
  save("wrong-campaign", "OTHER_CAMPAIGN_INTERNAL", [2], 70, "another-campaign");

  const player = { id: 1, shortName: "Sender", fullName: "Sender", traits: [],
    memories: [{ desc: "PLAYER_PRIVATE_NATIVE", creationDateTotalDays: 70 }],
    conversationSummaries: [{ content: "PLAYER_PRIVATE_RAW_SUMMARY", totalDays: 70 }] };
  const recipient = { id: 2, shortName: "Recipient", fullName: "Recipient", traits: [],
    memories: [{ desc: "RECIPIENT_LEGAL_NATIVE", creationDate: "1162.4.1", creationDateTotalDays: 80 },
      { desc: "FUTURE_NATIVE", creationDate: "1162.7.1", creationDateTotalDays: 140 }],
    conversationSummaries: [{ date: "1162.4.1", content: "PLAYER_DIRECTORY_RAW_SUMMARY", totalDays: 80 }] };
  const characters = new Map([[1, player], [2, recipient]]);
  const gameData = { characters, playerID: 1, aiID: 2, playerName: "Sender", date: "1162.5.19", totalDays: 100,
    campaignToken: "letter-campaign", getAi() { return this.characters.get(this.aiID); }, getPlayer() { return this.characters.get(this.playerID); },
    getMentionableCharacterProfiles() { return this.characters; }, getMentionExclusionIds: () => [1, 2] };
  const original = JSON.stringify([player, recipient]);
  const settings = { blocks: [
    { type: "past_summaries", enabled: true }, { type: "memories", enabled: true },
    { type: "description", enabled: true, scriptPath: "fixture" },
    { type: "custom", enabled: true, template: "{{#each ai.conversationSummaries}}{{this.content}}{{/each}}|{{#each player.memories}}{{this.desc}}{{/each}}" },
    { type: "instruction", enabled: true, template: "{{letter.content}}" }
  ] };
  class ScriptLoader {
    executeDescription(file, view, responderId) {
      return [...view.characters.values()].flatMap(character => [
        ...(character.memories || []).map(memory => memory.desc),
        ...(character.conversationSummaries || []).map(summary => summary.content)
      ]).join("|");
    }
  }
  const dependencies = { TemplateEngine: class { renderTemplateString(template, context) { return Handlebars.compile(template)(context); } },
    PromptScriptLoader: ScriptLoader, settingsRepository: { getLetterPromptSettings: () => settings },
    promptConfigManager: { resolvePath: value => value }, memoryEngine: engine };
  dependencies.PromptBuilder = createPromptBuilder(dependencies);
  const Builder = createLetterPromptBuilder(dependencies);
  const letter = { letterId: "letter-fixture", content: "Do you remember our conversation?", totalDays: 100 };
  engine.mentionTracker.lastScanRecentCharacterId = 999;
  engine.mentionTracker.lastScanUnresolved = true;
  const knowledgeBefore = JSON.stringify(engine.store.getCharacterKnowledge(2));
  const dateIndexBefore = engine.store.summaryDateIndexCache.size;
  const readState = () => JSON.stringify({ index: engine.store.index, dateIndex: [...engine.store.summaryDateIndexCache],
    folderCache: [...engine.store.folderSummaryCache], folderMetrics: engine.store.folderSummaryCacheMetrics,
    folderDiagnostics: [...engine.store.folderSummaryLoadDiagnostics], folderRevisions: [...engine.store.folderSummaryRevisions],
    ranker: engine.ranker, traceEntries });
  const stateBefore = readState();
  for (const method of ["writeJson", "saveMemory", "updateMemory", "markKnownBy"]) engine.store[method] = () => { throw new Error("letter_prompt_must_not_write_memory"); };
  engine.markRoutedRecallSeen = () => { throw new Error("letter_prompt_must_not_commit_seen"); };
  const text = new Builder().buildMessages(gameData, letter).map(message => message.content).join("\n");
  assert(!text.includes("PLAYER_DIRECTORY_RAW_SUMMARY"), "past_summaries cannot use GameData's sender-directory mirror");
  assert(!text.includes("PLAYER_PRIVATE"), "recipient's prompt cannot read the sender's private raw or folder memory");
  assert(!text.includes("PLAYER_ONLY_INTERNAL"), "a stale knowledge index cannot override the canonical knownBy boundary");
  assert(!text.includes("FUTURE_"), "future event and acquisition dates must be filtered before ranking and rendering");
  assert(!text.includes("UNKNOWN_ACQUISITION"), "old event dates cannot prove the recipient knew an undated memory by send time");
  assert(!text.includes("OTHER_CAMPAIGN") && !text.includes("UNBOUND_PAIR"), "Campaign mismatch and unresolved legacy binding fail closed");
  for (const allowed of ["RECIPIENT_LEGAL_PAIR", "RECIPIENT_LEGAL_INTERNAL", "RECIPIENT_LEGAL_NATIVE"]) {
    assert(text.includes(allowed), `legitimate recipient evidence must still reach the letter prompt: ${allowed}`);
  }
  assert.equal(JSON.stringify([player, recipient]), original, "building a scoped letter prompt never mutates actual GameData");
  assert.equal(engine.mentionTracker.lastScanRecentCharacterId, 999, "letter scanning cannot overwrite active conversation mention state");
  assert.equal(engine.mentionTracker.lastScanUnresolved, true);
  assert.equal(engine.store.summaryDateIndexCache.size, dateIndexBefore, "letter date indexes remain request-local");
  assert.equal(JSON.stringify(engine.store.getCharacterKnowledge(2)), knowledgeBefore, "prompt assembly does not commit knowledge or seen");
  assert.equal(readState(), stateBefore, "letter reads never change scene indexes, loader diagnostics, ranker state or trace");

  const thirdParty = new Builder().buildMessages(gameData, { ...letter, content: "What did ThirdParty promise?" }).map(message => message.content).join("\n");
  assert(thirdParty.includes("THIRD_PARTY_LEGAL_PAIR"), "an actual third-party mention routes only the recipient's own history");
  assert(!thirdParty.includes("PLAYER_PRIVATE_FOLDER"));

  const noCampaign = new Builder().buildMessages({ ...gameData, campaignToken: null }, letter).map(message => message.content).join("\n");
  assert(!noCampaign.includes("RECIPIENT_LEGAL_PAIR") && !noCampaign.includes("RECIPIENT_LEGAL_INTERNAL"), "unresolved active Campaign cannot recall stored history");
  const noEngineBuilder = createLetterPromptBuilder({ ...dependencies, memoryEngine: null });
  const withoutEngine = new noEngineBuilder().buildMessages(gameData, letter).map(message => message.content).join("\n");
  assert(!withoutEngine.includes("RAW_SUMMARY") && !withoutEngine.includes("PLAYER_PRIVATE"), "absence of MemoryEngine never reactivates raw summaries");
  assert(withoutEngine.includes("RECIPIENT_LEGAL_NATIVE") && !withoutEngine.includes("FUTURE_NATIVE"), "native self memory remains bounded without stored history");
  const priorDay = new Builder().buildMessages(gameData, { ...letter, totalDays: 75 }).map(message => message.content).join("\n");
  assert(!priorDay.includes("RECIPIENT_LEGAL_PAIR") && !priorDay.includes("RECIPIENT_LEGAL_INTERNAL") && !priorDay.includes("RECIPIENT_LEGAL_NATIVE"),
    "letter send day bounds history even when later GameData is available");
  settings.blocks = [{ type: "instruction", enabled: true },
    { type: "custom", enabled: true, template: "Sender dossier: {{player.fullName}}" }];
  const identityGuard = messages => {
    const message = messages.at(-1);
    assert.equal(message.role, "system");
    assert(message.content.includes("玩家身份知情边界"), "default and custom letter inputs carry the shared identity guard");
    assert(message.content.includes("后台标签，不构成本角色已经知道玩家身份的证据"));
    assert(message.content.includes("介绍中的化名不等于已得知后台真名"));
    return message.content;
  };
  const stranger = new Builder().buildMessages(gameData, letter);
  assert(stranger[0].content.includes("from Sender"), "the guard does not implement canonical label masking");
  assert(identityGuard(stranger).includes("身份识别关系证据：未提供"));
  const introduction = new Builder().buildMessages(gameData, { ...letter, content: "Call me AliasOnly." });
  assert(introduction[0].content.includes("Call me AliasOnly."), "the actual introduction remains in the input");
  assert(identityGuard(introduction).includes("不得据此解锁整包玩家资料"));
  recipient.relationsToPlayer = ["friend"];
  assert(identityGuard(new Builder().buildMessages(gameData, letter)).includes("身份识别关系证据：friend"));
  assert.equal(readState(), stateBefore, "all repeated previews remain read-only");
  console.log("V8.14.1 Letter Knowledge: PASS (recipient route, Campaign, as-of, acquired-at, knownBy, templates/scripts, native self, read-only, identity guard input contract)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

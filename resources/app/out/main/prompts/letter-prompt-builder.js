"use strict";

const { createTraitProfileView } = require("./trait-profile-selector");
const { memoryMatchesCampaign } = require("../memory-system/memory-types");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { gameDateFromSerial } = require("../memory-system/temporal-anchor-extractor");

function letterKnowledgeDate(gameData, letter) {
  const day = value => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  const gameDay = day(gameData.totalDays);
  const sentDay = day(letter.totalDays);
  const asOfDay = gameDay == null ? sentDay : sentDay == null ? gameDay : Math.min(gameDay, sentDay);
  const currentDate = normalizeGameDate(gameData.date);
  const asOfDate = currentDate && gameDay != null && asOfDay != null
    ? gameDateFromSerial(currentDate.serial + asOfDay - gameDay) : currentDate;
  return { day, asOfDay, asOfDate };
}

function createLetterPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository, promptConfigManager, memoryEngine, PromptBuilder, TokenCounter }) {
  class LetterPromptBuilder {
    constructor() {
      this.templateEngine = new TemplateEngine();
      this.scriptLoader = new PromptScriptLoader();
    }

    buildMessages(gameData, letter) {
      const disclosureProfiles = new Map();
      const ownerId = Number(gameData.getAi()?.id);
      const { asOfDate } = letterKnowledgeDate(gameData, letter);
      if (asOfDate && gameData.campaignToken && memoryEngine?.memory4?.getCurrentDisclosures) {
        try {
          const scope = { campaignToken: gameData.campaignToken, ownerId };
          const readContext = memoryEngine.memory4.createProfileReadContext(scope);
          for (const entityId of gameData.characters.keys()) {
            if (Number(entityId) === ownerId) continue;
            disclosureProfiles.set(Number(entityId), memoryEngine.memory4.getCurrentDisclosures(scope, Number(entityId),
              { campaignToken: gameData.campaignToken, date: asOfDate.canonical, characters: gameData.characters }, { readContext }));
          }
        } catch (error) {
          disclosureProfiles.clear();
          if (error.message !== "memory4_owner_folder_not_unique") console.warn("[Memory4] Letter knowledge unavailable:", error.message);
        }
      }
      gameData = createTraitProfileView(gameData, gameData.getAi(), { disclosureProfiles }).gameData;
      // A remote recipient cannot observe the sender's current scene.
      gameData.location = "";
      gameData.locationController = "";
      const ai = gameData.getAi();
      const player = gameData.getPlayer();
      if (!ai || !player) throw new Error("Missing player or AI character data for letter prompt");
      const settings = settingsRepository.getLetterPromptSettings();
      const messages = [];
      const letterKnowledge = this.buildLetterKnowledge(ai, player, gameData, letter);
      ai.conversationSummaries = letterKnowledge.summaries;
      ai.memories = letterKnowledge.memories;
      const context = { character: ai, player, ai, gameData, letter, letterKnowledge };
      for (const block of settings.blocks || []) {
        if (!block.enabled) continue;
        this.applyBlock(block, messages, context, settings);
      }
      if (settings.suffix?.enabled && settings.suffix.template) {
        const suffixContent = this.templateEngine.renderTemplateString(settings.suffix.template, context);
        messages.push({ role: "system", content: suffixContent });
      }
      const identityKnowledge = PromptBuilder?.buildPlayerIdentityKnowledge(ai, gameData);
      if (identityKnowledge) messages.push({ role: "system", content: identityKnowledge });
      return messages;
    }

    buildPreview(gameData, letter) {
      const messages = this.buildMessages(gameData, letter);
      return messages.map((message) => `${message.role?.toUpperCase() || "SYSTEM"}: ${message.content}`).join("\n\n");
    }

    applyBlock(block, messages, context, settings) {
      const { character, gameData } = context;
      switch (block.type) {
        case "main": {
          const template = settings.mainTemplate || promptConfigManager.getDefaultLetterMainTemplateContent();
          const content = this.templateEngine.renderTemplateString(template, context);
          if (content?.trim()) messages.push({ role: block.role || "system", content });
          break;
        }
        case "description": {
          if (!block.scriptPath) break;
          try {
            const description = this.scriptLoader.executeDescription(promptConfigManager.resolvePath(block.scriptPath), gameData, character.id);
            if (description) messages.push({ role: "system", content: description });
          } catch (error) {
            console.error("Failed to render letter description script:", error);
          }
          break;
        }
        case "past_summaries": {
          const summaries = this.buildPastSummariesContext(character, gameData, context.letterKnowledge);
          if (summaries) {
            const content = block.template ? this.templateEngine.renderTemplateString(block.template, { ...context, pastSummaries: summaries }) : summaries;
            messages.push({ role: block.role || "system", content });
          }
          break;
        }
        case "memories": {
          const memoriesBlock = this.buildAllMemoriesBlock(context.player, character, block.template, context);
          if (memoriesBlock) messages.push({ role: block.role || "system", content: memoriesBlock });
          break;
        }
        case "instruction": {
          const template = block.template || `You received a letter from {{player.fullName}}:
"{{letter.content}}"
Reply as {{character.fullName}}.`;
          messages.push({ role: block.role || "user", content: this.templateEngine.renderTemplateString(template, context) });
          break;
        }
        case "custom": {
          if (!block.template) break;
          messages.push({ role: block.role || "system", content: this.templateEngine.renderTemplateString(block.template, context) });
          break;
        }
      }
    }

    buildLetterKnowledge(ai, player, gameData, letter) {
      const ownerId = Number(ai.id);
      const { day, asOfDay, asOfDate } = letterKnowledgeDate(gameData, letter);
      const beforeSend = memory => {
        const totalDays = day(memory.totalDays ?? memory.creationDateTotalDays);
        const date = normalizeGameDate(memory.eventDate || memory.creationDate);
        return (totalDays != null && asOfDay != null || date && asOfDate)
          && !(totalDays != null && asOfDay != null && totalDays > asOfDay)
          && !(date && asOfDate && date.serial > asOfDate.serial);
      };
      const campaignToken = typeof gameData.campaignToken === "string" && gameData.campaignToken.trim() || null;
      const sameCampaign = memory => campaignToken && memory.provenance?.campaignBinding?.status !== "unresolved"
        && memoryMatchesCampaign(memory, campaignToken);
      const native = (ai.memories || []).filter(memory => beforeSend(memory)
        && (!memory.provenance?.campaignToken || sameCampaign(memory))
        && (!Array.isArray(memory.knownBy) || memory.knownBy.map(Number).includes(ownerId)));
      const result = { summaries: [], memories: native };
      if (!memoryEngine?.store || !campaignToken || !Number.isSafeInteger(ownerId) || ownerId <= 0) return result;
      const store = memoryEngine.store;
      const scopedStore = Object.create(store);
      scopedStore.folderSummaryCache = new Map(store.folderSummaryCache);
      scopedStore.folderSummaryCacheMetrics = { ...store.folderSummaryCacheMetrics };
      scopedStore.folderSummaryLoadDiagnostics = new Map(store.folderSummaryLoadDiagnostics);
      scopedStore.folderSummarySnapshotRevisions = new WeakMap();
      scopedStore.summaryDateIndexCache = new Map();
      const knowledge = store.getCharacterKnowledge(ownerId).filter(record => day(record.acquiredAt) != null
        && asOfDay != null && day(record.acquiredAt) <= asOfDay);
      const knownIds = new Set(knowledge.map(record => record.memoryId));
      const visible = memory => sameCampaign(memory) && beforeSend(memory)
        && memory.knownBy?.map(Number).includes(ownerId);
      // The loader maps summary.date (conversation acquisition date), not body event references, to eventDate.
      const folders = scopedStore.loadFolderSummariesForCharacter(ownerId).filter(memory => visible(memory)
        && asOfDate && normalizeGameDate(memory.eventDate)
        && Number(memory.provenance?.folderOwnerId) === ownerId);
      const internal = store.queryMemories({ characterId: ownerId, includeFolderSummaries: false })
        .filter(memory => visible(memory) && knownIds.has(memory.memoryId));
      // Reuse the existing route over request-local reads; its caches cannot retain another letter's scope.
      scopedStore.loadFolderSummariesForCharacter = characterId => Number(characterId) === ownerId ? folders : [];
      scopedStore.queryMemories = options => Number(options.characterId) === ownerId ? internal : [];
      scopedStore.getCharacterKnowledge = characterId => Number(characterId) === ownerId ? knowledge : [];
      scopedStore.getFolderSummarySnapshotRevision = memories => memories === folders ? store.getFolderSummaryRevision(ownerId) : null;
      const scopedEngine = Object.create(memoryEngine);
      scopedEngine.store = scopedStore;
      scopedEngine.mentionTracker = Object.create(memoryEngine.mentionTracker);
      scopedEngine.trace = { record() {} };
      const profiles = new Map(gameData.getMentionableCharacterProfiles?.() || gameData.characters || []);
      for (const [id, profile] of memoryEngine.getMentionableProfilesFromFolderMemories(folders)) if (!profiles.has(id)) profiles.set(id, profile);
      const mentionedEntityIds = scopedEngine.findMentionedCharactersInHistory({
        history: [{ role: "user", content: letter.content || "" }], candidates: [...profiles.values()], excludedIds: [ownerId, Number(player.id)]
      });
      const recalled = scopedEngine.retrieveForResponder({ characterId: ownerId, query: letter.content || "",
        directCounterpartIds: [Number(player.id)], querySpeakerId: Number(player.id), mentionedEntityIds,
        mentionedEntityNames: Object.fromEntries(mentionedEntityIds.map(id => [id, memoryEngine.getCharacterMentionAliases(profiles.get(id))])),
        ownerFolderMemories: folders, currentGameDate: asOfDate?.canonical || null, currentTotalDays: asOfDay, campaignToken,
        conversationId: letter.letterId || letter.id || null, memory4RecallEnabled: false,
        sessionRecallCache: new Map(), mentionedRecallCache: new Map(), estimateTokens: TokenCounter?.estimateTokens
      });
      result.summaries = [...(recalled.direct || []), ...(recalled.mentioned || []), ...(recalled.extra || []), ...(recalled.topicPatch || [])]
        .map(entry => ({ date: entry.memory.eventDate, content: entry.memory.content }));
      result.memories = [...native, ...(recalled.stable || []).map(entry => ({ desc: entry.memory.content,
        creationDate: entry.memory.eventDate, creationDateTotalDays: entry.memory.totalDays, relevanceWeight: entry.memory.importance }))];
      return result;
    }

    buildPastSummariesContext(character, gameData, letterKnowledge = {}) {
      if (!letterKnowledge.summaries?.length) return null;
      const lines = letterKnowledge.summaries.map((summary) => `${summary.date}: ${summary.content}`);
      return `Past conversations known to ${character.shortName}:\n${lines.join("\n")}`;
    }

    buildAllMemoriesBlock(player, ai, template, context = {}) {
      const memories = (context.letterKnowledge?.memories || []).map(memory => ({ ...memory, character: ai.shortName }));
      if (memories.length === 0) return null;
      const source = template || `Known memories for the responding character:
{{#each memories}}- {{this.character}} | {{this.creationDate}} ({{this.creationDateTotalDays}}): {{this.desc}} [relevance: {{this.relevanceWeight}}]
{{/each}}`;
      return this.templateEngine.renderTemplateString(source, { ...context, memories });
    }
  }

  return LetterPromptBuilder;
}

module.exports = { createLetterPromptBuilder };

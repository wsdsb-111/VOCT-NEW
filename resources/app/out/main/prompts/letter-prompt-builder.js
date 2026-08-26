"use strict";

function createLetterPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository, memoryEngine, memorySystem, PromptBuilder, TokenCounter, promptConfigManager }) {
  class LetterPromptBuilder {
    constructor() {
      this.templateEngine = new TemplateEngine();
      this.scriptLoader = new PromptScriptLoader();
    }
    buildMessages(gameData, letter) {
      const ai = gameData.getAi();
      const player = gameData.getPlayer();
      if (!ai || !player) {
        throw new Error("Missing player or AI character data for letter prompt");
      }
      const settings = settingsRepository.getLetterPromptSettings();
      const messages = [];
      const context = {
        character: ai,
        player,
        ai,
        gameData,
        letter
      };
      const mentionableProfiles = gameData.getMentionableCharacterProfiles();
      const ownerFolderMemories = memoryEngine.loadOwnerFolderMemories(ai.id);
      for (const [characterId, profile] of memoryEngine.getMentionableProfilesFromFolderMemories(ownerFolderMemories)) {
        if (!mentionableProfiles.has(characterId)) mentionableProfiles.set(characterId, profile);
      }
      const mentionedEntityIds = memoryEngine.findMentionedCharactersInHistory({
        history: [{ id: letter.id || "letter", role: "user", content: letter.content || "" }],
        candidates: [...mentionableProfiles.values()],
        excludedIds: gameData.getMentionExclusionIds([ai.id, player.id])
      });
      const mentionedEntityNames = Object.fromEntries(mentionedEntityIds.map((characterId) => {
        const character = mentionableProfiles.get(characterId);
        return [characterId, character ? memorySystem.getCharacterMentionAliases(character) : []];
      }));
      const memoryContext = memoryEngine.retrieveForResponder({
        characterId: ai.id,
        query: letter.content || "",
        directCounterpartIds: [player.id],
        mentionedEntityIds,
        mentionedEntityNames,
        ownerFolderMemories,
        currentTotalDays: gameData.totalDays,
        tokenBudget: 800,
        estimateTokens: (text) => TokenCounter.estimateTokens(text)
      });
      context.memoryContext = memoryContext;
      let memoryInserted = false;
      for (const block of settings.blocks || []) {
        if (!block.enabled) continue;
        if (!memoryInserted && block.type === "instruction") {
          for (const content of [memoryContext.stableText, memoryContext.relevantText].filter(Boolean)) {
            messages.push({ role: "system", content });
          }
          memoryInserted = true;
        }
        this.applyBlock(block, messages, context, settings);
      }
      if (settings.suffix?.enabled && settings.suffix.template) {
        const suffixContent = this.templateEngine.renderTemplateString(settings.suffix.template, context);
        messages.push({ role: "system", content: suffixContent });
      }
      console.log(`[LetterPromptBuilder] Built ${messages.length} messages (${TokenCounter.calculateTotalTokens(messages)} estimated tokens)`);
      logVerboseLLM("[LetterPromptBuilder][verbose] Messages:", messages);
      return messages;
    }
    buildPreview(gameData, letter) {
      const messages = this.buildMessages(gameData, letter);
      return messages.map((m) => `${m.role?.toUpperCase() || "SYSTEM"}: ${m.content}`).join("\n\n");
    }
    applyBlock(block, messages, context, settings) {
      const { character, gameData } = context;
      switch (block.type) {
        case "main": {
          const template = settings.mainTemplate || promptConfigManager.getDefaultLetterMainTemplateContent();
          const content = this.templateEngine.renderTemplateString(template, context);
          if (content?.trim()) {
            const role = block.role || "system";
            messages.push({ role, content });
          }
          break;
        }
        case "description": {
          if (!block.scriptPath) break;
          try {
            const descScriptPath = promptConfigManager.resolvePath(block.scriptPath);
            const description = this.scriptLoader.executeDescription(descScriptPath, gameData, character.id);
            if (description) {
              messages.push({ role: "system", content: description });
            }
          } catch (error) {
            console.error("Failed to render letter description script:", error);
          }
          break;
        }
        case "past_summaries": {
          if (context.memoryContext?.engineVersion?.startsWith("2.")) break;
          const summaries = this.buildPastSummariesContext(character, gameData);
          if (summaries) {
            const content = block.template ? this.templateEngine.renderTemplateString(block.template, { ...context, pastSummaries: summaries }) : summaries;
            const role = block.role || "system";
            messages.push({ role, content });
          }
          break;
        }
        case "memories": {
          const memoriesBlock = this.buildAllMemoriesBlock(context.player, character, block.template, context);
          if (memoriesBlock) {
            const role = block.role || "system";
            messages.push({ role, content: memoriesBlock });
          }
          break;
        }
        case "instruction": {
          const tpl = block.template || `你收到了来自 {{player.fullName}} 的信件：
  "{{letter.content}}"
  以 {{character.fullName}} 的身份回信。`;
          const content = this.templateEngine.renderTemplateString(tpl, context);
          const role = block.role || "user";
          messages.push({ role, content });
          break;
        }
        case "custom": {
          if (!block.template) break;
          const content = this.templateEngine.renderTemplateString(block.template, context);
          const role = block.role || "system";
          messages.push({ role, content });
          break;
        }
      }
    }
    buildPastSummariesContext(char, gameData) {
      if (!char.conversationSummaries || char.conversationSummaries.length === 0) {
        return null;
      }
  
      let context = `${char.shortName} 与 ${gameData.playerName} 之间最近的往来：
  `;
  
      // Use the 3 most recent summaries from current conversation
      const recentSummaries = char.conversationSummaries.slice(0, 3);
      for (const summary of recentSummaries) {
        context += `${summary.date}：${summary.content}
  `;
      }
  
      // Note: Dynamic memory loading not implemented for letters
      // Letters are one-way communication so we don't have conversation history to analyze
      // If needed, can be enhanced to detect mentioned names in the incoming letter text
  
      return context;
    }
    buildAllMemoriesBlock(player, ai, template, context = {}) {
      const memories = (ai.memories || []).map((memory) => ({ ...memory, character: ai.shortName }));
      if (memories.length === 0) return null;
      const tpl = template || `所有相关角色的记忆：
  {{#each memories}}- {{this.character}} | {{this.creationDate}}（{{this.creationDateTotalDays}}）：{{this.desc}} [相关性：{{this.relevanceWeight}}]
  {{/each}}`;
      return this.templateEngine.renderTemplateString(tpl, { ...context, memories });
    }
  }
  
  return LetterPromptBuilder;
}

module.exports = { createLetterPromptBuilder };

"use strict";

function createLetterPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository, promptConfigManager }) {
  class LetterPromptBuilder {
    constructor() {
      this.templateEngine = new TemplateEngine();
      this.scriptLoader = new PromptScriptLoader();
    }

    buildMessages(gameData, letter) {
      const ai = gameData.getAi();
      const player = gameData.getPlayer();
      if (!ai || !player) throw new Error("Missing player or AI character data for letter prompt");
      const settings = settingsRepository.getLetterPromptSettings();
      const messages = [];
      const context = { character: ai, player, ai, gameData, letter };
      for (const block of settings.blocks || []) {
        if (!block.enabled) continue;
        this.applyBlock(block, messages, context, settings);
      }
      if (settings.suffix?.enabled && settings.suffix.template) {
        const suffixContent = this.templateEngine.renderTemplateString(settings.suffix.template, context);
        messages.push({ role: "system", content: suffixContent });
      }
      console.log(messages);
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
          const summaries = this.buildPastSummariesContext(character, gameData);
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

    buildPastSummariesContext(character, gameData) {
      if (!character.conversationSummaries || character.conversationSummaries.length === 0) return null;
      const lines = character.conversationSummaries.map((summary) => `${summary.date}: ${summary.content}`);
      return `Past conversations between ${character.shortName} and ${gameData.playerName}:\n${lines.join("\n")}`;
    }

    buildAllMemoriesBlock(player, ai, template, context = {}) {
      const memories = [
        ...(player.memories || []).map((memory) => ({ ...memory, character: player.shortName })),
        ...(ai.memories || []).map((memory) => ({ ...memory, character: ai.shortName }))
      ];
      if (memories.length === 0) return null;
      const source = template || `All memories for the involved characters:
{{#each memories}}- {{this.character}} | {{this.creationDate}} ({{this.creationDateTotalDays}}): {{this.desc}} [relevance: {{this.relevanceWeight}}]
{{/each}}`;
      return this.templateEngine.renderTemplateString(source, { ...context, memories });
    }
  }

  return LetterPromptBuilder;
}

module.exports = { createLetterPromptBuilder };

"use strict";

function createPromptBuilder({
  TemplateEngine,
  PromptScriptLoader,
  promptConfigManager,
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint,
  defaultChatInstruction
}) {
  const DEFAULT_CHAT_INSTRUCTION = defaultChatInstruction;
  class PromptBuilder {
    static {
      this.templateEngine = new TemplateEngine();
    }
    static {
      this.scriptLoader = new PromptScriptLoader();
    }
    static splitDescriptionForCache(description) {
      if (typeof description !== "string") return { stableContent: "", dynamicContent: "" };
      const match = /\n(\[date\([^\n]*\)\])\s*$/.exec(description);
      if (!match || match.index <= 0) return { stableContent: description, dynamicContent: "" };
      return {
        stableContent: description.slice(0, match.index).trimEnd(),
        dynamicContent: match[1]
      };
    }
    static stableStringify(value) {
      if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
      if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined && typeof value[key] !== "function").map((key) => `${JSON.stringify(key)}:${this.stableStringify(value[key])}`).join(",")}}`;
      }
      return JSON.stringify(value ?? null);
    }
    static getFrozenCharacterProfile(character, memoryContext) {
      const cache = memoryContext?.stableProfileCache;
      if (!(cache instanceof Map) || !character?.id) return character;
      const key = String(character.id);
      if (!cache.has(key)) cache.set(key, JSON.parse(this.stableStringify(character)));
      return cache.get(key);
    }
    static buildSummaryCacheAnchor() {
      return `VOTC_SUMMARY_CACHE_ANCHOR_v1
  You summarize CK3 roleplay records. Preserve concrete names, relationships, dates, places, amounts, decisions, promises, conflicts, emotional changes and unresolved plans that appear in the supplied material. Do not invent facts, merge different people, add later historical knowledge, or turn a proposal into a completed event. Follow the requested language and format. Output only the requested summary.`;
    }
    static prepareSummaryMessages(messages) {
      const prepared = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
      const alreadyAnchored = prepared.some((message) => typeof message.content === "string" && message.content.startsWith("VOTC_SUMMARY_CACHE_ANCHOR_"));
      if (!alreadyAnchored) prepared.unshift({ role: "system", content: this.buildSummaryCacheAnchor() });
      return prepared;
    }
    static getSummaryPromptBlocks(messages, requestType = "summary") {
      return messages.map((message, index) => {
        const content = typeof message.content === "string" ? message.content : "";
        let label = "Summary Dynamic Context";
        let type = "summary_dynamic";
        if (content.startsWith("VOTC_SUMMARY_CACHE_ANCHOR_")) {
          label = "Stable Summary Cache Anchor";
          type = "summary_cache_anchor";
        } else if (content.startsWith("Stable rolling-summary instructions:")) {
          label = "Stable Rolling Summary Instructions";
          type = "summary_stable";
        } else if (content.startsWith("Stable final-summary instructions:")) {
          label = "Stable Final Summary Instructions";
          type = "summary_stable";
        } else if (content.startsWith("Stable letter-summary instructions:")) {
          label = "Stable Letter Summary Instructions";
          type = "summary_stable";
        } else if (content.startsWith("Stable leaving-summary instructions:")) {
          label = "Stable Leaving Summary Instructions";
          type = "summary_stable";
        } else if (content.startsWith("Previous summary") || content.startsWith("此对话的先前摘要：")) {
          label = "Previous Summary";
        } else if (content.startsWith("New messages") || content.startsWith("完整对话：") || content.startsWith("最近的对话：") || content.startsWith("Full conversation:")) {
          label = "Summary Conversation Content";
        } else if (content.startsWith("Conversation participants:")) {
          label = "Summary Participant Context";
        } else if (content.startsWith("Dynamic leaving character:")) {
          label = "Leaving Character Context";
        } else if (message.role === "user" && index === messages.length - 1) {
          label = "Summary Generation Request";
        }
        return {
          id: `${requestType}-${index}`,
          label,
          type,
          position: index,
          tokens: TokenCounter.estimateMessageTokens(message),
          fingerprint: createPromptFingerprint(content)
        };
      });
    }
    /**
    * Build prompt for resummarization
    */
    static buildResummarizePrompt(messagesToSummarize, existingSummary) {
      const summarySettings = settingsRepository.getSummaryPromptSettings();
      const prompt = [{
        role: "system",
        content: `Stable rolling-summary instructions:\n${summarySettings.rollingPrompt}`
      }];
      if (existingSummary) {
        prompt.push({
          role: "system",
          content: `Previous summary of this conversation:
  
  ${existingSummary}`
        });
      }
      prompt.push({
        role: "system",
        content: "New messages to incorporate into the summary:\n\n" + messagesToSummarize.map((m) => `${m.name}: ${m.content}`).join("\n")
      });
      prompt.push({
        role: "user",
        content: "Generate the updated rolling summary now."
      });
      return prompt;
    }
    static getFinalSummaryInstructions() {
      const summarySettings = settingsRepository.getSummaryPromptSettings();
      return `${summarySettings.finalPrompt}\n\n本次最终摘要最多输出 ${summarySettings.finalSummaryMaxTokens} Token；请在该上限内优先保留具体事实。`;
    }
    static getFinalSummaryMaxTokens() {
      return settingsRepository.getSummaryPromptSettings().finalSummaryMaxTokens;
    }
    /**
     * Generate a system prompt based on the characters in the conversation
     */
    static generateSystemPrompt(char, gameData) {
      const promptSettings = settingsRepository.getPromptSettings();
      const templatePath = promptConfigManager.resolvePath(promptSettings.defaultMainTemplatePath);
      if (gameData.characters.size === 0 || !char) {
        console.log("No characters or main character missing for system prompt");
        return "You are characters in a medieval strategy game. Engage in conversation naturally.";
      }
      try {
        const rendered = this.templateEngine.renderTemplate(templatePath, {
          character: char,
          gameData
        });
        return rendered;
      } catch (error) {
        console.error("Failed to render system template, using fallback:", error);
      }
      return "You are characters in a medieval strategy game. Engage in conversation naturally.";
    }
    static buildMessages(history, char, gameData, currentSessionSummary, memoryContext = null) {
      // Keep context-length checks and actual requests byte-for-byte aligned.
      // The token-counting builder owns cache-aware ordering and still returns
      // the same message data used by this legacy convenience method.
      return this.buildMessagesWithTokenCount(history, char, gameData, currentSessionSummary, memoryContext).messages;
    }
    /**
     * Character-description scripts can be customized or disabled. Keep exact
     * responder facts close to history so direct factual questions use CK3 data.
     */
    static buildResponderGameFacts(char) {
      if (!char) return null;
      const age = Number(char.age);
      const primaryTitle = typeof char.primaryTitle === "string" ? char.primaryTitle.trim() : "";
      const title = primaryTitle && !["None", "None of", "None von", "None de"].includes(primaryTitle) ? primaryTitle : "无主要头衔";
      const courtPosition = typeof char.heldCourtAndCouncilPositions === "string" && char.heldCourtAndCouncilPositions.trim() ? char.heldCourtAndCouncilPositions.trim() : "无";
      const titleRank = typeof char.titleRankConcept === "string" && char.titleRankConcept !== "concept_none" ? char.titleRankConcept : "无";
      return `=== 当前回应角色的权威游戏资料（本轮 CK3 数据） ===
  - 游戏姓名／称号：${char.fullName || char.shortName || "未知"}
  - 姓名：${char.shortName || char.firstName || "未知"}
  - 年龄：${Number.isFinite(age) ? `${Math.floor(age)}岁` : "游戏未提供"}
  - 主要头衔：${title}
  - 宫廷／议会职位：${courtPosition}
  - 头衔等级：${titleRank}
  当被问及自己的姓名、称号、头衔、官职或年龄时，必须逐项以以上本轮游戏数据直接回答；不得根据历史、对话记忆或常识猜测，也不得用年龄阶段替代具体岁数。`;
    }
    /**
     * Stable, character-independent prefix for providers with prefix KV caching.
     * Keep this before all character-specific prompt blocks. It deliberately does
     * not include conversation history or memory, so the existing memory/history
     * behavior remains unchanged.
     */
    static buildCacheAnchor(gameData) {
      return `VOTC_CACHE_ANCHOR_v4
  这是 Voices of the Court 的固定系统上下文锚点。请将后续内容视为当前游戏的动态上下文，并始终遵守以下稳定规则：保持角色扮演身份；优先使用游戏实际数据；不把现代价值观强加给中世纪角色；涉及历史人物、事件、作品、诗词、典故、制度或技术时，先核验其出现、发生、写成、成名或流传时间是否不晚于游戏当前年份；年份不确定时明确表示不知晓，不得猜测或用未来知识补全；不得预知未来、后世评价或事件结局。角色回复不设固定句数、段落数或人为短回复目标，应按人物性格、关系、情绪和场景完整表达，但避免无意义重复。长期稳定记忆和当前话题记忆只代表过去知情背景，本轮事实与动作必须以当前对话消息及游戏实时数据为准。不要把本段当作对话内容，也不要复述本段。`;
    }
    /**
    * Build the stable portion of a character's past conversation summaries.
    * Third-party memories and relationship data are deliberately built by
    * buildMentionedCharactersContext() and placed near conversation history, so
    * changing the mentioned person does not invalidate this earlier cache prefix.
    *
    * @param {Character} char - The character
    * @param {GameData} gameData - The game data
    */
    static buildPastSummariesContext(char, gameData) {
      if (!char.conversationSummaries || char.conversationSummaries.length === 0) {
        return null;
      }
      
      let context = `以下是 ${char.shortName}、${gameData.playerName} 及其他角色之间最近的对话摘要：
  
  `;
      
      const recentSummaries = char.conversationSummaries.slice(0, 5);
      for (const summary of recentSummaries) {
        const absoluteDate = summary.date || "日期不详";
        context += `${absoluteDate}：${summary.content}
  `;
      }
      
      return context;
    }
    /**
     * Build volatile third-party memory and relationship context. The content is
     * unchanged in meaning, but is emitted immediately before conversation
     * history rather than inside the earlier stable summaries block.
     */
    static buildMentionedCharactersContext(char, gameData, history = null) {
      if (!history || history.length === 0) return null;
      const mentionedCharacterIds = gameData.findMentionedCharacterIdsInHistory(history, char);
      if (!gameData.mentionedCharactersInContext) gameData.mentionedCharactersInContext = /* @__PURE__ */ new Set();
      for (const characterId of mentionedCharacterIds) {
        gameData.mentionedCharactersInContext.add(characterId);
      }
      let context = "";
      const mentionedCharsInfo = gameData.getMentionedCharactersInfo(char);
      if (mentionedCharsInfo) context += mentionedCharsInfo;
      return context.trim() ? context : null;
    }
    /**
     * Build a final, comprehensive summary using all roleplay messages.
     */
    static buildFinalSummary(gameData, history, currentSummary, lastSummarizedMessageIndex) {
      const characters = Array.from(gameData.characters.values()).map((c) => c.shortName).join("、");
      const summarySettings = settingsRepository.getSummaryPromptSettings();
      const stableInstructions = {
        role: "system",
        content: `Stable final-summary instructions:\n${summarySettings.finalPrompt}`
      };
      const baseSystem = {
        role: "system",
        content: `Conversation participants: ${characters}. This is a medieval roleplay conversation.`
      };
      const buildConversationText = (msgs, title) => ({
        role: "system",
        content: `${title}
  ` + msgs.map((m) => `${m.name}：${m.content}`).join("\n")
      });
      const userPrompt = {
        role: "user",
        content: "Generate the final conversation summary now."
      };
      if (lastSummarizedMessageIndex == null) {
        return [
          stableInstructions,
          baseSystem,
          buildConversationText(history, "完整对话："),
          userPrompt
        ];
      }
      const newMessages = history.slice(lastSummarizedMessageIndex);
      return [
        stableInstructions,
        baseSystem,
        { role: "system", content: "此对话的先前摘要：\n" + currentSummary },
        buildConversationText(newMessages, "最近的对话："),
        userPrompt
      ];
    }
    /**
     * Calculate relative time between dates
     */
    static getRelativeTime(pastDateTotalDays, currentDateTotalDays) {
      if (pastDateTotalDays === void 0) {
        return null;
      }
      const timeDifference = currentDateTotalDays - pastDateTotalDays;
      if (timeDifference < 1) {
        return "不到一天前";
      }
      if (timeDifference < 7) {
        return `${timeDifference}天前`;
      }
      if (timeDifference < 30) {
        return `${Math.floor(timeDifference / 7)}周前`;
      }
      if (timeDifference < 365) {
        return `${Math.floor(timeDifference / 30)}个月前`;
      }
      return `${Math.floor(timeDifference / 365)}年前`;
    }
    static buildMemoriesBlock(gameData, character, limit = 5, template, context = {}) {
      const allMemories = Array.isArray(character?.memories) ? [...character.memories] : [];
      if (allMemories.length === 0) return null;
      const sorted = allMemories.sort((a, b) => (b.relevanceWeight ?? 0) - (a.relevanceWeight ?? 0));
      const selected = sorted.slice(0, limit);
      const tpl = template || "相关记忆：\n{{#each memories}}- {{this.creationDate}}：{{this.desc}}\n{{/each}}";
      return this.templateEngine.renderTemplateString(tpl, { ...context, memories: selected });
    }
    /**
     * Split the bundled main template into cache-aware system messages. Custom
     * templates without VOTC_SEGMENT markers remain a single backwards-compatible
     * main block. Markers are Handlebars comments, so they are harmless in the
     * prompt editor and in older builds.
     */
    static splitMainTemplateSegments(template) {
      const markerPattern = /\{\{!\s*VOTC_SEGMENT:([a-z0-9_-]+)\s*\}\}/gi;
      const labels = {
        stable_global: "Stable Global Rules",
        stable_history_rp: "Stable History and Roleplay Rules",
        world_context: "World and Historical Context",
        character_base: "Character Base Profile",
        character_state: "Character State, Relations and Scene"
      };
      const segments = [];
      let currentId = "main";
      let contentStart = 0;
      let markerFound = false;
      let match;
      while ((match = markerPattern.exec(template)) !== null) {
        markerFound = true;
        const content = template.slice(contentStart, match.index);
        if (content.trim()) {
          segments.push({ id: currentId, label: labels[currentId] || "Main Prompt Preamble", template: content });
        }
        currentId = match[1].toLowerCase();
        contentStart = markerPattern.lastIndex;
      }
      const remaining = template.slice(contentStart);
      if (remaining.trim()) {
        segments.push({ id: currentId, label: labels[currentId] || currentId, template: remaining });
      }
      if (!markerFound) {
        return [{ id: "main", label: "Main System Prompt", template }];
      }
      return segments;
    }
    static applyBlock(block, messages, history, baseContext, promptSettings) {
      const { character, gameData, summary } = baseContext;
      const renderTemplate = (template, context) => {
        try {
          return this.templateEngine.renderTemplateString(template, context);
        } catch (error) {
          const blockLabel = block.label || block.type;
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new Error(`Template error in block "${blockLabel}" (${block.type}): ${errorMsg}`);
        }
      };
      switch (block.type) {
        case "main": {
          const template = promptSettings.mainTemplate || promptConfigManager.getDefaultMainTemplateContent();
          const segments = this.splitMainTemplateSegments(template);
          for (const segment of segments) {
            const content = renderTemplate(segment.template, baseContext);
            if (content?.trim()) {
              messages.push({ role: block.role || "system", content });
            }
          }
          break;
        }
        case "description": {
          if (!block.scriptPath) break;
          const descScriptPath = promptConfigManager.resolvePath(block.scriptPath);
          try {
            const descriptionBlock = this.scriptLoader.executeDescription(descScriptPath, gameData, character.id);
            if (descriptionBlock) {
              messages.push({ role: "system", content: descriptionBlock });
            } 
          } catch (error) {
            console.error("Failed to run description script:", error);
          }
          break;
        }
        case "examples": {
          if (!block.scriptPath) break;
          const examplesScriptPath = promptConfigManager.resolvePath(block.scriptPath);
          try {
            const exampleMessages = this.scriptLoader.executeExamples(examplesScriptPath, gameData, character.id);
            if (Array.isArray(exampleMessages) && exampleMessages.length > 0) {
              messages.push(...exampleMessages);
            }
          } catch (error) {
            console.error("Failed to run example script:", error); 
          }
          break;
        }
        case "memories": {
          const memoriesBlock = this.buildMemoriesBlock(gameData, character, block.limit ?? 5, block.template, baseContext);
          if (memoriesBlock) {
            messages.push({ role: block.role || "system", content: memoriesBlock });
          }
          break;
        }
        case "past_summaries": {
          if (baseContext.memoryContext?.engineVersion?.startsWith("2.")) break;
          const pastSummaries = this.buildPastSummariesContext(character, gameData);
          if (pastSummaries) {
            const content = block.template ? renderTemplate(block.template, { ...baseContext, pastSummaries }) : pastSummaries;
            messages.push({ role: block.role || "system", content });
          }
          break;
        }
        case "rolling_summary": {
          if (summary) {
            const tpl = block.template || "此对话中较早消息的摘要：\n{{summary}}";
            const content = renderTemplate(tpl, { ...baseContext, summary });
            messages.push({ role: block.role || "system", content });
          }
          break;
        }
        case "history": {
          messages.push(
            ...history.map((m) => ({
              role: m.role,
              content: m.name ? `${m.name}: ${m.content}` : m.content
            }))
          );
          break;
        }
        case "instruction": {
          const tpl = block.template || DEFAULT_CHAT_INSTRUCTION;
          const content = renderTemplate(tpl, baseContext);
          messages.push({
            role: block.role || "user",
            content
          });
          break;
        }
        case "custom": {
          if (!block.template) break;
          const content = renderTemplate(block.template, baseContext);
          messages.push({ role: block.role || "system", content });
          break;
        }
      }
    }
    /**
     * Build messages with token counting for preview
     */
    static buildMessagesWithTokenCount(history, char, gameData, currentSessionSummary, memoryContext = null) {
      const promptSettings = settingsRepository.getPromptSettings();
      const blocks = promptSettings.blocks || [];
      const llmMessages = [];
      const blocksWithTokens = [{
        block: { id: "cache-anchor", type: "cache_anchor", label: "Stable Cache Anchor", stable: true },
        content: this.buildCacheAnchor(gameData),
        tokens: TokenCounter.estimateTokens(this.buildCacheAnchor(gameData))
      }];
      llmMessages.push({ role: "system", content: blocksWithTokens[0].content });
      const context = {
        character: char,
        stableCharacter: this.getFrozenCharacterProfile(char, memoryContext),
        gameData,
        summary: currentSessionSummary,
        memoryContext
      };
      const workingHistory = history.map((m) => ({
        role: m.role,
        name: m.name,
        content: m.content
      })).filter((m) => !!m.content);
      const activeParticipantIds = new Set((memoryContext?.activeParticipantIds || [...gameData.characters.keys()]).map(Number));
      const activeCounterpartIds = [...activeParticipantIds].filter((id) => Number(id) !== Number(char.id));
      const activeParticipantRelationshipContext = gameData.getActiveParticipantRelationshipInfo(char, activeCounterpartIds);
      const activeParticipantRelationshipBlock = {
        id: "active-participant-relationship",
        type: "participant_relationship",
        label: "Active Participant Relationship",
        enabled: true,
        role: "system",
        stable: false
      };
      const mentionedCharactersContext = this.buildMentionedCharactersContext(char, gameData, workingHistory);
      const responderGameFacts = this.buildResponderGameFacts(char);
      const responderGameFactsBlock = {
        id: "responder-game-facts",
        type: "responder_game_facts",
        label: "Responder Authoritative Game Facts",
        enabled: true,
        role: "system",
        stable: false
      };
      const stableMemoryBlock = {
        id: "memory-stable",
        type: "memory_stable",
        label: "Stable Long-term Memory",
        enabled: true,
        role: "system",
        stable: false
      };
      const directMemoryBlock = {
        id: "memory-direct-frozen",
        type: "memory_direct_frozen",
        label: "Frozen Direct Relationship Memory",
        enabled: true,
        role: "system",
        stable: false
      };
      const mentionedSnapshotBlock = {
        id: "memory-mentioned-snapshot",
        type: "memory_mentioned_snapshot",
        label: "Frozen Mentioned Character Snapshot",
        enabled: true,
        role: "system",
        stable: false
      };
      const sessionTopicAnchorBlock = {
        id: "memory-session-topic-anchor",
        type: "memory_session_topic_anchor",
        label: "Frozen Session Topic Anchor",
        enabled: true,
        role: "system",
        stable: false
      };
      const deferredMainSegments = [];
      const deferredDescriptionBlocks = [];
      const deferredContextBlocks = [];
      let preHistoryContextInserted = false;
      const insertPreHistoryContext = () => {
        if (preHistoryContextInserted) return;
        preHistoryContextInserted = true;
        // Relationship and long-lived summaries are normally unchanged for a
        // responder. Keep them before date/scene state so a date advance does
        // not evict this useful prefix from the provider cache.
        if (memoryContext?.stableText) {
          llmMessages.push({ role: "system", content: memoryContext.stableText });
          blocksWithTokens.push({
            block: stableMemoryBlock,
            content: memoryContext.stableText,
            tokens: TokenCounter.estimateTokens(memoryContext.stableText)
          });
        }
        if (memoryContext?.directStableText) {
          llmMessages.push({ role: "system", content: memoryContext.directStableText });
          blocksWithTokens.push({
            block: directMemoryBlock,
            content: memoryContext.directStableText,
            tokens: TokenCounter.estimateTokens(memoryContext.directStableText)
          });
        }
        if (memoryContext?.mentionedSnapshotText) {
          llmMessages.push({ role: "system", content: memoryContext.mentionedSnapshotText });
          blocksWithTokens.push({
            block: mentionedSnapshotBlock,
            content: memoryContext.mentionedSnapshotText,
            tokens: TokenCounter.estimateTokens(memoryContext.mentionedSnapshotText)
          });
        }
        if (memoryContext?.topicPatchText) {
          llmMessages.push({ role: "system", content: memoryContext.topicPatchText });
          blocksWithTokens.push({
            block: sessionTopicAnchorBlock,
            content: memoryContext.topicPatchText,
            tokens: TokenCounter.estimateTokens(memoryContext.topicPatchText)
          });
        }
        for (const block of deferredContextBlocks) {
          const result = this.applyBlockWithTokenCount(block, llmMessages, workingHistory, context, promptSettings);
          if (Array.isArray(result)) blocksWithTokens.push(...result);
          else if (result) blocksWithTokens.push(result);
        }
        for (const deferred of deferredMainSegments) {
          llmMessages.push(deferred.message);
          blocksWithTokens.push(deferred.tokenBlock);
        }
        for (const deferred of deferredDescriptionBlocks) {
          llmMessages.push(deferred.message);
          blocksWithTokens.push(deferred.tokenBlock);
        }
        if (responderGameFacts) {
          llmMessages.push({ role: "system", content: responderGameFacts });
          blocksWithTokens.push({
            block: responderGameFactsBlock,
            content: responderGameFacts,
            tokens: TokenCounter.estimateTokens(responderGameFacts)
          });
        }
      };
      for (const block of blocks) {
        if (!block.enabled) continue;
        if (["past_summaries", "memories", "rolling_summary"].includes(block.type)) {
          deferredContextBlocks.push(block);
          continue;
        }
        if (block.type === "history" || block.type === "instruction") insertPreHistoryContext();
        const result = this.applyBlockWithTokenCount(block, llmMessages, workingHistory, context, promptSettings, {
          deferredMainSegments,
          deferredDescriptionBlocks,
          presenceText: [memoryContext?.presenceText, activeParticipantRelationshipContext].filter(Boolean).join("\n\n"),
          topicPatchText: mentionedCharactersContext,
          turnRecallText: memoryContext?.turnRecallText
        });
        if (Array.isArray(result)) {
          blocksWithTokens.push(...result);
        } else if (result) {
          blocksWithTokens.push(result);
        }
      }
      insertPreHistoryContext();
      if (promptSettings.suffix?.enabled && promptSettings.suffix.template) {
        const suffixBlock = {
          id: "suffix",
          type: "custom",
          label: promptSettings.suffix.label || "Suffix",
          enabled: true,
          role: "system",
          template: promptSettings.suffix.template
        };
        try {
          const suffixContent = this.templateEngine.renderTemplateString(promptSettings.suffix.template, context);
          const suffixTokens = TokenCounter.estimateTokens(suffixContent);
          llmMessages.push({ role: "system", content: suffixContent });
          blocksWithTokens.push({ block: suffixBlock, content: suffixContent, tokens: suffixTokens });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error("Template error in Suffix block:", errorMsg);
          blocksWithTokens.push({ block: suffixBlock, content: "", tokens: 0, error: `Template error in Suffix block. Check Handlebars syntax.` });
        }
      }
      for (const tokenBlock of blocksWithTokens) {
        if (tokenBlock?.block && tokenBlock.block.stable === undefined) tokenBlock.block.stable = false;
      }
      const totalTokens = TokenCounter.calculateTotalTokens(llmMessages);
      return {
        messages: llmMessages,
        blocks: blocksWithTokens,
        totalTokens
      };
    }
    /**
     * Apply a single block with token counting.
     * Template errors are caught and returned as error info in the result rather than thrown.
     */
    static applyBlockWithTokenCount(block, messages, history, baseContext, promptSettings, options = {}) {
      const { character, gameData, summary } = baseContext;
      const renderTemplate = (template, context) => {
        try {
          return this.templateEngine.renderTemplateString(template, context);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`Template error in block "${block.label || block.type}":`, errorMsg);
          return null;
        }
      };
      switch (block.type) {
        case "main": {
          const template = promptSettings.mainTemplate || promptConfigManager.getDefaultMainTemplateContent();
          const segments = this.splitMainTemplateSegments(template);
          const renderedSegments = segments.map((segment) => ({
            ...segment,
            content: renderTemplate(segment.template, segment.id === "character_base" ? { ...baseContext, character: baseContext.stableCharacter || character } : baseContext)
          }));
          if (renderedSegments.some((segment) => segment.content === null)) {
            return { block, content: "", tokens: 0, error: `Template error in "${block.label || "Main Prompt"}" block. Check Handlebars syntax.` };
          }
          const nonEmptySegments = renderedSegments.filter((segment) => segment.content?.trim());
          const immediateBlocks = [];
          for (const segment of nonEmptySegments) {
            const message = { role: block.role || "system", content: segment.content };
            const tokenBlock = {
              block: {
                ...block,
                id: `${block.id || "main"}-${segment.id}`,
                type: "main_segment",
                label: segment.label,
                stable: ["stable_global", "stable_history_rp", "character_base"].includes(segment.id)
              },
              content: segment.content,
              tokens: TokenCounter.estimateTokens(segment.content)
            };
            // Date, world state and scene must stay near the history tail. This
            // leaves character profile, examples and persisted summaries in the
            // reusable prefix when a game day advances.
            if (options.deferredMainSegments && (segment.id === "world_context" || segment.id === "character_state")) {
              options.deferredMainSegments.push({ message, tokenBlock });
            } else {
              messages.push(message);
              immediateBlocks.push(tokenBlock);
            }
          }
          if (nonEmptySegments.length === 1 && nonEmptySegments[0].id === "main") {
            const content = nonEmptySegments[0].content;
            return { block, content, tokens: TokenCounter.estimateTokens(content) };
          }
          if (immediateBlocks.length > 0) return immediateBlocks;
          break;
        }
        case "description": {
          if (!block.scriptPath) break;
          const descScriptPath = promptConfigManager.resolvePath(block.scriptPath);
          try {
            const profileCache = baseContext.memoryContext?.stableDescriptionCache;
            const cacheKey = String(character.id);
            let descriptionBlock = profileCache instanceof Map ? profileCache.get(cacheKey) : null;
            if (!descriptionBlock) {
              descriptionBlock = this.scriptLoader.executeDescription(descScriptPath, gameData, character.id);
              if (descriptionBlock && profileCache instanceof Map) profileCache.set(cacheKey, descriptionBlock);
            }
            if (descriptionBlock) {
              const { stableContent, dynamicContent } = this.splitDescriptionForCache(descriptionBlock);
              const tokenBlocks = [];
              if (stableContent) {
                messages.push({ role: "system", content: stableContent });
                tokenBlocks.push({
                  block: { ...block, id: `${block.id || "description"}-stable`, type: "description", label: `${block.label || "Character Description"} (Stable Profile)`, stable: true },
                  content: stableContent,
                  tokens: TokenCounter.estimateTokens(stableContent)
                });
              }
              if (dynamicContent) {
                const tokenBlock = {
                  block: { ...block, id: `${block.id || "description"}-dynamic`, type: "description_dynamic", label: `${block.label || "Character Description"} (Dynamic Scene)`, stable: false },
                  content: dynamicContent,
                  tokens: TokenCounter.estimateTokens(dynamicContent)
                };
                if (options.deferredDescriptionBlocks) {
                  options.deferredDescriptionBlocks.push({ message: { role: "system", content: dynamicContent }, tokenBlock });
                } else {
                  messages.push({ role: "system", content: dynamicContent });
                  tokenBlocks.push(tokenBlock);
                }
              }
              return tokenBlocks.length === 1 ? tokenBlocks[0] : tokenBlocks;
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error("Failed to run description script:", error);
            return { block, content: "", tokens: 0, error: `Script error: ${errorMsg}` };
          }
          break;
        }
        case "examples": {
          if (!block.scriptPath) break;
          const examplesScriptPath = promptConfigManager.resolvePath(block.scriptPath);
          try {
            const exampleMessages = this.scriptLoader.executeExamples(examplesScriptPath, gameData, character.id);
            if (Array.isArray(exampleMessages) && exampleMessages.length > 0) {
              messages.push(...exampleMessages);
              const content = exampleMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
              return { block: { ...block, stable: true }, content, tokens: TokenCounter.calculateTotalTokens(exampleMessages) };
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error("Failed to run example script:", error);
            return { block, content: "", tokens: 0, error: `Script error: ${errorMsg}` };
          }
          break;
        }
        case "memories": {
          try {
            const memoriesBlock = this.buildMemoriesBlock(gameData, character, block.limit ?? 5, block.template, baseContext);
            if (memoriesBlock) {
              messages.push({ role: block.role || "system", content: memoriesBlock });
              return { block, content: memoriesBlock, tokens: TokenCounter.estimateTokens(memoriesBlock) };
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return { block, content: "", tokens: 0, error: `Template error in "${block.label || "Memories"}" block: ${errorMsg}` };
          }
          break;
        }
        case "past_summaries": {
          if (baseContext.memoryContext?.engineVersion?.startsWith("2.")) break;
          const pastSummaries = this.buildPastSummariesContext(character, gameData);
          if (pastSummaries) {
            const content = block.template ? renderTemplate(block.template, { ...baseContext, pastSummaries }) : pastSummaries;
            if (content === null) {
              return { block, content: "", tokens: 0, error: `Template error in "${block.label || "Past Summaries"}" block. Check Handlebars syntax.` };
            }
            messages.push({ role: block.role || "system", content });
            return { block, content, tokens: TokenCounter.estimateTokens(content) };
          }
          break;
        }
        case "rolling_summary": {
          if (summary) {
            const tpl = block.template || "此对话中较早消息的摘要：\n{{summary}}";
            const content = renderTemplate(tpl, { ...baseContext, summary });
            if (content === null) {
              return { block, content: "", tokens: 0, error: `模板错误："${block.label || "Rolling Summary"}" block。请检查 Handlebars 语法。` };
            }
            messages.push({ role: block.role || "system", content });
            return { block, content, tokens: TokenCounter.estimateTokens(content) };
          }
          break;
        }
        case "history": {
          const historyMessages = history.map((m) => ({
            role: m.role,
            content: m.name ? `${m.name}: ${m.content}` : m.content
          }));
          const hasCurrentUserMessage = historyMessages.at(-1)?.role === "user";
          const priorHistory = hasCurrentUserMessage ? historyMessages.slice(0, -1) : historyMessages;
          const currentUserMessage = hasCurrentUserMessage ? historyMessages.at(-1) : null;
          const tokenBlocks = [];
          if (priorHistory.length > 0) {
            messages.push(...priorHistory);
            tokenBlocks.push({
              block,
              content: priorHistory.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
              tokens: TokenCounter.calculateTotalTokens(priorHistory)
            });
          }
          if (options.presenceText) {
            messages.push({ role: "system", content: options.presenceText });
            tokenBlocks.push({
              block: { id: "current-presence-roster", type: "presence_roster", label: "Current Presence and Relationships", enabled: true, role: "system", stable: false },
              content: options.presenceText,
              tokens: TokenCounter.estimateTokens(options.presenceText)
            });
          }
          if (options.topicPatchText) {
            messages.push({ role: "system", content: options.topicPatchText });
            tokenBlocks.push({
              block: { id: "memory-topic-patch", type: "memory_topic_patch", label: "Turn Topic Memory Patch", enabled: true, role: "system", stable: false },
              content: options.topicPatchText,
              tokens: TokenCounter.estimateTokens(options.topicPatchText)
            });
          }
          if (currentUserMessage) {
            messages.push(currentUserMessage);
            tokenBlocks.push({
              block: { ...block, id: `${block.id || "history"}-current-user`, type: "current_user", label: "Current User Message", stable: false },
              content: `user: ${currentUserMessage.content}`,
              tokens: TokenCounter.calculateTotalTokens([currentUserMessage])
            });
          }
          if (options.turnRecallText) {
            messages.push({ role: "system", content: options.turnRecallText });
            tokenBlocks.push({
              block: { id: "memory-turn-recall", type: "memory_turn_recall", label: "Turn Recall", enabled: true, role: "system", stable: false },
              content: options.turnRecallText,
              tokens: TokenCounter.estimateTokens(options.turnRecallText)
            });
          }
          return tokenBlocks;
        }
        case "instruction": {
          const tpl = block.template || DEFAULT_CHAT_INSTRUCTION;
          const content = renderTemplate(tpl, baseContext);
          if (content === null) {
            return { block, content: "", tokens: 0, error: `模板错误："${block.label || "Instruction"}" block。请检查 Handlebars 语法。` };
          }
          messages.push({ role: block.role || "user", content });
          return { block, content, tokens: TokenCounter.estimateTokens(content) };
        }
        case "custom": {
          if (!block.template) break;
          const content = renderTemplate(block.template, baseContext);
          if (content === null) {
            return { block, content: "", tokens: 0, error: `模板错误："${block.label || "Custom"}" block。请检查 Handlebars 语法。` };
          }
          messages.push({ role: block.role || "system", content });
          return { block, content, tokens: TokenCounter.estimateTokens(content) };
        }
      }
      return null;
    }
  }
  
  return PromptBuilder;
}

module.exports = { createPromptBuilder };

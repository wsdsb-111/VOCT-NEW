"use strict";

const { validateGenerationOutcome } = require("../providers/generation-outcome");

function createSummariesManager({ fs, path, summariesDir, memoryEngine, memorySystem, getCurrentConversation = () => null, requestSummary, requestDurable, getSummaryCapabilities, getSummaryOutputLimit = () => 4096, buildSummaryPrompt, persistRecoveredSummary }) {
  const fs$1 = fs;
  const VOTC_SUMMARIES_DIR = summariesDir;
  let summaryRegenerationInFlight = false;
  class SummariesManager {
    static getRecoveryStatus() {
      const conversation = getCurrentConversation();
      const currentId = conversation?.id;
      let pending = 0, manual = 0, balanceBlocked = 0;
      for (const file of memoryEngine.listRecoverySnapshots()) {
        const snapshot = memoryEngine.store.readJson(file, null);
        if (!snapshot || snapshot.conversationId === currentId || memoryEngine.activeFinalizationIds.has(snapshot.finalizationId)) continue;
        if (memoryEngine.isCommitted(snapshot)) continue;
        pending++;
        if (snapshot.finalizationStatus === "failed_manual") manual++;
        if (/402|insufficient balance/i.test(snapshot.lastError || "")) balanceBlocked++;
      }
      const durable = memoryEngine.memory4?.getRecoveryStatus(conversation?.gameData?.campaignToken || null) || { pending: 0, manual: 0, balanceBlocked: 0 };
      return { pending: pending + durable.pending, manual: manual + durable.manual,
        balanceBlocked: balanceBlocked + durable.balanceBlocked, narrativePending: pending, durablePending: durable.pending,
        durableInvalid: durable.invalid || 0,
        running: !!memoryEngine.pendingRecovery || memoryEngine.activeFinalizationIds.size > 0 || (memoryEngine.memory4?.inFlight.size || 0) > 0 };
    }

    static async retryFailedSummaries() {
      const results = await memoryEngine.recoverPendingFinalizations({
        manual: true,
        activeCampaignToken: getCurrentConversation()?.gameData?.campaignToken || null,
        isConversationActive: id => getCurrentConversation()?.id === id,
        buildPrompt: buildSummaryPrompt,
        requestSummary,
        requestDurable,
        getSummaryCapabilities,
        resolveParticipantProfiles: snapshot => memoryEngine.resolveRecoveryParticipantProfiles(snapshot),
        persistCharacterFolders: persistRecoveredSummary
      });
      this.refreshCurrentConversation();
      return {
        success: results.every(result => result.success),
        recovered: results.filter(result => result.success && !result.alreadyCommitted).length,
        failed: results.filter(result => !result.success).length,
        recoveryStatus: this.getRecoveryStatus()
      };
    }

    static refreshCurrentConversation() {
      const conversation = getCurrentConversation();
      if (!conversation) return;
      memoryEngine.invalidateConversationRecallState(conversation);
      conversation.gameData?.loadCharactersSummaries?.();
    }

    static async regenerateSummary(playerId, characterId, summaryIndex, expectedContent) {
      if (summaryRegenerationInFlight) return { success: false, error: "summary_regeneration_in_progress" };
      if (typeof requestSummary !== "function") return { success: false, error: "summary_model_unavailable" };
      if (typeof expectedContent !== "string" || !expectedContent.trim() || expectedContent.length > 1048576) {
        return { success: false, error: "summary_regeneration_source_invalid" };
      }
      const filePath = this.findSummaryFilePath(playerId, characterId).playerPerspectivePath;
      if (!filePath) return { success: false, error: "summary_file_not_found" };
      let summaries;
      try {
        summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
      } catch (error) {
        console.error(`Failed to read summary for regeneration: ${filePath}`, error);
        return { success: false, error: "summary_file_unreadable" };
      }
      if (!Array.isArray(summaries) || !Number.isInteger(summaryIndex) || summaryIndex < 0 || summaryIndex >= summaries.length) {
        return { success: false, error: "summary_index_invalid" };
      }
      const original = summaries[summaryIndex];
      if (!original || typeof original.content !== "string" || original.content !== expectedContent) {
        return { success: false, error: "summary_regeneration_stale" };
      }
      if (original.sourceType === "CK3_OFFICIAL_RECOLLECTION" || original.type === "official_recollection" || original.subtype === "official_recollection") {
        return { success: false, error: "official_recollection_is_not_regenerable" };
      }
      const ownerName = original.playerName || String(playerId);
      const counterpartName = original.characterName || String(characterId);
      const prompt = [
        { role: "system", content: "你是 VOCT 的人物视角对话摘要整理器。请把输入的已保存摘要整理成准确、连贯、适度简洁的中文叙事，优先保留事情经过：谁在何时做了什么、为何行动（仅限原文明确说明）、对方如何回应、达成或拒绝了什么、造成什么结果，以及重要承诺、条件、关系变化和未解决事项。合并重复发言与纯寒暄，不要把整段逐轮对话原样抄回。只使用原文明确提供的信息，不补充或推断人物、时间、动机、因果、情绪或结果；保持原文已有的人物视角和知识范围，不推断其他角色是否在场或知情。仅整理当前这一篇摘要，不扩展到其他人物目录。只输出整理后的摘要正文，不要标题、说明、JSON 或代码围栏。" },
        { role: "user", content: `目录人物：${ownerName}（${playerId}）\n对话对象：${counterpartName}（${characterId}）\n原摘要日期：${original.date || "未记录"}\n\n以下已保存正文是唯一信息来源，请仅据此整理：\n\n${original.content}` }
      ];
      summaryRegenerationInFlight = true;
      try {
        const configuredLimit = Number(getSummaryOutputLimit());
        const maxTokens = Number.isInteger(configuredLimit) && configuredLimit >= 256 && configuredLimit <= 16384 ? configuredLimit : 4096;
        const generated = await requestSummary(prompt, { attempt: 1, maxTokens, requestType: "summary_rewrite" });
        const outcome = typeof generated === "string"
          ? { content: generated, complete: true, truncated: false }
          : validateGenerationOutcome(generated);
        if (outcome.truncated) return { success: false, error: "summary_regeneration_output_truncated" };
        if (!outcome.complete) return { success: false, error: "summary_regeneration_output_incomplete" };
        const regeneratedContent = String(outcome.content || "").trim().replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
        if (!regeneratedContent || regeneratedContent.length > 1048576) return { success: false, error: "summary_regeneration_output_invalid" };
        if (regeneratedContent.replace(/\s+/g, "") === original.content.replace(/\s+/g, "")) {
          return { success: false, error: "summary_regeneration_no_change" };
        }
        let latest;
        try {
          latest = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
        } catch (_error) {
          return { success: false, error: "summary_regeneration_stale" };
        }
        if (!Array.isArray(latest) || !latest[summaryIndex] || latest[summaryIndex].content !== original.content
          || latest[summaryIndex].finalizationId !== original.finalizationId || latest[summaryIndex].date !== original.date) {
          return { success: false, error: "summary_regeneration_stale" };
        }
        const result = await this.updateSummary(playerId, characterId, summaryIndex, regeneratedContent);
        if (!result.success) return result;
        return { success: true, content: regeneratedContent };
      } catch (error) {
        console.error(`Failed to regenerate summary for character ${characterId} from owner ${playerId}:`, error);
        return { success: false, error: error instanceof Error ? error.message : "summary_regeneration_failed" };
      } finally {
        summaryRegenerationInFlight = false;
      }
    }

    static async bindLegacySummaryCampaign({ ownerId, counterpartId, summaryIds } = {}) {
      const context = await this.getLegacyBulkBindingContext(ownerId, counterpartId);
      this.assertCurrentLegacyBindingContext(context);
      const numericOwnerId = Number(ownerId), numericCounterpartId = Number(counterpartId);
      if (!Number.isSafeInteger(numericOwnerId) || numericOwnerId <= 0 || !Number.isSafeInteger(numericCounterpartId) || numericCounterpartId <= 0 || numericOwnerId === numericCounterpartId) {
        throw new Error("legacy_summary_binding_pair_invalid");
      }
      const hasUniqueCharacter = id => [...context.gameData.characters.values()].filter(character => Number(character?.id) === id).length === 1;
      if (!hasUniqueCharacter(numericOwnerId) || !hasUniqueCharacter(numericCounterpartId)) throw new Error("legacy_summary_binding_character_not_in_current_campaign");
      const result = memoryEngine.bindLegacySummaryCampaign({ ownerId: numericOwnerId, counterpartId: numericCounterpartId,
        summaryIds, campaignToken: context.campaignToken, source: "user_confirmed_migration" });
      this.refreshCurrentConversation();
      return result;
    }

    static async getLegacyBulkBindingContext(ownerId, counterpartId = null) {
      const conversation = getCurrentConversation();
      if (!conversation) throw new Error("legacy_binding_conversation_not_active");
      if (!conversation.gameData && conversation.gameDataReady && typeof conversation.gameDataReady.then === "function") {
        await conversation.gameDataReady;
      }
      if (getCurrentConversation() !== conversation) throw new Error("legacy_binding_conversation_changed");
      const gameData = conversation.gameData;
      const numericOwnerId = Number(ownerId), numericCounterpartId = counterpartId == null ? null : Number(counterpartId);
      if (!gameData || !(gameData.characters instanceof Map)) throw new Error("legacy_binding_game_data_unavailable");
      if (typeof gameData.campaignToken !== "string" || !gameData.campaignToken.trim()) throw new Error("legacy_binding_campaign_not_loaded");
      if (!Number.isSafeInteger(numericOwnerId) || numericOwnerId <= 0) throw new Error("legacy_summary_binding_owner_invalid");
      if (counterpartId != null && (!Number.isSafeInteger(numericCounterpartId) || numericCounterpartId <= 0 || numericCounterpartId === numericOwnerId)) {
        throw new Error("legacy_summary_binding_pair_invalid");
      }
      const hasUniqueCharacter = id => [...gameData.characters.values()].filter(character => Number(character?.id) === id).length === 1;
      if (!hasUniqueCharacter(numericOwnerId)) throw new Error("legacy_summary_binding_owner_not_in_current_campaign");
      if (numericCounterpartId != null && !hasUniqueCharacter(numericCounterpartId)) throw new Error("legacy_summary_binding_character_not_in_current_campaign");
      return { conversation, gameData, ownerId: numericOwnerId, counterpartId: numericCounterpartId, campaignToken: gameData.campaignToken.trim() };
    }

    static assertCurrentLegacyBindingContext(context) {
      if (getCurrentConversation() !== context.conversation) throw new Error("legacy_binding_conversation_changed");
    }

    static async getMemory4Context(request = {}, requireCampaign = true) {
      const context = await this.getLegacyBulkBindingContext(request.ownerId);
      this.assertCurrentLegacyBindingContext(context);
      if (context.conversation.isActive === false) throw new Error("legacy_binding_conversation_not_active");
      if (requireCampaign && request.expectedCampaignToken !== context.campaignToken
        || request.expectedCampaignToken != null && request.expectedCampaignToken !== context.campaignToken) throw new Error("memory4_campaign_changed");
      if (!memoryEngine.memory4?.derived) throw new Error("memory4_unavailable");
      return context;
    }

    static invalidateMemory4Dynamic(context) {
      this.assertCurrentLegacyBindingContext(context);
      const conversation = context.conversation;
      const state = memoryEngine.ensureConversationState(conversation);
      const cache = state.responderRecallCache?.get(context.ownerId);
      for (const recall of conversation.dynamicRecallHistory?.get(context.ownerId)?.values() || []) {
        for (const key of recall.keys || []) cache?.seenDynamicSummaries?.delete(key);
      }
      conversation.dynamicRecallHistory?.delete(context.ownerId);
      if (cache) {
        for (const key of ["dynamicTurn", "dynamicExtra", "memory4Packet", "memory4Focus", "pendingMemory4Focus", "temporalFocus", "pendingTemporalFocus"]) delete cache[key];
        cache.folderSummaryRevision = memoryEngine.store.getFolderSummaryRevision(context.ownerId);
      }
      const character = context.gameData.characters.get(context.ownerId);
      if (character) character.dynamicMemoryCache = null;
    }

    static async getMemory4OwnerData(request = {}) {
      const context = await this.getMemory4Context(request, false);
      const scope = { campaignToken: context.campaignToken, ownerId: context.ownerId };
      if (request.contextOnly === true) return { success: true, ...scope };
      const coordinator = memoryEngine.memory4;
      const readContext = coordinator.createProfileReadContext(scope);
      const index = readContext.index;
      const directory = coordinator.store.directory(scope);
      const known = readContext.known;
      if (known && (known.ownerId !== context.ownerId || known.campaignToken !== context.campaignToken || !known.entities)) throw new Error("memory4_known_index_invalid");
      const legacy = memoryEngine.store.loadFolderSummariesForCharacter(context.ownerId);
      const owner = context.gameData.characters.get(context.ownerId);
      const entityIds = new Set([...Object.keys(known?.entities || {}), ...Object.keys(index.byEntity || {}),
        ...(owner?.relationsToCharacters || []).map(item => item.id),
        ...(owner?.relationsToPlayer?.length ? [context.gameData.playerID] : []),
        ...legacy.filter(memory => memory.provenance?.campaignToken === context.campaignToken).flatMap(memory => memory.subjects || [])]
        .map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && id !== context.ownerId));
      const offset = request.detailOffset || 0;
      const knownOffset = request.knownOffset || 0;
      if (![offset, knownOffset].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("memory4_page_invalid");
      const name = id => context.gameData.characters.get(id)?.shortName || context.gameData.characters.get(id)?.fullName || `#${id}`;
      const orderedEntities = [...entityIds].sort((left, right) => name(left).localeCompare(name(right), "zh-CN"));
      const details = Object.entries(index.entries).filter(([, row]) => !row.deleted && row.knownBy?.includes(context.ownerId)
        && (!request.entityId || row.entityIds?.includes(request.entityId))).sort((left, right) => String(right[1].eventTime?.from || right[1].conversationDate || "").localeCompare(String(left[1].eventTime?.from || left[1].conversationDate || ""), undefined, { numeric: true }));
      const officialFile = path.join(path.dirname(path.dirname(directory)), "官方追忆摘要.json");
      if (fs$1.existsSync(officialFile) && fs$1.lstatSync(officialFile).isSymbolicLink()) throw new Error("memory4_symlink_path");
      const official = coordinator.store.read(officialFile, []).filter(record => record?.sourceType === "CK3_OFFICIAL_RECOLLECTION"
        && Number(record.playerId) === context.ownerId && record.campaignToken === context.campaignToken);
      const coverage = coordinator.getLegacyCoverage(scope, legacy.filter(memory => memory.provenance?.campaignToken === scope.campaignToken
        && memory.provenance?.folderOwnerId === scope.ownerId));
      this.assertCurrentLegacyBindingContext(context);
      return { success: true, ownerId: context.ownerId, campaignToken: context.campaignToken, indexRevision: index.revision,
        known: { total: orderedEntities.length, offset: knownOffset, items: orderedEntities.slice(knownOffset, knownOffset + 40).map(entityId => ({
          ...coordinator.getKnownEntityProfile(scope, entityId, { gameData: context.gameData, legacyMemories: legacy, readContext }), displayName: name(entityId)
        })) },
        detail: { total: details.length, offset, entityId: request.entityId || null, items: details.slice(offset, offset + 40).map(([entryId, row]) => ({ entryId, ...row })) },
        derived: readContext.derived, official,
        legacy: { counts: coverage.counts, items: coverage.items.slice(0, 40), total: coverage.items.length } };
    }

    static async getMemory4Entry(request = {}) {
      const context = await this.getMemory4Context(request);
      const entry = memoryEngine.memory4.store.readEntry({ campaignToken: context.campaignToken, ownerId: context.ownerId }, request.entryId);
      if (entry.deleted || !entry.evidence?.knownBy?.includes(context.ownerId)) throw new Error("memory4_entry_unavailable");
      return { success: true, entry };
    }

    static async getMemory4Sources(request = {}) {
      const context = await this.getMemory4Context(request);
      const scope = { campaignToken: context.campaignToken, ownerId: context.ownerId };
      if (request.kind === "detail") {
        const { entry } = await this.getMemory4Entry(request);
        const valid = memoryEngine.memory4Recall.validateHistory(scope, [{ kind: "detail", id: entry.entryId,
          bodyHash: memoryEngine.memory4.store.loadIndex(scope).entries[entry.entryId].bodyHash }], { currentGameDate: context.gameData.date });
        return { success: true, sources: { kind: "detail", changed: !valid, entries: [{ ...entry, sourceValid: valid }], missingEntryIds: [] } };
      }
      if (!["year", "life"].includes(request.kind)) throw new Error("memory4_source_kind_invalid");
      return { success: true, sources: memoryEngine.memory4.derived.getSources(scope, request) };
    }

    static async mutateMemory4(request = {}) {
      const context = await this.getMemory4Context(request);
      const scope = { campaignToken: context.campaignToken, ownerId: context.ownerId };
      const coordinator = memoryEngine.memory4;
      const operations = ["updateDetail", "deleteDetail", "updateYear", "updateLife", "keepManual", "rebuild", "recompressLegacy", "cancelDerived"];
      if (!operations.includes(request.operation)) throw new Error("memory4_operation_invalid");
      if (!["recompressLegacy", "cancelDerived"].includes(request.operation) && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) throw new Error("memory4_expected_revision_required");
      if (request.operation.startsWith("update") && (typeof request.text !== "string" || !request.text.trim() || request.text.length > 16384)) throw new Error("memory4_text_required");
      let result;
      if (request.operation === "updateDetail") result = coordinator.store.updateEntry(scope, request.entryId, request.text, { expectedRevision: request.expectedRevision });
      else if (request.operation === "deleteDetail") result = coordinator.store.deleteEntry(scope, request.entryId, { expectedRevision: request.expectedRevision });
      else if (request.operation === "updateYear") result = coordinator.derived.updateYear(scope, request);
      else if (request.operation === "updateLife") result = coordinator.derived.updateLife(scope, request);
      else if (request.operation === "keepManual") result = coordinator.derived.keepManual(scope, request);
      else if (request.operation === "cancelDerived") result = coordinator.derived.cancel(scope);
      else if (request.operation === "rebuild") {
        if (!["year", "life", "all"].includes(request.kind) || typeof request.overwriteManual !== "boolean") throw new Error("memory4_rebuild_request_invalid");
        result = await coordinator.derived.rebuild(scope, { kind: request.kind, eventYear: request.eventYear, segmentId: request.segmentId,
          overwriteManual: request.overwriteManual, expectedRevision: request.expectedRevision });
      } else {
        if (typeof request.memoryId !== "string" || !/^[a-f0-9]{64}$/.test(request.expectedSourceHash || "")) throw new Error("memory4_legacy_source_invalid");
        result = await coordinator.recompressLegacy(scope, { memoryId: request.memoryId, expectedSourceHash: request.expectedSourceHash, manual: true });
      }
      this.assertCurrentLegacyBindingContext(context);
      if (context.gameData.campaignToken !== context.campaignToken) throw new Error("memory4_campaign_changed");
      if (result !== false && request.operation !== "cancelDerived") this.invalidateMemory4Dynamic(context);
      return { success: result !== false, result };
    }

    static async previewLegacyConversationBinding({ ownerId, counterpartId, folderName, conversationFile } = {}) {
      const context = await this.getLegacyBulkBindingContext(ownerId, counterpartId);
      this.assertCurrentLegacyBindingContext(context);
      if (typeof folderName !== "string" || typeof conversationFile !== "string") throw new Error("legacy_summary_binding_target_invalid");
      return memoryEngine.store.previewLegacyCampaignBinding({ scope: "conversation", ownerId: context.ownerId, counterpartId: context.counterpartId,
        folderName, conversationFile, campaignToken: context.campaignToken });
    }

    static async previewLegacyOwnerBinding({ ownerId } = {}) {
      const context = await this.getLegacyBulkBindingContext(ownerId);
      this.assertCurrentLegacyBindingContext(context);
      return memoryEngine.store.previewLegacyCampaignBinding({ scope: "owner", ownerId: context.ownerId, campaignToken: context.campaignToken });
    }

    static async bindLegacyConversationCampaign({ ownerId, counterpartId, folderName, conversationFile, expectedCampaignToken, previewRevision } = {}) {
      const context = await this.getLegacyBulkBindingContext(ownerId, counterpartId);
      this.assertCurrentLegacyBindingContext(context);
      if (expectedCampaignToken !== context.campaignToken) throw new Error("legacy_binding_preview_stale");
      if (typeof folderName !== "string" || typeof conversationFile !== "string") throw new Error("legacy_summary_binding_target_invalid");
      const result = memoryEngine.bindLegacyCampaignBatch({ scope: "conversation", ownerId: context.ownerId, counterpartId: context.counterpartId,
        folderName, conversationFile, campaignToken: context.campaignToken, previewRevision });
      this.refreshCurrentConversation();
      return result;
    }

    static async bindLegacyOwnerCampaign({ ownerId, expectedCampaignToken, previewRevision } = {}) {
      const context = await this.getLegacyBulkBindingContext(ownerId);
      this.assertCurrentLegacyBindingContext(context);
      if (expectedCampaignToken !== context.campaignToken) throw new Error("legacy_binding_preview_stale");
      const result = memoryEngine.bindLegacyCampaignBatch({ scope: "owner", ownerId: context.ownerId,
        campaignToken: context.campaignToken, previewRevision });
      this.refreshCurrentConversation();
      return result;
    }

    static writeSummaryJsonAtomic(filePath, summaries) {
      fs$1.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs$1.writeFileSync(tempPath, JSON.stringify(summaries, null, "\t"), "utf8");
      fs$1.renameSync(tempPath, filePath);
    }
    
    /**
     * List all summaries across all character folders with metadata
     * New format: character_name/与other_character的对话.json
     */
    static async listAllSummaries() {
      const results = [];
      try {
        if (!fs$1.existsSync(VOTC_SUMMARIES_DIR)) {
          return results;
        }
        
        // Read all entries in the summaries directory
        const entries = fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
        
        // Process character folders (new format)
        const characterFolders = entries.filter((dirent) => dirent.isDirectory());
        
        for (const folder of characterFolders) {
          const characterFolderName = folder.name;
          const characterFolderPath = path.join(VOTC_SUMMARIES_DIR, characterFolderName);
          
          try {
            // Read all conversation files in this character's folder
            const conversationFiles = fs$1.readdirSync(characterFolderPath).filter((file) => file.endsWith('.json'));
            
            for (const conversationFile of conversationFiles) {
              const filePath = path.join(characterFolderPath, conversationFile);
              
              try {
                const fileContent = fs$1.readFileSync(filePath, "utf8");
                const summaries = JSON.parse(fileContent);
                
                if (!Array.isArray(summaries) || summaries.length === 0) {
                  continue;
                }
                const catalogSummaries = summaries.map((summary, index) => summary && typeof summary.content === "string"
                  && summary.sourceType !== "CK3_OFFICIAL_RECOLLECTION" && !String(summary.campaignToken || "").trim()
                  ? { ...summary, legacyBindingId: memoryEngine.store.getLegacySummaryBindingId(filePath, index, summary) }
                  : summary);
                results.push(memorySystem.buildSummaryCatalogEntry({
                  folderName: characterFolderName,
                  conversationFile,
                  summaries: catalogSummaries,
                  filePath
                }));
              } catch (error) {
                console.error(`Failed to read summaries from ${filePath}:`, error);
              }
            }
            if (!results.some(metadata => metadata.folderName === characterFolderName)
              && fs$1.existsSync(path.join(characterFolderPath, "memory4"))) {
              const match = characterFolderName.match(/^(\d+)_(.+)$/);
              if (match) results.push({ ownerId: Number(match[1]), playerId: Number(match[1]), ownerName: match[2], playerName: match[2],
                folderName: characterFolderName, conversationFile: null, summaries: [], memory4Only: true });
            }
          } catch (error) {
            console.error(`Failed to process character folder ${characterFolderName}:`, error);
          }
        }
        
      } catch (error) {
        console.error("Failed to list summaries:", error);
      }
      return results;
    }
    /**
     * Helper method to find summary file paths in character folder structure
     * Returns an object with both character perspectives' file paths
     */
    static findSummaryFilePath(playerId, characterId, playerName = null, characterName = null) {
      const result = {
        playerPerspectivePath: null,
        characterPerspectivePath: null
      };
      
      // Try new format: character folders
      if (playerName && characterName) {
        // We have names, so we can construct the exact paths
        const sanitize = (name) => name.replace(/[<>:"/\\|?*]/g, '_').trim();
        
        const playerFolder = path.join(VOTC_SUMMARIES_DIR, sanitize(playerName));
        const playerFile = path.join(playerFolder, `与${sanitize(characterName)}的对话.json`);
        if (fs$1.existsSync(playerFile)) {
          result.playerPerspectivePath = playerFile;
        }
        
        const characterFolder = path.join(VOTC_SUMMARIES_DIR, sanitize(characterName));
        const characterFile = path.join(characterFolder, `与${sanitize(playerName)}的对话.json`);
        if (fs$1.existsSync(characterFile)) {
          result.characterPerspectivePath = characterFile;
        }
      } else {
        // Try to search by scanning folders
        try {
          if (fs$1.existsSync(VOTC_SUMMARIES_DIR)) {
            const entries = fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
            const folders = entries.filter(dirent => dirent.isDirectory());
            
            for (const folder of folders) {
              const folderPath = path.join(VOTC_SUMMARIES_DIR, folder.name);
              const files = fs$1.readdirSync(folderPath).filter(f => f.endsWith('.json'));
              
              for (const file of files) {
                const filePath = path.join(folderPath, file);
                try {
                  const content = fs$1.readFileSync(filePath, "utf8");
                  const summaries = JSON.parse(content);
                  
                  if (Array.isArray(summaries) && summaries.length > 0) {
                    const summary = summaries[0];
                    
                    // Check if this file is for the requested conversation
                    if ((summary.playerId == playerId && summary.characterId == characterId) ||
                        (summary.playerId == characterId && summary.characterId == playerId)) {
                      
                      // Determine which perspective this file represents
                      if (summary.playerId == playerId) {
                        result.playerPerspectivePath = filePath;
                        if (!playerName) playerName = summary.playerName;
                        if (!characterName) characterName = summary.characterName;
                      } else {
                        result.characterPerspectivePath = filePath;
                        if (!playerName) playerName = summary.characterName;
                        if (!characterName) characterName = summary.playerName;
                      }
                    }
                  }
                } catch (error) {
                  console.error(`Failed to read ${filePath}:`, error);
                }
              }
            }
          }
        } catch (error) {
          console.error('Failed to search character folders:', error);
        }
      }
      
      return result;
    }
    
    /**
     * Get summaries for a specific Memory Engine 2.2 character conversation.
     */
    static async getSummariesForCharacter(playerId, characterId) {
      // Try new format first: look for character folders
      // The playerId could be a character name (folder name) or an ID
      const characterFolderPath = path.join(VOTC_SUMMARIES_DIR, playerId);
      
      if (fs$1.existsSync(characterFolderPath) && fs$1.statSync(characterFolderPath).isDirectory()) {
        // New format: look for conversation files in the character folder
        try {
          const conversationFiles = fs$1.readdirSync(characterFolderPath).filter((file) => file.endsWith('.json'));
          
          // Try to find a file that matches the characterId
          for (const file of conversationFiles) {
            const filePath = path.join(characterFolderPath, file);
            try {
              const fileContent = fs$1.readFileSync(filePath, "utf8");
              const summaries = JSON.parse(fileContent);
              
              if (Array.isArray(summaries) && summaries.length > 0) {
                // Check if this file is for the requested character
                const firstSummary = summaries[0];
                if (firstSummary.characterId == characterId || firstSummary.characterName === characterId) {
                  return summaries;
                }
              }
            } catch (error) {
              console.error(`Failed to read ${filePath}:`, error);
            }
          }
        } catch (error) {
          console.error(`Failed to read character folder ${characterFolderPath}:`, error);
        }
      }
      
      return [];
    }
    /**
     * Update a specific summary's content
     * Updates only the selected owner-folder record.
     */
    static async updateSummary(playerId, characterId, summaryIndex, newContent) {
      const paths = this.findSummaryFilePath(playerId, characterId);
      const filePath = paths.playerPerspectivePath;
      if (!filePath) {
        return { success: false, error: "Summary file not found" };
      }
      try {
        const summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
        if (!Array.isArray(summaries) || summaryIndex < 0 || summaryIndex >= summaries.length) return { success: false, error: "Invalid summary index" };
        if (summaries[summaryIndex].sourceType === "CK3_OFFICIAL_RECOLLECTION" || summaries[summaryIndex].type === "official_recollection" || summaries[summaryIndex].subtype === "official_recollection") throw new Error("official_recollection_read_only");
        memoryEngine.updateSummaryProjection(summaries[summaryIndex], newContent, {
          ownerId: playerId, counterpartId: characterId, summaryPath: filePath,
          invalidateConversations: [getCurrentConversation()].filter(Boolean),
          persistSummary: updated => {
            summaries[summaryIndex] = updated;
            this.writeSummaryJsonAtomic(filePath, summaries);
          }
        });
        this.refreshCurrentConversation();
        return { success: true };
      } catch (error) {
        console.error(`Failed to update summary for character ${characterId} from player ${playerId}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    /**
     * Delete a specific summary
     * Deletes only the selected owner-folder record.
     */
    static async deleteSummary(playerId, characterId, summaryIndex) {
      const paths = this.findSummaryFilePath(playerId, characterId);
      const filePath = paths.playerPerspectivePath;
      if (!filePath) {
        return { success: false, error: "Summary file not found" };
      }
      try {
        const summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
        if (!Array.isArray(summaries) || summaryIndex < 0 || summaryIndex >= summaries.length) {
          return { success: false, error: "Invalid summary index" };
        }
        const summaryRecord = summaries[summaryIndex];
        if (summaryRecord.sourceType === "CK3_OFFICIAL_RECOLLECTION" || summaryRecord.type === "official_recollection" || summaryRecord.subtype === "official_recollection") throw new Error("official_recollection_read_only");
        memoryEngine.store.withSummaryMutation(filePath, () => {
          if (summaryRecord.sourceType !== "CK3_OFFICIAL_RECOLLECTION") memoryEngine.forgetSummaryProjection(summaryRecord, {
            ownerId: playerId,
            counterpartId: characterId,
            invalidateConversations: [getCurrentConversation()].filter(Boolean)
          });
          summaries.splice(summaryIndex, 1);
          if (summaries.length === 0) fs$1.unlinkSync(filePath);
          else this.writeSummaryJsonAtomic(filePath, summaries);
        });
        memoryEngine.invalidateSummaryFolderCache([playerId]);
        this.refreshCurrentConversation();
        return { success: true };
      } catch (error) {
        console.error(`Failed to delete summary for character ${characterId} from player ${playerId}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    /**
     * Delete all summaries for a character conversation
     * Deletes only the selected owner-folder record.
     */
    static async deleteCharacterSummaries(playerId, characterId) {
      const paths = this.findSummaryFilePath(playerId, characterId);
      const filePath = paths.playerPerspectivePath;
      if (!filePath || !fs$1.existsSync(filePath)) {
        return { success: false, error: "No summary files found" };
      }
      try {
        const summaries = JSON.parse(fs$1.readFileSync(filePath, "utf8"));
        if (Array.isArray(summaries) && summaries.some(summary => summary?.sourceType === "CK3_OFFICIAL_RECOLLECTION" || summary?.type === "official_recollection" || summary?.subtype === "official_recollection")) throw new Error("official_recollection_read_only");
        memoryEngine.store.withSummaryMutation(filePath, () => {
          if (summaries?.[0]?.sourceType !== "CK3_OFFICIAL_RECOLLECTION") memoryEngine.forgetOwnerConversation(playerId, characterId, Array.isArray(summaries) ? summaries : [], {
            invalidateConversations: [getCurrentConversation()].filter(Boolean)
          });
          fs$1.unlinkSync(filePath);
        });
        memoryEngine.invalidateSummaryFolderCache([playerId]);
        this.refreshCurrentConversation();
        return { success: true };
      } catch (error) {
        console.error(`Failed to delete owner summary file at ${filePath}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    /**
     * Get a character name from canonical owner-folder summaries.
     */
    static async getCharacterNameFromFile(playerId, characterId) {
      // Find the summary file(s)
      const paths = this.findSummaryFilePath(playerId, characterId);
      
      // Try new format files first
      const filesToCheck = [];
      if (paths.playerPerspectivePath) {
        filesToCheck.push(paths.playerPerspectivePath);
      }
      if (paths.characterPerspectivePath) {
        filesToCheck.push(paths.characterPerspectivePath);
      }
      for (const filePath of filesToCheck) {
        try {
          if (fs$1.existsSync(filePath)) {
            const fileContent = fs$1.readFileSync(filePath, "utf8");
            const summaries = JSON.parse(fileContent);
            if (Array.isArray(summaries) && summaries.length > 0 && summaries[0].characterName) {
              return summaries[0].characterName;
            }
          }
        } catch (error) {
          console.error(`Failed to get character name from ${filePath}:`, error);
        }
      }
      
      return `Character ID: ${characterId}`;
    }
    
  }
  
  return SummariesManager;
}

module.exports = { createSummariesManager };

"use strict";

const { validateGenerationOutcome } = require("../providers/generation-outcome");
const { getCharacterPersonalName } = require("../memory-system/character-identity");

function createSummariesManager({ fs, path, summariesDir, memoryEngine, memorySystem, getCurrentConversation = () => null,
  requestSummary, getSummaryCapabilities, getSummaryOutputLimit = () => 4096, buildSummaryPrompt, persistRecoveredSummary }) {
  const fs$1 = fs;
  const VOTC_SUMMARIES_DIR = summariesDir;
  let summaryRegenerationInFlight = false;
  let summaryRetryInFlight = null;
  class SummariesManager {
    static getRecoveryStatus() {
      const conversation = getCurrentConversation();
      const currentId = conversation?.id;
      const readConversation = getCurrentConversation();
      const activeCampaignToken = typeof readConversation?.gameData?.campaignToken === "string"
        ? readConversation.gameData.campaignToken.trim() || null : null;
      let pending = 0, manual = 0, balanceBlocked = 0;
      for (const file of memoryEngine.listRecoverySnapshots()) {
        const snapshot = memoryEngine.store.readJson(file, null);
        if (!snapshot || snapshot.conversationId === currentId || memoryEngine.activeFinalizationIds.has(snapshot.finalizationId)) continue;
        if (memoryEngine.isCommitted(snapshot)) continue;
        pending++;
        if (snapshot.finalizationStatus === "failed_manual") manual++;
        if (/402|insufficient balance/i.test(snapshot.lastError || "")) balanceBlocked++;
      }
      let letters = { pending: 0, manual: 0, balanceBlocked: 0 };
      try {
        letters = memoryEngine.letterSummaryFinalization?.getRecoveryStatus(activeCampaignToken) || letters;
      } catch (error) {
        letters = { ...letters, invalid: 1, error: String(error?.message || error) };
      }
      return { pending: pending + Number(letters.pending || 0), manual: manual + Number(letters.manual || 0),
        balanceBlocked: balanceBlocked + Number(letters.balanceBlocked || 0), narrativePending: pending,
        letterPending: Number(letters.pending || 0), letterManual: Number(letters.manual || 0), letterInvalid: Number(letters.invalid || 0),
        running: !!memoryEngine.pendingRecovery || memoryEngine.activeFinalizationIds.size > 0 };
    }

    static async retryFailedSummaries() {
      if (summaryRetryInFlight) return summaryRetryInFlight;
      const readConversation = getCurrentConversation();
      const activeCampaignToken = typeof readConversation?.gameData?.campaignToken === "string"
        ? readConversation.gameData.campaignToken.trim() || null : null;
      summaryRetryInFlight = (async () => {
        const results = await memoryEngine.recoverPendingFinalizations({
          manual: true,
          activeCampaignToken,
          isConversationActive: id => getCurrentConversation()?.id === id,
          buildPrompt: buildSummaryPrompt,
          requestSummary,
          getSummaryCapabilities,
          resolveParticipantProfiles: snapshot => memoryEngine.resolveRecoveryParticipantProfiles(snapshot),
          persistCharacterFolders: persistRecoveredSummary
        });
        let letterResults = [];
        const letterFinalization = memoryEngine.letterSummaryFinalization;
        if (typeof letterFinalization?.retryPending === "function") {
          try {
            const retried = await letterFinalization.retryPending({ activeCampaignToken, manual: true });
            letterResults = Array.isArray(retried) ? retried : Array.isArray(retried?.jobs) ? retried.jobs : retried ? [retried] : [];
          } catch (error) {
            letterResults = [{ status: "FAILED", error: String(error?.message || error) }];
          }
        }
        this.refreshCurrentConversation();
        const succeeded = result => result?.success === true
          || ["COMPLETE", "ALREADY_COMMITTED"].includes(result?.status);
        const letterRecovered = letterResults.filter(result => succeeded(result) && !result.alreadyCommitted).length;
        const letterFailed = letterResults.filter(result => !succeeded(result)).length;
        return {
          success: results.every(result => result.success) && letterFailed === 0,
          recovered: results.filter(result => result.success && !result.alreadyCommitted).length + letterRecovered,
          failed: results.filter(result => !result.success).length + letterFailed,
          letterResults,
          recoveryStatus: this.getRecoveryStatus()
        };
      })();
      try { return await summaryRetryInFlight; }
      finally { summaryRetryInFlight = null; }
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
        const outcome = validateGenerationOutcome(generated);
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
        return { success: true, summaryUpdated: true, content: regeneratedContent };
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

    static consolidateRenamedFolders(ownerIds = null, continueOnError = false) {
      const store = memoryEngine?.store;
      if (typeof store?.mergeRenamedSummaryFolders !== "function" || !fs$1.existsSync(VOTC_SUMMARIES_DIR)) return;
      const owners = ownerIds || [...new Set(fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^\d+_/.test(entry.name))
        .map(entry => Number(entry.name.split("_")[0])))];
      const gameData = getCurrentConversation()?.gameData;
      for (const ownerId of owners) {
        if (!Number.isSafeInteger(Number(ownerId)) || Number(ownerId) <= 0) continue;
        const character = gameData?.characters?.get(Number(ownerId));
        const resolvedName = character ? getCharacterPersonalName(character, character.shortName) : null;
        const name = resolvedName === "unknown" ? null : resolvedName;
        try { store.mergeRenamedSummaryFolders(Number(ownerId), name); }
        catch (error) {
          if (!continueOnError) throw error;
          console.warn(`[Summary] 改名目录合并被阻止 (${Number(ownerId)}): ${error.message}`);
        }
      }
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
        this.consolidateRenamedFolders(null, true);
        
        // Read all entries in the summaries directory
        const entries = fs$1.readdirSync(VOTC_SUMMARIES_DIR, { withFileTypes: true });
        
        // Process character folders (new format)
        const characterFolders = entries.filter((dirent) => dirent.isDirectory() && !dirent.isSymbolicLink() && /^\d+_/.test(dirent.name));
        
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
      this.consolidateRenamedFolders([Number(playerId), Number(characterId)]);
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
      const ownerId = Number(String(playerId).match(/^(\d+)_/)?.[1]);
      const merged = Number.isSafeInteger(ownerId) && ownerId > 0
        && typeof memoryEngine?.store?.mergeRenamedSummaryFolders === "function"
        ? memoryEngine.store.mergeRenamedSummaryFolders(ownerId) : null;
      const characterFolderPath = merged?.folderPath || path.join(VOTC_SUMMARIES_DIR, playerId);
      
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
        let forgotten;
        memoryEngine.store.withSummaryMutation(filePath, () => {
          if (summaryRecord.sourceType !== "CK3_OFFICIAL_RECOLLECTION") forgotten = memoryEngine.forgetSummaryProjection(summaryRecord, {
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
        const diagnostics = { ...forgotten, visibleDeleted: 1 };
        memoryEngine.trace.record("summary_delete_committed", diagnostics);
        return { success: true, diagnostics };
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
        let forgotten;
        memoryEngine.store.withSummaryMutation(filePath, () => {
          if (summaries?.[0]?.sourceType !== "CK3_OFFICIAL_RECOLLECTION") forgotten = memoryEngine.forgetOwnerConversation(playerId, characterId, Array.isArray(summaries) ? summaries : [], {
            invalidateConversations: [getCurrentConversation()].filter(Boolean)
          });
          fs$1.unlinkSync(filePath);
        });
        memoryEngine.invalidateSummaryFolderCache([playerId]);
        this.refreshCurrentConversation();
        const diagnostics = { ...forgotten, visibleDeleted: Array.isArray(summaries) ? summaries.length : 0 };
        memoryEngine.trace.record("summary_delete_committed", diagnostics);
        return { success: true, diagnostics };
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

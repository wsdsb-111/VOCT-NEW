"use strict";

function createLetterManager({ settingsRepository, fs, path, TailFile, readline, parseLog, letterPromptBuilder, llmManager, PromptBuilder, TokenCounter, memoryEngine, dataDir }) {
  const fs$1 = fs;
  const readline$1 = readline;
  var LetterResponseStatus = /* @__PURE__ */ ((LetterResponseStatus2) => {
    LetterResponseStatus2["GENERATING"] = "generating";
    LetterResponseStatus2["GENERATED"] = "generated";
    LetterResponseStatus2["GENERATION_FAILED"] = "generation_failed";
    LetterResponseStatus2["PENDING_DELIVERY"] = "pending_delivery";
    LetterResponseStatus2["SENT"] = "sent";
    LetterResponseStatus2["SEND_FAILED"] = "send_failed";
    return LetterResponseStatus2;
  })(LetterResponseStatus || {});
  var LetterSummaryStatus = /* @__PURE__ */ ((LetterSummaryStatus2) => {
    LetterSummaryStatus2["NOT_STARTED"] = "not_started";
    LetterSummaryStatus2["GENERATING"] = "generating";
    LetterSummaryStatus2["GENERATED"] = "generated";
    LetterSummaryStatus2["GENERATION_FAILED"] = "generation_failed";
    LetterSummaryStatus2["SAVED"] = "saved";
    LetterSummaryStatus2["SAVE_FAILED"] = "save_failed";
    return LetterSummaryStatus2;
  })(LetterSummaryStatus || {});
  class LetterManager {
    // 5 minutes
    constructor() {
      this.currentTotalDays = 0;
      this.storedLetters = /* @__PURE__ */ new Map();
      this.letterStatuses = /* @__PURE__ */ new Map();
      this.deliveryInProgress = /* @__PURE__ */ new Set();
      this.tailFile = null;
      this.readline = null;
      this.pendingLettersFile = dataDir ? path.join(dataDir, "pending-letters.json") : null;
      this.loadPendingLetters();
      const ck3UserPath = settingsRepository.getCK3UserFolderPath();
      if (ck3UserPath) {
        this.startLogTailing();
      } else {
        console.log("LetterManager: CK3 user path not configured yet, will start tailing when path is set");
      }
    }
    /**
     * Start tailing the debug.log file to track VOTC:DATE updates
     */
    async startLogTailing() {
      const ck3UserPath = settingsRepository.getCK3UserFolderPath();
      console.log(`LetterManager: CK3 user path from settings: ${ck3UserPath}`);
      const debugLogPath = settingsRepository.getCK3DebugLogPath();
      console.log(`LetterManager: Resolved debug log path: ${debugLogPath}`);
      if (!debugLogPath) {
        console.warn("LetterManager: CK3 debug log path is not configured; cannot start log tailing.");
        return;
      }
      if (!fs$1.existsSync(debugLogPath)) {
        console.warn(`LetterManager: Debug log file does not exist: ${debugLogPath}`);
        return;
      }
      try {
        this.tailFile = new TailFile(debugLogPath, { encoding: "utf8" }).on("tail_error", (err) => {
          console.error("Tail error:", err);
        });
        await this.tailFile.start();
        console.log(`Started tailing debug log: ${debugLogPath}`);
        this.readline = readline$1.createInterface({ input: this.tailFile });
        this.readline.on("line", (line) => {
          this.processLogLine(line);
        });
      } catch (error) {
        console.error("Failed to start log tailing:", error);
      }
    }
    /**
     * Process a single log line looking for VOTC:DATE
     */
    processLogLine(line) {
      const dateRegex = /VOTC:DATE\/;\/(\d+)/;
      const match = line.match(dateRegex);
      if (match) {
        const newTotalDays = Number(match[1]);
        return this.updateCurrentDate(newTotalDays);
      }
      return Promise.resolve();
    }
    /**
     * Update current date and handle time travel detection
     */
    updateCurrentDate(newTotalDays) {
      const oldTotalDays = this.currentTotalDays;
      if (oldTotalDays > 0 && newTotalDays < oldTotalDays) {
        console.log(`Time travel detected (backwards). Removing letters sent after new date. | Old date: ${oldTotalDays} | New date: ${newTotalDays}`);
        this.removeLettersAfterDate(newTotalDays);
      } else if (oldTotalDays > 0 && newTotalDays - oldTotalDays > 40) {
        console.log("Large time jump detected (>40 days). Removing letters sent after old date.");
        this.removeLettersAfterDate(oldTotalDays);
      }
      this.currentTotalDays = newTotalDays;
      return this.checkAndDeliverLetters();
    }
    /**
     * Remove letters that were generated after a certain date (time travel cleanup)
     */
    removeLettersAfterDate(cutoffDate) {
      const lettersToRemove = [];
      for (const [letterId, storedLetter] of this.storedLetters.entries()) {
        if (storedLetter.letter.totalDays > cutoffDate) {
          lettersToRemove.push(letterId);
        }
      }
      for (const letterId of lettersToRemove) {
        console.log(`Removing letter ${letterId} due to time travel`);
        this.storedLetters.delete(letterId);
      }
      if (lettersToRemove.length > 0) {
        this.savePendingLetters();
      }
    }
    /**
     * Check stored letters and deliver any that are ready
     */
    async checkAndDeliverLetters() {
      for (const [letterId, storedLetter] of this.storedLetters.entries()) {
        if (this.currentTotalDays >= storedLetter.expectedDeliveryDay && !this.deliveryInProgress.has(letterId)) {
          console.log(`Delivering letter ${letterId} (current: ${this.currentTotalDays}, expected: ${storedLetter.expectedDeliveryDay})`);
          this.deliveryInProgress.add(letterId);
          try {
            const delivered = await this.deliverLetter(storedLetter);
            if (delivered) {
              this.storedLetters.delete(letterId);
              this.savePendingLetters();
            }
          } finally {
            this.deliveryInProgress.delete(letterId);
          }
        }
      }
    }
    /**
     * Deliver a letter by writing the effect file and updating localization
     */
    async deliverLetter(storedLetter) {
      return this.writeLetterEffect(storedLetter.reply, storedLetter.letter);
    }
    /**
     * Process a new letter: generate response immediately but store it for delayed delivery
     */
    async processLatestLetter() {
      const ck3UserPath = settingsRepository.getCK3UserFolderPath();
      if (ck3UserPath) {
        const runFolder = path.join(ck3UserPath, "run");
        const letterFilePath = path.join(runFolder, "letters.txt");
        console.log(`LetterManager: Resolved letters.txt path: ${letterFilePath}`);
        fs$1.writeFileSync(letterFilePath, `debug_log = "[Localize('talk_event.9999.desc')]"`, "utf-8");
        console.log("Created letters.txt file");
      }
      const context = await this.loadLatestGameDataWithLetter();
      if (!context) return null;
      const { gameData, letter } = context;
      const letterTotalDays = Number(letter.totalDays);
      if (Number.isFinite(letterTotalDays)) {
        this.currentTotalDays = Math.max(this.currentTotalDays, letterTotalDays);
      }
      const characterName = gameData.getAi()?.fullName || "Unknown";
      this.createLetterStatus(letter, characterName);
      this.updateLetterStatus(letter.letterId, { responseStatus: LetterResponseStatus.GENERATING });
      const messages = letterPromptBuilder.buildMessages(gameData, letter);
      let reply = null;
      let responseError = null;
      try {
        const result = await llmManager.sendChatRequest(messages, void 0, true, { requestType: "letter", character: characterName });
        reply = await this.extractReply(result);
        if (!reply) {
          throw new Error("Letter reply generation returned empty content.");
        }
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.GENERATED,
          responseContent: reply,
          responseError: null
        });
      } catch (error) {
        responseError = error instanceof Error ? error.message : "Unknown error";
        console.error("Letter reply generation failed:", error);
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.GENERATION_FAILED,
          responseError
        });
        return null;
      }
      await this.generateSummary(gameData, letter, reply);
      const expectedDeliveryDay = letter.totalDays + letter.delay;
      const storedLetter = {
        letter,
        reply,
        expectedDeliveryDay,
        characterName
      };
      this.storedLetters.set(letter.letterId, storedLetter);
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.PENDING_DELIVERY,
        expectedDeliveryDay,
        daysUntilDelivery: expectedDeliveryDay - this.currentTotalDays,
        isLate: this.currentTotalDays > expectedDeliveryDay
      });
      this.savePendingLetters();
      console.log(`Letter ${letter.letterId} generated and stored. Will deliver on day ${expectedDeliveryDay} (current: ${this.currentTotalDays})`);
      if (this.currentTotalDays >= expectedDeliveryDay) {
        console.log(`Letter ${letter.letterId} is ready for immediate delivery`);
        const delivered = await this.deliverLetter(storedLetter);
        if (delivered) {
          this.storedLetters.delete(letter.letterId);
          this.savePendingLetters();
        }
      }
      return reply;
    }
    async buildPromptPreview() {
      const context = await this.loadLatestGameDataWithLetter();
      if (!context) return null;
      const { gameData, letter } = context;
      return letterPromptBuilder.buildPreview(gameData, letter);
    }
    async loadLatestGameDataWithLetter() {
      const debugLogPath = settingsRepository.getCK3DebugLogPath();
      if (!debugLogPath) {
        console.warn("CK3 debug log path is not configured; cannot process letter.");
        return null;
      }
      const gameData = await parseLog(debugLogPath);
      gameData.loadCharactersSummaries();
      const letter = gameData.letterData;
      if (!letter) {
        console.warn("No letter data found in parsed game data.");
        return null;
      }
      return { gameData, letter };
    }
    async extractReply(result) {
      if (result && typeof result === "object" && "content" in result) {
        const content = result.content;
        return typeof content === "string" ? content.trim() : null;
      }
      if (result && typeof result[Symbol.asyncIterator] === "function") {
        let text = "";
        for await (const chunk of result) {
          if (chunk?.delta?.content) {
            text += chunk.delta.content;
          }
        }
        return text.trim() || null;
      }
      return null;
    }
    async generateSummary(gameData, letter, reply) {
      const ai = gameData.getAi();
      if (!ai) return;
      this.updateLetterStatus(letter.letterId, {
        summaryStatus: LetterSummaryStatus.GENERATING
      });
      const summarySettings = settingsRepository.getSummaryPromptSettings();
      const summaryPrompt = [
        {
          role: "system",
          content: `Stable letter-summary instructions:\n${summarySettings.letterSummaryPrompt}`
        },
        {
          role: "system",
          content: `${gameData.playerName} letter to ${ai.fullName}:
  "${letter.content}"
  
  Reply from ${ai.fullName}:
  "${reply}"`
        },
        {
          role: "user",
          content: "Generate the concise letter summary now."
        }
      ];
      try {
        console.log(`[TOKEN_COUNT] Letter summary prompt tokens: ${TokenCounter.estimateMessageTokens(summaryPrompt[0])}`);
        console.log(`[TOKEN_COUNT] Letter summary letters letters content tokens: ${TokenCounter.estimateMessageTokens(summaryPrompt[1])}`);
        const summaryResult = await llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "letter_summary", character: ai.shortName });
        if (summaryResult && typeof summaryResult === "object" && "content" in summaryResult) {
          const summary = summaryResult.content;
          if (summary?.trim()) {
            this.updateLetterStatus(letter.letterId, {
              summaryStatus: LetterSummaryStatus.GENERATED,
              summaryContent: summary.trim(),
              summaryError: null
            });
            gameData.saveCharacterSummary(ai.id, {
              date: gameData.date,
              totalDays: gameData.totalDays,
              content: summary.trim()
            });
            memoryEngine.recordLetterMemory({
              senderId: gameData.playerID,
              recipientId: ai.id,
              content: summary.trim(),
              date: gameData.date,
              totalDays: gameData.totalDays,
              letterId: letter.letterId
            });
            this.updateLetterStatus(letter.letterId, {
              summaryStatus: LetterSummaryStatus.SAVED
            });
          }
        }
      } catch (error) {
        const summaryError = error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to generate letter summary:", error);
        this.updateLetterStatus(letter.letterId, {
          summaryStatus: LetterSummaryStatus.GENERATION_FAILED,
          summaryError
        });
      }
    }
    async writeLetterEffect(reply, letter) {
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      console.log(`LetterManager.writeLetterEffect: CK3 user path: ${ck3Folder}`);
      if (!ck3Folder) {
        console.warn("LetterManager.writeLetterEffect: CK3 user folder is not configured; skipping writing letter effect.");
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.SEND_FAILED,
          responseError: "CK3 user folder not configured"
        });
        return false;
      }
      const runFolder = path.join(ck3Folder, "run");
      console.log(`LetterManager.writeLetterEffect: Run folder path: ${runFolder}`);
      try {
        fs$1.mkdirSync(runFolder, { recursive: true });
        console.log(`LetterManager.writeLetterEffect: Run folder created/verified`);
      } catch (error) {
        const errorMessage = `Failed to create run folder: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(`LetterManager.writeLetterEffect: ${errorMessage}`);
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.SEND_FAILED,
          responseError: errorMessage
        });
        return false;
      }
      const letterFilePath = path.join(runFolder, `letters.txt`);
      console.log(`LetterManager.writeLetterEffect: Letter file path: ${letterFilePath}`);
      const escapedReply = reply.replace(/"/g, '\\"');
      const gameCommand = `debug_log = "[Localize('talk_event.9999.desc')]"
  remove_global_variable ?= votc_${letter.letterId}
  create_artifact = {
  	name = votc_huixin_title${letter.letterId.replace(/letter_/, "")}
  	description = "${escapedReply}"
  	type = journal
  	visuals = scroll
  	creator = global_var:message_second_scope_${letter.letterId}
  	modifier = artifact_monthly_minor_prestige_1_modifier
  	wealth = scope:wealth
  	save_scope_as = votc_latest_letter
  }
  scope:votc_latest_letter = {
  set_variable = { name = votc_letter_artifact value = yes}
  }
  set_global_variable = {
  	name = votc_latest_letter
  	value = scope:votc_latest_letter
  }
  trigger_event = message_event.362`;
      try {
        fs$1.writeFileSync(letterFilePath, gameCommand, "utf-8");
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.SENT,
          responseError: null
        });
        return true;
      } catch (error) {
        const errorMessage = `Failed to write letter effect: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(`LetterManager.writeLetterEffect: ${errorMessage}`);
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.SEND_FAILED,
          responseError: errorMessage
        });
        return false;
      }
    }
    loadPendingLetters() {
      if (!this.pendingLettersFile || !fs$1.existsSync(this.pendingLettersFile)) return;
      try {
        const state = JSON.parse(fs$1.readFileSync(this.pendingLettersFile, "utf8"));
        for (const storedLetter of Array.isArray(state?.letters) ? state.letters : []) {
          const letterId = storedLetter?.letter?.letterId;
          if (!letterId || typeof storedLetter.reply !== "string" || !Number.isFinite(storedLetter.expectedDeliveryDay)) continue;
          this.storedLetters.set(letterId, storedLetter);
          if (storedLetter.status) {
            this.letterStatuses.set(letterId, storedLetter.status);
          } else {
            this.createLetterStatus(storedLetter.letter, storedLetter.characterName || "Unknown");
            this.updateLetterStatus(letterId, {
              responseContent: storedLetter.reply,
              responseStatus: LetterResponseStatus.PENDING_DELIVERY,
              summaryStatus: LetterSummaryStatus.SAVED,
              expectedDeliveryDay: storedLetter.expectedDeliveryDay
            });
          }
        }
        if (this.storedLetters.size > 0) {
          console.log(`LetterManager: Restored ${this.storedLetters.size} pending letter(s)`);
        }
      } catch (error) {
        console.error("LetterManager: Failed to load pending letters:", error);
      }
    }
    savePendingLetters() {
      if (!this.pendingLettersFile) return;
      try {
        fs$1.mkdirSync(path.dirname(this.pendingLettersFile), { recursive: true });
        const letters = Array.from(this.storedLetters.entries()).map(([letterId, storedLetter]) => ({
          ...storedLetter,
          status: this.letterStatuses.get(letterId) || null
        }));
        fs$1.writeFileSync(this.pendingLettersFile, JSON.stringify({ version: 1, letters }, null, 2), "utf8");
      } catch (error) {
        console.error("LetterManager: Failed to save pending letters:", error);
      }
    }
    /**
     * Clear the letters.txt file
     */
    clearLettersFile() {
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      console.log(`LetterManager.clearLettersFile: CK3 user path: ${ck3Folder}`);
      if (!ck3Folder) {
        console.warn("LetterManager.clearLettersFile: CK3 user folder is not configured; cannot clear letters file.");
        return;
      }
      const runFolder = path.join(ck3Folder, "run");
      const letterFilePath = path.join(runFolder, "letters.txt");
      console.log(`LetterManager.clearLettersFile: Letter file path: ${letterFilePath}`);
      if (fs$1.existsSync(letterFilePath)) {
        fs$1.writeFileSync(letterFilePath, `debug_log = "[Localize('talk_event.9999.desc')]"`, "utf-8");
        console.log("Cleared letters.txt file");
      } else {
        console.log("letters.txt file does not exist, nothing to clear");
      }
    }
    /**
     * Stop log tailing (cleanup)
     */
    async stopLogTailing() {
      if (this.readline) {
        this.readline.close();
        this.readline = null;
      }
      if (this.tailFile) {
        await this.tailFile.quit();
        this.tailFile = null;
        console.log("Stopped log tailing");
      }
    }
    /**
     * Restart log tailing (useful when CK3 path is updated)
     */
    async restartLogTailing() {
      console.log("Restarting log tailing...");
      await this.stopLogTailing();
      this.currentTotalDays = 0;
      await this.startLogTailing();
    }
    /**
     * Get current tracked date
     */
    getCurrentTotalDays() {
      return this.currentTotalDays;
    }
    /**
     * Create initial letter status entry
     */
    createLetterStatus(letter, characterName) {
      const statusInfo = {
        letterId: letter.letterId,
        letterContent: letter.content,
        responseContent: null,
        responseStatus: LetterResponseStatus.GENERATING,
        responseError: null,
        summaryStatus: LetterSummaryStatus.NOT_STARTED,
        summaryContent: null,
        summaryError: null,
        createdAt: Date.now(),
        expectedDeliveryDay: letter.totalDays + letter.delay,
        currentDay: this.currentTotalDays,
        daysUntilDelivery: letter.totalDays + letter.delay - this.currentTotalDays,
        isLate: this.currentTotalDays > letter.totalDays + letter.delay,
        characterName
      };
      this.letterStatuses.set(letter.letterId, statusInfo);
    }
    /**
     * Update letter status information
     */
    updateLetterStatus(letterId, updates) {
      const existing = this.letterStatuses.get(letterId);
      if (existing) {
        const updated = { ...existing, ...updates };
        this.letterStatuses.set(letterId, updated);
      }
    }
    /**
     * Get letter status by ID
     */
    getLetterStatus(letterId) {
      return this.letterStatuses.get(letterId) || null;
    }
    /**
     * Get all letter statuses
     */
    getAllLetterStatuses() {
      for (const status of this.letterStatuses.values()) {
        status.currentDay = this.currentTotalDays;
        status.daysUntilDelivery = status.expectedDeliveryDay - this.currentTotalDays;
        status.isLate = this.currentTotalDays > status.expectedDeliveryDay;
      }
      return {
        letters: Array.from(this.letterStatuses.values()),
        currentTotalDays: this.currentTotalDays,
        timestamp: Date.now()
      };
    }
    /**
     * Clear old completed statuses to manage memory
     */
    clearOldStatuses(daysThreshold = 30) {
      const cutoffTime = Date.now() - daysThreshold * 24 * 60 * 60 * 1e3;
      const statusesToRemove = [];
      for (const [letterId, status] of this.letterStatuses.entries()) {
        if (status.responseStatus === LetterResponseStatus.SENT && status.summaryStatus === LetterSummaryStatus.SAVED && status.createdAt < cutoffTime) {
          statusesToRemove.push(letterId);
        }
      }
      for (const letterId of statusesToRemove) {
        this.letterStatuses.delete(letterId);
        console.log(`Cleared old letter status: ${letterId}`);
      }
      if (statusesToRemove.length > 0) {
        console.log(`Cleared ${statusesToRemove.length} old letter statuses`);
      }
    }
  }
  
  return { LetterManager, LetterResponseStatus, LetterSummaryStatus };
}

module.exports = { createLetterManager };

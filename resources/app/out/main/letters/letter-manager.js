"use strict";

function createLetterManager({ settingsRepository, fs, path, TailFile, readline, parseLog, letterPromptBuilder, llmManager, PromptBuilder, TokenCounter, memoryEngine, dataDir, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), letterPayloadRetryDelays = [100, 200, 350, 600, 1e3], dateHeartbeatIntervalMs = 5e3, dateStaleMs = 2e4, dateScanBytes = 1024 * 1024, diagnosticExecutionTimeoutMs = 15e3, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const fs$1 = fs;
  const readline$1 = readline;
  var LetterResponseStatus = /* @__PURE__ */ ((LetterResponseStatus2) => {
    LetterResponseStatus2["GENERATING"] = "generating";
    LetterResponseStatus2["GENERATED"] = "generated";
    LetterResponseStatus2["GENERATION_FAILED"] = "generation_failed";
    LetterResponseStatus2["PENDING_DELIVERY"] = "pending_delivery";
    LetterResponseStatus2["EFFECT_FILE_WRITTEN"] = "effect_file_written";
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
  var LetterPipelineState = /* @__PURE__ */ ((LetterPipelineState2) => {
    LetterPipelineState2["TRIGGER_RECEIVED"] = "TRIGGER_RECEIVED";
    LetterPipelineState2["CONTEXT_WAITING"] = "CONTEXT_WAITING";
    LetterPipelineState2["CONTEXT_READY"] = "CONTEXT_READY";
    LetterPipelineState2["PROMPT_BUILDING"] = "PROMPT_BUILDING";
    LetterPipelineState2["PROMPT_READY"] = "PROMPT_READY";
    LetterPipelineState2["REPLY_REQUESTED"] = "REPLY_REQUESTED";
    LetterPipelineState2["REPLY_RECEIVED"] = "REPLY_RECEIVED";
    LetterPipelineState2["SUMMARY_REQUESTED"] = "SUMMARY_REQUESTED";
    LetterPipelineState2["SUMMARY_SAVED"] = "SUMMARY_SAVED";
    LetterPipelineState2["PENDING_DELIVERY"] = "PENDING_DELIVERY";
    LetterPipelineState2["DELIVERY_DUE"] = "DELIVERY_DUE";
    LetterPipelineState2["EFFECT_FILE_WRITTEN"] = "EFFECT_FILE_WRITTEN";
    LetterPipelineState2["DELIVERED"] = "DELIVERED";
    LetterPipelineState2["CONTEXT_TIMEOUT"] = "CONTEXT_TIMEOUT";
    LetterPipelineState2["PROMPT_BUILD_FAILED"] = "PROMPT_BUILD_FAILED";
    LetterPipelineState2["REPLY_FAILED"] = "REPLY_FAILED";
    LetterPipelineState2["SUMMARY_FAILED"] = "SUMMARY_FAILED";
    LetterPipelineState2["DELIVERY_FAILED"] = "DELIVERY_FAILED";
    return LetterPipelineState2;
  })(LetterPipelineState || {});
  class LetterManager {
    // 5 minutes
    constructor() {
      this.currentTotalDays = 0;
      this.storedLetters = /* @__PURE__ */ new Map();
      this.failedLetterContexts = /* @__PURE__ */ new Map();
      this.replyRetryInProgress = /* @__PURE__ */ new Set();
      this.letterStatuses = /* @__PURE__ */ new Map();
      this.deliveryInProgress = /* @__PURE__ */ new Set();
      this.awaitingAcceptanceLetterId = null;
      this.tailFile = null;
      this.readline = null;
      this.tailRestartTimer = null;
      this.dateHeartbeatTimer = null;
      this.dateHeartbeatRunning = false;
      this.tailState = "STOPPED";
      this.tailStartedAt = null;
      this.lastLogLineReceivedAt = null;
      this.lastDateLogReceivedAt = null;
      this.lastDateValue = null;
      this.debugLogPath = null;
      this.debugLogExists = false;
      this.debugLogSize = null;
      this.debugLogMtime = null;
      this.debugLogIdentity = null;
      this.dateSourceState = "STALE";
      this.lastDateReconciliationAt = null;
      this.lastDateScanResult = null;
      this.latestPipelineStatus = null;
      this.pipelineSequence = 0;
      this.lastPayloadDiagnostics = null;
      this.lastEffectDiagnostic = null;
      this.effectDiagnosticStages = { A: null, B: null, C: null, D: null };
      this.activeEffectDiagnostic = null;
      this.pendingLettersFile = dataDir ? path.join(dataDir, "pending-letters.json") : null;
      this.loadPendingLetters();
      this.syncDateTrackerSupervisor();
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
      this.debugLogPath = debugLogPath || null;
      console.log(`LetterManager: Resolved debug log path: ${debugLogPath}`);
      if (!debugLogPath) {
        this.tailState = "ERROR";
        this.dateSourceState = "ERROR";
        console.warn("LetterManager: CK3 debug log path is not configured; cannot start log tailing.");
        return;
      }
      if (!fs$1.existsSync(debugLogPath)) {
        this.tailState = "STOPPED";
        this.debugLogExists = false;
        this.dateSourceState = "LOG_FILE_MISSING";
        console.warn(`LetterManager: Debug log file does not exist: ${debugLogPath}`);
        this.scheduleLogTailingRestart();
        return;
      }
      try {
        this.captureDebugLogMetadata(debugLogPath);
        this.tailState = "STARTING";
        this.tailFile = new TailFile(debugLogPath, { encoding: "utf8" }).on("tail_error", (err) => {
          console.error("Tail error:", err);
          this.tailState = "ERROR";
          this.dateSourceState = "TAIL_RESTARTING";
          this.scheduleLogTailingRestart();
        });
        await this.tailFile.start();
        this.tailState = "ACTIVE";
        this.tailStartedAt = Date.now();
        console.log(`Started tailing debug log: ${debugLogPath}`);
        this.readline = readline$1.createInterface({ input: this.tailFile });
        this.readline.on("line", (line) => {
          this.processLogLine(line);
        });
      } catch (error) {
        this.tailState = "ERROR";
        this.dateSourceState = "ERROR";
        console.error("Failed to start log tailing:", error);
        this.scheduleLogTailingRestart();
      }
    }
    scheduleLogTailingRestart() {
      if (this.tailRestartTimer) return;
      this.tailRestartTimer = setTimeout(() => {
        this.tailRestartTimer = null;
        this.restartLogTailing().catch((error) => console.error("LetterManager: Failed to recover log tailing:", error));
      }, 1e3);
      this.tailRestartTimer.unref?.();
    }
    /**
     * Process a single log line looking for VOTC:DATE
     */
    processLogLine(line) {
      this.lastLogLineReceivedAt = Date.now();
      const diagnosticMatch = line.match(/VOTC:LETTER_DIAG\/([A-D])\/([A-Za-z0-9_-]+)/);
      if (diagnosticMatch) this.confirmDiagnosticExecutionMarker(diagnosticMatch[1], diagnosticMatch[2]);
      const dateRegex = /VOTC:DATE\/;\/(\d+)/;
      const match = line.match(dateRegex);
      if (match) {
        const newTotalDays = Number(match[1]);
        this.lastDateLogReceivedAt = Date.now();
        this.lastDateValue = newTotalDays;
        this.dateSourceState = "HEALTHY";
        console.log(`LetterManager: VOTC:DATE received (${newTotalDays})`);
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
        console.log(`Forward date catch-up detected (+${newTotalDays - oldTotalDays} days). Preserving pending letters.`);
      }
      this.currentTotalDays = newTotalDays;
      this.lastDateValue = newTotalDays;
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
      this.syncDateTrackerSupervisor();
    }
    captureDebugLogMetadata(debugLogPath = settingsRepository.getCK3DebugLogPath()) {
      this.debugLogPath = debugLogPath || null;
      if (!debugLogPath || !fs$1.existsSync(debugLogPath)) {
        this.debugLogExists = false;
        this.debugLogSize = null;
        this.debugLogMtime = null;
        this.debugLogIdentity = null;
        return null;
      }
      const stat = fs$1.statSync(debugLogPath);
      const metadata = {
        exists: true,
        size: Number(stat.size) || 0,
        mtimeMs: Number(stat.mtimeMs) || 0,
        identity: `${Number(stat.birthtimeMs) || 0}:${Number(stat.ino) || 0}`
      };
      this.debugLogExists = true;
      this.debugLogSize = metadata.size;
      this.debugLogMtime = metadata.mtimeMs;
      this.debugLogIdentity = metadata.identity;
      return metadata;
    }
    syncDateTrackerSupervisor() {
      if (this.storedLetters.size > 0 && !this.dateHeartbeatTimer) {
        this.dateHeartbeatTimer = setIntervalFn(() => {
          this.runDateTrackerHeartbeat().catch((error) => {
            this.dateSourceState = "ERROR";
            console.error("Letter Date Tracker heartbeat failed:", error);
          });
        }, dateHeartbeatIntervalMs);
        this.dateHeartbeatTimer?.unref?.();
      } else if (this.storedLetters.size === 0 && this.dateHeartbeatTimer) {
        clearIntervalFn(this.dateHeartbeatTimer);
        this.dateHeartbeatTimer = null;
      }
    }
    async runDateTrackerHeartbeat({ forceReconcile = false } = {}) {
      if (this.dateHeartbeatRunning) return this.getDateTrackerStatus();
      this.dateHeartbeatRunning = true;
      try {
        const debugLogPath = settingsRepository.getCK3DebugLogPath();
        const previousSize = this.debugLogSize;
        const previousIdentity = this.debugLogIdentity;
        const metadata = this.captureDebugLogMetadata(debugLogPath);
        if (!metadata) {
          this.dateSourceState = "LOG_FILE_MISSING";
          this.scheduleLogTailingRestart();
          return this.getDateTrackerStatus();
        }
        const replaced = previousIdentity && metadata.identity !== previousIdentity;
        const truncated = Number.isFinite(previousSize) && metadata.size < previousSize;
        if (replaced || truncated || this.tailState !== "ACTIVE") {
          this.dateSourceState = "TAIL_RESTARTING";
          await this.restartLogTailing();
        }
        const stale = !this.lastDateLogReceivedAt || Date.now() - this.lastDateLogReceivedAt > dateStaleMs;
        if (forceReconcile || stale) {
          this.dateSourceState = "STALE";
          await this.reconcileLatestDateMarker(forceReconcile ? "manual" : "heartbeat");
        }
        return this.getDateTrackerStatus();
      } finally {
        this.dateHeartbeatRunning = false;
      }
    }
    scanLatestDateMarker() {
      const debugLogPath = settingsRepository.getCK3DebugLogPath();
      if (!debugLogPath || !fs$1.existsSync(debugLogPath)) return { found: false, value: null, reason: "log_file_missing" };
      const stat = fs$1.statSync(debugLogPath);
      const bytesToRead = Math.min(Number(stat.size) || 0, dateScanBytes);
      if (bytesToRead <= 0) return { found: false, value: null, reason: "empty_log" };
      const buffer = Buffer.alloc(bytesToRead);
      const fileDescriptor = fs$1.openSync(debugLogPath, "r");
      try {
        fs$1.readSync(fileDescriptor, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
      } finally {
        fs$1.closeSync(fileDescriptor);
      }
      const matches = [...buffer.toString("utf8").matchAll(/VOTC:DATE\/;\/(\d+)/g)];
      if (matches.length === 0) return { found: false, value: null, reason: "date_marker_missing" };
      return { found: true, value: Number(matches[matches.length - 1][1]), reason: "tail_scan" };
    }
    async reconcileLatestDateMarker(source = "manual") {
      const scannedAt = Date.now();
      const scan = this.scanLatestDateMarker();
      this.lastDateReconciliationAt = scannedAt;
      this.lastDateScanResult = { ...scan, source, scannedAt };
      if (!scan.found) {
        this.dateSourceState = scan.reason === "log_file_missing" ? "LOG_FILE_MISSING" : "DATE_MARKER_MISSING";
        return this.getDateTrackerStatus();
      }
      this.lastDateLogReceivedAt = scannedAt;
      this.lastDateValue = scan.value;
      this.dateSourceState = "HEALTHY";
      if (scan.value !== this.currentTotalDays) await this.updateCurrentDate(scan.value);
      else await this.checkAndDeliverLetters();
      return this.getDateTrackerStatus();
    }
    async resyncGameDate() {
      return this.runDateTrackerHeartbeat({ forceReconcile: true });
    }
    getDateTrackerStatus() {
      return {
        tailState: this.tailState,
        tailStartedAt: this.tailStartedAt,
        lastLogLineReceivedAt: this.lastLogLineReceivedAt,
        lastDateLogReceivedAt: this.lastDateLogReceivedAt,
        lastDateValue: this.lastDateValue,
        debugLogPath: this.debugLogPath,
        debugLogExists: this.debugLogExists,
        debugLogSize: this.debugLogSize,
        debugLogMtime: this.debugLogMtime,
        dateSourceState: this.dateSourceState,
        lastDateReconciliationAt: this.lastDateReconciliationAt,
        lastDateScanResult: this.lastDateScanResult ? { ...this.lastDateScanResult } : null
      };
    }
    /**
     * Check stored letters and deliver any that are ready
     */
    async checkAndDeliverLetters() {
      if (this.awaitingAcceptanceLetterId) return;
      for (const [letterId, storedLetter] of this.storedLetters.entries()) {
        if (this.currentTotalDays >= storedLetter.expectedDeliveryDay && !this.deliveryInProgress.has(letterId)) {
          console.log(`Delivering letter ${letterId} (current: ${this.currentTotalDays}, expected: ${storedLetter.expectedDeliveryDay})`);
          this.transitionLetter(letterId, LetterPipelineState.DELIVERY_DUE, { currentTotalDays: this.currentTotalDays });
          this.deliveryInProgress.add(letterId);
          try {
            const delivered = await this.deliverLetter(storedLetter);
            if (delivered) {
              this.savePendingLetters();
              break;
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
      const triggerId = `letter-trigger:${Date.now()}:${++this.pipelineSequence}`;
      this.latestPipelineStatus = { triggerId, letterId: null, state: null, history: [], startedAt: Date.now() };
      this.transitionPipeline(LetterPipelineState.TRIGGER_RECEIVED);
      const ck3UserPath = settingsRepository.getCK3UserFolderPath();
      if (ck3UserPath) {
        const runFolder = path.join(ck3UserPath, "run");
        const letterFilePath = path.join(runFolder, "letters.txt");
        console.log(`LetterManager: Resolved letters.txt path: ${letterFilePath}`);
        try {
          fs$1.mkdirSync(runFolder, { recursive: true });
          fs$1.writeFileSync(letterFilePath, `debug_log = "[Localize('talk_event.9999.desc')]"`, "utf-8");
          console.log("Created letters.txt file");
        } catch (error) {
          const contextError = `Failed to request letter payload: ${error instanceof Error ? error.message : String(error)}`;
          this.transitionPipeline(LetterPipelineState.CONTEXT_TIMEOUT, { contextError, debugLogPath: settingsRepository.getCK3DebugLogPath?.() || null });
          return null;
        }
      }
      this.transitionPipeline(LetterPipelineState.CONTEXT_WAITING, { debugLogPath: settingsRepository.getCK3DebugLogPath?.() || null });
      const context = await this.loadLatestGameDataWithLetter();
      if (!context) {
        this.transitionPipeline(LetterPipelineState.CONTEXT_TIMEOUT, this.lastPayloadDiagnostics || {});
        return null;
      }
      const { gameData, letter } = context;
      const letterTotalDays = Number(letter.totalDays);
      if (Number.isFinite(letterTotalDays)) {
        this.currentTotalDays = Math.max(this.currentTotalDays, letterTotalDays);
      }
      const characterName = gameData.getAi()?.fullName || "Unknown";
      this.createLetterStatus(letter, characterName);
      this.attachPipelineToLetter(letter.letterId);
      this.transitionPipeline(LetterPipelineState.CONTEXT_READY, this.lastPayloadDiagnostics || {});
      this.updateLetterStatus(letter.letterId, { responseStatus: LetterResponseStatus.GENERATING });
      this.transitionPipeline(LetterPipelineState.PROMPT_BUILDING);
      let messages;
      const promptMode = "official_votc_2.0.3";
      let promptBuildError = null;
      try {
        messages = letterPromptBuilder.buildMessages(gameData, letter);
      } catch (error) {
        promptBuildError = error instanceof Error ? error.message : String(error);
        console.error("Letter prompt build failed:", error);
        this.transitionPipeline(LetterPipelineState.PROMPT_BUILD_FAILED, { promptMode, promptBuildError });
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.GENERATION_FAILED,
          responseError: `Prompt build failed: ${promptBuildError}`,
          promptMode,
          promptBuildError
        });
        return null;
      }
      this.failedLetterContexts.set(letter.letterId, { letter, messages, characterName, promptMode });
      this.updateLetterStatus(letter.letterId, { promptMode, promptBuildError });
      this.transitionPipeline(LetterPipelineState.PROMPT_READY, { promptMode, promptBuildError });
      let reply = null;
      let responseError = null;
      try {
        this.transitionPipeline(LetterPipelineState.REPLY_REQUESTED);
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
        this.transitionPipeline(LetterPipelineState.REPLY_RECEIVED);
      } catch (error) {
        const responseErrorDetails = this.classifyProviderError(error);
        responseError = this.formatProviderError(responseErrorDetails);
        console.error("Letter reply generation failed:", error);
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.GENERATION_FAILED,
          responseError,
          responseErrorDetails,
          retryAttemptCount: 0
        });
        this.transitionPipeline(LetterPipelineState.REPLY_FAILED, { responseError });
        this.savePendingLetters();
        return null;
      }
      const expectedDeliveryDay = letter.totalDays + letter.delay;
      const storedLetter = {
        letter,
        reply,
        expectedDeliveryDay,
        characterName
      };
      this.storedLetters.set(letter.letterId, storedLetter);
      this.failedLetterContexts.delete(letter.letterId);
      this.syncDateTrackerSupervisor();
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.PENDING_DELIVERY,
        expectedDeliveryDay,
        daysUntilDelivery: expectedDeliveryDay - this.currentTotalDays,
        isLate: this.currentTotalDays > expectedDeliveryDay
      });
      this.transitionPipeline(LetterPipelineState.PENDING_DELIVERY, { expectedDeliveryDay });
      this.savePendingLetters();
      console.log(`Letter ${letter.letterId} generated and stored. Will deliver on day ${expectedDeliveryDay} (current: ${this.currentTotalDays})`);
      if (this.currentTotalDays >= expectedDeliveryDay) {
        console.log(`Letter ${letter.letterId} is ready for immediate delivery`);
        await this.checkAndDeliverLetters();
      }
      await this.generateSummary(gameData, letter, reply);
      return reply;
    }
    classifyProviderError(error) {
      return {
        provider: error?.provider || "unknown",
        model: error?.model || "unknown",
        errorClass: error?.name || "Error",
        httpStatus: error?.status ?? null,
        errorCode: error?.code ?? null,
        causeCode: error?.causeCode ?? error?.cause?.code ?? null,
        message: error instanceof Error ? error.message : String(error || "Unknown error"),
        attemptCount: Number(error?.attemptCount || error?.votcAttemptCount) || 1,
        retryable: error?.retryable === true || error?.votcRetryable === true
      };
    }
    formatProviderError(details) {
      return [
        `Provider: ${details.provider}`,
        `Model: ${details.model}`,
        `Class: ${details.errorClass}`,
        `HTTP: ${details.httpStatus ?? "n/a"}`,
        `Code: ${details.errorCode || details.causeCode || "n/a"}`,
        `Attempts: ${details.attemptCount}`,
        `Retryable: ${details.retryable ? "yes" : "no"}`,
        `Message: ${details.message}`
      ].join(" | ");
    }
    async retryFailedLetter(letterId) {
      const normalizedLetterId = typeof letterId === "string" ? letterId.trim() : "";
      const status = this.getLetterStatus(normalizedLetterId);
      if (!status) return { success: false, error: "Letter status not found." };
      if (status.responseStatus !== LetterResponseStatus.GENERATION_FAILED) return { success: false, error: `Retry is not allowed from ${status.responseStatus}.` };
      if (this.storedLetters.has(normalizedLetterId) || this.awaitingAcceptanceLetterId === normalizedLetterId) return { success: false, error: "Letter already entered delivery; duplicate reply generation is blocked." };
      if (this.replyRetryInProgress.has(normalizedLetterId)) return { success: false, error: "A retry for this letter is already in progress." };
      const context = this.failedLetterContexts.get(normalizedLetterId);
      if (!context?.letter || !Array.isArray(context.messages)) return { success: false, error: "Retry context is unavailable. Receive the same letter payload again before retrying." };
      this.replyRetryInProgress.add(normalizedLetterId);
      const retryAttemptCount = Number(status.retryAttemptCount || 0) + 1;
      this.updateLetterStatus(normalizedLetterId, { responseStatus: LetterResponseStatus.GENERATING, responseError: null, responseErrorDetails: null, retryAttemptCount });
      this.transitionLetter(normalizedLetterId, LetterPipelineState.REPLY_REQUESTED, { retryAttemptCount });
      try {
        const result = await llmManager.sendChatRequest(context.messages, void 0, true, { requestType: "letter", character: context.characterName, letterRetry: true, retryAttemptCount });
        const reply = await this.extractReply(result);
        if (!reply) throw new Error("Letter reply generation returned empty content.");
        this.updateLetterStatus(normalizedLetterId, { responseStatus: LetterResponseStatus.GENERATED, responseContent: reply });
        this.transitionLetter(normalizedLetterId, LetterPipelineState.REPLY_RECEIVED, { retryAttemptCount });
        const expectedDeliveryDay = Number(context.letter.totalDays) + Number(context.letter.delay);
        const storedLetter = { letter: context.letter, reply, expectedDeliveryDay, characterName: context.characterName };
        this.storedLetters.set(normalizedLetterId, storedLetter);
        this.failedLetterContexts.delete(normalizedLetterId);
        this.updateLetterStatus(normalizedLetterId, {
          responseStatus: LetterResponseStatus.PENDING_DELIVERY,
          responseContent: reply,
          responseError: null,
          responseErrorDetails: null,
          expectedDeliveryDay,
          daysUntilDelivery: expectedDeliveryDay - this.currentTotalDays,
          isLate: this.currentTotalDays > expectedDeliveryDay
        });
        this.transitionLetter(normalizedLetterId, LetterPipelineState.PENDING_DELIVERY, { expectedDeliveryDay, retryAttemptCount });
        this.savePendingLetters();
        if (this.currentTotalDays >= expectedDeliveryDay) await this.checkAndDeliverLetters();
        const latestContext = await this.loadLatestGameDataWithLetter();
        if (latestContext?.letter?.letterId === normalizedLetterId) await this.generateSummary(latestContext.gameData, context.letter, reply);
        else this.updateLetterStatus(normalizedLetterId, { summaryStatus: LetterSummaryStatus.GENERATION_FAILED, summaryError: "Retry succeeded, but matching letter context was unavailable for summary." });
        return { success: true, letterId: normalizedLetterId, responseStatus: LetterResponseStatus.PENDING_DELIVERY };
      } catch (error) {
        const responseErrorDetails = this.classifyProviderError(error);
        const responseError = this.formatProviderError(responseErrorDetails);
        this.updateLetterStatus(normalizedLetterId, { responseStatus: LetterResponseStatus.GENERATION_FAILED, responseError, responseErrorDetails, retryAttemptCount });
        this.transitionLetter(normalizedLetterId, LetterPipelineState.REPLY_FAILED, { responseError, retryAttemptCount });
        this.savePendingLetters();
        return { success: false, letterId: normalizedLetterId, error: responseError, details: responseErrorDetails };
      } finally {
        this.replyRetryInProgress.delete(normalizedLetterId);
      }
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
        this.lastPayloadDiagnostics = { attemptCount: 0, elapsedMs: 0, debugLogPath: null, lastParseResult: "debug_log_path_missing" };
        return null;
      }
      const startedAt = Date.now();
      let attemptCount = 0;
      let lastParseResult = "not_started";
      let lastError = null;
      for (let index = 0; index <= letterPayloadRetryDelays.length; index++) {
        if (index > 0) await sleep(letterPayloadRetryDelays[index - 1]);
        attemptCount++;
        try {
          const gameData = await parseLog(debugLogPath);
          if (!gameData) {
            lastParseResult = "game_data_missing";
            continue;
          }
          const letter = gameData.letterData;
          if (!letter) {
            lastParseResult = "letter_payload_missing";
            continue;
          }
          let summaryLoadError = null;
          try {
            gameData.loadCharactersSummaries?.();
          } catch (error) {
            summaryLoadError = error instanceof Error ? error.message : String(error);
            console.warn("Letter context summary loading failed; continuing without saved summaries:", error);
          }
          this.lastPayloadDiagnostics = {
            attemptCount,
            elapsedMs: Date.now() - startedAt,
            debugLogPath,
            lastParseResult: "letter_payload_ready",
            lastError: null,
            summaryLoadError
          };
          return { gameData, letter };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          lastParseResult = "parse_failed";
        }
      }
      this.lastPayloadDiagnostics = { attemptCount, elapsedMs: Date.now() - startedAt, debugLogPath, lastParseResult, lastError };
      console.warn(`No letter data found after ${attemptCount} parse attempts (${this.lastPayloadDiagnostics.elapsedMs}ms).`);
      return null;
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
      if (!ai) {
        this.transitionPipeline(LetterPipelineState.SUMMARY_FAILED, { summaryError: "Letter recipient missing" });
        return false;
      }
      this.updateLetterStatus(letter.letterId, {
        summaryStatus: LetterSummaryStatus.GENERATING
      });
      this.transitionPipeline(LetterPipelineState.SUMMARY_REQUESTED);
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
      let summaryGenerated = false;
      try {
        console.log(`[TOKEN_COUNT] Letter summary prompt tokens: ${TokenCounter.estimateMessageTokens(summaryPrompt[0])}`);
        console.log(`[TOKEN_COUNT] Letter summary letters letters content tokens: ${TokenCounter.estimateMessageTokens(summaryPrompt[1])}`);
        const summaryResult = await llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "letter_summary", character: ai.shortName });
        const summary = summaryResult && typeof summaryResult === "object" && "content" in summaryResult ? summaryResult.content : null;
        if (!summary?.trim()) throw new Error("Letter summary generation returned empty content.");
        summaryGenerated = true;
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
        this.transitionPipeline(LetterPipelineState.SUMMARY_SAVED);
        return true;
      } catch (error) {
        const summaryError = error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to generate letter summary:", error);
        this.updateLetterStatus(letter.letterId, {
          summaryStatus: summaryGenerated ? LetterSummaryStatus.SAVE_FAILED : LetterSummaryStatus.GENERATION_FAILED,
          summaryError
        });
        this.transitionPipeline(LetterPipelineState.SUMMARY_FAILED, { summaryError });
        return false;
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
        this.transitionLetter(letter.letterId, LetterPipelineState.DELIVERY_FAILED, { deliveryError: "CK3 user folder not configured" });
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
        this.transitionLetter(letter.letterId, LetterPipelineState.DELIVERY_FAILED, { deliveryError: errorMessage });
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
        const effectWrittenAt = Date.now();
        this.awaitingAcceptanceLetterId = letter.letterId;
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.EFFECT_FILE_WRITTEN,
          responseError: null,
          effectFileWrittenAt: effectWrittenAt
        });
        this.transitionLetter(letter.letterId, LetterPipelineState.EFFECT_FILE_WRITTEN);
        this.savePendingLetters();
        return true;
      } catch (error) {
        const errorMessage = `Failed to write letter effect: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(`LetterManager.writeLetterEffect: ${errorMessage}`);
        this.updateLetterStatus(letter.letterId, {
          responseStatus: LetterResponseStatus.SEND_FAILED,
          responseError: errorMessage
        });
        this.transitionLetter(letter.letterId, LetterPipelineState.DELIVERY_FAILED, { deliveryError: errorMessage });
        return false;
      }
    }
    loadPendingLetters() {
      if (!this.pendingLettersFile || !fs$1.existsSync(this.pendingLettersFile)) return;
      try {
        const state = JSON.parse(fs$1.readFileSync(this.pendingLettersFile, "utf8"));
        this.awaitingAcceptanceLetterId = typeof state?.awaitingAcceptanceLetterId === "string" ? state.awaitingAcceptanceLetterId : null;
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
        for (const failedContext of Array.isArray(state?.failedLetters) ? state.failedLetters : []) {
          const letterId = failedContext?.letter?.letterId;
          if (!letterId || !Array.isArray(failedContext.messages) || this.storedLetters.has(letterId)) continue;
          this.failedLetterContexts.set(letterId, {
            letter: failedContext.letter,
            messages: failedContext.messages,
            characterName: failedContext.characterName || "Unknown",
            promptMode: failedContext.promptMode || "official_votc_2.0.3"
          });
          if (failedContext.status) this.letterStatuses.set(letterId, failedContext.status);
          else {
            this.createLetterStatus(failedContext.letter, failedContext.characterName || "Unknown");
            this.updateLetterStatus(letterId, { responseStatus: LetterResponseStatus.GENERATION_FAILED, responseError: "Previous reply generation failed.", retryAttemptCount: 0 });
          }
        }
        if (this.storedLetters.size > 0) {
          console.log(`LetterManager: Restored ${this.storedLetters.size} pending letter(s)`);
        }
        this.syncDateTrackerSupervisor();
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
        const failedLetters = Array.from(this.failedLetterContexts.entries()).map(([letterId, failedContext]) => ({
          ...failedContext,
          status: this.letterStatuses.get(letterId) || null
        }));
        fs$1.writeFileSync(this.pendingLettersFile, JSON.stringify({ version: 3, awaitingAcceptanceLetterId: this.awaitingAcceptanceLetterId, letters, failedLetters }, null, 2), "utf8");
        this.syncDateTrackerSupervisor();
      } catch (error) {
        console.error("LetterManager: Failed to save pending letters:", error);
      }
    }
    /**
     * Clear the letters.txt file
     */
    async clearLettersFile() {
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
      const acceptedLetterId = this.awaitingAcceptanceLetterId;
      this.awaitingAcceptanceLetterId = null;
      if (acceptedLetterId) {
        const letterAcceptedAt = Date.now();
        const status = this.getLetterStatus(acceptedLetterId);
        const effectWrittenAt = Number(status?.effectFileWrittenAt);
        const acceptLatencyMs = Number.isFinite(effectWrittenAt) ? Math.max(0, letterAcceptedAt - effectWrittenAt) : null;
        this.updateLetterStatus(acceptedLetterId, {
          responseStatus: LetterResponseStatus.SENT,
          responseError: null,
          acceptedAt: letterAcceptedAt,
          popupTriggeredAt: letterAcceptedAt,
          letterAcceptedAt,
          acceptLatencyMs,
          suspiciousImmediateLetterAcceptance: acceptLatencyMs !== null && acceptLatencyMs < 500,
          suspicious_immediate_letter_acceptance: acceptLatencyMs !== null && acceptLatencyMs < 500
        });
        this.transitionLetter(acceptedLetterId, LetterPipelineState.DELIVERED);
        this.storedLetters.delete(acceptedLetterId);
        this.savePendingLetters();
      }
      this.syncDateTrackerSupervisor();
      await this.checkAndDeliverLetters();
    }
    /**
     * Stop log tailing (cleanup)
     */
    async stopLogTailing(stopSupervisor = true) {
      if (this.tailRestartTimer) {
        clearTimeout(this.tailRestartTimer);
        this.tailRestartTimer = null;
      }
      if (this.readline) {
        this.readline.close();
        this.readline = null;
      }
      if (this.tailFile) {
        await this.tailFile.quit();
        this.tailFile = null;
        console.log("Stopped log tailing");
      }
      this.tailState = "STOPPED";
      if (stopSupervisor && this.dateHeartbeatTimer) {
        clearIntervalFn(this.dateHeartbeatTimer);
        this.dateHeartbeatTimer = null;
      }
    }
    /**
     * Restart log tailing (useful when CK3 path is updated)
     */
    async restartLogTailing() {
      console.log("Restarting log tailing...");
      this.tailState = "RESTARTING";
      this.dateSourceState = "TAIL_RESTARTING";
      await this.stopLogTailing(false);
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
        characterName,
        pipelineState: this.latestPipelineStatus?.state || LetterPipelineState.CONTEXT_READY,
        pipelineHistory: [...(this.latestPipelineStatus?.history || [])],
        promptMode: null,
        promptBuildError: null
      };
      this.letterStatuses.set(letter.letterId, statusInfo);
    }
    attachPipelineToLetter(letterId) {
      if (!this.latestPipelineStatus) return;
      this.latestPipelineStatus = { ...this.latestPipelineStatus, letterId };
    }
    transitionPipeline(state, details = {}) {
      const timestamp = Date.now();
      const current = this.latestPipelineStatus || { triggerId: `letter-trigger:${timestamp}:unknown`, letterId: null, history: [], startedAt: timestamp };
      const transition = { state, timestamp };
      const history = [...(current.history || []), transition].slice(-32);
      this.latestPipelineStatus = { ...current, ...details, state, updatedAt: timestamp, history };
      if (this.latestPipelineStatus.letterId) this.transitionLetter(this.latestPipelineStatus.letterId, state, details, false);
      console.log(`[LetterPipeline] trigger=${this.latestPipelineStatus.triggerId} letter=${this.latestPipelineStatus.letterId || "pending"} state=${state}`);
    }
    transitionLetter(letterId, state, details = {}, updateLatest = true) {
      const existing = this.letterStatuses.get(letterId);
      if (existing) {
        const timestamp = Date.now();
        const history = [...(existing.pipelineHistory || []), { state, timestamp }].slice(-32);
        this.letterStatuses.set(letterId, { ...existing, ...details, pipelineState: state, pipelineUpdatedAt: timestamp, pipelineHistory: history });
      }
      if (updateLatest && this.latestPipelineStatus?.letterId === letterId) {
        const timestamp = Date.now();
        const history = [...(this.latestPipelineStatus.history || []), { state, timestamp }].slice(-32);
        this.latestPipelineStatus = { ...this.latestPipelineStatus, ...details, state, updatedAt: timestamp, history };
      }
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
    getDiagnosticPipelineBusyReason() {
      if (this.awaitingAcceptanceLetterId) return `正式信件 ${this.awaitingAcceptanceLetterId} 正在等待 CK3 Popup 启动确认`;
      if (this.deliveryInProgress.size > 0) return "正式信件正在 DELIVERY_DUE / Effect 写入";
      const busyStates = new Set([
        LetterPipelineState.PROMPT_BUILDING,
        LetterPipelineState.REPLY_REQUESTED,
        LetterPipelineState.SUMMARY_REQUESTED,
        LetterPipelineState.DELIVERY_DUE,
        LetterPipelineState.EFFECT_FILE_WRITTEN
      ]);
      return busyStates.has(this.latestPipelineStatus?.state) ? `正式信件管线处于 ${this.latestPipelineStatus.state}` : null;
    }
    getKnownDiagnosticLetters() {
      const known = new Map(Array.from(this.letterStatuses.values()).map((status) => [status.letterId, {
        letterId: status.letterId,
        characterName: status.characterName || "Unknown",
        responseStatus: status.responseStatus,
        expectedDeliveryDay: status.expectedDeliveryDay
      }]));
      for (const [letterId, storedLetter] of this.storedLetters.entries()) {
        if (!known.has(letterId)) known.set(letterId, { letterId, characterName: storedLetter.characterName || "Unknown", responseStatus: LetterResponseStatus.PENDING_DELIVERY, expectedDeliveryDay: storedLetter.expectedDeliveryDay });
      }
      const priority = { [LetterResponseStatus.PENDING_DELIVERY]: 3, [LetterResponseStatus.GENERATED]: 2, [LetterResponseStatus.GENERATION_FAILED]: 1 };
      return Array.from(known.values()).sort((left, right) => (priority[right.responseStatus] || 0) - (priority[left.responseStatus] || 0) || String(left.letterId).localeCompare(String(right.letterId)));
    }
    refreshEffectDiagnosticTimeout() {
      const diagnostic = this.activeEffectDiagnostic;
      if (diagnostic?.executionStatus === "WAITING_FOR_CK3_EXECUTION" && Date.now() - diagnostic.writtenAt >= diagnosticExecutionTimeoutMs) {
        diagnostic.executionStatus = "RUN_FILE_NOT_EXECUTED";
        diagnostic.result = "RUN_FILE_NOT_EXECUTED";
        diagnostic.executionTimedOutAt = Date.now();
        this.effectDiagnosticStages[diagnostic.stage] = { ...diagnostic };
        this.lastEffectDiagnostic = { ...diagnostic };
      }
    }
    getDiagnosticDisableReason(stage, letterId = null) {
      const diagnosticStage = String(stage || "").toUpperCase();
      if (!["A", "B", "C", "D"].includes(diagnosticStage)) return "未知诊断阶段";
      const busyReason = this.getDiagnosticPipelineBusyReason();
      if (busyReason) return busyReason;
      this.refreshEffectDiagnosticTimeout();
      if (this.activeEffectDiagnostic?.executionStatus === "WAITING_FOR_CK3_EXECUTION") return `${this.activeEffectDiagnostic.stage} 正在等待 CK3 Execution Marker`;
      if (this.activeEffectDiagnostic?.result === "ARTIFACT_VISUAL_CHECK_REQUIRED") return `${this.activeEffectDiagnostic.stage} 已执行，请先确认 CK3 可见结果`;
      if (diagnosticStage !== "A") {
        const normalizedLetterId = typeof letterId === "string" ? letterId.trim() : "";
        if (!normalizedLetterId) return "请选择 Known Letter ID";
        if (!this.letterStatuses.has(normalizedLetterId) && !this.storedLetters.has(normalizedLetterId)) return "所选 Letter ID 不在已知信件中";
        const previousStage = String.fromCharCode(diagnosticStage.charCodeAt(0) - 1);
        if (this.effectDiagnosticStages[previousStage]?.result !== "PASS") return `${previousStage} 尚未通过 CK3 Execution 与可见结果确认`;
      }
      return null;
    }
    runEffectDiagnostic(stage, letterId = null) {
      const diagnosticStage = String(stage || "").toUpperCase();
      const normalizedLetterId = typeof letterId === "string" ? letterId.trim() : "";
      const disableReason = this.getDiagnosticDisableReason(diagnosticStage, normalizedLetterId);
      if (disableReason) return { success: false, stage: diagnosticStage, error: disableReason, disableReason };
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      if (!ck3Folder) return { success: false, error: "CK3 user folder not configured." };
      const runFolder = path.join(ck3Folder, "run");
      const letterFilePath = path.join(runFolder, "letters.txt");
      const creatorScopeName = diagnosticStage === "A" ? "root" : `global_var:message_second_scope_${normalizedLetterId}`;
      const diagnosticId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      let gameCommand = `debug_log = "VOTC:LETTER_DIAG/${diagnosticStage}/${diagnosticId}"
create_artifact = {
\tname = "VOTC_TEST"
\tdescription = "TEST LETTER"
\ttype = journal
\tvisuals = scroll
\tcreator = ${creatorScopeName}`;
      if (diagnosticStage === "A" || diagnosticStage === "B") {
        gameCommand += `
\tsave_scope_as = votc_test_letter`;
      } else {
        gameCommand += `
\tsave_scope_as = votc_latest_letter
}
set_global_variable = {
\tname = votc_latest_letter
\tvalue = scope:votc_latest_letter`;
      }
      gameCommand += "\n}";
      if (diagnosticStage === "D") gameCommand += "\ntrigger_event = message_event.362";
      try {
        fs$1.mkdirSync(runFolder, { recursive: true });
        fs$1.writeFileSync(letterFilePath, gameCommand, "utf-8");
        const diagnostic = {
          success: true,
          stage: diagnosticStage,
          diagnosticId,
          marker: `VOTC:LETTER_DIAG/${diagnosticStage}/${diagnosticId}`,
          letterId: diagnosticStage === "A" ? null : normalizedLetterId,
          creatorScopeName,
          effectFilePath: letterFilePath,
          writeStatus: "WRITE_OK",
          executionStatus: "WAITING_FOR_CK3_EXECUTION",
          result: "WAITING_FOR_CK3_EXECUTION",
          writtenAt: Date.now()
        };
        this.activeEffectDiagnostic = diagnostic;
        this.effectDiagnosticStages[diagnosticStage] = { ...diagnostic };
        this.lastEffectDiagnostic = { ...diagnostic };
        console.log(`[LetterDiagnostics] stage=${diagnosticStage} id=${diagnosticId} state=WAITING_FOR_CK3_EXECUTION`);
        return { ...diagnostic };
      } catch (error) {
        const errorMessage = `Failed to write diagnostic effect: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(`LetterManager.runEffectDiagnostic: ${errorMessage}`);
        const diagnostic = { success: false, stage: diagnosticStage, diagnosticId, letterId: diagnosticStage === "A" ? null : normalizedLetterId, creatorScopeName, writeStatus: "WRITE_FAILED", executionStatus: "NOT_STARTED", result: "WRITE_FAILED", error: errorMessage, writtenAt: Date.now() };
        this.effectDiagnosticStages[diagnosticStage] = { ...diagnostic };
        this.lastEffectDiagnostic = { ...diagnostic };
        return { ...diagnostic };
      }
    }
    confirmDiagnosticExecutionMarker(stage, diagnosticId) {
      const diagnostic = this.activeEffectDiagnostic;
      if (!diagnostic || diagnostic.stage !== stage || diagnostic.diagnosticId !== diagnosticId) return false;
      if (diagnostic.executionStatus !== "WAITING_FOR_CK3_EXECUTION") return false;
      diagnostic.executionStatus = "EXECUTION_CONFIRMED";
      diagnostic.executionConfirmedAt = Date.now();
      diagnostic.result = "ARTIFACT_VISUAL_CHECK_REQUIRED";
      diagnostic.visualCheckRequired = true;
      this.effectDiagnosticStages[stage] = { ...diagnostic };
      this.lastEffectDiagnostic = { ...diagnostic };
      console.log(`[LetterDiagnostics] stage=${stage} id=${diagnosticId} state=EXECUTION_CONFIRMED`);
      return true;
    }
    confirmEffectDiagnostic(stage, passed) {
      const diagnosticStage = String(stage || "").toUpperCase();
      const diagnostic = this.effectDiagnosticStages[diagnosticStage];
      if (!diagnostic || diagnostic.executionStatus !== "EXECUTION_CONFIRMED") return { success: false, error: `${diagnosticStage} 尚未收到 CK3 Execution Marker` };
      diagnostic.visualCheckRequired = false;
      diagnostic.visualCheckConfirmedAt = Date.now();
      diagnostic.result = passed === true ? "PASS" : "FAIL";
      diagnostic.success = passed === true;
      this.effectDiagnosticStages[diagnosticStage] = { ...diagnostic };
      this.activeEffectDiagnostic = null;
      this.lastEffectDiagnostic = { ...diagnostic };
      return { ...diagnostic };
    }
    /**
     * Get all letter statuses
     */
    getAllLetterStatuses() {
      this.refreshEffectDiagnosticTimeout();
      for (const status of this.letterStatuses.values()) {
        status.currentDay = this.currentTotalDays;
        status.daysUntilDelivery = status.expectedDeliveryDay - this.currentTotalDays;
        status.isLate = this.currentTotalDays > status.expectedDeliveryDay;
      }
      let effectFileExists = false;
      let effectFileAge = null;
      let effectContent = "";
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      if (ck3Folder) {
        const effectFilePath = path.join(ck3Folder, "run", "letters.txt");
        try {
          effectFileExists = fs$1.existsSync(effectFilePath);
          if (effectFileExists) {
            effectFileAge = Math.max(0, Date.now() - fs$1.statSync(effectFilePath).mtimeMs);
            effectContent = fs$1.readFileSync(effectFilePath, "utf8");
          }
        } catch (error) {
          console.warn("LetterManager: Failed to inspect letters.txt diagnostics:", error);
          effectFileExists = false;
          effectFileAge = null;
          effectContent = "";
        }
      }
      const effectContainsCreateArtifact = /\bcreate_artifact\s*=/.test(effectContent);
      const effectContainsMessageEvent362 = /\btrigger_event\s*=\s*message_event\.362\b/.test(effectContent);
      const statusWithEffect = Array.from(this.letterStatuses.values()).sort((left, right) => Math.max(right.letterAcceptedAt || right.acceptedAt || 0, right.effectFileWrittenAt || 0) - Math.max(left.letterAcceptedAt || left.acceptedAt || 0, left.effectFileWrittenAt || 0))[0] || null;
      const creatorScopeName = effectContent.match(/\bcreator\s*=\s*([^\s]+)/)?.[1] || this.lastEffectDiagnostic?.creatorScopeName || null;
      const creatorScopeExpected = statusWithEffect?.letterId ? `global_var:message_second_scope_${statusWithEffect.letterId}` : this.lastEffectDiagnostic?.letterId ? `global_var:message_second_scope_${this.lastEffectDiagnostic.letterId}` : null;
      return {
        letters: Array.from(this.letterStatuses.values()),
        currentTotalDays: this.currentTotalDays,
        lastDateLogReceivedAt: this.lastDateLogReceivedAt,
        awaitingAcceptanceLetterId: this.awaitingAcceptanceLetterId,
        effectFileExists,
        effectFileAge,
        storedLettersCount: this.storedLetters.size,
        dateTracker: this.getDateTrackerStatus(),
        effectPayloadPresent: effectContainsCreateArtifact || effectContainsMessageEvent362,
        effectContainsCreateArtifact,
        effectContainsMessageEvent362,
        effectWrittenAt: statusWithEffect?.effectFileWrittenAt || null,
        popupTriggeredAt: statusWithEffect?.popupTriggeredAt || null,
        letterAcceptedAt: statusWithEffect?.letterAcceptedAt || statusWithEffect?.acceptedAt || null,
        acceptLatencyMs: statusWithEffect?.acceptLatencyMs ?? null,
        suspiciousImmediateLetterAcceptance: statusWithEffect?.suspiciousImmediateLetterAcceptance === true,
        suspicious_immediate_letter_acceptance: statusWithEffect?.suspicious_immediate_letter_acceptance === true,
        creatorScopeName,
        creatorScopeExpected,
        lastEffectDiagnostic: this.lastEffectDiagnostic ? { ...this.lastEffectDiagnostic } : null,
        effectDiagnostics: Object.fromEntries(Object.entries(this.effectDiagnosticStages).map(([stage, diagnostic]) => [stage, diagnostic ? { ...diagnostic } : null])),
        knownDiagnosticLetters: this.getKnownDiagnosticLetters(),
        diagnosticDisableReasons: Object.fromEntries(["A", "B", "C", "D"].map((stage) => [stage, this.getDiagnosticDisableReason(stage, this.lastEffectDiagnostic?.letterId || null)])),
        pipeline: this.latestPipelineStatus ? { ...this.latestPipelineStatus, history: [...this.latestPipelineStatus.history] } : null,
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
  
  return { LetterManager, LetterResponseStatus, LetterSummaryStatus, LetterPipelineState };
}

module.exports = { createLetterManager };

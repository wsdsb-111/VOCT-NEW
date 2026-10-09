"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { randomBytes } = require("crypto");

function createLetterManager({ settingsRepository, fs, path, TailFile, readline, parseLog, letterPromptBuilder, llmManager, PromptBuilder, TokenCounter, memoryEngine, dataDir, letterEffectTransport = null, runFileManager = null, scanRunAcksForPendingCommands = null, autoStartLogTailing = true, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), letterPayloadRetryDelays = [100, 200, 350, 600, 1e3], dateHeartbeatIntervalMs = 5e3, dateStaleMs = 2e4, dateScanBytes = 1024 * 1024, diagnosticExecutionTimeoutMs = 15e3, runCommandAckTimeoutMs = 3e4, runCommandWatchdogIntervalMs = 5e3, setIntervalFn = setInterval, clearIntervalFn = clearInterval, setRunCommandIntervalFn = setInterval, clearRunCommandIntervalFn = clearInterval }) {
  const fs$1 = fs;
  const readline$1 = readline;
  if (!scanRunAcksForPendingCommands) ({ scanRunAcksForPendingCommands } = require("../actions/run-command-recovery"));
  const LetterEffectTransportMode = Object.freeze({ LEGACY: "legacy_letters_file", VOTC: "votc_run_file" });
  if (!letterEffectTransport) {
    const { createLetterEffectTransport } = require("./letter-effect-transport");
    const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path, dataDir });
    letterEffectTransport = new LetterEffectTransport();
  }
  var LetterResponseStatus = /* @__PURE__ */ ((LetterResponseStatus2) => {
    LetterResponseStatus2["GENERATING"] = "generating";
    LetterResponseStatus2["GENERATED"] = "generated";
    LetterResponseStatus2["GENERATION_FAILED"] = "generation_failed";
    LetterResponseStatus2["PENDING_DELIVERY"] = "pending_delivery";
    LetterResponseStatus2["EFFECT_FILE_WRITTEN"] = "effect_file_written";
    LetterResponseStatus2["SENT"] = "sent";
    LetterResponseStatus2["SEND_FAILED"] = "send_failed";
    LetterResponseStatus2["PAYLOAD_INVALID"] = "payload_invalid";
    LetterResponseStatus2["LEGACY_INVALID_PENDING"] = "legacy_invalid_pending";
    LetterResponseStatus2["CANCELLED"] = "cancelled";
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
    LetterPipelineState2["PAYLOAD_INVALID"] = "PAYLOAD_INVALID";
    LetterPipelineState2["PENDING_CLEARED"] = "PENDING_CLEARED";
    return LetterPipelineState2;
  })(LetterPipelineState || {});
  class LetterManager {
    // 5 minutes
    constructor() {
      this.currentTotalDays = 0;
      this.storedLetters = /* @__PURE__ */ new Map();
      this.failedLetterContexts = /* @__PURE__ */ new Map();
      this.payloadRetryContexts = /* @__PURE__ */ new Map();
      this.payloadRetryInProgress = /* @__PURE__ */ new Set();
      this.replyRetryInProgress = /* @__PURE__ */ new Set();
      this.letterStatuses = /* @__PURE__ */ new Map();
      this.deliveryInProgress = /* @__PURE__ */ new Set();
      this.awaitingAcceptanceLetterId = null;
      this.tailFile = null;
      this.readline = null;
      this.logTailingTransition = Promise.resolve();
      this.letterAcceptanceTransition = Promise.resolve();
      this.tailRestartTimer = null;
      this.dateHeartbeatTimer = null;
      this.runCommandWatchdogTimer = null;
      this.dateHeartbeatRunning = false;
      this.tailState = "STOPPED";
      this.tailStartedAt = null;
      this.lastLogLineReceivedAt = null;
      this.lastDateLogReceivedAt = null;
      this.lastDateValue = null;
      this.lastObservedDateValue = null;
      this.lastObservedDateMarkerAt = null;
      this.lastProgressDateValue = null;
      this.lastProgressAt = null;
      this.lastDateMarkerSource = null;
      this.dateSessionId = null;
      this.dateSessionLogIdentity = null;
      this.dateSessionBoundaryOffset = null;
      this.dateSessionLogSize = null;
      this.dateSessionScanCache = null;
      this.debugLogPath = null;
      this.debugLogExists = false;
      this.debugLogSize = null;
      this.debugLogMtime = null;
      this.debugLogIdentity = null;
      this.dateSourceState = "UNKNOWN";
      this.dateProducerState = "UNKNOWN";
      this.dateProducerRecovery = null;
      this.lastDateReconciliationAt = null;
      this.lastDateScanResult = null;
      this.latestPipelineStatus = null;
      this.pipelineSequence = 0;
      this.lastPayloadDiagnostics = null;
      this.lastEffectDiagnostic = null;
      this.effectDiagnosticStages = { A1: null, A2: null, A3: null, B: null, C: null, D: null };
      this.activeEffectDiagnostic = null;
      this.lastInvalidLetterPayload = null;
      this.pendingLettersFile = dataDir ? path.join(dataDir, "pending-letters.json") : null;
      this.invalidPendingLettersFile = dataDir ? path.join(dataDir, "invalid-pending-letters.json") : null;
      this.loadPendingLetters();
      this.syncDateTrackerSupervisor();
      const ck3UserPath = settingsRepository.getCK3UserFolderPath();
      if (ck3UserPath && autoStartLogTailing) {
        this.startLogTailing();
      } else if (!ck3UserPath) {
        console.log("LetterManager: CK3 user path not configured yet, will start tailing when path is set");
      }
      if (this.storedLetters.size > 0) Promise.resolve().then(() => this.ensureDateProducerRunning("app_start_pending_letters"));
    }
    /**
     * Start tailing the debug.log file to track VOTC:DATE updates
     */
    queueLogTailingTransition(operation) {
      const transition = this.logTailingTransition.catch(() => {}).then(operation);
      this.logTailingTransition = transition;
      return transition;
    }
    startLogTailing() {
      return this.queueLogTailingTransition(() => this.startLogTailingNow());
    }
    async startLogTailingNow() {
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
        if (this.tailFile) await this.stopLogTailingNow(false);
        this.captureDebugLogMetadata(debugLogPath);
        this.tailState = "STARTING";
        const reader = new TailFile(debugLogPath, { encoding: "utf8" });
        this.tailFile = reader;
        reader.on("tail_error", (err) => {
          if (this.tailFile !== reader) return;
          console.error("Tail error:", err);
          this.tailState = "ERROR";
          this.dateSourceState = "TAIL_RESTARTING";
          this.scheduleLogTailingRestart();
        });
        reader.on("log_reset", () => {
          if (this.tailFile !== reader) return;
          this.resetDateSession();
          this.clearDateMarkerState();
          this.captureDebugLogMetadata(debugLogPath);
        });
        await reader.start();
        this.tailState = "ACTIVE";
        this.tailStartedAt = Date.now();
        console.log(`Started tailing debug log: ${debugLogPath}`);
        this.readline = readline$1.createInterface({ input: reader });
        this.readline.on("line", (line) => {
          if (this.tailFile !== reader || this.tailState !== "ACTIVE") return;
          Promise.resolve(this.processLogLine(line)).catch((error) => console.error("LetterManager: Failed to process log line:", error));
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
    clearDateMarkerState() {
      this.currentTotalDays = 0;
      this.lastDateLogReceivedAt = null;
      this.lastDateValue = null;
      this.lastObservedDateValue = null;
      this.lastObservedDateMarkerAt = null;
      this.lastProgressDateValue = null;
      this.lastProgressAt = null;
      this.lastDateMarkerSource = null;
      this.dateSourceState = "DATE_MARKER_MISSING";
      this.dateProducerState = "UNKNOWN";
      this.lastDateReconciliationAt = null;
      this.lastDateScanResult = null;
    }
    resetDateSession() {
      if (this.dateSessionId) this.clearDateMarkerState();
      this.dateSessionId = null;
      this.dateSessionLogIdentity = null;
      this.dateSessionBoundaryOffset = null;
      this.dateSessionLogSize = null;
      this.dateSessionScanCache = null;
    }
    beginDateSession(sessionId, { logIdentity = null, boundaryOffset = null, logSize = null } = {}) {
      if (!sessionId) return false;
      const observedLogIdentity = logIdentity || this.debugLogIdentity || null;
      const sameLog = !observedLogIdentity || !this.dateSessionLogIdentity || observedLogIdentity === this.dateSessionLogIdentity;
      const logChanged = (observedLogIdentity && this.dateSessionLogIdentity && observedLogIdentity !== this.dateSessionLogIdentity) ||
        (Number.isFinite(logSize) && Number.isFinite(this.dateSessionLogSize) && logSize < this.dateSessionLogSize);
      const newerBoundary = Number.isFinite(boundaryOffset) && Number.isFinite(this.dateSessionBoundaryOffset) && boundaryOffset > this.dateSessionBoundaryOffset;
      if (sessionId === this.dateSessionId && sameLog && !logChanged && !newerBoundary) {
        if (!this.dateSessionLogIdentity && logIdentity) this.dateSessionLogIdentity = logIdentity;
        if (this.dateSessionBoundaryOffset === null && Number.isFinite(boundaryOffset)) this.dateSessionBoundaryOffset = boundaryOffset;
        if (Number.isFinite(logSize)) this.dateSessionLogSize = Math.max(this.dateSessionLogSize || 0, logSize);
        return false;
      }
      this.clearDateMarkerState();
      this.dateSessionId = sessionId;
      this.dateSessionLogIdentity = logIdentity || this.debugLogIdentity || null;
      this.dateSessionBoundaryOffset = Number.isFinite(boundaryOffset) ? boundaryOffset : null;
      this.dateSessionLogSize = Number.isFinite(logSize) ? logSize : null;
      return true;
    }
    beginDateSessionFromScan(sessionId, sessionScan) {
      const logIdentity = sessionScan.logIdentity || this.debugLogIdentity;
      const sameLog = logIdentity && logIdentity === this.dateSessionLogIdentity;
      const logChanged = (logIdentity && this.dateSessionLogIdentity && logIdentity !== this.dateSessionLogIdentity) ||
        (Number.isFinite(sessionScan.logSize) && Number.isFinite(this.dateSessionLogSize) && sessionScan.logSize < this.dateSessionLogSize);
      const olderBoundary = this.dateSessionId && sameLog && !logChanged && Number.isFinite(sessionScan.sessionBoundaryOffset) && Number.isFinite(this.dateSessionBoundaryOffset) && sessionScan.sessionBoundaryOffset < this.dateSessionBoundaryOffset;
      if (olderBoundary) return false;
      return this.beginDateSession(sessionId, {
        logIdentity,
        boundaryOffset: sessionScan.sessionBoundaryOffset,
        logSize: sessionScan.logSize
      });
    }
    markLetterEffectCommandWritten(command) {
      if (command?.kind !== "letter_effect" || !["awaiting_ack", "acknowledged"].includes(command.status)) return false;
      const status = Array.from(this.letterStatuses.values()).find((entry) => entry.runCommandId === command.commandId);
      if (!status || status.responseStatus !== LetterResponseStatus.PENDING_DELIVERY) return false;
      const effectFileWrittenAt = Number(command.lastWrittenAt || command.writtenAt || command.acknowledgedAt) || Date.now();
      this.awaitingAcceptanceLetterId = status.letterId;
      this.updateLetterStatus(status.letterId, {
        responseStatus: LetterResponseStatus.EFFECT_FILE_WRITTEN,
        responseError: null,
        effectFileWrittenAt,
        runCommandStatus: command.status
      });
      this.transitionLetter(status.letterId, LetterPipelineState.EFFECT_FILE_WRITTEN, { effectTransportMode: status.effectTransportMode });
      this.savePendingLetters();
      return true;
    }
    processLogLine(line) {
      this.lastLogLineReceivedAt = Date.now();
      const receiptMatch = line.match(/VOTC:LETTER_RECEIPT\/;\/([A-Za-z0-9_.:-]+)\/;\/([a-f0-9]{32})\/;\/([A-Za-z0-9_.-]+)\/;\/(\d+)\/;\/(\d+)\/;\/(\d+)\/;\/([^\r\n]+)/);
      if (receiptMatch) return this.clearLettersFile({ letterId: receiptMatch[1], token: receiptMatch[2],
        campaignToken: receiptMatch[3], playerId: Number(receiptMatch[4]), aiId: Number(receiptMatch[5]),
        totalDays: Number(receiptMatch[6]), date: receiptMatch[7].trim() });
      if (line.includes("VOTC:LETTER/;/")) {
        return this.processLatestLetter({ skipPayloadRequest: true }).catch((error) => {
          console.error("Failed to receive letter log payload:", error);
          return null;
        });
      }
      const loadSessionMatch = line.match(/VOTC:LOAD_SESSION\/;\/([A-Za-z0-9_.-]+)/);
      if (loadSessionMatch) {
        const sessionScan = this.scanLatestDateMarker();
        if (sessionScan.sessionId === loadSessionMatch[1]) {
          this.beginDateSessionFromScan(loadSessionMatch[1], sessionScan);
        } else if (!sessionScan.sessionId && !this.dateSessionId) {
          this.beginDateSession(loadSessionMatch[1], {
            logIdentity: sessionScan.logIdentity || this.debugLogIdentity,
            boundaryOffset: null,
            logSize: sessionScan.logSize
          });
        }
      }
      const runAckMatch = line.match(/VOTC:RUN_ACK\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/);
      if (runAckMatch && runFileManager?.ackCommand) {
        const acknowledged = runFileManager.ackCommand(runAckMatch[2], runAckMatch[1]);
        this.markLetterEffectCommandWritten(acknowledged);
        this.markLetterEffectCommandWritten(runFileManager.getPendingCommands?.()[0]);
        if (acknowledged?.kind === "conversation_close") this.ensureDateProducerRunning("conversation_close_ack");
      }
      const producerMatch = line.match(/VOTC:DATE_PRODUCER\/(REARMED|BLOCKED)\/([A-Za-z0-9_-]+)/);
      if (producerMatch && this.dateProducerRecovery?.recoveryId === producerMatch[2]) {
        this.dateProducerRecovery = {
          ...this.dateProducerRecovery,
          executionResult: producerMatch[1],
          executionObservedAt: Date.now(),
          status: producerMatch[1] === "REARMED" ? "WAITING_FOR_FRESH_MARKER" : "BLOCKED_BY_TALK_SCENE"
        };
      }
      const transportMatch = line.match(/VOTC:LETTER_TRANSPORT\/([AB])\/([A-Za-z0-9_-]+)/);
      if (transportMatch) this.confirmDiagnosticExecutionMarker(transportMatch[1] === "A" ? "A1" : "A2", transportMatch[2]);
      const a3DiagnosticMatch = line.match(/VOTC:LETTER_DIAG\/A3\/(PRE|POST|SCOPE_OK)\/([A-Za-z0-9_-]+)/);
      if (a3DiagnosticMatch) this.confirmA3DiagnosticMarker(a3DiagnosticMatch[1], a3DiagnosticMatch[2]);
      const diagnosticMatch = line.match(/VOTC:LETTER_DIAG\/(B|C|D)\/([A-Za-z0-9_-]+)/);
      if (diagnosticMatch) this.confirmDiagnosticExecutionMarker(diagnosticMatch[1], diagnosticMatch[2]);
      const dateRegex = /VOTC:DATE\/;\/(\d+)/;
      const match = line.match(dateRegex);
      if (match) {
        const newTotalDays = Number(match[1]);
        const sessionScan = this.scanLatestDateMarker();
        if (sessionScan.sessionId) {
          this.beginDateSessionFromScan(sessionScan.sessionId, sessionScan);
        }
        if (this.dateSessionId) {
          const matchesBoundSession = sessionScan.sessionId === this.dateSessionId &&
            typeof sessionScan.logIdentity === "string" &&
            sessionScan.logIdentity === this.dateSessionLogIdentity &&
            Number.isFinite(sessionScan.sessionBoundaryOffset) &&
            sessionScan.sessionBoundaryOffset === this.dateSessionBoundaryOffset;
          if (!matchesBoundSession || !sessionScan.found || sessionScan.value !== newTotalDays) return Promise.resolve();
        }
        const observedAt = Date.now();
        const previousObservedValue = this.lastObservedDateValue;
        this.lastDateLogReceivedAt = observedAt;
        this.lastObservedDateMarkerAt = observedAt;
        this.lastObservedDateValue = newTotalDays;
        this.lastDateValue = newTotalDays;
        this.lastDateMarkerSource = "tail";
        if (previousObservedValue === null || previousObservedValue !== newTotalDays) {
          this.lastProgressDateValue = newTotalDays;
          this.lastProgressAt = observedAt;
          this.dateProducerState = "LIVE";
        } else {
          this.dateProducerState = "LIVE_NO_PROGRESS";
        }
        this.dateSourceState = this.tailState === "ACTIVE" ? "HEALTHY" : "TAIL_RESTARTING";
        if (this.dateProducerRecovery && observedAt >= this.dateProducerRecovery.requestedAt) {
          this.dateProducerRecovery = { ...this.dateProducerRecovery, status: "RECOVERED", recoveredAt: observedAt, freshDateValue: newTotalDays };
        }
        if (previousObservedValue !== newTotalDays) console.log(`LetterManager: VOTC:DATE received (${newTotalDays})`);
        return this.updateCurrentDate(newTotalDays);
      }
      return Promise.resolve();
    }
    handleReconciledRunCommands(commands, reason = "debug_log_reconciliation") {
      for (const command of commands || []) {
        if (command?.kind === "conversation_close") this.ensureDateProducerRunning(`${reason}_conversation_close_ack`);
      }
    }
    runCommandWatchdog() {
      if (!runFileManager?.isRecoveryCompleted?.()) return { reconciled: [], stalled: null };
      if (!runFileManager.getPendingCommands?.().length) return { reconciled: [], stalled: null };
      const debugLogPath = settingsRepository.getCK3DebugLogPath();
      const acknowledgements = scanRunAcksForPendingCommands(debugLogPath, { fs: fs$1, pendingCommands: runFileManager.getPendingCommands() });
      const reconciled = runFileManager.reconcileAcknowledgedCommands(acknowledgements);
      this.handleReconciledRunCommands(reconciled, "watchdog");
      const stalled = runFileManager.markActiveCommandStalledIfNeeded({ ackTimeoutMs: runCommandAckTimeoutMs });
      const active = runFileManager.getPendingCommands()[0];
      if (active && ["queued", "blocked"].includes(active.status) && Number(active.writeAttempts) === 0) runFileManager.writeActiveCommand();
      return { reconciled, stalled };
    }
    startRunCommandWatchdog() {
      if (this.runCommandWatchdogTimer) return;
      this.runCommandWatchdogTimer = setRunCommandIntervalFn(() => {
        try {
          this.runCommandWatchdog();
        } catch (error) {
          console.error("Run Command ACK watchdog failed:", error);
        }
      }, runCommandWatchdogIntervalMs);
      this.runCommandWatchdogTimer?.unref?.();
    }
    retryStalledRunCommand(commandId) {
      try {
        const command = runFileManager?.retryStalledCommand?.(String(commandId || ""));
        return command ? { success: true, command } : { success: false, error: "run_command_retry_failed" };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    retryBlockedRunCommand(commandId) {
      try {
        const command = runFileManager?.retryBlockedCommand?.(String(commandId || ""));
        return command ? { success: true, command } : { success: false, error: "run_command_retry_failed" };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    cancelBlockedRunCommand(commandId) {
      try {
        const normalizedId = String(commandId || "");
        const active = runFileManager?.findPendingCommand?.((command) => command.commandId === normalizedId);
        if (!active || active.status !== "blocked") return { success: false, error: "run_command_not_blocked" };
        const command = runFileManager.cancelCommand(normalizedId, "user_cancelled");
        return command ? { success: true, command } : { success: false, error: "run_command_cancel_failed" };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    cancelStalledRunCommand(commandId) {
      try {
        const command = runFileManager?.cancelStalledCommand?.(String(commandId || ""), "user_cancelled");
        return command ? { success: true, command } : { success: false, error: "run_command_cancel_failed" };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
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
      const identityChanged = this.debugLogIdentity && this.debugLogIdentity !== metadata.identity;
      const truncated = Number.isFinite(this.debugLogSize) && metadata.size < this.debugLogSize;
      if (identityChanged || truncated) this.resetDateSession();
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
        const stale = !this.lastObservedDateMarkerAt || Date.now() - this.lastObservedDateMarkerAt > dateStaleMs;
        if (forceReconcile || stale) {
          this.dateSourceState = "DATE_SOURCE_STALLED";
          this.dateProducerState = "STALLED";
          await this.reconcileLatestDateMarker(forceReconcile ? "manual" : "heartbeat");
          await this.ensureDateProducerRunning(forceReconcile ? "manual_resync" : "date_source_stalled");
        } else if (this.tailState === "ACTIVE") {
          this.dateSourceState = "HEALTHY";
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
      const logSize = Number(stat.size) || 0;
      const logMtimeMs = Number(stat.mtimeMs) || 0;
      const logIdentity = `${Number(stat.birthtimeMs) || 0}:${Number(stat.ino) || 0}`;
      const cache = this.dateSessionScanCache;
      if (cache && cache.logIdentity === logIdentity && cache.logSize === logSize && cache.logMtimeMs === logMtimeMs) {
        return { ...cache.result };
      }
      const bytesToRead = Math.min(logSize, dateScanBytes);
      if (bytesToRead <= 0) {
        const result = { found: false, value: null, reason: "empty_log", sessionId: null, sessionBoundaryOffset: null, previousSessionId: null, logIdentity, logSize, logMtimeMs };
        this.dateSessionScanCache = { logIdentity, logSize, logMtimeMs, result };
        return result;
      }
      const fileDescriptor = fs$1.openSync(debugLogPath, "r");
      let scanResult;
      try {
        const readRange = (start, length) => {
          const buffer = Buffer.alloc(length);
          let bytesRead = 0;
          while (bytesRead < length) {
            const count = fs$1.readSync(fileDescriptor, buffer, bytesRead, length - bytesRead, start + bytesRead);
            if (count <= 0) break;
            bytesRead += count;
          }
          return buffer.subarray(0, bytesRead).toString("utf8");
        };
        const tailStart = Math.max(0, logSize - bytesToRead);
        const tailText = readRange(tailStart, bytesToRead);
        const sessionState = { sessionId: null, boundaryOffset: null, previousSessionId: null };
        if (tailStart > 0) {
          let scanEnd = tailStart;
          let followingPrefix = tailText.slice(0, 256);
          const chunkBytes = Math.max(bytesToRead, 64 * 1024);
          while (scanEnd > 0) {
            const chunkStart = Math.max(0, scanEnd - chunkBytes);
            const chunkText = readRange(chunkStart, scanEnd - chunkStart);
            const combined = `${chunkText}${followingPrefix}`;
            const matches = [...combined.matchAll(/VOTC:LOAD_SESSION\/;\/([A-Za-z0-9_.-]+)/g)]
              .filter((match) => match.index < chunkText.length);
            for (let index = matches.length - 1; index >= 0; index--) {
              const match = matches[index];
              const markerOffset = chunkStart + Buffer.byteLength(combined.slice(0, match.index), "utf8");
              if (!sessionState.sessionId) {
                sessionState.sessionId = match[1];
                sessionState.boundaryOffset = markerOffset;
              } else {
                sessionState.previousSessionId = match[1];
                break;
              }
            }
            if (sessionState.previousSessionId) break;
            followingPrefix = chunkText.slice(0, 256);
            scanEnd = chunkStart;
          }
        }
        let sessionDate = null;
        let legacyDate = null;
        const events = [...tailText.matchAll(/VOTC:(?:LOAD_SESSION\/;\/([A-Za-z0-9_.-]+)|DATE\/;\/(\d+))/g)];
        for (const event of events) {
          if (event[1]) {
            const boundaryOffset = tailStart + Buffer.byteLength(tailText.slice(0, event.index), "utf8");
            if (boundaryOffset !== sessionState.boundaryOffset) {
              sessionState.previousSessionId = sessionState.sessionId;
              sessionState.sessionId = event[1];
              sessionState.boundaryOffset = boundaryOffset;
              sessionDate = null;
            }
          } else if (sessionState.sessionId) {
            sessionDate = Number(event[2]);
          } else {
            legacyDate = Number(event[2]);
          }
        }
        scanResult = sessionState.sessionId
          ? sessionDate === null
            ? { found: false, value: null, reason: "date_marker_missing", sessionId: sessionState.sessionId }
            : { found: true, value: sessionDate, reason: "tail_scan", sessionId: sessionState.sessionId }
          : legacyDate === null
            ? { found: false, value: null, reason: "date_marker_missing", sessionId: null }
            : { found: true, value: legacyDate, reason: "tail_scan", sessionId: null };
        scanResult = {
          ...scanResult,
          sessionBoundaryOffset: sessionState.boundaryOffset,
          previousSessionId: sessionState.previousSessionId,
          logIdentity,
          logSize,
          logMtimeMs
        };
      } finally {
        fs$1.closeSync(fileDescriptor);
      }
      this.dateSessionScanCache = { logIdentity, logSize, logMtimeMs, result: scanResult };
      return { ...scanResult };
    }
    async reconcileLatestDateMarker(source = "manual") {
      const scannedAt = Date.now();
      const currentMetadata = this.captureDebugLogMetadata();
      const sessionScan = this.scanLatestDateMarker();
      const scannedSessionId = sessionScan.sessionId || null;
      const scanLogIdentity = sessionScan.logIdentity || null;
      const scanBoundaryOffset = Number.isFinite(sessionScan.sessionBoundaryOffset) ? sessionScan.sessionBoundaryOffset : null;
      const scannedPreviousSessionId = sessionScan.previousSessionId || null;
      const scanLogSize = Number.isFinite(sessionScan.logSize) ? sessionScan.logSize : null;
      let { sessionId: _sessionId, sessionBoundaryOffset: _boundaryOffset, previousSessionId: _previousSessionId, logIdentity: _logIdentity, logSize: _logSize, logMtimeMs: _logMtimeMs, ...scan } = sessionScan;
      if (sessionScan.logIdentity && currentMetadata?.identity && sessionScan.logIdentity !== currentMetadata.identity) {
        scan = { found: false, value: null, reason: "log_identity_changed_during_scan" };
      } else {
        const sessionLogChanged = this.dateSessionId && this.dateSessionLogIdentity && scanLogIdentity !== this.dateSessionLogIdentity;
        const sessionLogTruncated = this.dateSessionId && Number.isFinite(this.dateSessionLogSize) && Number.isFinite(scanLogSize) && scanLogSize < this.dateSessionLogSize;
        if (sessionLogChanged || sessionLogTruncated) this.resetDateSession();
        if (scannedSessionId) {
          if (!this.dateSessionId) {
            this.beginDateSession(scannedSessionId, { logIdentity: scanLogIdentity, boundaryOffset: scanBoundaryOffset, logSize: scanLogSize });
          } else {
            const sameSessionLog = scanLogIdentity === this.dateSessionLogIdentity;
            const newerBoundary = sameSessionLog && Number.isFinite(scanBoundaryOffset) && Number.isFinite(this.dateSessionBoundaryOffset) && scanBoundaryOffset > this.dateSessionBoundaryOffset;
            const followsCurrentBoundary = sameSessionLog && scannedPreviousSessionId === this.dateSessionId && Number.isFinite(scanBoundaryOffset) && (!Number.isFinite(this.dateSessionBoundaryOffset) || scanBoundaryOffset > this.dateSessionBoundaryOffset);
            const sameBoundary = sameSessionLog && scannedSessionId === this.dateSessionId && scanBoundaryOffset === this.dateSessionBoundaryOffset;
            const olderBoundary = sameSessionLog && Number.isFinite(scanBoundaryOffset) && Number.isFinite(this.dateSessionBoundaryOffset) && scanBoundaryOffset < this.dateSessionBoundaryOffset;
            if (newerBoundary || followsCurrentBoundary) {
              this.beginDateSession(scannedSessionId, { logIdentity: scanLogIdentity, boundaryOffset: scanBoundaryOffset, logSize: scanLogSize });
            } else if (sameBoundary || (sameSessionLog && scannedSessionId === this.dateSessionId && this.dateSessionBoundaryOffset === null)) {
              this.beginDateSession(scannedSessionId, { logIdentity: scanLogIdentity, boundaryOffset: scanBoundaryOffset, logSize: scanLogSize });
            } else {
              scan = { found: false, value: null, reason: olderBoundary ? "date_session_stale_scan" : "date_session_mismatch" };
            }
          }
        } else if (this.dateSessionId) {
          scan = { found: false, value: null, reason: "date_session_missing" };
        }
      }
      this.lastDateReconciliationAt = scannedAt;
      this.lastDateScanResult = { ...scan, source, scannedAt };
      if (!scan.found) {
        this.dateSourceState = scan.reason === "log_file_missing" ? "LOG_FILE_MISSING" : "DATE_MARKER_MISSING";
        return this.getDateTrackerStatus();
      }
      this.lastDateValue = scan.value;
      this.lastDateMarkerSource = source;
      const hasRecentLiveMarker = this.lastObservedDateMarkerAt && scannedAt - this.lastObservedDateMarkerAt <= dateStaleMs;
      this.dateSourceState = this.tailState === "ACTIVE" && hasRecentLiveMarker ? "HEALTHY" : "DATE_SOURCE_STALLED";
      if (!hasRecentLiveMarker) this.dateProducerState = "STALLED";
      if (scan.value !== this.currentTotalDays) await this.updateCurrentDate(scan.value);
      else await this.checkAndDeliverLetters();
      return this.getDateTrackerStatus();
    }
    async resyncGameDate() {
      return this.runDateTrackerHeartbeat({ forceReconcile: true });
    }
    ensureDateProducerRunning(reason = "unspecified") {
      // The global native clock owns dates; never rebuild the retired event runner.
      this.dateProducerRecovery = { status: "NATIVE_BRIDGE_WAITING", reason, requestedAt: Date.now() };
      return this.getDateTrackerStatus();
    }
    isValidGameDay(value) {
      return Number.isFinite(value) && Number.isInteger(value) && value > 0;
    }
    getEffectiveDeliveryCurrentDay(deliveryTiming = null) {
      if (this.isValidGameDay(Number(this.currentTotalDays))) return Number(this.currentTotalDays);
      const deliveryBaseDay = Number(deliveryTiming?.deliveryBaseDay);
      return this.isValidGameDay(deliveryBaseDay) ? deliveryBaseDay : Number(this.currentTotalDays) || 0;
    }
    async resolveDeliveryTiming(letter) {
      const payloadGameDay = Number(letter.totalDays);
      const trackerGameDayAtCreation = this.isValidGameDay(Number(this.currentTotalDays)) ? Number(this.currentTotalDays) : null;
      const initialDateDelta = trackerGameDayAtCreation === null ? null : payloadGameDay - trackerGameDayAtCreation;
      const needsReconcile = trackerGameDayAtCreation === null || Math.abs(initialDateDelta) > 1;
      let reconciledGameDayAtCreation = null;
      if (needsReconcile) {
        const reconciliationStartedAt = Date.now();
        await this.runDateTrackerHeartbeat({ forceReconcile: true });
        const trackerStatus = this.getDateTrackerStatus();
        const reconciledDay = Number(this.currentTotalDays);
        if (this.isValidGameDay(reconciledDay) && trackerStatus.lastDateScanResult?.found === true && Number(trackerStatus.lastDateReconciliationAt) >= reconciliationStartedAt) {
          reconciledGameDayAtCreation = reconciledDay;
        }
      }
      const currentTrackerDay = this.isValidGameDay(Number(this.currentTotalDays)) ? Number(this.currentTotalDays) : null;
      const observedTrackerDay = reconciledGameDayAtCreation ?? trackerGameDayAtCreation ?? currentTrackerDay;
      const dateDelta = observedTrackerDay === null ? null : payloadGameDay - observedTrackerDay;
      const deliveryBaseDay = payloadGameDay;
      const dateSourceDecision = dateDelta === null ? "PAYLOAD_BOOTSTRAP" : Math.abs(dateDelta) <= 1 ? "PAYLOAD_ALIGNED" : "PAYLOAD_SEND_DAY_AUTHORITATIVE";
      const expectedDeliveryDay = deliveryBaseDay + Number(letter.delay);
      const dateSourceEvent = dateDelta !== null && Math.abs(dateDelta) <= 1 ? "DATE_ALIGNED" : dateDelta === null ? "DATE_TRACKER_UNAVAILABLE" : "DATE_SOURCE_DIVERGENCE";
      console.log(`[LetterDate] letter=${letter.letterId} event=${dateSourceEvent} payload=${payloadGameDay} tracker=${trackerGameDayAtCreation ?? "unavailable"} reconciled=${reconciledGameDayAtCreation ?? "unavailable"} base=${deliveryBaseDay} delta=${dateDelta ?? "unavailable"} decision=${dateSourceDecision}`);
      return {
        payloadGameDay,
        trackerGameDayAtCreation,
        reconciledGameDayAtCreation,
        deliveryBaseDay,
        dateDelta,
        dateSourceDecision,
        dateSourceEvent,
        expectedDeliveryDay
      };
    }
    getDateTrackerStatus() {
      return {
        tailState: this.tailState,
        tailStartedAt: this.tailStartedAt,
        lastLogLineReceivedAt: this.lastLogLineReceivedAt,
        lastDateLogReceivedAt: this.lastDateLogReceivedAt,
        lastDateValue: this.lastDateValue,
        lastObservedDateValue: this.lastObservedDateValue,
        lastObservedDateMarkerAt: this.lastObservedDateMarkerAt,
        lastProgressDateValue: this.lastProgressDateValue,
        lastProgressAt: this.lastProgressAt,
        lastDateMarkerSource: this.lastDateMarkerSource,
        debugLogPath: this.debugLogPath,
        debugLogExists: this.debugLogExists,
        debugLogSize: this.debugLogSize,
        debugLogMtime: this.debugLogMtime,
        dateSourceState: this.dateSourceState,
        dateProducerState: this.dateProducerState,
        markerAgeMs: this.lastObservedDateMarkerAt ? Math.max(0, Date.now() - this.lastObservedDateMarkerAt) : null,
        dateProducerRecovery: this.dateProducerRecovery ? { ...this.dateProducerRecovery } : null,
        runCommands: runFileManager?.getPendingCommands ? runFileManager.getPendingCommands().map(({ effectText, ...command }) => command) : [],
        runCommandHealth: runFileManager?.getQueueHealth ? runFileManager.getQueueHealth() : null,
        lastDateReconciliationAt: this.lastDateReconciliationAt,
        lastDateScanResult: this.lastDateScanResult ? { ...this.lastDateScanResult } : null
      };
    }
    /**
     * Check stored letters and deliver any that are ready
     */
    recoverUndispatchedAcceptanceLock() {
      const letterId = this.awaitingAcceptanceLetterId;
      const status = letterId ? this.getLetterStatus(letterId) : null;
      if (!status || status.responseStatus !== LetterResponseStatus.PENDING_DELIVERY || this.deliveryInProgress.has(letterId)) return;
      if (status.runCommandId || status.effectFileWrittenAt != null || status.effectTransportMode || status.effectFilePath) return;
      const history = status.pipelineHistory || [];
      if (!history.some(entry => entry.state === LetterPipelineState.PENDING_DELIVERY) || history.some(entry => [LetterPipelineState.DELIVERY_DUE, LetterPipelineState.EFFECT_FILE_WRITTEN, LetterPipelineState.DELIVERED].includes(entry.state))) return;
      if (!runFileManager?.isRecoveryCompleted?.() || runFileManager.stateLoadError || !runFileManager.getRecentCommands) return;
      const marker = `votc_${letterId}`;
      const commands = [...runFileManager.getPendingCommands(), ...runFileManager.getRecentCommands()];
      if (commands.some(command => command.kind === "letter_effect" && String(command.effectText || "").includes(marker))) return;
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      if (!ck3Folder) return;
      try {
        for (const carrier of ["votc.txt", "letters.txt"]) {
          const carrierPath = path.join(ck3Folder, "run", carrier);
          if (fs$1.existsSync(carrierPath) && fs$1.readFileSync(carrierPath, "utf8").includes(marker)) return;
        }
      } catch (error) {
        console.warn("LetterManager: Cannot verify orphan acceptance lock:", error);
        return;
      }
      this.awaitingAcceptanceLetterId = null;
      this.updateLetterStatus(letterId, { acceptanceLockRecoveredAt: Date.now() });
      this.savePendingLetters();
      console.log(`LetterManager: Released undispatched acceptance lock for ${letterId}`);
    }
    async checkAndDeliverLetters() {
      this.recoverUndispatchedAcceptanceLock();
      if (this.awaitingAcceptanceLetterId) return;
      for (const [letterId, storedLetter] of this.storedLetters.entries()) {
        if (this.getLetterStatus(letterId)?.responseStatus === LetterResponseStatus.SENT) {
          if (storedLetter.acceptedMemoryContext) {
            try {
              this.finalizeAcceptedLetterMemory(storedLetter, storedLetter.acceptedMemoryContext);
              this.storedLetters.delete(letterId);
              this.savePendingLetters();
            } catch (error) {
              console.warn(`LetterManager: Accepted memory capture remains pending (${error instanceof Error ? error.message : "unknown_error"})`);
            }
          } else if (storedLetter.acceptedMemoryAwaitingProof) {
            const result = await this.recordAcceptedLetterDisclosure(storedLetter);
            if (result?.archiveCaptured) {
              this.storedLetters.delete(letterId);
              this.savePendingLetters();
            }
          }
          continue;
        }
        if (!Number.isFinite(storedLetter.expectedDeliveryDay)) continue;
        const effectiveCurrentDay = this.getEffectiveDeliveryCurrentDay(storedLetter);
        if (effectiveCurrentDay >= storedLetter.expectedDeliveryDay && !this.deliveryInProgress.has(letterId)) {
          console.log(`Delivering letter ${letterId} (current: ${effectiveCurrentDay}, expected: ${storedLetter.expectedDeliveryDay})`);
          this.transitionLetter(letterId, LetterPipelineState.DELIVERY_DUE, { currentTotalDays: effectiveCurrentDay });
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
    async processLatestLetter(options = {}) {
      if (this.letterProcessing) return this.letterProcessing.then(
        () => this.processLatestLetter(options), () => this.processLatestLetter(options));
      this.letterProcessing = this.processLetterPayload(options);
      try {
        return await this.letterProcessing;
      } finally {
        this.letterProcessing = null;
      }
    }
    async processLetterPayload({ triggerContext = null, skipPayloadRequest = false, payloadErrorRecordId = null } = {}) {
      const triggerId = triggerContext?.triggerId || `letter-trigger:${Date.now()}:${++this.pipelineSequence}`;
      this.latestPipelineStatus = { triggerId, letterId: null, state: null, history: [], startedAt: triggerContext?.startedAt || Date.now(), payloadReread: skipPayloadRequest };
      this.transitionPipeline(LetterPipelineState.TRIGGER_RECEIVED);
      // The send event already emits the complete payload into debug.log.
      this.transitionPipeline(LetterPipelineState.CONTEXT_WAITING, { debugLogPath: settingsRepository.getCK3DebugLogPath?.() || null });
      const context = await this.loadLatestGameDataWithLetter();
      if (!context) {
        this.transitionPipeline(LetterPipelineState.CONTEXT_TIMEOUT, this.lastPayloadDiagnostics || {});
        if (this.lastInvalidLetterPayload) {
          let invalidStatus = payloadErrorRecordId ? this.getLetterStatus(payloadErrorRecordId) : null;
          if (invalidStatus) {
            this.updateLetterStatus(payloadErrorRecordId, {
              responseError: this.lastInvalidLetterPayload.errorCode,
              payloadErrorCode: this.lastInvalidLetterPayload.errorCode,
              payloadErrorDetails: this.lastInvalidLetterPayload.details,
              payloadRereadError: this.lastInvalidLetterPayload.errorCode
            });
            invalidStatus = this.getLetterStatus(payloadErrorRecordId);
          } else {
            invalidStatus = this.recordInvalidLetterPayload(this.lastInvalidLetterPayload);
          }
          if (this.lastInvalidLetterPayload.errorCode === "PAYLOAD_INCOMPLETE_TIMEOUT") {
            this.payloadRetryContexts.set(invalidStatus.letterId, {
              triggerId,
              startedAt: this.latestPipelineStatus.startedAt,
              debugLogPath: settingsRepository.getCK3DebugLogPath?.() || null
            });
          }
        }
        return null;
      }
      const { gameData, letter } = context;
      const pendingLetter = this.storedLetters.get(letter.letterId);
      if (pendingLetter || this.awaitingAcceptanceLetterId === letter.letterId) {
        const samePayload = pendingLetter && pendingLetter.letter.totalDays === letter.totalDays && pendingLetter.letter.delay === letter.delay && pendingLetter.letter.content === letter.content;
        console.warn(`LetterManager: Ignored ${samePayload ? "duplicate" : "conflicting"} payload for pending ${letter.letterId}`);
        if (samePayload) {
          const disclosureBinding = this.buildLetterDisclosureBinding(gameData, letter);
          if (disclosureBinding) await this.recordLetterDisclosure(gameData, letter, gameData.playerID, gameData.aiID, letter.content);
          this.attachPipelineToLetter(letter.letterId);
          this.latestPipelineStatus.state = this.getLetterStatus(letter.letterId)?.pipelineState || LetterPipelineState.PENDING_DELIVERY;
        }
        return samePayload ? pendingLetter.reply : null;
      }
      if (this.getLetterStatus(letter.letterId)?.responseStatus === LetterResponseStatus.GENERATING && this.failedLetterContexts.has(letter.letterId)) return null;
      const disclosureBinding = this.buildLetterDisclosureBinding(gameData, letter);
      if (disclosureBinding) await this.recordLetterDisclosure(gameData, letter, gameData.playerID, gameData.aiID, letter.content);
      const deliveryTiming = await this.resolveDeliveryTiming(letter);
      const characterName = gameData.getAi()?.fullName || "Unknown";
      this.createLetterStatus(letter, characterName, deliveryTiming);
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
      const sourceMemoryContext = this.buildLetterSourceMemoryContext(gameData, disclosureBinding);
      this.failedLetterContexts.set(letter.letterId, { letter, messages, characterName, promptMode, deliveryTiming, disclosureBinding, sourceMemoryContext });
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
      const expectedDeliveryDay = deliveryTiming.expectedDeliveryDay;
      const effectiveCurrentDay = this.getEffectiveDeliveryCurrentDay(deliveryTiming);
      const storedLetter = {
        letter,
        reply,
        expectedDeliveryDay,
        characterName,
        disclosureBinding,
        sourceMemoryContext,
        ...deliveryTiming
      };
      this.storedLetters.set(letter.letterId, storedLetter);
      this.failedLetterContexts.delete(letter.letterId);
      this.syncDateTrackerSupervisor();
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.PENDING_DELIVERY,
        expectedDeliveryDay,
        daysUntilDelivery: expectedDeliveryDay - effectiveCurrentDay,
        isLate: effectiveCurrentDay > expectedDeliveryDay,
        ...deliveryTiming
      });
      this.transitionPipeline(LetterPipelineState.PENDING_DELIVERY, { expectedDeliveryDay, ...deliveryTiming });
      this.savePendingLetters();
      console.log(`Letter ${letter.letterId} generated and stored. Will deliver on day ${expectedDeliveryDay} (current: ${effectiveCurrentDay})`);
      if (effectiveCurrentDay >= expectedDeliveryDay) {
        console.log(`Letter ${letter.letterId} is ready for immediate delivery`);
        await this.checkAndDeliverLetters();
      }
      if (!memoryEngine?.letterMemoryFinalization) await this.generateSummary(gameData, letter, reply);
      return reply;
    }
    buildLetterDisclosureBinding(gameData, letter) {
      const campaignToken = typeof gameData?.campaignToken === "string" ? gameData.campaignToken.trim() : "";
      const playerId = Number(gameData?.playerID);
      const aiId = Number(gameData?.aiID);
      const totalDays = Number(gameData?.totalDays);
      const sourceDate = normalizeGameDate(gameData?.date);
      if (!campaignToken || !sourceDate
        || !Number.isSafeInteger(playerId) || playerId <= 0 || !Number.isSafeInteger(aiId) || aiId <= 0 || playerId === aiId
        || !Number.isSafeInteger(totalDays) || totalDays < 0 || !Number.isSafeInteger(letter?.totalDays)
        || letter.totalDays > totalDays || !gameData.characters?.has?.(playerId) || !gameData.characters?.has?.(aiId)) return null;
      return { campaignToken, playerId, aiId, sourceDate: sourceDate.canonical, sourceTotalDays: totalDays };
    }
    buildLetterSourceMemoryContext(gameData, binding) {
      if (!binding) return null;
      const { buildCurrentMemory4RelationshipEvidence } = require("../memory-system/memory4-entity-context");
      const pair = [binding.playerId, binding.aiId];
      return {
        participantProfiles: pair.map(id => {
          const character = gameData.characters.get(id);
          return { id, name: character?.name, shortName: character?.shortName,
            firstName: character?.firstName, fullName: character?.fullName };
        }),
        relationshipEvidence: buildCurrentMemory4RelationshipEvidence({ gameData, ownerIds: pair, entityIds: pair })
      };
    }
    validateLetterReceipt(storedLetter, receipt) {
      const binding = storedLetter?.disclosureBinding;
      const date = normalizeGameDate(receipt?.date);
      const sourceDate = normalizeGameDate(binding?.sourceDate);
      return !!(binding && date && sourceDate && date.serial >= sourceDate.serial
        && receipt.letterId === storedLetter.letter.letterId && receipt.token === storedLetter.receiptToken
        && receipt.campaignToken === binding.campaignToken && receipt.playerId === binding.playerId
        && receipt.aiId === binding.aiId && Number.isSafeInteger(receipt.totalDays)
        && receipt.totalDays >= storedLetter.expectedDeliveryDay && receipt.totalDays >= binding.sourceTotalDays);
    }
    async recordLetterDisclosure(gameData, letter, senderId, recipientId, text) {
      const coordinator = memoryEngine?.memory4;
      if (typeof coordinator?.recordLetterDisclosures !== "function") return null;
      const binding = this.buildLetterDisclosureBinding(gameData, letter);
      const sender = Number(senderId);
      const recipient = Number(recipientId);
      const isPlayerNpcExchange = sender === binding?.playerId && recipient === binding?.aiId
        || sender === binding?.aiId && recipient === binding?.playerId;
      if (!binding || !isPlayerNpcExchange) return null;
      try {
        return await coordinator.recordLetterDisclosures({
          campaignToken: binding.campaignToken,
          date: gameData.date,
          ownerId: recipient,
          senderId: sender,
          recipientId: recipient,
          letterId: letter.letterId,
          text,
          characters: gameData.characters
        });
      } catch (error) {
        console.warn(`LetterManager: Memory4 letter disclosure skipped (${error instanceof Error ? error.message : "unknown_error"})`);
        return null;
      }
    }
    async recordAcceptedLetterDisclosure(storedLetter) {
      const binding = storedLetter?.disclosureBinding;
      const receipt = storedLetter?.acceptedReceipt;
      if (this.validateLetterReceipt(storedLetter, receipt) && storedLetter.sourceMemoryContext
        && memoryEngine?.letterMemoryFinalization) {
        storedLetter.acceptedMemoryContext = { ...storedLetter.sourceMemoryContext,
          campaignToken: binding.campaignToken, letterId: storedLetter.letter.letterId,
          senderId: binding.playerId, recipientId: binding.aiId, sourceDate: binding.sourceDate,
          acceptedDate: normalizeGameDate(receipt.date).canonical, sourceTotalDays: binding.sourceTotalDays,
          acceptedTotalDays: receipt.totalDays, text: storedLetter.letter.content, reply: storedLetter.reply };
        this.savePendingLetters();
        this.finalizeAcceptedLetterMemory(storedLetter, storedLetter.acceptedMemoryContext);
        try {
          const current = await parseLog(settingsRepository.getCK3DebugLogPath());
          if (current?.campaignToken === binding.campaignToken && current.playerID === binding.playerId
            && current.aiID === binding.aiId && current.totalDays === receipt.totalDays) {
            await this.recordLetterDisclosure(current, storedLetter.letter, binding.aiId, binding.playerId, storedLetter.reply);
          }
        } catch { /* The durable archive uses the validated source snapshot, not a later dialogue. */ }
        return { archiveCaptured: true };
      }
      const debugLogPath = settingsRepository.getCK3DebugLogPath();
      if (!binding || !debugLogPath) return null;
      try {
        const gameData = await parseLog(debugLogPath);
        const validation = this.validateLetterPayload(gameData?.letterData);
        const currentBinding = this.buildLetterDisclosureBinding(gameData, validation.valid ? validation.letter : null);
        const sourceDate = normalizeGameDate(binding.sourceDate);
        const acceptedDate = normalizeGameDate(gameData?.date);
        if (!currentBinding || !validation.valid || currentBinding.campaignToken !== binding.campaignToken
          || currentBinding.playerId !== binding.playerId || currentBinding.aiId !== binding.aiId
          || !sourceDate || !acceptedDate || acceptedDate.serial < sourceDate.serial
          || validation.letter.letterId !== storedLetter.letter.letterId
          || validation.letter.content !== storedLetter.letter.content
          || validation.letter.totalDays !== storedLetter.letter.totalDays || validation.letter.delay !== storedLetter.letter.delay
          || currentBinding.sourceTotalDays < Number(storedLetter.expectedDeliveryDay)
          || currentBinding.sourceTotalDays < binding.sourceTotalDays) return null;
        const archive = memoryEngine?.letterMemoryFinalization;
        if (archive) {
          const { buildCurrentMemory4RelationshipEvidence } = require("../memory-system/memory4-entity-context");
          const participantProfiles = [binding.playerId, binding.aiId].map(id => {
            const character = gameData.characters.get(id);
            return { id, name: character?.name, shortName: character?.shortName, firstName: character?.firstName, fullName: character?.fullName };
          });
          storedLetter.acceptedMemoryContext = { campaignToken: binding.campaignToken, letterId: storedLetter.letter.letterId,
            senderId: binding.playerId, recipientId: binding.aiId, sourceDate: binding.sourceDate, acceptedDate: acceptedDate.canonical,
            sourceTotalDays: binding.sourceTotalDays, acceptedTotalDays: currentBinding.sourceTotalDays,
            text: storedLetter.letter.content, reply: storedLetter.reply, participantProfiles,
            relationshipEvidence: buildCurrentMemory4RelationshipEvidence({ gameData, ownerIds: [binding.playerId, binding.aiId],
              entityIds: [binding.playerId, binding.aiId] }) };
          this.savePendingLetters();
          this.finalizeAcceptedLetterMemory(storedLetter, storedLetter.acceptedMemoryContext);
        }
        const disclosure = await this.recordLetterDisclosure(gameData, validation.letter, currentBinding.aiId, currentBinding.playerId, storedLetter.reply);
        return archive ? { disclosure, archiveCaptured: true } : disclosure;
      } catch (error) {
        console.warn(`LetterManager: Accepted letter disclosure skipped (${error instanceof Error ? error.message : "unknown_error"})`);
        if (storedLetter.acceptedMemoryContext) {
          this.updateLetterStatus(storedLetter.letter.letterId, { summaryStatus: LetterSummaryStatus.SAVE_FAILED,
            summaryError: error instanceof Error ? error.message : "letter_memory_capture_failed" });
          this.savePendingLetters();
          throw error;
        }
        return null;
      }
    }
    finalizeAcceptedLetterMemory(storedLetter, context) {
      const archive = memoryEngine?.letterMemoryFinalization;
      const job = archive.captureAccepted(context);
      const letterId = storedLetter.letter.letterId;
      this.updateLetterStatus(letterId, { summaryStatus: LetterSummaryStatus.GENERATING, summaryError: null });
      void archive.finalize(job).then(result => {
        this.updateLetterStatus(letterId, { summaryStatus: result.status === "COMPLETE" ? LetterSummaryStatus.SAVED : LetterSummaryStatus.GENERATION_FAILED,
          summaryError: result.status === "COMPLETE" ? null : result.errorCode || "letter_memory_finalization_pending" });
      }).catch(error => {
        this.updateLetterStatus(letterId, { summaryStatus: LetterSummaryStatus.GENERATION_FAILED,
          summaryError: error instanceof Error ? error.message : "letter_memory_finalization_failed" });
      });
    }
    validateLetterPayload(letter) {
      const rawTotalDays = letter?.totalDays;
      const rawDelay = letter?.delay;
      const parsedTotalDays = Number(rawTotalDays);
      const parsedDelay = Number(rawDelay);
      const details = {
        letterId: typeof letter?.letterId === "string" ? letter.letterId : null,
        rawTotalDays,
        rawDelay,
        parsedTotalDays,
        parsedDelay,
        expectedDeliveryDay: parsedTotalDays + parsedDelay
      };
      if (typeof letter?.letterId !== "string" || !letter.letterId.trim() || typeof letter?.content !== "string" || !letter.content.trim()) {
        return { valid: false, errorCode: "INVALID_LETTER_PAYLOAD", details };
      }
      const numericTypesValid = [rawTotalDays, rawDelay].every((value) => typeof value === "number" || typeof value === "string");
      const missingNumeric = rawTotalDays === null || rawTotalDays === void 0 || rawDelay === null || rawDelay === void 0 || typeof rawTotalDays === "string" && rawTotalDays.trim() === "" || typeof rawDelay === "string" && rawDelay.trim() === "";
      const expectedDeliveryDay = parsedTotalDays + parsedDelay;
      const numericValid = numericTypesValid && !missingNumeric && Number.isFinite(parsedTotalDays) && Number.isInteger(parsedTotalDays) && parsedTotalDays >= 0 && Number.isFinite(parsedDelay) && Number.isInteger(parsedDelay) && parsedDelay >= 0 && Number.isFinite(expectedDeliveryDay) && Number.isInteger(expectedDeliveryDay);
      if (!numericValid) return { valid: false, errorCode: "INVALID_LETTER_PAYLOAD_NUMERIC", details };
      return { valid: true, letter: { ...letter, letterId: letter.letterId.trim(), totalDays: parsedTotalDays, delay: parsedDelay }, details };
    }
    recordInvalidLetterPayload(invalidPayload, legacy = false) {
      const rawLetter = invalidPayload?.letter || {};
      const useErrorRecordId = invalidPayload?.errorCode === "PAYLOAD_INCOMPLETE_TIMEOUT";
      const letterId = !useErrorRecordId && typeof rawLetter.letterId === "string" && rawLetter.letterId.trim() ? rawLetter.letterId.trim() : `invalid_payload_${Date.now()}_${++this.pipelineSequence}`;
      const responseStatus = legacy ? LetterResponseStatus.LEGACY_INVALID_PENDING : LetterResponseStatus.PAYLOAD_INVALID;
      const status = {
        letterId,
        letterContent: typeof rawLetter.content === "string" ? rawLetter.content : "",
        responseContent: null,
        responseStatus,
        responseError: invalidPayload.errorCode,
        payloadErrorCode: invalidPayload.errorCode,
        payloadErrorDetails: invalidPayload.details,
        summaryStatus: LetterSummaryStatus.NOT_STARTED,
        summaryContent: null,
        summaryError: null,
        createdAt: Date.now(),
        currentDay: this.currentTotalDays,
        characterName: invalidPayload.characterName || "Unknown",
        pipelineState: LetterPipelineState.PAYLOAD_INVALID,
        pipelineHistory: [...(this.latestPipelineStatus?.history || []), { state: LetterPipelineState.PAYLOAD_INVALID, timestamp: Date.now() }]
      };
      this.letterStatuses.set(letterId, status);
      this.attachPipelineToLetter(letterId);
      this.transitionPipeline(LetterPipelineState.PAYLOAD_INVALID, { payloadErrorCode: invalidPayload.errorCode, payloadErrorDetails: invalidPayload.details });
      return status;
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
      const validation = this.validateLetterPayload(context.letter);
      if (!validation.valid) {
        this.failedLetterContexts.delete(normalizedLetterId);
        this.recordInvalidLetterPayload({ letter: context.letter, errorCode: validation.errorCode, details: validation.details, characterName: context.characterName });
        this.savePendingLetters();
        return { success: false, letterId: normalizedLetterId, error: validation.errorCode };
      }
      context.letter = validation.letter;
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
        const deliveryTiming = context.deliveryTiming || await this.resolveDeliveryTiming(context.letter);
        const expectedDeliveryDay = deliveryTiming.expectedDeliveryDay;
        const effectiveCurrentDay = this.getEffectiveDeliveryCurrentDay(deliveryTiming);
        const storedLetter = { letter: context.letter, reply, expectedDeliveryDay, characterName: context.characterName,
          disclosureBinding: context.disclosureBinding || null, sourceMemoryContext: context.sourceMemoryContext || null, ...deliveryTiming };
        this.storedLetters.set(normalizedLetterId, storedLetter);
        this.failedLetterContexts.delete(normalizedLetterId);
        this.updateLetterStatus(normalizedLetterId, {
          responseStatus: LetterResponseStatus.PENDING_DELIVERY,
          responseContent: reply,
          responseError: null,
          responseErrorDetails: null,
          expectedDeliveryDay,
          daysUntilDelivery: expectedDeliveryDay - effectiveCurrentDay,
          isLate: effectiveCurrentDay > expectedDeliveryDay,
          ...deliveryTiming
        });
        this.transitionLetter(normalizedLetterId, LetterPipelineState.PENDING_DELIVERY, { expectedDeliveryDay, retryAttemptCount, ...deliveryTiming });
        this.savePendingLetters();
        if (effectiveCurrentDay >= expectedDeliveryDay) await this.checkAndDeliverLetters();
        if (!memoryEngine?.letterMemoryFinalization) {
          const latestContext = await this.loadLatestGameDataWithLetter();
          if (latestContext?.letter?.letterId === normalizedLetterId) await this.generateSummary(latestContext.gameData, context.letter, reply);
          else this.updateLetterStatus(normalizedLetterId, { summaryStatus: LetterSummaryStatus.GENERATION_FAILED, summaryError: "Retry succeeded, but matching letter context was unavailable for summary." });
        }
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
      let lastRawLetter = null;
      let lastValidation = null;
      const attempts = [];
      this.lastInvalidLetterPayload = null;
      for (let index = 0; index <= letterPayloadRetryDelays.length; index++) {
        if (index > 0) await sleep(letterPayloadRetryDelays[index - 1]);
        attemptCount++;
        const timestamp = Date.now();
        try {
          const gameData = await parseLog(debugLogPath);
          if (!gameData) {
            lastParseResult = "game_data_missing";
            attempts.push(this.buildPayloadAttemptDiagnostic(attemptCount, timestamp, null, "game_data_missing"));
            continue;
          }
          const rawLetter = gameData.letterData;
          if (!rawLetter) {
            lastParseResult = "letter_payload_missing";
            attempts.push(this.buildPayloadAttemptDiagnostic(attemptCount, timestamp, null, "letter_payload_missing"));
            continue;
          }
          lastRawLetter = rawLetter;
          const validation = this.validateLetterPayload(rawLetter);
          lastValidation = validation;
          attempts.push(this.buildPayloadAttemptDiagnostic(attemptCount, timestamp, rawLetter, validation.valid ? null : validation.errorCode));
          if (!validation.valid) {
            lastParseResult = validation.errorCode;
            continue;
          }
          const letter = validation.letter;
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
            summaryLoadError,
            attempts
          };
          return { gameData, letter };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          lastParseResult = "parse_failed";
          attempts.push(this.buildPayloadAttemptDiagnostic(attemptCount, timestamp, null, "parse_failed"));
        }
      }
      const incompletePayload = !lastRawLetter || typeof lastRawLetter.letterId !== "string" || !lastRawLetter.letterId.trim() || lastRawLetter.content === null || lastRawLetter.content === void 0 || typeof lastRawLetter.content === "string" && !lastRawLetter.content.trim();
      const errorCode = incompletePayload ? "PAYLOAD_INCOMPLETE_TIMEOUT" : lastValidation?.errorCode || "PAYLOAD_INCOMPLETE_TIMEOUT";
      this.lastPayloadDiagnostics = { attemptCount, elapsedMs: Date.now() - startedAt, debugLogPath, lastParseResult: errorCode, lastError, attempts };
      this.lastInvalidLetterPayload = {
        letter: lastRawLetter || {},
        errorCode,
        details: { ...(lastValidation?.details || {}), attempts },
        characterName: "Unknown"
      };
      console.warn(`No letter data found after ${attemptCount} parse attempts (${this.lastPayloadDiagnostics.elapsedMs}ms).`);
      return null;
    }
    buildPayloadAttemptDiagnostic(attempt, timestamp, rawLetter, validationError) {
      const content = rawLetter?.content;
      return {
        attempt,
        timestamp,
        payloadExists: Boolean(rawLetter),
        letterIdPresent: typeof rawLetter?.letterId === "string" && Boolean(rawLetter.letterId.trim()),
        letterIdValue: typeof rawLetter?.letterId === "string" ? rawLetter.letterId.slice(0, 120) : null,
        contentType: content === null ? "null" : Array.isArray(content) ? "array" : typeof content,
        contentLength: typeof content === "string" ? content.length : null,
        contentPreview: typeof content === "string" ? Array.from(content).slice(0, 40).join("") : null,
        totalDaysRaw: rawLetter?.totalDays,
        delayRaw: rawLetter?.delay,
        validationError
      };
    }
    async retryIncompletePayload(errorRecordId) {
      const normalizedRecordId = typeof errorRecordId === "string" ? errorRecordId.trim() : "";
      const status = this.getLetterStatus(normalizedRecordId);
      if (!status || status.payloadErrorCode !== "PAYLOAD_INCOMPLETE_TIMEOUT") return { success: false, error: "Only PAYLOAD_INCOMPLETE_TIMEOUT records can be reread." };
      const triggerContext = this.payloadRetryContexts.get(normalizedRecordId);
      if (!triggerContext) return { success: false, error: "The original trigger context is unavailable." };
      if (this.payloadRetryInProgress.has(normalizedRecordId)) return { success: false, error: "This payload reread is already in progress." };
      this.payloadRetryInProgress.add(normalizedRecordId);
      this.updateLetterStatus(normalizedRecordId, { payloadRereadInProgress: true, payloadRereadError: null, payloadRereadAttemptedAt: Date.now() });
      try {
        await this.processLatestLetter({ triggerContext, skipPayloadRequest: true, payloadErrorRecordId: normalizedRecordId });
        const rereadLetterId = this.latestPipelineStatus?.triggerId === triggerContext.triggerId ? this.latestPipelineStatus.letterId : null;
        const success = Boolean(rereadLetterId);
        this.updateLetterStatus(normalizedRecordId, {
          payloadRereadInProgress: false,
          payloadRereadResolvedAt: success ? Date.now() : null,
          payloadRereadLetterId: rereadLetterId,
          payloadRereadError: success ? null : this.lastPayloadDiagnostics?.lastParseResult || "PAYLOAD_INCOMPLETE_TIMEOUT"
        });
        if (success) this.payloadRetryContexts.delete(normalizedRecordId);
        return { success, errorRecordId: normalizedRecordId, letterId: rereadLetterId, error: success ? null : this.lastPayloadDiagnostics?.lastParseResult || "PAYLOAD_INCOMPLETE_TIMEOUT" };
      } finally {
        this.payloadRetryInProgress.delete(normalizedRecordId);
        this.updateLetterStatus(normalizedRecordId, { payloadRereadInProgress: false });
      }
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
      const campaignToken = typeof gameData.campaignToken === "string" && gameData.campaignToken.trim() ? gameData.campaignToken.trim() : null;
      const campaignBinding = campaignToken
        ? { status: "bound", source: "native", version: 1 }
        : { status: "unresolved", reason: "CAMPAIGN_TOKEN_UNAVAILABLE", version: 1 };
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
          content: summary.trim(),
          campaignToken,
          campaignBinding
        });
        memoryEngine.recordLetterMemory({
          senderId: gameData.playerID,
          recipientId: ai.id,
          content: summary.trim(),
          date: gameData.date,
          totalDays: gameData.totalDays,
          letterId: letter.letterId,
          campaignToken,
          campaignBinding
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
      const storedLetter = this.storedLetters.get(letter.letterId);
      if (memoryEngine?.letterMemoryFinalization && storedLetter?.sourceMemoryContext && storedLetter.disclosureBinding) {
        storedLetter.receiptToken ||= randomBytes(16).toString("hex");
        this.savePendingLetters();
      }
      const gameCommand = this.buildOfficialLetterEffectBody(reply, letter);
      const outboundMode = letterEffectTransport.getOutboundMode();
      const writeResult = letterEffectTransport.writeOutboundLetterEffect(gameCommand, outboundMode);
      if (writeResult.success) {
        this.awaitingAcceptanceLetterId = letter.letterId;
        this.updateLetterStatus(letter.letterId, {
          responseStatus: writeResult.commandStatus && writeResult.commandStatus !== "awaiting_ack" ? LetterResponseStatus.PENDING_DELIVERY : LetterResponseStatus.EFFECT_FILE_WRITTEN,
          responseError: null,
          effectFileWrittenAt: writeResult.commandStatus && writeResult.commandStatus !== "awaiting_ack" ? null : Date.now(),
          effectTransportMode: outboundMode,
          effectFilePath: writeResult.effectFilePath,
          runCommandId: writeResult.commandId || null,
          runCommandStatus: writeResult.commandStatus || null
        });
        const isQueued = writeResult.commandStatus && writeResult.commandStatus !== "awaiting_ack";
        this.transitionLetter(letter.letterId, isQueued ? LetterPipelineState.DELIVERY_DUE : LetterPipelineState.EFFECT_FILE_WRITTEN, { effectTransportMode: outboundMode, runCommandStatus: writeResult.commandStatus || null });
        this.savePendingLetters();
        return true;
      }
      const errorMessage = `Failed to write letter effect: ${writeResult.error || "Unknown error"}`;
      console.error(`LetterManager.writeLetterEffect: ${errorMessage}`);
      this.updateLetterStatus(letter.letterId, {
        responseStatus: LetterResponseStatus.SEND_FAILED,
        responseError: errorMessage
      });
      this.transitionLetter(letter.letterId, LetterPipelineState.DELIVERY_FAILED, { deliveryError: errorMessage });
      return false;
    }
    buildOfficialLetterEffectBody(reply, letter) {
      const artifactBody = this.buildLetterArtifactBody({
        creatorScope: `global_var:message_second_scope_${letter.letterId}`,
        name: `votc_huixin_title${letter.letterId.replace(/letter_/, "")}`,
        description: reply,
        saveScopeAs: "votc_latest_letter"
      });
      const storedLetter = this.storedLetters.get(letter.letterId);
      const campaignExpression = "votc8c-" + Array.from({ length: 12 }, (_, index) =>
        `[GetGlobalVariable('votc_campaign_digit_${String(index + 1).padStart(2, "0")}').GetFlagName]`).join("");
      const receiptEffect = storedLetter?.receiptToken ? `
if = {
  limit = { exists = scope:votc_latest_letter }
  debug_log = "VOTC:LETTER_RECEIPT/;/${letter.letterId}/;/${storedLetter.receiptToken}/;/${campaignExpression}/;/[GetPlayer.GetID]/;/[GetGlobalVariable('message_second_scope_${letter.letterId}').GetCharacter.GetID]/;/[GetCurrentDate.GetDateAsTotalDays]/;/[GetCurrentDate.GetStringShort]"
}` : "";
      return `debug_log = "[Localize('talk_event.9999.desc')]"
remove_global_variable ?= votc_${letter.letterId}
${artifactBody}
scope:votc_latest_letter = {
set_variable = { name = votc_letter_artifact value = yes}
}
set_global_variable = {
	name = votc_latest_letter
	value = scope:votc_latest_letter
}
trigger_event = message_event.362${receiptEffect}`;
    }
    buildLetterArtifactBody({ creatorScope, name, description, saveScopeAs }) {
      const escapedDescription = String(description).replace(/"/g, '\\"');
      return `create_artifact = {
	name = ${name}
	description = "${escapedDescription}"
	type = journal
${"  \t"}visuals = scroll
${"  \t"}creator = ${creatorScope}
${"  \t"}modifier = artifact_monthly_minor_prestige_1_modifier
	wealth = scope:wealth
	save_scope_as = ${saveScopeAs}
}`;
    }
    loadPendingLetters() {
      if (!this.pendingLettersFile || !fs$1.existsSync(this.pendingLettersFile)) return;
      try {
        const state = JSON.parse(fs$1.readFileSync(this.pendingLettersFile, "utf8"));
        const quarantined = [];
        this.awaitingAcceptanceLetterId = typeof state?.awaitingAcceptanceLetterId === "string" ? state.awaitingAcceptanceLetterId : null;
        for (const storedLetter of Array.isArray(state?.letters) ? state.letters : []) {
          const letterId = storedLetter?.letter?.letterId;
          const validation = this.validateLetterPayload(storedLetter?.letter);
          const rawExpectedDeliveryDay = storedLetter?.expectedDeliveryDay;
          const expectedDeliveryDay = Number(rawExpectedDeliveryDay);
          const expectedValid = rawExpectedDeliveryDay !== null && rawExpectedDeliveryDay !== void 0 && !(typeof rawExpectedDeliveryDay === "string" && rawExpectedDeliveryDay.trim() === "") && Number.isFinite(expectedDeliveryDay) && Number.isInteger(expectedDeliveryDay) && expectedDeliveryDay >= 0;
          if (!letterId || typeof storedLetter.reply !== "string" || !validation.valid || !expectedValid) {
            const invalid = { letter: storedLetter?.letter || {}, errorCode: "LEGACY_INVALID_PENDING", details: { ...(validation.details || {}), rawExpectedDeliveryDay, parsedExpectedDeliveryDay: expectedDeliveryDay }, characterName: storedLetter?.characterName || "Unknown" };
            quarantined.push({ ...storedLetter, quarantineReason: invalid.errorCode, quarantinedAt: Date.now() });
            this.recordInvalidLetterPayload(invalid, true);
            continue;
          }
          const normalizedStoredLetter = { ...storedLetter, letter: validation.letter, expectedDeliveryDay };
          this.storedLetters.set(letterId, normalizedStoredLetter);
          if (storedLetter.status) {
            this.letterStatuses.set(letterId, { ...storedLetter.status, expectedDeliveryDay });
          } else {
            this.createLetterStatus(validation.letter, storedLetter.characterName || "Unknown");
            this.updateLetterStatus(letterId, {
              responseContent: storedLetter.reply,
              responseStatus: LetterResponseStatus.PENDING_DELIVERY,
              summaryStatus: LetterSummaryStatus.SAVED,
              expectedDeliveryDay
            });
          }
        }
        for (const failedContext of Array.isArray(state?.failedLetters) ? state.failedLetters : []) {
          const letterId = failedContext?.letter?.letterId;
          const validation = this.validateLetterPayload(failedContext?.letter);
          if (!letterId || !Array.isArray(failedContext.messages) || this.storedLetters.has(letterId) || !validation.valid) {
            if (failedContext?.letter && !validation.valid) quarantined.push({ ...failedContext, quarantineReason: validation.errorCode, quarantinedAt: Date.now() });
            continue;
          }
          this.failedLetterContexts.set(letterId, {
            letter: validation.letter,
            messages: failedContext.messages,
            characterName: failedContext.characterName || "Unknown",
            promptMode: failedContext.promptMode || "official_votc_2.0.3",
            disclosureBinding: failedContext.disclosureBinding || null,
            sourceMemoryContext: failedContext.sourceMemoryContext || null
          });
          if (failedContext.status) this.letterStatuses.set(letterId, failedContext.status);
          else {
            this.createLetterStatus(failedContext.letter, failedContext.characterName || "Unknown");
            this.updateLetterStatus(letterId, { responseStatus: LetterResponseStatus.GENERATION_FAILED, responseError: "Previous reply generation failed.", retryAttemptCount: 0 });
          }
        }
        if (this.awaitingAcceptanceLetterId && !this.storedLetters.has(this.awaitingAcceptanceLetterId)) this.awaitingAcceptanceLetterId = null;
        if (quarantined.length > 0) {
          this.writeInvalidPendingQuarantine(quarantined);
          this.savePendingLetters();
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
        fs$1.writeFileSync(this.pendingLettersFile, JSON.stringify({ version: 4, awaitingAcceptanceLetterId: this.awaitingAcceptanceLetterId, letters, failedLetters }, null, 2), "utf8");
        this.syncDateTrackerSupervisor();
      } catch (error) {
        console.error("LetterManager: Failed to save pending letters:", error);
      }
    }
    /**
     * Clear the letters.txt file
     */
    async clearLettersFile(receipt = null) {
      const pending = this.letterAcceptanceTransition.then(() => this.clearLettersFileNow(receipt));
      this.letterAcceptanceTransition = pending.catch(() => {});
      return pending;
    }
    async clearLettersFileNow(receipt) {
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      console.log(`LetterManager.clearLettersFile: CK3 user path: ${ck3Folder}`);
      if (!ck3Folder) {
        console.warn("LetterManager.clearLettersFile: CK3 user folder is not configured; cannot clear letters file.");
        return;
      }
      const acceptedLetterId = this.awaitingAcceptanceLetterId;
      const acceptedStatus = acceptedLetterId ? this.getLetterStatus(acceptedLetterId) : null;
      const acceptedLetter = acceptedLetterId ? this.storedLetters.get(acceptedLetterId) : null;
      const acceptedEffectWritten = acceptedStatus?.responseStatus === LetterResponseStatus.EFFECT_FILE_WRITTEN
        && Number.isFinite(Number(acceptedStatus.effectFileWrittenAt)) && Number(acceptedStatus.effectFileWrittenAt) > 0;
      if (!acceptedEffectWritten || !acceptedLetter) {
        console.warn("LetterManager.clearLettersFile: Ignoring LETTER_ACCEPTED without a matching written Letter Effect.");
        return { success: false, reason: "letter_effect_not_written", letterId: acceptedLetterId };
      }
      if (acceptedLetter.receiptToken && !this.validateLetterReceipt(acceptedLetter, receipt)) {
        return { success: false, reason: "letter_receipt_not_matched", letterId: acceptedLetterId };
      }
      if (receipt) acceptedLetter.acceptedReceipt = receipt;
      const acceptedTransportMode = acceptedStatus?.effectTransportMode || LetterEffectTransportMode.VOTC;
      const clearResult = letterEffectTransport.clearOutboundEffect(acceptedTransportMode);
      if (!clearResult.success) console.warn(`LetterManager.clearLettersFile: ${clearResult.error}`);
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
        acceptedLetter.acceptedMemoryAwaitingProof = true;
        this.savePendingLetters();
        const memoryAccepted = acceptedEffectWritten && acceptedLetter ? await this.recordAcceptedLetterDisclosure(acceptedLetter) : null;
        if (memoryEngine?.letterMemoryFinalization && !memoryAccepted?.archiveCaptured) {
          acceptedLetter.acceptedMemoryAwaitingProof = true;
          this.updateLetterStatus(acceptedLetterId, { summaryStatus: LetterSummaryStatus.SAVE_FAILED, summaryError: "letter_memory_acceptance_proof_unavailable" });
        } else this.storedLetters.delete(acceptedLetterId);
        this.savePendingLetters();
      }
      this.syncDateTrackerSupervisor();
      await this.checkAndDeliverLetters();
    }
    clearPendingLetters() {
      const pendingIds = new Set(this.storedLetters.keys());
      if (this.awaitingAcceptanceLetterId) pendingIds.add(this.awaitingAcceptanceLetterId);
      for (const status of this.letterStatuses.values()) {
        if ([LetterResponseStatus.PENDING_DELIVERY, LetterResponseStatus.EFFECT_FILE_WRITTEN, LetterResponseStatus.LEGACY_INVALID_PENDING].includes(status.responseStatus)) pendingIds.add(status.letterId);
      }
      const awaitingStatus = this.awaitingAcceptanceLetterId ? this.getLetterStatus(this.awaitingAcceptanceLetterId) : null;
      const effectStatus = awaitingStatus || Array.from(this.letterStatuses.values()).find((status) => status.responseStatus === LetterResponseStatus.EFFECT_FILE_WRITTEN) || null;
      const clearedTransportMode = effectStatus?.effectTransportMode || LetterEffectTransportMode.VOTC;
      let effectClearResult = null;
      if (effectStatus) {
        const storedEffect = this.storedLetters.get(effectStatus.letterId);
        const effectText = storedEffect ? this.buildOfficialLetterEffectBody(storedEffect.reply, storedEffect.letter) : null;
        effectClearResult = letterEffectTransport.cancelOutboundEffect(clearedTransportMode, effectText, effectStatus.runCommandId || null);
      }
      this.storedLetters.clear();
      this.deliveryInProgress.clear();
      this.awaitingAcceptanceLetterId = null;
      for (const letterId of pendingIds) {
        this.failedLetterContexts.delete(letterId);
        this.updateLetterStatus(letterId, {
          responseStatus: LetterResponseStatus.CANCELLED,
          responseError: "Pending delivery cleared manually.",
          daysUntilDelivery: null,
          isLate: false,
          clearedAt: Date.now()
        });
        this.transitionLetter(letterId, LetterPipelineState.PENDING_CLEARED);
      }
      this.transitionPipeline(LetterPipelineState.PENDING_CLEARED, { clearedPendingCount: pendingIds.size });
      this.savePendingLetters();
      this.syncDateTrackerSupervisor();
      return {
        success: true,
        clearedPendingCount: pendingIds.size,
        clearedAwaitingAcceptance: Boolean(awaitingStatus),
        clearedTransportMode,
        effectClearResult
      };
    }
    /**
     * Stop log tailing (cleanup)
     */
    stopLogTailing(stopSupervisor = true) {
      return this.queueLogTailingTransition(() => this.stopLogTailingNow(stopSupervisor));
    }
    async stopLogTailingNow(stopSupervisor = true) {
      if (this.tailRestartTimer) {
        clearTimeout(this.tailRestartTimer);
        this.tailRestartTimer = null;
      }
      const reader = this.tailFile;
      this.tailFile = null;
      if (this.readline) {
        this.readline.removeAllListeners?.("line");
        this.readline.close();
        this.readline = null;
      }
      if (reader) {
        await reader.quit();
        console.log("Stopped log tailing");
      }
      this.tailState = "STOPPED";
      if (stopSupervisor && this.dateHeartbeatTimer) {
        clearIntervalFn(this.dateHeartbeatTimer);
        this.dateHeartbeatTimer = null;
      }
      if (stopSupervisor && this.runCommandWatchdogTimer) {
        clearRunCommandIntervalFn(this.runCommandWatchdogTimer);
        this.runCommandWatchdogTimer = null;
      }
    }
    /**
     * Restart log tailing (useful when CK3 path is updated)
     */
    restartLogTailing() {
      return this.queueLogTailingTransition(async () => {
        console.log("Restarting log tailing...");
        this.tailState = "RESTARTING";
        this.dateSourceState = "TAIL_RESTARTING";
        await this.stopLogTailingNow(false);
        await this.startLogTailingNow();
      });
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
    createLetterStatus(letter, characterName, deliveryTiming = null) {
      const validation = this.validateLetterPayload(letter);
      if (!validation.valid) return this.recordInvalidLetterPayload({ letter, errorCode: validation.errorCode, details: validation.details, characterName });
      letter = validation.letter;
      const fallbackDeliveryTiming = {
        payloadGameDay: letter.totalDays,
        trackerGameDayAtCreation: null,
        reconciledGameDayAtCreation: null,
        deliveryBaseDay: letter.totalDays,
        dateDelta: null,
        dateSourceDecision: "PAYLOAD_FALLBACK",
        dateSourceEvent: "DATE_TRACKER_UNAVAILABLE",
        expectedDeliveryDay: letter.totalDays + letter.delay
      };
      const resolvedDeliveryTiming = deliveryTiming || fallbackDeliveryTiming;
      const effectiveCurrentDay = this.getEffectiveDeliveryCurrentDay(resolvedDeliveryTiming);
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
        expectedDeliveryDay: resolvedDeliveryTiming.expectedDeliveryDay,
        currentDay: effectiveCurrentDay,
        daysUntilDelivery: resolvedDeliveryTiming.expectedDeliveryDay - effectiveCurrentDay,
        isLate: effectiveCurrentDay > resolvedDeliveryTiming.expectedDeliveryDay,
        characterName,
        pipelineState: this.latestPipelineStatus?.state || LetterPipelineState.CONTEXT_READY,
        pipelineHistory: [...(this.latestPipelineStatus?.history || [])],
        promptMode: null,
        promptBuildError: null,
        ...resolvedDeliveryTiming
      };
      this.letterStatuses.set(letter.letterId, statusInfo);
      return statusInfo;
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
    writeInvalidPendingQuarantine(records) {
      if (!this.invalidPendingLettersFile || records.length === 0) return;
      try {
        fs$1.mkdirSync(path.dirname(this.invalidPendingLettersFile), { recursive: true });
        let existing = [];
        if (fs$1.existsSync(this.invalidPendingLettersFile)) {
          const parsed = JSON.parse(fs$1.readFileSync(this.invalidPendingLettersFile, "utf8"));
          existing = Array.isArray(parsed?.records) ? parsed.records : [];
        }
        fs$1.writeFileSync(this.invalidPendingLettersFile, JSON.stringify({ version: 1, records: [...existing, ...records] }, null, 2), "utf8");
      } catch (error) {
        console.error("LetterManager: Failed to quarantine invalid pending letters:", error);
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
      const priority = { [LetterResponseStatus.EFFECT_FILE_WRITTEN]: 4, [LetterResponseStatus.PENDING_DELIVERY]: 3, [LetterResponseStatus.GENERATED]: 2, [LetterResponseStatus.GENERATION_FAILED]: 1 };
      return Array.from(known.values()).sort((left, right) => (priority[right.responseStatus] || 0) - (priority[left.responseStatus] || 0) || String(left.letterId).localeCompare(String(right.letterId)));
    }
    refreshEffectDiagnosticTimeout() {
      const diagnostic = this.activeEffectDiagnostic;
      if (diagnostic && diagnostic.executionStatus !== "EXECUTION_CONFIRMED" && Date.now() - diagnostic.writtenAt >= diagnosticExecutionTimeoutMs) {
        const result = diagnostic.stage !== "A3" || !diagnostic.preConfirmed ? "RUN_FILE_NOT_EXECUTED" : !diagnostic.postConfirmed ? "ARTIFACT_EFFECT_ABORTED" : "ARTIFACT_SCOPE_NOT_CREATED";
        diagnostic.executionStatus = result;
        diagnostic.result = result;
        diagnostic.executionTimedOutAt = Date.now();
        diagnostic.effectClearResult = letterEffectTransport.cancelOutboundEffect(diagnostic.transportMode, diagnostic.effectText, diagnostic.runCommandId || null);
        this.effectDiagnosticStages[diagnostic.stage] = { ...diagnostic };
        this.lastEffectDiagnostic = { ...diagnostic };
        this.activeEffectDiagnostic = null;
        if (diagnostic.stage === "A1" || diagnostic.stage === "A2") letterEffectTransport.recordTransportDiagnostic(diagnostic.stage, diagnostic.result);
      }
    }
    getDiagnosticDisableReason(stage, letterId = null) {
      const diagnosticStage = String(stage || "").toUpperCase();
      const stages = ["A1", "A2", "A3", "B", "C", "D"];
      if (!stages.includes(diagnosticStage)) return "未知诊断阶段";
      if (diagnosticStage === "A1") return "旧 letters.txt 管道已停用；请从 A2 开始";
      const busyReason = this.getDiagnosticPipelineBusyReason();
      if (busyReason) return busyReason;
      this.refreshEffectDiagnosticTimeout();
      if (this.activeEffectDiagnostic && this.activeEffectDiagnostic.executionStatus !== "EXECUTION_CONFIRMED") return `${this.activeEffectDiagnostic.stage} 正在等待 CK3 Execution Marker`;
      if (["ARTIFACT_VISUAL_CHECK_REQUIRED", "A3_VISUAL_CHECK_REQUIRED"].includes(this.activeEffectDiagnostic?.result)) return `${this.activeEffectDiagnostic.stage} 已执行，请先确认 CK3 可见结果`;
      if (diagnosticStage === "A3" && this.effectDiagnosticStages.A2?.result !== "PASS") return "A2 votc.txt Execution Marker 尚未通过";
      if (["B", "C", "D"].includes(diagnosticStage)) {
        const normalizedLetterId = typeof letterId === "string" ? letterId.trim() : "";
        if (!normalizedLetterId) return "请选择 Known Letter ID";
        if (!this.letterStatuses.has(normalizedLetterId) && !this.storedLetters.has(normalizedLetterId)) return "所选 Letter ID 不在已知信件中";
        const previousStage = diagnosticStage === "B" ? "A3" : String.fromCharCode(diagnosticStage.charCodeAt(0) - 1);
        if (this.effectDiagnosticStages[previousStage]?.result !== "PASS") return `${previousStage} 尚未通过 CK3 Execution 与可见结果确认`;
      }
      return null;
    }
    resetDiagnosticStagesAfter(stage) {
      const order = ["A1", "A2", "A3", "B", "C", "D"];
      const index = order.indexOf(stage);
      for (const laterStage of order.slice(index + 1)) this.effectDiagnosticStages[laterStage] = null;
    }
    runEffectDiagnostic(stage, letterId = null) {
      const diagnosticStage = String(stage || "").toUpperCase();
      const normalizedLetterId = typeof letterId === "string" ? letterId.trim() : "";
      const disableReason = this.getDiagnosticDisableReason(diagnosticStage, normalizedLetterId);
      if (disableReason) return { success: false, stage: diagnosticStage, error: disableReason, disableReason };
      this.resetDiagnosticStagesAfter(diagnosticStage);
      const creatorScopeName = diagnosticStage === "A3" ? "root" : ["B", "C", "D"].includes(diagnosticStage) ? `global_var:message_second_scope_${normalizedLetterId}` : null;
      const diagnosticId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const transportStage = diagnosticStage === "A1" || diagnosticStage === "A2";
      const marker = transportStage ? `VOTC:LETTER_TRANSPORT/${diagnosticStage === "A1" ? "A" : "B"}/${diagnosticId}` : diagnosticStage === "A3" ? `VOTC:LETTER_DIAG/A3/PRE/${diagnosticId}` : `VOTC:LETTER_DIAG/${diagnosticStage}/${diagnosticId}`;
      const transportMode = diagnosticStage === "A1" ? LetterEffectTransportMode.LEGACY : LetterEffectTransportMode.VOTC;
      let gameCommand = `debug_log = "${marker}"`;
      let postMarker = null;
      let scopeMarker = null;
      if (diagnosticStage === "A3") {
        postMarker = `VOTC:LETTER_DIAG/A3/POST/${diagnosticId}`;
        scopeMarker = `VOTC:LETTER_DIAG/A3/SCOPE_OK/${diagnosticId}`;
        const artifactBody = this.buildLetterArtifactBody({ creatorScope: "root", name: "votc_huixin_title1", description: "VOTC RC6 ARTIFACT TEST", saveScopeAs: "votc_test_letter" }).split("\n").map((line) => `\t${line}`).join("\n");
        gameCommand = `root = {
	debug_log = "${marker}"
${artifactBody}
	if = {
		limit = { exists = scope:votc_test_letter }
		debug_log = "${scopeMarker}"
	}
	debug_log = "${postMarker}"
}`;
      } else {
      if (["B", "C", "D"].includes(diagnosticStage)) {
        const saveScopeAs = diagnosticStage === "B" ? "votc_test_letter" : "votc_latest_letter";
        gameCommand += `
${this.buildLetterArtifactBody({ creatorScope: creatorScopeName, name: `votc_huixin_title${normalizedLetterId.replace(/letter_/, "")}`, description: "VOTC RC6 ARTIFACT TEST", saveScopeAs })}`;
        if (diagnosticStage === "C" || diagnosticStage === "D") gameCommand += `
set_global_variable = {
	name = votc_latest_letter
	value = scope:votc_latest_letter
}`;
      }
      }
      if (diagnosticStage === "D") gameCommand += "\ntrigger_event = message_event.362";
      const writeResult = letterEffectTransport.writeDiagnosticEffect(gameCommand, transportMode);
      if (writeResult.success) {
        const diagnostic = {
          success: true,
          stage: diagnosticStage,
          diagnosticId,
          marker,
          postMarker,
          scopeMarker,
          letterId: ["B", "C", "D"].includes(diagnosticStage) ? normalizedLetterId : null,
          creatorScopeName,
          transportMode,
          effectFilePath: writeResult.effectFilePath,
          runCommandId: writeResult.commandId || null,
          effectText: gameCommand,
          writeStatus: "FILE_WRITE_OK",
          executionStatus: diagnosticStage === "A3" ? "A3_PRE_WAIT" : "WAITING_FOR_CK3_EXECUTION",
          result: diagnosticStage === "A3" ? "A3_PRE_WAIT" : "WAITING_FOR_CK3_EXECUTION",
          requiresVisualCheck: !transportStage,
          preConfirmed: false,
          postConfirmed: false,
          scopeConfirmed: false,
          writtenAt: Date.now()
        };
        this.activeEffectDiagnostic = diagnostic;
        this.effectDiagnosticStages[diagnosticStage] = { ...diagnostic };
        this.lastEffectDiagnostic = { ...diagnostic };
        console.log(`[LetterDiagnostics] stage=${diagnosticStage} id=${diagnosticId} state=${diagnostic.result}`);
        return { ...diagnostic };
      }
      const errorMessage = `Failed to write diagnostic effect: ${writeResult.error || "Unknown error"}`;
      console.error(`LetterManager.runEffectDiagnostic: ${errorMessage}`);
      const diagnostic = { success: false, stage: diagnosticStage, diagnosticId, letterId: ["B", "C", "D"].includes(diagnosticStage) ? normalizedLetterId : null, creatorScopeName, transportMode, effectFilePath: writeResult.effectFilePath || null, writeStatus: "WRITE_FAILED", executionStatus: "NOT_STARTED", result: "WRITE_FAILED", error: errorMessage, writtenAt: Date.now() };
      this.effectDiagnosticStages[diagnosticStage] = { ...diagnostic };
      this.lastEffectDiagnostic = { ...diagnostic };
      return { ...diagnostic };
    }
    confirmA3DiagnosticMarker(markerType, diagnosticId) {
      const diagnostic = this.activeEffectDiagnostic;
      if (!diagnostic || diagnostic.stage !== "A3" || diagnostic.diagnosticId !== diagnosticId || diagnostic.executionStatus === "EXECUTION_CONFIRMED") return false;
      const confirmedAt = Date.now();
      if (markerType === "PRE") {
        diagnostic.preConfirmed = true;
        diagnostic.preConfirmedAt = confirmedAt;
        diagnostic.executionStatus = "A3_EFFECT_ENTERED";
        diagnostic.result = "A3_EFFECT_ENTERED";
      } else if (markerType === "POST") {
        diagnostic.postConfirmed = true;
        diagnostic.postConfirmedAt = confirmedAt;
        diagnostic.executionStatus = diagnostic.scopeConfirmed ? "A3_SCOPE_CONFIRMED" : "A3_POST_WAIT";
        diagnostic.result = diagnostic.executionStatus;
      } else if (markerType === "SCOPE_OK") {
        diagnostic.scopeConfirmed = true;
        diagnostic.scopeConfirmedAt = confirmedAt;
        diagnostic.executionStatus = "A3_SCOPE_CONFIRMED";
        diagnostic.result = "A3_SCOPE_CONFIRMED";
      }
      if (diagnostic.preConfirmed && diagnostic.postConfirmed && diagnostic.scopeConfirmed) {
        diagnostic.executionStatus = "EXECUTION_CONFIRMED";
        diagnostic.executionConfirmedAt = confirmedAt;
        diagnostic.effectClearResult = diagnostic.transportMode === LetterEffectTransportMode.VOTC
          ? { success: true, cleanupOwner: "run_command_ack_queue", commandId: diagnostic.runCommandId || null }
          : letterEffectTransport.cancelOutboundEffect(diagnostic.transportMode, diagnostic.effectText, diagnostic.runCommandId || null);
        diagnostic.result = "A3_VISUAL_CHECK_REQUIRED";
        diagnostic.visualCheckRequired = true;
      }
      this.effectDiagnosticStages.A3 = { ...diagnostic };
      this.lastEffectDiagnostic = { ...diagnostic };
      console.log(`[LetterDiagnostics] stage=A3 id=${diagnosticId} state=${diagnostic.result}`);
      return true;
    }
    confirmDiagnosticExecutionMarker(stage, diagnosticId) {
      const diagnostic = this.activeEffectDiagnostic;
      if (!diagnostic || diagnostic.stage !== stage || diagnostic.diagnosticId !== diagnosticId) return false;
      if (diagnostic.executionStatus !== "WAITING_FOR_CK3_EXECUTION") return false;
      diagnostic.executionStatus = "EXECUTION_CONFIRMED";
      diagnostic.executionConfirmedAt = Date.now();
      diagnostic.effectClearResult = diagnostic.transportMode === LetterEffectTransportMode.VOTC
        ? { success: true, cleanupOwner: "run_command_ack_queue", commandId: diagnostic.runCommandId || null }
        : letterEffectTransport.cancelOutboundEffect(diagnostic.transportMode, diagnostic.effectText, diagnostic.runCommandId || null);
      if (diagnostic.requiresVisualCheck) {
        diagnostic.result = "ARTIFACT_VISUAL_CHECK_REQUIRED";
        diagnostic.visualCheckRequired = true;
      } else {
        diagnostic.result = "PASS";
        diagnostic.success = true;
        diagnostic.visualCheckRequired = false;
        this.activeEffectDiagnostic = null;
        letterEffectTransport.recordTransportDiagnostic(stage, "PASS");
      }
      this.effectDiagnosticStages[stage] = { ...diagnostic };
      this.lastEffectDiagnostic = { ...diagnostic };
      console.log(`[LetterDiagnostics] stage=${stage} id=${diagnosticId} state=EXECUTION_CONFIRMED`);
      return true;
    }
    confirmEffectDiagnostic(stage, passed) {
      const diagnosticStage = String(stage || "").toUpperCase();
      const diagnostic = this.effectDiagnosticStages[diagnosticStage];
      if (!diagnostic || diagnostic.executionStatus !== "EXECUTION_CONFIRMED" || !diagnostic.requiresVisualCheck) return { success: false, error: `${diagnosticStage} 尚未进入 CK3 可见结果确认` };
      diagnostic.visualCheckRequired = false;
      diagnostic.visualCheckConfirmedAt = Date.now();
      diagnostic.result = passed === true ? "PASS" : diagnosticStage === "A3" ? "ARTIFACT_NOT_VISIBLE" : "FAIL";
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
        const effectiveCurrentDay = this.getEffectiveDeliveryCurrentDay(status);
        status.currentDay = effectiveCurrentDay;
        if (Number.isFinite(status.expectedDeliveryDay)) {
          status.daysUntilDelivery = status.expectedDeliveryDay - effectiveCurrentDay;
          status.isLate = effectiveCurrentDay > status.expectedDeliveryDay;
        } else {
          status.daysUntilDelivery = null;
          status.isLate = false;
        }
      }
      let effectFileExists = false;
      let effectFileAge = null;
      let effectContent = "";
      let inspectedEffectFilePath = null;
      const statusWithEffect = Array.from(this.letterStatuses.values()).filter((status) => status.effectFilePath).sort((left, right) => Math.max(right.letterAcceptedAt || right.acceptedAt || 0, right.effectFileWrittenAt || 0) - Math.max(left.letterAcceptedAt || left.acceptedAt || 0, left.effectFileWrittenAt || 0))[0] || null;
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      if (ck3Folder) {
        const diagnosticIsLatest = Number(this.lastEffectDiagnostic?.writtenAt || 0) >= Number(statusWithEffect?.effectFileWrittenAt || 0);
        const effectFilePath = diagnosticIsLatest ? this.lastEffectDiagnostic?.effectFilePath : statusWithEffect?.effectFilePath;
        const resolvedEffectFilePath = effectFilePath || path.join(ck3Folder, "run", "votc.txt");
        inspectedEffectFilePath = resolvedEffectFilePath;
        try {
          effectFileExists = fs$1.existsSync(resolvedEffectFilePath);
          if (effectFileExists) {
            effectFileAge = Math.max(0, Date.now() - fs$1.statSync(resolvedEffectFilePath).mtimeMs);
            effectContent = fs$1.readFileSync(resolvedEffectFilePath, "utf8");
          }
        } catch (error) {
          console.warn("LetterManager: Failed to inspect Letter Effect diagnostics:", error);
          effectFileExists = false;
          effectFileAge = null;
          effectContent = "";
        }
      }
      const effectContainsCreateArtifact = /\bcreate_artifact\s*=/.test(effectContent);
      const effectContainsMessageEvent362 = /\btrigger_event\s*=\s*message_event\.362\b/.test(effectContent);
      const creatorScopeName = effectContent.match(/\bcreator\s*=\s*([^\s]+)/)?.[1] || this.lastEffectDiagnostic?.creatorScopeName || null;
      const creatorScopeExpected = statusWithEffect?.letterId ? `global_var:message_second_scope_${statusWithEffect.letterId}` : this.lastEffectDiagnostic?.letterId ? `global_var:message_second_scope_${this.lastEffectDiagnostic.letterId}` : null;
      const clearablePendingCount = new Set([
        ...this.storedLetters.keys(),
        ...Array.from(this.letterStatuses.values()).filter((status) => [LetterResponseStatus.PENDING_DELIVERY, LetterResponseStatus.EFFECT_FILE_WRITTEN, LetterResponseStatus.LEGACY_INVALID_PENDING].includes(status.responseStatus)).map((status) => status.letterId),
        ...(this.awaitingAcceptanceLetterId ? [this.awaitingAcceptanceLetterId] : [])
      ]).size;
      const knownDiagnosticLetters = this.getKnownDiagnosticLetters();
      const diagnosticLetterId = this.lastEffectDiagnostic?.letterId || knownDiagnosticLetters[0]?.letterId || null;
      return {
        letters: Array.from(this.letterStatuses.values()),
        currentTotalDays: this.currentTotalDays,
        lastDateLogReceivedAt: this.lastDateLogReceivedAt,
        awaitingAcceptanceLetterId: this.awaitingAcceptanceLetterId,
        effectFileExists,
        effectFileAge,
        inspectedEffectFilePath,
        storedLettersCount: this.storedLetters.size,
        clearablePendingCount,
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
        letterTransport: letterEffectTransport.getState(),
        knownDiagnosticLetters,
        diagnosticDisableReasons: Object.fromEntries(["A1", "A2", "A3", "B", "C", "D"].map((stage) => [stage, this.getDiagnosticDisableReason(stage, diagnosticLetterId)])),
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

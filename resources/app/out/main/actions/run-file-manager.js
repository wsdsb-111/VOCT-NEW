"use strict";

function createRunFileManager({ settingsRepository, path, fs, dataDir = null, now = () => Date.now(), random = () => Math.random() }) {
  const fs$1 = fs;
  class RunFileManager {
    constructor() {
      this.ck3UserPath = settingsRepository.getCK3UserFolderPath() || null;
      this.path = null;
      this.stateFile = dataDir ? path.join(dataDir, "run-command-queue.json") : null;
      this.pendingCommands = [];
      this.recentCommands = [];
      this.commandSequence = 0;
      this.initialized = false;
      this.recoveryCompleted = false;
      this.stateLoadError = null;
      this.resolvePath();
      this.loadState();
    }
    resolvePath() {
      if (!this.ck3UserPath) this.ck3UserPath = settingsRepository.getCK3UserFolderPath() || null;
      if (!this.ck3UserPath) {
        console.warn("RunFileManager: CK3 user folder path is not configured. Run file operations will be disabled.");
        this.path = null;
        return null;
      }
      this.createRunFolder(this.ck3UserPath);
      this.path = path.join(this.ck3UserPath, "run", "votc.txt");
      return this.path;
    }
    refreshPathFromSettings() {
      this.assertStateLoaded();
      const nextPath = settingsRepository.getCK3UserFolderPath() || null;
      if (nextPath === this.ck3UserPath) return this.path;
      const dispatched = this.pendingCommands.find((command) => this.hasWriteHistory(command));
      if (dispatched) throw new Error("run_command_path_change_with_dispatched_command");
      this.ck3UserPath = nextPath;
      this.path = null;
      return this.resolvePath();
    }
    createCommandId() {
      this.commandSequence += 1;
      return `rc6-${now().toString(36)}-${this.commandSequence.toString(36)}-${random().toString(36).slice(2, 8)}`;
    }
    normalizeKind(kind) {
      return String(kind || "command").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "command";
    }
    snapshot(command) {
      return command ? { ...command } : null;
    }
    assertStateLoaded() {
      if (!this.stateLoadError) return;
      throw new Error(`run_command_state_load_failed: ${this.stateLoadError instanceof Error ? this.stateLoadError.message : String(this.stateLoadError)}`);
    }
    hasWriteHistory(command) {
      return Number(command?.writeAttempts || 0) > 0 || command?.lastWrittenAt != null || command?.writtenAt != null;
    }
    loadState() {
      if (!this.stateFile || !fs$1.existsSync(this.stateFile)) return;
      try {
        const saved = JSON.parse(fs$1.readFileSync(this.stateFile, "utf8"));
        const recent = Array.isArray(saved.recentCommands) ? saved.recentCommands.slice(-50) : [];
        const commands = Array.isArray(saved.pendingCommands) ? saved.pendingCommands.filter((command) => command && command.commandId && command.effectText).map((command) => ({
          ...command,
          status: command.status === "written" ? "awaiting_ack" : command.status,
          lastWrittenAt: command.lastWrittenAt || command.writtenAt || null,
          writeAttempts: Number(command.writeAttempts) || (command.lastWrittenAt || command.writtenAt ? 1 : 0)
        })) : [];
        this.pendingCommands = commands.filter((command) => ["queued", "blocked", "awaiting_ack", "stalled"].includes(command.status));
        for (const command of commands.filter((command) => ["failed", "acknowledged", "cancelled"].includes(command.status))) recent.push(command);
        this.recentCommands = recent.slice(-50);
      } catch (error) {
        this.stateLoadError = error;
        console.error("RunFileManager: Failed to load command queue:", error);
      }
    }
    saveStateOrThrow() {
      this.assertStateLoaded();
      if (!this.stateFile) throw new Error("run_command_state_file_unavailable");
      let tempPath = null;
      try {
        fs$1.mkdirSync(path.dirname(this.stateFile), { recursive: true });
        tempPath = `${this.stateFile}.${process.pid}.${now()}.tmp`;
        fs$1.writeFileSync(tempPath, JSON.stringify({ version: 2, pendingCommands: this.pendingCommands, recentCommands: this.recentCommands.slice(-50) }, null, 2), "utf8");
        fs$1.renameSync(tempPath, this.stateFile);
        return true;
      } catch (error) {
        if (tempPath && fs$1.existsSync(tempPath)) {
          try {
            fs$1.unlinkSync(tempPath);
          } catch {}
        }
        throw error;
      }
    }
    saveState() {
      try {
        return this.saveStateOrThrow();
      } catch (error) {
        console.error("RunFileManager: Failed to persist command queue:", error);
        return false;
      }
    }
    composeCommandText(command) {
      const ackKind = this.normalizeKind(command.kind).toUpperCase();
      return `${String(command.effectText).trim()}
debug_log = "VOTC:RUN_ACK/${ackKind}/${command.commandId}"
root = {trigger_event = mcc_event_v2.9003}`;
    }
    markActiveCommandUnavailable(command, reason) {
      const hasWriteHistory = this.hasWriteHistory(command);
      command.status = hasWriteHistory ? "stalled" : "blocked";
      command.failureReason = reason;
      if (hasWriteHistory) command.stalledAt = now();
      else command.blockedAt = now();
      this.saveState();
      return this.snapshot(command);
    }
    writeActiveCommand() {
      this.assertStateLoaded();
      const command = this.pendingCommands[0];
      if (!command) {
        this.writeEmptyRunFileIfSafe();
        return null;
      }
      if (!this.recoveryCompleted || command.status === "stalled") return this.snapshot(command);
      if (this.hasWriteHistory(command) && !command.retryAuthorized) return this.snapshot(command);
      if (!this.resolvePath()) return this.markActiveCommandUnavailable(command, "run_command_path_unavailable");
      const previous = this.snapshot(command);
      let dispatchPrepared = false;
      try {
        const dispatchedAt = now();
        command.status = "awaiting_ack";
        command.writtenAt = command.writtenAt || dispatchedAt;
        command.lastWrittenAt = dispatchedAt;
        command.writeAttempts = Number(command.writeAttempts || 0) + 1;
        command.retryAuthorized = false;
        command.blockedAt = null;
        command.failureReason = null;
        this.saveStateOrThrow();
        dispatchPrepared = true;
        fs$1.writeFileSync(this.path, this.composeCommandText(command), "utf8");
        console.log(`[RunCommand] written id=${command.commandId} owner=${command.owner} kind=${command.kind}`);
        return this.snapshot(command);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (dispatchPrepared) {
          command.status = "stalled";
          command.stalledAt = now();
          command.failureReason = `post_dispatch_write_failure: ${reason}`;
          this.saveState();
        } else {
          Object.assign(command, previous);
          this.markActiveCommandUnavailable(command, reason);
        }
        console.error(`RunFileManager: Failed to write command ${command.commandId}:`, error);
        return null;
      }
    }
    enqueueCommand({ commandId = null, owner = "action", kind = "action_effect", effectText }) {
      this.assertStateLoaded();
      const normalizedText = String(effectText || "").trim();
      if (!normalizedText) throw new Error("run_command_effect_empty");
      const id = String(commandId || this.createCommandId());
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("run_command_id_invalid");
      const existing = this.pendingCommands.find((command) => command.commandId === id);
      if (existing) return this.snapshot(existing);
      const command = {
        commandId: id,
        owner: String(owner || "unknown"),
        kind: this.normalizeKind(kind),
        effectText: normalizedText,
        writtenAt: null,
        lastWrittenAt: null,
        writeAttempts: 0,
        queuedAt: now(),
        status: "queued",
        ackMarker: `VOTC:RUN_ACK/${this.normalizeKind(kind).toUpperCase()}/${id}`
      };
      this.pendingCommands.push(command);
      try {
        this.saveStateOrThrow();
      } catch (error) {
        this.pendingCommands.pop();
        throw new Error(`run_command_persist_failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (this.pendingCommands.length === 1 && this.recoveryCompleted) return this.writeActiveCommand();
      return this.snapshot(command);
    }
    write(text, options = {}) {
      return this.enqueueCommand({
        effectText: text,
        owner: options.owner || "action",
        kind: options.kind || "action_effect",
        commandId: options.commandId || null
      });
    }
    append(text) {
      return this.write(text);
    }
    ackCommand(commandId, kind = null) {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      if (!active || active.commandId !== commandId) return null;
      if (kind && this.normalizeKind(kind) !== active.kind) return null;
      this.pendingCommands.shift();
      active.status = "acknowledged";
      active.acknowledgedAt = now();
      active.ackSource = "live_debug_log";
      this.recentCommands.push(active);
      try {
        this.saveStateOrThrow();
      } catch (error) {
        this.recentCommands.pop();
        active.status = "stalled";
        active.stalledAt = now();
        active.failureReason = `ack_persist_failed: ${error instanceof Error ? error.message : String(error)}`;
        this.pendingCommands.unshift(active);
        console.error(`RunFileManager: Failed to persist ACK for ${active.commandId}:`, error);
        return null;
      }
      console.log(`[RunCommand] acknowledged id=${active.commandId} owner=${active.owner} kind=${active.kind}`);
      if (this.recoveryCompleted) this.writeActiveCommand();
      return this.snapshot(active);
    }
    reconcileAcknowledgedCommands(ackEntries = []) {
      this.assertStateLoaded();
      if (!Array.isArray(ackEntries) || ackEntries.length === 0) return [];
      const ackSet = new Set(ackEntries.map((entry) => `${this.normalizeKind(entry?.kind)}:${String(entry?.commandId || "")}`));
      const reconciled = [];
      while (this.pendingCommands.length > 0) {
        const active = this.pendingCommands[0];
        if (!ackSet.has(`${this.normalizeKind(active.kind)}:${active.commandId}`)) break;
        this.pendingCommands.shift();
        active.status = "acknowledged";
        active.acknowledgedAt = now();
        active.ackSource = "startup_debug_log_reconciliation";
        this.recentCommands.push(active);
        reconciled.push(active);
      }
      if (reconciled.length === 0) return [];
      try {
        this.saveStateOrThrow();
      } catch (error) {
        this.recentCommands.splice(this.recentCommands.length - reconciled.length, reconciled.length);
        for (let index = reconciled.length - 1; index >= 0; index -= 1) {
          const command = reconciled[index];
          command.status = this.hasWriteHistory(command) ? "awaiting_ack" : "queued";
          command.acknowledgedAt = null;
          command.ackSource = null;
          this.pendingCommands.unshift(command);
        }
        throw error;
      }
      if (this.recoveryCompleted) this.writeActiveCommand();
      return reconciled.map((command) => this.snapshot(command));
    }
    failCommand(commandId, reason) {
      this.assertStateLoaded();
      const index = this.pendingCommands.findIndex((command) => command.commandId === commandId);
      if (index === -1) return null;
      const [command] = this.pendingCommands.splice(index, 1);
      const previous = this.snapshot(command);
      command.status = "failed";
      command.failedAt = now();
      command.failureReason = String(reason || "unknown_failure");
      this.recentCommands.push(command);
      if (!this.saveState()) {
        this.recentCommands.pop();
        Object.assign(command, previous);
        this.pendingCommands.splice(index, 0, command);
        return null;
      }
      if (index === 0 && this.recoveryCompleted) this.writeActiveCommand();
      return this.snapshot(command);
    }
    cancelCommand(commandId, reason = "cancelled") {
      this.assertStateLoaded();
      const index = this.pendingCommands.findIndex((command) => command.commandId === commandId);
      if (index === -1) return null;
      const [command] = this.pendingCommands.splice(index, 1);
      const previous = this.snapshot(command);
      command.status = "cancelled";
      command.cancelledAt = now();
      command.cancelReason = String(reason);
      this.recentCommands.push(command);
      if (!this.saveState()) {
        this.recentCommands.pop();
        Object.assign(command, previous);
        this.pendingCommands.splice(index, 0, command);
        return null;
      }
      if (index === 0 && this.recoveryCompleted) this.writeActiveCommand();
      return this.snapshot(command);
    }
    findPendingCommand(predicate) {
      const command = this.pendingCommands.find(predicate);
      return this.snapshot(command);
    }
    getPendingCommands() {
      return this.pendingCommands.map((command) => this.snapshot(command));
    }
    getRecentCommands() {
      return this.recentCommands.map((command) => this.snapshot(command));
    }
    recoverPendingCommands() {
      return this.initializeAfterAckReconciliation();
    }
    initializeAfterAckReconciliation() {
      if (this.recoveryCompleted) return this.getPendingCommands();
      this.assertStateLoaded();
      this.initialized = true;
      this.recoveryCompleted = true;
      try {
        if (this.pendingCommands.length === 0) {
          this.writeEmptyRunFileIfSafe();
          return [];
        }
        const active = this.pendingCommands[0];
        if (this.hasWriteHistory(active)) {
          if (active.status !== "stalled") {
            active.status = "stalled";
            active.stalledAt = now();
            active.failureReason = "startup_ack_unconfirmed";
            this.saveStateOrThrow();
          }
          return this.getPendingCommands();
        }
        if (active.status !== "queued") {
          active.status = "queued";
          this.saveStateOrThrow();
        }
        this.writeActiveCommand();
        return this.getPendingCommands();
      } catch (error) {
        this.recoveryCompleted = false;
        throw error;
      }
    }
    markActiveCommandStalledIfNeeded({ ackTimeoutMs = 30000 } = {}) {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      if (!active || !["awaiting_ack", "written"].includes(active.status)) return null;
      const lastWrittenAt = Number(active.lastWrittenAt || active.writtenAt);
      if (!lastWrittenAt || now() - lastWrittenAt < ackTimeoutMs) return null;
      const previousStatus = active.status;
      active.status = "stalled";
      active.stalledAt = now();
      try {
        this.saveStateOrThrow();
      } catch (error) {
        active.status = previousStatus;
        active.stalledAt = null;
        throw error;
      }
      return this.snapshot(active);
    }
    retryStalledCommand(commandId) {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      if (!active || active.commandId !== commandId) throw new Error("run_command_not_active");
      if (active.status !== "stalled") throw new Error("run_command_not_stalled");
      const previous = this.snapshot(active);
      active.status = "queued";
      active.lastRetryAt = now();
      active.failureReason = null;
      active.retryAuthorized = true;
      try {
        this.saveStateOrThrow();
      } catch (error) {
        Object.assign(active, previous);
        throw error;
      }
      return this.writeActiveCommand();
    }
    retryBlockedCommand(commandId) {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      if (!active || active.commandId !== commandId) throw new Error("run_command_not_active");
      if (active.status !== "blocked") throw new Error("run_command_not_blocked");
      if (this.hasWriteHistory(active)) throw new Error("run_command_blocked_has_write_history");
      const previous = this.snapshot(active);
      active.status = "queued";
      active.lastRetryAt = now();
      active.failureReason = null;
      try {
        this.saveStateOrThrow();
      } catch (error) {
        Object.assign(active, previous);
        throw error;
      }
      return this.writeActiveCommand();
    }
    cancelStalledCommand(commandId, reason = "user_cancelled") {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      if (!active || active.commandId !== commandId) throw new Error("run_command_not_active");
      if (active.status !== "stalled") throw new Error("run_command_not_stalled");
      return this.cancelCommand(commandId, reason);
    }
    writeEmptyRunFileIfSafe() {
      if (this.stateLoadError) return false;
      if (this.pendingCommands.length > 0 || !this.resolvePath()) return false;
      try {
        if (fs$1.existsSync(this.path)) fs$1.writeFileSync(this.path, "", "utf8");
      } catch (error) {
        console.warn("RunFileManager: Failed to clear empty run file:", error);
        return false;
      }
      return true;
    }
    isRecoveryCompleted() {
      return this.recoveryCompleted;
    }
    clear() {
      if (this.stateLoadError) return false;
      if (this.pendingCommands.length > 0) {
        console.warn("RunFileManager: Refusing to clear votc.txt while commands are awaiting CK3 ACK.");
        return false;
      }
      if (!this.resolvePath()) return false;
      fs$1.writeFileSync(this.path, "", "utf8");
      return true;
    }
    createRunFolder(userFolderPath) {
      const runFolderPath = path.join(userFolderPath, "run");
      if (!fs$1.existsSync(runFolderPath)) fs$1.mkdirSync(runFolderPath, { recursive: true });
    }
    isAvailable() {
      return !this.stateLoadError && this.resolvePath() !== null;
    }
  }

  return RunFileManager;
}

module.exports = { createRunFileManager };

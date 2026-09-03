"use strict";

const RUN_COMMAND_QUEUE_VERSION = 3;
const CONVERSATION_CLOSE_TTL_MS = 15e3;
const PENDING_COMMAND_STATUSES = ["queued", "blocked", "awaiting_ack", "stalled"];
const TERMINAL_COMMAND_STATUSES = ["failed", "acknowledged", "cancelled", "expired", "quarantined"];

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
      this.stateNeedsMigration = false;
      this.currentConversationEpoch = null;
      this.lateAckCount = 0;
      this.lastLateAckAt = null;
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
    normalizeEpoch(epoch) {
      if (epoch == null || String(epoch).trim() === "") return null;
      const value = Number(epoch);
      return Number.isInteger(value) && value >= 0 ? value : null;
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
    logRunCommand(event, command, previousStatus = null, reason = null) {
      const ageMs = Number.isFinite(Number(command?.queuedAt)) ? Math.max(0, now() - Number(command.queuedAt)) : null;
      const cleanReason = reason == null ? null : String(reason).replace(/\s+/g, " ").slice(0, 200);
      const fields = [
        `id=${command?.commandId || "unknown"}`,
        `kind=${command?.kind || "unknown"}`,
        `owner=${command?.owner || "unknown"}`,
        `scopeId=${command?.scopeId || "-"}`,
        `epoch=${command?.epoch ?? "-"}`,
        `queuedAt=${command?.queuedAt ?? "-"}`,
        `writtenAt=${command?.writtenAt ?? "-"}`,
        `ageMs=${ageMs ?? "-"}`,
        `writeAttempts=${Number(command?.writeAttempts || 0)}`,
        `previousStatus=${previousStatus || "-"}`,
        `newStatus=${command?.status || "-"}`
      ];
      if (cleanReason) fields.push(`reason=${cleanReason}`);
      console.log(`[RunCommand] ${event} ${fields.join(" ")}`);
    }
    setCommandStatus(command, status, { event = status, reason = null, ...fields } = {}) {
      const previousStatus = command.status;
      Object.assign(command, fields, { status });
      this.logRunCommand(event, command, previousStatus, reason);
      return command;
    }
    normalizeLoadedCommand(command) {
      const kind = this.normalizeKind(command.kind);
      const queuedAt = Number.isFinite(Number(command.queuedAt)) ? Number(command.queuedAt) : now();
      const status = command.status === "written" ? "awaiting_ack" : command.status;
      const scopeId = command.scopeId == null || String(command.scopeId).trim() === "" ? null : String(command.scopeId);
      const epoch = this.normalizeEpoch(command.epoch);
      const expiresAtValue = Number(command.expiresAt);
      const expiresAt = Number.isFinite(expiresAtValue)
        ? expiresAtValue
        : kind === "conversation_close" ? queuedAt + CONVERSATION_CLOSE_TTL_MS : null;
      const lastWrittenAt = command.lastWrittenAt != null ? command.lastWrittenAt : command.writtenAt != null ? command.writtenAt : null;
      const writeAttempts = Number(command.writeAttempts) || (lastWrittenAt != null ? 1 : 0);
      return {
        ...command,
        kind,
        queuedAt,
        scopeId,
        epoch,
        expiresAt,
        destructive: command.destructive == null ? kind === "conversation_close" : command.destructive === true,
        supersedable: command.supersedable == null ? kind === "conversation_close" : command.supersedable === true,
        status,
        lastWrittenAt,
        writeAttempts,
        retryAuthorized: command.retryAuthorized === true,
        ackMarker: command.ackMarker || `VOTC:RUN_ACK/${kind.toUpperCase()}/${command.commandId}`
      };
    }
    isCommandExpired(command) {
      const expiresAt = Number(command?.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > 0 && now() >= expiresAt;
    }
    isStaleConversationClose(command) {
      if (command?.kind !== "conversation_close" || this.currentConversationEpoch == null) return false;
      const epoch = this.normalizeEpoch(command.epoch);
      return epoch == null || epoch < this.currentConversationEpoch;
    }
    neutralizeExecutableFile({ expectedCommandId, command = null, reason = "unspecified" } = {}) {
      if (this.stateLoadError || !expectedCommandId || !this.resolvePath()) return false;
      try {
        if (!fs$1.existsSync(this.path)) return true;
        const text = fs$1.readFileSync(this.path, "utf8");
        if (!text) {
          this.logRunCommand("neutralized", command || { commandId: expectedCommandId, kind: "unknown", owner: "unknown", queuedAt: now(), writeAttempts: 0, status: "-" }, null, `${reason}_already_empty`);
          return true;
        }
        if (!text.includes(`/${expectedCommandId}`)) {
          console.warn(`[RunCommand] neutralize_refused id=${expectedCommandId} reason=carrier_mismatch`);
          return false;
        }
        fs$1.writeFileSync(this.path, "", "utf8");
        this.logRunCommand("neutralized", command || { commandId: expectedCommandId, kind: "unknown", owner: "unknown", queuedAt: now(), writeAttempts: 0, status: "-" }, command?.status || null, reason);
        return true;
      } catch (error) {
        console.error(`[RunCommand] neutralize_failed id=${expectedCommandId} reason=${reason}:`, error);
        return false;
      }
    }
    setCurrentConversationEpoch(epoch) {
      this.assertStateLoaded();
      this.currentConversationEpoch = this.normalizeEpoch(epoch);
      if (this.currentConversationEpoch == null) return [];
      return this.cancelPendingCommands(
        (command) => command.kind === "conversation_close" && this.isStaleConversationClose(command),
        "stale_conversation_epoch"
      );
    }
    loadState() {
      if (!this.stateFile || !fs$1.existsSync(this.stateFile)) return;
      try {
        const saved = JSON.parse(fs$1.readFileSync(this.stateFile, "utf8"));
        const savedVersion = Number(saved?.version) || 2;
        this.stateNeedsMigration = savedVersion !== RUN_COMMAND_QUEUE_VERSION;
        const recent = Array.isArray(saved?.recentCommands) ? saved.recentCommands.slice(-50) : [];
        const commands = Array.isArray(saved?.pendingCommands) ? saved.pendingCommands.filter((command) => command && command.commandId && command.effectText).map((command) => this.normalizeLoadedCommand(command)) : [];
        this.pendingCommands = commands.filter((command) => PENDING_COMMAND_STATUSES.includes(command.status));
        for (const command of commands.filter((command) => TERMINAL_COMMAND_STATUSES.includes(command.status))) recent.push(command);
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
        fs$1.writeFileSync(tempPath, JSON.stringify({ version: RUN_COMMAND_QUEUE_VERSION, pendingCommands: this.pendingCommands, recentCommands: this.recentCommands.slice(-50) }, null, 2), "utf8");
        fs$1.renameSync(tempPath, this.stateFile);
        this.stateNeedsMigration = false;
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
      this.setCommandStatus(command, hasWriteHistory ? "stalled" : "blocked", {
        event: hasWriteHistory ? "stalled" : "blocked",
        reason,
        failureReason: reason,
        stalledAt: hasWriteHistory ? now() : null,
        blockedAt: hasWriteHistory ? null : now()
      });
      this.saveState();
      return this.snapshot(command);
    }
    writeActiveCommand({ clearWhenEmpty = true } = {}) {
      this.assertStateLoaded();
      if (!this.recoveryCompleted) return this.snapshot(this.pendingCommands[0]);
      while (this.pendingCommands.length > 0) {
        const active = this.pendingCommands[0];
        if (active.kind === "conversation_close" && (this.isStaleConversationClose(active) || active.status === "stalled")) {
          const reason = this.isStaleConversationClose(active) ? "stale_conversation_close" : "conversation_close_ack_timeout";
          const removed = this.quarantineCommand(active.commandId, reason, { advance: false });
          if (!removed) return this.snapshot(active);
          continue;
        }
        if (this.isCommandExpired(active)) {
          const removed = this.hasWriteHistory(active)
            ? this.quarantineCommand(active.commandId, `${active.kind}_expired_after_dispatch`, { advance: false })
            : this.expireCommand(active.commandId, `${active.kind}_expired_before_dispatch`, { advance: false });
          if (!removed) return this.snapshot(active);
        } else break;
      }
      const command = this.pendingCommands[0];
      if (!command) {
        if (clearWhenEmpty) this.writeEmptyRunFileIfSafe();
        return null;
      }
      if (command.status === "stalled") return this.snapshot(command);
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
        this.logRunCommand("dispatch", command, previous.status);
        return this.snapshot(command);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (dispatchPrepared) {
          if (command.kind === "conversation_close") {
            return this.quarantineCommand(command.commandId, `post_dispatch_write_failure: ${reason}`);
          }
          this.setCommandStatus(command, "stalled", {
            event: "stalled",
            reason: `post_dispatch_write_failure: ${reason}`,
            stalledAt: now(),
            failureReason: `post_dispatch_write_failure: ${reason}`
          });
          this.saveState();
          this.neutralizeExecutableFile({ expectedCommandId: command.commandId, command, reason: "post_dispatch_write_failure" });
        } else {
          Object.assign(command, previous);
          this.markActiveCommandUnavailable(command, reason);
        }
        console.error(`RunFileManager: Failed to write command ${command.commandId}:`, error);
        return null;
      }
    }
    enqueueCommand({ commandId = null, owner = "action", kind = "action_effect", effectText, scopeId = null, epoch = null, expiresAt = null, expiresInMs = null, destructive = null, supersedable = null }) {
      this.assertStateLoaded();
      const normalizedText = String(effectText || "").trim();
      if (!normalizedText) throw new Error("run_command_effect_empty");
      const id = String(commandId || this.createCommandId());
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("run_command_id_invalid");
      const normalizedKind = this.normalizeKind(kind);
      const normalizedScopeId = scopeId == null || String(scopeId).trim() === "" ? null : String(scopeId);
      const normalizedEpoch = this.normalizeEpoch(epoch);
      const queuedAt = now();
      const requestedExpiresAt = expiresAt == null ? NaN : Number(expiresAt);
      const requestedTtl = expiresInMs == null ? NaN : Number(expiresInMs);
      const commandExpiresAt = Number.isFinite(requestedExpiresAt)
        ? requestedExpiresAt
        : normalizedKind === "conversation_close" ? queuedAt + (Number.isFinite(requestedTtl) && requestedTtl > 0 ? requestedTtl : CONVERSATION_CLOSE_TTL_MS) : null;
      const existing = this.pendingCommands.find((command) => command.commandId === id);
      if (existing) return this.snapshot(existing);
      if (normalizedKind === "conversation_close" && normalizedScopeId) {
        const sameScope = this.pendingCommands.find((command) => command.kind === normalizedKind && command.scopeId === normalizedScopeId && PENDING_COMMAND_STATUSES.includes(command.status));
        if (sameScope) return this.snapshot(sameScope);
      }
      const command = {
        commandId: id,
        owner: String(owner || "unknown"),
        kind: normalizedKind,
        effectText: normalizedText,
        scopeId: normalizedScopeId,
        epoch: normalizedEpoch,
        expiresAt: commandExpiresAt,
        destructive: destructive == null ? normalizedKind === "conversation_close" : destructive === true,
        supersedable: supersedable == null ? normalizedKind === "conversation_close" : supersedable === true,
        writtenAt: null,
        lastWrittenAt: null,
        writeAttempts: 0,
        queuedAt,
        status: "queued",
        ackMarker: `VOTC:RUN_ACK/${normalizedKind.toUpperCase()}/${id}`
      };
      this.pendingCommands.push(command);
      try {
        this.saveStateOrThrow();
      } catch (error) {
        this.pendingCommands.pop();
        throw new Error(`run_command_persist_failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.logRunCommand("enqueue", command, null);
      if (this.pendingCommands.length === 1 && this.recoveryCompleted) return this.writeActiveCommand();
      return this.snapshot(command);
    }
    write(text, options = {}) {
      return this.enqueueCommand({
        effectText: text,
        owner: options.owner || "action",
        kind: options.kind || "action_effect",
        commandId: options.commandId || null,
        scopeId: options.scopeId || null,
        epoch: options.epoch ?? null,
        expiresAt: options.expiresAt ?? null,
        expiresInMs: options.expiresInMs ?? null,
        destructive: options.destructive ?? null,
        supersedable: options.supersedable ?? null
      });
    }
    append(text) {
      return this.write(text);
    }
    ackCommand(commandId, kind = null) {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      const normalizedKind = kind ? this.normalizeKind(kind) : null;
      if (!active || active.commandId !== commandId || normalizedKind && normalizedKind !== active.kind) {
        const known = this.recentCommands.find((command) => command.commandId === commandId);
        this.lateAckCount += 1;
        this.lastLateAckAt = now();
        console.warn(`[RunCommand] late_ack ignored id=${String(commandId || "unknown")} kind=${normalizedKind || "unknown"} status=${known?.status || "unknown"}`);
        return null;
      }
      this.pendingCommands.shift();
      const previousStatus = active.status;
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
        this.neutralizeExecutableFile({ expectedCommandId: active.commandId, command: active, reason: "ack_persist_failed" });
        console.error(`RunFileManager: Failed to persist ACK for ${active.commandId}:`, error);
        return null;
      }
      this.logRunCommand("ack", active, previousStatus);
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
        const previousStatus = active.status;
        active.status = "acknowledged";
        active.acknowledgedAt = now();
        active.ackSource = "startup_debug_log_reconciliation";
        this.recentCommands.push(active);
        this.logRunCommand("ack", active, previousStatus, "startup_debug_log_reconciliation");
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
    movePendingCommandToTerminal(commandId, status, reason, { advance = true, neutralize = false } = {}) {
      this.assertStateLoaded();
      const index = this.pendingCommands.findIndex((command) => command.commandId === commandId);
      if (index === -1) return null;
      const [command] = this.pendingCommands.splice(index, 1);
      const previous = this.snapshot(command);
      const hadWriteHistory = this.hasWriteHistory(command);
      const event = status === "quarantined" ? "quarantined" : status;
      const timestamp = now();
      this.setCommandStatus(command, status, {
        event,
        reason,
        failureReason: String(reason || status),
        failedAt: status === "failed" ? timestamp : command.failedAt || null,
        expiredAt: status === "expired" ? timestamp : command.expiredAt || null,
        quarantinedAt: status === "quarantined" ? timestamp : command.quarantinedAt || null,
        cancelledAt: status === "cancelled" ? timestamp : command.cancelledAt || null,
        cancelReason: status === "cancelled" ? String(reason || "cancelled") : command.cancelReason || null
      });
      this.recentCommands.push(command);
      if (!this.saveState()) {
        this.recentCommands.pop();
        Object.assign(command, previous);
        this.pendingCommands.splice(index, 0, command);
        return null;
      }
      let carrierNeutralized = true;
      if (index === 0 && neutralize && hadWriteHistory) {
        carrierNeutralized = this.neutralizeExecutableFile({ expectedCommandId: command.commandId, command, reason });
      }
      if (index === 0 && advance && this.recoveryCompleted) this.writeActiveCommand({ clearWhenEmpty: carrierNeutralized });
      return { ...this.snapshot(command), carrierNeutralized };
    }
    expireCommand(commandId, reason = "command_expired", options = {}) {
      return this.movePendingCommandToTerminal(commandId, "expired", reason, { ...options, neutralize: false });
    }
    expireActiveCommand(reason = "command_expired", options = {}) {
      const active = this.pendingCommands[0];
      return active ? this.expireCommand(active.commandId, reason, options) : null;
    }
    quarantineCommand(commandId, reason = "command_quarantined", options = {}) {
      return this.movePendingCommandToTerminal(commandId, "quarantined", reason, { neutralize: true, ...options });
    }
    quarantineActiveCommand(reason = "command_quarantined", options = {}) {
      const active = this.pendingCommands[0];
      return active ? this.quarantineCommand(active.commandId, reason, options) : null;
    }
    cancelPendingCommands(predicate, reason = "cancelled") {
      this.assertStateLoaded();
      if (typeof predicate !== "function") return [];
      const matches = this.pendingCommands.filter(predicate);
      const results = [];
      let activeRemoved = false;
      let clearWhenEmpty = true;
      for (const command of matches) {
        const wasActive = this.pendingCommands[0]?.commandId === command.commandId;
        const result = this.hasWriteHistory(command)
          ? this.quarantineCommand(command.commandId, reason, { advance: false })
          : this.cancelCommand(command.commandId, reason, { advance: false });
        if (!result) continue;
        results.push(result);
        if (wasActive) {
          activeRemoved = true;
          clearWhenEmpty = clearWhenEmpty && result.carrierNeutralized !== false;
        }
      }
      if (activeRemoved && this.recoveryCompleted) this.writeActiveCommand({ clearWhenEmpty });
      return results;
    }
    cancelSupersededCommands({ kind = "conversation_close", scopeId = null, reason = "superseded_by_new_conversation" } = {}) {
      const normalizedKind = this.normalizeKind(kind);
      const normalizedScopeId = scopeId == null || String(scopeId).trim() === "" ? null : String(scopeId);
      return this.cancelPendingCommands(
        (command) => command.kind === normalizedKind && (normalizedScopeId == null || command.scopeId === normalizedScopeId),
        reason
      );
    }
    failCommand(commandId, reason) {
      return this.movePendingCommandToTerminal(commandId, "failed", String(reason || "unknown_failure"), { neutralize: true });
    }
    cancelCommand(commandId, reason = "cancelled", { advance = true, neutralize = true } = {}) {
      this.assertStateLoaded();
      const index = this.pendingCommands.findIndex((command) => command.commandId === commandId);
      if (index === -1) return null;
      const [command] = this.pendingCommands.splice(index, 1);
      const previous = this.snapshot(command);
      const hadWriteHistory = this.hasWriteHistory(command);
      this.setCommandStatus(command, "cancelled", {
        event: "cancelled",
        reason,
        cancelledAt: now(),
        cancelReason: String(reason)
      });
      this.recentCommands.push(command);
      if (!this.saveState()) {
        this.recentCommands.pop();
        Object.assign(command, previous);
        this.pendingCommands.splice(index, 0, command);
        return null;
      }
      const carrierNeutralized = index !== 0 || !neutralize || !hadWriteHistory
        ? true
        : this.neutralizeExecutableFile({ expectedCommandId: command.commandId, command, reason });
      if (index === 0 && advance && this.recoveryCompleted) this.writeActiveCommand({ clearWhenEmpty: carrierNeutralized });
      return { ...this.snapshot(command), carrierNeutralized };
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
    getQueueHealth() {
      const pending = this.pendingCommands;
      const active = pending[0] || null;
      const ages = pending.map((command) => Number.isFinite(Number(command.queuedAt)) ? Math.max(0, now() - Number(command.queuedAt)) : null).filter((age) => age != null);
      const terminal = [...pending, ...this.recentCommands];
      return {
        pendingCount: pending.length,
        activeCommandId: active?.commandId || null,
        activeKind: active?.kind || null,
        activeStatus: active?.status || null,
        activeAgeMs: active && Number.isFinite(Number(active.queuedAt)) ? Math.max(0, now() - Number(active.queuedAt)) : null,
        oldestQueuedAgeMs: ages.length > 0 ? Math.max(...ages) : null,
        stalledCount: pending.filter((command) => command.status === "stalled").length,
        expiredCount: terminal.filter((command) => command.status === "expired").length,
        quarantinedCount: terminal.filter((command) => command.status === "quarantined").length,
        queueBlocked: Boolean(active && ["blocked", "stalled"].includes(active.status)),
        lateAckCount: this.lateAckCount,
        lastLateAckAt: this.lastLateAckAt
      };
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
        if (this.stateNeedsMigration) this.saveStateOrThrow();
        if (this.pendingCommands.length === 0) {
          this.writeEmptyRunFileIfSafe();
          return [];
        }
        while (this.pendingCommands.length > 0) {
          const active = this.pendingCommands[0];
          if (active.kind === "conversation_close") {
            const reason = active.status === "stalled" ? "legacy_stalled_conversation_close" : "startup_stale_conversation_close";
            const removed = this.hasWriteHistory(active)
              ? this.quarantineCommand(active.commandId, reason, { advance: false })
              : this.expireCommand(active.commandId, reason, { advance: false });
            if (!removed) return this.getPendingCommands();
            continue;
          }
          if (this.isCommandExpired(active)) {
            const removed = this.hasWriteHistory(active)
              ? this.quarantineCommand(active.commandId, `${active.kind}_expired_after_dispatch`, { advance: false })
              : this.expireCommand(active.commandId, `${active.kind}_expired_before_dispatch`, { advance: false });
            if (!removed) return this.getPendingCommands();
            continue;
          }
          if (this.hasWriteHistory(active)) {
            if (active.status !== "stalled") {
              this.setCommandStatus(active, "stalled", {
                event: "stalled",
                reason: "startup_ack_unconfirmed",
                stalledAt: now(),
                failureReason: "startup_ack_unconfirmed"
              });
              this.saveStateOrThrow();
            }
            this.neutralizeExecutableFile({ expectedCommandId: active.commandId, command: active, reason: "startup_unconfirmed_dispatch" });
            return this.getPendingCommands();
          }
          if (active.status !== "queued") {
            this.setCommandStatus(active, "queued", { event: "queued", reason: "startup_recovery" });
            this.saveStateOrThrow();
          }
          this.writeActiveCommand();
          return this.getPendingCommands();
        }
        this.writeEmptyRunFileIfSafe();
        return [];
      } catch (error) {
        this.recoveryCompleted = false;
        throw error;
      }
    }
    markActiveCommandStalledIfNeeded({ ackTimeoutMs = 30000 } = {}) {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      if (!active) return null;
      if (active.kind === "conversation_close" && (this.isStaleConversationClose(active) || active.status === "stalled")) {
        return this.quarantineCommand(active.commandId, this.isStaleConversationClose(active) ? "stale_conversation_close" : "conversation_close_ack_timeout");
      }
      if (this.isCommandExpired(active)) {
        return this.hasWriteHistory(active)
          ? this.quarantineCommand(active.commandId, `${active.kind}_expired_after_dispatch`)
          : this.expireCommand(active.commandId, `${active.kind}_expired_before_dispatch`);
      }
      if (!active || !["awaiting_ack", "written"].includes(active.status)) return null;
      const lastWrittenAt = Number(active.lastWrittenAt ?? active.writtenAt);
      if (!Number.isFinite(lastWrittenAt) || now() - lastWrittenAt < ackTimeoutMs) return null;
      this.logRunCommand("timeout", active, active.status, "ack_timeout");
      if (active.kind === "conversation_close") return this.quarantineCommand(active.commandId, "conversation_close_ack_timeout");
      const previousStatus = active.status;
      this.setCommandStatus(active, "stalled", {
        event: "stalled",
        reason: "ack_timeout",
        stalledAt: now(),
        failureReason: "ack_timeout"
      });
      try {
        this.saveStateOrThrow();
      } catch (error) {
        active.status = previousStatus;
        active.stalledAt = null;
        throw error;
      }
      const carrierNeutralized = this.neutralizeExecutableFile({ expectedCommandId: active.commandId, command: active, reason: "ack_timeout" });
      return { ...this.snapshot(active), carrierNeutralized };
    }
    retryStalledCommand(commandId) {
      this.assertStateLoaded();
      const active = this.pendingCommands[0];
      if (!active || active.commandId !== commandId) throw new Error("run_command_not_active");
      if (active.status !== "stalled") throw new Error("run_command_not_stalled");
      if (active.kind === "conversation_close") throw new Error("run_command_close_not_retryable");
      const previous = this.snapshot(active);
      this.setCommandStatus(active, "queued", {
        event: "retry_authorized",
        reason: "explicit_retry_authorized",
        lastRetryAt: now(),
        failureReason: null,
        stalledAt: null,
        retryAuthorized: true
      });
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
      this.setCommandStatus(active, "queued", {
        event: "retry_authorized",
        reason: "blocked_path_restored",
        lastRetryAt: now(),
        failureReason: null,
        blockedAt: null
      });
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

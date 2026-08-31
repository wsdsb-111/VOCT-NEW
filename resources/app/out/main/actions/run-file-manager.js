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
      this.resolvePath();
      this.loadState();
      this.recoverPendingCommands();
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
    loadState() {
      if (!this.stateFile || !fs$1.existsSync(this.stateFile)) return;
      try {
        const saved = JSON.parse(fs$1.readFileSync(this.stateFile, "utf8"));
        this.pendingCommands = Array.isArray(saved.pendingCommands)
          ? saved.pendingCommands.filter((command) => command && ["queued", "written", "failed"].includes(command.status) && command.commandId && command.effectText)
          : [];
        this.recentCommands = Array.isArray(saved.recentCommands) ? saved.recentCommands.slice(-50) : [];
      } catch (error) {
        console.error("RunFileManager: Failed to load command queue:", error);
      }
    }
    saveState() {
      if (!this.stateFile) return;
      try {
        fs$1.mkdirSync(path.dirname(this.stateFile), { recursive: true });
        const tempPath = `${this.stateFile}.${process.pid}.${now()}.tmp`;
        fs$1.writeFileSync(tempPath, JSON.stringify({ version: 1, pendingCommands: this.pendingCommands, recentCommands: this.recentCommands.slice(-50) }, null, 2), "utf8");
        fs$1.renameSync(tempPath, this.stateFile);
      } catch (error) {
        console.error("RunFileManager: Failed to persist command queue:", error);
      }
    }
    composeCommandText(command) {
      const ackKind = this.normalizeKind(command.kind).toUpperCase();
      return `${String(command.effectText).trim()}
debug_log = "VOTC:RUN_ACK/${ackKind}/${command.commandId}"
root = {trigger_event = mcc_event_v2.9003}`;
    }
    writeActiveCommand() {
      const command = this.pendingCommands[0];
      if (!command) {
        if (this.path && fs$1.existsSync(this.path)) fs$1.writeFileSync(this.path, "", "utf8");
        this.saveState();
        return null;
      }
      if (!this.resolvePath()) return null;
      try {
        fs$1.writeFileSync(this.path, this.composeCommandText(command), "utf8");
        command.status = "written";
        command.writtenAt = command.writtenAt || now();
        this.saveState();
        console.log(`[RunCommand] written id=${command.commandId} owner=${command.owner} kind=${command.kind}`);
        return this.snapshot(command);
      } catch (error) {
        command.status = "failed";
        command.failedAt = now();
        command.failureReason = error instanceof Error ? error.message : String(error);
        this.saveState();
        console.error(`RunFileManager: Failed to write command ${command.commandId}:`, error);
        return null;
      }
    }
    enqueueCommand({ commandId = null, owner = "action", kind = "action_effect", effectText }) {
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
        queuedAt: now(),
        status: "queued",
        ackMarker: `VOTC:RUN_ACK/${this.normalizeKind(kind).toUpperCase()}/${id}`
      };
      this.pendingCommands.push(command);
      this.saveState();
      if (this.pendingCommands.length === 1) this.writeActiveCommand();
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
      const active = this.pendingCommands[0];
      if (!active || active.commandId !== commandId) return null;
      if (kind && this.normalizeKind(kind) !== active.kind) return null;
      this.pendingCommands.shift();
      active.status = "acknowledged";
      active.acknowledgedAt = now();
      this.recentCommands.push(active);
      this.saveState();
      console.log(`[RunCommand] acknowledged id=${active.commandId} owner=${active.owner} kind=${active.kind}`);
      this.writeActiveCommand();
      return this.snapshot(active);
    }
    failCommand(commandId, reason) {
      const index = this.pendingCommands.findIndex((command) => command.commandId === commandId);
      if (index === -1) return null;
      const [command] = this.pendingCommands.splice(index, 1);
      command.status = "failed";
      command.failedAt = now();
      command.failureReason = String(reason || "unknown_failure");
      this.recentCommands.push(command);
      this.saveState();
      if (index === 0) this.writeActiveCommand();
      return this.snapshot(command);
    }
    cancelCommand(commandId, reason = "cancelled") {
      const index = this.pendingCommands.findIndex((command) => command.commandId === commandId);
      if (index === -1) return null;
      const [command] = this.pendingCommands.splice(index, 1);
      command.status = "cancelled";
      command.cancelledAt = now();
      command.cancelReason = String(reason);
      this.recentCommands.push(command);
      this.saveState();
      if (index === 0) this.writeActiveCommand();
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
      if (this.pendingCommands.length === 0) return [];
      this.pendingCommands[0].status = "queued";
      this.pendingCommands[0].writtenAt = null;
      this.writeActiveCommand();
      return this.getPendingCommands();
    }
    clear() {
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
      return this.resolvePath() !== null;
    }
  }

  return RunFileManager;
}

module.exports = { createRunFileManager };

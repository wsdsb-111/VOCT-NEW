"use strict";

function createLetterEffectTransport({ settingsRepository, fs, path, runFileManager = null, dataDir = null }) {
  const modes = Object.freeze({
    LEGACY: "legacy_letters_file",
    VOTC: "votc_run_file"
  });
  class LetterEffectTransport {
    constructor() {
      this.stateFile = dataDir ? path.join(dataDir, "letter-transport-state.json") : null;
      this.state = {
        version: 2,
        outboundMode: modes.VOTC,
        diagnostics: { A1: null, A2: null },
        contractDriftConfirmed: false,
        updatedAt: null
      };
      this.loadState();
    }
    loadState() {
      if (!this.stateFile || !fs.existsSync(this.stateFile)) return;
      try {
        const saved = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
        this.state = {
          ...this.state,
          ...saved,
          outboundMode: modes.VOTC,
          diagnostics: { A1: saved?.diagnostics?.A1 || null, A2: saved?.diagnostics?.A2 || null }
        };
      } catch (error) {
        console.error("LetterEffectTransport: Failed to load transport state:", error);
      }
    }
    saveState() {
      if (!this.stateFile) return;
      try {
        fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
        fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), "utf8");
      } catch (error) {
        console.error("LetterEffectTransport: Failed to save transport state:", error);
      }
    }
    getState() {
      return { ...this.state, diagnostics: { ...this.state.diagnostics } };
    }
    getOutboundMode() {
      return this.state.outboundMode;
    }
    writeDiagnosticEffect(effectText, mode) {
      return this.writeEffect(effectText, mode, { owner: "letter", kind: "letter_diagnostic" });
    }
    writeOutboundLetterEffect(effectText, mode = this.state.outboundMode) {
      return this.writeEffect(effectText, mode, { owner: "letter", kind: "letter_effect" });
    }
    writeEffect(effectText, mode, commandMetadata = {}) {
      if (mode === modes.VOTC) return this.writeViaRunFileManager(effectText, commandMetadata);
      if (mode !== modes.LEGACY) return { success: false, mode, error: `Unknown Letter Effect transport mode: ${mode}` };
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      if (!ck3Folder) return { success: false, mode, error: "CK3 user folder not configured." };
      const effectFilePath = path.join(ck3Folder, "run", "letters.txt");
      try {
        fs.mkdirSync(path.dirname(effectFilePath), { recursive: true });
        fs.writeFileSync(effectFilePath, effectText, "utf8");
        return { success: true, mode, effectFilePath };
      } catch (error) {
        return { success: false, mode, effectFilePath, error: error instanceof Error ? error.message : String(error) };
      }
    }
    writeViaRunFileManager(effectText, commandMetadata = {}) {
      if (!runFileManager || typeof runFileManager.write !== "function") return { success: false, mode: modes.VOTC, error: "Action RunFileManager is unavailable." };
      try {
        const command = runFileManager.write(effectText, commandMetadata);
        const effectFilePath = runFileManager.path || null;
        if (command?.commandId) return { success: true, mode: modes.VOTC, effectFilePath, commandId: command.commandId, commandStatus: command.status };
        const written = Boolean(effectFilePath && fs.existsSync(effectFilePath) && fs.readFileSync(effectFilePath, "utf8").includes(effectText));
        return written ? { success: true, mode: modes.VOTC, effectFilePath } : { success: false, mode: modes.VOTC, effectFilePath, error: "RunFileManager did not queue the Letter Effect." };
      } catch (error) {
        return { success: false, mode: modes.VOTC, effectFilePath: runFileManager.path || null, error: error instanceof Error ? error.message : String(error) };
      }
    }
    recordTransportDiagnostic(stage, result) {
      if (!Object.prototype.hasOwnProperty.call(this.state.diagnostics, stage)) return this.getState();
      this.state.diagnostics[stage] = { result, recordedAt: Date.now() };
      const legacyResult = this.state.diagnostics.A1?.result;
      const votcResult = this.state.diagnostics.A2?.result;
      this.state.outboundMode = modes.VOTC;
      if (legacyResult === "RUN_FILE_NOT_EXECUTED" && votcResult === "PASS") {
        this.state.contractDriftConfirmed = true;
      } else if (legacyResult && votcResult) {
        this.state.contractDriftConfirmed = false;
      }
      this.state.updatedAt = Date.now();
      this.saveState();
      return this.getState();
    }
    clearOutboundEffect(mode = this.state.outboundMode) {
      if (mode === modes.VOTC) {
        return { success: true, mode, effectFilePath: runFileManager?.path || null, cleanupOwner: "run_command_ack_queue" };
      }
      const ck3Folder = settingsRepository.getCK3UserFolderPath();
      if (!ck3Folder) return { success: false, mode, error: "CK3 user folder not configured." };
      const effectFilePath = path.join(ck3Folder, "run", "letters.txt");
      try {
        fs.mkdirSync(path.dirname(effectFilePath), { recursive: true });
        fs.writeFileSync(effectFilePath, `debug_log = "[Localize('talk_event.9999.desc')]"`, "utf8");
        return { success: true, mode, effectFilePath };
      } catch (error) {
        return { success: false, mode, effectFilePath, error: error instanceof Error ? error.message : String(error) };
      }
    }
    cancelOutboundEffect(mode, effectText, commandId = null) {
      if (mode !== modes.VOTC) return this.clearOutboundEffect(mode);
      const effectFilePath = runFileManager?.path || null;
      if (commandId && typeof runFileManager?.cancelCommand === "function") {
        const cancelled = runFileManager.cancelCommand(commandId, "letter_effect_cancelled");
        return cancelled
          ? { success: true, mode, effectFilePath, commandId, cancelledStatus: cancelled.status }
          : { success: false, mode, effectFilePath, commandId, error: "Pending Run Command was not found; it may already be acknowledged." };
      }
      if (!effectFilePath || !effectText) return { success: false, mode, effectFilePath, error: "Pending Letter Effect text is unavailable for safe cancellation." };
      try {
        const currentText = fs.readFileSync(effectFilePath, "utf8");
        const topLevelEffect = `${effectText}\n  `;
        const nestedEffect = `  ${effectText}\n  `;
        let nextText = currentText;
        if (currentText.startsWith(topLevelEffect)) nextText = currentText.slice(topLevelEffect.length);
        else if (currentText.includes(nestedEffect)) nextText = currentText.replace(nestedEffect, "  ");
        else return { success: false, mode, effectFilePath, error: "Pending Letter Effect was not found; unrelated votc.txt commands were preserved." };
        fs.writeFileSync(effectFilePath, nextText, "utf8");
        return { success: true, mode, effectFilePath };
      } catch (error) {
        return { success: false, mode, effectFilePath, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  return { LetterEffectTransport, LetterEffectTransportMode: modes };
}

module.exports = { createLetterEffectTransport };

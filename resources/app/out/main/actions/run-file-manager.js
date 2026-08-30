"use strict";

function createRunFileManager({ settingsRepository, path, fs }) {
  const fs$1 = fs;
  class RunFileManager {
    constructor() {
      this.ck3UserPath = settingsRepository.getCK3UserFolderPath() || null;
      console.log(`RunFileManager: CK3 user path from settings: ${this.ck3UserPath}`);
      if (this.ck3UserPath) {
        this.path = path.join(this.ck3UserPath, "run", "votc.txt");
        console.log(`RunFileManager: Resolved votc.txt path: ${this.path}`);
        this.createRunFolder(this.ck3UserPath);
      } else {
        console.warn("RunFileManager: CK3 user folder path is not configured. Run file operations will be disabled.");
        this.path = null;
      }
    }
    write(text) {
      if (!this.path) {
        if (!this.ck3UserPath) {
          this.ck3UserPath = settingsRepository.getCK3UserFolderPath() || null;
        }
        if (!this.ck3UserPath) {
          console.warn("RunFileManager: CK3 user folder path is not configured. Run file operations will be disabled.");
          return;
        }
        this.createRunFolder(this.ck3UserPath);
        this.path = path.join(this.ck3UserPath, "run", "votc.txt");
        console.log(`RunFileManager: Successfully resolved votc.txt path: ${this.path}`);
      }
      try {
        const currentText = fs$1.readFileSync(this.path, "utf-8");
        console.log(`RunFileManager: Current text in run file: ${currentText}`);
        if (currentText.trim() === "") {
          console.log(`RunFileManager: Run file is empty - writing to it: ${text}`);
          fs$1.writeFileSync(
            this.path,
            `${text}
  root = {trigger_event = mcc_event_v2.9003}`,
            "utf-8"
          );
        } else {
          console.log(`RunFileManager: Run file is not empty - prepending to it: ${text}`);
          fs$1.writeFileSync(
            this.path,
            `${text}
  ${currentText}`,
            "utf-8"
          );
        }
      } catch (error) {
        console.error(`RunFileManager: Failed to write to file ${this.path}:`, error);
      }
    }
    append(text) {
      if (!this.path) {
        console.warn("RunFileManager: Cannot append - CK3 user folder is not configured");
        return;
      }
      try {
        fs$1.appendFileSync(this.path, text, "utf-8");
        console.log(`RunFileManager: appended to run file: ${text}`);
      } catch (error) {
        console.error(`RunFileManager: Failed to append to file ${this.path}:`, error);
      }
    }
    clear() {
      if (!this.path) {
        console.warn("RunFileManager: Cannot clear - CK3 user folder is not configured");
        return;
      }
      try {
        fs$1.writeFileSync(this.path, "", "utf-8");
        console.log("RunFileManager: Run File cleared");
      } catch (error) {
        console.error(`RunFileManager: Failed to clear file ${this.path}:`, error);
      }
    }
    createRunFolder(userFolderPath) {
      const runFolderPath = path.join(userFolderPath, "run");
      console.log(`RunFileManager: Checking run folder path: ${runFolderPath}`);
      if (!fs$1.existsSync(runFolderPath)) {
        try {
          fs$1.mkdirSync(runFolderPath, { recursive: true });
          console.log(`RunFileManager: Created run folder: ${runFolderPath}`);
        } catch (err) {
          console.error(`RunFileManager: Error creating run folder ${runFolderPath}:`, err);
        }
      } else {
        console.log(`RunFileManager: Run folder already exists: ${runFolderPath}`);
      }
    }
    // Method to check if run file operations are available
    isAvailable() {
      return this.path !== null;
    }
  }
  
  return RunFileManager;
}

module.exports = { createRunFileManager };

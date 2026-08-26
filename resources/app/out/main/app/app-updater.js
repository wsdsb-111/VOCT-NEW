"use strict";

function createAppUpdater({ electronUpdater, log, settingsRepository, electron, updaterTranslations }) {
  class AppUpdater {
    constructor() {
      this.mainWindow = null;
      this.updateAvailable = false;
      electronUpdater.autoUpdater.logger = log;
      electronUpdater.autoUpdater.autoDownload = false;
      electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
      this.setupEventHandlers();
    }
    setMainWindow(window) {
      this.mainWindow = window;
    }
    checkForUpdates() {
      log.info("Checking for updates...");
      electronUpdater.autoUpdater.allowPrerelease = settingsRepository.getAllowPrerelease();
      log.info(`Prerelease updates ${electronUpdater.autoUpdater.allowPrerelease ? "enabled" : "disabled"}`);
      electronUpdater.autoUpdater.checkForUpdates();
    }
    downloadUpdate() {
      if (this.updateAvailable) {
        log.info("Downloading update...");
        electronUpdater.autoUpdater.downloadUpdate();
      }
    }
    installUpdate() {
      if (this.updateAvailable) {
        log.info("Installing update...");
        electronUpdater.autoUpdater.quitAndInstall(false, true);
      }
    }
    getTranslations() {
      const language = settingsRepository.getLanguage() || "en";
      return updaterTranslations[language] || updaterTranslations.en;
    }
    /**
     * Strip HTML tags and decode common HTML entities from release notes
     */
    stripHtml(html) {
      let text = html.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
      text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<li[^>]*>/gi, "• ");
      text = text.replace(/<[^>]+>/g, "");
      text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
      return text;
    }
    formatReleaseNotes(notes) {
      if (!notes) return "No release notes available.";
      let text = this.stripHtml(notes);
      const maxLength = 500;
      if (text.length > maxLength) {
        return text.substring(0, maxLength) + "...";
      }
      return text;
    }
    /**
     * Check if a version is a pre-release
     */
    isPrerelease(version) {
      const prereleasePatterns = [
        /-alpha/i,
        /-beta/i,
        /-rc/i,
        /-pre/i,
        /-preview/i,
        /-dev/i,
        /-test/i,
        /-snapshot/i,
        /\.0a/i,
        /\.0b/i
      ];
      return prereleasePatterns.some((pattern) => pattern.test(version));
    }
    setupEventHandlers() {
      electronUpdater.autoUpdater.on("checking-for-update", () => {
        log.info("Checking for update...");
      });
      electronUpdater.autoUpdater.on("update-available", (info) => {
        log.info("Update available:", info);
        this.updateAvailable = true;
        this.showUpdateAvailableDialog(info);
      });
      electronUpdater.autoUpdater.on("update-not-available", (info) => {
        log.info("Update not available:", info);
      });
      electronUpdater.autoUpdater.on("error", (err) => {
        log.error("Error in auto-updater:", err);
      });
      electronUpdater.autoUpdater.on("download-progress", (progressObj) => {
        let log_message = "Download speed: " + progressObj.bytesPerSecond;
        log_message = log_message + " - Downloaded " + progressObj.percent + "%";
        log_message = log_message + " (" + progressObj.transferred + "/" + progressObj.total + ")";
        log.info(log_message);
      });
      electronUpdater.autoUpdater.on("update-downloaded", (info) => {
        log.info("Update downloaded:", info);
        this.showUpdateDownloadedDialog();
      });
    }
    async showUpdateAvailableDialog(info) {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
      const t = this.getTranslations();
      const releaseNotes = this.formatReleaseNotes(info.releaseNotes);
      const isPrerelease = this.isPrerelease(info.version);
      const strings = isPrerelease ? t.updateAvailablePrerelease : t.updateAvailable;
      const result = await electron.dialog.showMessageBox(this.mainWindow, {
        type: "info",
        title: strings.title,
        message: strings.message.replace("{version}", info.version),
        detail: strings.detail.replace("{releaseNotes}", releaseNotes),
        buttons: [strings.download, strings.viewChangelog, strings.later],
        defaultId: 0,
        cancelId: 2
      });
      switch (result.response) {
        case 0:
          this.downloadUpdate();
          break;
        case 1:
          const changelogUrl = this.getChangelogUrl(info.version);
          await electron.shell.openExternal(changelogUrl);
          this.showUpdateAvailableDialog(info);
          break;
      }
    }
    /**
     * Get the changelog URL for a given version
     */
    getChangelogUrl(version) {
      return `https://github.com/Voices-of-the-Court/VOTC/releases/tag/v${version}`;
    }
    async showUpdateDownloadedDialog() {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
      const t = this.getTranslations();
      const result = await electron.dialog.showMessageBox(this.mainWindow, {
        type: "info",
        title: t.updateDownloaded.title,
        message: t.updateDownloaded.message,
        detail: t.updateDownloaded.detail,
        buttons: [t.updateDownloaded.installNow, t.updateDownloaded.installOnExit],
        defaultId: 0,
        cancelId: 1
      });
      switch (result.response) {
        case 0:
          this.installUpdate();
          break;
        case 1:
          electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
          break;
      }
    }
  }
  
  return AppUpdater;
}

module.exports = { createAppUpdater };

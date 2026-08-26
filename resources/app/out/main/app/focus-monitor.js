"use strict";

function createFocusMonitor({ events, activeWin, electron }) {
  class FocusMonitor extends events.EventEmitter {
    constructor() {
      super();
      this.pollingInterval = null;
      this.isOverlayMode = false;
      this.lastStateChangeTime = 0;
      this.POLL_INTERVAL_MS = 500;
      this.MIN_STATE_CHANGE_INTERVAL_MS = 200;
    }
    /**
     * Start monitoring the active window
     */
    start() {
      if (this.pollingInterval) {
        console.log("FocusMonitor: Already running");
        return;
      }
      console.log("FocusMonitor: Starting...");
      this.checkActiveWindow();
      this.pollingInterval = setInterval(() => {
        this.checkActiveWindow();
      }, this.POLL_INTERVAL_MS);
    }
    /**
     * Stop monitoring the active window
     */
    stop() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
        console.log("FocusMonitor: Stopped");
      }
    }
    /**
     * Get the current overlay state
     */
    getCurrentOverlayState() {
      return this.isOverlayMode;
    }
    /**
     * Check the currently active window and update overlay state
     */
    async checkActiveWindow() {
      try {
        const activeWindow = await activeWin();
        if (!activeWindow) {
          return;
        }
        const shouldBeOverlay = this.shouldBeInOverlayMode(activeWindow);
        if (shouldBeOverlay !== this.isOverlayMode) {
          const now = Date.now();
          if (now - this.lastStateChangeTime >= this.MIN_STATE_CHANGE_INTERVAL_MS) {
            this.isOverlayMode = shouldBeOverlay;
            this.lastStateChangeTime = now;
            console.log(`FocusMonitor: Overlay mode ${shouldBeOverlay ? "ENABLED" : "DISABLED"} (focused: ${activeWindow.owner.name})`);
            this.emit("overlay-state-changed", shouldBeOverlay);
          }
        }
      } catch (error) {
        if (error instanceof Error && !error.message.includes("EACCES")) {
          console.error("FocusMonitor: Error checking active window:", error);
        }
      }
    }
    /**
     * Determine if the app should be in overlay mode based on the active window
     */
    shouldBeInOverlayMode(activeWindow) {
      const processName = activeWindow.owner.name.toLowerCase();
      const processPath = activeWindow.owner.path?.toLowerCase() || "";
      if (processName.includes("ck3") || processPath.includes("ck3.exe")) {
        return true;
      }
      const ourAppName = this.getOurAppName();
      if (processName.includes(ourAppName.toLowerCase())) {
        return true;
      }
      const ourAppPath = process.execPath.toLowerCase();
      if (processPath === ourAppPath) {
        return true;
      }
      return false;
    }
    /**
     * Get the name of our application executable
     */
    getOurAppName() {
      if (electron.app.isPackaged) {
        return electron.app.getName();
      } else {
        return "electron";
      }
    }
  }
  
  return FocusMonitor;
}

module.exports = { createFocusMonitor };

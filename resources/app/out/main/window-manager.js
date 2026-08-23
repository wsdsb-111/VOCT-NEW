"use strict";

function createChatWindow({ electron, preloadPath, rendererPath, rendererUrl = null }) {
  const primaryDisplay = electron.screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.workArea;
  const window = new electron.BrowserWindow({
    x,
    y,
    width,
    height,
    show: true,
    transparent: true,
    frame: false,
    fullscreen: false,
    thickFrame: false,
    hasShadow: false,
    resizable: false,
    roundedCorners: false,
    webPreferences: {
      partition: "persist:chat",
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  window.setIgnoreMouseEvents(true, { forward: true });
  if (rendererUrl) window.loadURL(rendererUrl);
  else window.loadFile(rendererPath);
  electron.ipcMain.on("set-ignore-mouse-events", (event, ignore) => {
    const senderWindow = electron.BrowserWindow.fromWebContents(event.sender);
    if (senderWindow) senderWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });
  return window;
}

module.exports = { createChatWindow };

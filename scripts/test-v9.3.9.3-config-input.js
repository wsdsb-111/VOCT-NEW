"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app/renderer/assets/index-Dn3qWlAB.js"), "utf8").replace(/\r\n/g, "\n");
const appStart = source.indexOf("function App() {");
const appEnd = source.indexOf("\nconst {", appStart);
assert(appStart >= 0 && appEnd > appStart);
const captureStart = source.indexOf("function syncOverlayMouseCapture() {");
const captureSource = captureStart < 0 ? "" : source.slice(captureStart, source.indexOf("\nconst useWindowEvents", captureStart));

function fixture({ chat = true, overPanel = true } = {}) {
  const state = [chat, true, true];
  let cursor = 0;
  let effects = [];
  let tree;
  const frames = new Map();
  let frameId = 0;
  const captures = [false]; // The settings panel initially captures mouse input.
  const listeners = {};
  const electronAPI = { setIgnoreMouseEvents: value => captures.push(value) };
  for (const name of ["onChatReset", "onToggleSettings", "onHideChat", "onOverlayVisibilityChange"]) {
    electronAPI[name] = callback => { listeners[name] = callback; return () => {}; };
  }
  const context = vm.createContext({
    console: { log() {} },
    window: { electronAPI, localStorage: { getItem: () => null } },
    document: { querySelector: () => state[2] && overPanel && (state[0] || state[1]) ? {} : null,
      documentElement: { setAttribute() {}, style: { setProperty() {} } } },
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    useConfigStore: selector => selector({ loadSettings() {} }),
    useAppSettings: () => null,
    Chat: "Chat", ConfigPanel: "ConfigPanel",
    reactExports: {
      useState(initial) {
        const index = cursor++;
        if (state[index] === undefined) state[index] = initial;
        return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useEffect(effect) { effects.push(effect); },
      useCallback: callback => callback
    },
    jsxRuntimeExports: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  });
  vm.runInContext(`${captureSource}\n${source.slice(appStart, appEnd)}\nglobalThis.renderApp = App;`, context);
  function render() {
    cursor = 0;
    effects = [];
    tree = context.renderApp();
    effects.forEach(effect => effect());
  }
  function flush() { for (const [id, callback] of frames) { frames.delete(id); callback(); } }
  render();
  flush();
  return { state, captures, listeners, render, flush,
    close(mode) {
      if (mode === "close") tree.props.children.find(child => child?.type === "ConfigPanel").props.onClose();
      else if (mode === "shortcut") listeners.onToggleSettings();
      else tree.props.children.find(child => child?.type === "Chat").props.onToggleConfig();
      render();
      flush();
    } };
}

for (const mode of ["close", "shortcut", "gear"]) {
  const chat = fixture();
  chat.close(mode);
  assert.equal(chat.state[1], false);
  assert.equal(chat.captures.at(-1), false, `${mode}: returning over chat must capture input without another mouse-enter event`);
  const outside = fixture({ overPanel: false });
  outside.close(mode);
  assert.equal(outside.captures.at(-1), true, `${mode}: empty overlay space must remain click-through`);
}
const configOnly = fixture({ chat: false, overPanel: false });
configOnly.close("close");
assert.equal(configOnly.captures.at(-1), true, "closing the only panel must not block the game");
const hidden = fixture();
hidden.listeners.onOverlayVisibilityChange(false);
hidden.render();
hidden.flush();
assert.equal(hidden.captures.at(-1), true, "a hidden overlay must not intercept input");
const rapid = fixture();
rapid.listeners.onToggleSettings();
rapid.render();
rapid.listeners.onToggleSettings();
rapid.render();
rapid.flush();
assert.equal(rapid.state[1], true);
assert.equal(rapid.captures.at(-1), false, "deferred updates must reflect the current panel after rapid toggles");
for (const file of ["src/app/main/main.js", "resources/app/out/main/main.js"]) {
  const main = fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n");
  const start = main.indexOf("const setupFocusMonitoring = (window) => {");
  const end = main.indexOf('\nelectron.app.on("ready"', start);
  assert(start >= 0 && end > start);
  const listeners = new Map();
  const calls = [];
  const window = { isDestroyed: () => false, webContents: { send() {} },
    setAlwaysOnTop() {}, setIgnoreMouseEvents: (...args) => calls.push(args), on() {} };
  const monitor = { on: (event, callback) => listeners.set(event, callback), start() {} };
  vm.runInNewContext(`${main.slice(start, end)}\nsetupFocusMonitoring(window);`, { window, focusMonitor: monitor });
  listeners.get("overlay-state-changed")(true);
  assert.equal(calls.length, 0, `${file}: activating a full-screen transparent window must not capture the entire desktop`);
  listeners.get("overlay-state-changed")(false);
  assert.equal(calls.at(-1)[0], true);
  listeners.get("overlay-state-changed")(true);
  assert.equal(calls.length, 1, `${file}: returning from another app must leave panel hit-testing to the renderer`);
}
for (const file of ["../src/app/main/window-manager", "../resources/app/out/main/window-manager"]) {
  const windowManager = require(file);
  let windowOptions;
  class FakeWindow {
    constructor(options) { windowOptions = options; }
    setIgnoreMouseEvents() {}
    loadFile() {}
  }
  windowManager.createChatWindow({ electron: {
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 900 } }) },
    BrowserWindow: FakeWindow, ipcMain: { on() {} }
  }, preloadPath: "preload.js", rendererPath: "index.html" });
  assert.equal(windowOptions.webPreferences.backgroundThrottling, false, `${file}: an unfocused game overlay must keep processing panel input updates`);
  assert.equal(windowOptions.webPreferences.contextIsolation, true);
  assert.equal(windowOptions.webPreferences.nodeIntegration, false);
}
console.log("V9.3.9.3 config return input: PASS (close/shortcut/gear, stationary pointer, blank-space click-through, focus changes and background overlay)");

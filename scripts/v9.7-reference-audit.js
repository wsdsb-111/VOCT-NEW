"use strict";

// Offline inventory only. Never load Main, user templates or a real Electron API.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("audit_symlink_rejected");
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}

function captureIpc({ preloadSource, registrationSource, mainSource } = {}) {
  const preloadFile = path.join(root, "src/app/preload/preload.js");
  const registrationFile = path.join(root, "src/app/main/ipc/register-ipc.js");
  const surfaces = {};
  const routes = [];
  let current = null;
  const ipcRenderer = Object.fromEntries(["invoke", "send", "on", "removeListener"].map(kind => [kind, channel => {
    if (current && kind !== "removeListener") routes.push({ exposure: current, kind, channel });
    return Promise.resolve(null);
  }]));
  vm.runInNewContext(preloadSource ?? fs.readFileSync(preloadFile, "utf8"), {
    require: name => {
      if (name !== "electron") throw new Error("audit_preload_import_rejected");
      return { ipcRenderer, contextBridge: { exposeInMainWorld: (name, api) => { surfaces[name] = api; } } };
    }
  }, { filename: preloadFile, timeout: 2000 });
  for (const [surface, api] of Object.entries(surfaces)) {
    for (const [method, callback] of Object.entries(api)) {
      if (typeof callback !== "function") throw new Error("audit_unknown_preload_export");
      current = `${surface}.${method}`;
      // Both argument branches of llmConfigAPI.listModels are public contracts.
      callback();
      if (current === "llmConfigAPI.listModels") callback("synthetic-provider");
    }
  }
  const handlers = new Map();
  const exported = { exports: {} };
  const localRequire = createRequire(registrationFile);
  vm.runInNewContext(registrationSource ?? fs.readFileSync(registrationFile, "utf8"), {
    module: exported, exports: exported.exports, require: localRequire,
    console: { log() {} }
  }, { filename: registrationFile, timeout: 2000 });
  const noop = () => {};
  exported.exports.registerIpcHandlers({
    electron: { ipcMain: { handle: (channel, callback) => {
      if (handlers.has(channel)) throw new Error(`audit_duplicate_handler:${channel}`);
      handlers.set(channel, callback);
    } } },
    worldlineService: {}, characterKnowledgeService: {},
    conversationManager: { onConversationUpdate: noop, onContextUsageUpdate: noop }
  });
  const main = mainSource ?? fs.readFileSync(path.join(root, "src/app/main/main.js"), "utf8");
  const windowController = fs.readFileSync(path.join(root, "src/app/main/window-manager.js"), "utf8");
  const sendHandlers = [...(main + windowController).matchAll(/ipcMain\.on\("([^"]+)"/g)].map(match => match[1]);
  const rows = [...new Map(routes.map(route => [JSON.stringify(route), route])).values()]
    .sort((a, b) => a.exposure.localeCompare(b.exposure, "en"));
  for (const row of rows) {
    if (row.kind === "invoke" && !handlers.has(row.channel)) throw new Error(`audit_missing_handler:${row.channel}`);
    if (row.kind === "send" && !sendHandlers.includes(row.channel)) {
      throw new Error(`audit_missing_event_handler:${row.channel}`);
    }
    row.handlerOwner = row.kind === "invoke" ? "main/ipc/register-ipc.js"
      : row.kind === "send" ? "main/main.js + main/window-manager.js" : "Main event -> Preload listener";
    row.serviceCalls = row.kind === "invoke"
      ? [...new Set([...handlers.get(row.channel).toString().matchAll(/\b([a-zA-Z_$][\w$]*)\??\.([a-zA-Z_$][\w$]*)\??\(/g)]
        .map(match => `${match[1]}.${match[2]}`))].sort() : [];
  }
  return { routes: rows, handlers: [...handlers.keys()].sort(), sendHandlers: sendHandlers.sort() };
}

function auditReferences() {
  const mappings = JSON.parse(fs.readFileSync(path.join(root, "build/runtime-inputs.json"), "utf8")).files;
  const sources = filesUnder(path.join(root, "src/app")).filter(file => /\.js$/.test(file));
  const relativeImports = [];
  const dynamicSites = [];
  for (const file of sources) {
    const source = fs.readFileSync(file, "utf8");
    const from = path.relative(root, file).replaceAll("\\", "/");
    for (const match of source.matchAll(/require\(\s*(["'])(\.[^"']+)\1\s*\)/g)) {
      const target = path.resolve(path.dirname(file), match[2]);
      let resolved = [target, target + ".js", target + ".json", path.join(target, "index.js")]
        .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!resolved) {
        // Source and installed Main have different package.json relative paths.
        const mapping = mappings.find(item => `src/app/${item.source}` === from);
        const installed = mapping && path.posix.normalize(path.posix.join(path.posix.dirname(mapping.target), match[2]));
        const mappedTarget = mappings.find(item => item.target === installed);
        if (mappedTarget) resolved = path.join(root, "src/app", mappedTarget.source);
      }
      if (!resolved) throw new Error(`audit_dangling_import:${from}:${match[2]}`);
      relativeImports.push({ from, to: path.relative(root, resolved).replaceAll("\\", "/") });
    }
    for (const match of source.matchAll(/\b(?:require|import)\(\s*(?![\s"'])|\b(?:eval|Function|runInNewContext|runInContext|Script)\s*\(/g)) {
      dynamicSites.push({ file: from, line: source.slice(0, match.index).split("\n").length });
    }
  }
  const ipc = captureIpc();
  const renderer = sources.filter(file => file.includes(`${path.sep}renderer${path.sep}`))
    .map(file => ({ file: path.relative(root, file).replaceAll("\\", "/"), source: fs.readFileSync(file, "utf8") }));
  for (const row of ipc.routes) {
    row.rendererConsumers = renderer.filter(item => item.source.includes(row.exposure)).map(item => item.file);
  }
  return { sourceFiles: sources.length, relativeImports, dynamicSites, ipc };
}

if (require.main === module) console.log(JSON.stringify(auditReferences(), null, 2));
module.exports = { auditReferences, captureIpc, filesUnder };

"use strict";
// Optional interactive browser fixture: actual packaged React + actual Canon workers,
// isolated temp profile. Never points at APPDATA or a real game save.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { CanonService } = require("../resources/app/out/main/worldline/canon-service");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v87-ui-"));
const renderer = path.resolve(__dirname, "../resources/app/out/renderer");
const token = crypto.randomUUID();
const checkpoint = { id: "ui-fixture", source: { path: "C:\\fixture\\A.ck3", fingerprint: "a".repeat(64) }, snapshot: { playthroughId: "ui-fixture", gameDate: "1171.9.20", characters: { "1": { id: "1" } } } };
const service = new CanonService({ root, getCheckpoint: () => checkpoint, getLiveState: () => ({ gameDate: "1171.9.20" }) });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/rpc" && req.headers["x-fixture-token"] === token) {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 30000) throw new Error("payload_too_large"); }
      const { method, args } = JSON.parse(body);
      const calls = {
        listCanon: async () => ({ ...await service.list(args[0]), promptEnabled: false }),
        mutateCanon: () => service.mutate(args[0]),
        getCanonHistory: () => service.history(args[0]),
        confirmCanonBranch: () => service.confirm(args[0]),
        forkCanonBranch: () => service.fork(args[0]),
        resumeCanonBranch: () => service.resume(args[0]),
        renameCanonBranch: () => service.rename(args[0]),
        listCanonCharacterOptions: () => ({ options: [{ runtimeId: "1", displayName: "测试角色", currentlyPresent: true }], total: 1 }),
        testCanonRecall: () => service.testRecall(args[0]),
        setRecallSettings: () => ({ promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION" })
      };
      if (!Object.hasOwn(calls, method)) throw new Error("method_denied");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(await calls[method]())); return;
    }
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/index-WtJH_nua.css"></head><body style="background:#171411"><div id="root" class="worldline-view" style="max-width:1000px;margin:auto"></div><script>window.worldlineAPI=Object.fromEntries(['listCanon','mutateCanon','getCanonHistory','confirmCanonBranch','forkCanonBranch','resumeCanonBranch','renameCanonBranch','listCanonCharacterOptions','testCanonRecall','setRecallSettings'].map(method=>[method,async(...args)=>{const response=await fetch('/rpc',{method:'POST',headers:{'x-fixture-token':${JSON.stringify(token)}},body:JSON.stringify({method,args})});const value=await response.json();if(!response.ok)throw Error(value.error);return value}]));window.worldlineAPI.onUpdated=()=>()=>{};</script><script type="module" src="/assets/index-Dn3qWlAB.js"></script></body></html>`); return;
    }
    const file = path.resolve(renderer, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(renderer + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(file);
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp" })[ext] || "application/octet-stream");
    if (file.endsWith("index-Dn3qWlAB.js")) res.end(fs.readFileSync(file, "utf8").replace("jsxRuntimeExports.jsx(App, {})", "jsxRuntimeExports.jsx(WorldMemoryEditor, { react: reactExports })"));
    else fs.createReadStream(file).pipe(res);
  } catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
});
server.listen(0, "127.0.0.1", () => console.log(`V8.7 isolated UI: http://127.0.0.1:${server.address().port}`));
process.once("SIGINT", () => server.close(() => process.exit(0)));

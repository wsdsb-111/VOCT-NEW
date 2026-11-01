"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { id: versionPath, filename: versionPath, loaded: true,
  exports: require("../resources/app/out/main/version") };
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { filesUnder } = require("./v9.7-reference-audit");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v97-readonly-"));
function write(relative, data) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2));
}
function snapshot() {
  return Object.fromEntries(filesUnder(root).map(file => [path.relative(root, file),
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
}
try {
  const scope = { campaignToken: "synthetic-v97", ownerId: 100, counterpartId: 200 };
  const row = (id, content, extra = {}) => ({ playerId: 100, characterId: 200, perspectiveOwnerId: 100,
    date: "1090.1.1", campaignToken: scope.campaignToken, finalizationId: id, conversationId: id,
    content, conversationType: "pair", participants: [{ id: 100 }, { id: 200 }], ...extra });
  const kept = row("kept", "手动修订正文\r\n【需要长期记住的事项】\n- 甲答应保管铜钥匙。\n【其他事项】\n无");
  const forgotten = row("forgotten", "FORGOTTEN_SENTINEL 不得复活");
  write("summaries/100_甲/与乙的对话.json", [kept, forgotten,
    row("wrong-owner", "WRONG_OWNER_SENTINEL", { perspectiveOwnerId: 300 }),
    row("official", "OFFICIAL_DEDICATED_ROUTE", { sourceType: "CK3_OFFICIAL_RECOLLECTION" })]);
  write("summaries/101_旧角色/与乙的对话.json", [{ date: "1090.1.1", playerId: 101, characterId: 200, content: "旧 V8 无战役来源正文" }]);
  // Opaque retained bytes are not parsed, upgraded or normalized by Legacy reading.
  write("memory/archiveSidecar/legacy.json", "\ufeff{\r\n  \"synthetic\": true\r\n}\r\n");
  for (const file of ["pending-letters.json", "run-command-queue.json", "finalization-recovery.json",
    "settings-v8.json", "canon.json", "branch-registry.json"]) write(`retained/${file}`, "\ufeff{\r\n  \"synthetic\": true\r\n}\r\n");
  const options = { baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries") };
  const store = new MemoryStore(options);
  // Explicit fixture operation; the protected read/restart phase starts afterwards.
  assert(store.recordForgottenSummaryProjection(forgotten, { ownerId: 100, counterpartId: 200 }));
  const before = snapshot();
  const read = current => {
    const memories = current.loadFolderSummariesForCharacter(100);
    assert(memories.some(memory => memory.content === kept.content), "manual source edits survive exact reading");
    assert(!memories.some(memory => /FORGOTTEN_SENTINEL|WRONG_OWNER_SENTINEL|OFFICIAL_DEDICATED_ROUTE/.test(memory.content)),
      "Forget, perspective ownership and dedicated official route stay enforced");
    assert.equal(current.listForgottenSummaryProjections().length, 1);
    const preview = current.pairLedger.preview(scope, { currentGameDate: "1100.1.1" });
    assert.equal(preview.counts.candidateItemCount, 1);
    current.pairLedger.get(scope, { currentGameDate: "1100.1.1", readOnly: true });
    assert(!fs.existsSync(current.pairLedger.indexPath(scope)), "readonly preview cannot create a derived index");
    assert(current.loadFolderSummariesForCharacter(101).some(memory => memory.content === "旧 V8 无战役来源正文"),
      "legacy source remains readable; this does not grant cross-campaign recall permission");
  };
  read(store);
  read(new MemoryStore(options));
  assert.deepEqual(snapshot(), before, "all files, including retained opaque data, have identical paths and SHA-256 after reads and restart");
  console.log(`PASS V9.7 Legacy readonly/restart: ${Object.keys(before).length} file hashes; manual edit, Forget, owner/official isolation, legacy read and Pair preview`);
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("votc-v97-readonly-"));
  fs.rmSync(root, { recursive: true, force: true });
}

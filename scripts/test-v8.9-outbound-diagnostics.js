"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const diagnosticsPath = path.join(root, "resources", "app", "out", "main", "analytics", "provider-diagnostics.js");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const ipcPath = path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js");
const { TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { sanitizeUsage, buildOutboundFingerprint, compareOutboundFingerprints } = require(diagnosticsPath);

assert.strictEqual(sanitizeUsage({ prompt_tokens_details: { cached_tokens: null } }), null, "missing cached_tokens must not become zero");
assert.deepStrictEqual(sanitizeUsage({ prompt_tokens_details: { cached_tokens: 0 } }), { prompt_tokens_details: { cached_tokens: 0 } }, "reported zero must remain zero");
assert.deepStrictEqual(sanitizeUsage({ prompt_tokens_details: { cached_tokens: 12 } }), { prompt_tokens_details: { cached_tokens: 12 } }, "reported positive cached_tokens must remain positive");

const blocks = [
  { id: "stable", messageStartPosition: 0, messageCount: 1 },
  { id: "history-current-user", messageStartPosition: 1, messageCount: 1 }
];
const first = buildOutboundFingerprint({
  messages: [{ role: "system", content: "SECRET_STABLE_CONTENT" }, { role: "user", content: "SECRET_USER_A" }],
  blocks,
  TokenCounter
});
const second = buildOutboundFingerprint({
  messages: [{ role: "system", content: "SECRET_STABLE_CONTENT" }, { role: "user", content: "SECRET_USER_B" }],
  blocks,
  TokenCounter
});
second.commonPrefixWithPrevious = compareOutboundFingerprints(first, second);

assert.strictEqual(first.outboundFingerprintVersion, 1);
assert.strictEqual(first.messages[0].position, 0);
assert.strictEqual(first.messages[0].role, "system");
assert.strictEqual(first.messages[0].blockId, "stable");
assert.strictEqual(second.commonPrefixWithPrevious.commonMessageCount, 1);
assert.strictEqual(second.commonPrefixWithPrevious.firstDifferentPosition, 1);
assert.strictEqual(second.commonPrefixWithPrevious.firstDifferentBlockId, "history-current-user");
assert(second.commonPrefixWithPrevious.commonEstimatedTokens > 0);
assert.doesNotMatch(JSON.stringify(second), /SECRET_STABLE_CONTENT|SECRET_USER_[AB]/, "outbound diagnostics must persist hashes, not message content");

const renderer = fs.readFileSync(rendererPath, "utf8");
const preload = fs.readFileSync(preloadPath, "utf8");
const ipc = fs.readFileSync(ipcPath, "utf8");
assert.match(renderer, /Outbound 实际公共前缀估算/);
assert.match(renderer, /Provider Hit Block 归因估算/);
assert.match(renderer, /Provider Truth、Outbound 实际公共前缀估算、Block 归因估算/);
assert.match(renderer, /创建 V8\.9 双模型预设/);
assert.match(preload, /getV89Settings/);
assert.match(ipc, /providerDiagnostics:saveV89Settings/);

console.log("VOTC V8.9 outbound diagnostics: PASS (cached_tokens tri-state, redacted message fingerprints, adjacent-prefix diff, evidence labels)");

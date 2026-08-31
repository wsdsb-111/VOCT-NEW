"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { CampaignIdentityResolver } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "campaign-identity"));

const tokenA = "votc8c-123456789012";
const tokenB = "votc8c-987654321098";
const resolverA1 = new CampaignIdentityResolver({ createSessionId: () => "session-a1" });
const resolverA2 = new CampaignIdentityResolver({ createSessionId: () => "session-a2" });
const stableA1 = resolverA1.resolve(tokenA);
const stableA2 = resolverA2.resolve(tokenA);
const stableB = resolverA1.resolve(tokenB);

assert.strictEqual(stableA1.campaignId, stableA2.campaignId, "same CK3 token must survive app restart simulation");
assert.strictEqual(stableA1.tokenFingerprint, stableA2.tokenFingerprint);
assert.notStrictEqual(stableA1.campaignId, stableB.campaignId, "different CK3 tokens must be isolated");
assert.strictEqual(stableA1.source, "ck3_mod_token");
assert.strictEqual(stableA1.persistenceAllowed, true);
assert(/^ck3-[a-f0-9]{32}$/.test(stableA1.campaignId));
assert(/^[a-f0-9]{64}$/.test(stableA1.tokenFingerprint));
assert(!JSON.stringify(stableA1).includes(tokenA), "raw CK3 token must not escape the identity boundary");
assert(Object.isFrozen(stableA1));

for (const token of [null, undefined, "", "123456789012", "votc8c-123", "votc8c-12345678901x", "../escape"]) {
  const session = resolverA1.resolve(token);
  assert.strictEqual(session.campaignId, "session-session-a1");
  assert.strictEqual(session.source, "session");
  assert.strictEqual(session.persistenceAllowed, false);
  assert.strictEqual(session.tokenFingerprint, null);
}
assert.strictEqual(resolverA1.resolve(null).campaignId, resolverA1.resolve(null).campaignId, "session identity must be stable inside one process");
assert.notStrictEqual(resolverA1.resolve(null).campaignId, resolverA2.resolve(null).campaignId, "session identity may change after app restart");

console.log("VOTC v8.1 Campaign Identity: PASS (stable token, save isolation, session fail-closed)");

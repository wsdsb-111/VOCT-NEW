"use strict";

const assert = require("assert");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");

Conversation.configure({ createPromptFingerprint: (value) => `fp:${value}` });
const before = Conversation.buildPromptBlockMetadata({ blocks: [
  { block: { id: "memory-stable", label: "Memory", type: "memory_stable", stable: true }, content: "stable", tokens: 10 },
  { block: { id: "history-current-user", label: "Current", type: "current_user", stable: false }, content: "问甲", tokens: 3 },
  { block: { id: "worldline-turn-recall", label: "World", type: "worldline_turn_recall", stable: false }, content: "甲在京师", tokens: 8 }
] });
const after = Conversation.buildPromptBlockMetadata({ blocks: [
  { block: { id: "memory-stable", label: "Memory", type: "memory_stable", stable: true }, content: "stable", tokens: 10 },
  { block: { id: "history-current-user", label: "Current", type: "current_user", stable: false }, content: "问甲", tokens: 3 },
  { block: { id: "worldline-turn-recall", label: "World", type: "worldline_turn_recall", stable: false }, content: "甲已离京", tokens: 8 }
] });
assert.equal(before.prefixFingerprint, after.prefixFingerprint, "Worldline dynamic recall must not alter the stable prefix fingerprint");
assert.equal(before.stablePrefixEndPosition, 1, "the user turn remains the cache breakpoint before world recall");
console.log("V8.6.1 Cache Breakpoint: PASS (Worldline changes stay after stable prefix)");

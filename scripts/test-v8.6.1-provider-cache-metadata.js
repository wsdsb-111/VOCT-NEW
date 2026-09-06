"use strict";

const assert = require("assert");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");

Conversation.configure({ createPromptFingerprint: (value) => String(value) });
const metadata = Conversation.buildPromptBlockMetadata({ blocks: [
  { block: { id: "memory-stable", type: "memory_stable", label: "Memory", stable: true }, content: "记忆", tokens: 2 },
  { block: { id: "history-current-user", type: "current_user", label: "Current", stable: false }, content: "问题", tokens: 2 },
  { block: { id: "worldline-turn-recall", type: "worldline_turn_recall", label: "Worldline Turn Recall", stable: false }, content: "世界事实", tokens: 4 }
] });
assert.equal(metadata.blocks.at(-1).stable, false);
assert.equal(metadata.blocks.at(-1).type, "worldline_turn_recall");
assert.equal(metadata.stablePrefixTokens, 2);
console.log("V8.6.1 Provider Cache Metadata: PASS (dynamic Worldline block is attributed after prefix)");

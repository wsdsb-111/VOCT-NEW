"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/conversation/conversation.js"), "utf8");
assert(source.includes("const currentTurnMentionedCharacterIds"), "conversation must expose current-turn mention IDs");
assert(/retrieveForResponder\([\s\S]*?mentionedEntityIds: mentionedCharacterIds/.test(source), "frozen responder recall must retain session mentions");
assert(/retrieveThirdPartyEvidence\([\s\S]*?mentionedEntityIds: currentTurnMentionedCharacterIds/.test(source), "third-party evidence must use current-turn mentions");
assert(/getPromptContext\?\.\([\s\S]*?mentionedEntityIds: currentTurnMentionedCharacterIds/.test(source), "worldline retrieval must use current-turn mentions");
assert(source.includes("worldlineRequest: { query, assistContext, mentionedEntityIds: currentTurnMentionedCharacterIds }"));
console.log("V8.7.0 Conversation Mention Routing: PASS (session frozen/current-turn dynamic separation)");

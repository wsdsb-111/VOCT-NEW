"use strict";
const assert = require("assert");
const { MentionTracker } = require("../resources/app/out/main/memory-system/mention-tracker");
const tracker = new MentionTracker();
const state = tracker.createState();
const candidates = [{ id: 3, fullName: "韩世忠" }];
const history = [];
for (const content of ["韩世忠呢？", "他呢？", "财政如何？", "天气如何？", "他呢？"]) {
  history.push({ id: history.length + 1, role: "user", content });
  tracker.update(state, { history, candidates });
  if (history.length === 2) assert.deepStrictEqual(state.currentTurnMentionedCharacterIds, [3]);
}
assert.deepStrictEqual(state.currentTurnMentionedCharacterIds, []);
console.log("coreference TTL PASS");

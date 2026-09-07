"use strict";

const assert = require("assert");
const { MentionTracker } = require("../resources/app/out/main/memory-system/mention-tracker");

const candidates = [{ id: 3, fullName: "韩世忠", shortName: "韩世忠" }];
const tracker = new MentionTracker({ onUnresolved: () => false });
const state = tracker.createState();
let history = [{ id: 1, role: "user", content: "韩世忠当时答应了吗？" }];
assert.deepStrictEqual(tracker.update(state, { history, candidates }), [3]);
assert.deepStrictEqual(state.currentTurnMentionedCharacterIds, [3]);

history = [...history, { id: 2, role: "assistant", content: "我会回想。" }, { id: 3, role: "user", content: "今年财政如何？" }];
assert.deepStrictEqual(tracker.update(state, { history, candidates }), [3], "session mention remains frozen background");
assert.deepStrictEqual(state.currentTurnMentionedCharacterIds, [], "stale session mention must not trigger current-turn evidence");

history = [...history, { id: 4, role: "assistant", content: "国库尚可。" }, { id: 5, role: "user", content: "他当时答应了吗？" }];
tracker.update(state, { history, candidates });
assert.deepStrictEqual(state.currentTurnMentionedCharacterIds, [3], "unique recent third person may resolve pronoun coreference");

history = [...history, { id: 6, role: "assistant", content: "此事尚待确认。" }, { id: 7, role: "user", content: "其他事务如何？" }];
tracker.update(state, { history, candidates });
assert.deepStrictEqual(state.currentTurnMentionedCharacterIds, [], "其他 must not be mistaken for a third-person pronoun");
history = [...history, { id: 8, role: "assistant", content: "尚无新事。" }, { id: 9, role: "user", content: "宫中可有吉他？" }];
tracker.update(state, { history, candidates });
assert.deepStrictEqual(state.currentTurnMentionedCharacterIds, [], "吉他 must not be mistaken for a third-person pronoun");

const unresolvedState = tracker.createState();
tracker.update(unresolvedState, { history: [{ id: 1, role: "user", content: "他答应了吗？" }], candidates });
assert.deepStrictEqual(unresolvedState.currentTurnMentionedCharacterIds, []);
console.log("V8.7.0 Current Turn Mention: PASS (session/current/coreference separation)");

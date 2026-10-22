"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createPairMemoryService } = require("../src/app/main/memory-system/pair-memory-service");
const { createConversationManager } = require("../src/app/main/conversation/conversation-manager");

const makeConversation = () => ({ id: "fixture-conversation", conversationEpoch: 1, isActive: true,
  gameData: { campaignToken: "private-campaign", playerID: 1, characters: new Map([[1, { id: 1, fullName: "Player" }], [2, { id: 2, fullName: "Character" }]]) } });
let current = makeConversation();
let writes = 0;
const service = createPairMemoryService({
  getCurrentConversation: () => current,
  store: {
    loadFolderSummariesForCharacter: () => [{ knownBy: [1], provenance: { folderOwnerId: 1, counterpartId: 2, campaignToken: "private-campaign" } }],
    pairLedger: {
      preview: () => ({ previewRevision: "source-revision-1", items: [], counts: {} }),
      apply: (_scope, options) => { assert.equal(options.previewRevision, "source-revision-1"); writes++; return {}; }
    }
  }
});
const request = { ownerId: 1, counterpartId: 2 };
const preview = () => service.preview(request).pairs[0].previewRevision;
const first = preview();
current = makeConversation();
assert.throws(() => service.apply({ ...request, previewRevision: first }), /PAIR_INDEX_PREVIEW_STALE/);
assert.equal(writes, 0, "same-campaign new conversation cannot apply an old preview");
const second = preview();
current.conversationEpoch++;
assert.throws(() => service.apply({ ...request, previewRevision: second }), /PAIR_INDEX_PREVIEW_STALE/);
service.apply({ ...request, previewRevision: preview() });
assert.equal(writes, 1);
current = null;
service.apply({ ...request, previewRevision: preview() });
assert.equal(writes, 2, "authorized unique-campaign offline backfill remains available");

const Manager = createConversationManager({ events: { EventEmitter }, memorySystem: { FinalizationCoordinator: class {
  enqueue(_id, operation) { return Promise.resolve().then(operation); }
} } });
const manager = new Manager();
const updates = [];
manager.eventEmitter.on("conversation-updated", entries => updates.push(entries));
manager.currentConversation = { ...makeConversation(), getEntries: () => [], finalizeConversation: async () => ({ success: true }) };
const context = manager.getUiContext();
assert(context.campaignTag.startsWith("ui-") && context.ownerTag.startsWith("ui-"));
assert(!JSON.stringify(context).includes("private-campaign"));
manager.endCurrentConversation();
assert.deepEqual(updates, [[]], "detach must immediately invalidate subscribed views");
assert.equal(manager.getUiContext().conversationTag, null);
console.log("V9.5 Main scope: PASS (conversation-bound previews, offline backfill, opaque context and reset invalidation)");

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const memorySystem = require("../resources/app/out/main/memory-system");

function addLegacySummarySource(engine, row, index, campaignToken) {
  const ownerId = Number(row.playerId), counterpartId = Number(row.characterId);
  const conversationId = `legacy-ui-conversation-${index}`;
  const finalizationId = `legacy-ui-finalization-${index}`;
  const date = row.date || "1164.1.1";
  const context = { campaignToken, conversationId, finalizationId, episodeId: `${finalizationId}-episode`, date,
    participants: [{ id: ownerId }, { id: counterpartId }],
    participantPresence: [ownerId, counterpartId].map(characterId => ({ characterId, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [{ id: 1, role: "assistant", speakerCharacterId: counterpartId, content: row.content,
      memory4Fragments: [{ start: 0, end: row.content.length, visibility: "participants", sourceType: "spoken",
        recipientIds: [ownerId], entityIds: [ownerId, counterpartId] }] }] };
  const projection = projectVisibleTranscript(context, ownerId);
  const lineage = createProjectionLineage({ campaignToken, ownerId, counterpartId, conversationId, finalizationId,
    sourceSegmentIds: projection.fragments.map(fragment => fragment.fragmentId), sourceMessageIds: [1] });
  engine.memory4.store.commitOwner({ ...context, ...projection, ownerId, counterpartIds: [counterpartId],
    summaryIds: [`legacy-ui-summary-${index}`], projectionLineages: [lineage] }, { status: "STORE",
    entries: projection.fragments.map(fragment => ({ memoryType: "DURABLE_KNOWLEDGE", text: fragment.text,
      fragmentIds: [fragment.fragmentId], entityIds: [counterpartId], participantIds: [ownerId, counterpartId],
      topics: ["archive-summary-fixture"], eventTime: { status: "unknown" } })) });
  return { campaignToken, campaignBinding: { status: "bound", source: "native" }, conversationId, finalizationId,
    perspectiveOwnerId: ownerId, projectionId: lineage.projectionId,
    sourceSegmentIds: lineage.sourceSegmentIds, sourceMessageIds: lineage.sourceMessageIds };
}

function hashTree(root) {
  const rows = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      assert(!entry.isSymbolicLink(), `unexpected fixture symlink: ${filePath}`);
      if (entry.isDirectory()) visit(filePath);
      else rows.push(`${path.relative(root, filePath)}:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`);
    }
  };
  visit(root);
  return crypto.createHash("sha256").update(rows.join("\n")).digest("hex");
}

function createRenderFixture(initialStates) {
  let stateIndex = 0;
  const Fragment = Symbol("Fragment");
  const createElement = (type, props, ...children) => {
    const nextProps = { ...(props || {}) };
    if (children.length === 1) nextProps.children = children[0];
    else if (children.length > 1) nextProps.children = children;
    return { type, key: nextProps.key ?? null, props: nextProps };
  };
  return {
    Fragment,
    createElement,
    cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
    useState: initial => {
      stateIndex++;
      return [Object.hasOwn(initialStates, stateIndex) ? initialStates[stateIndex] : initial, () => {}];
    },
    useEffect: () => {},
    useRef: current => ({ current })
  };
}

function findElement(root, predicate) {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!root || typeof root !== "object") return null;
  if (predicate(root)) return root;
  return findElement(root.props?.children, predicate);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-summary-edit-"));
  const previousWindow = global.window;
  try {
    const fixture = await createMemoryUiFixture(profile);
    let currentConversation = fixture.conversation;
    const endedConversation = fixture.conversation;
    const manager = createSummariesManager({ fs, path, summariesDir: fixture.summariesDir, memoryEngine: fixture.engine,
      memorySystem, getCurrentConversation: () => currentConversation, getMemory4ReadConversation: () => currentConversation });
    const legacyFile = path.join(fixture.summariesDir, "2_乙", "与甲的对话.json");
    const legacyRows = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
    legacyRows.forEach((row, index) => {
      Object.assign(row, addLegacySummarySource(fixture.engine, row, index, fixture.scope.campaignToken));
      row.perspectiveMemoryIds = [];
      row.perspectiveSummarySegmentIds = [];
    });
    fs.writeFileSync(legacyFile, JSON.stringify(legacyRows), "utf8");

    currentConversation.isActive = false;
    const archivedData = await manager.getMemory4OwnerData({ ownerId: fixture.scope.ownerId,
      expectedCampaignToken: fixture.scope.campaignToken, expectedContextId: currentConversation.id });
    assert.equal(archivedData.readOnlyArchive, true);
    assert.equal(archivedData.readOnlyReason, "conversation_ended");

    const memory4Source = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/memory4-manager.js"), "utf8");
    const { Memory4Manager } = await import(`data:text/javascript;base64,${Buffer.from(memory4Source).toString("base64")}`);
    global.window = { conversationAPI: {} };
    const R = createRenderFixture({ 1: "legacy", 2: archivedData, 3: false });
    const editButton = R.createElement("button", { id: "legacy-edit", onClick: () => manager.updateSummary(2, 1, 0, "归档后编辑仍应可用。") }, "编辑");
    const deleteButton = R.createElement("button", { id: "legacy-delete", onClick: () => manager.deleteSummary(2, 1, 1) }, "删除");
    const legacyContent = R.createElement("div", { className: "legacy-summary-fixture" }, editButton, deleteButton);
    const rendered = Memory4Manager({ react: R, ownerId: fixture.scope.ownerId, refreshKey: 0, searchActive: true, legacyContent });
    const renderedEdit = findElement(rendered, element => element.props?.id === "legacy-edit");
    const renderedDelete = findElement(rendered, element => element.props?.id === "legacy-delete");
    assert(renderedEdit && renderedDelete, "the real Memory4 renderer must preserve both Legacy controls");
    assert.equal(!!renderedEdit.props.disabled, false, "ended-conversation archive must not disable Legacy edit");
    assert.equal(!!renderedDelete.props.disabled, false, "ended-conversation archive must not disable Legacy delete");
    assert.equal(typeof renderedEdit.props.onClick, "function", "Legacy edit click handler must remain available");
    assert.equal(typeof renderedDelete.props.onClick, "function", "Legacy delete click handler must remain available");
    currentConversation = null;
    assert.equal((await renderedEdit.props.onClick()).success, true);
    assert.equal((await renderedDelete.props.onClick()).success, true);
    const remainingLegacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
    assert.equal(remainingLegacy.length, 1);
    assert.equal(remainingLegacy[0].content, "归档后编辑仍应可用。");

    const officialFile = path.join(fixture.summariesDir, "2_乙", "官方追忆摘要.json");
    const officialBefore = fs.readFileSync(officialFile);
    const originalConsoleError = console.error;
    let officialUpdate, officialDelete;
    try {
      console.error = () => {};
      officialUpdate = await manager.updateSummary(2, 2, 0, "不得改写官方追忆。");
      officialDelete = await manager.deleteSummary(2, 2, 0);
    } finally { console.error = originalConsoleError; }
    assert.equal(officialUpdate.error, "official_recollection_read_only");
    assert.equal(officialDelete.error, "official_recollection_read_only");
    assert.deepEqual(fs.readFileSync(officialFile), officialBefore, "Official recollection bytes must remain unchanged");

    currentConversation = endedConversation;
    const detail = archivedData.detail.items[0];
    const beforeArchiveMutation = hashTree(profile);
    await assert.rejects(manager.mutateMemory4({ ownerId: fixture.scope.ownerId, expectedCampaignToken: fixture.scope.campaignToken,
      expectedContextId: currentConversation.id, operation: "updateDetail", entryId: detail.entryId,
      text: "归档 Detail 不可写。", expectedRevision: detail.revision }), /legacy_binding_conversation_not_active/);
    assert.equal(hashTree(profile), beforeArchiveMutation, "archive Memory4 rejection must perform zero filesystem writes");

    currentConversation = { ...fixture.conversation, id: "switched-campaign", isActive: true,
      gameData: { ...fixture.conversation.gameData, campaignToken: "memory4-ui-fixture-new-campaign" } };
    const beforeStaleCampaign = hashTree(profile);
    await assert.rejects(manager.getMemory4OwnerData({ ownerId: fixture.scope.ownerId,
      expectedCampaignToken: fixture.scope.campaignToken }), /memory4_campaign_changed/);
    await assert.rejects(manager.mutateMemory4({ ownerId: fixture.scope.ownerId, expectedCampaignToken: fixture.scope.campaignToken,
      operation: "deleteDetail", entryId: detail.entryId, expectedRevision: detail.revision }), /memory4_campaign_changed/);
    assert.equal(hashTree(profile), beforeStaleCampaign, "stale-campaign rejection must perform zero filesystem writes");

    console.log("V8.14.2 summary edit incident: PASS (Legacy edit/delete stay available in ended archives; Official and Memory4 write gates remain intact)");
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    const target = path.resolve(profile);
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

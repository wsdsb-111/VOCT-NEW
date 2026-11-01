"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { WorldlineService } = require("../src/app/main/worldline/worldline-service");
const { retrieveSupplemental } = require("../src/app/main/worldline/supplemental-retriever");
const { estimateTokens } = require("../src/app/main/token-estimator");
const { createUsageAnalytics } = require("../src/app/main/analytics/usage-analytics");
const retention = require("../src/app/main/usage-analytics-retention");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-world-memory-restart-"));
const checkpoint = {
  id: "synthetic-initial",
  source: { path: "C:\\synthetic\\autosave.ck3", fingerprint: "a".repeat(64) },
  snapshot: { playthroughId: "synthetic-restart-campaign", gameDate: "1071.1.1", totalDays: 390000,
    playerId: "1", characters: { "1": { id: "1", firstName: "甲" }, "2": { id: "2", firstName: "乙" } } }
};
const settings = { promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION" };
function serviceFor(current = checkpoint) {
  const service = new WorldlineService({ dataDir: root, settingsRepository: {
    getWorldlineSettings: () => settings, saveWorldlineSettings: next => Object.assign(settings, next)
  } });
  service.currentCheckpoint = structuredClone(current);
  service.getLiveState = () => ({ gameDate: current.snapshot.gameDate, totalDays: current.snapshot.totalDays });
  service.getSubjectiveWorldView = () => ({ allowedFacts: [] });
  return service;
}
const recallArgs = { responderId: "2", query: "山海盟约", conversationId: "synthetic-conversation", tokenBudget: 4096 };
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function checkBlockedEditor(page) {
  const renderer = path.resolve(__dirname, "../src/app/renderer");
  const { WorldMemoryEditor } = await import(pathToFileURL(path.join(renderer, "world-memory-editor.js")).href);
  const { UI_CATALOGS } = await import(pathToFileURL(path.join(renderer, "v95/i18n/index.js")).href);
  const previousWindow = global.window;
  global.window = { localStorage: { getItem: () => null } };
  try {
    for (const locale of ["zh-CN", "en-US"]) {
      let hook = 0;
      const react = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState: initial => [hook++ === 0 ? page : typeof initial === "function" ? initial() : initial, () => {}],
        useRef: current => ({ current }), useEffect() {}
      };
      const t = (key, params = {}) => {
        const value = key.split(".").reduce((entry, part) => entry?.[part], UI_CATALOGS[locale]);
        return typeof value === "string" ? value.replace(/\{\{(\w+)\}\}/g, (_, part) => String(params[part] ?? "")) : key;
      };
      const tree = WorldMemoryEditor({ react, t });
      const nodes = [];
      const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === "object") { nodes.push(node); visit(node.children); } };
      visit(tree);
      const text = node => Array.isArray(node) ? node.map(text).join(" ") : node && typeof node === "object" ? text(node.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
      const rendered = text(tree);
      assert(rendered.includes(page.records[0].title), `${locale}: the stored memory remains visible`);
      assert(!rendered.includes(t("worldMemoryEditor.list.empty")), `${locale}: a blocked branch is not an empty archive`);
      assert(rendered.includes(t("worldMemoryEditor.persistence.readOnly")));
      const continuation = nodes.find(node => node.type === "button" && text(node) === t("worldMemoryEditor.branch.confirmContinuity"));
      assert(continuation && !continuation.props.disabled, `${locale}: explicit continuity recovery is available`);
      const deletion = nodes.filter(node => node.type === "button" && text(node) === t("worldMemoryEditor.ui.delete"));
      assert.equal(deletion.length, page.records.length);
      assert(deletion.every(node => node.props.disabled), `${locale}: a preview cannot mutate stored records`);
    }
  } finally { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; }
}

async function main() {
  const service = serviceFor();
  const page = await service.listCanon();
  let content;
  for (let count = 20; count < 80; count++) {
    const candidate = "往昔族人曾在山间立下盟约，后人以此讲述先人的往事。".repeat(count);
    const probe = retrieveSupplemental({ records: [{ campaignId: page.branch.campaignId, branchId: page.branch.branchId,
      recordId: "probe", revision: 1, title: "山海盟约", content: candidate, status: "ACTIVE", visibility: "PUBLIC_WORLD",
      knownBy: [], entities: [], type: "PLAYER_CANON", importance: "CRITICAL", temporalMode: "TIMELESS" }],
    ...page.branch, responderId: "2", query: recallArgs.query, tokenBudget: 640, estimateTokens });
    if (probe.tokens > 512) { content = candidate; break; }
  }
  assert(content, "fixture must exercise the former 512/640 token mismatch");
  const record = await service.mutateCanon({ token: page.branch.token, operation: "create", payload: {
    title: "山海盟约", content, visibility: "PUBLIC_WORLD", knownBy: [], entities: [], importance: "CRITICAL",
    temporalMode: "SPECIFIC_DATE", gameDate: "1.1.1", temporalSemantics: "PAST_EVENT"
  } });
  const testArgs = { token: service.canon.branch().token, recordId: record.recordId, responderId: "2", query: recallArgs.query };
  const preview = await service.testCanonRecall(testArgs);
  assert.equal(preview.matched, true);
  assert(preview.tokens > 512 && preview.tokens <= 640);
  const actual = await service.getCanonTurnRecallAsync(recallArgs);
  assert(actual?.text?.includes(content), "a memory passing editor recall must reach the actual turn path with adequate headroom");
  assert.equal(actual.tokens, preview.tokens);
  const crowded = await service.getCanonTurnRecallAsync({ ...recallArgs, tokenBudget: 128 });
  assert.equal(crowded.text, null, "never inject a partial record");
  assert.equal(crowded.budgetBlockedCount, 1, "insufficient turn headroom must be diagnosed");
  assert(crowded.requiredTokens > crowded.tokenBudget);
  const UsageAnalytics = createUsageAnalytics({ fs, dataDir: root, analyticsFile: path.join(root, "synthetic-analytics.json"),
    retention, createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex") });
  const analytics = new UsageAnalytics();
  analytics.record({ requestType: "worldline_recall", supplementalCandidateCount: crowded.candidateCount,
    supplementalSelectedCount: crowded.selected.length, canonBudgetBlockedCount: crowded.budgetBlockedCount,
    canonRequiredTokens: crowded.requiredTokens, canonTokenBudget: crowded.tokenBudget, content: "never persist memory bodies in diagnostics" }, null);
  const trace = analytics.read().entries.at(-1);
  assert.equal(trace.canonBudgetBlockedCount, 1);
  assert.equal(trace.canonTokenBudget, 128);
  assert.equal(trace.canonRequiredTokens, crowded.requiredTokens);
  assert.equal(trace.content, undefined);

  const longContent = "古昔旅人曾穿越荒原留下碑文，后来学者编纂成册，讲述遥远往事。".repeat(70);
  const longRecord = await service.mutateCanon({ token: service.canon.branch().token, operation: "create", payload: {
    title: "星河卷宗", content: longContent, visibility: "PUBLIC_WORLD", knownBy: [], entities: [],
    temporalMode: "SPECIFIC_DATE", gameDate: "1.1.1", temporalSemantics: "PAST_EVENT"
  } });
  const longPreview = await service.testCanonRecall({ ...testArgs, recordId: longRecord.recordId, query: "星河卷宗" });
  assert(longPreview.tokens > 900 && longPreview.tokens <= 4096);
  assert.equal(longPreview.tokenBudget, 4096);
  const longActual = await service.getCanonTurnRecallAsync({ ...recallArgs, query: "星河卷宗" });
  assert(longActual.text.includes(longContent), "the actual turn path accepts a complete memory above the old 900-token world budget");
  assert.equal(longActual.tokenBudget, 4096);
  const oversized = await service.mutateCanon({ token: service.canon.branch().token, operation: "create", payload: {
    title: "暮野遗闻", content: "残碑记述了遥远时代的旧闻，旅人依照这些铭文整理往事。".repeat(240),
    visibility: "PUBLIC_WORLD", knownBy: [], entities: [], temporalMode: "SPECIFIC_DATE", gameDate: "1.1.1", temporalSemantics: "PAST_EVENT"
  } });
  const tooLarge = await service.testCanonRecall({ ...testArgs, recordId: oversized.recordId, query: "暮野遗闻" });
  assert.equal(tooLarge.reason, "BUDGET_EXCEEDED");
  assert.equal(tooLarge.promptText, null);
  assert(tooLarge.requiredTokens > 4096);
  assert.equal(tooLarge.tokenBudget, 4096);

  const stateFile = path.join(service.canon.root, "campaigns", page.branch.campaignId, "branches", page.branch.branchId, "state.json");
  const savedHash = digest(stateFile);
  const restarted = serviceFor({ ...checkpoint, id: "synthetic-restarted",
    source: { ...checkpoint.source, fingerprint: "b".repeat(64) } });
  const pending = await restarted.listCanon();
  assert.equal(pending.branch.reason, "same_date_different_content");
  assert.equal(pending.recordsReadOnly, true);
  assert.equal(pending.total, 3, "a blocked branch must not masquerade as deleted memories");
  assert.equal(pending.records[0].recordId, record.recordId);
  await checkBlockedEditor(pending);
  assert.equal((await restarted.getCanonTurnRecallAsync(recallArgs))?.text || null, null,
    "pending continuity never authorizes NPC recall");
  await assert.rejects(restarted.testCanonRecall({ ...testArgs, token: pending.branch.token }), /branch_confirmation_required/);
  assert.equal(digest(stateFile), savedHash, "listing and denied recall never rewrite saved memory");
  restarted.confirmCanonBranch(pending.branch.token);
  const restored = await restarted.listCanon();
  assert.equal(restored.recordsReadOnly, false);
  assert.equal(restored.branch.branchId, page.branch.branchId);
  assert.equal(restored.total, 3);
  assert((await restarted.getCanonTurnRecallAsync(recallArgs)).text.includes(content));
  const again = serviceFor(restarted.currentCheckpoint);
  assert.equal((await again.listCanon()).total, 3, "confirmed continuity survives a fresh service instance");
  assert.equal(digest(stateFile), savedHash, "continuity changes the binding, not the original memory bytes");
  const other = serviceFor({ ...checkpoint, id: "synthetic-other-campaign",
    snapshot: { ...checkpoint.snapshot, playthroughId: "another-campaign" } });
  assert.equal((await other.listCanon()).total, 0, "another campaign never inherits the saved memory");
  console.log("World memory restart/budget regression: PASS (disk persistence, actual recall parity, blocked preview, explicit continuity, campaign isolation)");
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));

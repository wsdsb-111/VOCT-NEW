"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SupplementalStore } = require("../resources/app/out/main/worldline/supplemental-store");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-canon-"));
  const scope = { campaignId: "campaign-a", branchId: "branch-a", state: "SAME_BRANCH" };
  const payload = { title: "赴约", content: "韩世忠答应下月赴约", totalDays: 428018, gameDate: "1171.9.20" };
  try {
    const store = new SupplementalStore({ root });
    await assert.rejects(store.create({ ...scope, state: "BRANCH_UNKNOWN" }, payload), /branch_write_blocked/);
    const first = await store.create(scope, payload);
    assert.equal(first.revision, 1);
    const edited = await store.update(scope, first.recordId, { content: "改为两个月后赴约" }, 1);
    assert.equal(edited.revision, 2);
    await assert.rejects(store.update(scope, first.recordId, { title: "过期编辑" }, 1), /revision_conflict/);
    assert.equal(store.history(scope, first.recordId)[0].content, "改为两个月后赴约");
    await store.update(scope, first.recordId, { status: "HIDDEN" }, 2);
    assert.equal(store.list(scope).records.length, 0);
    await store.update(scope, first.recordId, { status: "ACTIVE" }, 3);
    assert.equal(store.list(scope).records.length, 1);
    assert.equal(new SupplementalStore({ root }).list(scope).records[0].revision, 4);
    assert.equal(store.list({ ...scope, branchId: "branch-b" }).records.length, 0);
    await assert.rejects(store.create(scope, { ...payload, visibility: "SECRET" }), /acl_required/);
    await assert.rejects(store.create(scope, { ...payload, campaignId: "other" }), /immutable_scope/);
    await assert.rejects(store.create({ ...scope, branchId: "../escape" }, payload), /scope_invalid/);
    const concurrent = await Promise.allSettled([
      store.update(scope, first.recordId, { title: "甲" }, 4),
      store.update(scope, first.recordId, { title: "乙" }, 4)
    ]);
    assert.equal(concurrent.filter((entry) => entry.status === "fulfilled").length, 1);
    const revision = store.list(scope).revision;
    const failing = new SupplementalStore({ root, fs: { ...fs, renameSync() { throw new Error("injected_rename_failure"); } } });
    await assert.rejects(failing.create(scope, payload), /injected_rename_failure/);
    assert.equal(new SupplementalStore({ root }).list(scope).revision, revision);
    await assert.rejects(store.create(scope, { ...payload, gameDate: "1171.2.31" }), /date_invalid/);
    const prior = store.list(scope).records[0];
    const next = await store.supersede(scope, prior.recordId, { content: "改为明年赴约" }, prior.revision);
    assert.equal(next.supersedes, prior.recordId);
    assert.equal(store.history(scope, prior.recordId).find((record) => record.revision === prior.revision + 1).supersededBy, next.recordId);
    assert.equal(store.list(scope).records.length, 1);
    await assert.rejects(store.update(scope, prior.recordId, { status: "ACTIVE" }, prior.revision + 1), /superseded_immutable/);
    const file = store.file(scope);
    const corrupted = JSON.parse(fs.readFileSync(file, "utf8"));
    corrupted.revisions[0].content = "篡改历史";
    fs.writeFileSync(file, JSON.stringify(corrupted));
    assert.throws(() => new SupplementalStore({ root }).list(scope), /revision_history_invalid/);
    console.log("V8.7 Supplemental Storage PASS: history, isolation, ACL, concurrency, atomic failure, restart");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

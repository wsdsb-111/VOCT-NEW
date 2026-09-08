"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SupplementalStore } = require("../resources/app/out/main/worldline/supplemental-store");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-resume-write-"));
  try {
    const store = new SupplementalStore({ root });
    const record = await store.create({ campaignId: "campaign-a", branchId: "branch-a", state: "BRANCH_RESUMED" }, { title: "恢复后的约定", content: "该分支恢复后仍可保存", gameDate: "1175.1.1", totalDays: 430000 });
    assert.equal(record.status, "ACTIVE");
    console.log("V8.7.1 resumed branch write contract PASS");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

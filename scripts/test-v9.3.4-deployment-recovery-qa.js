"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildRuntime } = require("./build-runtime");
const { bootstrapDeploymentReceipt, recoverPendingDeployment, statePaths } = require("./deploy-runtime-build");

const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = {
  id: sourceVersionPath,
  filename: sourceVersionPath,
  loaded: true,
  exports: require("../resources/app/out/main/version")
};

const { MemoryStore } = require("../src/app/main/memory-system/memory-store");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v934-deploy-recovery-qa-"));

function copyFixtureTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(destination, item.name);
    if (item.isDirectory()) copyFixtureTree(from, to);
    else if (item.isFile()) fs.copyFileSync(from, to);
    else throw new Error("fixture_copy_non_file");
  }
}

function snapshotTree(directory) {
  const entries = [];
  const visit = current => {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, item.name);
      const relative = path.relative(directory, target).replace(/\\/g, "/");
      if (item.isDirectory()) visit(target);
      else if (item.isFile()) entries.push([relative, `file:${fs.readFileSync(target).toString("base64")}`]);
      else throw new Error("fixture_snapshot_non_file");
    }
  };
  visit(directory);
  return entries;
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function createDirectoryLink(target, link) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

function makeDeployRecoveryFixture() {
  const rootDir = path.join(root, "deploy-recovery-read-race");
  const outputDir = path.join(rootDir, ".build", "runtime");
  const files = [
    ["package.json", "package.json", JSON.stringify({ name: "votc-fixture", version: "9.3.4", main: "out/main/main.js" })],
    ["main/main.js", "out/main/main.js", '"use strict";\nmodule.exports = "old-main";\n'],
    ["preload/preload.js", "out/preload/preload.js", '"use strict";\nmodule.exports = "old-preload";\n'],
    ["renderer/index.html", "out/renderer/index.html", "<!doctype html><title>fixture</title>\n"],
    ["default_userdata/prompts/system/default.hbs", "default_userdata/prompts/system/default.hbs", "fixture prompt\n"]
  ];
  fs.mkdirSync(path.join(rootDir, "build"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "build", "runtime-inputs.json"), JSON.stringify({ schemaVersion: 1,
    files: files.map(([source, target]) => ({ source, target })) }, null, 2) + "\n", "utf8");
  for (const [source, , contents] of files) {
    const sourcePath = path.join(rootDir, "src", "app", ...source.split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, contents, "utf8");
  }

  const initialManifest = buildRuntime({ rootDir, outputDir });
  const appDir = path.join(rootDir, "resources", "app");
  copyFixtureTree(path.join(outputDir, "app"), appDir);
  bootstrapDeploymentReceipt({ rootDir, outputDir });
  const previousReceipt = JSON.parse(fs.readFileSync(statePaths(rootDir).receiptPath, "utf8"));

  fs.writeFileSync(path.join(rootDir, "src", "app", "main", "main.js"),
    '"use strict";\nmodule.exports = "new-main";\n', "utf8");
  fs.writeFileSync(path.join(rootDir, "src", "app", "preload", "preload.js"),
    '"use strict";\nmodule.exports = "new-preload";\n', "utf8");
  const targetManifest = buildRuntime({ rootDir, outputDir });
  const previousFiles = previousReceipt.files;
  const targetFiles = targetManifest.files.map(item => ({ path: item.path, sha256: item.sha256 }));
  const previousByPath = new Map(previousFiles.map(item => [item.path, item.sha256]));
  const targetByPath = new Map(targetFiles.map(item => [item.path, item.sha256]));
  const paths = [...new Set([...previousByPath.keys(), ...targetByPath.keys()])].sort();
  const actions = paths.filter(file => previousByPath.get(file) !== targetByPath.get(file)).map(file => {
    const previousSha256 = previousByPath.get(file) ?? null;
    const targetSha256 = targetByPath.get(file) ?? null;
    return { path: file, previousSha256, targetSha256,
      backupPath: previousSha256 !== null ? `files/${file}` : null };
  });
  assert.ok(actions.length >= 2, "the recovery fixture must change multiple managed targets");

  const transactionId = crypto.randomUUID();
  const transactionDir = path.join(statePaths(rootDir).backupRoot, transactionId);
  const backupRows = [];
  for (const action of actions) {
    if (!action.backupPath) continue;
    const sourcePath = path.join(appDir, ...action.path.split("/"));
    const bytes = fs.readFileSync(sourcePath);
    assert.equal(sha256Bytes(bytes), action.previousSha256, `fixture backup source hash for ${action.path}`);
    const backupPath = path.join(transactionDir, ...action.backupPath.split("/"));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, bytes);
    backupRows.push({ path: action.path, sha256: action.previousSha256, backupPath: action.backupPath });
  }
  const backupManifest = { schemaVersion: 1, transactionId, files: backupRows };
  const backupManifestBytes = Buffer.from(JSON.stringify(backupManifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(transactionDir, "backup-manifest.json"), backupManifestBytes);
  const receipt = {
    schemaVersion: 1,
    status: "IN_PROGRESS",
    transactionId,
    previousPayloadSha256: initialManifest.payloadSha256,
    targetPayloadSha256: targetManifest.payloadSha256,
    previousFiles,
    targetFiles,
    actions,
    backupManifestSha256: sha256Bytes(backupManifestBytes)
  };
  const receiptPath = statePaths(rootDir).receiptPath;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");

  const firstAction = actions[0];
  const targetPath = path.join(appDir, ...firstAction.path.split("/"));
  const targetBytes = fs.readFileSync(path.join(outputDir, "app", ...firstAction.path.split("/")));
  assert.equal(sha256Bytes(targetBytes), firstAction.targetSha256, "the partially deployed target matches its journal hash");
  fs.writeFileSync(targetPath, targetBytes);
  return { rootDir, appDir, receiptPath, firstAction, targetPath };
}

function testDeployRecoveryReadInterleave() {
  const fixture = makeDeployRecoveryFixture();
  const unknownBytes = Buffer.from("unknown concurrent deployment edit", "utf8");
  const receiptBefore = fs.readFileSync(fixture.receiptPath);
  const appBefore = snapshotTree(fixture.appDir);
  const relativeTarget = path.relative(fixture.appDir, fixture.targetPath).replace(/\\/g, "/");
  const expectedApp = appBefore.map(([relative, bytes]) => relative === relativeTarget
    ? [relative, `file:${unknownBytes.toString("base64")}`] : [relative, bytes]);
  assert.equal(expectedApp.some(([relative]) => relative === relativeTarget), true,
    "the journal action must correspond to an existing managed target");

  const originalReadFileSync = fs.readFileSync;
  let targetReads = 0;
  let injected = false;
  const normalizedTarget = path.resolve(fixture.targetPath).toLowerCase();
  fs.readFileSync = function(candidate, ...args) {
    const bytes = originalReadFileSync.call(fs, candidate, ...args);
    if (typeof candidate === "string" && path.resolve(candidate).toLowerCase() === normalizedTarget) {
      targetReads++;
      if (!injected) {
        fs.writeFileSync(fixture.targetPath, unknownBytes);
        injected = true;
      }
    }
    return bytes;
  };
  let recoveryError;
  try {
    try { recoverPendingDeployment({ rootDir: fixture.rootDir }); }
    catch (error) { recoveryError = error; }
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  assert.equal(injected, true, "the target is changed immediately after recovery preflight reads its old bytes");
  assert.ok(targetReads >= 2, "recovery must perform the preflight and subsequent restore reads");
  assert.match(recoveryError?.message || "", /build_deploy_recovery_unknown_target/,
    "the restore read must reject bytes changed after preflight");
  assert.deepEqual(fs.readFileSync(fixture.targetPath), unknownBytes,
    "recovery must preserve the concurrent unknown bytes");
  assert.deepEqual(snapshotTree(fixture.appDir), expectedApp,
    "recovery must leave every other deployed byte and path unchanged");
  assert.deepEqual(fs.readFileSync(fixture.receiptPath), receiptBefore,
    "blocked recovery must preserve the exact IN_PROGRESS receipt bytes");
  assert.equal(JSON.parse(receiptBefore.toString("utf8")).status, "IN_PROGRESS");
}

function testSummaryMutationRejectsRootJunction() {
  const target = path.join(root, "summary-root-target");
  const link = path.join(root, "summary-root-link");
  const ownerFolder = path.join(target, "2_fixture");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const sentinel = path.join(ownerFolder, "summary.json");
  const original = Buffer.from("external summary sentinel", "utf8");
  fs.writeFileSync(sentinel, original);
  createDirectoryLink(target, link);

  const store = new MemoryStore({ baseDir: path.join(root, "summary-root-memory"), summaryFoldersDir: link });
  const linkedPath = path.join(link, "2_fixture", "summary.json");
  assert.throws(() => store.withSummaryMutation(linkedPath, () => store.writeJson(linkedPath, { content: "must not escape" })),
    /symlink|path|root|unsafe/i);
  assert.deepEqual(fs.readFileSync(sentinel), original, "the linked summary root's external file is unchanged");
}

function testSummaryMutationRejectsInRootJunction() {
  const escapeRoot = path.join(root, "summary-escape");
  const allowedSummaries = path.join(escapeRoot, "summaries");
  const outside = path.join(escapeRoot, "outside");
  const link = path.join(allowedSummaries, "2_fixture");
  fs.mkdirSync(allowedSummaries, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const sentinel = path.join(outside, "summary.json");
  const original = Buffer.from("outside sentinel must remain unchanged", "utf8");
  fs.writeFileSync(sentinel, original);
  createDirectoryLink(outside, link);

  const store = new MemoryStore({ baseDir: path.join(escapeRoot, "memory"), summaryFoldersDir: allowedSummaries });
  const linkedPath = path.join(link, "summary.json");
  assert.throws(() => store.withSummaryMutation(linkedPath, () => store.writeJson(linkedPath, { content: "outside write" })),
    /symlink|path|root|unsafe/i);
  assert.deepEqual(fs.readFileSync(sentinel), original, "the in-root junction's external file is unchanged");
}

function testSummaryMutationRecoveryRejectsJunctionEscape() {
  const recoveryRoot = path.join(root, "summary-journal-escape");
  const summaries = path.join(recoveryRoot, "summaries");
  const outside = path.join(recoveryRoot, "outside");
  const memory = path.join(recoveryRoot, "memory");
  const link = path.join(summaries, "2_fixture");
  fs.mkdirSync(summaries, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(memory, { recursive: true });
  const sentinel = path.join(outside, "summary.json");
  const original = Buffer.from("restore target sentinel", "utf8");
  fs.writeFileSync(sentinel, original);
  createDirectoryLink(outside, link);

  const linkedFile = path.join(link, "summary.json");
  fs.writeFileSync(path.join(memory, "summary-mutation.json"), JSON.stringify({
    version: 1,
    files: { [linkedFile]: Buffer.from("journal must not overwrite outside", "utf8").toString("base64") }
  }), "utf8");
  assert.throws(() => new MemoryStore({ baseDir: memory, summaryFoldersDir: summaries }), /symlink|path|root|unsafe/i);
  assert.deepEqual(fs.readFileSync(sentinel), original, "rejected startup recovery preserves the external sentinel");
}

try {
  testDeployRecoveryReadInterleave();
  testSummaryMutationRejectsRootJunction();
  testSummaryMutationRejectsInRootJunction();
  testSummaryMutationRecoveryRejectsJunctionEscape();
  console.log("V9.3.4 deployment/summary mutation QA: PASS (unknown edit, root/in-root links, and journal escape rejected)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

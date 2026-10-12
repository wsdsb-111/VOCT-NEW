"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildRuntime, verifyArtifacts, listFiles } = require("./build-runtime");
const { verifyRuntimeBuild } = require("./verify-runtime-build");
const { deployRuntimeBuild, recoverPendingDeployment, statePaths } = require("./deploy-runtime-build");

const temporaryRoots = [];
const sourceRoot = path.resolve(__dirname, "..");
const deployScript = path.join(__dirname, "deploy-runtime-build.js");
const buildScript = path.join(__dirname, "build-runtime.js");
const verifyScript = path.join(__dirname, "verify-runtime-build.js");

function makeFixture({ seed = true, main = '"use strict";\nmodule.exports = "old-main";\n' } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v92-build-guard-"));
  temporaryRoots.push(rootDir);
  const files = [
    ["package.json", "package.json", JSON.stringify({ name: "fixture", version: "9.2.0", main: "out/main/main.js" })],
    ["main/main.js", "out/main/main.js", main],
    ["preload/preload.js", "out/preload/preload.js", '"use strict";\nmodule.exports = "old-preload";\n'],
    ["renderer/index.html", "out/renderer/index.html", "<!doctype html><title>fixture</title>\n"],
    ["default_userdata/prompts/system/default.hbs", "default_userdata/prompts/system/default.hbs", "fixture prompt\n"]
  ];
  fs.mkdirSync(path.join(rootDir, "build"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "build/runtime-inputs.json"), JSON.stringify({ schemaVersion: 1,
    files: files.map(([source, target]) => ({ source, target })) }, null, 2) + "\n");
  for (const [source, , contents] of files) {
    const file = path.join(rootDir, "src/app", ...source.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  const outputDir = path.join(rootDir, ".build/runtime");
  const manifest = buildRuntime({ rootDir, outputDir });
  copyTree(path.join(outputDir, "app"), path.join(rootDir, "resources/app"));
  if (seed) deployRuntimeBuild({ rootDir, outputDir });
  return { rootDir, outputDir, manifest };
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error("fixture_copy_non_file");
  }
}

function expectCode(callback, code) {
  assert.throws(callback, error => error instanceof Error && error.message.includes(code), `expected ${code}`);
}

function sourceFile(rootDir, relative) {
  return path.join(rootDir, "src/app", ...relative.split("/"));
}

function deployedFile(rootDir, relative) {
  return path.join(rootDir, "resources/app", ...relative.split("/"));
}

function readReceipt(rootDir) {
  return JSON.parse(fs.readFileSync(statePaths(rootDir).receiptPath, "utf8"));
}

function writeSource(rootDir, relative, bytes) {
  fs.writeFileSync(sourceFile(rootDir, relative), bytes);
}

function updateRuntimeInputs(rootDir, update) {
  const configPath = path.join(rootDir, "build/runtime-inputs.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.files = update(config.files);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function rebuild(fixture) {
  return buildRuntime({ rootDir: fixture.rootDir, outputDir: fixture.outputDir });
}

function stageSnapshot(outputDir) {
  const files = [];
  for (const relative of ["runtime-build-manifest.json", ...listFiles(path.join(outputDir, "app")).map(name => `app/${name}`)]) {
    files.push([relative, fs.readFileSync(path.join(outputDir, relative))]);
  }
  return new Map(files);
}

function rejectCandidatePromotion(fixture) {
  const originalRename = fs.renameSync;
  const outputDir = path.resolve(fixture.outputDir);
  let rejected = false;
  fs.renameSync = function (source, target, ...args) {
    if (!rejected && path.resolve(source) !== outputDir && path.resolve(target) === outputDir
      && path.basename(path.resolve(source)).startsWith(".votc-source-stage-")) {
      rejected = true;
      const error = new Error("fixture_candidate_promotion_rejected");
      error.code = "EIO";
      throw error;
    }
    return originalRename.call(fs, source, target, ...args);
  };
  try {
    expectCode(() => rebuild(fixture), "fixture_candidate_promotion_rejected");
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(rejected, true, "the candidate promotion failure was injected");
}

function crashAfterFirstTargetWrite(fixture) {
  const childPath = path.join(fixture.rootDir, "crash-deploy.js");
  const script = [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    `const { deployRuntimeBuild } = require(${JSON.stringify(deployScript)});`,
    `const rootDir = ${JSON.stringify(fixture.rootDir)};`,
    'const appRoot = path.resolve(rootDir, "resources/app").toLowerCase();',
    'const originalRename = fs.renameSync;',
    'fs.renameSync = function (source, target, ...args) {',
    '  const result = originalRename.call(fs, source, target, ...args);',
    '  const targetPath = path.resolve(target).toLowerCase();',
    '  if (targetPath.startsWith(appRoot + path.sep)) process.exit(73);',
    '  return result;',
    '};',
    `deployRuntimeBuild({ rootDir, outputDir: ${JSON.stringify(fixture.outputDir)} });`
  ].join("\n");
  fs.writeFileSync(childPath, script);
  const result = spawnSync(process.execPath, [childPath], { cwd: fixture.rootDir, encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(result.status, 73, `child must exit immediately after the first managed target rename: ${result.stderr || result.error || ""}`);
}

function injectUnknownAfterPreflight(fixture, relative) {
  const childPath = path.join(fixture.rootDir, "interleaved-recovery.js");
  const targetFile = deployedFile(fixture.rootDir, relative);
  const script = [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    `const { recoverPendingDeployment } = require(${JSON.stringify(deployScript)});`,
    `const rootDir = ${JSON.stringify(fixture.rootDir)};`,
    `const targetFile = ${JSON.stringify(targetFile)};`,
    'const originalRead = fs.readFileSync;',
    'let reads = 0;',
    'let injected = false;',
    'fs.readFileSync = function (candidate, ...args) {',
    '  if (path.resolve(candidate).toLowerCase() === path.resolve(targetFile).toLowerCase()) {',
    '    reads++;',
    '    if (reads === 2) { fs.writeFileSync(targetFile, "unknown interleaving bytes"); injected = true; }',
    '  }',
    '  return originalRead.call(fs, candidate, ...args);',
    '};',
    'try {',
    '  recoverPendingDeployment({ rootDir });',
    '  process.stdout.write(JSON.stringify({ reads, injected, error: null }));',
    '  process.exitCode = 4;',
    '} catch (error) {',
    '  process.stdout.write(JSON.stringify({ reads, injected, error: error.message }));',
    '  if (!injected || !error.message.includes("build_deploy_recovery_unknown_target")) process.exitCode = 5;',
    '}'
  ].join("\n");
  fs.writeFileSync(childPath, script);
  const result = spawnSync(process.execPath, [childPath], { cwd: fixture.rootDir, encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, `child must block an interleaved unknown target: ${result.stderr || result.error || result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reads, 2, "the unknown bytes are injected after the preflight read and before the restore read");
  assert.equal(report.injected, true);
  assert.match(report.error, /build_deploy_recovery_unknown_target/);
  assert.equal(fs.readFileSync(targetFile, "utf8"), "unknown interleaving bytes",
    "recovery leaves interleaved unknown target bytes untouched");
  assert.equal(readReceipt(fixture.rootDir).status, "IN_PROGRESS",
    "a target that changes after preflight leaves the durable transaction incomplete");
}

function changedFixture() {
  const fixture = makeFixture();
  writeSource(fixture.rootDir, "main/main.js", '"use strict";\nmodule.exports = "new-main";\n');
  writeSource(fixture.rootDir, "preload/preload.js", '"use strict";\nmodule.exports = "new-preload";\n');
  fixture.newManifest = rebuild(fixture);
  return fixture;
}

function maybeCreateLink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return false;
    throw error;
  }
}

function withLinkStat(targetPath, callback) {
  const originalLstat = fs.lstatSync;
  const target = path.resolve(targetPath);
  fs.lstatSync = function (candidate, ...args) {
    const stats = originalLstat.call(fs, candidate, ...args);
    if (path.resolve(candidate) !== target) return stats;
    return new Proxy(stats, {
      get(object, property) {
        if (property === "isSymbolicLink") return () => true;
        return Reflect.get(object, property, object);
      }
    });
  };
  try {
    callback();
  } finally {
    fs.lstatSync = originalLstat;
  }
}

try {
  const fixture = makeFixture();
  assert.equal(readReceipt(fixture.rootDir).status, "COMPLETED", "fixture starts from a durable deployed baseline");
  const protectedOutputs = [
    fixture.rootDir,
    path.join(fixture.rootDir, ".git", "spill"),
    path.join(fixture.rootDir, "scripts", "spill"),
    path.join(fixture.rootDir, "docs", "spill"),
    path.join(fixture.rootDir, "build", "spill"),
    path.join(fixture.rootDir, "src", "spill"),
    path.join(fixture.rootDir, "resources", "spill"),
    path.join(fixture.rootDir, "node_modules", "spill"),
    path.join(fixture.rootDir, ".codex", "spill"),
    path.join(fixture.rootDir, ".agents", "spill"),
    path.join(fixture.rootDir, ".aws", "spill"),
    path.join(fixture.rootDir, ".build"),
    path.join(fixture.rootDir, ".build", "runtime-deploy-state"),
    path.join(fixture.rootDir, "CON"),
    path.join(os.tmpdir(), "votc-outside-stage")
  ];
  for (const outputDir of protectedOutputs) {
    expectCode(() => buildRuntime({ rootDir: fixture.rootDir, outputDir }), "build_protected_output");
  }
  const traversalOutput = `${fixture.rootDir}${path.sep}stage${path.sep}..${path.sep}safe-stage`;
  expectCode(() => buildRuntime({ rootDir: fixture.rootDir, outputDir: traversalOutput }), "build_protected_output");
  expectCode(() => buildRuntime({ rootDir: sourceRoot, outputDir: path.join(sourceRoot, "scripts/spill") }), "build_protected_output");
  expectCode(() => buildRuntime({ rootDir: sourceRoot, outputDir: path.join(sourceRoot, ".build/guard-spill") }), "build_protected_output");
  if (process.platform === "win32") {
    expectCode(() => buildRuntime({ rootDir: sourceRoot, outputDir: path.join(sourceRoot, "RESOURCES/spill") }), "build_protected_output");
  }
  assert.doesNotThrow(() => buildRuntime({ rootDir: fixture.rootDir, outputDir: path.join(fixture.rootDir, "safe-stage") }),
    "isolated fixture roots retain custom output support");

  const failedPromotion = makeFixture();
  const beforeFailedPromotion = stageSnapshot(failedPromotion.outputDir);
  writeSource(failedPromotion.rootDir, "main/main.js", '"use strict";\nmodule.exports = "candidate";\n');
  rejectCandidatePromotion(failedPromotion);
  const afterFailedPromotion = stageSnapshot(failedPromotion.outputDir);
  assert.deepEqual(afterFailedPromotion, beforeFailedPromotion,
    "a rejected candidate promotion restores the complete prior stage byte-for-byte");

  const foreignStage = makeFixture();
  fs.writeFileSync(path.join(foreignStage.outputDir, "app/unmanaged.txt"), "unmanaged");
  const beforeForeignStage = stageSnapshot(foreignStage.outputDir);
  writeSource(foreignStage.rootDir, "main/main.js", '"use strict";\nmodule.exports = "candidate";\n');
  expectCode(() => rebuild(foreignStage), "build_artifact_inventory_mismatch");
  assert.deepEqual(stageSnapshot(foreignStage.outputDir), beforeForeignStage,
    "an old stage with an unowned file is refused without changing its bytes");

  const inventoryChanges = makeFixture();
  const initialManifest = verifyArtifacts(inventoryChanges.outputDir);
  const addedSource = "main/added.js";
  const addedTarget = "out/main/added.js";
  writeSource(inventoryChanges.rootDir, addedSource, '"use strict";\nmodule.exports = "added";\n');
  updateRuntimeInputs(inventoryChanges.rootDir, files => [...files, { source: addedSource, target: addedTarget }]);
  const expandedManifest = rebuild(inventoryChanges);
  assert.equal(expandedManifest.files.length, initialManifest.files.length + 1,
    "a valid mapping addition replaces the old staged inventory");
  assert(fs.existsSync(path.join(inventoryChanges.outputDir, "app", ...addedTarget.split("/"))));
  const expandedDeploy = deployRuntimeBuild({ rootDir: inventoryChanges.rootDir, outputDir: inventoryChanges.outputDir });
  assert.equal(expandedDeploy.changedFiles, 1, "deployment adds a newly mapped artifact");
  assert(fs.existsSync(deployedFile(inventoryChanges.rootDir, addedTarget)));

  const removedSource = "default_userdata/prompts/system/default.hbs";
  const removedTarget = removedSource;
  fs.unlinkSync(sourceFile(inventoryChanges.rootDir, removedSource));
  updateRuntimeInputs(inventoryChanges.rootDir, files => files.filter(item => item.source !== removedSource));
  const reducedManifest = rebuild(inventoryChanges);
  assert.equal(reducedManifest.files.length, expandedManifest.files.length - 1,
    "a valid mapping removal replaces the old staged inventory");
  assert.equal(fs.existsSync(path.join(inventoryChanges.outputDir, "app", ...removedTarget.split("/"))), false,
    "the previous managed artifact is absent from the replacement stage");
  const reducedDeploy = deployRuntimeBuild({ rootDir: inventoryChanges.rootDir, outputDir: inventoryChanges.outputDir });
  assert.equal(reducedDeploy.changedFiles, 1, "deployment removes an artifact omitted by the new mapping");
  assert.equal(fs.existsSync(deployedFile(inventoryChanges.rootDir, removedTarget)), false,
    "the removed managed target is deleted after its change is journaled");
  verifyRuntimeBuild({ rootDir: inventoryChanges.rootDir, outputDir: inventoryChanges.outputDir, deployed: true });

  const linkFixture = makeFixture({ seed: false });
  const linkPath = path.join(linkFixture.rootDir, "safe-alias");
  const linkCreated = maybeCreateLink(path.join(linkFixture.rootDir, "resources"), linkPath);
  const checkLink = () => expectCode(() => buildRuntime({ rootDir: linkFixture.rootDir, outputDir: path.join(linkPath, "spill") }),
    "build_symlink_rejected");
  if (linkCreated) checkLink();
  else {
    fs.mkdirSync(linkPath, { recursive: true });
    withLinkStat(linkPath, checkLink);
    console.log("INFO junction simulated because this host denies link creation");
  }

  const changed = changedFixture();
  crashAfterFirstTargetWrite(changed);
  const interrupted = readReceipt(changed.rootDir);
  assert.equal(interrupted.status, "IN_PROGRESS", "a child-process exit leaves a durable incomplete receipt");
  const firstAction = interrupted.actions[0];
  const secondAction = interrupted.actions[1];
  assert(firstAction && secondAction, "fixture must exercise multiple deployed files");
  const firstNewBytes = fs.readFileSync(path.join(changed.outputDir, "app", ...firstAction.path.split("/")));
  assert.deepEqual(fs.readFileSync(deployedFile(changed.rootDir, firstAction.path)), firstNewBytes,
    "the child exits after the first target has been replaced");

  const recovered = recoverPendingDeployment({ rootDir: changed.rootDir });
  assert.equal(recovered.recovered, true);
  assert.equal(readReceipt(changed.rootDir).status, "RECOVERED", "recovery retains an auditable receipt");
  const oldSnapshot = new Map(readReceipt(changed.rootDir).files.map(item => [item.path, fs.readFileSync(deployedFile(changed.rootDir, item.path))]));
  assert.equal(recoverPendingDeployment({ rootDir: changed.rootDir }).recovered, false, "a second recovery is a no-op");
  for (const [relative, bytes] of oldSnapshot) {
    assert.deepEqual(fs.readFileSync(deployedFile(changed.rootDir, relative)), bytes, "repeated recovery preserves the restored baseline");
  }
  const applied = deployRuntimeBuild({ rootDir: changed.rootDir, outputDir: changed.outputDir });
  assert.equal(applied.changedFiles, 2, "the interrupted payload can be applied after recovery");
  assert.equal(verifyRuntimeBuild({ rootDir: changed.rootDir, outputDir: changed.outputDir, deployed: true }).payloadSha256,
    changed.newManifest.payloadSha256);
  assert.equal(deployRuntimeBuild({ rootDir: changed.rootDir, outputDir: changed.outputDir }).changedFiles, 0,
    "repeating a completed deployment does not rewrite files");

  for (const failureKind of ["missing", "corrupt"]) {
    const brokenBackup = changedFixture();
    crashAfterFirstTargetWrite(brokenBackup);
    const pending = readReceipt(brokenBackup.rootDir);
    const laterAction = pending.actions[1];
    const backupFile = path.join(statePaths(brokenBackup.rootDir).backupRoot, pending.transactionId,
      ...laterAction.backupPath.split("/"));
    if (failureKind === "missing") fs.unlinkSync(backupFile);
    else fs.writeFileSync(backupFile, "corrupt backup");
    const firstBefore = fs.readFileSync(deployedFile(brokenBackup.rootDir, pending.actions[0].path));
    expectCode(() => recoverPendingDeployment({ rootDir: brokenBackup.rootDir }),
      failureKind === "missing" ? "build_deploy_backup_missing" : "build_deploy_backup_mismatch");
    assert.deepEqual(fs.readFileSync(deployedFile(brokenBackup.rootDir, pending.actions[0].path)), firstBefore,
      "all backups are checked before any target is restored");
    assert.equal(readReceipt(brokenBackup.rootDir).status, "IN_PROGRESS", "failed recovery keeps the incomplete receipt");
  }

  const unknownTarget = changedFixture();
  crashAfterFirstTargetWrite(unknownTarget);
  const unknownReceipt = readReceipt(unknownTarget.rootDir);
  const firstPath = unknownReceipt.actions[0].path;
  const unknownPath = unknownReceipt.actions[1].path;
  fs.writeFileSync(deployedFile(unknownTarget.rootDir, unknownPath), "unknown target bytes");
  const firstBeforeUnknownRecovery = fs.readFileSync(deployedFile(unknownTarget.rootDir, firstPath));
  expectCode(() => recoverPendingDeployment({ rootDir: unknownTarget.rootDir }), "build_deploy_recovery_unknown_target");
  assert.deepEqual(fs.readFileSync(deployedFile(unknownTarget.rootDir, firstPath)), firstBeforeUnknownRecovery,
    "an unknown target blocks the entire recovery before any known file is changed");
  assert.equal(fs.readFileSync(deployedFile(unknownTarget.rootDir, unknownPath), "utf8"), "unknown target bytes",
    "recovery preserves unknown target bytes");

  const interleavedOldTarget = changedFixture();
  crashAfterFirstTargetWrite(interleavedOldTarget);
  const oldTargetAction = readReceipt(interleavedOldTarget.rootDir).actions[0];
  assert(oldTargetAction.previousSha256 && oldTargetAction.targetSha256,
    "the old-target interleaving case restores an existing file");
  injectUnknownAfterPreflight(interleavedOldTarget, oldTargetAction.path);

  const interleavedNewTarget = makeFixture();
  const newSource = "main/000-added.js";
  const newTarget = "out/main/000-added.js";
  writeSource(interleavedNewTarget.rootDir, newSource, '"use strict";\nmodule.exports = "added";\n');
  updateRuntimeInputs(interleavedNewTarget.rootDir, files => [...files, { source: newSource, target: newTarget }]);
  rebuild(interleavedNewTarget);
  crashAfterFirstTargetWrite(interleavedNewTarget);
  const newTargetAction = readReceipt(interleavedNewTarget.rootDir).actions[0];
  assert.equal(newTargetAction.path, newTarget);
  assert.equal(newTargetAction.previousSha256, null,
    "the new-target interleaving case exercises recovery deletion for a previously absent file");
  injectUnknownAfterPreflight(interleavedNewTarget, newTargetAction.path);

  const unknownSeed = makeFixture({ seed: false });
  const priorMain = fs.readFileSync(deployedFile(unknownSeed.rootDir, "out/main/main.js"));
  writeSource(unknownSeed.rootDir, "main/main.js", '"use strict";\nmodule.exports = "unrelated-semantics";\n');
  rebuild(unknownSeed);
  expectCode(() => deployRuntimeBuild({ rootDir: unknownSeed.rootDir, outputDir: unknownSeed.outputDir }),
    "build_deploy_initial_target_unknown");
  assert.deepEqual(fs.readFileSync(deployedFile(unknownSeed.rootDir, "out/main/main.js")), priorMain,
    "no receipt cannot authorize replacing semantically unknown old code");
  assert.equal(fs.existsSync(statePaths(unknownSeed.rootDir).receiptPath), false, "failed initial seeding leaves no trusted receipt");

  const eolSeed = makeFixture({ seed: false, main: '"use strict";\r\nmodule.exports = "eol";\r\n' });
  fs.writeFileSync(deployedFile(eolSeed.rootDir, "out/main/main.js"), '"use strict";\nmodule.exports = "eol";\n');
  deployRuntimeBuild({ rootDir: eolSeed.rootDir, outputDir: eolSeed.outputDir });
  assert.deepEqual(fs.readFileSync(deployedFile(eolSeed.rootDir, "out/main/main.js")),
    fs.readFileSync(path.join(eolSeed.outputDir, "app/out/main/main.js")),
    "initial seed accepts UTF-8 CRLF/LF-only drift and normalizes to the generated bytes");

  const cliArguments = [
    [buildScript, "build_cli_has_no_extra_arguments"],
    [deployScript, "build_unknown_deploy_argument"],
    [verifyScript, "build_unknown_verify_argument"]
  ];
  for (const [script, errorCode] of cliArguments) {
    const result = spawnSync(process.execPath, [script, path.join(fixture.rootDir, "unsafe-output")],
      { cwd: sourceRoot, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.notEqual(result.status, 0, `${path.basename(script)} CLI rejects a custom output directory`);
    assert.match(result.stderr, new RegExp(errorCode));
  }

  console.log("V9.2 build guard: PASS (protected outputs and junctions, fixed CLI output, atomic mapping updates, durable receipt, crash recovery, fail-closed backups and targets, safe first seed)");
} finally {
  for (const rootDir of temporaryRoots.reverse()) {
    const resolved = path.resolve(rootDir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("votc-v92-build-guard-")) {
      throw new Error("v92_build_guard_cleanup_path_rejected");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

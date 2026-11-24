"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildRuntime, sha256, rejectLinks } = require("./build-runtime");
const { deployRuntimeBuild } = require("./deploy-runtime-build");
const { verifyRuntimeBuild } = require("./verify-runtime-build");
const { inspectOneLaunch } = require("./test-v9.4-windows-packaged-smoke");

const oldRevision = "e2fd6d790c8b6c304d0f9336fff2c03c6be0b106";
const oldPayload = "b9aebd5d460531fff3275e07aa2a8f162ba6a2e8dc7a138b30298e85b7896c08";

async function run() {
  const root = path.resolve(__dirname, "..");
  const candidate = process.env.VOTC_CANDIDATE_SHA;
  assert(process.platform === "win32" && process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_WORKSPACE && path.resolve(process.env.GITHUB_WORKSPACE) === root
    && /^[a-f0-9]{40}$/.test(candidate || ""), "this procedure requires an exact, isolated Windows CI checkout");
  const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true, encoding: "utf8" }).trim();
  const inputs = ["src/app", "build/runtime-inputs.json"];
  assert.equal(git("rev-parse", "HEAD"), candidate);
  git("diff", "--exit-code", "HEAD", "--", ...inputs);
  rejectLinks(path.join(root, ".build"));
  const scratch = fs.mkdtempSync(path.join(root, ".build/v98-runtime-upgrade-"));
  const profile = path.join(scratch, "profile");
  fs.mkdirSync(profile);
  const current = verifyRuntimeBuild({ rootDir: root, deployed: true });
  assert.equal(current.appVersion, "9.8.4");
  const evidence = { status: "FAIL", candidate, baseline: oldRevision, releases: [], deploys: [], syntheticProfile: true };
  const stage = (revision, version, payload) => {
    git("restore", `--source=${revision}`, "--worktree", "--", ...inputs);
    const manifest = buildRuntime({ rootDir: root });
    assert.equal(manifest.appVersion, version);
    assert.equal(manifest.payloadSha256, payload);
  };
  const deploy = (version, payload) => {
    const result = deployRuntimeBuild({ rootDir: root });
    const actual = verifyRuntimeBuild({ rootDir: root, deployed: true });
    assert.equal(actual.appVersion, version);
    assert.equal(actual.payloadSha256, payload);
    evidence.deploys.push({ version, payload, files: actual.files.length, changedFiles: result.changedFiles, backupCreated: !!result.backupDir });
    return result.changedFiles;
  };
  const launch = async (version, label) => {
    const result = await inspectOneLaunch(root, profile, version, label);
    assert.equal(result.shutdown.exit.code, 0);
    evidence.releases.push({ label, appVersion: result.appVersion, exitCode: result.shutdown.exit.code,
      ipcVersion: result.ipc.returnedVersion, mediaDecoded: result.runtimeResources.mediaDecode?.samples === 32 });
  };
  try {
    stage(oldRevision, "9.7.4", oldPayload);
    assert(deploy("9.7.4", oldPayload) > 0);
    await launch("9.7.4", "baseline");

    // The upgrade transaction should leave the same verified profile bytes in
    // place. These fixtures are synthetic and separate from Electron internals.
    const stores = ["conversation_summaries", "memory", "dynamic_history", "character-knowledge", "actions", "prompts", "letters"];
    const files = stores.map(name => {
      const directory = path.join(profile, "votc_data", name);
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, "v98-upgrade-proof.json");
      fs.writeFileSync(file, JSON.stringify({ synthetic: true, store: name }), { flag: "wx" });
      return file;
    });
    const hashFixture = () => files.map(file => sha256(fs.readFileSync(file)));
    const hashes = hashFixture();
    stage(candidate, "9.8.4", current.payloadSha256);
    assert(deploy("9.8.4", current.payloadSha256) > 0);
    assert.equal(deploy("9.8.4", current.payloadSha256), 0);
    assert.deepEqual(hashFixture(), hashes);
    await launch("9.8.4", "upgraded");

    stage(oldRevision, "9.7.4", oldPayload);
    assert(deploy("9.7.4", oldPayload) > 0);
    assert.deepEqual(hashFixture(), hashes);
    await launch("9.7.4", "rolled-back");
    assert.deepEqual(hashFixture(), hashes);
    evidence.preservedProfileFiles = hashes.length;
    evidence.status = "PASS";
  } finally {
    try {
      stage(candidate, "9.8.4", current.payloadSha256);
      deploy("9.8.4", current.payloadSha256);
    } catch (error) {
      evidence.status = "FAIL";
      throw error;
    } finally {
      fs.writeFileSync(path.join(scratch, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
      console.log("V9.8 managed runtime upgrade and rollback " + JSON.stringify(evidence));
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

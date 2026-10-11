"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildRuntime, readPayload, verifyArtifacts } = require("./build-runtime");
const { verifyRuntimeBuild } = require("./verify-runtime-build");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v91-clean-source-"));
try {
  // Allowlisted source and inventory only: no installed out, node_modules, logs or profiles.
  fs.mkdirSync(path.join(temporary, "build"));
  fs.copyFileSync(path.join(root, "build/runtime-inputs.json"), path.join(temporary, "build/runtime-inputs.json"));
  for (const item of readPayload(root)) {
    const destination = path.join(temporary, "src/app", item.source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.bytes);
  }
  const outputDir = path.join(temporary, "generated");
  const manifest = buildRuntime({ rootDir: temporary, outputDir });
  assert.equal(fs.existsSync(path.join(temporary, "resources")), false);
  assert.equal(fs.existsSync(path.join(temporary, "node_modules")), false);
  assert.deepEqual(verifyRuntimeBuild({ rootDir: temporary, outputDir }), manifest);
  const expected = readPayload(root).map(item => ({ path: item.target, bytes: item.bytes.length, sha256: item.sha256 }));
  assert.deepEqual(manifest.files, expected, "the complete source build matches the current source bytes");
  assert.deepEqual(verifyArtifacts(outputDir, expected), manifest);
  assert.deepEqual(verifyRuntimeBuild({ rootDir: root, outputDir, deployed: true }), manifest, "release checks exercise the source-generated installed payload");
  const stagedApp = path.join(temporary, "resources/app");
  fs.mkdirSync(stagedApp, { recursive: true });
  for (const item of manifest.files) {
    const destination = path.join(stagedApp, item.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(outputDir, "app", item.path), destination);
  }
  assert.deepEqual(verifyRuntimeBuild({ rootDir: temporary, outputDir, deployed: true }), manifest);
  console.log(`V9.1 clean source build: PASS (${manifest.files.length} real source files, no installed out or runtime dependencies needed to build)`);
} finally {
  const resolved = path.resolve(temporary);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert(path.basename(resolved).startsWith("votc-v91-clean-source-"));
  fs.rmSync(resolved, { recursive: true, force: true });
}

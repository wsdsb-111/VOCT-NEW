"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildRuntime, verifyArtifacts } = require("./build-runtime");
const { verifyRuntimeBuild } = require("./verify-runtime-build");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v91-build-"));
try {
  const files = [
    ["package.json", "package.json", JSON.stringify({ name: "fixture", version: "9.1.0", main: "out/main/main.js" })],
    ["main/main.js", "out/main/main.js", '"use strict";\nmodule.exports = 1;\n'],
    ["preload/preload.js", "out/preload/preload.js", '"use strict";\nmodule.exports = {};\n'],
    ["renderer/index.html", "out/renderer/index.html", "<!doctype html><title>fixture</title>\r\n"],
    ["default_userdata/prompts/system/default.hbs", "default_userdata/prompts/system/default.hbs", "可信事实\r\n{{name}}\n"],
    ["default_userdata/gamedata_typedefs.js", "default_userdata/gamedata_typedefs.js", "export interface Fixture { id: string; }\r\n"]
  ];
  fs.mkdirSync(path.join(temporary, "build"));
  fs.writeFileSync(path.join(temporary, "build/runtime-inputs.json"), JSON.stringify({ schemaVersion: 1, files: files.map(([source, target]) => ({ source, target })) }));
  for (const [source, , content] of files) {
    const file = path.join(temporary, "src/app", source);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const outputDir = path.join(temporary, "stage");
  const first = buildRuntime({ rootDir: temporary, outputDir });
  assert.equal(fs.existsSync(path.join(temporary, "resources/app/out")), false, "old out is not available as a hidden input");
  assert.equal(fs.existsSync(path.join(temporary, "resources/app/node_modules")), false, "builder has no install-time dependencies");
  for (const [source, target] of files) {
    assert.deepEqual(fs.readFileSync(path.join(temporary, "src/app", source)), fs.readFileSync(path.join(outputDir, "app", target)), "raw Prompt/code bytes survive the source build");
  }
  assert.deepEqual(buildRuntime({ rootDir: temporary, outputDir }), first, "repeat builds have no time, random or absolute path fields");
  assert.deepEqual(verifyRuntimeBuild({ rootDir: temporary, outputDir }), first);
  fs.appendFileSync(path.join(temporary, "src/app/main/main.js"), "// deliberate source edit\n");
  assert.throws(() => verifyRuntimeBuild({ rootDir: temporary, outputDir }), /build_source_artifact_mismatch/);
  const changed = buildRuntime({ rootDir: temporary, outputDir });
  assert.notEqual(changed.payloadSha256, first.payloadSha256, "editable source changes produce changed outputs");
  fs.appendFileSync(path.join(outputDir, "app/out/main/main.js"), "// artifact corruption\n");
  assert.throws(() => verifyArtifacts(outputDir), /build_artifact_hash_mismatch/);
  fs.writeFileSync(path.join(temporary, "src/app/main/injected.js"), "module.exports=0;");
  assert.throws(() => buildRuntime({ rootDir: temporary, outputDir: path.join(temporary, "extra-stage") }), /build_source_inventory_mismatch/);
  console.log("V9.1 source build: PASS (no old out, byte parity, deterministic rebuild, source edits and tamper rejection)");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

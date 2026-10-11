"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRuntime, readPayload, verifyArtifacts } = require("./build-runtime");
const { verifyRuntimeBuild } = require("./verify-runtime-build");

const failures = [];
const tempRoots = [];
const promptBytes = Buffer.from(
  "{{! VOTC_SEGMENT:stable_global }}\r\n这是原始 Prompt 字节。  \r\n",
  "utf8"
);

const inputFiles = [
  { source: "package.json", target: "package.json", bytes: Buffer.from(JSON.stringify({
    name: "votc-fixture",
    version: "9.0.0",
    main: "out/main/main.js"
  }, null, 2) + "\n") },
  { source: "main/main.js", target: "out/main/main.js", bytes: Buffer.from("\"use strict\";\nmodule.exports = { runtime: \"fixture\" };\n") },
  { source: "preload/preload.js", target: "out/preload/preload.js", bytes: Buffer.from("\"use strict\";\nmodule.exports = {};\n") },
  { source: "renderer/index.html", target: "out/renderer/index.html", bytes: Buffer.from("<!doctype html><script src=\"./assets/app.js\"></script>\n") },
  { source: "renderer/assets/app.js", target: "out/renderer/assets/app.js", bytes: Buffer.from("globalThis.votcBuildFixture = true;\n") },
  { source: "renderer/assets/app.css", target: "out/renderer/assets/app.css", bytes: Buffer.from("body { color: #123; }\r\n") },
  { source: "default_userdata/gamedata_typedefs.js", target: "default_userdata/gamedata_typedefs.js",
    bytes: Buffer.from("export interface GameDataFixture { name: string; }\r\n") },
  { source: "default_userdata/prompts/system/default.hbs", target: "default_userdata/prompts/system/default.hbs", bytes: promptBytes }
];

function makeFixture() {
  const tempRoot = fs.mkdtempSync(path.join(__dirname, ".tmp-v9.1-independent-qa-"));
  tempRoots.push(tempRoot);
  const rootDir = path.join(tempRoot, "repo");
  fs.mkdirSync(path.join(rootDir, "build"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src", "app"), { recursive: true });
  writeInputFiles(rootDir, inputFiles);
  writeInputManifest(rootDir, inputFiles);
  return { tempRoot, rootDir };
}

function writeInputFiles(rootDir, files) {
  for (const item of files) {
    const destination = path.join(rootDir, "src", "app", item.source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.bytes);
  }
}

function writeInputManifest(rootDir, files) {
  fs.writeFileSync(path.join(rootDir, "build", "runtime-inputs.json"), JSON.stringify({
    schemaVersion: 1,
    files: files.map(({ source, target }) => ({ source, target }))
  }, null, 2) + "\n");
}

function record(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error?.stack || error}`);
    console.error(`FAIL ${name}: ${error?.message || error}`);
  }
}

function expectCode(callback, code) {
  assert.throws(callback, error => error instanceof Error && error.message.includes(code), `expected ${code}`);
}

function withRenameSync(handler, callback) {
  const originalRename = fs.renameSync;
  fs.renameSync = function (source, target, ...args) {
    return handler(originalRename, path.resolve(source), path.resolve(target), ...args);
  };
  try {
    callback();
  } finally {
    fs.renameSync = originalRename;
  }
}

function withLinkStat(targetPath, callback, { missing = false } = {}) {
  const originalLstat = fs.lstatSync;
  const originalExists = fs.existsSync;
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
  if (missing) {
    fs.existsSync = function (candidate) {
      if (path.resolve(candidate) === target) return false;
      return originalExists.call(fs, candidate);
    };
  }
  try {
    callback();
  } finally {
    fs.lstatSync = originalLstat;
    fs.existsSync = originalExists;
  }
}

function tryLink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return false;
    throw error;
  }
}

function outputFile(outputDir, target) {
  return path.join(outputDir, "app", ...target.split("/"));
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

record("clean source build, exact Prompt bytes and repeatable manifest", () => {
  const { rootDir, tempRoot } = makeFixture();
  const first = path.join(rootDir, "stage-one");
  const second = path.join(rootDir, "stage-two");
  const firstManifest = buildRuntime({ rootDir, outputDir: first });
  assert.equal(fs.existsSync(path.join(rootDir, "resources", "app", "out")), false, "the fixture has no old out tree");
  assert.equal(fs.existsSync(path.join(rootDir, "resources", "app", "node_modules")), false, "the fixture has no vendored dependencies");
  assert.deepEqual(fs.readFileSync(outputFile(first, "default_userdata/prompts/system/default.hbs")), promptBytes,
    "static Prompt bytes, including CRLF and trailing spaces, are copied without normalization");
  assert.deepEqual(fs.readFileSync(outputFile(first, "default_userdata/gamedata_typedefs.js")),
    Buffer.from("export interface GameDataFixture { name: string; }\r\n"),
    "TypeScript declarations inside default_userdata are copied as opaque bytes, not parsed as runtime JavaScript");
  const expectedFiles = readPayload(rootDir).map(item => ({ path: item.target, bytes: item.bytes.length, sha256: item.sha256 }));
  assert.deepEqual(firstManifest.files, expectedFiles);
  verifyRuntimeBuild({ rootDir, outputDir: first });

  const configPath = path.join(rootDir, "build", "runtime-inputs.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.files.reverse();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const secondManifest = buildRuntime({ rootDir, outputDir: second });
  assert.deepEqual(secondManifest, firstManifest, "manifest ordering is independent of input list ordering");
  assert.equal(fs.readFileSync(path.join(second, "runtime-build-manifest.json"), "utf8"),
    fs.readFileSync(path.join(first, "runtime-build-manifest.json"), "utf8"), "manifest bytes are reproducible across output paths");
  assert.equal(fs.readFileSync(path.join(first, "runtime-build-manifest.json"), "utf8").includes(tempRoot), false,
    "the manifest must not embed absolute machine paths");
});

record("source edits change the generated artifact and payload hash", () => {
  const { rootDir } = makeFixture();
  const first = path.join(rootDir, "stage-before");
  const second = path.join(rootDir, "stage-after");
  const source = path.join(rootDir, "src", "app", "main", "main.js");
  const before = buildRuntime({ rootDir, outputDir: first });
  const editedBytes = Buffer.concat([fs.readFileSync(source), Buffer.from("// fixture source edit\n")]);
  fs.writeFileSync(source, editedBytes);
  const after = buildRuntime({ rootDir, outputDir: second });
  assert.deepEqual(fs.readFileSync(outputFile(second, "out/main/main.js")), editedBytes);
  assert.notEqual(after.files.find(item => item.path === "out/main/main.js").sha256,
    before.files.find(item => item.path === "out/main/main.js").sha256);
  assert.notEqual(after.payloadSha256, before.payloadSha256);
});

if (process.platform === "win32") {
  record("a transient candidate-to-output EPERM retries and installs the new stage", () => {
    const { rootDir } = makeFixture();
    const stage = path.join(rootDir, "stage");
    const baseline = buildRuntime({ rootDir, outputDir: stage });
    const source = path.join(rootDir, "src", "app", "main", "main.js");
    const editedBytes = Buffer.concat([fs.readFileSync(source), Buffer.from("// transient rename fixture\n")]);
    fs.writeFileSync(source, editedBytes);
    let candidateFailures = 0;
    let after;
    withRenameSync((originalRename, from, to, ...args) => {
      if (to === path.resolve(stage) && path.basename(from).startsWith(".votc-source-stage-")
        && !path.basename(from).endsWith("-previous") && candidateFailures === 0) {
        candidateFailures++;
        const error = new Error("fixture_transient_eperm");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(from, to, ...args);
    }, () => {
      after = buildRuntime({ rootDir, outputDir: stage });
    });
    assert.equal(candidateFailures, 1, "only the first candidate-to-output rename should be injected");
    assert.deepEqual(fs.readFileSync(outputFile(stage, "out/main/main.js")), editedBytes);
    assert.notEqual(after.payloadSha256, baseline.payloadSha256);
    verifyArtifacts(stage, after.files);
  });

  record("persistent candidate-to-output EPERM expires and restores the prior stage", () => {
    const { rootDir } = makeFixture();
    const stage = path.join(rootDir, "stage");
    buildRuntime({ rootDir, outputDir: stage });
    const previousManifest = fs.readFileSync(path.join(stage, "runtime-build-manifest.json"));
    const previousMain = fs.readFileSync(outputFile(stage, "out/main/main.js"));
    fs.appendFileSync(path.join(rootDir, "src", "app", "main", "main.js"), "// persistent rename fixture\n");
    let candidateFailures = 0;
    let buildError = null;
    withRenameSync((originalRename, from, to, ...args) => {
      if (to === path.resolve(stage) && path.basename(from).startsWith(".votc-source-stage-")
        && !path.basename(from).endsWith("-previous")) {
        candidateFailures++;
        const error = new Error("fixture_persistent_eperm");
        error.code = "EPERM";
        throw error;
      }
      return originalRename(from, to, ...args);
    }, () => {
      try {
        buildRuntime({ rootDir, outputDir: stage });
      } catch (error) {
        buildError = error;
      }
    });
    assert.equal(buildError?.code, "EPERM", "persistent rename failures should be reported after retry expiry");
    assert.equal(candidateFailures, 6, "the initial attempt plus five bounded retries should be made");
    assert.deepEqual(fs.readFileSync(path.join(stage, "runtime-build-manifest.json")), previousManifest,
      "the previous manifest must be restored byte-for-byte");
    assert.deepEqual(fs.readFileSync(outputFile(stage, "out/main/main.js")), previousMain,
      "the previous artifact must remain installed");
    verifyArtifacts(stage);
  });
} else {
  console.log("SKIP Windows-only directory rename retry fixtures");
}

record("missing source fails without falling back to an old out file or altering prior stage", () => {
  const { rootDir } = makeFixture();
  const stage = path.join(rootDir, "stage");
  const baseline = buildRuntime({ rootDir, outputDir: stage });
  const priorArtifact = fs.readFileSync(outputFile(stage, "out/main/main.js"));
  fs.mkdirSync(path.join(rootDir, "resources", "app", "out", "main"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "resources", "app", "out", "main", "main.js"), "module.exports = 'stale fallback';\n");
  fs.unlinkSync(path.join(rootDir, "src", "app", "main", "main.js"));
  expectCode(() => buildRuntime({ rootDir, outputDir: stage }), "build_source_inventory_mismatch");
  assert.deepEqual(fs.readFileSync(outputFile(stage, "out/main/main.js")), priorArtifact);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stage, "runtime-build-manifest.json"), "utf8")), baseline);
});

record("unlisted source files are rejected until explicitly added to the input manifest", () => {
  const { rootDir } = makeFixture();
  const unexpected = path.join(rootDir, "src", "app", "main", "untracked.js");
  fs.writeFileSync(unexpected, "module.exports = 'untracked';\n");
  expectCode(() => buildRuntime({ rootDir, outputDir: path.join(rootDir, "stage") }), "build_source_inventory_mismatch");
  assert.equal(fs.existsSync(path.join(rootDir, "stage")), false);
});

record("manifest traversal is rejected without touching an outside sentinel", () => {
  const { rootDir, tempRoot } = makeFixture();
  const sentinel = path.join(tempRoot, "outside.txt");
  fs.writeFileSync(sentinel, "do not change");
  const configPath = path.join(rootDir, "build", "runtime-inputs.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.files[0].source = "../outside.txt";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  expectCode(() => buildRuntime({ rootDir, outputDir: path.join(rootDir, "stage") }), "build_invalid_path");
  assert.equal(fs.readFileSync(sentinel, "utf8"), "do not change");
  assert.equal(fs.existsSync(path.join(rootDir, "stage")), false);
});

record("source directory junctions are rejected", () => {
  const { rootDir, tempRoot } = makeFixture();
  const outside = path.join(tempRoot, "outside-source");
  const junction = path.join(rootDir, "src", "app", "main", "outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.txt"), "fixture only");
  const linked = tryLink(outside, junction, process.platform === "win32" ? "junction" : "dir");
  if (linked) {
    expectCode(() => readPayload(rootDir), "build_symlink_rejected");
  } else {
    fs.mkdirSync(junction, { recursive: true });
    withLinkStat(junction, () => expectCode(() => readPayload(rootDir), "build_symlink_rejected"));
    console.log("INFO source junction simulated because this host denies link creation");
  }
});

record("output junctions are rejected and outside contents stay unchanged", () => {
  const { rootDir, tempRoot } = makeFixture();
  const stage = path.join(rootDir, "stage");
  const outside = path.join(tempRoot, "outside-output");
  const mainDir = path.join(stage, "app", "out", "main");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "main.js"), "outside sentinel\n");
  buildRuntime({ rootDir, outputDir: stage });
  fs.rmSync(mainDir, { recursive: true, force: true });
  const linked = tryLink(outside, mainDir, process.platform === "win32" ? "junction" : "dir");
  if (linked) {
    expectCode(() => verifyArtifacts(stage), "build_symlink_rejected");
  } else {
    fs.mkdirSync(mainDir, { recursive: true });
    fs.writeFileSync(path.join(mainDir, "main.js"), fs.readFileSync(path.join(rootDir, "src", "app", "main", "main.js")));
    withLinkStat(mainDir, () => expectCode(() => verifyArtifacts(stage), "build_symlink_rejected"));
    console.log("INFO output junction simulated because this host denies link creation");
  }
  assert.equal(fs.readFileSync(path.join(outside, "main.js"), "utf8"), "outside sentinel\n");
});

record("dangling output links are rejected before a stage is written", () => {
  const { rootDir } = makeFixture();
  const stage = path.join(rootDir, "stage");
  fs.mkdirSync(stage, { recursive: true });
  withLinkStat(stage, () => expectCode(() => buildRuntime({ rootDir, outputDir: stage }), "build_symlink_rejected"), { missing: true });
});

record("manifest file symlinks are rejected before verification or writing", () => {
  const { rootDir, tempRoot } = makeFixture();
  const stage = path.join(rootDir, "stage");
  const externalManifest = path.join(tempRoot, "external-manifest.json");
  buildRuntime({ rootDir, outputDir: stage });
  const manifestPath = path.join(stage, "runtime-build-manifest.json");
  const external = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  external.appVersion = "OUTSIDE_SENTINEL";
  fs.writeFileSync(externalManifest, JSON.stringify(external, null, 2));
  const before = fs.readFileSync(externalManifest);
  fs.unlinkSync(manifestPath);
  const linked = tryLink(externalManifest, manifestPath, "file");
  if (!linked) fs.copyFileSync(externalManifest, manifestPath);

  let verifyError = null;
  const verify = () => {
    try {
      verifyArtifacts(stage);
    } catch (error) {
      verifyError = error;
    }
  };
  if (linked) verify();
  else withLinkStat(manifestPath, verify);
  assert.match(verifyError?.message || "", /build_symlink_rejected/, "verification must reject a linked manifest file");

  let buildError = null;
  const build = () => {
    try {
      buildRuntime({ rootDir, outputDir: stage });
    } catch (error) {
      buildError = error;
    }
  };
  if (linked) build();
  else withLinkStat(manifestPath, build);
  assert.match(buildError?.message || "", /build_symlink_rejected/, "build must reject a linked manifest before writing");
  assert.deepEqual(fs.readFileSync(externalManifest), before, "outside manifest sentinel remains byte-identical");
  if (!linked) console.log("INFO manifest symlink simulated because this host denies link creation");
});

record("protected output paths are rejected", () => {
  const { rootDir } = makeFixture();
  for (const outputDir of [
    rootDir,
    path.join(rootDir, "src", "spill"),
    path.join(rootDir, "resources", "app", "out"),
    path.join(rootDir, "build", "spill")
  ]) {
    expectCode(() => buildRuntime({ rootDir, outputDir }), "build_protected_output");
  }
  if (process.platform === "win32") {
    expectCode(() => buildRuntime({ rootDir, outputDir: path.join(rootDir, "RESOURCES", "app", "out") }),
      "build_protected_output");
  }
});

record("artifact tampering and unlisted files fail verification", () => {
  const { rootDir } = makeFixture();
  const stage = path.join(rootDir, "stage");
  buildRuntime({ rootDir, outputDir: stage });
  fs.writeFileSync(outputFile(stage, "out/main/main.js"), "module.exports = 'tampered';\n");
  expectCode(() => verifyArtifacts(stage), "build_artifact_hash_mismatch");

  const { rootDir: secondRoot } = makeFixture();
  const secondStage = path.join(secondRoot, "stage");
  buildRuntime({ rootDir: secondRoot, outputDir: secondStage });
  fs.writeFileSync(outputFile(secondStage, "out/main/unlisted.js"), "module.exports = 'extra';\n");
  expectCode(() => verifyArtifacts(secondStage), "build_artifact_inventory_mismatch");
});

record("output root rejects foreign siblings", () => {
  const { rootDir } = makeFixture();
  const stage = path.join(rootDir, "stage");
  buildRuntime({ rootDir, outputDir: stage });
  fs.writeFileSync(path.join(stage, "foreign.txt"), "not in build output");
  expectCode(() => buildRuntime({ rootDir, outputDir: stage }), "build_foreign_output");
  expectCode(() => verifyRuntimeBuild({ rootDir, outputDir: stage }), "build_foreign_output");
});

record("failed syntax build can be retried after fixing the source", () => {
  const { rootDir } = makeFixture();
  const stage = path.join(rootDir, "stage");
  const source = path.join(rootDir, "src", "app", "main", "main.js");
  const original = fs.readFileSync(source);
  buildRuntime({ rootDir, outputDir: stage });
  fs.writeFileSync(source, "module.exports = {\n");
  expectCode(() => buildRuntime({ rootDir, outputDir: stage }), "build_syntax_failed");
  fs.writeFileSync(source, original);
  assert.doesNotThrow(() => buildRuntime({ rootDir, outputDir: stage }), "a corrected source should rebuild into the same staging path");
});

record("deployed runtime parity detects drift", () => {
  const { rootDir } = makeFixture();
  const stage = path.join(rootDir, "stage");
  buildRuntime({ rootDir, outputDir: stage });
  copyTree(path.join(stage, "app"), path.join(rootDir, "resources", "app"));
  verifyRuntimeBuild({ rootDir, outputDir: stage, deployed: true });
  fs.appendFileSync(path.join(rootDir, "resources", "app", "default_userdata", "prompts", "system", "default.hbs"), "drift");
  expectCode(() => verifyRuntimeBuild({ rootDir, outputDir: stage, deployed: true }), "build_deployed_mismatch");
});

record("LFS pointer source files are rejected", () => {
  const { rootDir } = makeFixture();
  fs.writeFileSync(path.join(rootDir, "src", "app", "renderer", "assets", "app.css"),
    "version https://git-lfs.github.com/spec/v1\noid sha256:fixture\nsize 12\n");
  expectCode(() => readPayload(rootDir), "build_lfs_pointer_rejected");
});

for (const tempRoot of tempRoots) {
  const resolved = path.resolve(tempRoot);
  const tempPrefix = path.resolve(__dirname) + path.sep;
  if (!resolved.startsWith(tempPrefix)) throw new Error("qa_cleanup_outside_temp");
  fs.rmSync(resolved, { recursive: true, force: true });
}

if (failures.length) {
  throw new Error(`V9.1 independent QA failed (${failures.length}):\n${failures.join("\n\n")}`);
}

console.log("V9.1 independent QA: PASS (source-only reproducibility, manifest and Prompt bytes, path/link defenses, tamper and deployment checks)");

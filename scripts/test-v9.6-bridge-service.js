"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseBridgeHello } = require("../src/app/main/bridge/bridge-hello-parser");
const { BridgeCompatibilityService } = require("../src/app/main/bridge/bridge-compatibility-service");
const manifest = require("../src/app/main/bridge/runtime-manifest.json");

const capabilityIds = Object.keys(manifest.capabilities);
const fullCaps = capabilityIds.map(id => `${id}:1`).join(",");

function helloLine(options = {}) {
  const fields = [
    `schema=${options.schema || "1"}`,
    `protocol=${options.protocol || "1.0"}`,
    `mod=${options.mod || "2.0.5"}`,
    `upstream=${options.upstream || "2.0.4"}`,
    `revision=${options.revision || "1"}`,
    `load=${options.load || "votc-load-1"}`,
    `caps=${options.caps === undefined ? fullCaps : options.caps}`
  ];
  if (options.extensions) fields.push(...options.extensions);
  return `VOTC:BRIDGE_HELLO/;/${fields.join("/;/")}`;
}

function loadLine(token = "votc-load-1") {
  return `VOTC:LOAD_SESSION/;/${token}`;
}

function createService(logPath, options = {}) {
  return new BridgeCompatibilityService({
    getLogPath: () => typeof logPath === "function" ? logPath() : logPath,
    fs,
    manifest,
    pollIntervalMs: 60000,
    helloWaitMs: 15000,
    ...options
  });
}

function appendLines(filePath, ...lines) {
  fs.appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function withTempDirectory(callback) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v96-bridge-"));
  try {
    await callback(tempDirectory);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

async function parserContracts() {
  const valid = helloLine();
  assert.equal(parseBridgeHello("VOTC:DATE/;/123"), null, "unrelated markers must not be parsed as Hello");
  assert.equal(parseBridgeHello("VOTC:BRIDGE_HELLOX/;/schema=1"), null, "nearby marker text must not be recognized");
  const parsed = parseBridgeHello(`[fixture] ${valid}`);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.hello, {
    schemaVersion: 1,
    bridgeProtocol: { major: 1, minor: 0 },
    modBaseVersion: "2.0.5",
    upstreamBaseVersion: "2.0.4",
    voctBridgeRevision: 1,
    loadEpoch: "votc-load-1",
    capabilities: Object.fromEntries(capabilityIds.map(id => [id, { revision: 1, required: false }]))
  });
  assert.equal(parseBridgeHello(`${valid}/;/x_future=kept` ).ok, true, "unknown x_ fields are optional");
  assert.equal(parseBridgeHello(`${valid}/;/required_future=1`).reasonCode, "HELLO_UNKNOWN_REQUIRED_FIELD");
  assert.equal(parseBridgeHello(`${valid}/;/future=1`).reasonCode, "HELLO_UNKNOWN_FIELD");
  assert.equal(parseBridgeHello(valid.replace("/;/protocol=1.0", "/;/schema=1/;/protocol=1.0")).reasonCode, "HELLO_FIELD_DUPLICATE");
  assert.equal(parseBridgeHello(valid.replace("/;/revision=1", "")).reasonCode, "HELLO_FIELD_MISSING");
  assert.equal(parseBridgeHello(valid.replace("/;/schema=1", "/;/schema=01")).reasonCode, "HELLO_SCHEMA_INVALID");
  assert.equal(parseBridgeHello(valid.replace("/;/protocol=1.0", "/;/protocol=1.x")).reasonCode, "HELLO_PROTOCOL_INVALID");
  assert.equal(parseBridgeHello(valid.replace("/;/mod=2.0.5", "/;/mod=2.x.5")).reasonCode, "HELLO_MOD_VERSION_INVALID");
  assert.equal(parseBridgeHello(valid.replace("character_export:1,", "character_export:1,character_export:2,")).reasonCode, "HELLO_CAPABILITIES_INVALID");
  assert.equal(parseBridgeHello(`${valid}/;/x_future=${"a".repeat(4100)}`).reasonCode, "HELLO_TOO_LONG");
  const required = parseBridgeHello(helloLine({ caps: `${fullCaps},!future_capability:1` }));
  assert.equal(required.ok, true);
  assert.deepEqual(required.hello.capabilities.future_capability, { revision: 1, required: true });
}

async function sessionBindingContracts(tempDirectory) {
  const logPath = path.join(tempDirectory, "debug.log");
  const runFilePath = path.join(tempDirectory, "votc.txt");
  fs.writeFileSync(logPath, `${loadLine("votc-load-old")}\n${helloLine({ load: "votc-load-old" })}\n`, "utf8");
  fs.writeFileSync(runFilePath, "fixture-runfile-sentinel", "utf8");
  const service = createService(logPath);
  const startup = await service.start();
  assert.equal(startup.status, "UNKNOWN", "startup must begin reading at EOF and distrust an old Hello");
  assert.equal(startup.sessionEvidence.helloSeen, false);
  assert.equal(service.assertFeature("action"), true, "legacy UNKNOWN must retain the existing business checks");

  appendLines(logPath, helloLine({ load: "votc-load-old" }));
  let state = await service.redetect();
  assert.equal(state.status, "UNKNOWN", "a Hello without a fresh load boundary must not be trusted");

  appendLines(logPath, loadLine("votc-load-101"), helloLine({ load: "votc-load-stale" }));
  state = await service.redetect();
  assert.equal(state.status, "PENDING", "a mismatched or late Hello cannot satisfy a fresh load");
  assert.equal(state.reasonCode, "HELLO_LOAD_SESSION_MISMATCH");
  assert.equal(state.sessionEvidence.helloSeen, true);
  assert.equal(state.sessionEvidence.helloBoundToCurrentSession, false);
  appendLines(logPath, helloLine({ load: "votc-load-101" }));
  state = await service.redetect();
  assert.equal(state.status, "SUPPORTED");
  assert.equal(state.modBaseVersion, "2.0.5");
  assert.equal(state.upstreamBaseVersion, "2.0.4");
  assert.equal(state.sessionEvidence.helloSeen, true);
  assert.equal(state.sessionEvidence.helloBoundToCurrentSession, true);
  assert.equal(JSON.stringify(state).includes("votc-load-101"), false, "the Hello token must not leave the service");
  assert.equal(JSON.stringify(state).includes(logPath), false, "the log path must not leave the service");

  const supported = JSON.stringify(state);
  appendLines(logPath, helloLine({ load: "votc-load-101", protocol: "2.0" }));
  state = await service.redetect();
  assert.equal(state.status, "SUPPORTED", "a conflicting duplicate Hello cannot replace the accepted declaration");
  assert.equal(state.modBaseVersion, "2.0.5");
  assert.equal(JSON.stringify(state), supported, "ignored duplicate Hello rows do not mutate the accepted snapshot");

  const generation = state.sessionEvidence.generation;
  assert.equal(state.channels.debugLog, "OBSERVED", "a newly read LOAD boundary proves only the debug-log channel");
  assert.equal(state.channels.clipboard, "UNKNOWN", "Hello does not prove clipboard transport");
  assert.equal(service.observeEvidence("runFileAck", { verified: true, generation: generation - 1 }), null, "stale business evidence must be rejected");
  assert.equal(service.observeEvidence("runFileAck", { verified: false, generation }), null, "raw markers are not business verification");
  assert.equal(state.channels.runFileAck, "UNKNOWN");
  assert.equal(service.observeEvidence("runFileAck", { verified: true, generation }), generation);
  assert.equal(service.getState().channels.runFileAck, "OBSERVED");
  assert.equal(service.observeEvidence("letterReceipt", { verified: true, generation, available: false }), generation);
  assert.equal(service.getState().channels.letterReceipt, "UNAVAILABLE");

  appendLines(logPath, loadLine("votc-load-101"));
  state = await service.redetect();
  assert.equal(state.status, "PENDING", "a repeated token at a new boundary creates a new in-process generation");
  assert.ok(state.sessionEvidence.generation > generation);
  assert.equal(state.sessionEvidence.helloBoundToCurrentSession, false);
  assert.equal(state.channels.runFileAck, "UNKNOWN", "new loads clear previous channel evidence");
  appendLines(logPath, helloLine({ load: "votc-load-101" }));
  assert.equal((await service.redetect()).status, "SUPPORTED");
  assert.equal(fs.readFileSync(runFilePath, "utf8"), "fixture-runfile-sentinel", "redetect must not touch the RunFile");
  await service.stop();
}

async function compatibilityContracts(tempDirectory) {
  const logPath = path.join(tempDirectory, "compatibility.log");
  fs.writeFileSync(logPath, "", "utf8");
  const service = createService(logPath);
  await service.start();

  appendLines(logPath, loadLine("votc-load-optional"), helloLine({ load: "votc-load-optional", caps: fullCaps.replace("action_readback:1,", "") }));
  let state = await service.redetect();
  assert.equal(state.status, "DEGRADED");
  assert.equal(state.features.action.allowed, true);
  assert.equal(state.features.actionConfirmation.allowed, false);
  assert.throws(() => service.assertFeature("actionConfirmation"), error => error.code === "bridge_feature_unavailable");

  appendLines(logPath, loadLine("votc-load-core"), helloLine({ load: "votc-load-core", caps: fullCaps.replace("character_export:1,", "") }));
  state = await service.redetect();
  assert.equal(state.status, "INCOMPATIBLE");
  assert.equal(state.reasonCode, "REQUIRED_CAPABILITY_MISSING");
  assert.equal(state.features.conversation.allowed, false);
  assert.equal(state.features.action.allowed, true, "unrelated features retain their explicit manifest-derived permission");
  assert.throws(() => service.assertFeature("conversation"), error => error.code === "bridge_feature_unavailable");
  assert.equal(service.assertFeature("action"), true);

  appendLines(logPath, loadLine("votc-load-optional-unknown"), helloLine({ load: "votc-load-optional-unknown", caps: `${fullCaps},future_export:1` }));
  state = await service.redetect();
  assert.equal(state.status, "SUPPORTED", "unknown optional capabilities are ignored");
  assert.ok(state.diagnostics.includes("UNKNOWN_OPTIONAL_CAPABILITY_IGNORED"));
  assert.equal(JSON.stringify(state).includes("future_export"), false, "unknown capability identifiers are not copied into diagnostics");

  appendLines(logPath, loadLine("votc-load-unknown-required"), helloLine({ load: "votc-load-unknown-required", caps: `${fullCaps},!future_export:1` }));
  state = await service.redetect();
  assert.equal(state.status, "INCOMPATIBLE");
  assert.equal(state.reasonCode, "UNKNOWN_REQUIRED_CAPABILITY");
  assert.ok(Object.values(state.features).every(feature => feature.allowed === false));

  appendLines(logPath, loadLine("votc-load-protocol"), helloLine({ load: "votc-load-protocol", protocol: "2.0" }));
  state = await service.redetect();
  assert.equal(state.status, "INCOMPATIBLE");
  assert.equal(state.reasonCode, "UNSUPPORTED_PROTOCOL_OR_SCHEMA");
  assert.equal(state.sessionEvidence.helloBoundToCurrentSession, true, "a valid matching Hello remains bound even when its protocol is unsupported");
  assert.ok(Object.values(state.features).every(feature => feature.allowed === false));

  appendLines(logPath, loadLine("votc-load-minor"), helloLine({ load: "votc-load-minor", protocol: "1.1" }));
  state = await service.redetect();
  assert.equal(state.status, "INCOMPATIBLE", "protocol minor bounds are checked against the runtime manifest");
  assert.equal(state.reasonCode, "UNSUPPORTED_PROTOCOL_OR_SCHEMA");

  appendLines(logPath, loadLine("votc-load-revision"), helloLine({ load: "votc-load-revision", caps: fullCaps.replace("native_date:1", "native_date:2") }));
  state = await service.redetect();
  assert.equal(state.status, "DEGRADED", "unsupported optional revisions disable only dependent features");
  assert.equal(state.features.letter.allowed, false);
  assert.equal(state.features.action.allowed, true);

  appendLines(logPath, loadLine("votc-load-required-revision"), helloLine({ load: "votc-load-required-revision", caps: fullCaps.replace("character_export:1", "!character_export:2") }));
  state = await service.redetect();
  assert.equal(state.status, "INCOMPATIBLE");
  assert.equal(state.reasonCode, "REQUIRED_CAPABILITY_REVISION_UNSUPPORTED");
  assert.ok(Object.values(state.features).every(feature => feature.allowed === false));

  appendLines(logPath, loadLine("votc-load-malformed"), helloLine({ load: "votc-load-malformed", schema: "bad" }));
  state = await service.redetect();
  assert.equal(state.status, "INCOMPATIBLE");
  assert.equal(state.sessionEvidence.helloSeen, true);
  assert.equal(state.sessionEvidence.helloBoundToCurrentSession, false, "malformed Hello syntax cannot bind to a load generation");
  await service.stop();
}

async function fileLifecycleContracts(tempDirectory) {
  const firstPath = path.join(tempDirectory, "first.log");
  const secondPath = path.join(tempDirectory, "second.log");
  fs.writeFileSync(firstPath, "", "utf8");
  fs.writeFileSync(secondPath, `${loadLine("votc-load-old-path")}\n${helloLine({ load: "votc-load-old-path" })}\n`, "utf8");
  let activePath = firstPath;
  let now = 1000;
  const service = createService(() => activePath, { clock: () => now, helloWaitMs: 10, maxReadBytesPerPoll: 1024, maxLineBytes: 512 });
  await service.start();
  now += 20;
  let state = await service.redetect();
  assert.equal(state.status, "UNKNOWN");
  assert.equal(state.reasonCode, "LEGACY_UNVERIFIED", "old Mod mode waits for a new load before bridge verification");

  activePath = secondPath;
  state = await service.redetect();
  assert.equal(state.status, "UNKNOWN", "switching log paths starts at the new file EOF");
  assert.equal(state.sessionEvidence.helloSeen, false);
  assert.equal(state.sessionEvidence.helloBoundToCurrentSession, false);
  appendLines(secondPath, loadLine("votc-load-path-new"));
  state = await service.redetect();
  assert.equal(state.status, "PENDING");
  appendLines(secondPath, helloLine({ load: "votc-load-path-new" }));
  assert.equal((await service.redetect()).status, "SUPPORTED");

  const currentSize = fs.statSync(secondPath).size;
  const replacement = Buffer.from(fs.readFileSync(secondPath));
  replacement[0] = replacement[0] === 0x58 ? 0x59 : 0x58;
  assert.equal(replacement.length, currentSize);
  fs.writeFileSync(secondPath, replacement);
  fs.utimesSync(secondPath, new Date(now + 2000), new Date(now + 2000));
  state = await service.redetect();
  assert.equal(state.status, "UNKNOWN", "same-size rewrites invalidate prior compatibility");

  fs.writeFileSync(secondPath, "", "utf8");
  state = await service.redetect();
  assert.equal(state.status, "UNKNOWN", "truncation resets the tracked session");
  const splitPrefix = Buffer.from(`${loadLine("votc-load-partial")}\n界 ${helloLine({ load: "votc-load-partial" })}\n`, "utf8");
  const splitAt = Buffer.byteLength(`${loadLine("votc-load-partial")}\n`, "utf8") + 1;
  fs.appendFileSync(secondPath, splitPrefix.subarray(0, splitAt));
  state = await service.redetect();
  assert.equal(state.status, "PENDING", "partial lines are buffered and never prematurely parsed");
  fs.appendFileSync(secondPath, splitPrefix.subarray(splitAt));
  state = await service.redetect();
  assert.equal(state.status, "SUPPORTED", "split UTF-8 and partial records are joined before parsing");

  appendLines(secondPath, loadLine("votc-load-after-long"), "x".repeat(600), helloLine({ load: "votc-load-after-long" }));
  state = await service.redetect();
  assert.equal(state.status, "SUPPORTED", "oversized records are discarded without losing later bounded records");
  assert.ok(state.diagnostics.includes("LOG_LINE_TOO_LONG"));

  const rotatedPath = `${secondPath}.rotated`;
  fs.renameSync(secondPath, rotatedPath);
  fs.writeFileSync(secondPath, `${loadLine("votc-load-rotated-old")}\n${helloLine({ load: "votc-load-rotated-old" })}\n`, "utf8");
  state = await service.redetect();
  assert.equal(state.status, "UNKNOWN", "file identity changes start at EOF and clear old evidence");
  assert.equal(state.sessionEvidence.helloSeen, false);
  await service.stop();
  appendLines(secondPath, loadLine("votc-load-after-stop"), helloLine({ load: "votc-load-after-stop" }));
  assert.equal((await service.redetect()).reasonCode, "SERVICE_STOPPED", "disposed services do not resume polling through redetect");
}

async function stableStatBoundaryRewriteContract(tempDirectory) {
  const logPath = path.join(tempDirectory, "stable-stat-boundary.log");
  fs.writeFileSync(logPath, "", "utf8");
  const stableTimestampFs = { ...fs };
  stableTimestampFs.promises = {
    open: (...args) => fs.promises.open(...args),
    stat: async filePath => {
      const stat = await fs.promises.stat(filePath);
      return {
        dev: stat.dev,
        ino: stat.ino,
        birthtimeMs: stat.birthtimeMs,
        size: stat.size,
        mtimeMs: 1700000000000,
        ctimeMs: 1700000000000
      };
    }
  };
  const service = createService(logPath, { fs: stableTimestampFs });
  await service.start();

  const loadToken = "votc-load-boundary-stable-stat";
  appendLines(logPath, loadLine(loadToken), "F".repeat(800), helloLine({ load: loadToken }));
  let state = await service.redetect();
  assert.equal(state.status, "SUPPORTED");

  const original = Buffer.from(fs.readFileSync(logPath));
  const loadMarker = Buffer.from(`${loadLine(loadToken)}\n`);
  const loadOffset = original.indexOf(loadMarker);
  assert.ok(loadOffset >= 0, "fixture must contain the current LOAD boundary");
  assert.ok(original.length - (loadOffset + loadMarker.length) > 512, "the LOAD boundary must sit outside the rolling tail anchor");
  const replacement = Buffer.from(original);
  const tokenByte = loadOffset + Buffer.byteLength("VOTC:LOAD_SESSION/;/votc-load-");
  replacement[tokenByte] = replacement[tokenByte] === 0x62 ? 0x63 : 0x62;
  assert.equal(replacement.length, original.length, "the boundary rewrite must preserve file size");
  fs.writeFileSync(logPath, replacement);

  state = await service.redetect();
  assert.equal(state.status, "UNKNOWN", "same-size boundary edits invalidate the session even when stat timestamps do not change");
  assert.equal(state.reasonCode, "LOG_REWRITTEN");
  assert.equal(state.sessionEvidence.helloSeen, false);
  await service.stop();
}

async function main() {
  await parserContracts();
  await withTempDirectory(async tempDirectory => {
    await sessionBindingContracts(tempDirectory);
    await compatibilityContracts(tempDirectory);
    await fileLifecycleContracts(tempDirectory);
    await stableStatBoundaryRewriteContract(tempDirectory);
  });
  console.log("V9.6 Bridge parser and read-only compatibility service contracts: PASS");
}

main().catch(error => {
  console.error(error?.stack || "V9.6 Bridge contract failed");
  process.exitCode = 1;
});

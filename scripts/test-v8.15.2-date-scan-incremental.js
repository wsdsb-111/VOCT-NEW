"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { LetterDateSessionScanner } = require("../resources/app/out/main/letters/letter-date-session-scanner");

const LOG_PATH = "C:\\synthetic-votc\\debug.log";

function createSyntheticFs(initialText = "") {
  const initialBytes = Buffer.from(initialText, "utf8");
  let bytes = Buffer.alloc(initialBytes.length + 128 * 1024);
  initialBytes.copy(bytes);
  let size = initialBytes.length;
  let identity = { birthtimeMs: 1, ino: 7, dev: 2 };
  let mtimeMs = 1000;
  let ctimeMs = 1000;
  let readBytes = 0;
  let maxReadLength = 0;
  let afterRead = null;
  return {
    statSync(filePath) {
      assert.equal(filePath, LOG_PATH);
      return { size, mtimeMs, ctimeMs, ...identity };
    },
    openSync(filePath) {
      assert.equal(filePath, LOG_PATH);
      return 1;
    },
    readSync(fd, target, offset, length, position) {
      assert.equal(fd, 1);
      maxReadLength = Math.max(maxReadLength, length);
      const count = Math.max(0, Math.min(length, size - position));
      bytes.copy(target, offset, position, position + count);
      readBytes += count;
      if (afterRead) {
        const callback = afterRead;
        afterRead = null;
        callback();
      }
      return count;
    },
    closeSync(fd) { assert.equal(fd, 1); },
    append(value) {
      const addition = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
      if (size + addition.length > bytes.length) {
        const replacement = Buffer.alloc(Math.max(size + addition.length, bytes.length * 2));
        bytes.copy(replacement, 0, 0, size);
        bytes = replacement;
      }
      addition.copy(bytes, size);
      size += addition.length;
      mtimeMs++;
      ctimeMs++;
    },
    replace(value, options = {}) {
      const replacement = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
      bytes = Buffer.alloc(replacement.length + 128 * 1024);
      replacement.copy(bytes);
      size = replacement.length;
      mtimeMs = options.mtimeMs ?? mtimeMs + 1;
      ctimeMs = options.ctimeMs ?? ctimeMs + 1;
      identity = options.identity || identity;
    },
    editSameMetadata(value) {
      const replacement = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
      assert.equal(replacement.length, size);
      replacement.copy(bytes);
    },
    onNextRead(callback) { afterRead = callback; },
    get readBytes() { return readBytes; },
    get maxReadLength() { return maxReadLength; }
  };
}

function createScanner(fs, options = {}) {
  return new LetterDateSessionScanner({ fs, ...options });
}

async function markerParsingUsesUtf8ByteOffsetsAndCompleteLines() {
  const text = "开端 🐉\nVOTC:LOAD_SESSION/;/same\nVOTC:DATE/;/395231";
  const fs = createSyntheticFs(text);
  const scanner = createScanner(fs, { chunkBytes: 7 });
  const incomplete = await scanner.scan(LOG_PATH);

  assert.equal(incomplete.found, false, "an EOF fragment without newline is not a complete marker line");
  assert.equal(incomplete.sessionId, "same");
  assert.equal(incomplete.sessionBoundaryOffset, Buffer.byteLength("开端 🐉\n", "utf8"));
  assert.equal(incomplete.scan.mode, "COLD_RECOVERY");
  assert.ok(incomplete.scan.bytesRead >= Buffer.byteLength(text, "utf8"));

  fs.append("\n");
  const completed = await scanner.scan(LOG_PATH);
  assert.equal(completed.found, true);
  assert.equal(completed.value, 395231);
  assert.equal(completed.sessionBoundaryOffset, Buffer.byteLength("开端 🐉\n", "utf8"));
  assert.equal(completed.scan.mode, "INCREMENTAL");
}

async function latestPhysicalLoadResetsSameTokenDate() {
  const fs = createSyntheticFs([
    "VOTC:LOAD_SESSION/;/same",
    "VOTC:DATE/;/100",
    ""
  ].join("\n"));
  const scanner = createScanner(fs);
  const first = await scanner.scan(LOG_PATH);
  assert.equal(first.value, 100);

  const oldBoundaryOffset = first.sessionBoundaryOffset;
  fs.append("VOTC:LOAD_SESSION/;/same\n");
  const next = await scanner.scan(LOG_PATH);
  assert.equal(next.found, false);
  assert.equal(next.reason, "date_marker_missing");
  assert.equal(next.sessionId, "same");
  assert.equal(next.previousSessionId, "same");
  assert.ok(next.sessionBoundaryOffset > oldBoundaryOffset);
}

async function legacyDateRemainsAvailableUntilLoadBoundary() {
  const fs = createSyntheticFs("VOTC:DATE/;/12\n");
  const scanner = createScanner(fs);
  const legacy = await scanner.scan(LOG_PATH);
  assert.equal(legacy.found, true);
  assert.equal(legacy.value, 12);
  assert.equal(legacy.sessionId, null);

  fs.append("VOTC:LOAD_SESSION/;/new\nVOTC:DATE/;/13\n");
  const session = await scanner.scan(LOG_PATH);
  assert.equal(session.found, true);
  assert.equal(session.value, 13);
  assert.equal(session.sessionId, "new");
}

async function incrementalReadsStayBoundedAndAnchorIsCounted() {
  const fs = createSyntheticFs("VOTC:LOAD_SESSION/;/bench\n");
  const scanner = createScanner(fs, { chunkBytes: 64 });
  const cold = await scanner.scan(LOG_PATH);
  assert.equal(cold.sessionId, "bench");
  assert.equal(cold.scan.bytesRead, Buffer.byteLength("VOTC:LOAD_SESSION/;/bench\n"));

  let readBytes = cold.scan.bytesRead;
  for (let day = 1; day <= 100; day++) {
    const line = `VOTC:DATE/;/${day}\n`;
    fs.append(line);
    const result = await scanner.scan(LOG_PATH);
    assert.equal(result.found, true);
    assert.equal(result.value, day);
    assert.equal(result.scan.mode, "INCREMENTAL");
    assert.ok(result.scan.bytesRead >= line.length, "incremental metrics include the appended line");
    assert.ok(result.scan.bytesRead <= line.length + 256, "incremental reads are bounded by append plus anchor");
    readBytes += result.scan.bytesRead;
  }
  assert.ok(readBytes < 32 * 1024, `steady reads should stay bounded, got ${readBytes}`);
  assert.ok(fs.maxReadLength <= 256, "synchronous reads stay bounded by the fixed anchor or chunk size");
}

async function metadataAnchorAndTruncationFailClosed() {
  const original = "VOTC:LOAD_SESSION/;/old\nVOTC:DATE/;/77\n";
  const fs = createSyntheticFs(original);
  const scanner = createScanner(fs);
  assert.equal((await scanner.scan(LOG_PATH)).value, 77);

  const rewritten = "VOTC:LOAD_SESSION/;/new\nVOTC:DATE/;/88\n";
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  fs.replace(rewritten);
  const metadataChanged = await scanner.scan(LOG_PATH);
  assert.equal(metadataChanged.found, false);
  assert.equal(metadataChanged.scan.mode, "INVALIDATED");
  assert.equal(metadataChanged.scan.resetReason, "same_size_metadata_changed");
  assert.equal((await scanner.scan(LOG_PATH)).value, 88, "next call performs a new cold recovery");

  fs.replace("VOTC:LOAD_SESSION/;/x\nVOTC:DATE/;/9\n");
  const truncated = await scanner.scan(LOG_PATH);
  assert.equal(truncated.found, false);
  assert.equal(truncated.scan.resetReason, "log_truncated");
  assert.equal((await scanner.scan(LOG_PATH)).value, 9);
}

async function finiteAnchorDetectsSameMetadataRewrite() {
  const fs = createSyntheticFs("VOTC:LOAD_SESSION/;/old\nVOTC:DATE/;/77\n");
  const scanner = createScanner(fs);
  await scanner.scan(LOG_PATH);
  fs.editSameMetadata("VOTC:LOAD_SESSION/;/new\nVOTC:DATE/;/88\n");
  const result = await scanner.scan(LOG_PATH);
  assert.equal(result.found, false);
  assert.equal(result.scan.resetReason, "anchor_mismatch");
}

async function rotationAndExplicitResetRequireColdRecovery() {
  const fs = createSyntheticFs("VOTC:LOAD_SESSION/;/same\nVOTC:DATE/;/77\n");
  const scanner = createScanner(fs);
  await scanner.scan(LOG_PATH);
  fs.replace("VOTC:LOAD_SESSION/;/same\nVOTC:DATE/;/88\n", {
    identity: { birthtimeMs: 2, ino: 8, dev: 2 }
  });
  const rotated = await scanner.scan(LOG_PATH);
  assert.equal(rotated.found, false);
  assert.equal(rotated.scan.mode, "INVALIDATED");
  assert.equal(rotated.scan.resetReason, "log_identity_changed");
  assert.equal((await scanner.scan(LOG_PATH)).value, 88);

  scanner.reset();
  const resetScan = await scanner.scan(LOG_PATH);
  assert.equal(resetScan.scan.mode, "COLD_RECOVERY");
  assert.equal(resetScan.value, 88);

  fs.replace("VOTC:LOAD_SESSION/;/same\nVOTC:DATE/;/89\n", {
    identity: { birthtimeMs: 2, ino: 8, dev: 3 }
  });
  const deviceChanged = await scanner.scan(LOG_PATH);
  assert.equal(deviceChanged.found, false);
  assert.equal(deviceChanged.scan.resetReason, "log_device_changed");
  assert.equal((await scanner.scan(LOG_PATH)).value, 89);
}

async function changingFileDuringScanIsRejected() {
  const text = `${"x".repeat(128)}\nVOTC:LOAD_SESSION/;/old\nVOTC:DATE/;/77\n`;
  const fs = createSyntheticFs(text);
  const scanner = createScanner(fs, { chunkBytes: 64 });
  fs.onNextRead(() => fs.append("VOTC:LOAD_SESSION/;/new\n"));
  const result = await scanner.scan(LOG_PATH);
  assert.equal(result.found, false);
  assert.equal(result.scan.mode, "INVALIDATED");
  assert.equal(result.scan.resetReason, "log_changed_during_scan");
}

async function resetDuringColdScanCannotPublishOldState() {
  const fs = createSyntheticFs(`${"x".repeat(128)}\nVOTC:LOAD_SESSION/;/old\nVOTC:DATE/;/77\n`);
  const scanner = createScanner(fs, { chunkBytes: 64 });
  let recoveryPromise;
  fs.onNextRead(() => {
    scanner.reset();
    recoveryPromise = scanner.scan(LOG_PATH);
  });
  const interrupted = await scanner.scan(LOG_PATH);
  assert.equal(interrupted.found, false);
  assert.equal(interrupted.scan.mode, "INVALIDATED");
  assert.equal(interrupted.scan.resetReason, "scanner_reset_during_scan");
  assert.equal(scanner.state, null, "reset generation prevents an older cold scan from restoring scanner state");

  const recovered = await recoveryPromise;
  assert.equal(recovered.value, 77);
  assert.equal(recovered.scan.mode, "COLD_RECOVERY");
}

async function overlongUnterminatedLineFailsClosed() {
  const fs = createSyntheticFs("x".repeat(1024 * 1024 + 1));
  const scanner = createScanner(fs);
  const result = await scanner.scan(LOG_PATH);
  assert.equal(result.found, false);
  assert.equal(result.scan.mode, "INVALIDATED");
  assert.equal(result.scan.resetReason, "line_too_long");
}

function makeBenchLog(sizeBytes) {
  const bytes = Buffer.alloc(sizeBytes, 0x78);
  Buffer.from("VOTC:LOAD_SESSION/;/bench\n", "utf8").copy(bytes, 0);
  const lineBytes = 64 * 1024;
  for (let offset = lineBytes - 1; offset < bytes.length; offset += lineBytes) bytes[offset] = 0x0a;
  bytes[bytes.length - 1] = 0x0a;
  return bytes;
}

function quantile(values, q) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

async function performanceGate() {
  const measurements = [];
  for (const mib of [1, 20, 100]) {
    const initialLog = makeBenchLog(mib * 1024 * 1024);
    const fs = createSyntheticFs(initialLog);
    const scanner = createScanner(fs);
    const coldStartedAt = performance.now();
    const concurrentScans = await Promise.all(Array.from({ length: 100 }, () => scanner.scan(LOG_PATH)));
    const coldMs = performance.now() - coldStartedAt;
    const coldResult = concurrentScans[0];
    assert.equal(coldResult.sessionId, "bench");
    assert.equal(coldResult.scan.bytesRead, initialLog.length);
    assert.equal(fs.readBytes, initialLog.length, "100 simultaneous DATE requests share one cold file pass");
    assert.ok(concurrentScans.every((result) => result === coldResult), "same-path in-flight scans share their result");

    const durations = [];
    let bytesRead = coldResult.scan.bytesRead;
    let maxBlockMs = coldResult.scan.maxBlockMs;
    for (let day = 1; day <= 100; day++) {
      const line = `VOTC:DATE/;/${day}\n`;
      fs.append(line);
      const startedAt = performance.now();
      const result = await scanner.scan(LOG_PATH);
      durations.push(performance.now() - startedAt);
      assert.equal(result.value, day);
      bytesRead += result.scan.bytesRead;
      maxBlockMs = Math.max(maxBlockMs, result.scan.maxBlockMs);
    }
    const maxIncrementalLineBytes = Buffer.byteLength("VOTC:DATE/;/" + "100" + "\n", "utf8");
    const steadyReadLimit = initialLog.length + 100 * (maxIncrementalLineBytes + 256);
    assert.ok(bytesRead <= steadyReadLimit, `${mib} MiB reads should be initial size plus appends and fixed anchors`);
    measurements.push({
      mib,
      coldMs: Number(coldMs.toFixed(2)),
      incrementalP50Ms: Number(quantile(durations, 0.5).toFixed(3)),
      incrementalP95Ms: Number(quantile(durations, 0.95).toFixed(3)),
      bytesRead,
      maxBlockMs: Number(maxBlockMs.toFixed(3))
    });
  }
  process.stdout.write(`DATE scanner performance: ${JSON.stringify(measurements)}\n`);
}

async function main() {
  await markerParsingUsesUtf8ByteOffsetsAndCompleteLines();
  await latestPhysicalLoadResetsSameTokenDate();
  await legacyDateRemainsAvailableUntilLoadBoundary();
  await incrementalReadsStayBoundedAndAnchorIsCounted();
  await metadataAnchorAndTruncationFailClosed();
  await finiteAnchorDetectsSameMetadataRewrite();
  await rotationAndExplicitResetRequireColdRecovery();
  await changingFileDuringScanIsRejected();
  await resetDuringColdScanCannotPublishOldState();
  await overlongUnterminatedLineFailsClosed();
  await performanceGate();
  process.stdout.write("V8.15.2 incremental DATE scanner: PASS\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

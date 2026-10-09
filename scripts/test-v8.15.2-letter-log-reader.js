"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const LetterLogReader = require("../resources/app/out/main/letters/letter-log-reader");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(5);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function createFixture(initial = "") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-reader-"));
  const filePath = path.join(directory, "debug.log");
  fs.writeFileSync(filePath, initial, "utf8");
  return { directory, filePath };
}

function observe(reader) {
  const lines = [];
  const iface = readline.createInterface({ input: reader, crlfDelay: Infinity });
  iface.on("line", (line) => lines.push(line));
  return { iface, lines };
}

function createReader(filePath, options = {}) {
  return new LetterLogReader(filePath, { pollIntervalMs: 5, readChunkBytes: 7, ...options });
}

async function initialEofAndChunkedUtf8() {
  const fixture = createFixture("VOTC:LETTER/;/stale-payload\n");
  const reader = createReader(fixture.filePath, { readChunkBytes: 2 });
  try {
    await reader.start();
    const { iface, lines } = observe(reader);
    const marker = "VOTC:LETTER_TRANSPORT/A/a2-中文";
    for (const byte of Buffer.from(`${marker}\n`, "utf8")) fs.appendFileSync(fixture.filePath, Buffer.from([byte]));
    await waitFor(() => lines.length === 1, "fresh UTF-8 A2 marker");
    assert.deepEqual(lines, [marker], "initial EOF must not replay old payload lines and split UTF-8 must decode intact");
    iface.close();
  } finally {
    await reader.quit();
    reader.destroy();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
}

async function rotationAndTruncationDiscardPartialLines() {
  const fixture = createFixture();
  const rotatedPath = path.join(fixture.directory, "debug.log.old");
  const reader = createReader(fixture.filePath, { readChunkBytes: 64 });
  const expected = [];
  const resets = [];
  let iface;
  try {
    await reader.start();
    ({ iface } = observe(reader));
    iface.on("line", (line) => expected.push(line));
    reader.on("log_reset", (event) => resets.push(event));

    fs.appendFileSync(fixture.filePath, "partial-before-rotate");
    await wait(30);
    fs.renameSync(fixture.filePath, rotatedPath);
    fs.writeFileSync(fixture.filePath, "existing-after-replace\n", "utf8");
    await wait(30);
    const rotatedMarker = "VOTC:LETTER_TRANSPORT/A/a2-rotated";
    fs.appendFileSync(fixture.filePath, `${rotatedMarker}\n`, "utf8");
    await waitFor(() => expected.length === 1, "post-rotation A2 marker");

    fs.appendFileSync(fixture.filePath, "partial-before-truncate");
    await wait(30);
    fs.truncateSync(fixture.filePath, 0);
    await wait(30);
    const truncatedMarker = "VOTC:LETTER_TRANSPORT/A/a2-truncated";
    fs.appendFileSync(fixture.filePath, `${truncatedMarker}\n`, "utf8");
    await waitFor(() => expected.length === 2, "post-truncation A2 marker");

    assert.deepEqual(expected, [rotatedMarker, truncatedMarker], "replacement preexisting bytes and old partial lines must not reach the consumer");
    assert.deepEqual(resets.map((event) => event.reason), ["rotated", "truncated"]);
    assert.ok(resets.every((event) => Number.isInteger(event.boundaryOffset) && event.fileIdentity));
  } finally {
    iface?.close();
    await reader.quit();
    reader.destroy();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
}

async function quitDuringBackpressureAndRestartAtEof() {
  const fixture = createFixture("preexisting\n");
  const observed = [];
  class TestReader extends LetterLogReader {
    constructor(filePath, options) {
      super(filePath, { ...options, pollIntervalMs: 2, readChunkBytes: 64 * 1024, highWaterMark: 64 * 1024 });
    }
  }
  const { LetterManager } = createLetterManager({
    settingsRepository: { getCK3UserFolderPath: () => fixture.directory, getCK3DebugLogPath: () => fixture.filePath },
    fs,
    path,
    TailFile: TestReader,
    readline,
    parseLog: async () => null,
    letterPromptBuilder: {},
    llmManager: {},
    PromptBuilder: {},
    TokenCounter: {},
    memoryEngine: {},
    dataDir: null,
    autoStartLogTailing: false,
    setIntervalFn: () => null,
    clearIntervalFn: () => null
  });
  const manager = new LetterManager();
  manager.processLogLine = (line) => {
    observed.push(line);
    return Promise.resolve();
  };
  try {
    await manager.startLogTailing();
    const oldReader = manager.tailFile;
    oldReader.pause();
    fs.appendFileSync(fixture.filePath, "VOTC:LETTER_TRANSPORT/A/a2-old\n".repeat(10000), "utf8");
    await waitFor(() => oldReader.readableLength >= oldReader.readableHighWaterMark, "LetterManager reader backpressure");
    assert.ok(fs.statSync(fixture.filePath).size > 64 * 1024, "fixture must exceed 64 KiB while the reader is backpressured");

    const stopped = await Promise.race([manager.stopLogTailing().then(() => true), wait(100).then(() => false)]);
    assert.equal(stopped, true, "quit must not wait for a blocked consumer to drain");
    assert.equal(manager.tailState, "STOPPED");

    await manager.startLogTailing();
    const freshMarker = "VOTC:LETTER_TRANSPORT/A/a2-after-restart";
    fs.appendFileSync(fixture.filePath, `${freshMarker}\n`, "utf8");
    await waitFor(() => observed.length === 1, "post-restart A2 marker");
    assert.deepEqual(observed, [freshMarker], "new reader must start at EOF without replaying buffered old A2 markers");
  } finally {
    await manager.stopLogTailing();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
}

async function main() {
  await initialEofAndChunkedUtf8();
  await rotationAndTruncationDiscardPartialLines();
  await quitDuringBackpressureAndRestartAtEof();
  console.log("V8.15.2 letter log reader tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

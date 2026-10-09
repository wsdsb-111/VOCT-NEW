"use strict";

const nodeFs = require("node:fs");
const { Readable } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");

const ANCHOR_BYTES = 64;

class LetterLogReader extends Readable {
  constructor(filePath, { fs = nodeFs, pollIntervalMs = 1000, readChunkBytes = 64 * 1024, highWaterMark = 64 * 1024 } = {}) {
    super({ highWaterMark });
    if (typeof filePath !== "string" || !filePath) throw new TypeError("letter_log_path_required");
    this.filePath = filePath;
    this.fs = fs;
    this.pollIntervalMs = pollIntervalMs;
    this.readChunkBytes = readChunkBytes;
    this.started = false;
    this.stopped = false;
    this.polling = false;
    this.readRequested = false;
    this.pollTimer = null;
    this.fileIdentity = null;
    this.offset = 0;
    this.anchor = Buffer.alloc(0);
    this.decoder = new StringDecoder("utf8");
    this.partialLine = "";
  }

  async start() {
    if (this.started) return;
    if (this.stopped) throw new Error("letter_log_reader_stopped");
    const fd = this.fs.openSync(this.filePath, "r");
    try {
      this.resetAt(fd, this.fs.fstatSync(fd));
      this.started = true;
      this.readRequested = true;
      this.schedule(0);
    } finally {
      this.fs.closeSync(fd);
    }
  }

  _read() {
    this.readRequested = true;
    this.schedule(0);
  }

  schedule(delayMs) {
    if (this.stopped || !this.started || !this.readRequested || this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.poll();
    }, delayMs);
    this.pollTimer.unref?.();
  }

  poll() {
    if (this.stopped || this.polling) return;
    this.polling = true;
    let fd = null;
    let resetEvent = null;
    let tailError = null;
    try {
      fd = this.fs.openSync(this.filePath, "r");
      const stats = this.fs.fstatSync(fd);
      const identity = this.identityOf(stats);
      const reason = identity !== this.fileIdentity ? "rotated" : stats.size < this.offset ? "truncated" : !this.anchorMatches(fd) ? "rewritten" : null;
      if (reason) {
        const previousFileIdentity = this.fileIdentity;
        this.resetAt(fd, stats);
        resetEvent = { reason, previousFileIdentity, fileIdentity: this.fileIdentity, boundaryOffset: this.offset };
      } else {
        const length = Math.min(this.readChunkBytes, stats.size - this.offset);
        if (length > 0) {
          const buffer = Buffer.alloc(length);
          const bytesRead = this.fs.readSync(fd, buffer, 0, length, this.offset);
          if (bytesRead > 0) {
            const chunk = buffer.subarray(0, bytesRead);
            this.offset += bytesRead;
            this.anchor = this.keepAnchor(Buffer.concat([this.anchor, chunk]));
            this.pushCompleteLines(this.decoder.write(chunk));
          }
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.stopped = true;
        this.clearPollTimer();
        this.partialLine = "";
        this.decoder.end();
        tailError = error;
        if (!this.destroyed) this.push(null);
      }
    } finally {
      if (fd !== null) this.fs.closeSync(fd);
      this.polling = false;
      if (resetEvent) this.emit("log_reset", resetEvent);
      if (tailError) this.emit("tail_error", tailError);
      this.schedule(this.pollIntervalMs);
    }
  }

  identityOf(stats) {
    return `${stats.dev || 0}:${stats.ino || 0}:${Number(stats.birthtimeMs) || 0}`;
  }

  resetAt(fd, stats) {
    this.fileIdentity = this.identityOf(stats);
    this.offset = Number(stats.size) || 0;
    this.anchor = this.readAt(fd, Math.max(0, this.offset - ANCHOR_BYTES), Math.min(ANCHOR_BYTES, this.offset));
    this.partialLine = "";
    this.decoder = new StringDecoder("utf8");
  }

  readAt(fd, position, length) {
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const count = this.fs.readSync(fd, buffer, bytesRead, length - bytesRead, position + bytesRead);
      if (count <= 0) break;
      bytesRead += count;
    }
    return buffer.subarray(0, bytesRead);
  }

  anchorMatches(fd) {
    if (this.anchor.length === 0) return true;
    const current = this.readAt(fd, this.offset - this.anchor.length, this.anchor.length);
    return current.equals(this.anchor);
  }

  keepAnchor(buffer) {
    return Buffer.from(buffer.subarray(Math.max(0, buffer.length - ANCHOR_BYTES)));
  }

  pushCompleteLines(text) {
    this.partialLine += text;
    const lastNewline = this.partialLine.lastIndexOf("\n");
    if (lastNewline < 0) return;
    const completeLines = this.partialLine.slice(0, lastNewline + 1);
    this.partialLine = this.partialLine.slice(lastNewline + 1);
    if (!this.push(completeLines)) this.readRequested = false;
  }

  clearPollTimer() {
    if (!this.pollTimer) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  async quit() {
    if (this.stopped) return;
    this.stopped = true;
    this.clearPollTimer();
    this.partialLine = "";
    this.decoder.end();
    if (!this.destroyed) this.push(null);
  }

  _destroy(error, callback) {
    this.stopped = true;
    this.clearPollTimer();
    this.partialLine = "";
    this.decoder.end();
    callback(error);
  }
}

module.exports = LetterLogReader;

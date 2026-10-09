"use strict";

const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");

const DEFAULT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_ANCHOR_BYTES = 256;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function metadataFrom(stat) {
  const birthtimeMs = Number(stat.birthtimeMs) || 0;
  const ino = Number(stat.ino) || 0;
  return {
    identity: `${birthtimeMs}:${ino}`,
    size: Number(stat.size) || 0,
    mtimeMs: Number(stat.mtimeMs) || 0,
    ctimeMs: Number(stat.ctimeMs) || 0,
    dev: Number(stat.dev) || 0
  };
}

function sameSnapshot(left, right) {
  return left.identity === right.identity &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev;
}

function hashIdentity(identity) {
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

function emptyDateState() {
  return {
    sessionId: null,
    boundaryOffset: null,
    previousSessionId: null,
    sessionDate: null,
    legacyDate: null,
    carry: Buffer.alloc(0),
    carryOffset: 0
  };
}

function copyDateState(state) {
  return {
    sessionId: state.sessionId,
    boundaryOffset: state.boundaryOffset,
    previousSessionId: state.previousSessionId,
    sessionDate: state.sessionDate,
    legacyDate: state.legacyDate,
    carry: Buffer.from(state.carry),
    carryOffset: state.carryOffset
  };
}

class LetterDateSessionScanner {
  constructor({ fs, chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
    if (!fs) throw new TypeError("LetterDateSessionScanner requires an fs implementation");
    this.fs = fs;
    this.chunkBytes = Math.max(1, Number(chunkBytes) || DEFAULT_CHUNK_BYTES);
    this.anchorBytes = DEFAULT_ANCHOR_BYTES;
    this.maxLineBytes = DEFAULT_MAX_LINE_BYTES;
    this.state = null;
    this.generation = 0;
    this.transition = Promise.resolve();
    this.inflightByPath = new Map();
  }

  reset() {
    this.state = null;
    this.generation++;
  }

  scan(filePath) {
    const generation = this.generation;
    const inflight = this.inflightByPath.get(filePath);
    if (inflight?.generation === generation) return inflight.promise;

    const promise = this.transition.then(() => this.scanNow(filePath, generation));
    this.transition = promise.then(() => null, () => null);
    this.inflightByPath.set(filePath, { generation, promise });
    promise.finally(() => {
      if (this.inflightByPath.get(filePath)?.promise === promise) this.inflightByPath.delete(filePath);
    }).catch(() => {});
    return promise;
  }

  async scanNow(filePath, generation) {
    const startedAt = performance.now();
    if (generation !== this.generation) {
      return this.makeResult(null, null, "scan_invalidated", "INVALIDATED", 0, startedAt, "scanner_reset_before_scan");
    }
    let statBefore;
    let metadata;
    try {
      statBefore = this.fs.statSync(filePath);
      metadata = metadataFrom(statBefore);
    } catch (_error) {
      this.reset();
      return this.makeResult(null, null, "log_file_missing", "INVALIDATED", 0, startedAt, "stat_failed");
    }

    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) {
      this.reset();
      return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", 0, startedAt, "invalid_log_size");
    }

    if (this.state) {
      const state = this.state;
      if (state.filePath !== filePath || state.metadata.identity !== metadata.identity) {
        this.reset();
        return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", 0, startedAt, "log_identity_changed");
      }
      if (state.metadata.dev !== metadata.dev) {
        this.reset();
        return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", 0, startedAt, "log_device_changed");
      }
      if (metadata.size < state.metadata.size) {
        this.reset();
        return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", 0, startedAt, "log_truncated");
      }
      if (metadata.size === state.metadata.size && !sameSnapshot(state.metadata, metadata)) {
        this.reset();
        return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", 0, startedAt, "same_size_metadata_changed");
      }
      return this.scanIncremental(filePath, metadata, startedAt, generation);
    }

    return this.scanCold(filePath, metadata, startedAt, generation);
  }

  async scanCold(filePath, metadata, startedAt, generation) {
    const dateState = emptyDateState();
    const context = this.createReadContext();
    const fd = this.open(filePath, context, metadata, startedAt);
    if (fd === null) return context.failureResult;

    let position = 0;
    let failureReason = null;
    try {
      while (position < metadata.size) {
        if (generation !== this.generation) {
          failureReason = "scanner_reset_during_scan";
          break;
        }
        const count = Math.min(this.chunkBytes, metadata.size - position);
        const blockStartedAt = performance.now();
        const buffer = this.readChunk(fd, position, count, context);
        if (!buffer) {
          failureReason = "read_failed";
          break;
        }
        this.rememberTail(context, buffer);
        if (!this.consumeBytes(dateState, buffer, position)) {
          failureReason = "line_too_long";
          break;
        }
        position += buffer.length;
        context.maxBlockMs = Math.max(context.maxBlockMs, performance.now() - blockStartedAt);
        if (position < metadata.size) await yieldToEventLoop();
      }
    } finally {
      try { this.fs.closeSync(fd); } catch (_error) {}
    }

    if (failureReason) return this.invalidateAfterScan(metadata, context, startedAt, failureReason, generation);
    return this.commit(filePath, metadata, dateState, context, startedAt, "COLD_RECOVERY", generation);
  }

  async scanIncremental(filePath, metadata, startedAt, generation) {
    const priorState = this.state;
    const context = this.createReadContext();
    context.tail = Buffer.from(priorState.anchor);
    const fd = this.open(filePath, context, metadata, startedAt);
    if (fd === null) return context.failureResult;

    let failureReason = null;
    const dateState = copyDateState(priorState.dateState);
    try {
      if (priorState.anchor.length > 0) {
        const blockStartedAt = performance.now();
        const anchor = this.readChunk(fd, priorState.anchorOffset, priorState.anchor.length, context);
        context.maxBlockMs = Math.max(context.maxBlockMs, performance.now() - blockStartedAt);
        if (!anchor || !anchor.equals(priorState.anchor)) failureReason = "anchor_mismatch";
      }

      let position = priorState.metadata.size;
      while (!failureReason && position < metadata.size) {
        if (generation !== this.generation) {
          failureReason = "scanner_reset_during_scan";
          break;
        }
        const count = Math.min(this.chunkBytes, metadata.size - position);
        const blockStartedAt = performance.now();
        const buffer = this.readChunk(fd, position, count, context);
        if (!buffer) {
          failureReason = "read_failed";
          break;
        }
        this.rememberTail(context, buffer);
        if (!this.consumeBytes(dateState, buffer, position)) {
          failureReason = "line_too_long";
          break;
        }
        position += buffer.length;
        context.maxBlockMs = Math.max(context.maxBlockMs, performance.now() - blockStartedAt);
        if (position < metadata.size) await yieldToEventLoop();
      }
    } finally {
      try { this.fs.closeSync(fd); } catch (_error) {}
    }

    if (failureReason) return this.invalidateAfterScan(metadata, context, startedAt, failureReason, generation);
    return this.commit(filePath, metadata, dateState, context, startedAt, "INCREMENTAL", generation);
  }

  createReadContext() {
    return {
      bytesRead: 0,
      maxBlockMs: 0,
      tail: Buffer.alloc(0),
      failureResult: null
    };
  }

  open(filePath, context, metadata, startedAt) {
    try {
      return this.fs.openSync(filePath, "r");
    } catch (_error) {
      context.failureResult = this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", context.bytesRead, startedAt, "open_failed", context.maxBlockMs);
      return null;
    }
  }

  readChunk(fd, position, length, context) {
    const buffer = Buffer.allocUnsafe(length);
    let total = 0;
    while (total < length) {
      let count;
      try {
        count = this.fs.readSync(fd, buffer, total, length - total, position + total);
      } catch (_error) {
        return null;
      }
      if (count <= 0) return null;
      total += count;
      context.bytesRead += count;
    }
    return buffer;
  }

  rememberTail(context, buffer) {
    const combined = context.tail.length ? Buffer.concat([context.tail, buffer]) : buffer;
    context.tail = Buffer.from(combined.subarray(Math.max(0, combined.length - this.anchorBytes)));
  }

  consumeBytes(state, bytes, absoluteOffset) {
    const combined = state.carry.length ? Buffer.concat([state.carry, bytes]) : bytes;
    const baseOffset = state.carry.length ? state.carryOffset : absoluteOffset;
    let cursor = 0;
    while (true) {
      const newline = combined.indexOf(0x0a, cursor);
      if (newline < 0) break;
      const line = combined.subarray(cursor, newline);
      if (line.length > this.maxLineBytes) return false;
      this.processLine(state, line, baseOffset + cursor);
      cursor = newline + 1;
    }
    state.carry = Buffer.from(combined.subarray(cursor));
    state.carryOffset = baseOffset + cursor;
    return state.carry.length <= this.maxLineBytes;
  }

  processLine(state, lineBuffer, lineOffset) {
    if (!lineBuffer.length) return;
    const line = lineBuffer.toString("utf8");
    const matcher = /VOTC:(?:LOAD_SESSION\/;\/([A-Za-z0-9_.-]+)|DATE\/;\/(\d+))/g;
    let match;
    while ((match = matcher.exec(line)) !== null) {
      if (match[1]) {
        state.previousSessionId = state.sessionId;
        state.sessionId = match[1];
        state.boundaryOffset = lineOffset + Buffer.byteLength(line.slice(0, match.index), "utf8");
        state.sessionDate = null;
      } else if (state.sessionId) {
        state.sessionDate = Number(match[2]);
      } else {
        state.legacyDate = Number(match[2]);
      }
    }
  }

  async commit(filePath, metadata, dateState, context, startedAt, mode, generation) {
    if (generation !== this.generation) {
      return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", context.bytesRead, startedAt, "scanner_reset_during_scan", context.maxBlockMs);
    }
    let currentMetadata;
    try {
      currentMetadata = metadataFrom(this.fs.statSync(filePath));
    } catch (_error) {
      this.reset();
      return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", context.bytesRead, startedAt, "stat_failed_after_scan", context.maxBlockMs);
    }
    if (!sameSnapshot(metadata, currentMetadata)) {
      this.reset();
      return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", context.bytesRead, startedAt, "log_changed_during_scan", context.maxBlockMs);
    }

    const anchor = Buffer.from(context.tail);
    const state = {
      filePath,
      metadata,
      dateState,
      anchor,
      anchorOffset: metadata.size - anchor.length
    };
    this.state = state;
    if (/VOTC:LOAD/.test(dateState.carry.toString("utf8"))) {
      return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", context.bytesRead, startedAt, "partial_load_marker", context.maxBlockMs);
    }
    return this.makeResult(metadata, dateState, null, mode, context.bytesRead, startedAt, null, context.maxBlockMs);
  }

  invalidateAfterScan(metadata, context, startedAt, reason, generation) {
    if (generation === this.generation) this.reset();
    else this.state = null;
    return this.makeResult(metadata, null, "scan_invalidated", "INVALIDATED", context.bytesRead, startedAt, reason, context.maxBlockMs);
  }

  makeResult(metadata, dateState, reasonOverride, mode, bytesRead, startedAt, resetReason, maxBlockMs = 0) {
    const sessionId = dateState?.sessionId || null;
    const legacyDate = dateState?.legacyDate ?? null;
    const value = sessionId ? dateState?.sessionDate ?? null : legacyDate;
    const found = value !== null && value !== undefined;
    const reason = reasonOverride || (metadata?.size === 0 ? "empty_log" : found ? "tail_scan" : "date_marker_missing");
    const logIdentity = metadata?.identity || null;
    return {
      found,
      value: found ? value : null,
      reason,
      sessionId,
      sessionBoundaryOffset: dateState?.boundaryOffset ?? null,
      previousSessionId: dateState?.previousSessionId || null,
      logIdentity,
      logSize: metadata?.size ?? null,
      logMtimeMs: metadata?.mtimeMs ?? null,
      scan: {
        mode,
        bytesRead,
        durationMs: Math.max(0, performance.now() - startedAt),
        maxBlockMs,
        backscanBytes: 0,
        logIdentityHash: logIdentity ? hashIdentity(logIdentity) : null,
        boundaryOffsetKnown: Number.isFinite(dateState?.boundaryOffset),
        resetReason: resetReason || null
      }
    };
  }
}

module.exports = { LetterDateSessionScanner };

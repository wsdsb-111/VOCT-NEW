"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseBridgeHello, HELLO_MARKER } = require("./bridge-hello-parser");

const CHANNEL_NAMES = ["debugLog", "clipboard", "runFileAck", "actionReadback", "letterReceipt"];
const LOAD_MARKER = "VOTC:LOAD_SESSION/;/";
const MAX_LINE_BYTES = 4096;
const DEFAULT_READ_BYTES_PER_POLL = 64 * 1024;
const DEFAULT_FINGERPRINT_BYTES = 512;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_HELLO_WAIT_MS = 15000;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function normalizeManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== 1) return null;
  if (typeof input.runtimeVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(input.runtimeVersion)) return null;
  const protocol = input.bridgeProtocol;
  if (!protocol || !safeInteger(protocol.major, 0) || !safeInteger(protocol.minMinor, 0)
    || !safeInteger(protocol.maxMinor, protocol.minMinor) || protocol.maxMinor < protocol.minMinor) return null;
  if (!input.capabilities || typeof input.capabilities !== "object" || Array.isArray(input.capabilities)) return null;
  if (!input.features || typeof input.features !== "object" || Array.isArray(input.features)) return null;

  const capabilities = {};
  for (const [id, range] of Object.entries(input.capabilities)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(id) || !range || typeof range !== "object"
      || !safeInteger(range.minRevision, 1) || !safeInteger(range.maxRevision, range.minRevision)
      || range.maxRevision < range.minRevision) return null;
    capabilities[id] = { minRevision: range.minRevision, maxRevision: range.maxRevision };
  }

  const features = {};
  for (const [name, feature] of Object.entries(input.features)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || !feature || typeof feature !== "object"
      || !Array.isArray(feature.required) || feature.required.some(id => typeof id !== "string" || !Object.hasOwn(capabilities, id))) return null;
    features[name] = { required: [...new Set(feature.required)] };
  }

  return {
    schemaVersion: 1,
    runtimeVersion: input.runtimeVersion,
    bridgeProtocol: { major: protocol.major, minMinor: protocol.minMinor, maxMinor: protocol.maxMinor },
    capabilities,
    features
  };
}

function readDefaultManifest(fileSystem) {
  try {
    return JSON.parse(fileSystem.readFileSync(path.join(__dirname, "runtime-manifest.json"), "utf8"));
  } catch (_error) {
    return null;
  }
}

function makeChannels() {
  return Object.fromEntries(CHANNEL_NAMES.map(channel => [channel, "UNKNOWN"]));
}

class BridgeCompatibilityService {
  constructor(options = {}) {
    if (typeof options.getLogPath !== "function") throw new TypeError("bridge_get_log_path_required");
    this.getLogPath = options.getLogPath;
    this.fs = options.fs || fs;
    this.fsp = this.fs.promises;
    this.clock = typeof options.clock === "function" ? options.clock : () => Date.now();
    this.pollIntervalMs = safeInteger(options.pollIntervalMs, 25) ? options.pollIntervalMs : DEFAULT_POLL_INTERVAL_MS;
    this.helloWaitMs = safeInteger(options.helloWaitMs, 0) ? options.helloWaitMs : DEFAULT_HELLO_WAIT_MS;
    this.maxReadBytesPerPoll = safeInteger(options.maxReadBytesPerPoll, 256) ? Math.min(options.maxReadBytesPerPoll, 1024 * 1024) : DEFAULT_READ_BYTES_PER_POLL;
    this.fingerprintBytes = safeInteger(options.fingerprintBytes, 64) ? Math.min(options.fingerprintBytes, 4096) : DEFAULT_FINGERPRINT_BYTES;
    this.maxLineBytes = safeInteger(options.maxLineBytes, 256) ? Math.min(options.maxLineBytes, MAX_LINE_BYTES) : MAX_LINE_BYTES;
    this.manifest = normalizeManifest(options.manifest === undefined ? readDefaultManifest(this.fs) : options.manifest);
    this._running = false;
    this._pollPromise = null;
    this._lifecycle = 0;
    this._timer = null;
    this._startedAt = null;
    this._file = null;
    this._lineCarry = Buffer.alloc(0);
    this._lineCarryOffset = 0;
    this._discardingOversizedLine = false;
    this._generationCounter = 0;
    this._currentLoadSessionId = null;
    this._loadBoundaryAttempted = false;
    this._loadSessionSeen = false;
    this._helloSeen = false;
    this._helloBoundToCurrentSession = false;
    this._helloHandled = false;
    this._channelEvidence = makeChannels();
    this._boundaries = { load: null, hello: null };
    this._diagnostics = [];
    this._listeners = new Set();
    this._state = this._emptyState(this.manifest ? "HELLO_NOT_RECEIVED" : "RUNTIME_MANIFEST_UNAVAILABLE");
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("bridge_listener_required");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  async start() {
    if (this._running) return this.getState();
    this._lifecycle += 1;
    this._running = true;
    this._startedAt = this._now();
    this._timer = setInterval(() => {
      this._poll().catch(() => {});
    }, this.pollIntervalMs);
    this._timer.unref?.();
    await this._poll();
    return this.getState();
  }

  async stop() {
    this._lifecycle += 1;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._running = false;
    this._file = null;
    this._lineCarry = Buffer.alloc(0);
    this._lineCarryOffset = 0;
    this._discardingOversizedLine = false;
    this._resetSessionEvidence();
    this._setEmptyState("SERVICE_STOPPED", "UNKNOWN");
    return this.getState();
  }

  async redetect() {
    if (this._running) await this._poll();
    return this.getState();
  }

  getState() {
    return {
      status: this._state.status,
      reasonCode: this._state.reasonCode,
      runtimeVersion: this._state.runtimeVersion,
      modBaseVersion: this._state.modBaseVersion,
      upstreamBaseVersion: this._state.upstreamBaseVersion,
      voctBridgeRevision: this._state.voctBridgeRevision,
      bridgeProtocol: this._state.bridgeProtocol ? { ...this._state.bridgeProtocol } : null,
      capabilities: Object.fromEntries(Object.entries(this._state.capabilities).map(([id, value]) => [id, { ...value }])),
      features: Object.fromEntries(Object.entries(this._state.features).map(([name, value]) => [name, { ...value, missing: [...value.missing] }])),
      sessionEvidence: { ...this._state.sessionEvidence },
      channels: { ...this._state.channels },
      diagnostics: [...this._state.diagnostics],
      updatedAt: this._state.updatedAt
    };
  }

  assertFeature(name) {
    const feature = this._state.features[name];
    if (!feature) throw new TypeError("bridge_feature_unknown");
    if (this._state.status === "UNKNOWN" || this._state.status === "PENDING") return true;
    if (feature.allowed) return true;
    const error = new Error("bridge_feature_unavailable");
    error.code = "bridge_feature_unavailable";
    error.reasonCode = feature.reasonCode || this._state.reasonCode;
    throw error;
  }

  observeEvidence(channel, evidence = {}) {
    if (!CHANNEL_NAMES.includes(channel) || !this._file?.identityKnown || !this._loadSessionSeen || !this._currentLoadSessionId
      || evidence.verified !== true || evidence.generation !== this._generationCounter) return null;
    this._channelEvidence[channel] = evidence.available === false ? "UNAVAILABLE" : "OBSERVED";
    this._state.channels = { ...this._channelEvidence };
    this._touch();
    return this._generationCounter;
  }

  async _poll() {
    if (!this._running) return;
    if (this._pollPromise) return this._pollPromise;
    const lifecycle = this._lifecycle;
    this._pollPromise = (async () => {
      try {
        await this._pollOnce(lifecycle);
        if (lifecycle === this._lifecycle && this._running) {
          this._refreshTimeoutState();
          this._emit();
        }
      } catch (_error) {
        if (lifecycle === this._lifecycle && this._running) this._ioFailure();
      }
    })();
    try {
      await this._pollPromise;
    } finally {
      this._pollPromise = null;
    }
  }

  async _pollOnce(lifecycle) {
    let rawPath;
    try {
      rawPath = await this.getLogPath();
    } catch (_error) {
      if (lifecycle !== this._lifecycle || !this._running) return;
      this._ioFailure("LOG_PATH_UNAVAILABLE");
      return;
    }
    if (lifecycle !== this._lifecycle || !this._running) return;
    if (typeof rawPath !== "string" || !rawPath.trim()) {
      if (this._file || this._state.reasonCode !== "LOG_PATH_UNAVAILABLE") this._clearFile("LOG_PATH_UNAVAILABLE");
      return;
    }

    const filePath = path.resolve(rawPath);
    let stat;
    try {
      stat = await this.fsp.stat(filePath);
    } catch (_error) {
      if (lifecycle !== this._lifecycle || !this._running) return;
      if (this._file || this._state.reasonCode !== "LOG_MISSING") this._clearFile("LOG_MISSING");
      return;
    }
    if (lifecycle !== this._lifecycle || !this._running) return;

    const current = this._statSnapshot(stat);
    if (!this._file) {
      await this._attachAtEnd(filePath, current, "LOG_ATTACHED", lifecycle);
      return;
    }
    if (this._file.path !== filePath) {
      await this._attachAtEnd(filePath, current, "LOG_PATH_CHANGED", lifecycle);
      return;
    }
    if (current.identity !== this._file.identity) {
      await this._attachAtEnd(filePath, current, "LOG_IDENTITY_CHANGED", lifecycle);
      return;
    }
    if (current.size < this._file.offset || current.size < this._file.lastSize) {
      await this._attachAtEnd(filePath, current, "LOG_TRUNCATED", lifecycle);
      return;
    }
    if (current.size === this._file.lastSize
      && (current.mtimeMs !== this._file.mtimeMs || current.ctimeMs !== this._file.ctimeMs)) {
      await this._attachAtEnd(filePath, current, "LOG_REWRITTEN", lifecycle);
      return;
    }
    const anchorsMatch = await this._verifyAnchors(filePath);
    if (lifecycle !== this._lifecycle || !this._running) return;
    if (!anchorsMatch) {
      await this._attachAtEnd(filePath, current, "LOG_REWRITTEN", lifecycle);
      return;
    }

    const available = current.size - this._file.offset;
    if (available > 0) {
      const bytes = await this._readAt(filePath, this._file.offset, Math.min(available, this.maxReadBytesPerPoll));
      const postStatRaw = await this.fsp.stat(filePath);
      if (lifecycle !== this._lifecycle || !this._running) return;
      const postStat = this._statSnapshot(postStatRaw);
      if (postStat.identity !== this._file.identity || postStat.size < this._file.offset + bytes.length) {
        await this._attachAtEnd(filePath, postStat, "LOG_CHANGED_DURING_READ", lifecycle);
        return;
      }
      const startOffset = this._file.offset;
      this._file.offset += bytes.length;
      this._consumeBytes(bytes, startOffset);
      this._file.lastSize = postStat.size;
      this._file.mtimeMs = postStat.mtimeMs;
      this._file.ctimeMs = postStat.ctimeMs;
      this._file.anchor = await this._captureAnchor(filePath, this._file.offset);
      if (lifecycle !== this._lifecycle || !this._running) return;
    } else {
      this._file.lastSize = current.size;
      this._file.mtimeMs = current.mtimeMs;
      this._file.ctimeMs = current.ctimeMs;
    }
  }

  _statSnapshot(stat) {
    const dev = Number(stat.dev);
    const ino = Number(stat.ino);
    const birthtimeMs = Number(stat.birthtimeMs);
    const identityKnown = Number.isFinite(dev) && Number.isFinite(ino) && (dev !== 0 || ino !== 0 || birthtimeMs > 0);
    return {
      size: Number(stat.size),
      mtimeMs: Number(stat.mtimeMs),
      ctimeMs: Number(stat.ctimeMs),
      identity: identityKnown ? `${dev}:${ino}:${Number.isFinite(birthtimeMs) ? birthtimeMs : 0}` : null,
      identityKnown
    };
  }

  async _attachAtEnd(filePath, stat, reasonCode, lifecycle) {
    const size = safeInteger(stat.size, 0) ? stat.size : 0;
    const anchor = await this._captureAnchor(filePath, size);
    if (lifecycle !== this._lifecycle || !this._running) return;
    this._file = {
      path: filePath,
      identity: stat.identity,
      identityKnown: stat.identityKnown,
      offset: size,
      lastSize: size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      anchor
    };
    this._lineCarry = Buffer.alloc(0);
    this._lineCarryOffset = size;
    this._discardingOversizedLine = false;
    this._generationCounter += 1;
    this._resetSessionEvidence();
    this._loadBoundaryAttempted = false;
    this._setEmptyState(this.manifest ? (stat.identityKnown ? reasonCode : "LOG_IDENTITY_UNKNOWN") : "RUNTIME_MANIFEST_UNAVAILABLE", "UNKNOWN");
    this._state.sessionEvidence.logIdentityKnown = stat.identityKnown;
    this._state.sessionEvidence.generation = this._generationCounter;
    this._touch();
  }

  async _captureAnchor(filePath, endOffset) {
    const length = Math.min(this.fingerprintBytes, endOffset);
    if (length <= 0) return { offset: endOffset, bytes: Buffer.alloc(0), fingerprint: sha256(Buffer.alloc(0)) };
    const offset = endOffset - length;
    const bytes = await this._readAt(filePath, offset, length);
    return { offset, bytes: Buffer.from(bytes), fingerprint: sha256(bytes) };
  }

  async _readAt(filePath, offset, length) {
    if (length <= 0) return Buffer.alloc(0);
    const handle = await this.fsp.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, offset);
      return Buffer.from(buffer.subarray(0, result.bytesRead));
    } finally {
      await handle.close();
    }
  }

  async _verifyAnchors(filePath) {
    const anchor = this._file.anchor;
    if (anchor.bytes.length) {
      const current = await this._readAt(filePath, anchor.offset, anchor.bytes.length);
      if (current.length !== anchor.bytes.length || sha256(current) !== anchor.fingerprint || !current.equals(anchor.bytes)) return false;
    }
    for (const boundary of Object.values(this._boundaries)) {
      if (!boundary) continue;
      const current = await this._readAt(filePath, boundary.offset, boundary.bytes.length);
      if (current.length !== boundary.bytes.length || sha256(current) !== boundary.fingerprint || !current.equals(boundary.bytes)) return false;
    }
    return true;
  }

  _consumeBytes(bytes, absoluteOffset) {
    const combined = this._lineCarry.length ? Buffer.concat([this._lineCarry, bytes]) : bytes;
    const baseOffset = this._lineCarry.length ? this._lineCarryOffset : absoluteOffset;
    let cursor = 0;
    while (cursor < combined.length) {
      const newline = combined.indexOf(0x0a, cursor);
      if (newline < 0) break;
      const lineBuffer = combined.subarray(cursor, newline);
      if (this._discardingOversizedLine) {
        this._discardingOversizedLine = false;
      } else if (lineBuffer.length > this.maxLineBytes) {
        this._diagnose("LOG_LINE_TOO_LONG");
      } else {
        this._processLine(lineBuffer, baseOffset + cursor);
      }
      cursor = newline + 1;
    }

    const remaining = combined.subarray(cursor);
    if (this._discardingOversizedLine) {
      this._lineCarry = Buffer.alloc(0);
      this._lineCarryOffset = baseOffset + combined.length;
      return;
    }
    if (remaining.length > this.maxLineBytes) {
      this._diagnose("LOG_LINE_TOO_LONG");
      this._discardingOversizedLine = true;
      this._lineCarry = Buffer.alloc(0);
      this._lineCarryOffset = baseOffset + combined.length;
      return;
    }
    this._lineCarry = Buffer.from(remaining);
    this._lineCarryOffset = baseOffset + cursor;
  }

  _processLine(rawLine, lineOffset) {
    if (!rawLine.length) return;
    const line = rawLine.toString("utf8").replace(/\r$/, "");
    const events = [];
    let cursor = 0;
    while (true) {
      const index = line.indexOf(LOAD_MARKER, cursor);
      if (index < 0) break;
      events.push({ type: "load", index });
      cursor = index + LOAD_MARKER.length;
    }
    cursor = 0;
    while (true) {
      const index = line.indexOf(HELLO_MARKER, cursor);
      if (index < 0) break;
      const after = line[index + HELLO_MARKER.length];
      if (!after || after === "/") events.push({ type: "hello", index });
      cursor = index + HELLO_MARKER.length;
    }
    events.sort((left, right) => left.index - right.index);

    for (const event of events) {
      if (event.type === "load") {
        const rest = line.slice(event.index + LOAD_MARKER.length);
        const match = /^([A-Za-z0-9_.-]{1,160})/.exec(rest);
        const token = match?.[1] || null;
        const next = token ? rest[token.length] : null;
        const tokenIsComplete = Boolean(token) && (!next || !/[A-Za-z0-9_.-]/.test(next));
        const safeToken = tokenIsComplete && /^votc-load-[A-Za-z0-9_.-]{1,120}$/.test(token) ? token : null;
        this._beginLoadSession(safeToken, rawLine, lineOffset);
        continue;
      }
      if (!this._currentLoadSessionId) continue;
      this._helloSeen = true;
      const parsed = parseBridgeHello(line.slice(event.index));
      if (!parsed) continue;
      const boundary = this._makeBoundary(rawLine, lineOffset);
      if (!parsed.ok) {
        if (!this._helloHandled) {
          this._helloHandled = true;
          this._boundaries.hello = boundary;
          this._applyFatal(parsed.reasonCode);
        }
        continue;
      }
      if (parsed.hello.loadEpoch !== this._currentLoadSessionId) {
        this._diagnose("HELLO_LOAD_SESSION_MISMATCH");
        if (!this._helloHandled) this._setStatus("PENDING", "HELLO_LOAD_SESSION_MISMATCH");
        continue;
      }
      if (this._helloHandled) continue;
      this._helloHandled = true;
      this._boundaries.hello = boundary;
      if (!this._file?.identityKnown) {
        this._setStatus("PENDING", "LOG_IDENTITY_UNKNOWN");
        continue;
      }
      this._helloBoundToCurrentSession = true;
      this._applyHello(parsed.hello);
    }
  }

  _makeBoundary(rawLine, lineOffset) {
    const bytes = Buffer.from(rawLine);
    return { offset: lineOffset, bytes, fingerprint: sha256(bytes) };
  }

  _beginLoadSession(token, rawLine, lineOffset) {
    this._generationCounter += 1;
    this._resetSessionEvidence();
    this._loadBoundaryAttempted = true;
    this._currentLoadSessionId = token;
    this._loadSessionSeen = Boolean(token);
    this._boundaries = { load: token ? this._makeBoundary(rawLine, lineOffset) : null, hello: null };
    this._state = this._emptyState(token ? "HELLO_WAITING" : "LOAD_SESSION_INVALID", token ? "PENDING" : "UNKNOWN");
    this._state.sessionEvidence = {
      loadSessionSeen: Boolean(token),
      helloSeen: false,
      helloBoundToCurrentSession: false,
      logIdentityKnown: this._file?.identityKnown === true,
      generation: this._generationCounter
    };
    // A freshly read LOAD row proves log observation, independently of Hello capabilities.
    if (token && this._file?.identityKnown) this.observeEvidence("debugLog", { verified: true, generation: this._generationCounter });
    this._touch();
  }

  _applyHello(hello) {
    if (!this.manifest) {
      this._applyFatal("RUNTIME_MANIFEST_UNAVAILABLE", hello);
      return;
    }
    if (hello.schemaVersion !== this.manifest.schemaVersion) {
      this._applyFatal("UNSUPPORTED_PROTOCOL_OR_SCHEMA", hello);
      return;
    }
    if (hello.bridgeProtocol.major !== this.manifest.bridgeProtocol.major) {
      this._applyFatal("UNSUPPORTED_PROTOCOL_OR_SCHEMA", hello);
      return;
    }
    if (hello.bridgeProtocol.minor < this.manifest.bridgeProtocol.minMinor
      || hello.bridgeProtocol.minor > this.manifest.bridgeProtocol.maxMinor) {
      this._applyFatal("UNSUPPORTED_PROTOCOL_OR_SCHEMA", hello);
      return;
    }

    const capabilities = {};
    const diagnostics = [];
    let unknownRequired = false;
    for (const [id, declaration] of Object.entries(hello.capabilities)) {
      if (Object.hasOwn(this.manifest.capabilities, id)) continue;
      if (declaration.required) unknownRequired = true;
      else diagnostics.push("UNKNOWN_OPTIONAL_CAPABILITY_IGNORED");
    }
    if (unknownRequired) {
      this._applyFatal("UNKNOWN_REQUIRED_CAPABILITY", hello);
      return;
    }

    for (const [id, range] of Object.entries(this.manifest.capabilities)) {
      const declaration = hello.capabilities[id];
      if (declaration === undefined) {
        capabilities[id] = { revision: null, supported: false, reasonCode: "CAPABILITY_NOT_DECLARED" };
      } else if (declaration.revision < range.minRevision || declaration.revision > range.maxRevision) {
        if (declaration.required) {
          this._applyFatal("REQUIRED_CAPABILITY_REVISION_UNSUPPORTED", hello);
          return;
        }
        capabilities[id] = { revision: declaration.revision, supported: false, reasonCode: "CAPABILITY_REVISION_UNSUPPORTED" };
      } else {
        capabilities[id] = { revision: declaration.revision, supported: true, reasonCode: "CAPABILITY_SUPPORTED" };
      }
    }

    const missingCore = ["character_export", "load_session"].filter(id => !capabilities[id]?.supported);
    const features = {};
    for (const [name, feature] of Object.entries(this.manifest.features)) {
      const missing = feature.required.filter(id => !capabilities[id]?.supported);
      const allowed = missing.length === 0;
      features[name] = {
        allowed,
        reasonCode: allowed ? "FEATURE_CAPABILITIES_SUPPORTED" : missing.some(id => ["character_export", "load_session"].includes(id)) ? "REQUIRED_CAPABILITY_MISSING" : "OPTIONAL_CAPABILITY_MISSING",
        missing
      };
    }

    const hasFeatureGap = Object.values(features).some(feature => !feature.allowed)
      || Object.values(capabilities).some(capability => !capability.supported);
    const reasonCode = missingCore.length ? "REQUIRED_CAPABILITY_MISSING" : hasFeatureGap ? "OPTIONAL_CAPABILITY_MISSING" : "BRIDGE_COMPATIBLE";
    this._state = this._emptyState(reasonCode, missingCore.length ? "INCOMPATIBLE" : hasFeatureGap ? "DEGRADED" : "SUPPORTED");
    this._state.modBaseVersion = hello.modBaseVersion;
    this._state.upstreamBaseVersion = hello.upstreamBaseVersion;
    this._state.voctBridgeRevision = hello.voctBridgeRevision;
    this._state.bridgeProtocol = { ...hello.bridgeProtocol };
    this._state.capabilities = capabilities;
    this._state.features = features;
    this._state.sessionEvidence = {
      loadSessionSeen: true,
      helloSeen: true,
      helloBoundToCurrentSession: this._helloBoundToCurrentSession,
      logIdentityKnown: this._file?.identityKnown === true,
      generation: this._generationCounter
    };
    this._state.channels = { ...this._channelEvidence };
    this._diagnostics = [...new Set([...this._diagnostics, ...diagnostics])].slice(0, 8);
    this._state.diagnostics = [...this._diagnostics];
    this._touch();
  }

  _applyFatal(reasonCode, hello = null) {
    this._state = this._emptyState(reasonCode, "INCOMPATIBLE");
    if (hello) {
      this._state.modBaseVersion = hello.modBaseVersion;
      this._state.upstreamBaseVersion = hello.upstreamBaseVersion;
      this._state.voctBridgeRevision = hello.voctBridgeRevision;
      this._state.bridgeProtocol = { ...hello.bridgeProtocol };
    }
    this._state.sessionEvidence = {
      loadSessionSeen: this._loadSessionSeen,
      helloSeen: this._helloSeen,
      helloBoundToCurrentSession: this._helloBoundToCurrentSession,
      logIdentityKnown: this._file?.identityKnown === true,
      generation: this._generationCounter
    };
    for (const name of Object.keys(this._state.features)) {
      this._state.features[name] = { allowed: false, reasonCode, missing: [] };
    }
    this._state.channels = { ...this._channelEvidence };
    this._touch();
  }

  _emptyState(reasonCode, status = "UNKNOWN") {
    const capabilities = {};
    const features = {};
    for (const id of Object.keys(this.manifest?.capabilities || {})) {
      capabilities[id] = { revision: null, supported: false, reasonCode: "HELLO_NOT_VERIFIED" };
    }
    for (const [name, feature] of Object.entries(this.manifest?.features || {})) {
      features[name] = { allowed: null, reasonCode: "BRIDGE_NOT_VERIFIED", missing: [...feature.required] };
    }
    return {
      status,
      reasonCode,
      runtimeVersion: this.manifest?.runtimeVersion || null,
      modBaseVersion: null,
      upstreamBaseVersion: null,
      voctBridgeRevision: null,
      bridgeProtocol: null,
      capabilities,
      features,
      sessionEvidence: {
        loadSessionSeen: this._loadSessionSeen,
        helloSeen: this._helloSeen,
        helloBoundToCurrentSession: this._helloBoundToCurrentSession,
        logIdentityKnown: this._file?.identityKnown === true,
        generation: this._generationCounter
      },
      channels: { ...this._channelEvidence },
      diagnostics: [...this._diagnostics],
      updatedAt: this._timestamp()
    };
  }

  _setEmptyState(reasonCode, status = "UNKNOWN") {
    this._state = this._emptyState(reasonCode, status);
    this._touch();
  }

  _setStatus(status, reasonCode) {
    this._state.status = status;
    this._state.reasonCode = reasonCode;
    this._state.sessionEvidence = {
      loadSessionSeen: this._loadSessionSeen,
      helloSeen: this._helloSeen,
      helloBoundToCurrentSession: this._helloBoundToCurrentSession,
      logIdentityKnown: this._file?.identityKnown === true,
      generation: this._generationCounter
    };
    this._state.channels = { ...this._channelEvidence };
    this._touch();
  }

  _refreshTimeoutState() {
    if (!this._file || !this._file.identityKnown || this._helloHandled) return;
    const elapsed = this._now() - (this._currentLoadSessionId ? this._sessionStartedAt : this._startedAt);
    if (elapsed < this.helloWaitMs) return;
    if (this._currentLoadSessionId) {
      this._setStatus("PENDING", "HELLO_TIMEOUT");
    } else if (!this._loadBoundaryAttempted) {
      this._setStatus("UNKNOWN", "LEGACY_UNVERIFIED");
    }
  }

  _resetSessionEvidence() {
    this._currentLoadSessionId = null;
    this._loadBoundaryAttempted = false;
    this._loadSessionSeen = false;
    this._helloSeen = false;
    this._helloBoundToCurrentSession = false;
    this._helloHandled = false;
    this._sessionStartedAt = this._now();
    this._channelEvidence = makeChannels();
    this._boundaries = { load: null, hello: null };
    this._diagnostics = [];
  }

  _clearFile(reasonCode) {
    this._file = null;
    this._lineCarry = Buffer.alloc(0);
    this._lineCarryOffset = 0;
    this._discardingOversizedLine = false;
    this._generationCounter += 1;
    this._resetSessionEvidence();
    this._setEmptyState(reasonCode, "UNKNOWN");
  }

  _ioFailure(reasonCode = "LOG_READ_FAILED") {
    if (this._file || this._state.reasonCode !== reasonCode) this._clearFile(reasonCode);
  }

  _diagnose(reasonCode) {
    if (!this._diagnostics.includes(reasonCode) && this._diagnostics.length < 8) this._diagnostics.push(reasonCode);
    this._state.diagnostics = [...this._diagnostics];
    this._touch();
  }

  _touch() {
    this._state.updatedAt = this._timestamp();
    this._emit();
  }

  _emit() {
    const state = this.getState();
    for (const listener of this._listeners) {
      try {
        listener(state);
      } catch (_error) {}
    }
  }

  _now() {
    try {
      const value = this.clock();
      const timestamp = value instanceof Date ? value.getTime() : Number(value);
      return Number.isFinite(timestamp) ? timestamp : Date.now();
    } catch (_error) {
      return Date.now();
    }
  }

  _timestamp() {
    try {
      return new Date(this._now()).toISOString();
    } catch (_error) {
      return null;
    }
  }
}

module.exports = { BridgeCompatibilityService, normalizeManifest, CHANNEL_NAMES };

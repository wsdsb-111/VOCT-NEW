"use strict";

function normalizeKind(kind) {
  return String(kind || "").toLowerCase();
}

function scanRecentRunAcks(debugLogPath, { fs, maxBytes = 4 * 1024 * 1024 } = {}) {
  if (!fs || !debugLogPath || !fs.existsSync(debugLogPath)) return [];
  const stat = fs.statSync(debugLogPath);
  const size = Number(stat.size) || 0;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return [];
  const fileDescriptor = fs.openSync(debugLogPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fileDescriptor, buffer, 0, length, start);
    return [...buffer.toString("utf8").matchAll(/VOTC:RUN_ACK\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/g)].map((match) => ({
      kind: normalizeKind(match[1]),
      commandId: match[2]
    }));
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function scanRunAcksForPendingCommands(debugLogPath, { fs, pendingCommands = [], chunkBytes = 1024 * 1024, maxBytes = 64 * 1024 * 1024 } = {}) {
  if (!fs || !debugLogPath || !fs.existsSync(debugLogPath)) return [];
  const wanted = new Set(pendingCommands.filter((command) => command?.commandId).map((command) => `${normalizeKind(command.kind)}:${command.commandId}`));
  if (wanted.size === 0) return [];
  const size = Number(fs.statSync(debugLogPath).size) || 0;
  const minimumOffset = Math.max(0, size - maxBytes);
  const fileDescriptor = fs.openSync(debugLogPath, "r");
  const matches = new Map();
  let end = size;
  try {
    while (end > minimumOffset && matches.size < wanted.size) {
      const start = Math.max(minimumOffset, end - chunkBytes);
      const readEnd = Math.min(size, end + 512);
      const length = readEnd - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fileDescriptor, buffer, 0, length, start);
      for (const match of buffer.toString("utf8").matchAll(/VOTC:RUN_ACK\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/g)) {
        const kind = normalizeKind(match[1]);
        const commandId = match[2];
        const key = `${kind}:${commandId}`;
        if (wanted.has(key)) matches.set(key, { kind, commandId });
      }
      end = start;
    }
    return [...matches.values()];
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

module.exports = { scanRecentRunAcks, scanRunAcksForPendingCommands };

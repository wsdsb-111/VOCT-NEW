"use strict";

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
      kind: match[1].toLowerCase(),
      commandId: match[2]
    }));
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

module.exports = { scanRecentRunAcks };

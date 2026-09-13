"use strict";

const fs = require("fs");
const readline = require("readline");

// Bounded state while scanning: only this command's first/last values, never latest conversation data.
async function readActionCommandReadback(filePath, commandId) {
  const stream = fs.createReadStream(filePath, { start: Math.max(0, fs.statSync(filePath).size - 8 * 1024 * 1024) });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let active = false;
  let result = { commandId, acknowledged: false, bindingFailed: false, gold: {}, opinion: {} };
  try {
    for await (const line of lines) {
      const begin = line.match(/VOTC:ACTION_BEGIN\/ACTION_EFFECT\/([A-Za-z0-9_-]+)/);
      if (begin) {
        if (active) return null; // Interleaving or duplicate execution is not one atomic observation.
        active = begin[1] === commandId;
      }
      if (!active) continue;
      if (line.includes("VOTC:ACTION_BINDING_FAILED")) result.bindingFailed = true;
      if (line.includes("VOTC:ACTION_INSUFFICIENT_GOLD")) result.insufficientGold = true;
      const binding = line.match(/VOTC:ACTION_(SOURCE|TARGET)\/;\/(\d+)/);
      if (binding) result[binding[1] === "SOURCE" ? "sourceRuntimeId" : "targetRuntimeId"] = Number(binding[2]);
      const income = line.match(/VOTC:IN\/;\/income\/;\/(\d+)\/;\/(-?\d+(?:\.\d+)?)(?=\/;\/)/);
      const opinion = line.match(/VOTC:IN\/;\/opinions\/;\/(\d+)\/;\/(\d+)\/;\/(-?\d+(?:\.\d+)?)(?=\/;\/)/);
      if (income || opinion) {
        const table = income ? result.gold : result.opinion;
        const key = income ? income[1] : opinion[1] + ":" + opinion[2];
        const value = Number(income ? income[2] : opinion[3]);
        const entry = table[key] || { before: value, after: value, count: 0 };
        entry.after = value;
        entry.count++;
        table[key] = entry;
      }
      const ack = line.match(/VOTC:RUN_ACK\/ACTION_EFFECT\/([A-Za-z0-9_-]+)/);
      if (ack) return ack[1] === commandId ? { ...result, acknowledged: true } : null;
    }
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }
}

module.exports = { readActionCommandReadback };

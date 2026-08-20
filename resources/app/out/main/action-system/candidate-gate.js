"use strict";

function detect(text, options, { legacyDetect } = {}) {
  if (typeof legacyDetect !== "function") throw new Error("missing_candidate_gate_implementation");
  return legacyDetect(text, options);
}

module.exports = { detect };

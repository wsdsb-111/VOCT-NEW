"use strict";

const fs = require("fs");
const path = require("path");

// lstat also detects dangling links; existsSync alone would treat them as absent.
function assertNoLinks(target, reason = "unsafe_summary_mutation_path") {
  let checked = path.resolve(target);
  for (;;) {
    try {
      if (fs.lstatSync(checked).isSymbolicLink()) throw new Error(reason);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(checked);
    if (parent === checked) return;
    checked = parent;
  }
}

module.exports = { assertNoLinks };

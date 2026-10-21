"use strict";

const fs = require("fs");
const path = require("path");

// lstat also detects dangling links; existsSync alone would treat them as absent.
function assertNoLinks(target, reason = "unsafe_summary_mutation_path") {
  let checked = path.resolve(target);
  let canonicalChecked = false;
  for (;;) {
    let existed = false;
    try {
      const signature = fs.lstatSync(checked);
      existed = true;
      if (signature.isSymbolicLink()) throw new Error(reason);
      // Some Windows junctions resolve elsewhere while lstat reports an ordinary directory.
      // Resolve the first existing path once; it also covers every existing ancestor.
      if (!canonicalChecked) {
        const identity = value => path.resolve(value).replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
        const canonicalPath = process.platform === "win32" ? fs.realpathSync.native(checked) : fs.realpathSync(checked);
        const actual = identity(canonicalPath);
        let expected = identity(checked);
        if (process.platform === "win32" && actual !== expected && actual.toLowerCase() === expected.toLowerCase()) {
          // Preserve on-disk entry spelling: case-sensitive NTFS directories may contain both names.
          const root = path.parse(expected).root;
          let spelled = path.parse(actual).root;
          for (const part of expected.slice(root.length).split(path.sep)) {
            const entries = fs.readdirSync(spelled);
            const entry = entries.includes(part) ? part : entries.find(name => name.toLowerCase() === part.toLowerCase());
            if (!entry) throw new Error(reason);
            spelled = path.join(spelled, entry);
          }
          expected = spelled;
        }
        if (actual !== expected) throw new Error(reason);
        canonicalChecked = true;
      }
    } catch (error) {
      if (error.code !== "ENOENT" || existed) throw error;
    }
    const parent = path.dirname(checked);
    if (parent === checked) return;
    checked = parent;
  }
}

module.exports = { assertNoLinks };

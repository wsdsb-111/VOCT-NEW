"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app/main/memory-system/scoped-path.js"), "utf8");
const base = path.resolve(__dirname, "../.build/synthetic-path-authority");
const alias = path.join(base, "owner-alias");
const outside = path.join(base, "other-owner");
let realpathCalls = 0;
const absent = new Set();
let dangling = false;
let pathOverride = null;
const canonicalPath = file => {
  realpathCalls++;
  if (pathOverride) return pathOverride(file);
  return file === alias || file.startsWith(alias + path.sep) ? outside + file.slice(alias.length) : file;
};
const realpathSync = file => process.platform === "win32" ? file : canonicalPath(file);
realpathSync.native = canonicalPath;
const moduleFixture = { exports: {} };
vm.runInNewContext(source, { module: moduleFixture, process, require(name) {
  if (name === "path") return path;
  if (name !== "fs") throw new Error("Unexpected dependency");
  return {
    lstatSync(file) {
      if (absent.has(file)) throw Object.assign(new Error("missing"), {code: "ENOENT"});
      return { isSymbolicLink: () => dangling && file === alias };
    },
    realpathSync,
    readdirSync(directory) {
      const relative = path.relative(path.parse(base).root, base);
      const parts = relative.split(path.sep);
      const depth = path.relative(path.parse(base).root, directory).split(path.sep).filter(Boolean).length;
      return depth < parts.length ? [parts[depth]] : ["CaseOwner", "caseowner"];
    }
  };
} });
const { assertNoLinks } = moduleFixture.exports;
assertNoLinks(path.join(base, "ordinary-owner"));
assert.equal(realpathCalls, 1, "canonical ancestor check is bounded to one realpath operation");
assert.throws(() => assertNoLinks(alias), /unsafe_summary_mutation_path/, "an unreported junction cannot substitute another Owner's source directory");
const newFile = path.join(alias, "new-source.json");
absent.add(newFile);
assert.throws(() => assertNoLinks(newFile), /unsafe_summary_mutation_path/, "a not-yet-existing file still checks its redirected ancestor");
absent.clear();
dangling = true;
assert.throws(() => assertNoLinks(alias), /unsafe_summary_mutation_path/, "the original dangling-link lstat guard remains active");
dangling = false;
pathOverride = () => { throw Object.assign(new Error("unresolvable_existing_path"), { code: "ENOENT" }); };
assert.throws(() => assertNoLinks(alias), /unresolvable_existing_path/, "an existing junction with an absent target fails closed");
pathOverride = null;
if (process.platform === "win32") {
  pathOverride = file => "\\\\?\\" + file;
  assertNoLinks(path.join(base, "ordinary-owner"));
  pathOverride = file => "\\\\?\\UNC\\" + file.slice(2);
  assertNoLinks("\\\\fixture-server\\fixture-share\\owner");
  pathOverride = file => file.endsWith("CaseOwner") ? file.slice(0, -9) + "caseowner" : file;
  assert.throws(() => assertNoLinks(path.join(base, "CaseOwner")), /unsafe_summary_mutation_path/, "case-sensitive entries cannot be equated by lowercasing");
  pathOverride = file => file.toLowerCase() === path.join(base, "caseowner").toLowerCase() ? path.join(base, "caseowner") : file;
  assertNoLinks(path.join(base, "caseowner").toLowerCase());
}
console.log("PASS V9.4 source path boundary (ordinary paths, hidden junctions, missing descendants and dangling links; no source content read)");

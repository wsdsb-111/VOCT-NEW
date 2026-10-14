"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-binary-checkout-"));
const git = args => execFileSync("git", args, { cwd: temporary, maxBuffer: 20 * 1024 * 1024 });
try {
  git(["init", "--quiet"]);
  git(["config", "core.autocrlf", "true"]);
  fs.copyFileSync(path.join(root, ".gitattributes"), path.join(temporary, ".gitattributes"));
  const inputs = JSON.parse(fs.readFileSync(path.join(root, "build/runtime-inputs.json"))).files;
  const textExtensions = new Set([".js", ".json", ".html", ".css", ".md", ".hbs", ".svg"]);
  const binaries = inputs.filter(row => row.target.startsWith("out/") && !textExtensions.has(path.extname(row.target)));
  assert(binaries.length > 0, "binary fixtures must come from the managed inventory");
  for (const row of binaries) {
    const target = `resources/app/${row.target}`;
    const attributes = git(["check-attr", "text", "eol", "--", target]).toString();
    assert(attributes.includes("text: unset"), `${target} must disable text conversion`);
    assert(attributes.includes("eol: unspecified"), `${target} must clear inherited eol`);
    const source = fs.readFileSync(path.join(root, "src/app", row.source));
    // Supply binary stdin directly; never compare binary data as text.
    const oid = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: temporary, input: source }).toString().trim();
    const checkout = git(["cat-file", "--filters", `--path=${target}`, oid]);
    assert(checkout.equals(source), `${target} must survive Windows checkout byte-for-byte`);
  }
  for (const extension of ["ico", "png", "jpg", "webp", "wasm", "pak", "bin", "otf", "node"]) {
    const attributes = git(["check-attr", "text", "eol", "--", `resources/app/out/future.${extension}`]).toString();
    assert(attributes.includes("text: unset") && attributes.includes("eol: unspecified"));
  }
  const textAttributes = git(["check-attr", "text", "eol", "--", "resources/app/out/main/main.js"]).toString();
  assert(textAttributes.includes("text: set") && textAttributes.includes("eol: crlf"));
  const lfs = git(["check-attr", "filter", "diff", "merge", "--", "resources/app/out/future.bin"]).toString();
  assert(lfs.includes("filter: lfs") && lfs.includes("diff: lfs") && lfs.includes("merge: lfs"));
  console.log(`V9.3.3.1 binary checkout: PASS (${binaries.length} managed binaries; text and LFS contracts retained)`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

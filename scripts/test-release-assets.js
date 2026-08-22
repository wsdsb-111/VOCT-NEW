"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const criticalAssets = ["VOTC.exe", "resources.pak", "ffmpeg.dll"];
const lfsPrefix = "version https://git-lfs.github.com/spec/v1";

for (const relativePath of criticalAssets) {
  const filePath = path.join(root, relativePath);
  assert(fs.existsSync(filePath), `release asset is missing: ${relativePath}`);
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(160);
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString("utf8");
    assert(!header.startsWith(lfsPrefix), `${relativePath} is an unresolved Git LFS pointer; run git lfs pull before launching or packaging`);
  } finally {
    fs.closeSync(descriptor);
  }
}

const attributes = fs.readFileSync(path.join(root, ".gitattributes"), "utf8");
assert(attributes.includes("VOTC.exe filter=lfs"), "VOTC.exe must remain explicitly managed by Git LFS");
assert(attributes.includes("*.dll filter=lfs") && attributes.includes("*.pak filter=lfs"), "Electron binary assets must remain managed by Git LFS");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
assert(readme.includes("git lfs pull"), "README must tell source-clone users how to materialize release assets");

console.log("VOTC release assets: PASS (critical binaries materialized, Git LFS clone instructions present)");

